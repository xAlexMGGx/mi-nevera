-- Fase 0: perfil de usuario (SPEC §5.1).
-- `active_house_id` se añade en la fase 1, junto con la tabla `houses`.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  locale text not null default 'es' check (locale in ('es', 'en')),
  timezone text not null default 'Europe/Madrid',
  notify_enabled boolean not null default true,
  notify_hour smallint not null default 9 check (notify_hour between 0 and 23),
  notify_days_ahead smallint not null default 2 check (notify_days_ahead >= 0),
  recipe_preferences text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- RLS: cada persona solo ve y edita su propio perfil. Lo crea el trigger de abajo.
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

create policy "profiles_update_own" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Supabase ya no expone las tablas nuevas automáticamente: los permisos son explícitos.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (
  display_name,
  locale,
  timezone,
  notify_enabled,
  notify_hour,
  notify_days_ahead,
  recipe_preferences
) on public.profiles to authenticated;

-- Crea el perfil al registrarse. Los metadatos los envía el cliente, así que se
-- sanean aquí: un valor raro nunca debe impedir que alguien se registre.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80),
    case when requested_locale in ('es', 'en') then requested_locale else 'es' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
