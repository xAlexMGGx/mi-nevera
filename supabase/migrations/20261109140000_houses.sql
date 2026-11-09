-- Fase 1: casas, miembros y zonas (SPEC §5.1).
-- Invitaciones, roles y varias casas llegan en la fase 2.

-- Funciones internas: este esquema no se expone en la API.
create schema private;
grant usage on schema private to authenticated;

create type public.member_role as enum ('owner', 'editor');
create type public.zone_kind as enum ('fridge', 'freezer', 'pantry');

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.house_members (
  house_id uuid not null references public.houses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  joined_at timestamptz not null default now(),
  primary key (house_id, user_id)
);

create index house_members_user_id_idx on public.house_members (user_id);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  kind public.zone_kind not null,
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (house_id, kind)
);

alter table public.profiles
add column active_house_id uuid references public.houses (id) on delete set null;

create trigger houses_set_updated_at
before update on public.houses
for each row execute function public.set_updated_at();

create trigger zones_set_updated_at
before update on public.zones
for each row execute function public.set_updated_at();

-- Cada casa tiene exactamente estas tres zonas.
create function private.create_house_zones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.zones (house_id, kind, sort_order)
  values
    (new.id, 'fridge', 1),
    (new.id, 'freezer', 2),
    (new.id, 'pantry', 3);
  return new;
end;
$$;

create trigger houses_create_zones
after insert on public.houses
for each row execute function private.create_house_zones();

-- Es security definer para que la política de house_members no se llame a sí misma.
create function private.is_house_member(p_house_id uuid)
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
  );
$$;

alter table public.houses enable row level security;
alter table public.house_members enable row level security;
alter table public.zones enable row level security;

create policy "houses_select_member" on public.houses
for select to authenticated
using (private.is_house_member(id));

create policy "house_members_select_member" on public.house_members
for select to authenticated
using (private.is_house_member(house_id));

create policy "zones_select_member" on public.zones
for select to authenticated
using (private.is_house_member(house_id));

-- La casa activa solo puede ser una de la que se es miembro.
drop policy "profiles_update_own" on public.profiles;

create policy "profiles_update_own" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check (
  (select auth.uid()) = id
  and (active_house_id is null or private.is_house_member(active_house_id))
);

-- Se parte de cero por si el proyecto aplica permisos por defecto a las tablas nuevas.
revoke all on public.houses, public.house_members, public.zones from anon, authenticated;

-- Lectura desde el cliente. Las escrituras pasan por funciones.
grant select on public.houses, public.house_members, public.zones to authenticated;
grant update (active_house_id) on public.profiles to authenticated;

create function public.create_house(p_name text)
returns uuid
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

  insert into public.houses (name, created_by)
  values (btrim(p_name), v_user_id)
  returning id into v_house_id;

  insert into public.house_members (house_id, user_id, role)
  values (v_house_id, v_user_id, 'owner');

  update public.profiles
  set active_house_id = v_house_id
  where id = v_user_id;

  return v_house_id;
end;
$$;

revoke all on function public.create_house(text) from public, anon;
grant execute on function public.create_house(text) to authenticated;
