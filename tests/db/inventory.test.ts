import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './harness'
import {
  addMilk,
  createHousehold,
  lotsOf,
  movementsOf,
  productIdByName,
  rpc,
  stockOf,
  unitsOf,
  type Household,
} from './inventoryHelpers'

let db: PGlite
let household: Household

beforeAll(async () => {
  db = await createTestDb()
})

// Cada test usa una casa nueva: los datos de cada casa están aislados entre sí.
beforeEach(async () => {
  household = await createHousehold(db)
})

async function milkId() {
  return (await productIdByName(household, 'Leche'))!
}

describe('criterio de aceptación de la fase 1', () => {
  it('6 bricks del 1/10 y 6 del 1/11, abrir uno, dejarlo al 60 % y consumir', async () => {
    await addMilk(household, 6, '2026-10-01')
    await addMilk(household, 6, '2026-11-01')
    const product = await milkId()

    expect(await stockOf(household, product)).toEqual({
      closed: [['2026-10-01', 6], ['2026-11-01', 6]],
      open: [],
    })

    await rpc(household, 'open_unit', { p_product_id: product })
    expect(await stockOf(household, product)).toEqual({
      closed: [['2026-10-01', 5], ['2026-11-01', 6]],
      open: [1],
    })

    const [unit] = await unitsOf(household)
    await rpc(household, 'set_remaining', { p_opened_unit_id: unit!.id, p_fraction: 0.6 })
    expect((await stockOf(household, product)).open).toEqual([0.6])

    // −1 termina primero la abierta.
    await rpc(household, 'consume', { p_product_id: product })
    expect(await stockOf(household, product)).toEqual({
      closed: [['2026-10-01', 5], ['2026-11-01', 6]],
      open: [],
    })

    // Después resta del lote que caduca antes.
    await rpc(household, 'consume', { p_product_id: product })
    expect(await stockOf(household, product)).toEqual({
      closed: [['2026-10-01', 4], ['2026-11-01', 6]],
      open: [],
    })
  })
})

describe('añadir', () => {
  it('crea el producto una sola vez aunque se escriba distinto', async () => {
    await addMilk(household, 1, '2026-12-01')
    await rpc(household, 'add_lot', {
      p_house_id: household.houseId,
      p_zone_id: household.zones.fridge,
      p_quantity: 2,
      p_name: '  LÉCHE ',
      p_printed_date: '2026-12-02',
      p_printed_date_type: 'expiry',
    })

    const { rows } = await household.db.query('select id from public.products where house_id = $1', [household.houseId])
    expect(rows).toHaveLength(1)
    expect(await lotsOf(household)).toHaveLength(2)
  })

  it('fusiona un lote con la misma fecha, marca, zona y estado', async () => {
    await addMilk(household, 2, '2026-12-01', { p_brand: 'Hacendado' })
    await addMilk(household, 3, '2026-12-01', { p_brand: 'hacendado' })

    const lots = await lotsOf(household)
    expect(lots).toHaveLength(1)
    expect(Number(lots[0]!.quantity)).toBe(5)
  })

  it('no fusiona si cambia la fecha, la marca o la zona', async () => {
    await addMilk(household, 1, '2026-12-01', { p_brand: 'Hacendado' })
    await addMilk(household, 1, '2026-12-02', { p_brand: 'Hacendado' })
    await addMilk(household, 1, '2026-12-01', { p_brand: 'Pascual' })
    await addMilk(household, 1, '2026-12-01', { p_brand: 'Hacendado', p_zone_id: household.zones.pantry })

    expect(await lotsOf(household)).toHaveLength(4)
  })

  it('una fecha exige su tipo', async () => {
    await expect(addMilk(household, 1, null, { p_printed_date: '2026-12-01' })).rejects.toThrow()
  })

  it('rechaza cantidades imposibles', async () => {
    await expect(addMilk(household, 0, null)).rejects.toThrow('invalid_amount')
    await expect(addMilk(household, -1, null)).rejects.toThrow('invalid_amount')
    await expect(addMilk(household, 1.5, null)).rejects.toThrow('invalid_amount')
  })

  it('guarda una muestra de fecha que sobrevive al lote', async () => {
    await addMilk(household, 1, '2026-12-11', { p_purchased_at: '2026-12-01' })
    const product = await milkId()

    await rpc(household, 'consume', { p_product_id: product })

    expect(await lotsOf(household)).toHaveLength(0)
    const { rows } = await household.db.query<{ days_to_printed_date: number; printed_date_type: string }>(
      'select days_to_printed_date, printed_date_type from public.date_samples where product_id = $1',
      [product],
    )
    expect(rows).toEqual([{ days_to_printed_date: 10, printed_date_type: 'expiry' }])
  })

  it('lo añadido al congelador cuenta como congelado y no usa la fecha impresa', async () => {
    await addMilk(household, 1, '2026-12-01', { p_zone_id: household.zones.freezer, p_frozen_at: '2026-11-01' })

    const [lot] = await lotsOf(household)
    expect(lot).toMatchObject({ frozen_at: '2026-11-01', printed_date: '2026-12-01', effective_date: null })
  })
})

