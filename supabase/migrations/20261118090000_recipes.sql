-- Fase 7: recetas con IA (SPEC §14).
-- Favoritos y recetas bloqueadas son de cada persona y se ven desde todas sus casas. "He cocinado
-- esto" descuenta del inventario y, si han sobrado raciones, guarda un táper: todo en un único
-- movimiento, que se deshace entero.

---------------------------------------------------------------------------------------------------
-- Preferencias: texto libre, con un límite razonable (va a cada petición de recetas)
---------------------------------------------------------------------------------------------------

alter table public.profiles
  add constraint profiles_recipe_preferences_length check (char_length(recipe_preferences) <= 500);

---------------------------------------------------------------------------------------------------
-- Favoritos y recetas que no se quieren volver a ver
---------------------------------------------------------------------------------------------------

create table public.recipe_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Dónde se guardó. Es personal: sigue visible aunque la persona deje esa casa.
  house_id uuid references public.houses (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  title_normalized text not null,
  recipe jsonb not null check (jsonb_typeof(recipe) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, title_normalized)
);

create index recipe_favorites_user_created_idx on public.recipe_favorites (user_id, created_at desc);

create table public.recipe_blocked (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  title_normalized text not null,
  created_at timestamptz not null default now(),
  unique (user_id, title_normalized)
);

alter table public.recipe_favorites enable row level security;
alter table public.recipe_blocked enable row level security;

create policy "recipe_favorites_select_own" on public.recipe_favorites
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recipe_blocked_select_own" on public.recipe_blocked
for select to authenticated
using ((select auth.uid()) = user_id);

-- Se leen directamente; se escriben solo con las funciones de abajo.
revoke all on public.recipe_favorites from anon, authenticated;
revoke all on public.recipe_blocked from anon, authenticated;
grant select on public.recipe_favorites to authenticated;
grant select on public.recipe_blocked to authenticated;

