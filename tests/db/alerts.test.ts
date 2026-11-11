import type { PGlite, Transaction } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'
import { addMilk, createHousehold, rpc, type Household } from './inventoryHelpers'

let db: PGlite
let home: Household

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  home = await createHousehold(db)
})

/** Como la Edge Function, que llama con la clave secreta. */
async function asService<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return (await db.transaction(async (tx) => {
    await tx.exec('set local role service_role')
    return fn(tx)
  })) as T
}

interface DigestTarget {
  user_id: string
  locale: string
  day: string
  days_ahead: number
  house_id: string
  house_name: string
  items: { product_id: string; date: string; basis: string }[]
  subscriptions: { endpoint: string; p256dh: string; auth: string }[] | null
}

async function digestBatch(now: string) {
  return asService(async (tx) => {
    const { rows } = await tx.query<{ batch: DigestTarget[] }>('select public.digest_batch($1) as batch', [now])
    return rows[0]!.batch
  })
}

async function subscribe(person: Pick<Household, 'db' | 'userId'>, endpoint = `https://push.example.com/${crypto.randomUUID()}`) {
  await rpc(person, 'save_push_subscription', { p_endpoint: endpoint, p_p256dh: 'clave-p256dh', p_auth: 'secreto', p_user_agent: 'iPhone' })
  return endpoint
}

/** Ajustes de avisos del perfil: aviso a las 9, hora de Madrid. */
async function notifyAt(userId: string, hour = 9, timezone = 'Europe/Madrid', enabled = true) {
  await db.query('update public.profiles set notify_hour = $1, timezone = $2, notify_enabled = $3 where id = $4', [hour, timezone, enabled, userId])
}

// 08:00 en UTC son las 09:00 en Madrid en noviembre.
const nineInMadrid = '2026-11-11T08:00:00Z'

const mine = (batch: DigestTarget[]) => batch.filter((target) => target.house_id === home.houseId)

describe('guía de conservación', () => {
  it('cualquiera con sesión la lee, nadie la escribe', async () => {
    const reader = await createUser(db)
    const count = await asUser(db, reader, async (tx) => (await tx.query<{ n: number }>('select count(*)::int as n from public.shelf_life_guide')).rows[0]!.n)
    expect(count).toBeGreaterThan(0)

    await expect(asUser(db, reader, (tx) => tx.query(`delete from public.shelf_life_guide`))).rejects.toThrow(/permission denied/)
  })

  it('no se pueden mezclar producto y categoría en una fila', async () => {
    await expect(
      db.query(`insert into public.shelf_life_guide (catalog_item_id, category, state, min_days, max_days, note_es, note_en, source)
                select id, 'fish', 'opened', 1, 2, 'x', 'x', 'x' from public.catalog_items limit 1`),
    ).rejects.toThrow(/check/)
  })
})

