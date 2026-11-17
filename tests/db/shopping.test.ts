import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'
import { addMilk, createHousehold, productIdByName, rpc, type Household } from './inventoryHelpers'

let db: PGlite
let household: Household

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  household = await createHousehold(db)
})

interface Item {
  name: string
  product_id: string | null
  quantity_text: string | null
  preferred_brand: string | null
  checked: boolean
  origin: string
}

async function listOf(houseId = household.houseId) {
  const { rows } = await db.query<Item & { checked_at: string | null }>(
    `select name, product_id, quantity_text, preferred_brand, checked, checked_at::text, origin::text from public.shopping_items where house_id = $1 order by created_at, name`,
    [houseId],
  )
  return rows
}

function add(args: Record<string, unknown>, who: Pick<Household, 'db' | 'userId'> = household) {
  return rpc<{ id: string; added: boolean }>(who, 'add_shopping_item', { p_house_id: household.houseId, ...args })
}

async function version() {
  const { rows } = await db.query<{ version: string }>('select version::text from public.house_changes where house_id = $1', [household.houseId])
  return Number(rows[0]!.version)
}

describe('añadir a la lista', () => {
  it('a mano, con cantidad y marca', async () => {
    const result = await add({ p_name: '  Pan de molde ', p_quantity_text: '2 paquetes', p_preferred_brand: 'Bimbo' })
    expect(result.added).toBe(true)
    expect(await listOf()).toMatchObject([{ name: 'Pan de molde', quantity_text: '2 paquetes', preferred_brand: 'Bimbo', checked: false, product_id: null, origin: 'manual' }])
  })

  it('un producto de la casa se enlaza y trae su marca preferida', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await rpc(household, 'update_product', { p_product_id: milk, p_patch: { preferred_brand: 'Pascual' } })
    await add({ p_product_id: milk, p_origin: 'finished' })
    expect(await listOf()).toMatchObject([{ name: 'Leche', product_id: milk, preferred_brand: 'Pascual', origin: 'finished' }])
  })

  it('escrito a mano, se enlaza con el producto de la casa que se llama igual', async () => {
    await addMilk(household, 1, null)
    await add({ p_name: 'LÉCHE' })
    expect((await listOf())[0]!.product_id).toBe(await productIdByName(household, 'Leche'))
  })

  it('lo que ya está pendiente no se repite', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    const first = await add({ p_product_id: milk })
    expect(await add({ p_name: 'leche' })).toEqual({ id: first.id, added: false })
    // Tachado, sí se puede volver a apuntar.
    await rpc(household, 'update_shopping_item', { p_item_id: first.id, p_patch: { checked: true } })
    expect((await add({ p_product_id: milk })).added).toBe(true)
    expect(await listOf()).toHaveLength(2)
  })

  it('sin nombre ni producto, o con un producto de otra casa, no', async () => {
    await expect(add({ p_name: '   ' })).rejects.toThrow('invalid_input')
    const other = await createHousehold(db)
    await addMilk(other, 1, null)
    await expect(add({ p_product_id: (await productIdByName(other, 'Leche'))! })).rejects.toThrow('not_found')
  })
})

describe('editar, tachar y borrar', () => {
  it('tachar apunta cuándo y destachar lo quita', async () => {
    const { id } = await add({ p_name: 'Huevos' })
    await rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { checked: true } })
    expect((await listOf())[0]).toMatchObject({ checked: true })
    expect((await listOf())[0]!.checked_at).not.toBeNull()
    await rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { checked: false } })
    expect((await listOf())[0]).toMatchObject({ checked: false, checked_at: null })
  })

  it('edita solo lo indicado', async () => {
    const { id } = await add({ p_name: 'Huevos', p_quantity_text: '12' })
    await rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { preferred_brand: 'Pazo' } })
    expect((await listOf())[0]).toMatchObject({ name: 'Huevos', quantity_text: '12', preferred_brand: 'Pazo' })
    await expect(rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { name: ' ' } })).rejects.toThrow('invalid_input')
  })

  it('"Borrar comprados" quita solo lo tachado', async () => {
    const { id } = await add({ p_name: 'Huevos' })
    await add({ p_name: 'Pan' })
    await rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { checked: true } })
    expect(await rpc<number>(household, 'clear_checked_shopping', { p_house_id: household.houseId })).toBe(1)
    expect((await listOf()).map((item) => item.name)).toEqual(['Pan'])
    await rpc(household, 'delete_shopping_item', { p_item_id: (await add({ p_name: 'Sal' })).id })
    expect((await listOf()).map((item) => item.name)).toEqual(['Pan'])
  })

  it('si se borra el producto, sigue en la lista con su nombre', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await add({ p_product_id: milk })
    await rpc(household, 'consume', { p_product_id: milk, p_all: true })
    await rpc(household, 'delete_product', { p_product_id: milk })
    expect(await listOf()).toMatchObject([{ name: 'Leche', product_id: null }])
  })
})

