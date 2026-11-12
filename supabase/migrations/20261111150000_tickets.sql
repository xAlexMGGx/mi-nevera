-- Fase 4: ticket, código de barras y fechas leídas con la cámara (SPEC §10 y §11).
-- La lectura con IA ocurre en las Edge Functions; aquí solo se guarda lo que la persona confirma.

---------------------------------------------------------------------------------------------------
-- Validaciones
---------------------------------------------------------------------------------------------------

-- Mayúsculas, tildes, puntos y espacios no cuentan: "LECHE SEMI. HACEND 1L" es la misma línea.
create function private.normalize_ticket_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      lower(translate(
        coalesce(p_text, ''),
        'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç',
        'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc'
      )),
      '[^a-z0-9]+', ' ', 'g'
    )),
    ''
  );
$$;

-- Códigos EAN y UPC: solo cifras. Vacío equivale a sin código.
create function private.clean_barcode(p_barcode text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_barcode text := nullif(btrim(p_barcode), '');
begin
  if v_barcode is not null and v_barcode !~ '^[0-9]{4,20}$' then
    raise exception 'invalid_input';
  end if;
  return v_barcode;
end;
$$;

-- Fotos de Open Food Facts por URL (SPEC §12). Solo direcciones seguras.
create function private.clean_image_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := nullif(btrim(p_url), '');
begin
  if v_url is not null and (char_length(v_url) > 600 or v_url !~ '^https://[^[:space:]]+$') then
    raise exception 'invalid_input';
  end if;
  return v_url;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Alias de ticket (SPEC §5.3): "LECHE SEMI HACEND 1L" = Leche (Hacendado)
---------------------------------------------------------------------------------------------------

create table public.ticket_aliases (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  raw_text_normalized text not null check (char_length(raw_text_normalized) between 1 and 120),
  product_id uuid not null references public.products (id) on delete cascade,
  brand text check (char_length(brand) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (house_id, raw_text_normalized)
);

create index ticket_aliases_product_id_idx on public.ticket_aliases (product_id);

create trigger ticket_aliases_set_updated_at
before update on public.ticket_aliases
for each row execute function public.set_updated_at();

alter table public.ticket_aliases enable row level security;

create policy "ticket_aliases_select_member" on public.ticket_aliases
for select to authenticated
using (private.is_house_member(house_id));

revoke all on public.ticket_aliases from anon, authenticated;
-- Solo lectura: se escriben al aplicar un ticket.
grant select on public.ticket_aliases to authenticated;

-- Lo que la casa ya ha aprendido de tickets anteriores, línea a línea.
create function public.match_ticket_lines(p_house_id uuid, p_raw_texts text[])
returns table (raw_text text, product_id uuid, brand text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_house_id);
  if coalesce(cardinality(p_raw_texts), 0) > 200 then
    raise exception 'invalid_input';
  end if;

  return query
  select t.txt, a.product_id, a.brand
  from unnest(p_raw_texts) as t (txt)
  join public.ticket_aliases a
    on a.house_id = p_house_id
   and a.raw_text_normalized = private.normalize_ticket_text(left(t.txt, 200));
end;
$$;

---------------------------------------------------------------------------------------------------
-- Añadir: el alta manual, el código de barras y el ticket comparten la misma lógica
---------------------------------------------------------------------------------------------------

-- Crea el lote (y el producto si hace falta) y lo apunta en p_undo. No registra movimiento:
-- add_lot registra uno por lote y apply_ticket, uno por ticket.
-- Devuelve {product_id, lot_id, undo}.
create function private.add_lot_internal(
  p_house_id uuid,
  p_zone public.zones,
  p_quantity numeric,
  p_product_id uuid,
  p_catalog_item_id uuid,
  p_name text,
  p_category public.category,
  p_quantity_kind public.quantity_kind,
  p_unit_label text,
  p_content_amount numeric,
  p_content_unit public.amount_unit,
  p_bulk_unit public.amount_unit,
  p_brand text,
  p_printed_date date,
  p_printed_date_type public.printed_date_type,
  p_purchased_at date,
  p_frozen_at date,
  p_reminder_date date,
  p_source public.lot_source,
  p_barcode text,
  p_image_url text,
  p_undo jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_catalog public.catalog_items;
  v_product public.products;
  v_lot public.lots;
  v_name text;
  v_locale text;
  v_twin_id uuid;
  v_sample_id uuid;
  v_today date := private.user_today();
  v_undo jsonb := p_undo;
begin
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
      begin
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
      exception
        -- Por ejemplo, un producto divisible sin contenido.
        when check_violation then
          raise exception 'invalid_input';
      end;

      if v_product.id is not null then
        v_undo := private.undo_append(v_undo, 'created_products', v_product.id);
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

  v_lot.id := gen_random_uuid();
  v_lot.house_id := p_house_id;
  v_lot.zone_id := p_zone.id;
  v_lot.product_id := v_product.id;
  v_lot.quantity := p_quantity;
  v_lot.brand := nullif(btrim(p_brand), '');
  v_lot.barcode := private.clean_barcode(p_barcode);
  v_lot.image_url := private.clean_image_url(p_image_url);
  v_lot.printed_date := p_printed_date;
  v_lot.printed_date_type := p_printed_date_type;
  v_lot.purchased_at := coalesce(p_purchased_at, v_today);
  -- Lo que entra en el congelador cuenta siempre como congelado.
  v_lot.frozen_at := case when p_zone.kind = 'freezer' then coalesce(p_frozen_at, v_today) end;
  v_lot.reminder_date := case when p_zone.kind = 'freezer' then p_reminder_date end;
  v_lot.source := p_source;

  if (v_lot.printed_date is null) <> (v_lot.printed_date_type is null) then
    raise exception 'invalid_input';
  end if;

  v_twin_id := private.find_twin(v_lot);
  if v_twin_id is not null then
    v_undo := private.capture_lot(v_undo, v_twin_id);
    update public.lots
    set quantity = quantity + p_quantity,
        purchased_at = least(purchased_at, v_lot.purchased_at),
        barcode = coalesce(barcode, v_lot.barcode),
        image_url = coalesce(image_url, v_lot.image_url)
    where id = v_twin_id;
  else
    insert into public.lots (
      id, house_id, zone_id, product_id, quantity, brand, barcode, image_url, printed_date,
      printed_date_type, purchased_at, frozen_at, reminder_date, source
    )
    values (
      v_lot.id, v_lot.house_id, v_lot.zone_id, v_lot.product_id, v_lot.quantity, v_lot.brand,
      v_lot.barcode, v_lot.image_url, v_lot.printed_date, v_lot.printed_date_type,
      v_lot.purchased_at, v_lot.frozen_at, v_lot.reminder_date, v_lot.source
    );
    v_undo := private.undo_append(v_undo, 'created_lots', v_lot.id);
  end if;

  if p_printed_date is not null then
    insert into public.date_samples (house_id, product_id, days_to_printed_date, printed_date_type)
    values (p_house_id, v_product.id, p_printed_date - v_lot.purchased_at, p_printed_date_type)
    returning id into v_sample_id;
    v_undo := private.undo_append(v_undo, 'created_samples', v_sample_id);
  end if;

  return jsonb_build_object(
    'product_id', v_product.id,
    'lot_id', coalesce(v_twin_id, v_lot.id),
    'undo', v_undo
  );
end;
$$;

-- Se sustituye para aceptar el código de barras y la foto. Sin borrar la anterior, la API vería
-- dos funciones con el mismo nombre y no sabría a cuál llamar.
drop function public.add_lot(
  uuid, uuid, numeric, uuid, uuid, text, public.category, public.quantity_kind, text, numeric,
  public.amount_unit, public.amount_unit, text, date, public.printed_date_type, date, date, date,
  public.lot_source
);

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
  p_source public.lot_source default 'manual',
  p_barcode text default null,
  p_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone public.zones;
  v_product public.products;
  v_result jsonb;
begin
  perform private.assert_member(p_house_id);

  select * into v_zone from public.zones where id = p_zone_id and house_id = p_house_id;
  if not found then
    raise exception 'not_found';
  end if;

  v_result := private.add_lot_internal(
    p_house_id, v_zone, p_quantity, p_product_id, p_catalog_item_id, p_name, p_category,
    p_quantity_kind, p_unit_label, p_content_amount, p_content_unit, p_bulk_unit, p_brand,
    p_printed_date, p_printed_date_type, p_purchased_at, p_frozen_at, p_reminder_date, p_source,
    p_barcode, p_image_url, private.new_undo(null::public.products)
  );
  select * into v_product from public.products where id = (v_result ->> 'product_id')::uuid;

  return private.log_movement(
    'added',
    v_product,
    jsonb_build_object('amount', p_quantity, 'zone', v_zone.kind),
    v_result -> 'undo'
  );
end;
$$;

---------------------------------------------------------------------------------------------------
-- Aplicar un ticket (SPEC §10.1): todas las líneas confirmadas en una sola operación
---------------------------------------------------------------------------------------------------

-- Cada línea: {zone, quantity, product_id | catalog_item_id | name (+ category, quantity_kind,
-- unit_label, content_amount, content_unit, bulk_unit), brand, printed_date, printed_date_type,
-- barcode, image_url, raw_text}. Registra un único movimiento `ticket_applied` y se deshace entero.
create function public.apply_ticket(
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
        null,
        null,
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

  select coalesce(array_agg(distinct id::uuid), '{}')
  into v_lot_ids
  from (
    select jsonb_object_keys(v_undo -> 'lots') as id
    union all
    select jsonb_array_elements_text(v_undo -> 'created_lots')
  ) touched;

  v_undo := v_undo || jsonb_build_object(
    'locked_products', v_products,
    'aliases', jsonb_build_object('written', v_written, 'previous', v_previous)
  );

  -- Sin user_id (SPEC, principio 5). El nombre de la tienda ocupa el lugar del producto.
  insert into public.movements (house_id, type, product_id, product_name, catalog_item_id, details, lot_ids, undo_state)
  values (
    p_house_id,
    'ticket_applied',
    null,
    coalesce(v_store, ''),
    null,
    jsonb_build_object('store', v_store, 'count', jsonb_array_length(v_items), 'items', v_items),
    v_lot_ids,
    v_undo
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Editar un lote: también su código de barras y su foto ("Asignar código", SPEC §11)
---------------------------------------------------------------------------------------------------

create or replace function public.update_lot(p_lot_id uuid, p_patch jsonb)
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
        barcode = case when p_patch ? 'barcode' then private.clean_barcode(p_patch ->> 'barcode') else barcode end,
        image_url = case when p_patch ? 'image_url' then private.clean_image_url(p_patch ->> 'image_url') else image_url end,
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

---------------------------------------------------------------------------------------------------
-- Deshacer: también un ticket entero, con sus alias
---------------------------------------------------------------------------------------------------

-- Igual que en la fase 2, más:
-- - Un ticket toca varios productos: se bloquean todos, en orden, antes de comprobar.
-- - Los alias que escribió el ticket vuelven a como estaban, salvo que otro ticket los haya
--   cambiado después.
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
-- Límite diario de lecturas con IA por persona
---------------------------------------------------------------------------------------------------

-- Cada lectura cuesta dinero: un fallo que repitiera peticiones sin parar no debe disparar la factura.
create table private.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('receipt', 'date')),
  count integer not null default 0,
  primary key (user_id, day, kind)
);

-- La llaman las Edge Functions con la sesión de la persona, antes de llamar al modelo.
create function public.claim_ai_use(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_today date := private.user_today();
  v_limit integer := case p_kind when 'receipt' then 20 when 'date' then 150 end;
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
-- Mis datos: también los alias de cada casa
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

revoke all on function public.add_lot(uuid, uuid, numeric, uuid, uuid, text, public.category, public.quantity_kind, text, numeric, public.amount_unit, public.amount_unit, text, date, public.printed_date_type, date, date, date, public.lot_source, text, text) from public, anon;
revoke all on function public.apply_ticket(uuid, jsonb, date, text) from public, anon;
revoke all on function public.match_ticket_lines(uuid, text[]) from public, anon;
revoke all on function public.claim_ai_use(text) from public, anon;
revoke all on function public.update_lot(uuid, jsonb) from public, anon;
revoke all on function public.undo_movement(uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;

grant execute on function public.add_lot(uuid, uuid, numeric, uuid, uuid, text, public.category, public.quantity_kind, text, numeric, public.amount_unit, public.amount_unit, text, date, public.printed_date_type, date, date, date, public.lot_source, text, text) to authenticated;
grant execute on function public.apply_ticket(uuid, jsonb, date, text) to authenticated;
grant execute on function public.match_ticket_lines(uuid, text[]) to authenticated;
grant execute on function public.claim_ai_use(text) to authenticated;
grant execute on function public.update_lot(uuid, jsonb) to authenticated;
grant execute on function public.undo_movement(uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
