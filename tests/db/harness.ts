import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'

const migrationsDir = join(import.meta.dirname, '..', '..', 'supabase', 'migrations')

// Lo mínimo de Supabase que necesitan las migraciones. No hay permisos por defecto,
// así los tests comprueban que los GRANT de cada migración son suficientes.
const supabaseStub = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
  $$;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;

  create publication supabase_realtime;
`

/** Postgres real en memoria con todas las migraciones del repo aplicadas. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(supabaseStub)
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
  return db
}

export async function createUser(db: PGlite, metadata: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'insert into auth.users (raw_user_meta_data) values ($1) returning id',
    [JSON.stringify(metadata)],
  )
  return rows[0]!.id
}

/** Ejecuta `fn` con los permisos y la identidad de ese usuario, como haría una petición real. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const result = await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })])
    await tx.exec('set local role authenticated')
    return fn(tx)
  })
  return result as T
}
