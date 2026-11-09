import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createUser } from './harness'
import { addMilk, createHousehold, rpc, type Household } from './inventoryHelpers'

describe('casas', () => {
  let household: Household

  beforeAll(async () => {
    household = await createHousehold()
  })

  it('crear una casa crea sus tres zonas, te hace propietario y la deja activa', async () => {
    const { db, userId, houseId } = household

    const zones = await db.query<{ kind: string }>(
      'select kind from public.zones where house_id = $1 order by sort_order',
      [houseId],
    )
    expect(zones.rows.map((zone) => zone.kind)).toEqual(['fridge', 'freezer', 'pantry'])

    const members = await db.query<{ user_id: string; role: string }>(
      'select user_id, role from public.house_members where house_id = $1',
      [houseId],
    )
    expect(members.rows).toEqual([{ user_id: userId, role: 'owner' }])

    const profile = await db.query<{ active_house_id: string }>(
      'select active_house_id from public.profiles where id = $1',
      [userId],
    )
    expect(profile.rows[0]?.active_house_id).toBe(houseId)
  })

  it('una casa necesita nombre', async () => {
    await expect(rpc(household, 'create_house', { p_name: '   ' })).rejects.toThrow()
  })

  it('quien no es miembro no ve nada de la casa', async () => {
    const { db, houseId } = household
    await addMilk(household, 1, null)
    const outsider = await createUser(db)

    const counts = await asUser(db, outsider, async (tx) => {
      const tables = ['houses', 'house_members', 'zones', 'products', 'lots', 'opened_units', 'date_samples', 'lots_with_dates', 'opened_units_with_dates']
      const result: Record<string, number> = {}
      for (const table of tables) {
        const column = table === 'houses' ? 'id' : 'house_id'
        const { rows } = await tx.query(`select 1 from public.${table} where ${column} = $1`, [houseId])
        result[table] = rows.length
      }
      const movements = await tx.query('select id from public.movements where house_id = $1', [houseId])
      result.movements = movements.rows.length
      return result
    })

    expect(Object.values(counts).every((count) => count === 0)).toBe(true)
  })

  it('quien no es miembro no puede operar sobre la casa', async () => {
    const { db, houseId, zones } = household
    const outsider = { db, userId: await createUser(db) }

    await expect(
      rpc(outsider, 'add_lot', { p_house_id: houseId, p_zone_id: zones.fridge, p_quantity: 1, p_name: 'Intruso' }),
    ).rejects.toThrow('not_member')

    const { rows } = await db.query<{ id: string }>('select id from public.lots where house_id = $1 limit 1', [houseId])
    await expect(rpc(outsider, 'adjust_quantity', { p_lot_id: rows[0]!.id, p_new_quantity: 0 })).rejects.toThrow('not_member')
  })

  it('nadie puede escribir en las tablas directamente, ni siquiera un miembro', async () => {
    const { db, userId, houseId, zones } = household
    const { rows } = await db.query<{ id: string; product_id: string }>(
      'select id, product_id from public.lots where house_id = $1 limit 1',
      [houseId],
    )
    const lot = rows[0]!

    const statements = [
      `update public.lots set quantity = 99 where id = '${lot.id}'`,
      `delete from public.lots where id = '${lot.id}'`,
      `insert into public.lots (house_id, zone_id, product_id, quantity) values ('${houseId}', '${zones.fridge}', '${lot.product_id}', 1)`,
      `update public.products set name = 'x' where id = '${lot.product_id}'`,
      `delete from public.movements where house_id = '${houseId}'`,
      `update public.houses set name = 'x' where id = '${houseId}'`,
      `insert into public.house_members (house_id, user_id, role) values ('${houseId}', '${userId}', 'editor')`,
      `insert into public.date_samples (house_id, product_id, days_to_printed_date, printed_date_type) values ('${houseId}', '${lot.product_id}', 1, 'expiry')`,
    ]

    for (const statement of statements) {
      await expect(asUser(db, userId, (tx) => tx.query(statement))).rejects.toThrow(/permission denied/)
    }
  })

  it('el cliente no puede leer el estado interno de deshacer', async () => {
    const { db, userId, houseId } = household
    await expect(
      asUser(db, userId, (tx) => tx.query('select undo_state from public.movements where house_id = $1', [houseId])),
    ).rejects.toThrow(/permission denied/)
  })

  it('la casa activa solo puede ser una de la que se es miembro', async () => {
    const { db, houseId } = household
    const outsider = await createUser(db)

    await expect(
      asUser(db, outsider, (tx) => tx.query('update public.profiles set active_house_id = $1 where id = $2', [houseId, outsider])),
    ).rejects.toThrow(/row-level security/)
  })

  it('las funciones internas y la API no están al alcance de un visitante sin sesión', async () => {
    const { db, houseId } = household

    for (const statement of [
      `select public.next_container_number('${houseId}')`,
      `select private.lowest_free_container('${houseId}')`,
    ]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec('set local role anon')
          await tx.query(statement)
        }),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('un miembro tampoco puede llamar a las funciones internas', async () => {
    const { db, userId, houseId } = household
    await expect(
      asUser(db, userId, (tx) => tx.query(`select private.lowest_free_container('${houseId}')`)),
    ).rejects.toThrow(/permission denied/)
  })
})
