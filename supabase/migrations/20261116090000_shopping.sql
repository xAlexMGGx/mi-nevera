-- Fase 6: lista de la compra (SPEC §13). Una lista por casa, compartida y en tiempo real.
-- No cambia el inventario, así que no registra movimientos; solo el ticket la toca al aplicarse.

create type public.shopping_origin as enum ('manual', 'finished', 'recipe');

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  -- Si se borra el producto, el elemento sigue en la lista con su nombre.
  product_id uuid references public.products (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  quantity_text text check (char_length(quantity_text) <= 40),
  preferred_brand text check (char_length(preferred_brand) <= 80),
  checked boolean not null default false,
  checked_at timestamptz,
  origin public.shopping_origin not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shopping_items_house_id_idx on public.shopping_items (house_id);
create index shopping_items_product_id_idx on public.shopping_items (product_id);

create trigger shopping_items_set_updated_at
before update on public.shopping_items
for each row execute function public.set_updated_at();

-- Tiempo real (SPEC §13): como el inventario, cada cambio sube la señal de la casa.
create trigger shopping_items_signal_insert after insert on public.shopping_items
referencing new table as changed for each statement execute function private.signal_house_change();
create trigger shopping_items_signal_update after update on public.shopping_items
referencing new table as changed for each statement execute function private.signal_house_change();
create trigger shopping_items_signal_delete after delete on public.shopping_items
referencing old table as changed for each statement execute function private.signal_house_change();

alter table public.shopping_items enable row level security;

create policy "shopping_items_select_member" on public.shopping_items
for select to authenticated
using (private.is_house_member(house_id));

revoke all on public.shopping_items from anon, authenticated;
-- Solo lectura: se cambia con las funciones de abajo.
grant select on public.shopping_items to authenticated;

---------------------------------------------------------------------------------------------------
-- Operaciones
---------------------------------------------------------------------------------------------------

-- Añade a la lista. Con producto, se enlaza y toma su marca preferida; sin él, se enlaza solo si la
-- casa tiene un producto con ese nombre. Si ya está en la lista sin tachar, no se repite.
-- Devuelve {id, added}.
create function public.add_shopping_item(
  p_house_id uuid,
  p_name text default null,
  p_product_id uuid default null,
  p_quantity_text text default null,
  p_preferred_brand text default null,
  p_origin public.shopping_origin default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_name text := left(nullif(btrim(p_name), ''), 80);
  v_existing uuid;
  v_id uuid;
begin
  perform private.assert_member(p_house_id);

  if p_product_id is not null then
    select * into v_product from public.products where id = p_product_id and house_id = p_house_id;
    if not found then
      raise exception 'not_found';
    end if;
  elsif v_name is not null then
    select * into v_product
    from public.products
    where house_id = p_house_id and kind = 'food' and name_normalized = private.normalize_name(v_name);
  end if;

  v_name := coalesce(v_name, v_product.name);
  if v_name is null then
    raise exception 'invalid_input';
  end if;

  -- Dos personas añadiendo lo mismo a la vez no lo duplican.
  perform pg_advisory_xact_lock(hashtextextended('shopping:' || p_house_id::text, 0));

  select id into v_existing
  from public.shopping_items
  where house_id = p_house_id
    and not checked
    and (
      (v_product.id is not null and product_id = v_product.id)
      or private.normalize_name(name) = private.normalize_name(v_name)
    )
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'added', false);
  end if;

  insert into public.shopping_items (house_id, product_id, name, quantity_text, preferred_brand, origin)
  values (
    p_house_id,
    v_product.id,
    v_name,
    left(nullif(btrim(p_quantity_text), ''), 40),
    left(coalesce(nullif(btrim(p_preferred_brand), ''), v_product.preferred_brand), 80),
    p_origin
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'added', true);
end;
$$;

-- Edita los campos presentes en p_patch: name, quantity_text, preferred_brand y checked.
create function public.update_shopping_item(p_item_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.shopping_items;
  v_name text := left(nullif(btrim(p_patch ->> 'name'), ''), 80);
begin
  select * into v_item from public.shopping_items where id = p_item_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.assert_member(v_item.house_id);

  if p_patch ? 'name' and v_name is null then
    raise exception 'invalid_input';
  end if;

  update public.shopping_items
  set name = coalesce(v_name, name),
      quantity_text = case when p_patch ? 'quantity_text' then left(nullif(btrim(p_patch ->> 'quantity_text'), ''), 40) else quantity_text end,
      preferred_brand = case when p_patch ? 'preferred_brand' then left(nullif(btrim(p_patch ->> 'preferred_brand'), ''), 80) else preferred_brand end,
      checked = case when p_patch ? 'checked' then coalesce((p_patch ->> 'checked')::boolean, false) else checked end,
      checked_at = case
        when not p_patch ? 'checked' then checked_at
        when coalesce((p_patch ->> 'checked')::boolean, false) then coalesce(checked_at, now())
      end
  where id = p_item_id;
end;
$$;

create function public.delete_shopping_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house_id uuid;
begin
  select house_id into v_house_id from public.shopping_items where id = p_item_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.assert_member(v_house_id);
  delete from public.shopping_items where id = p_item_id;
end;
$$;

-- "Borrar comprados". Devuelve cuántos se han borrado.
create function public.clear_checked_shopping(p_house_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.assert_member(p_house_id);
  delete from public.shopping_items where house_id = p_house_id and checked;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Al aplicar un ticket, lo que se ha comprado se tacha: por producto o, si el elemento no tiene
-- producto, por nombre. Devuelve los ids tachados, para que Deshacer los vuelva a dejar como estaban.
create function private.check_bought_shopping(p_house_id uuid, p_product_ids uuid[])
returns jsonb
language sql
set search_path = ''
as $$
  with bought as (
    update public.shopping_items s
    set checked = true, checked_at = now()
    where s.house_id = p_house_id
      and not s.checked
      and (
        s.product_id = any (p_product_ids)
        or (
          s.product_id is null
          and private.normalize_name(s.name) in (
            select p.name_normalized from public.products p where p.id = any (p_product_ids)
          )
        )
      )
    returning s.id
  )
  select coalesce(jsonb_agg(to_jsonb(id::text)), '[]'::jsonb) from bought;
$$;

---------------------------------------------------------------------------------------------------
-- Ticket: tacha lo comprado; Deshacer lo vuelve a dejar pendiente
---------------------------------------------------------------------------------------------------

create or replace function public.apply_ticket(
  p_house_id uuid,
  p_lines jsonb,
  p_purchased_at date default null,
  p_store text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_zone public.zones;
  v_result jsonb;
  v_product public.products;
  v_undo jsonb := private.new_undo(null::public.products);
  v_items jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_written jsonb := '[]'::jsonb;
  v_previous jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_key text;
  v_brand text;
  v_alias public.ticket_aliases;
  v_lot_ids uuid[];
  v_bought jsonb;
  v_movement_id uuid;
  v_today date := private.user_today();
  v_purchased date := coalesce(p_purchased_at, private.user_today());
  v_store text := left(nullif(btrim(p_store), ''), 80);
begin
  perform private.assert_member(p_house_id);

  if p_lines is null
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0
    or jsonb_array_length(p_lines) > 100
    or v_purchased > v_today
  then
    raise exception 'invalid_input';
  end if;

  -- Dos tickets a la vez en la misma casa van uno detrás de otro: así no se bloquean entre sí.
  perform pg_advisory_xact_lock(hashtextextended('ticket:' || p_house_id::text, 0));

  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin
      select * into v_zone
      from public.zones
      where house_id = p_house_id and kind = (v_line ->> 'zone')::public.zone_kind;
      if not found then
        raise exception 'invalid_input';
      end if;

      v_result := private.add_lot_internal(
        p_house_id,
        v_zone,
        (v_line ->> 'quantity')::numeric,
        (v_line ->> 'product_id')::uuid,
        (v_line ->> 'catalog_item_id')::uuid,
        v_line ->> 'name',
        (v_line ->> 'category')::public.category,
        (v_line ->> 'quantity_kind')::public.quantity_kind,
        v_line ->> 'unit_label',
        (v_line ->> 'content_amount')::numeric,
        (v_line ->> 'content_unit')::public.amount_unit,
        (v_line ->> 'bulk_unit')::public.amount_unit,
        v_line ->> 'brand',
        (v_line ->> 'printed_date')::date,
        (v_line ->> 'printed_date_type')::public.printed_date_type,
        v_purchased,
        -- Lo que va al congelador se congela el día de la compra, salvo que se diga otra cosa.
        coalesce((v_line ->> 'frozen_at')::date, v_purchased),
        (v_line ->> 'reminder_date')::date,
        'ticket',
        v_line ->> 'barcode',
        v_line ->> 'image_url',
        v_undo
      );
    exception
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
        or numeric_value_out_of_range or check_violation or string_data_right_truncation then
        raise exception 'invalid_input';
    end;

    v_undo := v_result -> 'undo';
    select * into v_product from public.products where id = (v_result ->> 'product_id')::uuid;
    v_products := v_products || to_jsonb(v_product.id::text);
    v_items := v_items || jsonb_build_object(
      'name', v_product.name,
      'catalog_item_id', case when v_product.name_customized then null else v_product.catalog_item_id end,
      'amount', (v_line ->> 'quantity')::numeric,
      'zone', v_zone.kind,
      'quantity_kind', v_product.quantity_kind,
      'unit_label', v_product.unit_label,
      'bulk_unit', v_product.bulk_unit
    );

    -- La próxima vez, esta línea del ticket se empareja sola.
    v_key := left(private.normalize_ticket_text(left(v_line ->> 'raw_text', 200)), 120);
    if v_key is not null then
      v_brand := left(nullif(btrim(v_line ->> 'brand'), ''), 80);
      if not v_key = any (v_seen) then
        v_seen := v_seen || v_key;
        select * into v_alias
        from public.ticket_aliases
        where house_id = p_house_id and raw_text_normalized = v_key
        for update;
        if found then
          v_previous := v_previous || to_jsonb(v_alias);
        end if;
      end if;

      insert into public.ticket_aliases (house_id, raw_text_normalized, product_id, brand)
      values (p_house_id, v_key, v_product.id, v_brand)
      on conflict (house_id, raw_text_normalized)
      do update set product_id = excluded.product_id, brand = excluded.brand;

      v_written := v_written || jsonb_build_object('key', v_key, 'product_id', v_product.id, 'brand', v_brand);
    end if;
  end loop;

  -- Lo comprado se tacha de la lista de la compra (SPEC §13).
  v_bought := private.check_bought_shopping(
    p_house_id,
    array(select value::uuid from jsonb_array_elements_text(v_products))
  );

  select coalesce(array_agg(distinct id::uuid), '{}')
  into v_lot_ids
  from (
    select jsonb_object_keys(v_undo -> 'lots') as id
    union all
    select jsonb_array_elements_text(v_undo -> 'created_lots')
  ) touched;

  v_undo := v_undo || jsonb_build_object(
    'locked_products', v_products,
    'aliases', jsonb_build_object('written', v_written, 'previous', v_previous),
    'shopping_checked', v_bought
  );

  -- Sin user_id (SPEC, principio 5). El nombre de la tienda ocupa el lugar del producto.
  insert into public.movements (house_id, type, product_id, product_name, catalog_item_id, details, lot_ids, undo_state)
  values (
    p_house_id,
    'ticket_applied',
    null,
    coalesce(v_store, ''),
    null,
    jsonb_build_object('store', v_store, 'count', jsonb_array_length(v_items), 'items', v_items, 'shopping_checked', jsonb_array_length(v_bought)),
    v_lot_ids,
    v_undo
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;


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
     or id in (select value::uuid from jsonb_array_elements_text(coalesce(v_undo -> 'locked_products', '[]'::jsonb)))
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

    if v_undo ? 'aliases' then
      delete from public.ticket_aliases a
      using jsonb_to_recordset(v_undo -> 'aliases' -> 'written') as w (key text, product_id uuid, brand text)
      where a.house_id = v_movement.house_id
        and a.raw_text_normalized = w.key
        and a.product_id = w.product_id
        and a.brand is not distinct from w.brand;

      insert into public.ticket_aliases (id, house_id, raw_text_normalized, product_id, brand, created_at, updated_at)
      select r.id, r.house_id, r.raw_text_normalized, r.product_id, r.brand, r.created_at, r.updated_at
      from jsonb_populate_recordset(null::public.ticket_aliases, v_undo -> 'aliases' -> 'previous') r
      where exists (select 1 from public.products p where p.id = r.product_id)
      on conflict do nothing;
    end if;

    -- Lo que el ticket tachó de la lista vuelve a estar pendiente.
    if v_undo ? 'shopping_checked' then
      update public.shopping_items
      set checked = false, checked_at = null
      where id in (select value::uuid from jsonb_array_elements_text(v_undo -> 'shopping_checked'))
        and checked;
    end if;

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
-- Mis datos: también la lista de la compra
---------------------------------------------------------------------------------------------------

create or replace function public.export_my_data()
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
            'ticket_aliases', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.ticket_aliases t where t.house_id = h.id), '[]'::jsonb),
            'shopping_items', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.shopping_items t where t.house_id = h.id), '[]'::jsonb),
            'product_barcodes', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.product_barcodes t where t.house_id = h.id), '[]'::jsonb),
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


