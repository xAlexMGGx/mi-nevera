-- Fase 2: casas compartidas (SPEC §5.1, §5.6, §5.7 y §7.5).
--
-- Orden de bloqueos en todas las operaciones, para que dos personas no se bloqueen entre sí:
-- 1. Filas de producto, por id. 2. Números de táper. 3. Filas de house_changes, por casa.

---------------------------------------------------------------------------------------------------
-- Invitaciones
---------------------------------------------------------------------------------------------------

create table public.house_invites (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  code text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index house_invites_house_id_idx on public.house_invites (house_id);

create function private.is_house_owner(p_house_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.house_members
    where house_id = p_house_id
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

alter table public.house_invites enable row level security;

create policy "house_invites_select_owner" on public.house_invites
for select to authenticated
using (private.is_house_owner(house_id));

revoke all on public.house_invites from anon, authenticated;
grant select on public.house_invites to authenticated;

---------------------------------------------------------------------------------------------------
-- Tiempo real
---------------------------------------------------------------------------------------------------

-- Señal de "algo ha cambiado en esta casa": al recibirla, cada móvil vuelve a leer sus datos.
-- Es una tabla aparte porque Realtime no filtra los borrados ni les aplica RLS, y porque así
-- `undo_state` y el resto de los datos no pasan nunca por el canal.
create table public.house_changes (
  house_id uuid primary key references public.houses (id) on delete cascade,
  version bigint not null default 0,
  changed_at timestamptz not null default now()
);

insert into public.house_changes (house_id)
select id from public.houses;

create function private.create_house_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.house_changes (house_id) values (new.id);
  return new;
end;
$$;

create trigger houses_create_changes
after insert on public.houses
for each row execute function private.create_house_changes();

-- Por sentencia: borrar una casa con miles de movimientos no genera miles de señales.
create function private.signal_house_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.house_changes
  set version = version + 1,
      changed_at = now()
  where house_id in (select house_id from changed);
  return null;
end;
$$;

-- Todo cambio del inventario registra o borra un movimiento. Los productos y los miembros
-- también cambian sin él: al renombrar, al borrar un producto o al entrar y salir de la casa.
create trigger movements_signal_insert after insert on public.movements
referencing new table as changed for each statement execute function private.signal_house_change();
create trigger movements_signal_delete after delete on public.movements
referencing old table as changed for each statement execute function private.signal_house_change();
create trigger products_signal_update after update on public.products
referencing new table as changed for each statement execute function private.signal_house_change();
create trigger products_signal_delete after delete on public.products
referencing old table as changed for each statement execute function private.signal_house_change();
create trigger house_members_signal_insert after insert on public.house_members
referencing new table as changed for each statement execute function private.signal_house_change();
create trigger house_members_signal_update after update on public.house_members
referencing new table as changed for each statement execute function private.signal_house_change();
create trigger house_members_signal_delete after delete on public.house_members
referencing old table as changed for each statement execute function private.signal_house_change();

alter table public.house_changes enable row level security;

create policy "house_changes_select_member" on public.house_changes
for select to authenticated
using (private.is_house_member(house_id));

revoke all on public.house_changes from anon, authenticated;
grant select on public.house_changes to authenticated;

-- El perfil avisa a cada persona de que su casa activa ha cambiado, por ejemplo al expulsarla.
alter publication supabase_realtime add table public.house_changes, public.profiles;

-- Quien se queda sin su casa activa pasa a otra de las suyas o, si no tiene, a la bienvenida.
create function private.reassign_active_house()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set active_house_id = (
    select m.house_id
    from public.house_members m
    where m.user_id = old.user_id
      and m.house_id <> old.house_id
    order by m.joined_at, m.house_id
    limit 1
  )
  where p.id = old.user_id
    and (p.active_house_id = old.house_id or p.active_house_id is null);
  return null;
end;
$$;

create trigger house_members_reassign_active
after delete on public.house_members
for each row execute function private.reassign_active_house();

---------------------------------------------------------------------------------------------------
-- Gestionar casas y miembros
---------------------------------------------------------------------------------------------------

create function private.assert_owner(p_house_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.assert_member(p_house_id);
  if not private.is_house_owner(p_house_id) then
    raise exception 'not_owner';
  end if;
end;
$$;

create function public.rename_house(p_house_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner(p_house_id);

  begin
    update public.houses set name = btrim(p_name) where id = p_house_id;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid_input';
  end;

  update public.house_changes
  set version = version + 1,
      changed_at = now()
  where house_id = p_house_id;
end;
$$;

create function public.delete_house(p_house_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner(p_house_id);
  delete from public.houses where id = p_house_id;
end;
$$;

-- Función y no política de acceso: el perfil de otra persona solo se comparte su nombre.
create function public.list_house_members(p_house_id uuid)
returns table (user_id uuid, display_name text, role public.member_role, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_house_id);

  return query
  select m.user_id, coalesce(p.display_name, ''), m.role, m.joined_at
  from public.house_members m
  left join public.profiles p on p.id = m.user_id
  where m.house_id = p_house_id
  order by m.joined_at, m.user_id;
end;
$$;

-- Salir, expulsar y eliminar la cuenta siguen la misma regla (SPEC §6): si no queda nadie, la casa
-- se borra; si se va el propietario, la propiedad pasa al miembro más antiguo.
create function private.remove_membership(p_house_id uuid, p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_role public.member_role;
  v_heir uuid;
begin
  -- Dos salidas a la vez no pueden dejar la casa sin propietario. Este bloqueo no frena a quien
  -- solo está usando el inventario, porque no afecta a las claves ajenas.
  perform 1 from public.houses where id = p_house_id for no key update;

  select role into v_role
  from public.house_members
  where house_id = p_house_id and user_id = p_user_id;
  if not found then
    raise exception 'not_member';
  end if;

  select user_id into v_heir
  from public.house_members
  where house_id = p_house_id and user_id <> p_user_id
  order by joined_at, user_id
  limit 1;

  if v_heir is null then
    delete from public.houses where id = p_house_id;
    return;
  end if;

  if v_role = 'owner' then
    update public.house_members
    set role = 'owner'
    where house_id = p_house_id and user_id = v_heir;
  end if;

  delete from public.house_members
  where house_id = p_house_id and user_id = p_user_id;
end;
$$;

create function public.leave_house(p_house_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.remove_membership(p_house_id, (select auth.uid()));
end;
$$;

create function public.remove_member(p_house_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_owner(p_house_id);
  if p_user_id = (select auth.uid()) then
    raise exception 'invalid_input';
  end if;
  perform private.remove_membership(p_house_id, p_user_id);
end;
$$;

-- 8 caracteres de un alfabeto de 32, sin los que se confunden al leerlos (I, O, 0 y 1).
-- gen_random_uuid() usa un generador seguro; se saltan los bytes con bits fijos.
create function private.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_position integer;
  v_code text := '';
begin
  foreach v_position in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, v_position) % 32, 1);
  end loop;
  return v_code;
end;
$$;

create function public.create_invite(p_house_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  perform private.assert_owner(p_house_id);

  loop
    insert into public.house_invites (house_id, code, created_by)
    values (p_house_id, private.new_invite_code(), (select auth.uid()))
    on conflict (code) do nothing
    returning code into v_code;
    exit when found;
  end loop;

  return v_code;
end;
$$;

create function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house_id uuid;
begin
  select house_id into v_house_id from public.house_invites where id = p_invite_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.assert_owner(v_house_id);

  delete from public.house_invites where id = p_invite_id;
end;
$$;

-- Cada código sirve una sola vez. El mismo error para los inexistentes, caducados o usados.
create function public.join_house(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^[:alnum:]]', '', 'g'));
  v_invite public.house_invites;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite
  from public.house_invites
  where code = v_code
  for update;

  if not found or v_invite.used_at is not null or v_invite.expires_at <= now() then
    raise exception 'invalid_invite';
  end if;

  -- No gasta el código: quien ya está dentro se lo puede pasar a otra persona.
  if private.is_house_member(v_invite.house_id) then
    raise exception 'already_member';
  end if;

  insert into public.house_members (house_id, user_id, role)
  values (v_invite.house_id, v_user_id, 'editor');

  update public.house_invites set used_at = now() where id = v_invite.id;
  update public.profiles set active_house_id = v_invite.house_id where id = v_user_id;

  return v_invite.house_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Mis datos
---------------------------------------------------------------------------------------------------

create function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select jsonb_build_object(
    'app', 'nevera-digital',
    'exported_at', now(),
    'email', (select email from auth.users where id = v_user_id),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_user_id),
    'houses', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'house', to_jsonb(h),
            'role', m.role,
            'joined_at', m.joined_at,
            'members', (
              select jsonb_agg(
                jsonb_build_object('display_name', coalesce(pr.display_name, ''), 'role', x.role, 'joined_at', x.joined_at)
                order by x.joined_at
              )
              from public.house_members x
              left join public.profiles pr on pr.id = x.user_id
              where x.house_id = h.id
            ),
            'zones', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from public.zones t where t.house_id = h.id), '[]'::jsonb),
            'products', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.products t where t.house_id = h.id), '[]'::jsonb),
            'lots', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.lots t where t.house_id = h.id), '[]'::jsonb),
            'opened_units', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.opened_units t where t.house_id = h.id), '[]'::jsonb),
            'date_samples', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.date_samples t where t.house_id = h.id), '[]'::jsonb),
            'movements', coalesce((select jsonb_agg(to_jsonb(t) - 'undo_state' order by t.seq) from public.movements t where t.house_id = h.id), '[]'::jsonb)
          )
          order by m.joined_at
        )
        from public.house_members m
        join public.houses h on h.id = m.house_id
        where m.user_id = v_user_id
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

