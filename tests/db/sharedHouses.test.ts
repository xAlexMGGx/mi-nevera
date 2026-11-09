import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'
import { addMilk, createHousehold, lotsOf, movementsOf, productIdByName, rpc, unitsOf, type Household } from './inventoryHelpers'

let db: PGlite
let home: Household

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  home = await createHousehold(db)
})

/** Una persona nueva que entra en la casa con una invitación. */
async function joinWithInvite(house: Household, name = 'Berta') {
  const person = { db, userId: await createUser(db, { display_name: name }) }
  await joinAs(person, house)
  return person
}

async function joinAs(person: Pick<Household, 'db' | 'userId'>, house: Pick<Household, 'db' | 'userId' | 'houseId'>) {
  const code = await rpc(house, 'create_invite', { p_house_id: house.houseId })
  await rpc(person, 'join_house', { p_code: code })
}

async function membersOf(houseId: string) {
  const { rows } = await db.query<{ user_id: string; role: string }>(
    'select user_id, role from public.house_members where house_id = $1 order by joined_at, user_id',
    [houseId],
  )
  return rows
}

async function activeHouseOf(userId: string) {
  const { rows } = await db.query<{ active_house_id: string | null }>('select active_house_id from public.profiles where id = $1', [userId])
  return rows[0]?.active_house_id
}

async function houseExists(houseId: string) {
  const { rows } = await db.query('select 1 from public.houses where id = $1', [houseId])
  return rows.length === 1
}

async function versionOf(houseId: string) {
  const { rows } = await db.query<{ version: string }>('select version from public.house_changes where house_id = $1', [houseId])
  return Number(rows[0]!.version)
}

/** Otra casa de la misma persona, para mover cosas entre las dos. */
async function secondHouse(owner: Household = home, name = 'Playa'): Promise<Household> {
  const houseId = await rpc(owner, 'create_house', { p_name: name })
  const { rows } = await db.query<{ id: string; kind: 'fridge' | 'freezer' | 'pantry' }>('select id, kind from public.zones where house_id = $1', [houseId])
  return { db, userId: owner.userId, houseId, zones: Object.fromEntries(rows.map((zone) => [zone.kind, zone.id])) as Household['zones'] }
}

