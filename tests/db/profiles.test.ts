import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'

interface ProfileRow {
  id: string
  display_name: string
  locale: string
  timezone: string
  notify_enabled: boolean
  notify_hour: number
  notify_days_ahead: number
}

describe('profiles', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createTestDb()
  })

  async function profileOf(id: string) {
    const { rows } = await db.query<ProfileRow>('select * from public.profiles where id = $1', [id])
    return rows[0]
  }

  it('crea el perfil al registrarse, con los valores por defecto del SPEC', async () => {
    const id = await createUser(db, { display_name: '  Ana  ', locale: 'en' })

    expect(await profileOf(id)).toMatchObject({
      display_name: 'Ana',
      locale: 'en',
      timezone: 'Europe/Madrid',
      notify_enabled: true,
      notify_hour: 9,
      notify_days_ahead: 2,
    })
  })

  it('un idioma o un nombre raros no impiden registrarse', async () => {
    const id = await createUser(db, { locale: 'fr', display_name: 'x'.repeat(200) })
    const profile = await profileOf(id)

    expect(profile?.locale).toBe('es')
    expect(profile?.display_name).toHaveLength(80)
  })

  it('cada persona solo ve su propio perfil', async () => {
    const ana = await createUser(db)
    await createUser(db)

    const { rows } = await asUser(db, ana, (tx) => tx.query<ProfileRow>('select id from public.profiles'))

    expect(rows.map((row) => row.id)).toEqual([ana])
  })

  it('cada persona puede editar su perfil y se actualiza updated_at', async () => {
    const ana = await createUser(db)
    const before = await db.query<{ updated_at: Date }>('select updated_at from public.profiles where id = $1', [ana])

    await asUser(db, ana, (tx) =>
      tx.query(`update public.profiles set locale = 'en', display_name = 'Ana' where id = $1`, [ana]),
    )

    const after = await db.query<{ updated_at: Date; locale: string }>(
      'select updated_at, locale from public.profiles where id = $1',
      [ana],
    )
    expect(after.rows[0]?.locale).toBe('en')
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.rows[0]!.updated_at.getTime())
  })

  it('nadie puede editar el perfil de otra persona', async () => {
    const ana = await createUser(db, { display_name: 'Ana' })
    const luis = await createUser(db)

    const result = await asUser(db, luis, (tx) =>
      tx.query(`update public.profiles set display_name = 'Pirata' where id = $1`, [ana]),
    )

    expect(result.affectedRows).toBe(0)
    expect((await profileOf(ana))?.display_name).toBe('Ana')
  })

  it('no se puede cambiar el id, ni crear o borrar perfiles desde el cliente', async () => {
    const ana = await createUser(db)
    const statements = [
      `update public.profiles set id = gen_random_uuid() where id = '${ana}'`,
      `insert into public.profiles (id) values ('${ana}')`,
      `delete from public.profiles where id = '${ana}'`,
    ]

    for (const statement of statements) {
      await expect(asUser(db, ana, (tx) => tx.query(statement))).rejects.toThrow(/permission denied/)
    }
  })

  it('un visitante sin sesión no puede leer perfiles', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon')
        await tx.query('select * from public.profiles')
      }),
    ).rejects.toThrow(/permission denied/)
  })

  it('el perfil se borra con la cuenta', async () => {
    const ana = await createUser(db)

    await db.query('delete from auth.users where id = $1', [ana])

    expect(await profileOf(ana)).toBeUndefined()
  })
})