describe('consumir con FEFO', () => {
  it('resta primero del lote que caduca antes, y lo que no tiene fecha va al final', async () => {
    await addMilk(household, 1, null)
    await addMilk(household, 1, '2026-12-02')
    await addMilk(household, 1, '2026-12-01')
    const product = await milkId()

    await rpc(household, 'consume', { p_product_id: product })
    expect((await lotsOf(household)).map((lot) => lot.printed_date)).toEqual(['2026-12-02', null])

    await rpc(household, 'consume', { p_product_id: product })
    expect((await lotsOf(household)).map((lot) => lot.printed_date)).toEqual([null])
  })

  it('una resta grande puede repartirse entre varios lotes', async () => {
    await addMilk(household, 2, '2026-12-01')
    await addMilk(household, 3, '2026-12-02')
    const product = await milkId()

    await rpc(household, 'consume', { p_product_id: product, p_amount: 3 })

    expect((await stockOf(household, product)).closed).toEqual([['2026-12-02', 2]])
  })

  it('con varias abiertas termina la de fecha más próxima y, a igual fecha, la más vacía', async () => {
    await addMilk(household, 2, '2026-12-01')
    await addMilk(household, 1, '2026-12-05')
    const product = await milkId()
    const lots = await lotsOf(household)

    await rpc(household, 'open_unit', { p_lot_id: lots[1]!.id })
    await rpc(household, 'open_unit', { p_lot_id: lots[0]!.id })
    await rpc(household, 'open_unit', { p_lot_id: lots[0]!.id })
    const units = await unitsOf(household)
    const early = units.filter((unit) => unit.lot_id === lots[0]!.id)
    await rpc(household, 'set_remaining', { p_opened_unit_id: early[1]!.id, p_fraction: 0.3 })

    await rpc(household, 'consume', { p_product_id: product })

    const left = await unitsOf(household)
    expect(left.map((unit) => unit.id)).not.toContain(early[1]!.id)
    expect(left).toHaveLength(2)

    await rpc(household, 'consume', { p_product_id: product })
    expect((await unitsOf(household)).map((unit) => unit.lot_id)).toEqual([lots[1]!.id])
  })

  it('en una zona solo toca lo que hay en esa zona', async () => {
    await addMilk(household, 2, '2026-12-01', { p_zone_id: household.zones.pantry })
    await addMilk(household, 2, '2026-12-05')
    const product = await milkId()

    await rpc(household, 'consume', { p_product_id: product, p_zone_id: household.zones.fridge })

    expect((await stockOf(household, product)).closed).toEqual([['2026-12-01', 2], ['2026-12-05', 1]])
  })

  it('sobre un lote concreto no toca los demás', async () => {
    await addMilk(household, 2, '2026-12-01')
    await addMilk(household, 2, '2026-12-05')
    const product = await milkId()
    const lots = await lotsOf(household)

    await rpc(household, 'consume', { p_lot_id: lots[1]!.id })

    expect((await stockOf(household, product)).closed).toEqual([['2026-12-01', 2], ['2026-12-05', 1]])
  })

  it('a granel resta la cantidad indicada, y "Todo" lo acaba', async () => {
    await rpc(household, 'add_lot', {
      p_house_id: household.houseId,
      p_zone_id: household.zones.fridge,
      p_quantity: 1.2,
      p_name: 'Tomates',
      p_quantity_kind: 'bulk',
      p_unit_label: 'unit',
      p_bulk_unit: 'kg',
    })
    const product = (await productIdByName(household, 'Tomates'))!

    await rpc(household, 'consume', { p_product_id: product, p_amount: 0.25 })
    expect(Number((await lotsOf(household))[0]!.quantity)).toBe(0.95)

    await rpc(household, 'consume', { p_product_id: product, p_all: true })
    expect(await lotsOf(household)).toHaveLength(0)
  })

  it('si piden más de lo que queda, consume lo que hay', async () => {
    await addMilk(household, 2, '2026-12-01')
    const product = await milkId()

    await rpc(household, 'consume', { p_product_id: product, p_amount: 5 })

    expect(await lotsOf(household)).toHaveLength(0)
    expect((await movementsOf(household)).at(-1)?.details).toMatchObject({ amount: 2 })
  })

  it('sin existencias avisa en lugar de fingir que ha restado', async () => {
    await addMilk(household, 1, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'consume', { p_product_id: product })

    await expect(rpc(household, 'consume', { p_product_id: product })).rejects.toThrow('nothing_to_consume')
  })

  it('"Todo" también termina las abiertas', async () => {
    await addMilk(household, 3, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'open_unit', { p_product_id: product })

    await rpc(household, 'consume', { p_product_id: product, p_all: true })

    expect(await lotsOf(household)).toHaveLength(0)
    expect(await unitsOf(household)).toHaveLength(0)
  })
})

