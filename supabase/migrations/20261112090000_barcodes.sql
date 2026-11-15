-- Fase 4, segunda parte: cada casa recuerda sus códigos de barras, la IA identifica los productos
-- escaneados y el formulario de alta es el mismo a mano, por código y en el ticket.

---------------------------------------------------------------------------------------------------
-- Códigos de barras de la casa (SPEC §11): el código lleva siempre al mismo producto
---------------------------------------------------------------------------------------------------

create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  barcode text not null check (barcode ~ '^[0-9]{4,20}$'),
  product_id uuid not null references public.products (id) on delete cascade,
  brand text check (char_length(brand) <= 80),
  image_url text check (image_url ~ '^https://[^[:space:]]+$' and char_length(image_url) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (house_id, barcode)
);

create index product_barcodes_product_id_idx on public.product_barcodes (product_id);

create trigger product_barcodes_set_updated_at
before update on public.product_barcodes
for each row execute function public.set_updated_at();

alter table public.product_barcodes enable row level security;

create policy "product_barcodes_select_member" on public.product_barcodes
for select to authenticated
using (private.is_house_member(house_id));

revoke all on public.product_barcodes from anon, authenticated;
-- Solo lectura: se apuntan solos al guardar un lote con código.
grant select on public.product_barcodes to authenticated;

-- Todo lote con código lo enseña a su casa: al añadirlo a mano, con un ticket, al asignarle el
-- código o al llegar desde otra casa. El último producto con ese código es el que vale.
-- No forma parte de Deshacer: es algo aprendido, como un alias, y no cambia el inventario.
create function private.remember_lot_barcode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_barcodes (house_id, barcode, product_id, brand, image_url)
  values (new.house_id, new.barcode, new.product_id, left(new.brand, 80), new.image_url)
  on conflict (house_id, barcode) do update
  set product_id = excluded.product_id,
      brand = coalesce(excluded.brand, public.product_barcodes.brand),
      image_url = coalesce(excluded.image_url, public.product_barcodes.image_url);
  return null;
end;
$$;

create trigger lots_remember_barcode
after insert or update of barcode, product_id on public.lots
for each row
when (new.barcode is not null)
execute function private.remember_lot_barcode();

-- Los códigos que ya se habían guardado en lotes.
insert into public.product_barcodes (house_id, barcode, product_id, brand, image_url)
select distinct on (house_id, barcode) house_id, barcode, product_id, left(brand, 80), image_url
from public.lots
where barcode is not null
order by house_id, barcode, updated_at desc
on conflict do nothing;

---------------------------------------------------------------------------------------------------
-- Ticket: cada línea admite también las fechas de congelado y de aviso, como el alta manual
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
-- Identificar un producto escaneado con IA: tercer tipo de lectura en el límite diario
---------------------------------------------------------------------------------------------------

alter table private.ai_usage drop constraint ai_usage_kind_check;
alter table private.ai_usage add constraint ai_usage_kind_check check (kind in ('receipt', 'date', 'product'));

create or replace function public.claim_ai_use(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_today date := private.user_today();
  v_limit integer := case p_kind when 'receipt' then 20 when 'date' then 150 when 'product' then 100 end;
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
-- Mis datos: también los códigos de barras de cada casa
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

revoke all on function public.apply_ticket(uuid, jsonb, date, text) from public, anon;
revoke all on function public.claim_ai_use(text) from public, anon;
revoke all on function public.export_my_data() from public, anon;

grant execute on function public.apply_ticket(uuid, jsonb, date, text) to authenticated;
grant execute on function public.claim_ai_use(text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
