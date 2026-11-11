-- Fase 3: avisos y conservación (SPEC §5.5, §7.3, §8 y §9).

---------------------------------------------------------------------------------------------------
-- Guía de conservación: alimenta los chips orientativos. Los datos llegan en otra migración,
-- generada a partir de src/content/conservation/shelf-life.json.
---------------------------------------------------------------------------------------------------

create type public.shelf_state as enum ('opened', 'frozen', 'thawed', 'cooked', 'closed_fridge', 'closed_pantry');

create table public.shelf_life_guide (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid references public.catalog_items (id) on delete cascade,
  category public.category,
  state public.shelf_state not null,
  -- Sin días: la fuente desaconseja ese estado, por ejemplo congelar huevos con cáscara.
  min_days integer check (min_days > 0),
  max_days integer,
  note_es text not null,
  note_en text not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((catalog_item_id is null) <> (category is null)),
  check ((min_days is null) = (max_days is null)),
  check (max_days >= min_days)
);

create unique index shelf_life_guide_item_key
on public.shelf_life_guide (catalog_item_id, state)
where catalog_item_id is not null;
create unique index shelf_life_guide_category_key
on public.shelf_life_guide (category, state)
where category is not null;

create trigger shelf_life_guide_set_updated_at
before update on public.shelf_life_guide
for each row execute function public.set_updated_at();

alter table public.shelf_life_guide enable row level security;

create policy "shelf_life_guide_select_authenticated" on public.shelf_life_guide
for select to authenticated
using (true);

revoke all on public.shelf_life_guide from anon, authenticated;
grant select on public.shelf_life_guide to authenticated;

---------------------------------------------------------------------------------------------------
-- Suscripciones a notificaciones: una por móvil
---------------------------------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- Si el móvil ya estaba suscrito con otra cuenta (se cerró sesión y entró otra persona), pasa a esta:
-- las notificaciones deben llegar a quien usa ahora el móvil.
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(p_endpoint, '') not like 'https://%' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid_input';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent;
end;
$$;

create function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = (select auth.uid());
end;
$$;

---------------------------------------------------------------------------------------------------
-- Notificación diaria (SPEC §8). La envía la Edge Function daily-digest, que llama a estas
-- funciones con la clave secreta: el cliente no puede usarlas.
---------------------------------------------------------------------------------------------------

-- Lo ya enviado: una sola notificación por persona, casa y día, aunque la tarea se repita.
create table private.digest_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  house_id uuid not null references public.houses (id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, house_id, day)
);

-- Una zona horaria rara en un perfil no debe parar los avisos de los demás.
create function private.local_time(p_timezone text, p_now timestamptz)
returns timestamp
language plpgsql
stable
set search_path = ''
as $$
begin
  return p_now at time zone p_timezone;
exception
  when others then
    return p_now at time zone 'Europe/Madrid';
end;
$$;

-- Quién debe recibir ahora su resumen, de qué casas, y con qué fechas. El estado de cada fecha y el
-- texto los calcula la Edge Function con la misma regla que la app (_shared/dateStatus.ts).
create function public.digest_batch(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select
      p.id as user_id,
      p.locale,
      p.notify_days_ahead as days_ahead,
      private.local_time(p.timezone, p_now)::date as day
    from public.profiles p
    where p.notify_enabled
      and extract(hour from private.local_time(p.timezone, p_now)) = p.notify_hour
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  ),
  targets as (
    select d.*, h.id as house_id, h.name as house_name
    from due d
    join public.house_members m on m.user_id = d.user_id
    join public.houses h on h.id = m.house_id
    where not exists (
      select 1
      from private.digest_log g
      where g.user_id = d.user_id and g.house_id = h.id and g.day = d.day
    )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', t.user_id,
        'locale', t.locale,
        'day', t.day,
        'days_ahead', t.days_ahead,
        'house_id', t.house_id,
        'house_name', t.house_name,
        'items', coalesce(
          (
            select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'date', x.effective_date, 'basis', x.effective_basis))
            from (
              select l.product_id, l.effective_date, l.effective_basis
              from public.lots_with_dates l
              where l.house_id = t.house_id and l.quantity > 0 and l.effective_date is not null
              union all
              select l.product_id, u.effective_date, u.effective_basis
              from public.opened_units_with_dates u
              join public.lots l on l.id = u.lot_id
              where u.house_id = t.house_id and u.effective_date is not null
            ) x
          ),
          '[]'::jsonb
        ),
        'subscriptions', (
          select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
          from public.push_subscriptions s
          where s.user_id = t.user_id
        )
      )
    ),
    '[]'::jsonb
  )
  from targets t;
$$;

-- Se apunta antes de enviar: si dos ejecuciones coinciden, solo una gana y envía.
create function public.claim_digest(p_user_id uuid, p_house_id uuid, p_day date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.digest_log (user_id, house_id, day)
  values (p_user_id, p_house_id, p_day)
  on conflict do nothing;
  return found;
end;
$$;

-- El servicio de notificaciones dice que esa suscripción ya no existe (app desinstalada, permiso retirado).
create function public.forget_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

---------------------------------------------------------------------------------------------------
-- Tarea horaria: cada hora en punto llama a daily-digest, que avisa a quien le toca a esa hora.
-- Necesita dos secretos en Vault que crea el propietario (SETUP.md, paso 12): la URL del proyecto y la
-- clave secreta. Donde no hay pg_cron ni pg_net, como en los tests, no se programa nada.
---------------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
    and exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;

    perform cron.schedule(
      'nevera-daily-digest',
      '0 * * * *',
      $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-digest',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        );
      $job$
    );
  end if;
end;
$$;

---------------------------------------------------------------------------------------------------
-- Permisos
---------------------------------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_house_member(uuid) to authenticated;
grant execute on function private.is_house_owner(uuid) to authenticated;
grant execute on function private.compute_effective(date, public.printed_date_type, date, date, date, boolean, boolean) to authenticated;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Solo para la Edge Function, con la clave secreta.
revoke all on function public.digest_batch(timestamptz) from public, anon, authenticated;
revoke all on function public.claim_digest(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.forget_push_subscription(text) from public, anon, authenticated;
grant execute on function public.digest_batch(timestamptz) to service_role;
grant execute on function public.claim_digest(uuid, uuid, date) to service_role;
grant execute on function public.forget_push_subscription(text) to service_role;