describe('abrir', () => {
  it('abre del lote que caduca antes', async () => {
    await addMilk(household, 1, '2026-12-05')
    await addMilk(household, 1, '2026-12-01')
    const product = await milkId()

    await rpc(household, 'open_unit', { p_product_id: product })

    const lots = await lotsOf(household)
    const [unit] = await unitsOf(household)
    expect(unit!.lot_id).toBe(lots.find((lot) => lot.printed_date === '2026-12-01')!.id)
  })

  it('un lote con solo unidades abiertas sigue existiendo y desaparece al terminarlas', async () => {
    await addMilk(household, 1, '2026-12-01')
    const product = await milkId()

    await rpc(household, 'open_unit', { p_product_id: product })
    expect(await stockOf(household, product)).toEqual({ closed: [['2026-12-01', 0]], open: [1] })

    const [unit] = await unitsOf(household)
    await rpc(household, 'set_remaining', { p_opened_unit_id: unit!.id, p_fraction: 0 })

    expect(await lotsOf(household)).toHaveLength(0)
    expect((await movementsOf(household)).at(-1)?.type).toBe('finished')
  })

  it('en contables separa la unidad abierta del resto', async () => {
    await rpc(household, 'add_lot', {
      p_house_id: household.houseId,
      p_zone_id: household.zones.pantry,
      p_quantity: 3,
      p_name: 'Atún',
      p_quantity_kind: 'count',
      p_unit_label: 'can',
    })
    const [lot] = await lotsOf(household)

    await rpc(household, 'open_unit', { p_lot_id: lot!.id, p_reminder_date: '2026-12-01' })

    const lots = await lotsOf(household)
    const open = lots.find((row) => row.opened_at)
    const closed = lots.find((row) => !row.opened_at)
    expect(Number(open!.quantity)).toBe(1)
    expect(open!.reminder_date).toBe('2026-12-01')
    expect(Number(closed!.quantity)).toBe(2)
    expect(closed!.reminder_date).toBeNull()
  })

  it('a granel marca el lote entero como abierto, una sola vez', async () => {
    await rpc(household, 'add_lot', {
      p_house_id: household.houseId,
      p_zone_id: household.zones.fridge,
      p_quantity: 250,
      p_name: 'Queso',
      p_quantity_kind: 'bulk',
      p_unit_label: 'unit',
      p_bulk_unit: 'g',
    })
    const [lot] = await lotsOf(household)

    await rpc(household, 'open_unit', { p_lot_id: lot!.id })

    const [opened] = await lotsOf(household)
    expect(opened!.opened_at).not.toBeNull()
    expect(Number(opened!.quantity)).toBe(250)
    await expect(rpc(household, 'open_unit', { p_lot_id: lot!.id })).rejects.toThrow('nothing_to_open')
  })

  it('una unidad abierta con aviso usa la fecha efectiva correcta', async () => {
    await addMilk(household, 1, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'open_unit', { p_product_id: product, p_reminder_date: '2026-11-20' })

    const [unit] = await unitsOf(household)
    expect(unit).toMatchObject({ effective_date: '2026-11-20', effective_basis: 'reminder' })
  })

  it('set_remaining rechaza fracciones imposibles', async () => {
    await addMilk(household, 1, '2026-12-01')
    await rpc(household, 'open_unit', { p_product_id: await milkId() })
    const [unit] = await unitsOf(household)

    await expect(rpc(household, 'set_remaining', { p_opened_unit_id: unit!.id, p_fraction: 1.5 })).rejects.toThrow('invalid_amount')
    await expect(rpc(household, 'set_remaining', { p_opened_unit_id: unit!.id, p_fraction: -0.1 })).rejects.toThrow('invalid_amount')
  })
})