describe('suscripciones a notificaciones', () => {
  it('cada persona ve solo las suyas', async () => {
    const endpoint = await subscribe(home)
    const other = await createUser(db)

    const own = await asUser(db, home.userId, async (tx) => (await tx.query('select endpoint from public.push_subscriptions')).rows)
    expect(own).toEqual([{ endpoint }])
    const others = await asUser(db, other, async (tx) => (await tx.query('select endpoint from public.push_subscriptions')).rows)
    expect(others).toEqual([])
  })

  it('volver a suscribir el mismo móvil actualiza las claves sin duplicar', async () => {
    const endpoint = await subscribe(home)
    await rpc(home, 'save_push_subscription', { p_endpoint: endpoint, p_p256dh: 'nueva', p_auth: 'nuevo' })

    const { rows } = await db.query<{ p256dh: string }>('select p256dh from public.push_subscriptions where endpoint = $1', [endpoint])
    expect(rows).toEqual([{ p256dh: 'nueva' }])
  })

  it('si en el móvil entra otra persona, la suscripción pasa a ella', async () => {
    const endpoint = await subscribe(home)
    const next = { db, userId: await createUser(db) }

    await subscribe(next, endpoint)

    const { rows } = await db.query<{ user_id: string }>('select user_id from public.push_subscriptions where endpoint = $1', [endpoint])
    expect(rows).toEqual([{ user_id: next.userId }])
  })

  it('cada persona solo borra las suyas', async () => {
    const endpoint = await subscribe(home)
    const other = { db, userId: await createUser(db) }

    await rpc(other, 'delete_push_subscription', { p_endpoint: endpoint })
    expect((await db.query('select 1 from public.push_subscriptions where endpoint = $1', [endpoint])).rows).toHaveLength(1)

    await rpc(home, 'delete_push_subscription', { p_endpoint: endpoint })
    expect((await db.query('select 1 from public.push_subscriptions where endpoint = $1', [endpoint])).rows).toHaveLength(0)
  })

  it('rechaza datos que no son de una suscripción', async () => {
    await expect(rpc(home, 'save_push_subscription', { p_endpoint: 'http://inseguro', p_p256dh: 'a', p_auth: 'b' })).rejects.toThrow('invalid_input')
    await expect(rpc(home, 'save_push_subscription', { p_endpoint: 'https://push.example.com/x', p_p256dh: '', p_auth: 'b' })).rejects.toThrow('invalid_input')
  })

  it('nadie escribe en la tabla directamente', async () => {
    await expect(
      asUser(db, home.userId, (tx) => tx.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x', 'a', 'b')`, [home.userId])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('notificación diaria', () => {
  beforeEach(async () => {
    await notifyAt(home.userId)
    await subscribe(home)
  })

  it('a la hora elegida, en la zona horaria de cada persona, incluye sus casas con fechas y suscripciones', async () => {
    await addMilk(home, 2, '2026-11-12')

    const [target] = mine(await digestBatch(nineInMadrid))

    expect(target).toMatchObject({ user_id: home.userId, house_name: 'Casa', day: '2026-11-11', days_ahead: 2, locale: 'es' })
    expect(target!.items).toEqual([expect.objectContaining({ date: '2026-11-12', basis: 'expiry' })])
    expect(target!.subscriptions).toHaveLength(1)
  })

  it('a otra hora, o con los avisos desactivados, no toca', async () => {
    expect(mine(await digestBatch('2026-11-11T09:00:00Z'))).toEqual([])

    await notifyAt(home.userId, 9, 'Europe/Madrid', false)
    expect(mine(await digestBatch(nineInMadrid))).toEqual([])
  })

  it('respeta la zona horaria: en Canarias las 9 llegan una hora después', async () => {
    await notifyAt(home.userId, 9, 'Atlantic/Canary')
    expect(mine(await digestBatch(nineInMadrid))).toEqual([])
    expect(mine(await digestBatch('2026-11-11T09:00:00Z'))).toHaveLength(1)
  })

  it('una zona horaria rara no rompe el envío a los demás', async () => {
    const other = await createHousehold(db)
    await notifyAt(other.userId, 9, 'Zona/Inventada')
    await subscribe(other)

    const batch = await digestBatch(nineInMadrid)

    expect(mine(batch)).toHaveLength(1)
    expect(batch.some((target) => target.user_id === other.userId)).toBe(true)
  })

  it('sin ningún móvil suscrito, no hay a quién avisar', async () => {
    await rpc(home, 'delete_push_subscription', {
      p_endpoint: (await db.query<{ endpoint: string }>('select endpoint from public.push_subscriptions where user_id = $1', [home.userId])).rows[0]!.endpoint,
    })
    expect(mine(await digestBatch(nineInMadrid))).toEqual([])
  })

  it('llega a cada miembro de la casa', async () => {
    const code = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    const member = { db, userId: await createUser(db) }
    await rpc(member, 'join_house', { p_code: code })
    await notifyAt(member.userId)
    await subscribe(member)

    const users = mine(await digestBatch(nineInMadrid)).map((target) => target.user_id)
    expect(users.sort()).toEqual([home.userId, member.userId].sort())
  })

  it('una sola vez por persona, casa y día, aunque la tarea se repita', async () => {
    const claim = () =>
      asService(async (tx) => (await tx.query<{ ok: boolean }>('select public.claim_digest($1, $2, $3) as ok', [home.userId, home.houseId, '2026-11-11'])).rows[0]!.ok)

    expect(await claim()).toBe(true)
    expect(await claim()).toBe(false)
    expect(mine(await digestBatch(nineInMadrid))).toEqual([])
    // Al día siguiente vuelve a tocar.
    expect(mine(await digestBatch('2026-11-12T08:00:00Z'))).toHaveLength(1)
  })

  it('incluye las unidades abiertas y deja fuera lo que no tiene fecha o ya no queda', async () => {
    await addMilk(home, 1, '2026-12-01')
    await rpc(home, 'open_unit', {
      p_product_id: (await db.query<{ id: string }>('select id from public.products where house_id = $1', [home.houseId])).rows[0]!.id,
      p_reminder_date: '2026-11-13',
    })
    await addMilk(home, 1, null, { p_name: 'Agua', p_quantity_kind: 'count', p_unit_label: 'bottle' })

    const [target] = mine(await digestBatch(nineInMadrid))

    expect(target!.items).toEqual([expect.objectContaining({ date: '2026-11-13', basis: 'reminder' })])
  })

  it('el servicio puede olvidar una suscripción que ya no existe', async () => {
    const endpoint = (await db.query<{ endpoint: string }>('select endpoint from public.push_subscriptions where user_id = $1', [home.userId])).rows[0]!.endpoint
    await asService((tx) => tx.query('select public.forget_push_subscription($1)', [endpoint]))
    expect((await db.query('select 1 from public.push_subscriptions where endpoint = $1', [endpoint])).rows).toHaveLength(0)
  })

  it('ni con sesión ni sin ella se pueden usar las funciones del servicio', async () => {
    for (const statement of [
      `select public.digest_batch()`,
      `select public.claim_digest('${home.userId}', '${home.houseId}', '2026-11-11')`,
      `select public.forget_push_subscription('https://x')`,
    ]) {
      await expect(asUser(db, home.userId, (tx) => tx.query(statement))).rejects.toThrow(/permission denied/)
      await expect(
        db.transaction(async (tx) => {
          await tx.exec('set local role anon')
          await tx.query(statement)
        }),
      ).rejects.toThrow(/permission denied/)
    }
  })
})