-- Función y no Edge Function: todo ocurre en una transacción, sin claves secretas de por medio.
-- El perfil, la pertenencia a las casas y las sesiones caen en cascada con el usuario.
create function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_house_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  for v_house_id in
    select house_id from public.house_members where user_id = v_user_id order by house_id
  loop
    perform private.remove_membership(v_house_id, v_user_id);
  end loop;

  delete from auth.users where id = v_user_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Mover entre casas (SPEC §7.5)
---------------------------------------------------------------------------------------------------

create function private.assert_movable(
  p_lot public.lots,
  p_product public.products,
  p_quantity numeric,
  p_unit_ids uuid[]
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_selected integer;
begin
  select count(*) into v_selected
  from public.opened_units
  where lot_id = p_lot.id and id = any (p_unit_ids);

  if v_selected <> cardinality(p_unit_ids)
    or p_quantity < 0
    or p_quantity > p_lot.quantity
    or (p_quantity = 0 and v_selected = 0)
    or (p_product.quantity_kind = 'divisible' and p_quantity <> trunc(p_quantity))
  then
    raise exception 'invalid_amount';
  end if;
end;
$$;

-- La cantidad de un lote solo tiene sentido según cómo se cuenta su producto:
-- 2 bricks de 1 l no son 2 bricks de 500 ml, y 200 g no son 200 kg.
create function private.assert_same_measure(p_source public.products, p_target public.products)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_source.quantity_kind <> p_target.quantity_kind
    or (
      p_source.quantity_kind = 'divisible'
      and (p_source.content_amount <> p_target.content_amount or p_source.content_unit <> p_target.content_unit)
    )
    or (p_source.quantity_kind = 'bulk' and p_source.bulk_unit <> p_target.bulk_unit)
  then
    raise exception 'incompatible_product';
  end if;
end;
$$;

-- Crea en la otra casa un lote con lo que se mueve. Conserva fechas, marca y estado, salvo que el
-- destino cambie el estado: entrar en un congelador es congelar y salir de él, descongelar.
create function private.move_lot_to_house(
  p_lot_id uuid,
  p_quantity numeric,
  p_target_zone public.zones,
  p_opened_unit_ids uuid[],
  p_reminder_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_quantity numeric := coalesce(p_quantity, 0);
  v_unit_ids uuid[] := coalesce(p_opened_unit_ids, '{}');
  v_today date := private.user_today();
  v_lot public.lots;
  v_product public.products;
  v_target_product public.products;
  v_source_zone public.zones;
  v_candidate_id uuid;
  v_source_house_id uuid;
  v_source_house_name text;
  v_target_house_name text;
  v_freezing boolean;
  v_thawing boolean;
  v_number integer;
  v_new_id uuid := gen_random_uuid();
  v_created_product boolean := false;
  v_undo jsonb;
  v_details jsonb;
  v_moved_in uuid;
begin
  select house_id, product_id into v_source_house_id, v_candidate_id
  from public.lots
  where id = p_lot_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.assert_member(v_source_house_id);
  perform private.assert_member(p_target_zone.house_id);

  select * into v_product from public.products where id = v_candidate_id;

  -- Mismo producto del catálogo o mismo nombre. Un táper es siempre un producto propio.
  v_candidate_id := null;
  if v_product.kind = 'food' then
    select p.id into v_candidate_id
    from public.products p
    where p.house_id = p_target_zone.house_id
      and p.kind = 'food'
      and (
        (v_product.catalog_item_id is not null and p.catalog_item_id = v_product.catalog_item_id)
        or p.name_normalized = v_product.name_normalized
      )
    order by (p.catalog_item_id is not distinct from v_product.catalog_item_id) desc, p.id
    limit 1;
  end if;

  -- En orden de id, por si otra persona mueve el mismo producto en sentido contrario.
  perform 1
  from public.products
  where id in (v_product.id, v_candidate_id)
  order by id
  for update;

  -- Se releen tras el bloqueo: otra operación pudo cambiarlos mientras se esperaba.
  select * into v_lot from public.lots where id = p_lot_id;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_product from public.products where id = v_lot.product_id;
  perform private.assert_movable(v_lot, v_product, v_quantity, v_unit_ids);

  select * into v_source_zone from public.zones where id = v_lot.zone_id;
  select name into v_source_house_name from public.houses where id = v_lot.house_id;
  select name into v_target_house_name from public.houses where id = p_target_zone.house_id;

  if v_product.kind = 'cooked_dish' then
    perform private.lock_containers(p_target_zone.house_id);
    v_number := private.lowest_free_container(p_target_zone.house_id);
  end if;

  perform 1
  from public.house_changes
  where house_id in (v_lot.house_id, p_target_zone.house_id)
  order by house_id
  for update;

  if v_candidate_id is not null then
    select * into v_target_product from public.products where id = v_candidate_id;
  end if;

  if v_target_product.id is null then
    insert into public.products (
      house_id, catalog_item_id, name, name_customized, category, icon, kind, quantity_kind,
      unit_label, content_amount, content_unit, bulk_unit, preferred_brand, brand_notes, image_url
    )
    values (
      p_target_zone.house_id, v_product.catalog_item_id, v_product.name, v_product.name_customized,
      v_product.category, v_product.icon, v_product.kind, v_product.quantity_kind,
      v_product.unit_label, v_product.content_amount, v_product.content_unit, v_product.bulk_unit,
      v_product.preferred_brand, v_product.brand_notes, v_product.image_url
    )
    on conflict do nothing
    returning * into v_target_product;

    if v_target_product.id is not null then
      v_created_product := true;
    else
      -- Otra persona lo acaba de crear con el mismo nombre.
      select * into v_target_product
      from public.products p
      where p.house_id = p_target_zone.house_id
        and p.kind = 'food'
        and (p.name_normalized = v_product.name_normalized or p.catalog_item_id = v_product.catalog_item_id)
      limit 1
      for update;
      if not found then
        raise exception 'not_found';
      end if;
    end if;
  end if;

  perform private.assert_same_measure(v_product, v_target_product);

  v_freezing := p_target_zone.kind = 'freezer' and v_source_zone.kind <> 'freezer';
  v_thawing := v_source_zone.kind = 'freezer' and p_target_zone.kind <> 'freezer';

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);
  if v_created_product then
    v_undo := private.undo_append(v_undo, 'created_products', v_target_product.id);
  end if;

  insert into public.lots (
    id, house_id, zone_id, product_id, quantity, brand, barcode, image_url, printed_date,
    printed_date_type, purchased_at, cooked_at, frozen_at, thawed_at, reminder_date,
    container_number, opened_at, source
  )
  values (
    v_new_id, p_target_zone.house_id, p_target_zone.id, v_target_product.id, v_quantity, v_lot.brand,
    v_lot.barcode, v_lot.image_url, v_lot.printed_date, v_lot.printed_date_type, v_lot.purchased_at,
    v_lot.cooked_at,
    case when v_freezing then v_today else v_lot.frozen_at end,
    case when v_freezing then null when v_thawing then v_today else v_lot.thawed_at end,
    case when v_freezing or v_thawing then p_reminder_date else v_lot.reminder_date end,
    v_number, v_lot.opened_at, 'move'
  );
  v_undo := private.undo_append(v_undo, 'created_lots', v_new_id);

  update public.opened_units
  set lot_id = v_new_id,
      house_id = p_target_zone.house_id,
      reminder_date = case when v_freezing or v_thawing then p_reminder_date else reminder_date end
  where id = any (v_unit_ids);

  update public.lots set quantity = quantity - v_quantity where id = v_lot.id;
  perform private.drop_lot_if_empty(v_lot.id);

  v_undo := private.merge_twin(v_undo, v_new_id);

  v_details := jsonb_build_object(
    'amount', v_quantity + cardinality(v_unit_ids),
    'from_zone', v_source_zone.kind,
    'to_zone', p_target_zone.kind
  );

  -- Se deshace desde el movimiento de salida, que recuerda cuál es el de entrada.
  v_moved_in := private.log_movement(
    'moved_in',
    v_target_product,
    v_details || jsonb_build_object('from_house', v_source_house_name),
    v_undo
  );

  return private.log_movement(
    'moved_out',
    v_product,
    v_details || jsonb_build_object('to_house', v_target_house_name),
    v_undo || jsonb_build_object('linked_movement', v_moved_in)
  );
end;
$$;

create or replace function public.move_lot(
  p_lot_id uuid,
  p_quantity numeric,
  p_target_zone_id uuid,
  p_opened_unit_ids uuid[] default '{}',
  p_reminder_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.lots;
  v_product public.products;
  v_source_zone public.zones;
  v_target_zone public.zones;
  v_new_product public.products;
  v_undo jsonb;
  v_type public.movement_type := 'moved_zone';
  v_quantity numeric := coalesce(p_quantity, 0);
  v_unit_ids uuid[] := coalesce(p_opened_unit_ids, '{}');
  v_selected integer := coalesce(cardinality(p_opened_unit_ids), 0);
  v_total_units integer;
  v_frozen_at date;
  v_thawed_at date;
  v_reminder date;
  v_number integer;
  v_new_id uuid;
  v_house_id uuid;
  v_today date := private.user_today();
begin
  select * into v_target_zone from public.zones where id = p_target_zone_id;
  if not found then
    raise exception 'not_found';
  end if;

  select house_id into v_house_id from public.lots where id = p_lot_id;
  if found and v_house_id <> v_target_zone.house_id then
    return private.move_lot_to_house(p_lot_id, p_quantity, v_target_zone, p_opened_unit_ids, p_reminder_date);
  end if;

  v_lot := private.lock_lot(p_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;
  select * into v_source_zone from public.zones where id = v_lot.zone_id;

  if v_target_zone.id = v_source_zone.id then
    raise exception 'same_zone';
  end if;

  perform private.assert_movable(v_lot, v_product, v_quantity, v_unit_ids);

  select count(*) into v_total_units from public.opened_units where lot_id = v_lot.id;

  v_frozen_at := v_lot.frozen_at;
  v_thawed_at := v_lot.thawed_at;
  v_reminder := v_lot.reminder_date;

  if v_target_zone.kind = 'freezer' then
    v_type := 'frozen';
    v_frozen_at := v_today;
    v_thawed_at := null;
    v_reminder := p_reminder_date;
  elsif v_source_zone.kind = 'freezer' then
    v_type := 'thawed';
    v_thawed_at := v_today;
    v_reminder := p_reminder_date;
  end if;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  if v_type <> 'moved_zone' then
    update public.opened_units
    set reminder_date = p_reminder_date
    where id = any (v_unit_ids);
  end if;

  if v_quantity = v_lot.quantity and v_selected = v_total_units then
    update public.lots
    set zone_id = v_target_zone.id,
        frozen_at = v_frozen_at,
        thawed_at = v_thawed_at,
        reminder_date = v_reminder
    where id = v_lot.id;
    v_undo := private.merge_twin(v_undo, v_lot.id);
  else
    v_new_id := gen_random_uuid();

    if v_product.kind = 'cooked_dish' then
      -- La parte que se mueve va en otro recipiente, así que es otro táper con otro número.
      perform private.lock_containers(v_lot.house_id);
      v_number := private.lowest_free_container(v_lot.house_id);
      insert into public.products (house_id, name, name_customized, category, icon, kind, quantity_kind, unit_label)
      values (v_product.house_id, v_product.name, v_product.name_customized, v_product.category, v_product.icon, 'cooked_dish', 'count', v_product.unit_label)
      returning * into v_new_product;
      v_undo := private.undo_append(v_undo, 'created_products', v_new_product.id);
    end if;

    insert into public.lots (
      id, house_id, zone_id, product_id, quantity, brand, barcode, image_url, printed_date,
      printed_date_type, purchased_at, cooked_at, frozen_at, thawed_at, reminder_date,
      container_number, opened_at, source
    )
    values (
      v_new_id, v_lot.house_id, v_target_zone.id, coalesce(v_new_product.id, v_lot.product_id),
      v_quantity, v_lot.brand, v_lot.barcode, v_lot.image_url, v_lot.printed_date,
      v_lot.printed_date_type, v_lot.purchased_at, v_lot.cooked_at, v_frozen_at, v_thawed_at,
      v_reminder, v_number, v_lot.opened_at, 'move'
    );
    v_undo := private.undo_append(v_undo, 'created_lots', v_new_id);

    update public.opened_units set lot_id = v_new_id where id = any (v_unit_ids);
    update public.lots set quantity = quantity - v_quantity where id = v_lot.id;
    perform private.drop_lot_if_empty(v_lot.id);

    v_undo := private.merge_twin(v_undo, v_new_id);
  end if;

  return private.log_movement(
    v_type,
    v_product,
    jsonb_build_object(
      'amount', v_quantity + v_selected,
      'from_zone', v_source_zone.kind,
      'to_zone', v_target_zone.kind
    ),
    v_undo
  );
end;
$$;

---------------------------------------------------------------------------------------------------
-- Deshacer
---------------------------------------------------------------------------------------------------

-- Cambia respecto a la fase 1:
-- - Deshace también los movimientos entre casas, que afectan a las dos.
-- - Borra todos los lotes antes de restaurar ninguno. Al restaurarlos de uno en uno, una unidad
--   abierta que se había fusionado con otro lote podía chocar consigo misma, y deshacer fallaba
--   según el orden de los identificadores.
create or replace function public.undo_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.movements;
  v_linked public.movements;
  v_undo jsonb;
  v_id text;
  v_snapshot jsonb;
  v_product public.products;
begin
  select * into v_movement from public.movements where id = p_movement_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.assert_member(v_movement.house_id);

  -- La entrada en la otra casa no se deshace por separado, sino con su salida.
  if v_movement.type = 'moved_in' then
    raise exception 'invalid_input';
  end if;

  if v_movement.created_at < now() - interval '2 minutes' then
    raise exception 'undo_expired';
  end if;

  v_undo := v_movement.undo_state;

  if v_undo ? 'linked_movement' then
    select * into v_linked from public.movements where id = (v_undo ->> 'linked_movement')::uuid;
    if found then
      perform private.assert_member(v_linked.house_id);
    end if;
  end if;

  -- Se bloquea antes de comprobar: así no se cuela un cambio entre la comprobación y la restauración.
  perform 1
  from public.products
  where id in (v_movement.product_id, v_linked.product_id)
  order by id
  for update;

  if v_linked.id is not null then
    perform 1
    from public.house_changes
    where house_id in (v_movement.house_id, v_linked.house_id)
    order by house_id
    for update;
  end if;

  if exists (
    select 1
    from public.movements m
    where m.house_id in (v_movement.house_id, v_linked.house_id)
      and m.seq > v_movement.seq
      and m.lot_ids && v_movement.lot_ids
  ) then
    raise exception 'undo_conflict';
  end if;

  begin
    delete from public.date_samples
    where id in (select value::uuid from jsonb_array_elements_text(v_undo -> 'created_samples'));

    delete from public.lots
    where id in (select value::uuid from jsonb_array_elements_text(v_undo -> 'created_lots'));

    for v_id, v_snapshot in select key, value from jsonb_each(v_undo -> 'products') loop
      v_product := jsonb_populate_record(null::public.products, v_snapshot);
      insert into public.products (
        id, house_id, catalog_item_id, name, name_customized, category, icon, kind, quantity_kind,
        unit_label, content_amount, content_unit, bulk_unit, preferred_brand, brand_notes,
        image_url, created_at, updated_at
      )
      values (
        v_product.id, v_product.house_id, v_product.catalog_item_id, v_product.name,
        v_product.name_customized, v_product.category, v_product.icon, v_product.kind,
        v_product.quantity_kind, v_product.unit_label, v_product.content_amount,
        v_product.content_unit, v_product.bulk_unit, v_product.preferred_brand,
        v_product.brand_notes, v_product.image_url, v_product.created_at, v_product.updated_at
      )
      on conflict (id) do nothing;
    end loop;

    delete from public.lots
    where id in (select key::uuid from jsonb_each(v_undo -> 'lots'));

    for v_id, v_snapshot in select key, value from jsonb_each(v_undo -> 'lots') loop
      insert into public.lots
      select * from jsonb_populate_record(null::public.lots, v_snapshot -> 'lot');
      insert into public.opened_units
      select r.* from jsonb_populate_recordset(null::public.opened_units, v_snapshot -> 'units') r;
    end loop;

    delete from public.products p
    where p.id in (select value::uuid from jsonb_array_elements_text(v_undo -> 'created_products'))
      and not exists (select 1 from public.lots l where l.product_id = p.id);
  exception
    -- Por ejemplo, el número de un táper vaciado ya lo usa otro, o la otra casa ya no existe.
    when unique_violation or foreign_key_violation then
      raise exception 'undo_conflict';
  end;

  delete from public.movements where id in (p_movement_id, v_linked.id);
end;
$$;

---------------------------------------------------------------------------------------------------
-- Permisos
---------------------------------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;

-- Las usan las políticas de acceso y las vistas, que se ejecutan como el usuario.
grant execute on function private.is_house_member(uuid) to authenticated;
grant execute on function private.is_house_owner(uuid) to authenticated;
grant execute on function private.compute_effective(date, public.printed_date_type, date, date, date, boolean, boolean) to authenticated;

revoke all on function public.rename_house(uuid, text) from public, anon;
revoke all on function public.delete_house(uuid) from public, anon;
revoke all on function public.list_house_members(uuid) from public, anon;
revoke all on function public.leave_house(uuid) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.join_house(text) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_account() from public, anon;

grant execute on function public.rename_house(uuid, text) to authenticated;
grant execute on function public.delete_house(uuid) to authenticated;
grant execute on function public.list_house_members(uuid) to authenticated;
grant execute on function public.leave_house(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.join_house(text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_account() to authenticated;