describe('ajustar, editar y tirar', () => {
  it('ajustar fija el valor y a 0 elimina el lote', async () => {
    await addMilk(household, 6, '2026-12-01')
    const [lot] = await lotsOf(household)

    await rpc(household, 'adjust_quantity', { p_lot_id: lot!.id, p_new_quantity: 4 })
    expect(Number((await lotsOf(household))[0]!.quantity)).toBe(4)

    await rpc(household, 'adjust_quantity', { p_lot_id: lot!.id, p_new_quantity: 0 })
    expect(await lotsOf(household)).toHaveLength(0)
    expect((await movementsOf(household)).map((movement) => movement.type)).toEqual(['added', 'adjusted', 'adjusted'])
  })

  it('tirar queda registrado como tirar y no como consumir', async () => {
    await addMilk(household, 3, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'open_unit', { p_product_id: product })
    const [lot] = await lotsOf(household)
    const [unit] = await unitsOf(household)

    await rpc(household, 'discard', { p_lot_id: lot!.id, p_quantity: 1, p_opened_unit_ids: [unit!.id] })

    expect(await stockOf(household, product)).toEqual({ closed: [['2026-12-01', 1]], open: [] })
    const last = (await movementsOf(household)).at(-1)
    expect(last?.type).toBe('discarded')
    expect(last?.details).toMatchObject({ amount: 2 })
  })

  it('tirar rechaza más de lo que hay', async () => {
    await addMilk(household, 1, '2026-12-01')
    const [lot] = await lotsOf(household)
    await expect(rpc(household, 'discard', { p_lot_id: lot!.id, p_quantity: 2 })).rejects.toThrow('invalid_amount')
    await expect(rpc(household, 'discard', { p_lot_id: lot!.id, p_quantity: 0 })).rejects.toThrow('invalid_amount')
  })

  it('editar cambia solo lo indicado, y un null vacía el campo', async () => {
    await addMilk(household, 1, '2026-12-01', { p_brand: 'Hacendado' })
    const [lot] = await lotsOf(household)

    await rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { brand: null } })
    expect((await lotsOf(household))[0]).toMatchObject({ brand: null, printed_date: '2026-12-01' })

    await rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { printed_date: '2027-01-01', printed_date_type: 'best_before' } })
    expect((await lotsOf(household))[0]).toMatchObject({
      printed_date: '2027-01-01',
      printed_date_type: 'best_before',
      effective_basis: 'best_before',
    })
  })

  it('editar no acepta una fecha sin tipo', async () => {
    await addMilk(household, 1, '2026-12-01')
    const [lot] = await lotsOf(household)
    await expect(rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { printed_date_type: null } })).rejects.toThrow('invalid_input')
  })

  it('editar puede fusionar con un lote que queda idéntico', async () => {
    await addMilk(household, 1, '2026-12-01')
    await addMilk(household, 2, '2026-12-02')
    const lots = await lotsOf(household)

    await rpc(household, 'update_lot', { p_lot_id: lots[0]!.id, p_patch: { printed_date: '2026-12-02' } })

    const merged = await lotsOf(household)
    expect(merged).toHaveLength(1)
    expect(Number(merged[0]!.quantity)).toBe(3)
  })

  it('se pueden editar las fechas de un lote congelado', async () => {
    await addMilk(household, 1, '2026-12-01', { p_zone_id: household.zones.freezer })
    const [lot] = await lotsOf(household)

    await rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { frozen_at: '2026-10-10', reminder_date: '2027-03-01' } })

    expect((await lotsOf(household))[0]).toMatchObject({
      frozen_at: '2026-10-10',
      reminder_date: '2027-03-01',
      effective_date: '2027-03-01',
      effective_basis: 'reminder',
    })
  })

  it('el aviso de una unidad abierta se puede poner y quitar', async () => {
    await addMilk(household, 1, '2026-12-01')
    await rpc(household, 'open_unit', { p_product_id: await milkId() })
    const [unit] = await unitsOf(household)

    await rpc(household, 'update_opened_unit', { p_opened_unit_id: unit!.id, p_patch: { reminder_date: '2026-11-20' } })
    expect((await unitsOf(household))[0]!.effective_date).toBe('2026-11-20')

    await rpc(household, 'update_opened_unit', { p_opened_unit_id: unit!.id, p_patch: { reminder_date: null } })
    expect((await unitsOf(household))[0]!.effective_date).toBe('2026-12-01')
  })
})

describe('mover entre zonas', () => {
  it('mover todo cambia la zona del mismo lote', async () => {
    await addMilk(household, 3, '2026-12-01')
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 3, p_target_zone_id: household.zones.pantry })

    const lots = await lotsOf(household)
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ id: lot!.id, zone_id: household.zones.pantry })
    expect((await movementsOf(household)).at(-1)).toMatchObject({
      type: 'moved_zone',
      details: { amount: 3, from_zone: 'fridge', to_zone: 'pantry' },
    })
  })

  it('mover una parte divide el lote conservando fecha y marca', async () => {
    await addMilk(household, 6, '2026-12-01', { p_brand: 'Hacendado' })
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 2, p_target_zone_id: household.zones.pantry })

    const lots = await lotsOf(household)
    expect(lots).toHaveLength(2)
    const moved = lots.find((row) => row.zone_id === household.zones.pantry)!
    const stayed = lots.find((row) => row.zone_id === household.zones.fridge)!
    expect(Number(stayed.quantity)).toBe(4)
    expect(Number(moved.quantity)).toBe(2)
    expect(moved).toMatchObject({ printed_date: '2026-12-01', printed_date_type: 'expiry', brand: 'Hacendado' })
  })

  it('al mover se fusiona con un lote idéntico en la zona destino', async () => {
    await addMilk(household, 2, '2026-12-01')
    await addMilk(household, 3, '2026-12-01', { p_zone_id: household.zones.pantry })
    const fridgeLot = (await lotsOf(household)).find((row) => row.zone_id === household.zones.fridge)!

    await rpc(household, 'move_lot', { p_lot_id: fridgeLot.id, p_quantity: 2, p_target_zone_id: household.zones.pantry })

    const lots = await lotsOf(household)
    expect(lots).toHaveLength(1)
    expect(Number(lots[0]!.quantity)).toBe(5)
  })

  it('se puede mover solo una unidad abierta, por ejemplo de la despensa a la nevera', async () => {
    await addMilk(household, 3, '2026-12-01', { p_zone_id: household.zones.pantry })
    await rpc(household, 'open_unit', { p_product_id: await milkId() })
    const [lot] = await lotsOf(household)
    const [unit] = await unitsOf(household)

    await rpc(household, 'move_lot', {
      p_lot_id: lot!.id,
      p_quantity: 0,
      p_target_zone_id: household.zones.fridge,
      p_opened_unit_ids: [unit!.id],
    })

    const lots = await lotsOf(household)
    const inFridge = lots.find((row) => row.zone_id === household.zones.fridge)!
    expect(Number(inFridge.quantity)).toBe(0)
    expect((await unitsOf(household))[0]!.lot_id).toBe(inFridge.id)
    expect(Number(lots.find((row) => row.zone_id === household.zones.pantry)!.quantity)).toBe(2)
  })

  it('rechaza mover a la misma zona, de más o nada', async () => {
    await addMilk(household, 2, '2026-12-01')
    const [lot] = await lotsOf(household)

    await expect(rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.fridge })).rejects.toThrow('same_zone')
    await expect(rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 3, p_target_zone_id: household.zones.pantry })).rejects.toThrow('invalid_amount')
    await expect(rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 0, p_target_zone_id: household.zones.pantry })).rejects.toThrow('invalid_amount')
  })

  it('rechaza mover a una zona de una casa de la que no se es miembro', async () => {
    const other = await createHousehold(household.db)
    await addMilk(household, 1, '2026-12-01')
    const [lot] = await lotsOf(household)

    await expect(rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: other.zones.fridge })).rejects.toThrow('not_member')
  })
})