describe('compartida y en tiempo real', () => {
  it('cada cambio sube la señal de la casa', async () => {
    const before = await version()
    const { id } = await add({ p_name: 'Pan' })
    await rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { checked: true } })
    await rpc(household, 'clear_checked_shopping', { p_house_id: household.houseId })
    expect(await version()).toBe(before + 3)
  })

  it('solo la ven y la cambian los miembros', async () => {
    const { id } = await add({ p_name: 'Pan' })
    const stranger = { db, userId: await createUser(db) }
    const seen = await asUser(db, stranger.userId, async (tx) => (await tx.query('select 1 from public.shopping_items')).rows.length)
    expect(seen).toBe(0)
    await expect(add({ p_name: 'Sal' }, stranger)).rejects.toThrow('not_member')
    await expect(rpc(stranger, 'update_shopping_item', { p_item_id: id, p_patch: { checked: true } })).rejects.toThrow('not_member')
    await expect(rpc(stranger, 'delete_shopping_item', { p_item_id: id })).rejects.toThrow('not_member')
    await expect(asUser(db, household.userId, (tx) => tx.query(`insert into public.shopping_items (house_id, name) values ($1, 'x')`, [household.houseId]))).rejects.toThrow()
  })
})

describe('al aplicar un ticket', () => {
  const ticket = (lines: object[]) => rpc(household, 'apply_ticket', { p_house_id: household.houseId, p_lines: JSON.stringify(lines) })
  const milkLine = { zone: 'fridge', quantity: 6, name: 'Leche', category: 'dairy_eggs', quantity_kind: 'divisible', unit_label: 'brick', content_amount: 1, content_unit: 'l' }

  it('tacha lo comprado, por producto o por nombre, y Deshacer lo deja pendiente', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await add({ p_product_id: milk })
    await add({ p_name: 'Galletas' })
    await add({ p_name: 'Pan' })

    const movement = await ticket([milkLine, { zone: 'pantry', quantity: 1, name: 'Galletas', category: 'snacks', quantity_kind: 'count', unit_label: 'package' }])
    expect((await listOf()).map((item) => [item.name, item.checked])).toEqual([
      ['Leche', true],
      ['Galletas', true],
      ['Pan', false],
    ])
    const { rows } = await db.query<{ details: { shopping_checked: number } }>('select details from public.movements where id = $1', [movement])
    expect(rows[0]!.details.shopping_checked).toBe(2)

    await rpc(household, 'undo_movement', { p_movement_id: movement })
    expect((await listOf()).map((item) => [item.name, item.checked])).toEqual([
      ['Leche', false],
      ['Galletas', false],
      ['Pan', false],
    ])
  })

  it('lo ya tachado antes no se toca al deshacer', async () => {
    const { id } = await add({ p_name: 'Leche' })
    await rpc(household, 'update_shopping_item', { p_item_id: id, p_patch: { checked: true } })
    const movement = await ticket([milkLine])
    await rpc(household, 'undo_movement', { p_movement_id: movement })
    expect((await listOf())[0]).toMatchObject({ checked: true })
  })
})

describe('Mis datos', () => {
  it('incluye la lista de cada casa', async () => {
    await add({ p_name: 'Pan' })
    const data = await rpc<{ houses: { shopping_items: { name: string }[] }[] }>(household, 'export_my_data')
    expect(data.houses[0]!.shopping_items.map((item) => item.name)).toEqual(['Pan'])
  })
})