describe('invitaciones', () => {
  it('con un código se entra como editor y la casa queda activa', async () => {
    const person = await joinWithInvite(home)

    expect(await membersOf(home.houseId)).toEqual([
      { user_id: home.userId, role: 'owner' },
      { user_id: person.userId, role: 'editor' },
    ])
    expect(await activeHouseOf(person.userId)).toBe(home.houseId)
  })

  it('el código tiene 8 caracteres fáciles de leer y caduca a los 7 días', async () => {
    const code = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)

    const { rows } = await db.query<{ days: string }>(
      `select round(extract(epoch from expires_at - created_at) / 86400) as days from public.house_invites where code = $1`,
      [code],
    )
    expect(Number(rows[0]!.days)).toBe(7)
  })

  it('el código se acepta en minúsculas, con espacios y con guion', async () => {
    const code = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    const person = { db, userId: await createUser(db) }
    const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `

    expect(await rpc(person, 'join_house', { p_code: typed })).toBe(home.houseId)
  })

  it('un código solo sirve una vez', async () => {
    const code = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    await rpc({ db, userId: await createUser(db) }, 'join_house', { p_code: code })

    await expect(rpc({ db, userId: await createUser(db) }, 'join_house', { p_code: code })).rejects.toThrow('invalid_invite')
  })

  it('rechaza códigos inexistentes, caducados y anulados', async () => {
    const person = { db, userId: await createUser(db) }
    await expect(rpc(person, 'join_house', { p_code: 'NOEXISTE' })).rejects.toThrow('invalid_invite')

    const expired = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    await db.query(`update public.house_invites set expires_at = now() - interval '1 minute' where code = $1`, [expired])
    await expect(rpc(person, 'join_house', { p_code: expired })).rejects.toThrow('invalid_invite')

    const revoked = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    const { rows } = await db.query<{ id: string }>('select id from public.house_invites where code = $1', [revoked])
    await rpc(home, 'revoke_invite', { p_invite_id: rows[0]!.id })
    await expect(rpc(person, 'join_house', { p_code: revoked })).rejects.toThrow('invalid_invite')
  })

  it('quien ya es miembro no gasta el código', async () => {
    const code = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    await expect(rpc(home, 'join_house', { p_code: code })).rejects.toThrow('already_member')

    expect(await rpc({ db, userId: await createUser(db) }, 'join_house', { p_code: code })).toBe(home.houseId)
  })

  it('solo el propietario crea, ve y anula invitaciones', async () => {
    const person = await joinWithInvite(home)
    const outsider = { db, userId: await createUser(db) }

    await expect(rpc(person, 'create_invite', { p_house_id: home.houseId })).rejects.toThrow('not_owner')
    await expect(rpc(outsider, 'create_invite', { p_house_id: home.houseId })).rejects.toThrow('not_member')

    const code = await rpc(home, 'create_invite', { p_house_id: home.houseId })
    const { rows } = await db.query<{ id: string }>('select id from public.house_invites where code = $1', [code])
    await expect(rpc(person, 'revoke_invite', { p_invite_id: rows[0]!.id })).rejects.toThrow('not_owner')

    const seenBy = (userId: string) =>
      asUser(db, userId, async (tx) => (await tx.query('select code from public.house_invites where house_id = $1', [home.houseId])).rows.length)
    expect(await seenBy(home.userId)).toBeGreaterThan(0)
    expect(await seenBy(person.userId)).toBe(0)
    expect(await seenBy(outsider.userId)).toBe(0)
  })

  it('sin sesión no se puede usar', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon')
        await tx.query(`select public.join_house('ABCDEFGH')`)
      }),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('roles y salidas', () => {
  it('solo el propietario renombra y borra', async () => {
    const person = await joinWithInvite(home)

    await expect(rpc(person, 'rename_house', { p_house_id: home.houseId, p_name: 'Mía' })).rejects.toThrow('not_owner')
    await expect(rpc(person, 'delete_house', { p_house_id: home.houseId })).rejects.toThrow('not_owner')
    expect(await houseExists(home.houseId)).toBe(true)

    await rpc(home, 'rename_house', { p_house_id: home.houseId, p_name: '  Casa grande ' })
    const { rows } = await db.query<{ name: string }>('select name from public.houses where id = $1', [home.houseId])
    expect(rows[0]!.name).toBe('Casa grande')
  })

  it('una casa no se puede quedar sin nombre', async () => {
    await expect(rpc(home, 'rename_house', { p_house_id: home.houseId, p_name: '   ' })).rejects.toThrow('invalid_input')
  })

  it('al borrar la casa desaparece todo y cada miembro pasa a otra de las suyas', async () => {
    const person = await joinWithInvite(home)
    const personHome = { db, userId: person.userId, houseId: await rpc(person, 'create_house', { p_name: 'Suya' }) }
    await rpc(person, 'join_house', { p_code: await rpc(home, 'create_invite', { p_house_id: await rpc(home, 'create_house', { p_name: 'Otra' }) }) })
    await db.query('update public.profiles set active_house_id = $1 where id = $2', [home.houseId, person.userId])
    await db.query('update public.profiles set active_house_id = $1 where id = $2', [home.houseId, home.userId])
    await addMilk(home, 2, '2026-12-01')

    await rpc(home, 'delete_house', { p_house_id: home.houseId })

    expect(await houseExists(home.houseId)).toBe(false)
    for (const table of ['zones', 'products', 'lots', 'movements', 'house_changes', 'house_invites']) {
      const { rows } = await db.query(`select 1 from public.${table} where house_id = $1`, [home.houseId])
      expect(rows, table).toHaveLength(0)
    }
    expect(await activeHouseOf(person.userId)).toBe(personHome.houseId)
    expect(await activeHouseOf(home.userId)).not.toBeNull()
  })

  it('quien se queda sin casas vuelve a la bienvenida', async () => {
    const person = await joinWithInvite(home)

    await rpc(home, 'delete_house', { p_house_id: home.houseId })

    expect(await activeHouseOf(home.userId)).toBeNull()
    expect(await activeHouseOf(person.userId)).toBeNull()
  })

  it('un editor puede salir sin afectar a los demás', async () => {
    const person = await joinWithInvite(home)

    await rpc(person, 'leave_house', { p_house_id: home.houseId })

    expect(await membersOf(home.houseId)).toEqual([{ user_id: home.userId, role: 'owner' }])
    expect(await activeHouseOf(person.userId)).toBeNull()
    expect(await activeHouseOf(home.userId)).toBe(home.houseId)
  })

  it('si sale el propietario, la propiedad pasa al miembro más antiguo', async () => {
    const first = await joinWithInvite(home, 'Primera')
    await db.query(`update public.house_members set joined_at = now() - interval '2 days' where user_id = $1`, [first.userId])
    await joinWithInvite(home, 'Segunda')

    await rpc(home, 'leave_house', { p_house_id: home.houseId })

    const members = await membersOf(home.houseId)
    expect(members).toHaveLength(2)
    expect(members.find((member) => member.user_id === first.userId)?.role).toBe('owner')
    expect(members.filter((member) => member.role === 'owner')).toHaveLength(1)
  })

  it('si sale la última persona, la casa se borra', async () => {
    await rpc(home, 'leave_house', { p_house_id: home.houseId })
    expect(await houseExists(home.houseId)).toBe(false)
  })

  it('quien no es miembro no puede salir', async () => {
    await expect(rpc({ db, userId: await createUser(db) }, 'leave_house', { p_house_id: home.houseId })).rejects.toThrow('not_member')
  })

  it('solo el propietario expulsa, y no a sí mismo', async () => {
    const person = await joinWithInvite(home)
    const other = await joinWithInvite(home, 'Carla')

    await expect(rpc(person, 'remove_member', { p_house_id: home.houseId, p_user_id: other.userId })).rejects.toThrow('not_owner')
    await expect(rpc(home, 'remove_member', { p_house_id: home.houseId, p_user_id: home.userId })).rejects.toThrow('invalid_input')

    await rpc(home, 'remove_member', { p_house_id: home.houseId, p_user_id: other.userId })

    expect((await membersOf(home.houseId)).map((member) => member.user_id)).toEqual([home.userId, person.userId])
    expect(await activeHouseOf(other.userId)).toBeNull()
  })

  it('la persona expulsada deja de ver la casa y de poder operar en ella', async () => {
    const person = await joinWithInvite(home)
    await addMilk(home, 2, '2026-12-01')
    const [lot] = await lotsOf(home)

    await rpc(home, 'remove_member', { p_house_id: home.houseId, p_user_id: person.userId })

    const seen = await asUser(db, person.userId, async (tx) => (await tx.query('select 1 from public.lots where house_id = $1', [home.houseId])).rows.length)
    expect(seen).toBe(0)
    await expect(rpc(person, 'consume', { p_lot_id: lot!.id })).rejects.toThrow('not_member')
  })

  it('los miembros se ven por su nombre, sin acceder al perfil de los demás', async () => {
    const person = await joinWithInvite(home, 'Berta')

    const members = await asUser(db, person.userId, async (tx) => {
      const { rows } = await tx.query<{ display_name: string; role: string }>('select display_name, role from public.list_house_members($1)', [home.houseId])
      return rows
    })
    expect(members).toEqual([
      { display_name: 'Ana', role: 'owner' },
      { display_name: 'Berta', role: 'editor' },
    ])

    const profiles = await asUser(db, person.userId, async (tx) => (await tx.query('select id from public.profiles')).rows)
    expect(profiles).toEqual([{ id: person.userId }])

    await expect(asUser(db, (await createUser(db)), (tx) => tx.query('select * from public.list_house_members($1)', [home.houseId]))).rejects.toThrow('not_member')
  })

  it('la casa activa se puede cambiar a otra de las suyas', async () => {
    const second = await secondHouse()
    await asUser(db, home.userId, (tx) => tx.query('update public.profiles set active_house_id = $1 where id = $2', [home.houseId, home.userId]))
    expect(await activeHouseOf(home.userId)).toBe(home.houseId)
    await asUser(db, home.userId, (tx) => tx.query('update public.profiles set active_house_id = $1 where id = $2', [second.houseId, home.userId]))
    expect(await activeHouseOf(home.userId)).toBe(second.houseId)
  })
})

describe('señal de tiempo real', () => {
  it('cada casa tiene su señal y solo la ven sus miembros', async () => {
    const outsider = await createUser(db)
    const seenBy = (userId: string) =>
      asUser(db, userId, async (tx) => (await tx.query('select version from public.house_changes where house_id = $1', [home.houseId])).rows.length)

    expect(await seenBy(home.userId)).toBe(1)
    expect(await seenBy(outsider)).toBe(0)
  })

  it('cambia con cada operación del inventario, incluido deshacer', async () => {
    const before = await versionOf(home.houseId)
    const added = await addMilk(home, 2, '2026-12-01')
    const afterAdd = await versionOf(home.houseId)
    expect(afterAdd).toBeGreaterThan(before)

    await rpc(home, 'undo_movement', { p_movement_id: added })
    expect(await versionOf(home.houseId)).toBeGreaterThan(afterAdd)
  })

  it('cambia al editar o borrar un producto, que no generan movimiento', async () => {
    await addMilk(home, 1, '2026-12-01')
    const product = (await productIdByName(home, 'Leche'))!
    const start = await versionOf(home.houseId)

    await rpc(home, 'update_product', { p_product_id: product, p_patch: { preferred_brand: 'Pascual' } })
    const afterUpdate = await versionOf(home.houseId)
    expect(afterUpdate).toBeGreaterThan(start)

    await rpc(home, 'consume', { p_product_id: product })
    const afterConsume = await versionOf(home.houseId)
    await rpc(home, 'delete_product', { p_product_id: product })
    expect(await versionOf(home.houseId)).toBeGreaterThan(afterConsume)
  })

  it('cambia al renombrar la casa y al entrar o salir alguien', async () => {
    const start = await versionOf(home.houseId)
    await rpc(home, 'rename_house', { p_house_id: home.houseId, p_name: 'Otro nombre' })
    const renamed = await versionOf(home.houseId)
    expect(renamed).toBeGreaterThan(start)

    const person = await joinWithInvite(home)
    const joined = await versionOf(home.houseId)
    expect(joined).toBeGreaterThan(renamed)

    await rpc(person, 'leave_house', { p_house_id: home.houseId })
    expect(await versionOf(home.houseId)).toBeGreaterThan(joined)
  })

  it('una operación en una casa no avisa a las demás', async () => {
    const other = await createHousehold(db)
    const before = await versionOf(other.houseId)
    await addMilk(home, 1, null)
    expect(await versionOf(other.houseId)).toBe(before)
  })

  it('solo se publican la señal y el perfil, nunca el historial', async () => {
    const { rows } = await db.query<{ tablename: string }>(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)
    expect(rows.map((row) => row.tablename)).toEqual(['house_changes', 'profiles'])
  })
})

describe('mover entre casas', () => {
  let beach: Household

  beforeEach(async () => {
    beach = await secondHouse()
  })

  async function move(lotId: string, quantity: number, zone: string, extra: Record<string, unknown> = {}) {
    return rpc(home, 'move_lot', { p_lot_id: lotId, p_quantity: quantity, p_target_zone_id: zone, ...extra })
  }

  it('mover una parte divide el lote y conserva fecha, tipo y marca', async () => {
    await addMilk(home, 6, '2026-12-01', { p_brand: 'Hacendado' })
    const [lot] = await lotsOf(home)

    await move(lot!.id, 2, beach.zones.pantry)

    const [source] = await lotsOf(home)
    expect(Number(source!.quantity)).toBe(4)
    const [target] = await lotsOf(beach)
    expect(target).toMatchObject({ zone_id: beach.zones.pantry, printed_date: '2026-12-01', printed_date_type: 'expiry', brand: 'Hacendado' })
    expect(Number(target!.quantity)).toBe(2)
  })

  it('mover todo vacía el origen y conserva el producto allí', async () => {
    await addMilk(home, 2, '2026-12-01')
    const [lot] = await lotsOf(home)

    await move(lot!.id, 2, beach.zones.fridge)

    expect(await lotsOf(home)).toHaveLength(0)
    expect(await productIdByName(home, 'Leche')).toBeDefined()
    expect(await lotsOf(beach)).toHaveLength(1)
  })

  it('si el producto no existe en la otra casa, lo crea con su forma de contar, marca y notas', async () => {
    await addMilk(home, 1, '2026-12-01')
    const source = (await productIdByName(home, 'Leche'))!
    await rpc(home, 'update_product', { p_product_id: source, p_patch: { preferred_brand: 'Pascual', brand_notes: 'La buena' } })
    const [lot] = await lotsOf(home)

    await move(lot!.id, 1, beach.zones.fridge)

    const { rows } = await db.query('select name, quantity_kind, unit_label, content_amount, content_unit, preferred_brand, brand_notes from public.products where house_id = $1', [beach.houseId])
    expect(rows).toEqual([
      { name: 'Leche', quantity_kind: 'divisible', unit_label: 'brick', content_amount: '1', content_unit: 'l', preferred_brand: 'Pascual', brand_notes: 'La buena' },
    ])
  })

  it('empareja con el producto de la otra casa por nombre, sin tildes ni mayúsculas', async () => {
    await rpc(home, 'add_lot', { p_house_id: home.houseId, p_zone_id: home.zones.pantry, p_quantity: 2, p_name: 'Azúcar', p_quantity_kind: 'count', p_unit_label: 'package' })
    await rpc(beach, 'add_lot', { p_house_id: beach.houseId, p_zone_id: beach.zones.pantry, p_quantity: 1, p_name: 'AZUCAR', p_quantity_kind: 'count', p_unit_label: 'package' })
    const [lot] = await lotsOf(home)

    await move(lot!.id, 2, beach.zones.fridge)

    const { rows } = await db.query('select id from public.products where house_id = $1', [beach.houseId])
    expect(rows).toHaveLength(1)
    expect(await lotsOf(beach)).toHaveLength(2)
  })

  it('empareja por catálogo aunque en la otra casa tenga otro nombre', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.catalog_items where slug = 'leche-entera' or default_quantity_kind = 'divisible' order by slug limit 1`)
    const catalogId = rows[0]!.id
    await rpc(home, 'add_lot', { p_house_id: home.houseId, p_zone_id: home.zones.fridge, p_quantity: 1, p_catalog_item_id: catalogId })
    await rpc(beach, 'add_lot', { p_house_id: beach.houseId, p_zone_id: beach.zones.fridge, p_quantity: 1, p_catalog_item_id: catalogId })
    const target = await db.query<{ id: string }>('select id from public.products where house_id = $1', [beach.houseId])
    await rpc(beach, 'update_product', { p_product_id: target.rows[0]!.id, p_patch: { name: 'La de siempre' } })
    const [lot] = await lotsOf(home)

    await move(lot!.id, 1, beach.zones.pantry)

    const products = await db.query<{ id: string; name: string }>('select id, name from public.products where house_id = $1', [beach.houseId])
    expect(products.rows).toEqual([{ id: target.rows[0]!.id, name: 'La de siempre' }])
  })

  it('se fusiona con un lote idéntico de la otra casa', async () => {
    await addMilk(home, 2, '2026-12-01')
    await addMilk(beach, 3, '2026-12-01')
    const [lot] = await lotsOf(home)

    await move(lot!.id, 2, beach.zones.fridge)

    const lots = await lotsOf(beach)
    expect(lots).toHaveLength(1)
    expect(Number(lots[0]!.quantity)).toBe(5)
  })

  it('rechaza mezclar productos que se cuentan de otra forma, sin cambiar nada', async () => {
    await addMilk(home, 2, '2026-12-01')
    await addMilk(beach, 1, '2026-12-01', { p_content_amount: 0.5, p_content_unit: 'l' })
    const [lot] = await lotsOf(home)

    await expect(move(lot!.id, 2, beach.zones.fridge)).rejects.toThrow('incompatible_product')

    expect(Number((await lotsOf(home))[0]!.quantity)).toBe(2)
    expect(await lotsOf(beach)).toHaveLength(1)
  })

  it('conserva el estado congelado de congelador a congelador', async () => {
    await addMilk(home, 1, '2026-12-01', { p_zone_id: home.zones.freezer, p_frozen_at: '2026-10-01', p_reminder_date: '2027-01-01' })
    const [lot] = await lotsOf(home)

    await move(lot!.id, 1, beach.zones.freezer, { p_reminder_date: '2030-01-01' })

    expect((await lotsOf(beach))[0]).toMatchObject({ frozen_at: '2026-10-01', thawed_at: null, reminder_date: '2027-01-01' })
  })

  it('del frigo a otro congelador es congelar, y del congelador a otro frigo, descongelar', async () => {
    await addMilk(home, 1, '2026-12-01')
    await addMilk(home, 1, '2026-12-02', { p_zone_id: home.zones.freezer })
    const lots = await lotsOf(home)
    const toFreeze = lots.find((row) => row.zone_id === home.zones.fridge)!
    const toThaw = lots.find((row) => row.zone_id === home.zones.freezer)!

    await move(toFreeze.id, 1, beach.zones.freezer, { p_reminder_date: '2027-02-01' })
    await move(toThaw.id, 1, beach.zones.fridge, { p_reminder_date: '2026-12-20' })

    const moved = await lotsOf(beach)
    const frozen = moved.find((row) => row.zone_id === beach.zones.freezer)!
    expect(frozen.frozen_at).not.toBeNull()
    expect(frozen).toMatchObject({ thawed_at: null, reminder_date: '2027-02-01' })
    const thawed = moved.find((row) => row.zone_id === beach.zones.fridge)!
    expect(thawed.thawed_at).not.toBeNull()
    expect(thawed.reminder_date).toBe('2026-12-20')
  })

  it('las unidades abiertas viajan con su fracción y cambian de casa', async () => {
    await addMilk(home, 3, '2026-12-01')
    await rpc(home, 'open_unit', { p_product_id: await productIdByName(home, 'Leche') })
    const [lot] = await lotsOf(home)
    const [unit] = await unitsOf(home)
    await rpc(home, 'set_remaining', { p_opened_unit_id: unit!.id, p_fraction: 0.6 })

    await move(lot!.id, 0, beach.zones.fridge, { p_opened_unit_ids: [unit!.id] })

    expect(await unitsOf(home)).toHaveLength(0)
    const [moved] = await unitsOf(beach)
    expect(moved).toMatchObject({ id: unit!.id, remaining_fraction: '0.6' })
    expect(moved!.lot_id).toBe((await lotsOf(beach))[0]!.id)
  })

  it('un lote abierto a granel sigue abierto', async () => {
    await rpc(home, 'add_lot', { p_house_id: home.houseId, p_zone_id: home.zones.fridge, p_quantity: 500, p_name: 'Queso', p_quantity_kind: 'bulk', p_unit_label: 'unit', p_bulk_unit: 'g' })
    const [lot] = await lotsOf(home)
    await rpc(home, 'open_unit', { p_lot_id: lot!.id })

    await move(lot!.id, 200, beach.zones.fridge)

    expect((await lotsOf(beach))[0]!.opened_at).not.toBeNull()
  })

  it('un táper es otro táper en la otra casa, con el número libre más bajo de allí', async () => {
    await rpc(beach, 'add_cooked_dish', { p_house_id: beach.houseId, p_zone_id: beach.zones.fridge, p_name: 'Paella', p_servings: 2 })
    await rpc(home, 'add_cooked_dish', { p_house_id: home.houseId, p_zone_id: home.zones.fridge, p_name: 'Lentejas', p_servings: 4, p_cooked_at: '2026-11-01' })
    const [dish] = await lotsOf(home)

    await move(dish!.id, 1, beach.zones.fridge)

    expect((await lotsOf(home))[0]!.container_number).toBe(1)
    const moved = (await lotsOf(beach)).find((row) => row.container_number === 2)!
    expect(Number(moved.quantity)).toBe(1)
    const { rows } = await db.query<{ cooked_at: string; name: string; kind: string }>(
      `select l.cooked_at::text as cooked_at, p.name, p.kind from public.lots l join public.products p on p.id = l.product_id where l.id = $1`,
      [moved.id],
    )
    expect(rows[0]).toEqual({ cooked_at: '2026-11-01', name: 'Lentejas', kind: 'cooked_dish' })

    await move((await lotsOf(home))[0]!.id, 3, beach.zones.fridge)
    expect(await lotsOf(home)).toHaveLength(0)
    expect(await productIdByName(home, 'Lentejas')).toBeUndefined()
  })

  it('deja constancia en las dos casas, sin personas', async () => {
    await addMilk(home, 3, '2026-12-01')
    const [lot] = await lotsOf(home)

    await move(lot!.id, 2, beach.zones.pantry)

    expect((await movementsOf(home)).at(-1)).toMatchObject({
      type: 'moved_out',
      product_name: 'Leche',
      details: { amount: 2, to_house: 'Playa', to_zone: 'pantry', from_zone: 'fridge' },
    })
    expect((await movementsOf(beach)).at(-1)).toMatchObject({
      type: 'moved_in',
      details: { amount: 2, from_house: 'Casa', to_zone: 'pantry' },
    })
  })

  it('avisa en tiempo real a las dos casas', async () => {
    await addMilk(home, 3, '2026-12-01')
    const [lot] = await lotsOf(home)
    const [homeBefore, beachBefore] = [await versionOf(home.houseId), await versionOf(beach.houseId)]

    await move(lot!.id, 1, beach.zones.fridge)

    expect(await versionOf(home.houseId)).toBeGreaterThan(homeBefore)
    expect(await versionOf(beach.houseId)).toBeGreaterThan(beachBefore)
  })

  it('exige ser miembro de las dos casas', async () => {
    const editor = await joinWithInvite(home)
    await addMilk(home, 2, '2026-12-01')
    const [lot] = await lotsOf(home)

    await expect(rpc(editor, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: beach.zones.fridge })).rejects.toThrow('not_member')

    const outsider = await createHousehold(db)
    await expect(rpc(outsider, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: outsider.zones.fridge })).rejects.toThrow('not_member')
    expect(Number((await lotsOf(home))[0]!.quantity)).toBe(2)
  })

  it('rechaza cantidades imposibles', async () => {
    await addMilk(home, 2, '2026-12-01')
    const [lot] = await lotsOf(home)

    await expect(move(lot!.id, 3, beach.zones.fridge)).rejects.toThrow('invalid_amount')
    await expect(move(lot!.id, 0, beach.zones.fridge)).rejects.toThrow('invalid_amount')
    await expect(move(lot!.id, 0.5, beach.zones.fridge)).rejects.toThrow('invalid_amount')
  })

  describe('deshacer', () => {
    it('deja las dos casas como estaban y borra los dos movimientos', async () => {
      await addMilk(home, 3, '2026-12-01', { p_brand: 'Hacendado' })
      const [lot] = await lotsOf(home)
      const homeMovements = (await movementsOf(home)).length

      const movement = await move(lot!.id, 2, beach.zones.pantry)
      await rpc(home, 'undo_movement', { p_movement_id: movement })

      expect(await lotsOf(home)).toMatchObject([{ id: lot!.id, brand: 'Hacendado' }])
      expect(Number((await lotsOf(home))[0]!.quantity)).toBe(3)
      expect(await lotsOf(beach)).toHaveLength(0)
      expect(await productIdByName(beach, 'Leche')).toBeUndefined()
      expect(await movementsOf(home)).toHaveLength(homeMovements)
      expect(await movementsOf(beach)).toHaveLength(0)
    })

    it('recupera unidades abiertas que se fusionaron en la otra casa', async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const from = await createHousehold(db)
        const to = await secondHouse(from)
        await addMilk(from, 3, '2026-12-01')
        await addMilk(to, 1, '2026-12-01')
        await rpc(from, 'open_unit', { p_product_id: await productIdByName(from, 'Leche') })
        const [lot] = await lotsOf(from)
        const [unit] = await unitsOf(from)

        const movement = await rpc(from, 'move_lot', { p_lot_id: lot!.id, p_quantity: 2, p_target_zone_id: to.zones.fridge, p_opened_unit_ids: [unit!.id] })
        expect(await unitsOf(to)).toHaveLength(1)
        await rpc(from, 'undo_movement', { p_movement_id: movement })

        expect(await unitsOf(to)).toHaveLength(0)
        expect(await unitsOf(from)).toMatchObject([{ id: unit!.id, lot_id: lot!.id }])
        expect(Number((await lotsOf(to))[0]!.quantity)).toBe(1)
      }
    })

    it('recupera un táper movido entero, con su número', async () => {
      await rpc(home, 'add_cooked_dish', { p_house_id: home.houseId, p_zone_id: home.zones.fridge, p_name: 'Lentejas', p_servings: 2 })
      const [dish] = await lotsOf(home)

      const movement = await move(dish!.id, 2, beach.zones.fridge)
      await rpc(home, 'undo_movement', { p_movement_id: movement })

      expect(await lotsOf(home)).toMatchObject([{ id: dish!.id, container_number: 1 }])
      expect(await lotsOf(beach)).toHaveLength(0)
      expect(await productIdByName(beach, 'Lentejas')).toBeUndefined()
    })

    it('no se puede si después alguien tocó lo movido en la otra casa', async () => {
      await addMilk(home, 3, '2026-12-01')
      const [lot] = await lotsOf(home)
      const movement = await move(lot!.id, 2, beach.zones.fridge)

      await rpc(beach, 'consume', { p_lot_id: (await lotsOf(beach))[0]!.id })

      await expect(rpc(home, 'undo_movement', { p_movement_id: movement })).rejects.toThrow('undo_conflict')
      expect(Number((await lotsOf(home))[0]!.quantity)).toBe(1)
    })

    it('la entrada no se deshace por separado', async () => {
      await addMilk(home, 3, '2026-12-01')
      const [lot] = await lotsOf(home)
      await move(lot!.id, 2, beach.zones.fridge)
      const movedIn = (await movementsOf(beach)).at(-1)!

      await expect(rpc(beach, 'undo_movement', { p_movement_id: movedIn.id })).rejects.toThrow('invalid_input')
      expect(await lotsOf(beach)).toHaveLength(1)
    })

    it('si la otra casa ya no existe, se recupera lo movido', async () => {
      await addMilk(home, 3, '2026-12-01')
      const [lot] = await lotsOf(home)
      const movement = await move(lot!.id, 2, beach.zones.fridge)

      await rpc(home, 'delete_house', { p_house_id: beach.houseId })
      await rpc(home, 'undo_movement', { p_movement_id: movement })

      expect(Number((await lotsOf(home))[0]!.quantity)).toBe(3)
    })
  })
})