describe('congelar y descongelar', () => {
  it('mover al congelador es congelar', async () => {
    await addMilk(household, 2, '2026-12-01')
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 2, p_target_zone_id: household.zones.freezer })

    const [frozen] = await lotsOf(household)
    expect(frozen!.frozen_at).not.toBeNull()
    expect(frozen!.effective_date).toBeNull()
    expect((await movementsOf(household)).at(-1)?.type).toBe('frozen')
  })

  it('congelar con aviso usa ese aviso', async () => {
    await addMilk(household, 2, '2026-12-01')
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 2, p_target_zone_id: household.zones.freezer, p_reminder_date: '2027-02-01' })

    expect((await lotsOf(household))[0]).toMatchObject({ effective_date: '2027-02-01', effective_basis: 'reminder' })
  })

  it('sacar del congelador es descongelar', async () => {
    await addMilk(household, 2, '2026-12-01', { p_zone_id: household.zones.freezer })
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 2, p_target_zone_id: household.zones.fridge })

    const [thawed] = await lotsOf(household)
    expect(thawed!.thawed_at).not.toBeNull()
    expect(thawed).toMatchObject({ effective_date: '2026-12-01', effective_basis: 'expiry' })
    expect((await movementsOf(household)).at(-1)?.type).toBe('thawed')
  })

  it('congelar lo descongelado borra la marca de descongelado', async () => {
    await addMilk(household, 1, '2026-12-01', { p_zone_id: household.zones.freezer })
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.fridge })
    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.freezer })

    const [frozen] = await lotsOf(household)
    expect(frozen!.thawed_at).toBeNull()
    expect(frozen!.frozen_at).not.toBeNull()
    expect(frozen!.effective_date).toBeNull()
  })

  it('mover entre frigo y despensa no toca las fechas de congelación', async () => {
    await addMilk(household, 1, '2026-12-01', { p_zone_id: household.zones.freezer })
    const [lot] = await lotsOf(household)
    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.fridge })
    const [before] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.pantry })

    const [after] = await lotsOf(household)
    expect(after).toMatchObject({ frozen_at: before!.frozen_at, thawed_at: before!.thawed_at })
    expect((await movementsOf(household)).at(-1)?.type).toBe('moved_zone')
  })

  it('al congelar una parte, solo se congela esa parte', async () => {
    await addMilk(household, 3, '2026-12-01')
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.freezer })

    const lots = await lotsOf(household)
    expect(lots.find((row) => row.zone_id === household.zones.fridge)).toMatchObject({ frozen_at: null, effective_date: '2026-12-01' })
    expect(lots.find((row) => row.zone_id === household.zones.freezer)).toMatchObject({ effective_date: null })
    expect(lots.find((row) => row.zone_id === household.zones.freezer)!.frozen_at).not.toBeNull()
  })
})

