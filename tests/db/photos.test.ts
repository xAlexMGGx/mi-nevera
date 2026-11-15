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

const uuid = () => crypto.randomUUID()

/** Sube un objeto al bucket como lo haría la API de Storage, con los permisos del usuario. */
function upload(userId: string, name: string) {
  return asUser(db, userId, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('photos', $1)`, [name]))
}

async function visible(userId: string, name: string) {
  return asUser(db, userId, async (tx) => {
    const { rows } = await tx.query(`select 1 from storage.objects where bucket_id = 'photos' and name = $1`, [name])
    return rows.length === 1
  })
}

async function member(owner: Household) {
  const userId = await createUser(db, { display_name: 'Berta' })
  const code = await rpc<string>(owner, 'create_invite', { p_house_id: owner.houseId })
  await rpc({ db, userId }, 'join_house', { p_code: code })
  return userId
}

describe('el bucket de fotos', () => {
  it('es privado, solo admite JPEG y como mucho 1 MB', async () => {
    const { rows } = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'photos'`,
    )
    expect(rows).toEqual([{ public: false, file_size_limit: '1048576', allowed_mime_types: ['image/jpeg'] }])
  })

  it('cada persona sube solo a su carpeta y con nombre de foto', async () => {
    await upload(household.userId, `${household.userId}/${uuid()}.jpg`)
    await expect(upload(household.userId, `${await createUser(db)}/${uuid()}.jpg`)).rejects.toThrow()
    await expect(upload(household.userId, `${household.userId}/../otra.jpg`)).rejects.toThrow()
    await expect(upload(household.userId, `${household.userId}/${uuid()}.png`)).rejects.toThrow()
  })

  it('la ve quien la subió y, cuando un lote la usa, los miembros de esa casa; nadie más', async () => {
    const berta = await member(household)
    const stranger = await createUser(db)
    const name = `${household.userId}/${uuid()}.jpg`
    await upload(household.userId, name)

    expect(await visible(household.userId, name)).toBe(true)
    expect(await visible(berta, name)).toBe(false)

    await addMilk(household, 1, null, { p_image_url: `photo:${name}` })
    expect(await visible(berta, name)).toBe(true)
    expect(await visible(stranger, name)).toBe(false)
  })

  it('también la foto de un producto', async () => {
    const berta = await member(household)
    const name = `${household.userId}/${uuid()}.jpg`
    await upload(household.userId, name)
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await rpc(household, 'update_product', { p_product_id: milk, p_patch: { image_url: `photo:${name}` } })
    expect(await visible(berta, name)).toBe(true)
  })

  it('al mover el lote a otra casa, la foto se ve también allí', async () => {
    const beach = await asUser(db, household.userId, async (tx) => (await tx.query<{ id: string }>(`select public.create_house('Playa') as id`)).rows[0]!.id)
    const owner: Household = { ...household, houseId: beach }
    const carla = await member(owner)
    const name = `${household.userId}/${uuid()}.jpg`
    await upload(household.userId, name)
    await addMilk(household, 2, null, { p_image_url: `photo:${name}` })
    const [lot] = await lotsOf(household)
    const { rows } = await db.query<{ id: string }>(`select id from public.zones where house_id = $1 and kind = 'fridge'`, [beach])
    expect(await visible(carla, name)).toBe(false)
    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: rows[0]!.id })
    expect(await visible(carla, name)).toBe(true)
  })
})

describe('guardar una foto en un lote o un producto', () => {
  it('admite fotos de Open Food Facts y fotos propias de quien la guarda', async () => {
    const own = `photo:${household.userId}/${uuid()}.jpg`
    await addMilk(household, 1, null, { p_image_url: own })
    const [lot] = await lotsOf(household)
    expect(lot).toMatchObject({ image_url: own })

    await rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { image_url: 'https://images.openfoodfacts.org/a.jpg' } })
    expect((await lotsOf(household))[0]).toMatchObject({ image_url: 'https://images.openfoodfacts.org/a.jpg' })
  })

  it('rechaza enlazar la foto de otra persona o una ruta rara', async () => {
    await addMilk(household, 1, null)
    const [lot] = await lotsOf(household)
    const other = await createUser(db)
    for (const image of [`photo:${other}/${uuid()}.jpg`, `photo:${household.userId}/x.jpg`, 'photo:../../secreto.jpg']) {
      await expect(rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { image_url: image } })).rejects.toThrow('invalid_input')
    }
    const milk = (await productIdByName(household, 'Leche'))!
    await expect(rpc(household, 'update_product', { p_product_id: milk, p_patch: { image_url: `photo:${other}/${uuid()}.jpg` } })).rejects.toThrow('invalid_input')
  })

  it('la foto del producto se pone y se quita sin tocar el resto', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await rpc(household, 'update_product', { p_product_id: milk, p_patch: { image_url: 'https://images.openfoodfacts.org/b.jpg' } })
    await rpc(household, 'update_product', { p_product_id: milk, p_patch: { brand_notes: 'buena' } })
    const read = async () => (await db.query<{ image_url: string | null; brand_notes: string | null }>('select image_url, brand_notes from public.products where id = $1', [milk])).rows[0]
    expect(await read()).toEqual({ image_url: 'https://images.openfoodfacts.org/b.jpg', brand_notes: 'buena' })
    await rpc(household, 'update_product', { p_product_id: milk, p_patch: { image_url: null } })
    expect(await read()).toEqual({ image_url: null, brand_notes: 'buena' })
  })

  it('un código de barras recuerda la foto de Open Food Facts, no una propia', async () => {
    await addMilk(household, 1, null, { p_barcode: '8410000000001', p_image_url: `photo:${household.userId}/${uuid()}.jpg` })
    const { rows } = await db.query<{ image_url: string | null }>('select image_url from public.product_barcodes where house_id = $1', [household.houseId])
    expect(rows).toEqual([{ image_url: null }])
  })
})
