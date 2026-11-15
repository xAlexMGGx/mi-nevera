import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'
import { addMilk, createHousehold, lotsOf, productIdByName, rpc, type Household } from './inventoryHelpers'

let db: PGlite
let household: Household

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  household = await createHousehold(db)
})

async function barcodesOf(who: Pick<Household, 'db' | 'userId'> = household, houseId = household.houseId) {
  return asUser(db, who.userId, async (tx) => {
    const { rows } = await tx.query<{ barcode: string; product_id: string; brand: string | null; image_url: string | null }>(
      'select barcode, product_id, brand, image_url from public.product_barcodes where house_id = $1 order by barcode',
      [houseId],
    )
    return rows
  })
}

const photo = 'https://images.openfoodfacts.org/a.jpg'

describe('la casa recuerda sus códigos de barras', () => {
  it('al añadir un lote con código, con su marca y su foto', async () => {
    await addMilk(household, 1, null, { p_barcode: '8410000000001', p_brand: 'Pascual', p_image_url: photo })
    const milk = (await productIdByName(household, 'Leche'))!
    expect(await barcodesOf()).toEqual([{ barcode: '8410000000001', product_id: milk, brand: 'Pascual', image_url: photo }])
  })

  it('sigue recordándolo cuando el lote se acaba', async () => {
    await addMilk(household, 1, null, { p_barcode: '8410000000001' })
    const milk = (await productIdByName(household, 'Leche'))!
    await rpc(household, 'consume', { p_product_id: milk, p_all: true })
    expect(await lotsOf(household)).toEqual([])
    expect((await barcodesOf()).map((row) => row.product_id)).toEqual([milk])
  })

  it('al asignar el código a un lote y al aplicar un ticket', async () => {
    await addMilk(household, 1, null)
    const [lot] = await lotsOf(household)
    await rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { barcode: '8410000000002' } })
    await rpc(household, 'apply_ticket', {
      p_house_id: household.houseId,
      p_lines: JSON.stringify([{ zone: 'pantry', quantity: 1, name: 'Judías verdes', category: 'vegetables', quantity_kind: 'count', unit_label: 'bag', barcode: '8410000000003' }]),
    })
    const beans = (await productIdByName(household, 'Judías verdes'))!
    expect((await barcodesOf()).map((row) => [row.barcode, row.product_id])).toEqual([
      ['8410000000002', (await productIdByName(household, 'Leche'))!],
      ['8410000000003', beans],
    ])
  })

  it('el mismo código en otro producto pasa a ese producto, sin perder la foto', async () => {
    await addMilk(household, 1, null, { p_barcode: '8410000000001', p_image_url: photo })
    await addMilk(household, 1, null, { p_name: 'Leche entera', p_barcode: '8410000000001' })
    const whole = (await productIdByName(household, 'Leche entera'))!
    expect(await barcodesOf()).toEqual([{ barcode: '8410000000001', product_id: whole, brand: null, image_url: photo }])
  })

  it('al mover un lote a otra casa, la otra casa también lo aprende', async () => {
    const otherHouse = await asUser(db, household.userId, async (tx) => (await tx.query<{ id: string }>(`select public.create_house('Playa') as id`)).rows[0]!.id)
    const { rows } = await db.query<{ id: string }>(`select id from public.zones where house_id = $1 and kind = 'fridge'`, [otherHouse])
    await addMilk(household, 2, null, { p_barcode: '8410000000001' })
    const [lot] = await lotsOf(household)
    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: rows[0]!.id })
    expect((await barcodesOf(household, otherHouse)).map((row) => row.barcode)).toEqual(['8410000000001'])
  })

  it('desaparece con el producto, y solo lo ven los miembros', async () => {
    await addMilk(household, 1, null, { p_barcode: '8410000000001' })
    const milk = (await productIdByName(household, 'Leche'))!
    await rpc(household, 'consume', { p_product_id: milk, p_all: true })
    const stranger = { db, userId: await createUser(db) }
    expect(await barcodesOf(stranger)).toEqual([])
    await rpc(household, 'delete_product', { p_product_id: milk })
    expect(await barcodesOf()).toEqual([])
  })

  it('no se puede escribir desde la app', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await expect(
      asUser(db, household.userId, (tx) =>
        tx.query('insert into public.product_barcodes (house_id, barcode, product_id) values ($1, $2, $3)', [household.houseId, '8410000000009', milk]),
      ),
    ).rejects.toThrow()
  })

  it('Mis datos los incluye', async () => {
    await addMilk(household, 1, null, { p_barcode: '8410000000001' })
    const data = await rpc<{ houses: { product_barcodes: { barcode: string }[] }[] }>(household, 'export_my_data')
    expect(data.houses[0]!.product_barcodes.map((row) => row.barcode)).toEqual(['8410000000001'])
  })
})

describe('ticket con congelador', () => {
  it('cada línea puede traer la fecha de congelado y la de aviso', async () => {
    await rpc(household, 'apply_ticket', {
      p_house_id: household.houseId,
      p_purchased_at: '2026-11-01',
      p_lines: JSON.stringify([
        { zone: 'freezer', quantity: 1, name: 'Guisantes', category: 'frozen', quantity_kind: 'count', unit_label: 'bag', reminder_date: '2027-05-01' },
        { zone: 'freezer', quantity: 1, name: 'Pollo', category: 'meat', quantity_kind: 'count', unit_label: 'tray', frozen_at: '2026-11-03' },
      ]),
    })
    const lots = await lotsOf(household)
    expect(lots.map((lot) => [lot.frozen_at, lot.reminder_date]).sort()).toEqual([
      ['2026-11-01', '2027-05-01'],
      ['2026-11-03', null],
    ])
  })
})

describe('límite de identificar productos', () => {
  it('tiene su propio contador de 100 al día', async () => {
    const claims: boolean[] = []
    for (let i = 0; i < 101; i++) claims.push(await rpc<boolean>(household, 'claim_ai_use', { p_kind: 'product' }))
    expect(claims.filter(Boolean)).toHaveLength(100)
    expect(await rpc<boolean>(household, 'claim_ai_use', { p_kind: 'receipt' })).toBe(true)
  })
})