describe('tápers', () => {
  async function addDish(name = 'Lentejas', extra: Record<string, unknown> = {}) {
    return rpc(household, 'add_cooked_dish', {
      p_house_id: household.houseId,
      p_zone_id: household.zones.fridge,
      p_name: name,
      p_servings: 3,
      ...extra,
    })
  }

  async function numbers() {
    const { rows } = await household.db.query<{ container_number: number }>(
      'select container_number from public.lots where house_id = $1 order by container_number',
      [household.houseId],
    )
    return rows.map((row) => row.container_number)
  }

  it('reciben el número libre más bajo y se reutiliza al vaciarse', async () => {
    await addDish('Lentejas')
    await addDish('Cocido')
    await addDish('Paella')
    expect(await numbers()).toEqual([1, 2, 3])

    const cocido = (await productIdByName(household, 'Cocido'))!
    await rpc(household, 'consume', { p_product_id: cocido, p_all: true })
    expect(await numbers()).toEqual([1, 3])

    expect(await rpc(household, 'next_container_number', { p_house_id: household.houseId })).toBe(2)
    await addDish('Sopa')
    expect(await numbers()).toEqual([1, 2, 3])
    await addDish('Crema')
    expect(await numbers()).toEqual([1, 2, 3, 4])
  })

  it('el número es único en cada casa pero se puede repetir entre casas', async () => {
    await addDish('Lentejas')
    await expect(addDish('Cocido', { p_container_number: 1 })).rejects.toThrow('container_number_taken')

    const other = await createHousehold(household.db)
    const number = await rpc(other, 'next_container_number', { p_house_id: other.houseId })
    expect(number).toBe(1)
  })

  it('el número se puede editar, sin repetir uno en uso', async () => {
    await addDish('Lentejas')
    await addDish('Cocido')
    const lots = await lotsOf(household)

    await rpc(household, 'update_lot', { p_lot_id: lots[1]!.id, p_patch: { container_number: 7 } })
    expect(await numbers()).toEqual([1, 7])

    await expect(rpc(household, 'update_lot', { p_lot_id: lots[1]!.id, p_patch: { container_number: 1 } })).rejects.toThrow('container_number_taken')
  })

  it('cada táper es un producto propio aunque se llame igual', async () => {
    await addDish('Lentejas')
    await addDish('Lentejas')

    const { rows } = await household.db.query('select id from public.products where house_id = $1', [household.houseId])
    expect(rows).toHaveLength(2)
    expect(await numbers()).toEqual([1, 2])
  })

  it('un táper sin aviso no tiene fecha, y con aviso usa ese aviso', async () => {
    await addDish('Lentejas')
    await addDish('Cocido', { p_reminder_date: '2026-12-01' })
    const lots = await lotsOf(household)
    expect(lots.map((lot) => lot.effective_date).sort()).toEqual(['2026-12-01', null])
  })

  it('desaparece al consumirse del todo', async () => {
    await addDish('Lentejas')
    const product = (await productIdByName(household, 'Lentejas'))!

    await rpc(household, 'consume', { p_product_id: product, p_amount: 3 })

    expect(await lotsOf(household)).toHaveLength(0)
    expect(await productIdByName(household, 'Lentejas')).toBeUndefined()
    // El historial no se rompe aunque el producto ya no exista.
    expect((await movementsOf(household)).at(-1)).toMatchObject({ type: 'consumed', product_name: 'Lentejas' })
  })

  it('mover una parte crea otro táper con un número nuevo', async () => {
    await addDish('Lentejas')
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 1, p_target_zone_id: household.zones.freezer })

    const lots = await lotsOf(household)
    expect(lots).toHaveLength(2)
    expect(new Set(lots.map((row) => row.product_id)).size).toBe(2)
    expect(await numbers()).toEqual([1, 2])
    const moved = lots.find((row) => row.zone_id === household.zones.freezer)!
    expect(Number(moved.quantity)).toBe(1)
    expect(moved.container_number).toBe(2)
    expect(moved.frozen_at).not.toBeNull()
  })

  it('mover todo conserva el número', async () => {
    await addDish('Lentejas')
    const [lot] = await lotsOf(household)

    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 3, p_target_zone_id: household.zones.freezer })

    expect(await numbers()).toEqual([1])
  })

  it('no se pueden abrir', async () => {
    await addDish('Lentejas')
    const [lot] = await lotsOf(household)
    await expect(rpc(household, 'open_unit', { p_lot_id: lot!.id })).rejects.toThrow('invalid_input')
  })
})

