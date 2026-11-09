-- Fase 1: catálogo, inventario e historial (SPEC §5.2 a §5.4).

create type public.category as enum (
  'dairy_eggs',
  'meat',
  'fish',
  'fruit',
  'vegetables',
  'bread',
  'pasta_rice_legumes',
  'canned',
  'frozen',
  'drinks',
  'sauces',
  'snacks',
  'breakfast',
  'cooked',
  'other'
);
create type public.product_kind as enum ('food', 'cooked_dish');
create type public.quantity_kind as enum ('count', 'divisible', 'bulk');
create type public.amount_unit as enum ('g', 'kg', 'ml', 'l', 'ud');
create type public.printed_date_type as enum ('expiry', 'best_before');
create type public.lot_source as enum ('manual', 'ticket', 'barcode', 'recipe', 'move');
create type public.movement_type as enum (
  'added',
  'consumed',
  'opened',
  'adjusted',
  'finished',
  'moved_zone',
  'moved_out',
  'moved_in',
  'frozen',
  'thawed',
  'discarded',
  'cooked',
  'ticket_applied'
);

create function private.normalize_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    lower(translate(btrim(p_name), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
    '\s+', ' ', 'g'
  );
$$;

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_es text not null,
  name_en text not null,
  icon text not null,
  category public.category not null,
  default_zone public.zone_kind not null,
  default_quantity_kind public.quantity_kind not null,
  default_unit_label text not null,
  default_content_amount numeric,
  default_content_unit public.amount_unit,
  synonyms_es text[] not null default '{}',
  synonyms_en text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  catalog_item_id uuid references public.catalog_items (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Mientras sea false, un producto del catálogo se muestra en el idioma de quien lo mira.
  name_customized boolean not null default false,
  name_normalized text generated always as (private.normalize_name(name)) stored,
  category public.category not null,
  icon text,
  kind public.product_kind not null default 'food',
  quantity_kind public.quantity_kind not null,
  unit_label text not null check (char_length(unit_label) between 1 and 30),
  content_amount numeric check (content_amount > 0),
  content_unit public.amount_unit,
  bulk_unit public.amount_unit check (bulk_unit <> 'ud'),
  preferred_brand text,
  brand_notes text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity_kind <> 'divisible' or (content_amount is not null and content_unit is not null)),
  check (quantity_kind <> 'bulk' or bulk_unit is not null)
);

create index products_house_id_idx on public.products (house_id);
create index products_catalog_item_id_idx on public.products (catalog_item_id);
-- Un táper es siempre un producto propio, así que puede repetir nombre.
create unique index products_house_name_key
on public.products (house_id, name_normalized)
where kind = 'food';
create unique index products_house_catalog_key
on public.products (house_id, catalog_item_id)
where kind = 'food' and catalog_item_id is not null;

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity numeric not null check (quantity >= 0),
  brand text,
  barcode text,
  image_url text,
  printed_date date,
  printed_date_type public.printed_date_type,
  purchased_at date not null default current_date,
  cooked_at date,
  frozen_at date,
  thawed_at date,
  reminder_date date,
  container_number integer check (container_number > 0),
  opened_at date,
  source public.lot_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((printed_date is null) = (printed_date_type is null))
);

create index lots_house_id_idx on public.lots (house_id);
create index lots_zone_id_idx on public.lots (zone_id);
create index lots_product_id_idx on public.lots (product_id);
create unique index lots_house_container_key
on public.lots (house_id, container_number)
where container_number is not null;

