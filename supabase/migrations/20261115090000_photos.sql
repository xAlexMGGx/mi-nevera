-- Fase 5: tarjetas con foto (SPEC §12). Las fotos de Open Food Facts van por URL; las propias, en
-- Supabase Storage, en un bucket privado. En la base de datos, una foto propia es "photo:<ruta>".

---------------------------------------------------------------------------------------------------
-- Qué foto se puede guardar en un lote o un producto
---------------------------------------------------------------------------------------------------

-- Una URL segura (Open Food Facts) o una foto propia subida por quien la guarda: "photo:<su id>/<uuid>.jpg".
-- Así nadie puede enlazar la foto de otra persona para verla desde su casa.
create or replace function private.clean_image_url(p_url text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_url text := nullif(btrim(p_url), '');
begin
  if v_url is null then
    return null;
  end if;
  if v_url ~ '^photo:' then
    if v_url !~ '^photo:[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
      or split_part(substr(v_url, 7), '/', 1) <> (select auth.uid())::text
    then
      raise exception 'invalid_input';
    end if;
    return v_url;
  end if;
  if char_length(v_url) > 600 or v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'invalid_input';
  end if;
  return v_url;
end;
$$;

-- Los códigos de barras recuerdan la foto de Open Food Facts, no las propias.
create or replace function private.remember_lot_barcode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_image text := case when new.image_url ~ '^https://' then new.image_url end;
begin
  insert into public.product_barcodes (house_id, barcode, product_id, brand, image_url)
  values (new.house_id, new.barcode, new.product_id, left(new.brand, 80), v_image)
  on conflict (house_id, barcode) do update
  set product_id = excluded.product_id,
      brand = coalesce(excluded.brand, public.product_barcodes.brand),
      image_url = coalesce(excluded.image_url, public.product_barcodes.image_url);
  return null;
end;
$$;

-- Editar un producto: también su foto. No cambia existencias, así que no genera movimiento.
create or replace function public.update_product(p_product_id uuid, p_patch jsonb)
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
        brand_notes = case when p_patch ? 'brand_notes' then nullif(btrim(p_patch ->> 'brand_notes'), '') else brand_notes end,
        image_url = case when p_patch ? 'image_url' then private.clean_image_url(p_patch ->> 'image_url') else image_url end
    where id = p_product_id;
  exception
    when unique_violation then
      raise exception 'product_name_taken';
  end;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Quién ve una foto propia
---------------------------------------------------------------------------------------------------

-- La ve quien la subió y los miembros de cualquier casa con un lote o un producto que la use. Así,
-- al mover un lote a otra casa, su foto se ve también allí.
create function private.can_see_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lots l
    where l.image_url = 'photo:' || p_name and private.is_house_member(l.house_id)
  ) or exists (
    select 1 from public.products p
    where p.image_url = 'photo:' || p_name and private.is_house_member(p.house_id)
  );
$$;

create index lots_photo_idx on public.lots (image_url) where image_url like 'photo:%';
create index products_photo_idx on public.products (image_url) where image_url like 'photo:%';

-- El bucket y sus permisos, solo donde existe Storage (en los tests de la base de datos se simula).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  -- Privado: las fotos se ven con URL firmadas. JPEG reducido en el móvil, como mucho 1 MB.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', false, 1048576, array['image/jpeg'])
  on conflict (id) do nothing;

  -- Cada persona sube a su carpeta: "<su id>/<uuid>.jpg".
  execute $policy$
    create policy "photos_insert_own" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'photos'
      and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
      and split_part(name, '/', 1) = (select auth.uid())::text
    )
  $policy$;

  execute $policy$
    create policy "photos_select_visible" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'photos'
      and (split_part(name, '/', 1) = (select auth.uid())::text or private.can_see_photo(name))
    )
  $policy$;
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

revoke all on function public.update_product(uuid, jsonb) from public, anon;
grant execute on function public.update_product(uuid, jsonb) to authenticated;