describe('deshacer', () => {
  async function undoLast() {
    const last = (await movementsOf(household)).at(-1)!
    await rpc(household, 'undo_movement', { p_movement_id: last.id })
  }

  it('deshacer un consumo restaura y borra el movimiento del historial', async () => {
    await addMilk(household, 3, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'consume', { p_product_id: product })

    await undoLast()

    expect(await stockOf(household, product)).toEqual({ closed: [['2026-12-01', 3]], open: [] })
    expect((await movementsOf(household)).map((movement) => movement.type)).toEqual(['added'])
  })

  it('deshacer restaura un lote que había desaparecido, con sus unidades y el mismo id', async () => {
    await addMilk(household, 1, '2026-12-01', { p_brand: 'Hacendado' })
    const product = await milkId()
    await rpc(household, 'open_unit', { p_product_id: product })
    const [lot] = await lotsOf(household)
    const [unit] = await unitsOf(household)
    await rpc(household, 'set_remaining', { p_opened_unit_id: unit!.id, p_fraction: 0.6 })
    await rpc(household, 'consume', { p_product_id: product })
    expect(await lotsOf(household)).toHaveLength(0)

    await undoLast()

    expect(await lotsOf(household)).toMatchObject([{ id: lot!.id, brand: 'Hacendado' }])
    expect(await unitsOf(household)).toMatchObject([{ id: unit!.id, remaining_fraction: '0.6' }])
  })

  it('deshacer un alta quita el lote, la muestra de fecha y el producto recién creado', async () => {
    await addMilk(household, 1, '2026-12-01')

    await undoLast()

    expect(await lotsOf(household)).toHaveLength(0)
    expect(await productIdByName(household, 'Leche')).toBeUndefined()
    const { rows } = await household.db.query('select id from public.date_samples where house_id = $1', [household.houseId])
    expect(rows).toHaveLength(0)
  })

  it('deshacer un alta que se fusionó devuelve la cantidad anterior y conserva el producto', async () => {
    await addMilk(household, 2, '2026-12-01')
    await addMilk(household, 3, '2026-12-01')

    await undoLast()

    const product = await milkId()
    expect(await stockOf(household, product)).toEqual({ closed: [['2026-12-01', 2]], open: [] })
    const { rows } = await household.db.query('select id from public.date_samples where house_id = $1', [household.houseId])
    expect(rows).toHaveLength(1)
  })

  it('deshacer un movimiento parcial que se fusionó deja los dos lotes como estaban', async () => {
    await addMilk(household, 4, '2026-12-01')
    await addMilk(household, 1, '2026-12-01', { p_zone_id: household.zones.pantry })
    const fridgeLot = (await lotsOf(household)).find((row) => row.zone_id === household.zones.fridge)!
    await rpc(household, 'move_lot', { p_lot_id: fridgeLot.id, p_quantity: 2, p_target_zone_id: household.zones.pantry })

    await undoLast()

    const lots = await lotsOf(household)
    expect(Number(lots.find((row) => row.zone_id === household.zones.fridge)!.quantity)).toBe(4)
    expect(Number(lots.find((row) => row.zone_id === household.zones.pantry)!.quantity)).toBe(1)
  })

  // El orden de los identificadores es aleatorio y antes solo fallaba con algunos, de ahí la repetición.
  it('deshacer un movimiento con unidades abiertas que se fusionó las devuelve a su lote', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const home = await createHousehold(db)
      await addMilk(home, 3, '2026-12-01')
      await addMilk(home, 1, '2026-12-01', { p_zone_id: home.zones.pantry })
      await rpc(home, 'open_unit', { p_lot_id: (await lotsOf(home)).find((row) => row.zone_id === home.zones.fridge)!.id })
      const fridgeLot = (await lotsOf(home)).find((row) => row.zone_id === home.zones.fridge)!
      const [unit] = await unitsOf(home)
      await rpc(home, 'move_lot', {
        p_lot_id: fridgeLot.id,
        p_quantity: 2,
        p_target_zone_id: home.zones.pantry,
        p_opened_unit_ids: [unit!.id],
      })
      expect(await lotsOf(home)).toHaveLength(1)

      await rpc(home, 'undo_movement', { p_movement_id: (await movementsOf(home)).at(-1)!.id })

      const lots = await lotsOf(home)
      expect(lots).toHaveLength(2)
      expect(Number(lots.find((row) => row.zone_id === home.zones.fridge)!.quantity)).toBe(2)
      expect(Number(lots.find((row) => row.zone_id === home.zones.pantry)!.quantity)).toBe(1)
      expect((await unitsOf(home))[0]).toMatchObject({ id: unit!.id, lot_id: fridgeLot.id })
    }
  })

  it('deshacer congelar devuelve el lote a su zona y sus fechas', async () => {
    await addMilk(household, 2, '2026-12-01')
    const [lot] = await lotsOf(household)
    await rpc(household, 'move_lot', { p_lot_id: lot!.id, p_quantity: 2, p_target_zone_id: household.zones.freezer })

    await undoLast()

    expect((await lotsOf(household))[0]).toMatchObject({
      zone_id: household.zones.fridge,
      frozen_at: null,
      effective_date: '2026-12-01',
    })
  })

  it('deshacer un táper consumido lo recupera con su producto y su número', async () => {
    await rpc(household, 'add_cooked_dish', { p_house_id: household.houseId, p_zone_id: household.zones.fridge, p_name: 'Lentejas', p_servings: 2 })
    const product = (await productIdByName(household, 'Lentejas'))!
    await rpc(household, 'consume', { p_product_id: product, p_all: true })

    await undoLast()

    expect(await productIdByName(household, 'Lentejas')).toBe(product)
    expect(await lotsOf(household)).toMatchObject([{ container_number: 1, quantity: '2' }])
  })

  it('deshacer el alta de un táper lo quita con su producto', async () => {
    await rpc(household, 'add_cooked_dish', { p_house_id: household.houseId, p_zone_id: household.zones.fridge, p_name: 'Lentejas', p_servings: 2 })

    await undoLast()

    expect(await lotsOf(household)).toHaveLength(0)
    expect(await productIdByName(household, 'Lentejas')).toBeUndefined()
  })

  it('no se puede deshacer si después alguien tocó el mismo lote', async () => {
    await addMilk(household, 5, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'consume', { p_product_id: product })
    const first = (await movementsOf(household)).at(-1)!
    await rpc(household, 'consume', { p_product_id: product })

    await expect(rpc(household, 'undo_movement', { p_movement_id: first.id })).rejects.toThrow('undo_conflict')

    expect(await stockOf(household, product)).toEqual({ closed: [['2026-12-01', 3]], open: [] })
  })

  it('sí se puede deshacer si lo posterior tocó otro lote del mismo producto', async () => {
    await addMilk(household, 2, '2026-12-01')
    await addMilk(household, 2, '2026-12-05')
    const product = await milkId()
    const lots = await lotsOf(household)
    await rpc(household, 'consume', { p_lot_id: lots[0]!.id })
    const first = (await movementsOf(household)).at(-1)!
    await rpc(household, 'consume', { p_lot_id: lots[1]!.id })

    await rpc(household, 'undo_movement', { p_movement_id: first.id })

    expect((await stockOf(household, product)).closed).toEqual([['2026-12-01', 2], ['2026-12-05', 1]])
  })

  it('no se puede deshacer pasados 2 minutos', async () => {
    await addMilk(household, 2, '2026-12-01')
    const last = (await movementsOf(household)).at(-1)!
    await household.db.query(`update public.movements set created_at = now() - interval '3 minutes' where id = $1`, [last.id])

    await expect(rpc(household, 'undo_movement', { p_movement_id: last.id })).rejects.toThrow('undo_expired')
  })

  it('no se puede restaurar un táper si su número ya lo usa otro', async () => {
    await rpc(household, 'add_cooked_dish', { p_house_id: household.houseId, p_zone_id: household.zones.fridge, p_name: 'Lentejas', p_servings: 2 })
    const product = (await productIdByName(household, 'Lentejas'))!
    await rpc(household, 'consume', { p_product_id: product, p_all: true })
    const consumed = (await movementsOf(household)).at(-1)!
    await rpc(household, 'add_cooked_dish', { p_house_id: household.houseId, p_zone_id: household.zones.fridge, p_name: 'Cocido', p_servings: 2 })

    await expect(rpc(household, 'undo_movement', { p_movement_id: consumed.id })).rejects.toThrow('undo_conflict')
  })

  it('no se puede deshacer lo de otra casa', async () => {
    await addMilk(household, 2, '2026-12-01')
    const last = (await movementsOf(household)).at(-1)!
    const other = await createHousehold(household.db)

    await expect(rpc(other, 'undo_movement', { p_movement_id: last.id })).rejects.toThrow('not_member')
  })
})

