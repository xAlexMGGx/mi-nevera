-- Fase 1: operaciones atómicas del inventario (SPEC §5.7).
-- Todas validan la pertenencia a la casa y bloquean la fila del producto, de modo que dos
-- personas que actúan a la vez sobre el mismo producto se ejecutan una detrás de otra.
-- Los errores usan como mensaje un código que el cliente traduce.

---------------------------------------------------------------------------------------------------
-- Ayudantes
---------------------------------------------------------------------------------------------------

create function private.assert_member(p_house_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_house_member(p_house_id) then
    raise exception 'not_member';
  end if;
end;
$$;

create function private.user_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (
    now() at time zone coalesce(
      (select timezone from public.profiles where id = (select auth.uid())),
      'Europe/Madrid'
    )
  )::date;
$$;

create function private.lock_product(p_product_id uuid)
returns public.products
language plpgsql
set search_path = ''
as $$
declare
  v_house_id uuid;
  v_product public.products;
begin
  select house_id into v_house_id from public.products where id = p_product_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.assert_member(v_house_id);

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  return v_product;
end;
$$;

create function private.lock_lot(p_lot_id uuid)
returns public.lots
language plpgsql
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_lot public.lots;
begin
  select product_id into v_product_id from public.lots where id = p_lot_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform private.lock_product(v_product_id);

  -- Se relee tras el bloqueo: otra operación pudo cambiarlo mientras se esperaba.
  select * into v_lot from public.lots where id = p_lot_id;
  if not found then
    raise exception 'not_found';
  end if;
  return v_lot;
end;
$$;

create function private.assert_amount(p_product public.products, p_amount numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  if p_product.quantity_kind = 'divisible' and p_amount <> trunc(p_amount) then
    raise exception 'invalid_amount';
  end if;
end;
$$;

-- Estado previo para deshacer. Un táper se borra con su último lote, así que se guarda también.
create function private.new_undo(p_product public.products)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'lots', '{}'::jsonb,
    'created_lots', '[]'::jsonb,
    'products', case
      when p_product.id is not null and p_product.kind = 'cooked_dish'
        then jsonb_build_object(p_product.id::text, to_jsonb(p_product))
      else '{}'::jsonb
    end,
    'created_products', '[]'::jsonb,
    'created_samples', '[]'::jsonb
  );
$$;

-- Guarda el estado de un lote la primera vez que se toca en esta operación.
create function private.capture_lot(p_undo jsonb, p_lot_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  if (p_undo -> 'lots') ? p_lot_id::text then
    return p_undo;
  end if;

  select jsonb_build_object(
    'lot', to_jsonb(l),
    'units', coalesce(
      (select jsonb_agg(to_jsonb(u)) from public.opened_units u where u.lot_id = l.id),
      '[]'::jsonb
    )
  )
  into v_snapshot
  from public.lots l
  where l.id = p_lot_id;

  if v_snapshot is null then
    return p_undo;
  end if;
  return jsonb_set(p_undo, array['lots', p_lot_id::text], v_snapshot);
end;
$$;

create function private.undo_append(p_undo jsonb, p_key text, p_id uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(p_undo, array[p_key], (p_undo -> p_key) || to_jsonb(p_id::text));
$$;

create function private.log_movement(
  p_type public.movement_type,
  p_product public.products,
  p_details jsonb,
  p_undo jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lot_ids uuid[];
  v_movement_id uuid;
begin
  select coalesce(array_agg(distinct id::uuid), '{}')
  into v_lot_ids
  from (
    select jsonb_object_keys(p_undo -> 'lots') as id
    union all
    select jsonb_array_elements_text(p_undo -> 'created_lots')
  ) touched;

  insert into public.movements (
    house_id, type, product_id, product_name, catalog_item_id, details, lot_ids, undo_state
  )
  values (
    p_product.house_id,
    p_type,
    -- Un táper ya puede haberse borrado con su último lote.
    (select id from public.products where id = p_product.id),
    p_product.name,
    case when p_product.name_customized then null else p_product.catalog_item_id end,
    p_details || jsonb_build_object(
      'kind', p_product.kind,
      'quantity_kind', p_product.quantity_kind,
      'unit_label', p_product.unit_label,
      'bulk_unit', p_product.bulk_unit
    ),
    v_lot_ids,
    p_undo
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

-- Un lote sin cantidad ni unidades abiertas se elimina, y un táper desaparece con él.
create function private.drop_lot_if_empty(p_lot_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  delete from public.lots l
  where l.id = p_lot_id
    and l.quantity <= 0
    and not exists (select 1 from public.opened_units u where u.lot_id = l.id)
  returning l.product_id into v_product_id;

  if v_product_id is not null then
    delete from public.products p
    where p.id = v_product_id
      and p.kind = 'cooked_dish'
      and not exists (select 1 from public.lots l where l.product_id = p.id);
  end if;
end;
$$;

-- Un lote es "misma fecha, marca y zona" (SPEC §4): si ya existe otro igual, se fusionan.
create function private.find_twin(p_lot public.lots)
returns uuid
language sql
stable
set search_path = ''
as $$
  select l.id
  from public.lots l
  where l.product_id = p_lot.product_id
    and l.zone_id = p_lot.zone_id
    and l.id <> p_lot.id
    and l.cooked_at is null
    and p_lot.cooked_at is null
    and l.printed_date is not distinct from p_lot.printed_date
    and l.printed_date_type is not distinct from p_lot.printed_date_type
    and lower(l.brand) is not distinct from lower(p_lot.brand)
    and l.frozen_at is not distinct from p_lot.frozen_at
    and l.thawed_at is not distinct from p_lot.thawed_at
    and l.opened_at is not distinct from p_lot.opened_at
    and l.reminder_date is not distinct from p_lot.reminder_date
  order by l.created_at, l.id
  limit 1;
$$;

create function private.merge_twin(p_undo jsonb, p_lot_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lot public.lots;
  v_twin_id uuid;
  v_undo jsonb := p_undo;
begin
  select * into v_lot from public.lots where id = p_lot_id;
  if not found then
    return v_undo;
  end if;

  v_twin_id := private.find_twin(v_lot);
  if v_twin_id is null then
    return v_undo;
  end if;

  v_undo := private.capture_lot(v_undo, v_twin_id);

  update public.lots
  set quantity = quantity + v_lot.quantity,
      purchased_at = least(purchased_at, v_lot.purchased_at),
      barcode = coalesce(barcode, v_lot.barcode),
      image_url = coalesce(image_url, v_lot.image_url)
  where id = v_twin_id;

  update public.opened_units set lot_id = v_twin_id where lot_id = p_lot_id;
  delete from public.lots where id = p_lot_id;

  return v_undo;
end;
$$;

create function private.lowest_free_container(p_house_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select n::integer
  from generate_series(
    1,
    (select count(*) + 1 from public.lots where house_id = p_house_id and container_number is not null)
  ) n
  where not exists (
    select 1 from public.lots l where l.house_id = p_house_id and l.container_number = n
  )
  order by n
  limit 1;
$$;

-- Evita que dos tápers creados a la vez reciban el mismo número.
create function private.lock_containers(p_house_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(p_house_id::text, 0));
$$;

---------------------------------------------------------------------------------------------------
-- Añadir
---------------------------------------------------------------------------------------------------

create function public.add_lot(
  p_house_id uuid,
  p_zone_id uuid,
  p_quantity numeric,
  p_product_id uuid default null,
  p_catalog_item_id uuid default null,
  p_name text default null,
  p_category public.category default null,
  p_quantity_kind public.quantity_kind default null,
  p_unit_label text default null,
  p_content_amount numeric default null,
  p_content_unit public.amount_unit default null,
  p_bulk_unit public.amount_unit default null,
  p_brand text default null,
  p_printed_date date default null,
  p_printed_date_type public.printed_date_type default null,
  p_purchased_at date default null,
  p_frozen_at date default null,
  p_reminder_date date default null,
  p_source public.lot_source default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.zones;
  v_catalog public.catalog_items;
  v_product public.products;
  v_lot public.lots;
  v_name text;
  v_locale text;
  v_twin_id uuid;
  v_sample_id uuid;
  v_created_product boolean := false;
  v_today date := private.user_today();
  v_undo jsonb;
begin
  perform private.assert_member(p_house_id);

  select * into v_zone from public.zones where id = p_zone_id and house_id = p_house_id;
  if not found then
    raise exception 'not_found';
  end if;

  if p_product_id is not null then
    select * into v_product
    from public.products
    where id = p_product_id and house_id = p_house_id
    for update;
    if not found then
      raise exception 'not_found';
    end if;
  else
    if p_catalog_item_id is not null then
      select * into v_catalog from public.catalog_items where id = p_catalog_item_id;
      if not found then
        raise exception 'not_found';
      end if;
      select locale into v_locale from public.profiles where id = (select auth.uid());
      v_name := case when v_locale = 'en' then v_catalog.name_en else v_catalog.name_es end;
    else
      v_name := nullif(btrim(p_name), '');
      if v_name is null then
        raise exception 'invalid_input';
      end if;
    end if;

    select * into v_product
    from public.products p
    where p.house_id = p_house_id
      and p.kind = 'food'
      and (
        p.catalog_item_id = p_catalog_item_id
        or p.name_normalized = private.normalize_name(v_name)
      )
    order by (p.catalog_item_id is not distinct from p_catalog_item_id) desc
    limit 1
    for update;

    if not found then
      insert into public.products (
        house_id, catalog_item_id, name, category, icon, quantity_kind, unit_label,
        content_amount, content_unit, bulk_unit
      )
      values (
        p_house_id,
        p_catalog_item_id,
        v_name,
        coalesce(p_category, v_catalog.category, 'other'),
        v_catalog.icon,
        coalesce(p_quantity_kind, v_catalog.default_quantity_kind, 'count'),
        coalesce(p_unit_label, v_catalog.default_unit_label, 'unit'),
        coalesce(p_content_amount, v_catalog.default_content_amount),
        coalesce(p_content_unit, v_catalog.default_content_unit),
        case
          when coalesce(p_quantity_kind, v_catalog.default_quantity_kind) = 'bulk'
            then coalesce(p_bulk_unit, v_catalog.default_content_unit)
        end
      )
      on conflict do nothing
      returning * into v_product;

      if found then
        v_created_product := true;
      else
        -- Otra persona lo acaba de crear con el mismo nombre.
        select * into v_product
        from public.products p
        where p.house_id = p_house_id
          and p.kind = 'food'
          and p.name_normalized = private.normalize_name(v_name)
        for update;
        if not found then
          raise exception 'not_found';
        end if;
      end if;
    end if;
  end if;

  perform private.assert_amount(v_product, p_quantity);

  v_undo := private.new_undo(v_product);
  if v_created_product then
    v_undo := private.undo_append(v_undo, 'created_products', v_product.id);
  end if;

  v_lot.id := gen_random_uuid();
  v_lot.house_id := p_house_id;
  v_lot.zone_id := p_zone_id;
  v_lot.product_id := v_product.id;
  v_lot.quantity := p_quantity;
  v_lot.brand := nullif(btrim(p_brand), '');
  v_lot.printed_date := p_printed_date;
  v_lot.printed_date_type := p_printed_date_type;
  v_lot.purchased_at := coalesce(p_purchased_at, v_today);
  -- Lo que entra en el congelador cuenta siempre como congelado.
  v_lot.frozen_at := case when v_zone.kind = 'freezer' then coalesce(p_frozen_at, v_today) end;
  v_lot.reminder_date := case when v_zone.kind = 'freezer' then p_reminder_date end;
  v_lot.source := p_source;

  v_twin_id := private.find_twin(v_lot);
  if v_twin_id is not null then
    v_undo := private.capture_lot(v_undo, v_twin_id);
    update public.lots
    set quantity = quantity + p_quantity,
        purchased_at = least(purchased_at, v_lot.purchased_at)
    where id = v_twin_id;
  else
    insert into public.lots (
      id, house_id, zone_id, product_id, quantity, brand, printed_date, printed_date_type,
      purchased_at, frozen_at, reminder_date, source
    )
    values (
      v_lot.id, v_lot.house_id, v_lot.zone_id, v_lot.product_id, v_lot.quantity, v_lot.brand,
      v_lot.printed_date, v_lot.printed_date_type, v_lot.purchased_at, v_lot.frozen_at,
      v_lot.reminder_date, v_lot.source
    );
    v_undo := private.undo_append(v_undo, 'created_lots', v_lot.id);
  end if;

  if p_printed_date is not null then
    insert into public.date_samples (house_id, product_id, days_to_printed_date, printed_date_type)
    values (p_house_id, v_product.id, p_printed_date - v_lot.purchased_at, p_printed_date_type)
    returning id into v_sample_id;
    v_undo := private.undo_append(v_undo, 'created_samples', v_sample_id);
  end if;

  return private.log_movement(
    'added',
    v_product,
    jsonb_build_object('amount', p_quantity, 'zone', v_zone.kind),
    v_undo
  );
end;
$$;

create function public.add_cooked_dish(
  p_house_id uuid,
  p_zone_id uuid,
  p_name text,
  p_servings numeric,
  p_cooked_at date default null,
  p_container_number integer default null,
  p_reminder_date date default null,
  p_source public.lot_source default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.zones;
  v_product public.products;
  v_lot_id uuid;
  v_number integer;
  v_today date := private.user_today();
  v_name text := nullif(btrim(p_name), '');
  v_undo jsonb;
begin
  perform private.assert_member(p_house_id);

  select * into v_zone from public.zones where id = p_zone_id and house_id = p_house_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_name is null then
    raise exception 'invalid_input';
  end if;
  if p_servings is null or p_servings <= 0 then
    raise exception 'invalid_amount';
  end if;

  perform private.lock_containers(p_house_id);
  v_number := coalesce(p_container_number, private.lowest_free_container(p_house_id));

  insert into public.products (house_id, name, category, kind, quantity_kind, unit_label)
  values (p_house_id, v_name, 'cooked', 'cooked_dish', 'count', 'serving')
  returning * into v_product;

  begin
    insert into public.lots (
      house_id, zone_id, product_id, quantity, cooked_at, frozen_at, reminder_date,
      container_number, source
    )
    values (
      p_house_id,
      p_zone_id,
      v_product.id,
      p_servings,
      coalesce(p_cooked_at, v_today),
      case when v_zone.kind = 'freezer' then v_today end,
      p_reminder_date,
      v_number,
      p_source
    )
    returning id into v_lot_id;
  exception
    when unique_violation then
      raise exception 'container_number_taken';
  end;

  -- Para deshacer basta con borrar el producto creado: el lote cae con él.
  v_undo := private.new_undo(null::public.products);
  v_undo := private.undo_append(v_undo, 'created_lots', v_lot_id);
  v_undo := private.undo_append(v_undo, 'created_products', v_product.id);

  return private.log_movement(
    'cooked',
    v_product,
    jsonb_build_object('amount', p_servings, 'zone', v_zone.kind, 'container_number', v_number),
    v_undo
  );
end;
$$;

-- Número que recibirá el próximo táper, para enseñarlo en el formulario.
create function public.next_container_number(p_house_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_house_id);
  return private.lowest_free_container(p_house_id);
end;
$$;

---------------------------------------------------------------------------------------------------
-- Consumir, abrir y ajustar
---------------------------------------------------------------------------------------------------

-- Resta aplicando FEFO. Con p_lot_id se limita a ese lote, y con p_zone_id a esa zona.
-- En `divisible`, cada unidad termina primero las abiertas y después resta una cerrada.
-- Si piden más de lo que hay, se consume lo que queda.
create function public.consume(
  p_product_id uuid default null,
  p_lot_id uuid default null,
  p_amount numeric default 1,
  p_zone_id uuid default null,
  p_all boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.lots;
  v_product public.products;
  v_undo jsonb;
  v_left numeric;
  v_taken numeric := 0;
  v_take numeric;
  v_quantity numeric;
  v_lot_id uuid;
  v_unit_id uuid;
begin
  if p_lot_id is not null then
    v_lot := private.lock_lot(p_lot_id);
    select * into v_product from public.products where id = v_lot.product_id;
  elsif p_product_id is not null then
    v_product := private.lock_product(p_product_id);
  else
    raise exception 'invalid_input';
  end if;

  if not p_all then
    perform private.assert_amount(v_product, p_amount);
  end if;

  v_undo := private.new_undo(v_product);

  if p_all then
    select coalesce(sum(l.quantity), 0)
      + (
        select count(*)
        from public.opened_units u
        join public.lots l2 on l2.id = u.lot_id
        where l2.product_id = v_product.id
          and (p_lot_id is null or l2.id = p_lot_id)
          and (p_zone_id is null or l2.zone_id = p_zone_id)
      )
    into v_left
    from public.lots l
    where l.product_id = v_product.id
      and (p_lot_id is null or l.id = p_lot_id)
      and (p_zone_id is null or l.zone_id = p_zone_id);
  else
    v_left := p_amount;
  end if;

  if v_product.quantity_kind = 'divisible' then
    while v_left > 0 loop
      select u.id, u.lot_id
      into v_unit_id, v_lot_id
      from public.opened_units_with_dates u
      join public.lots l on l.id = u.lot_id
      where l.product_id = v_product.id
        and (p_lot_id is null or l.id = p_lot_id)
        and (p_zone_id is null or l.zone_id = p_zone_id)
      order by u.effective_date asc nulls last, u.remaining_fraction, u.opened_at, u.id
      limit 1;

      if found then
        v_undo := private.capture_lot(v_undo, v_lot_id);
        delete from public.opened_units where id = v_unit_id;
        perform private.drop_lot_if_empty(v_lot_id);
        v_taken := v_taken + 1;
        v_left := v_left - 1;
        continue;
      end if;

      select l.id, l.quantity
      into v_lot_id, v_quantity
      from public.lots_with_dates l
      where l.product_id = v_product.id
        and l.quantity > 0
        and (p_lot_id is null or l.id = p_lot_id)
        and (p_zone_id is null or l.zone_id = p_zone_id)
      order by l.effective_date asc nulls last, l.created_at, l.id
      limit 1;

      exit when not found;

      v_take := least(v_left, v_quantity);
      v_undo := private.capture_lot(v_undo, v_lot_id);
      update public.lots set quantity = quantity - v_take where id = v_lot_id;
      perform private.drop_lot_if_empty(v_lot_id);
      v_taken := v_taken + v_take;
      v_left := v_left - v_take;
    end loop;
  else
    for v_lot_id, v_quantity in
      select l.id, l.quantity
      from public.lots_with_dates l
      where l.product_id = v_product.id
        and l.quantity > 0
        and (p_lot_id is null or l.id = p_lot_id)
        and (p_zone_id is null or l.zone_id = p_zone_id)
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

  if v_taken = 0 then
    raise exception 'nothing_to_consume';
  end if;

  return private.log_movement('consumed', v_product, jsonb_build_object('amount', v_taken), v_undo);
end;
$$;

-- Con p_product_id abre una unidad del lote más próximo a caducar (SPEC §7.1).
create function public.open_unit(
  p_lot_id uuid default null,
  p_product_id uuid default null,
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
  v_new public.lots;
  v_lot_id uuid;
  v_new_id uuid;
  v_today date := private.user_today();
  v_undo jsonb;
begin
  if p_lot_id is not null then
    v_lot := private.lock_lot(p_lot_id);
    select * into v_product from public.products where id = v_lot.product_id;
  elsif p_product_id is not null then
    v_product := private.lock_product(p_product_id);
    select l.id into v_lot_id
    from public.lots_with_dates l
    where l.product_id = v_product.id
      and l.quantity > 0
      and l.opened_at is null
    order by l.effective_date asc nulls last, l.created_at, l.id
    limit 1;
    if not found then
      raise exception 'nothing_to_open';
    end if;
    select * into v_lot from public.lots where id = v_lot_id;
  else
    raise exception 'invalid_input';
  end if;

  if v_product.kind = 'cooked_dish' then
    raise exception 'invalid_input';
  end if;
  if v_lot.quantity <= 0 or v_lot.opened_at is not null then
    raise exception 'nothing_to_open';
  end if;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  if v_product.quantity_kind = 'divisible' then
    update public.lots set quantity = quantity - 1 where id = v_lot.id;
    insert into public.opened_units (house_id, lot_id, opened_at, reminder_date)
    values (v_lot.house_id, v_lot.id, v_today, p_reminder_date);
  elsif v_product.quantity_kind = 'count' and v_lot.quantity > 1 then
    -- Se abre una sola unidad: pasa a un lote propio y el resto sigue cerrado.
    update public.lots set quantity = quantity - 1 where id = v_lot.id;
    v_new := v_lot;
    v_new_id := gen_random_uuid();
    insert into public.lots (
      id, house_id, zone_id, product_id, quantity, brand, barcode, image_url, printed_date,
      printed_date_type, purchased_at, frozen_at, thawed_at, reminder_date, opened_at, source
    )
    values (
      v_new_id, v_new.house_id, v_new.zone_id, v_new.product_id, 1, v_new.brand, v_new.barcode,
      v_new.image_url, v_new.printed_date, v_new.printed_date_type, v_new.purchased_at,
      v_new.frozen_at, v_new.thawed_at, p_reminder_date, v_today, v_new.source
    );
    v_undo := private.undo_append(v_undo, 'created_lots', v_new_id);
    v_undo := private.merge_twin(v_undo, v_new_id);
  else
    update public.lots
    set opened_at = v_today,
        reminder_date = p_reminder_date
    where id = v_lot.id;
  end if;

  return private.log_movement('opened', v_product, jsonb_build_object('amount', 1), v_undo);
end;
$$;

-- Si la fracción llega a 0, la unidad se ha terminado y desaparece.
create function public.set_remaining(p_opened_unit_id uuid, p_fraction numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot_id uuid;
  v_lot public.lots;
  v_product public.products;
  v_undo jsonb;
begin
  if p_fraction is null or p_fraction < 0 or p_fraction > 1 then
    raise exception 'invalid_amount';
  end if;

  select lot_id into v_lot_id from public.opened_units where id = p_opened_unit_id;
  if not found then
    raise exception 'not_found';
  end if;

  v_lot := private.lock_lot(v_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;

  perform 1 from public.opened_units where id = p_opened_unit_id;
  if not found then
    raise exception 'not_found';
  end if;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  if p_fraction = 0 then
    delete from public.opened_units where id = p_opened_unit_id;
    perform private.drop_lot_if_empty(v_lot.id);
    return private.log_movement('finished', v_product, jsonb_build_object('amount', 1), v_undo);
  end if;

  update public.opened_units set remaining_fraction = p_fraction where id = p_opened_unit_id;
  return private.log_movement('adjusted', v_product, jsonb_build_object('fraction', p_fraction), v_undo);
end;
$$;

-- Corrección manual: es el único caso en que el cliente envía el valor final.
create function public.adjust_quantity(p_lot_id uuid, p_new_quantity numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.lots;
  v_product public.products;
  v_undo jsonb;
begin
  v_lot := private.lock_lot(p_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'invalid_amount';
  end if;
  if v_product.quantity_kind = 'divisible' and p_new_quantity <> trunc(p_new_quantity) then
    raise exception 'invalid_amount';
  end if;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  update public.lots set quantity = p_new_quantity where id = v_lot.id;
  perform private.drop_lot_if_empty(v_lot.id);

  return private.log_movement('adjusted', v_product, jsonb_build_object('amount', p_new_quantity), v_undo);
end;
$$;

-- Edita los campos presentes en p_patch; un valor null los vacía.
create function public.update_lot(p_lot_id uuid, p_patch jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.lots;
  v_product public.products;
  v_number integer;
  v_undo jsonb;
begin
  v_lot := private.lock_lot(p_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  v_number := v_lot.container_number;
  if v_product.kind = 'cooked_dish' and p_patch ? 'container_number' then
    perform private.lock_containers(v_lot.house_id);
    v_number := coalesce(
      (p_patch ->> 'container_number')::integer,
      private.lowest_free_container(v_lot.house_id)
    );
  end if;

  begin
    update public.lots
    set printed_date = case when p_patch ? 'printed_date' then (p_patch ->> 'printed_date')::date else printed_date end,
        printed_date_type = case when p_patch ? 'printed_date_type' then (p_patch ->> 'printed_date_type')::public.printed_date_type else printed_date_type end,
        brand = case when p_patch ? 'brand' then nullif(btrim(p_patch ->> 'brand'), '') else brand end,
        purchased_at = case when p_patch ? 'purchased_at' then coalesce((p_patch ->> 'purchased_at')::date, purchased_at) else purchased_at end,
        cooked_at = case when p_patch ? 'cooked_at' and v_product.kind = 'cooked_dish' then coalesce((p_patch ->> 'cooked_at')::date, cooked_at) else cooked_at end,
        frozen_at = case when p_patch ? 'frozen_at' and frozen_at is not null then coalesce((p_patch ->> 'frozen_at')::date, frozen_at) else frozen_at end,
        thawed_at = case when p_patch ? 'thawed_at' and thawed_at is not null then coalesce((p_patch ->> 'thawed_at')::date, thawed_at) else thawed_at end,
        opened_at = case when p_patch ? 'opened_at' and opened_at is not null then coalesce((p_patch ->> 'opened_at')::date, opened_at) else opened_at end,
        reminder_date = case when p_patch ? 'reminder_date' then (p_patch ->> 'reminder_date')::date else reminder_date end,
        container_number = v_number
    where id = v_lot.id;
  exception
    when unique_violation then
      raise exception 'container_number_taken';
    when check_violation then
      raise exception 'invalid_input';
  end;

  v_undo := private.merge_twin(v_undo, v_lot.id);

  return private.log_movement('adjusted', v_product, jsonb_build_object('edited', true), v_undo);
end;
$$;

create function public.update_opened_unit(p_opened_unit_id uuid, p_patch jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot_id uuid;
  v_lot public.lots;
  v_product public.products;
  v_undo jsonb;
begin
  select lot_id into v_lot_id from public.opened_units where id = p_opened_unit_id;
  if not found then
    raise exception 'not_found';
  end if;

  v_lot := private.lock_lot(v_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  update public.opened_units
  set reminder_date = case when p_patch ? 'reminder_date' then (p_patch ->> 'reminder_date')::date else reminder_date end,
      opened_at = case when p_patch ? 'opened_at' then coalesce((p_patch ->> 'opened_at')::date, opened_at) else opened_at end
  where id = p_opened_unit_id;

  return private.log_movement('adjusted', v_product, jsonb_build_object('edited', true), v_undo);
end;
$$;

---------------------------------------------------------------------------------------------------
-- Mover, congelar, descongelar y tirar
---------------------------------------------------------------------------------------------------

-- Mueve entre zonas. Mover al Congelador es congelar y sacarlo es descongelar.
-- Si se mueve solo una parte, el lote se divide conservando fechas y marca.
create function public.move_lot(
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
  v_selected integer;
  v_total_units integer;
  v_frozen_at date;
  v_thawed_at date;
  v_reminder date;
  v_number integer;
  v_new_id uuid;
  v_today date := private.user_today();
begin
  v_lot := private.lock_lot(p_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;
  select * into v_source_zone from public.zones where id = v_lot.zone_id;

  select * into v_target_zone from public.zones where id = p_target_zone_id;
  if not found then
    raise exception 'not_found';
  end if;
  -- Mover entre casas llega en la fase 2.
  if v_target_zone.house_id <> v_lot.house_id then
    raise exception 'invalid_input';
  end if;
  if v_target_zone.id = v_source_zone.id then
    raise exception 'same_zone';
  end if;

  select count(*), count(*) filter (where id = any (v_unit_ids))
  into v_total_units, v_selected
  from public.opened_units
  where lot_id = v_lot.id;

  if v_selected <> cardinality(v_unit_ids)
    or v_quantity < 0
    or v_quantity > v_lot.quantity
    or (v_quantity = 0 and v_selected = 0)
    or (v_product.quantity_kind = 'divisible' and v_quantity <> trunc(v_quantity))
  then
    raise exception 'invalid_amount';
  end if;

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

-- Tirar es distinto de consumir: queda registrado como tal en el historial.
create function public.discard(
  p_lot_id uuid,
  p_quantity numeric default 0,
  p_opened_unit_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.lots;
  v_product public.products;
  v_quantity numeric := coalesce(p_quantity, 0);
  v_unit_ids uuid[] := coalesce(p_opened_unit_ids, '{}');
  v_selected integer;
  v_undo jsonb;
begin
  v_lot := private.lock_lot(p_lot_id);
  select * into v_product from public.products where id = v_lot.product_id;

  select count(*) into v_selected
  from public.opened_units
  where lot_id = v_lot.id and id = any (v_unit_ids);

  if v_selected <> cardinality(v_unit_ids)
    or v_quantity < 0
    or v_quantity > v_lot.quantity
    or (v_quantity = 0 and v_selected = 0)
    or (v_product.quantity_kind = 'divisible' and v_quantity <> trunc(v_quantity))
  then
    raise exception 'invalid_amount';
  end if;

  v_undo := private.capture_lot(private.new_undo(v_product), v_lot.id);

  delete from public.opened_units where id = any (v_unit_ids);
  update public.lots set quantity = quantity - v_quantity where id = v_lot.id;
  perform private.drop_lot_if_empty(v_lot.id);

  return private.log_movement(
    'discarded',
    v_product,
    jsonb_build_object('amount', v_quantity + v_selected),
    v_undo
  );
end;
$$;

---------------------------------------------------------------------------------------------------
-- Deshacer
---------------------------------------------------------------------------------------------------

create function public.undo_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.movements;
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

  if v_movement.created_at < now() - interval '2 minutes' then
    raise exception 'undo_expired';
  end if;

  -- Se bloquea antes de comprobar: así no se cuela un cambio entre la comprobación y la restauración.
  perform 1 from public.products where id = v_movement.product_id for update;

  if exists (
    select 1
    from public.movements m
    where m.house_id = v_movement.house_id
      and m.seq > v_movement.seq
      and m.lot_ids && v_movement.lot_ids
  ) then
    raise exception 'undo_conflict';
  end if;

  v_undo := v_movement.undo_state;

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

    for v_id, v_snapshot in select key, value from jsonb_each(v_undo -> 'lots') loop
      delete from public.lots where id = v_id::uuid;
      insert into public.lots
      select * from jsonb_populate_record(null::public.lots, v_snapshot -> 'lot');
      insert into public.opened_units
      select r.* from jsonb_populate_recordset(null::public.opened_units, v_snapshot -> 'units') r;
    end loop;

    delete from public.products p
    where p.id in (select value::uuid from jsonb_array_elements_text(v_undo -> 'created_products'))
      and not exists (select 1 from public.lots l where l.product_id = p.id);
  exception
    when unique_violation then
      -- Por ejemplo, el número de un táper vaciado ya lo usa otro.
      raise exception 'undo_conflict';
  end;

  delete from public.movements where id = p_movement_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Datos del producto: no cambian existencias, así que no generan movimiento
---------------------------------------------------------------------------------------------------

-- Edita los campos presentes en p_patch; un valor null los vacía.
create function public.update_product(p_product_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_name text;
begin
  v_product := private.lock_product(p_product_id);

  v_name := nullif(btrim(p_patch ->> 'name'), '');
  if p_patch ? 'name' and v_name is null then
    raise exception 'invalid_input';
  end if;

  begin
    update public.products
    set name = coalesce(v_name, name),
        name_customized = name_customized or (v_name is not null and v_name <> name),
        category = case when p_patch ? 'category' then (p_patch ->> 'category')::public.category else category end,
        preferred_brand = case when p_patch ? 'preferred_brand' then nullif(btrim(p_patch ->> 'preferred_brand'), '') else preferred_brand end,
        brand_notes = case when p_patch ? 'brand_notes' then nullif(btrim(p_patch ->> 'brand_notes'), '') else brand_notes end
    where id = p_product_id;
  exception
    when unique_violation then
      raise exception 'product_name_taken';
  end;
end;
$$;

-- Solo sin existencias, para no perder inventario sin querer. El historial conserva el nombre.
create function public.delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_product(p_product_id);

  if exists (select 1 from public.lots where product_id = p_product_id) then
    raise exception 'product_has_stock';
  end if;

  delete from public.products where id = p_product_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Permisos
---------------------------------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;

-- Las usan las políticas de acceso y las vistas, que se ejecutan como el usuario.
grant execute on function private.is_house_member(uuid) to authenticated;
grant execute on function private.compute_effective(date, public.printed_date_type, date, date, date, boolean, boolean) to authenticated;

revoke all on function public.add_lot(uuid, uuid, numeric, uuid, uuid, text, public.category, public.quantity_kind, text, numeric, public.amount_unit, public.amount_unit, text, date, public.printed_date_type, date, date, date, public.lot_source) from public, anon;
revoke all on function public.add_cooked_dish(uuid, uuid, text, numeric, date, integer, date, public.lot_source) from public, anon;
revoke all on function public.next_container_number(uuid) from public, anon;
revoke all on function public.consume(uuid, uuid, numeric, uuid, boolean) from public, anon;
revoke all on function public.open_unit(uuid, uuid, date) from public, anon;
revoke all on function public.set_remaining(uuid, numeric) from public, anon;
revoke all on function public.adjust_quantity(uuid, numeric) from public, anon;
revoke all on function public.update_lot(uuid, jsonb) from public, anon;
revoke all on function public.update_opened_unit(uuid, jsonb) from public, anon;
revoke all on function public.move_lot(uuid, numeric, uuid, uuid[], date) from public, anon;
revoke all on function public.discard(uuid, numeric, uuid[]) from public, anon;
revoke all on function public.undo_movement(uuid) from public, anon;
revoke all on function public.update_product(uuid, jsonb) from public, anon;
revoke all on function public.delete_product(uuid) from public, anon;

grant execute on function public.add_lot(uuid, uuid, numeric, uuid, uuid, text, public.category, public.quantity_kind, text, numeric, public.amount_unit, public.amount_unit, text, date, public.printed_date_type, date, date, date, public.lot_source) to authenticated;
grant execute on function public.add_cooked_dish(uuid, uuid, text, numeric, date, integer, date, public.lot_source) to authenticated;
grant execute on function public.next_container_number(uuid) to authenticated;
grant execute on function public.consume(uuid, uuid, numeric, uuid, boolean) to authenticated;
grant execute on function public.open_unit(uuid, uuid, date) to authenticated;
grant execute on function public.set_remaining(uuid, numeric) to authenticated;
grant execute on function public.adjust_quantity(uuid, numeric) to authenticated;
grant execute on function public.update_lot(uuid, jsonb) to authenticated;
grant execute on function public.update_opened_unit(uuid, jsonb) to authenticated;
grant execute on function public.move_lot(uuid, numeric, uuid, uuid[], date) to authenticated;
grant execute on function public.discard(uuid, numeric, uuid[]) to authenticated;
grant execute on function public.undo_movement(uuid) to authenticated;
grant execute on function public.update_product(uuid, jsonb) to authenticated;
grant execute on function public.delete_product(uuid) to authenticated;