---------------------------------------------------------------------------------------------------
-- Permisos
---------------------------------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;

-- Las usan las políticas de acceso y las vistas, que se ejecutan como el usuario.
grant execute on function private.is_house_member(uuid) to authenticated;
grant execute on function private.is_house_owner(uuid) to authenticated;
grant execute on function private.compute_effective(date, public.printed_date_type, date, date, date, boolean, boolean) to authenticated;
grant execute on function private.can_see_photo(text) to authenticated;

revoke all on function public.add_shopping_item(uuid, text, uuid, text, text, public.shopping_origin) from public, anon;
revoke all on function public.update_shopping_item(uuid, jsonb) from public, anon;
revoke all on function public.delete_shopping_item(uuid) from public, anon;
revoke all on function public.clear_checked_shopping(uuid) from public, anon;
revoke all on function public.apply_ticket(uuid, jsonb, date, text) from public, anon;
revoke all on function public.undo_movement(uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;

grant execute on function public.add_shopping_item(uuid, text, uuid, text, text, public.shopping_origin) to authenticated;
grant execute on function public.update_shopping_item(uuid, jsonb) to authenticated;
grant execute on function public.delete_shopping_item(uuid) to authenticated;
grant execute on function public.clear_checked_shopping(uuid) to authenticated;
grant execute on function public.apply_ticket(uuid, jsonb, date, text) to authenticated;
grant execute on function public.undo_movement(uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