describe('datos del producto', () => {
  it('guarda marca preferida y notas sin generar movimiento', async () => {
    await addMilk(household, 1, null)
    const product = await milkId()
    const before = (await movementsOf(household)).length

    await rpc(household, 'update_product', {
      p_product_id: product,
      p_patch: { preferred_brand: 'Pascual', brand_notes: 'la de Auchan no me gustó' },
    })

    const { rows } = await household.db.query<{ preferred_brand: string; brand_notes: string }>(
      'select preferred_brand, brand_notes from public.products where id = $1',
      [product],
    )
    expect(rows[0]).toEqual({ preferred_brand: 'Pascual', brand_notes: 'la de Auchan no me gustó' })
    expect(await movementsOf(household)).toHaveLength(before)
  })

  it('renombrar marca el nombre como propio y no permite duplicados', async () => {
    await addMilk(household, 1, null)
    await rpc(household, 'add_lot', { p_house_id: household.houseId, p_zone_id: household.zones.fridge, p_quantity: 1, p_name: 'Huevos' })
    const product = await milkId()

    await rpc(household, 'update_product', { p_product_id: product, p_patch: { name: 'Leche semi' } })
    const { rows } = await household.db.query<{ name: string; name_customized: boolean }>(
      'select name, name_customized from public.products where id = $1',
      [product],
    )
    expect(rows[0]).toEqual({ name: 'Leche semi', name_customized: true })

    await expect(rpc(household, 'update_product', { p_product_id: product, p_patch: { name: 'huevos' } })).rejects.toThrow('product_name_taken')
    await expect(rpc(household, 'update_product', { p_product_id: product, p_patch: { name: '  ' } })).rejects.toThrow('invalid_input')
  })

  it('solo se puede borrar sin existencias, y el historial conserva el nombre', async () => {
    await addMilk(household, 1, null)
    const product = await milkId()

    await expect(rpc(household, 'delete_product', { p_product_id: product })).rejects.toThrow('product_has_stock')

    await rpc(household, 'consume', { p_product_id: product })
    await rpc(household, 'delete_product', { p_product_id: product })

    expect(await productIdByName(household, 'Leche')).toBeUndefined()
    expect((await movementsOf(household)).map((movement) => movement.product_name)).toEqual(['Leche', 'Leche'])
  })
})

describe('historial', () => {
  it('registra un movimiento por operación, sin rastro de usuario', async () => {
    await addMilk(household, 3, '2026-12-01')
    const product = await milkId()
    await rpc(household, 'consume', { p_product_id: product })
    await rpc(household, 'open_unit', { p_product_id: product })

    expect((await movementsOf(household)).map((movement) => movement.type)).toEqual(['added', 'consumed', 'opened'])

    const { rows } = await household.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'movements'`,
    )
    expect(rows.map((row) => row.column_name).filter((name) => name.includes('user'))).toEqual([])
  })

  it('cada operación devuelve el id de su movimiento', async () => {
    const id = await addMilk(household, 1, null)
    expect((await movementsOf(household)).at(-1)?.id).toBe(id)
  })
})