-- Título limpio: sin espacios de más, como mucho 120 caracteres.
create function private.clean_title(p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')), ''), 120);
$$;

-- Guardar como favorita. La misma receta (mismo título) no se repite: se queda la última versión.
create function public.save_recipe_favorite(p_house_id uuid, p_recipe jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_title text := private.clean_title(p_recipe ->> 'title');
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  perform private.assert_member(p_house_id);
  if p_recipe is null or jsonb_typeof(p_recipe) <> 'object' or v_title is null or octet_length(p_recipe::text) > 32768 then
    raise exception 'invalid_input';
  end if;

  insert into public.recipe_favorites (user_id, house_id, title, title_normalized, recipe)
  values (v_user_id, p_house_id, v_title, private.normalize_name(v_title), p_recipe)
  on conflict (user_id, title_normalized)
  do update set title = excluded.title, recipe = excluded.recipe, house_id = excluded.house_id
  returning id into v_id;

  return v_id;
end;
$$;

create function public.delete_recipe_favorite(p_favorite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.recipe_favorites where id = p_favorite_id and user_id = (select auth.uid());
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

-- "No me la vuelvas a sugerir".
create function public.block_recipe(p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_title text := private.clean_title(p_title);
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if v_title is null then
    raise exception 'invalid_input';
  end if;

  insert into public.recipe_blocked (user_id, title, title_normalized)
  values (v_user_id, v_title, private.normalize_name(v_title))
  on conflict (user_id, title_normalized) do update set title = excluded.title
  returning id into v_id;

  return v_id;
end;
$$;

create function public.unblock_recipe(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.recipe_blocked where id = p_blocked_id and user_id = (select auth.uid());
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Límite diario: 20 sugerencias de recetas por persona
---------------------------------------------------------------------------------------------------

alter table private.ai_usage drop constraint ai_usage_kind_check;
alter table private.ai_usage add constraint ai_usage_kind_check check (kind in ('receipt', 'date', 'product', 'recipe'));

create or replace function public.claim_ai_use(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_today date := private.user_today();
  v_limit integer := case p_kind when 'receipt' then 20 when 'date' then 150 when 'product' then 100 when 'recipe' then 20 end;
  v_count integer;
begin
  if v_user_id is null or v_limit is null then
    raise exception 'invalid_input';
  end if;

  delete from private.ai_usage where user_id = v_user_id and day < v_today - 30;

  insert into private.ai_usage (user_id, day, kind, count)
  values (v_user_id, v_today, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = private.ai_usage.count + 1
  returning count into v_count;

  return v_count <= v_limit;
end;
$$;

---------------------------------------------------------------------------------------------------
-- He cocinado esto
---------------------------------------------------------------------------------------------------

-- Descuenta lo que ha usado una receta de un producto ya bloqueado, por fecha (FEFO). La cantidad va
-- en la unidad del producto; en los envases (`divisible`) puede ser una parte: 0,2 bricks de 1 l son
-- 200 ml. Primero se gasta lo abierto y, si hace falta una parte de un envase cerrado, se abre.
-- Si hay menos de lo pedido, se gasta lo que hay. Devuelve el estado para deshacer y lo gastado.
create function private.take_for_recipe(p_undo jsonb, p_product public.products, p_amount numeric)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_undo jsonb := p_undo;
  v_left numeric := p_amount;
  v_taken numeric := 0;
  v_take numeric;
  v_lot_id uuid;
  v_quantity numeric;
  v_unit_id uuid;
  v_fraction numeric;
  v_today date := private.user_today();
begin
  -- Un táper se borra con su último lote: se guarda para poder deshacer.
  if p_product.kind = 'cooked_dish' then
    v_undo := jsonb_set(v_undo, array['products', p_product.id::text], to_jsonb(p_product));
  end if;

  if p_product.quantity_kind = 'divisible' then
    -- Un resto de redondeo no abre un envase nuevo.
    while v_left >= 0.001 loop
      select u.id, u.lot_id, u.remaining_fraction
      into v_unit_id, v_lot_id, v_fraction
      from public.opened_units_with_dates u
      join public.lots l on l.id = u.lot_id
      where l.product_id = p_product.id
      order by u.effective_date asc nulls last, u.remaining_fraction, u.opened_at, u.id
      limit 1;

      if found then
        v_take := least(v_left, v_fraction);
        v_undo := private.capture_lot(v_undo, v_lot_id);
        -- Lo que quedaría es tan poco que se da por terminado.
        if v_fraction - v_take <= 0.001 then
          delete from public.opened_units where id = v_unit_id;
          perform private.drop_lot_if_empty(v_lot_id);
        else
          update public.opened_units set remaining_fraction = remaining_fraction - v_take where id = v_unit_id;
        end if;
        v_taken := v_taken + v_take;
        v_left := v_left - v_take;
        continue;
      end if;

      select l.id, l.quantity
      into v_lot_id, v_quantity
      from public.lots_with_dates l
      where l.product_id = p_product.id
        and l.quantity > 0
      order by l.effective_date asc nulls last, l.created_at, l.id
      limit 1;

      exit when not found;

      v_undo := private.capture_lot(v_undo, v_lot_id);
      if v_left >= 0.999 then
        -- Envases enteros.
        v_take := least(greatest(trunc(v_left + 0.001), 1), v_quantity);
        update public.lots set quantity = quantity - v_take where id = v_lot_id;
        perform private.drop_lot_if_empty(v_lot_id);
      else
        -- Se abre un envase y queda abierto con lo que no se ha usado.
        v_take := v_left;
        update public.lots set quantity = quantity - 1 where id = v_lot_id;
        insert into public.opened_units (house_id, lot_id, opened_at, remaining_fraction)
        values (p_product.house_id, v_lot_id, v_today, 1 - v_take);
      end if;
      v_taken := v_taken + v_take;
      v_left := v_left - v_take;
    end loop;
  else
    for v_lot_id, v_quantity in
      select l.id, l.quantity
      from public.lots_with_dates l
      where l.product_id = p_product.id
        and l.quantity > 0
      -- Lo ya abierto se termina antes de empezar lo cerrado.
      order by (l.opened_at is null), l.effective_date asc nulls last, l.created_at, l.id
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_quantity);
      v_undo := private.capture_lot(v_undo, v_lot_id);
      update public.lots set quantity = quantity - v_take where id = v_lot_id;
      perform private.drop_lot_if_empty(v_lot_id);
      v_taken := v_taken + v_take;
      v_left := v_left - v_take;
    end loop;
  end if;

  return jsonb_build_object('undo', v_undo, 'taken', v_taken);
end;
$$;

-- p_items: [{ product_id, amount }], lo confirmado en la vista previa.
-- p_dish (opcional): { servings, zone, reminder_date?, container_number?, name? }, el táper con lo que ha sobrado.
create function public.cook_recipe(
  p_house_id uuid,
  p_title text,
  p_items jsonb,
  p_dish jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := private.clean_title(p_title);
  v_items jsonb;
  v_ids uuid[];
  v_item record;
  v_product public.products;
  v_result jsonb;
  v_undo jsonb := private.new_undo(null::public.products);
  v_used jsonb := '[]'::jsonb;
  v_dish jsonb := case when jsonb_typeof(p_dish) = 'object' then p_dish end;
  v_zone public.zones;
  v_servings numeric;
  v_reminder date;
  v_number integer;
  v_dish_name text;
  v_dish_product public.products;
  v_dish_lot_id uuid;
  v_lot_ids uuid[];
  v_movement_id uuid;
  v_today date := private.user_today();
begin
  perform private.assert_member(p_house_id);

  if v_title is null
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 40
    or (p_dish is not null and jsonb_typeof(p_dish) not in ('object', 'null'))
  then
    raise exception 'invalid_input';
  end if;

  -- El mismo producto en dos líneas se suma. Se procesa en el orden de la receta, que es el que
  -- se ve en el historial; los bloqueos, en cambio, van por id.
  begin
    select
      coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'amount', amount) order by position), '[]'::jsonb),
      coalesce(array_agg(product_id order by product_id), '{}')
    into v_items, v_ids
    from (
      select (value ->> 'product_id')::uuid as product_id, sum((value ->> 'amount')::numeric) as amount, min(position) as position
      from jsonb_array_elements(p_items) with ordinality as line (value, position)
      group by 1
    ) grouped;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_input';
  end;

  if exists (
    select 1
    from jsonb_array_elements(v_items) e
    where e.value ->> 'product_id' is null
      or e.value ->> 'amount' is null
      or (e.value ->> 'amount')::numeric <= 0
      or (e.value ->> 'amount')::numeric > 100000
  ) then
    raise exception 'invalid_amount';
  end if;

  if jsonb_array_length(v_items) = 0 and v_dish is null then
    raise exception 'invalid_input';
  end if;

  -- Se bloquean siempre en el mismo orden: dos operaciones a la vez no se esperan mutuamente.
  perform 1 from public.products where id = any (v_ids) and house_id = p_house_id order by id for update;
  if (select count(*) from public.products where id = any (v_ids) and house_id = p_house_id) <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'not_found';
  end if;

  for v_item in
    select (value ->> 'product_id')::uuid as product_id, (value ->> 'amount')::numeric as amount
    from jsonb_array_elements(v_items)
  loop
    select * into v_product from public.products where id = v_item.product_id;
    v_result := private.take_for_recipe(v_undo, v_product, v_item.amount);
    v_undo := v_result -> 'undo';
    if (v_result ->> 'taken')::numeric > 0 then
      v_used := v_used || jsonb_build_object(
        'name', v_product.name,
        'catalog_item_id', case when v_product.name_customized then null else v_product.catalog_item_id end,
        'amount', round((v_result ->> 'taken')::numeric, 3),
        'kind', v_product.kind,
        'quantity_kind', v_product.quantity_kind,
        'unit_label', v_product.unit_label,
        'bulk_unit', v_product.bulk_unit,
        'content_amount', v_product.content_amount,
        'content_unit', v_product.content_unit
      );
    end if;
  end loop;

  if v_dish is not null then
    begin
      v_servings := (v_dish ->> 'servings')::numeric;
      v_reminder := (v_dish ->> 'reminder_date')::date;
      v_number := (v_dish ->> 'container_number')::integer;
      select * into v_zone
      from public.zones
      where house_id = p_house_id and kind = (v_dish ->> 'zone')::public.zone_kind;
    exception
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        raise exception 'invalid_input';
    end;
    if v_zone.id is null or (v_number is not null and v_number < 1) then
      raise exception 'invalid_input';
    end if;
    if v_servings is null or v_servings <= 0 or v_servings > 99 then
      raise exception 'invalid_amount';
    end if;
    v_dish_name := coalesce(left(private.clean_title(v_dish ->> 'name'), 80), left(v_title, 80));

    perform private.lock_containers(p_house_id);
    v_number := coalesce(v_number, private.lowest_free_container(p_house_id));

    insert into public.products (house_id, name, category, kind, quantity_kind, unit_label)
    values (p_house_id, v_dish_name, 'cooked', 'cooked_dish', 'count', 'serving')
    returning * into v_dish_product;

    begin
      insert into public.lots (
        house_id, zone_id, product_id, quantity, cooked_at, frozen_at, reminder_date, container_number, source
      )
      values (
        p_house_id,
        v_zone.id,
        v_dish_product.id,
        v_servings,
        v_today,
        case when v_zone.kind = 'freezer' then v_today end,
        v_reminder,
        v_number,
        'recipe'
      )
      returning id into v_dish_lot_id;
    exception
      when unique_violation then
        raise exception 'container_number_taken';
    end;

    v_undo := private.undo_append(v_undo, 'created_lots', v_dish_lot_id);
    v_undo := private.undo_append(v_undo, 'created_products', v_dish_product.id);
  end if;

  if jsonb_array_length(v_used) = 0 and v_dish_product.id is null then
    raise exception 'nothing_to_consume';
  end if;

  select coalesce(array_agg(distinct id::uuid), '{}')
  into v_lot_ids
  from (
    select jsonb_object_keys(v_undo -> 'lots') as id
    union all
    select jsonb_array_elements_text(v_undo -> 'created_lots')
  ) touched;

  v_undo := v_undo || jsonb_build_object('locked_products', to_jsonb(v_ids));

  -- Un solo movimiento "cooked" con la receta, lo gastado y el táper. Sin user_id (principio 5).
  insert into public.movements (house_id, type, product_id, product_name, catalog_item_id, details, lot_ids, undo_state)
  values (
    p_house_id,
    'cooked',
    v_dish_product.id,
    v_title,
    null,
    jsonb_build_object(
      'recipe', v_title,
      'used', v_used,
      'dish', case
        when v_dish_product.id is not null
          then jsonb_build_object('servings', v_servings, 'zone', v_zone.kind, 'container_number', v_number)
      end,
      'kind', 'cooked_dish',
      'quantity_kind', 'count',
      'unit_label', 'serving',
      'bulk_unit', null
    ),
    v_lot_ids,
    v_undo
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Mis datos: también los favoritos y las recetas bloqueadas
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
    'recipe_favorites', coalesce(
      (select jsonb_agg(to_jsonb(t) - 'user_id' order by t.created_at) from public.recipe_favorites t where t.user_id = v_user_id),
      '[]'::jsonb
    ),
    'recipe_blocked', coalesce(
      (select jsonb_agg(to_jsonb(t) - 'user_id' order by t.created_at) from public.recipe_blocked t where t.user_id = v_user_id),
      '[]'::jsonb
    ),
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

revoke all on function public.save_recipe_favorite(uuid, jsonb) from public, anon;
revoke all on function public.delete_recipe_favorite(uuid) from public, anon;
revoke all on function public.block_recipe(text) from public, anon;
revoke all on function public.unblock_recipe(uuid) from public, anon;
revoke all on function public.claim_ai_use(text) from public, anon;
revoke all on function public.cook_recipe(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function private.take_for_recipe(jsonb, public.products, numeric) from public, anon, authenticated;
revoke all on function private.clean_title(text) from public, anon, authenticated;

grant execute on function public.save_recipe_favorite(uuid, jsonb) to authenticated;
grant execute on function public.delete_recipe_favorite(uuid) to authenticated;
grant execute on function public.block_recipe(text) to authenticated;
grant execute on function public.unblock_recipe(uuid) to authenticated;
grant execute on function public.claim_ai_use(text) to authenticated;
grant execute on function public.cook_recipe(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.export_my_data() to authenticated;