describe('mis datos', () => {
  it('exporta perfil y casas con su inventario, sin el estado interno de deshacer', async () => {
    const person = await joinWithInvite(home, 'Berta')
    await addMilk(home, 2, '2026-12-01')
    await rpc(home, 'open_unit', { p_product_id: await productIdByName(home, 'Leche') })

    const data = await rpc<{
      app: string
      profile: { id: string; display_name: string }
      houses: {
        house: { id: string; name: string }
        role: string
        members: { display_name: string; role: string }[]
        zones: unknown[]
        products: { name: string }[]
        lots: unknown[]
        opened_units: unknown[]
        date_samples: unknown[]
        movements: Record<string, unknown>[]
      }[]
    }>(person, 'export_my_data')

    expect(data.app).toBe('nevera-digital')
    expect(data.profile).toMatchObject({ id: person.userId, display_name: 'Berta' })
    expect(data.houses).toHaveLength(1)
    const [house] = data.houses
    expect(house).toMatchObject({ role: 'editor', house: { id: home.houseId } })
    expect(house!.members.map((member) => member.display_name)).toEqual(['Ana', 'Berta'])
    expect(house!.zones).toHaveLength(3)
    expect(house!.products.map((product) => product.name)).toEqual(['Leche'])
    expect(house!.lots).toHaveLength(1)
    expect(house!.opened_units).toHaveLength(1)
    expect(house!.date_samples).toHaveLength(1)
    expect(house!.movements.length).toBeGreaterThan(0)
    expect(JSON.stringify(data)).not.toContain('undo_state')
    expect(house!.movements[0]).not.toHaveProperty('user_id')
  })

  it('solo exporta las casas propias', async () => {
    const other = await createHousehold(db)
    await addMilk(other, 2, '2026-12-01')

    const data = await rpc<{ houses: { house: { id: string } }[] }>(home, 'export_my_data')

    expect(data.houses.map((house) => house.house.id)).toEqual([home.houseId])
  })

  it('alguien sin casas también puede exportar', async () => {
    const data = await rpc<{ houses: unknown[] }>({ db, userId: await createUser(db) }, 'export_my_data')
    expect(data.houses).toEqual([])
  })

  it('al eliminar la cuenta se borran sus casas en solitario y su usuario', async () => {
    await addMilk(home, 2, '2026-12-01')
    const second = await secondHouse()

    await rpc(home, 'delete_account')

    expect(await houseExists(home.houseId)).toBe(false)
    expect(await houseExists(second.houseId)).toBe(false)
    const user = await db.query('select id from auth.users where id = $1', [home.userId])
    expect(user.rows).toHaveLength(0)
    const profile = await db.query('select id from public.profiles where id = $1', [home.userId])
    expect(profile.rows).toHaveLength(0)
  })

  it('en una casa compartida la propiedad pasa al más antiguo y el inventario sigue ahí', async () => {
    const first = await joinWithInvite(home, 'Primera')
    await db.query(`update public.house_members set joined_at = now() - interval '2 days' where user_id = $1`, [first.userId])
    await joinWithInvite(home, 'Segunda')
    await addMilk(home, 2, '2026-12-01')

    await rpc(home, 'delete_account')

    expect(await houseExists(home.houseId)).toBe(true)
    const members = await membersOf(home.houseId)
    expect(members).toHaveLength(2)
    expect(members.find((member) => member.user_id === first.userId)?.role).toBe('owner')
    expect(await lotsOf(home)).toHaveLength(1)
    const house = await db.query<{ created_by: string | null }>('select created_by from public.houses where id = $1', [home.houseId])
    expect(house.rows[0]!.created_by).toBeNull()
  })

  it('un editor que elimina su cuenta no afecta a la casa', async () => {
    const person = await joinWithInvite(home)

    await rpc(person, 'delete_account')

    expect(await membersOf(home.houseId)).toEqual([{ user_id: home.userId, role: 'owner' }])
  })

  it('sin sesión no se puede ni exportar ni eliminar', async () => {
    for (const statement of ['select public.export_my_data()', 'select public.delete_account()']) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec('set local role anon')
          await tx.query(statement)
        }),
      ).rejects.toThrow(/permission denied/)
    }
  })
})