create table public.opened_units (
  id uuid primary key default gen_random_uuid(),
  -- Se repite la casa para simplificar las políticas de acceso y el tiempo real de la fase 2.
  house_id uuid not null references public.houses (id) on delete cascade,
  lot_id uuid not null references public.lots (id) on delete cascade,
  remaining_fraction numeric not null default 1 check (remaining_fraction > 0 and remaining_fraction <= 1),
  opened_at date not null,
  reminder_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opened_units_house_id_idx on public.opened_units (house_id);
create index opened_units_lot_id_idx on public.opened_units (lot_id);

-- Sobrevive al lote: alimenta las fechas aprendidas de la fase 4.
create table public.date_samples (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  days_to_printed_date integer not null,
  printed_date_type public.printed_date_type not null,
  created_at timestamptz not null default now()
);

create index date_samples_house_id_idx on public.date_samples (house_id);
create index date_samples_product_id_idx on public.date_samples (product_id);

-- Sin user_id: decisión deliberada (SPEC, principio 5).
-- La cantidad va en `details` y no como texto, para que cada persona la lea en su idioma.
create table public.movements (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  house_id uuid not null references public.houses (id) on delete cascade,
  type public.movement_type not null,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  catalog_item_id uuid references public.catalog_items (id) on delete set null,
  details jsonb not null default '{}',
  lot_ids uuid[] not null default '{}',
  undo_state jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index movements_house_seq_idx on public.movements (house_id, seq desc);
create index movements_product_id_idx on public.movements (product_id);
create index movements_catalog_item_id_idx on public.movements (catalog_item_id);

create trigger catalog_items_set_updated_at
before update on public.catalog_items
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger lots_set_updated_at
before update on public.lots
for each row execute function public.set_updated_at();

create trigger opened_units_set_updated_at
before update on public.opened_units
for each row execute function public.set_updated_at();

-- Fecha efectiva (SPEC §7.2). Es la única implementación: la usan FEFO y las vistas de abajo.
create function private.compute_effective(
  p_printed_date date,
  p_printed_date_type public.printed_date_type,
  p_reminder_date date,
  p_frozen_at date,
  p_thawed_at date,
  p_is_open boolean,
  p_is_cooked_dish boolean
)
returns table (effective_date date, effective_basis text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_frozen boolean := p_frozen_at is not null and p_thawed_at is null;
  v_thawed boolean := p_thawed_at is not null;
begin
  if v_frozen or v_thawed or p_is_cooked_dish then
    if p_reminder_date is not null then
      return query select p_reminder_date, 'reminder'::text;
      return;
    end if;
    if v_frozen or p_is_cooked_dish then
      return query select null::date, null::text;
      return;
    end if;
  elsif p_is_open and p_reminder_date is not null then
    if p_printed_date_type = 'expiry' and p_printed_date < p_reminder_date then
      return query select p_printed_date, 'expiry'::text;
    else
      return query select p_reminder_date, 'reminder'::text;
    end if;
    return;
  end if;

  return query select p_printed_date, p_printed_date_type::text;
end;
$$;

create view public.lots_with_dates
with (security_invoker = true)
as
select l.*, e.effective_date, e.effective_basis
from public.lots l
cross join lateral private.compute_effective(
  l.printed_date,
  l.printed_date_type,
  l.reminder_date,
  l.frozen_at,
  l.thawed_at,
  l.opened_at is not null,
  l.cooked_at is not null
) e;

create view public.opened_units_with_dates
with (security_invoker = true)
as
select u.*, e.effective_date, e.effective_basis
from public.opened_units u
join public.lots l on l.id = u.lot_id
cross join lateral private.compute_effective(
  l.printed_date,
  l.printed_date_type,
  u.reminder_date,
  l.frozen_at,
  l.thawed_at,
  true,
  l.cooked_at is not null
) e;

alter table public.catalog_items enable row level security;
alter table public.products enable row level security;
alter table public.lots enable row level security;
alter table public.opened_units enable row level security;
alter table public.date_samples enable row level security;
alter table public.movements enable row level security;

create policy "catalog_items_select_authenticated" on public.catalog_items
for select to authenticated
using (true);

create policy "products_select_member" on public.products
for select to authenticated
using (private.is_house_member(house_id));

create policy "lots_select_member" on public.lots
for select to authenticated
using (private.is_house_member(house_id));

create policy "opened_units_select_member" on public.opened_units
for select to authenticated
using (private.is_house_member(house_id));

create policy "date_samples_select_member" on public.date_samples
for select to authenticated
using (private.is_house_member(house_id));

create policy "movements_select_member" on public.movements
for select to authenticated
using (private.is_house_member(house_id));

-- Se parte de cero por si el proyecto aplica permisos por defecto a las tablas nuevas.
revoke all on
  public.catalog_items,
  public.products,
  public.lots,
  public.opened_units,
  public.date_samples,
  public.movements,
  public.lots_with_dates,
  public.opened_units_with_dates
from anon, authenticated;

-- Solo lectura: todo cambio pasa por las funciones atómicas (SPEC, principio 4).
grant select on
  public.catalog_items,
  public.products,
  public.lots,
  public.opened_units,
  public.date_samples,
  public.lots_with_dates,
  public.opened_units_with_dates
to authenticated;

-- `undo_state` es interno: el cliente deshace con undo_movement, sin leerlo.
grant select (id, seq, house_id, type, product_id, product_name, catalog_item_id, details, lot_ids, created_at)
on public.movements
to authenticated;
