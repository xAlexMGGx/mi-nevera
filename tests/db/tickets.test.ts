import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'
import { addMilk, createHousehold, lotsOf, movementsOf, productIdByName, rpc, type Household } from './inventoryHelpers'

let db: PGlite
let household: Household

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  household = await createHousehold(db)
})

interface Line {
  zone: 'fridge' | 'freezer' | 'pantry'
  quantity: number
  product_id?: string
  catalog_item_id?: string
  name?: string
  category?: string
  quantity_kind?: string
  unit_label?: string
  content_amount?: number
  content_unit?: string
  bulk_unit?: string
  brand?: string
  printed_date?: string
  printed_date_type?: string
  barcode?: string
  image_url?: string
  raw_text?: string
}

const milkLine: Line = {
  zone: 'fridge',
  quantity: 6,
  name: 'Leche semidesnatada',
  category: 'dairy_eggs',
  quantity_kind: 'divisible',
  unit_label: 'brick',
  content_amount: 1,
  content_unit: 'l',
  brand: 'Hacendado',
  printed_date: '2026-12-20',
  printed_date_type: 'expiry',
  raw_text: 'LECHE SEMI HACEND 1L',
}

function applyTicket(lines: Line[], extra: Record<string, unknown> = {}, who: Pick<Household, 'db' | 'userId'> = household) {
  return rpc(who, 'apply_ticket', { p_house_id: household.houseId, p_lines: JSON.stringify(lines), ...extra })
}

async function catalogId(slug: string) {
  const { rows } = await db.query<{ id: string }>('select id from public.catalog_items where slug = $1', [slug])
  return rows[0]!.id
}

async function aliasesOf(houseId = household.houseId) {
  const { rows } = await db.query<{ raw_text_normalized: string; product_id: string; brand: string | null }>(
    'select raw_text_normalized, product_id, brand from public.ticket_aliases where house_id = $1 order by raw_text_normalized',
    [houseId],
  )
  return rows
}

async function matchLines(texts: string[], who: Pick<Household, 'db' | 'userId'> = household) {
  return asUser(db, who.userId, async (tx) => {
    const { rows } = await tx.query<{ raw_text: string; product_id: string; brand: string | null }>(
      'select * from public.match_ticket_lines($1, $2)',
      [household.houseId, texts],
    )
    return rows
  })
}

async function samplesOf(productId: string) {
  const { rows } = await db.query<{ days_to_printed_date: number; printed_date_type: string }>(
    'select days_to_printed_date, printed_date_type::text from public.date_samples where product_id = $1 order by created_at',
    [productId],
  )
  return rows
}

describe('apply_ticket', () => {
  it('añade todas las líneas en una sola operación, con un único movimiento', async () => {
    const yogurt = await catalogId('yogur-natural')
    await applyTicket(
      [
        milkLine,
        { zone: 'fridge', quantity: 4, catalog_item_id: yogurt, raw_text: 'YOGUR NATURAL X4' },
        { zone: 'pantry', quantity: 0.75, name: 'Tomates', category: 'vegetables', quantity_kind: 'bulk', unit_label: 'unit', bulk_unit: 'kg' },
      ],
      { p_store: '  Mercadona ' },
    )

    const milk = (await productIdByName(household, 'Leche semidesnatada'))!
    const lots = await lotsOf(household)
    expect(lots).toHaveLength(3)
    const milkLot = lots.find((lot) => lot.product_id === milk)!
    expect(milkLot).toMatchObject({ quantity: '6', brand: 'Hacendado', printed_date: '2026-12-20', printed_date_type: 'expiry' })

    const { rows: sources } = await db.query<{ source: string }>('select distinct source::text from public.lots where house_id = $1', [household.houseId])
    expect(sources).toEqual([{ source: 'ticket' }])

    const movements = await movementsOf(household)
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'ticket_applied', product_name: 'Mercadona' })
    expect(movements[0]!.details).toMatchObject({ store: 'Mercadona', count: 3 })
    expect((movements[0]!.details.items as { name: string; amount: number; zone: string }[]).map((item) => [item.name, item.amount, item.zone])).toEqual([
      ['Leche semidesnatada', 6, 'fridge'],
      ['Yogur natural', 4, 'fridge'],
      ['Tomates', 0.75, 'pantry'],
    ])
  })

  it('guarda el alias de cada línea y en el siguiente ticket la leche se empareja sola', async () => {
    await applyTicket([milkLine])
    const milk = (await productIdByName(household, 'Leche semidesnatada'))!

    expect(await aliasesOf()).toEqual([{ raw_text_normalized: 'leche semi hacend 1l', product_id: milk, brand: 'Hacendado' }])

    // Otro ticket escribe la línea con otro espaciado y puntuación.
    expect(await matchLines(['Leche  semi. HACEND 1L', 'PAN DE MOLDE'])).toEqual([
      { raw_text: 'Leche  semi. HACEND 1L', product_id: milk, brand: 'Hacendado' },
    ])
  })

  it('un alias corregido se actualiza en vez de duplicarse', async () => {
    await applyTicket([{ ...milkLine, raw_text: 'LECHE ENT 1L', name: 'Leche', brand: undefined }])
    await applyTicket([{ ...milkLine, raw_text: 'LECHE ENT 1L', name: 'Leche entera', brand: 'Pascual' }])
    const whole = (await productIdByName(household, 'Leche entera'))!
    expect(await aliasesOf()).toEqual([{ raw_text_normalized: 'leche ent 1l', product_id: whole, brand: 'Pascual' }])
  })

  it('suma a un lote igual que ya existe y guarda el código de barras y la foto', async () => {
    await addMilk(household, 2, '2026-12-20', { p_name: 'Leche semidesnatada', p_brand: 'Hacendado' })
    await applyTicket([{ ...milkLine, barcode: '8480000107862', image_url: 'https://images.openfoodfacts.org/x.jpg' }])

    const lots = await lotsOf(household)
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ quantity: '8', barcode: '8480000107862', image_url: 'https://images.openfoodfacts.org/x.jpg' })
  })

  it('apunta muestras de fecha desde el día de compra del ticket', async () => {
    await applyTicket([milkLine, { ...milkLine, quantity: 2, printed_date: '2026-12-27', printed_date_type: 'best_before', raw_text: undefined }], {
      p_purchased_at: '2026-11-01',
    })
    const milk = (await productIdByName(household, 'Leche semidesnatada'))!
    expect(await samplesOf(milk)).toEqual([
      { days_to_printed_date: 49, printed_date_type: 'expiry' },
      { days_to_printed_date: 56, printed_date_type: 'best_before' },
    ])
    const { rows } = await db.query<{ purchased_at: string }>('select distinct purchased_at::text from public.lots where product_id = $1', [milk])
    expect(rows).toEqual([{ purchased_at: '2026-11-01' }])
  })

  it('lo que entra en el congelador queda congelado', async () => {
    await applyTicket([{ zone: 'freezer', quantity: 1, name: 'Guisantes', category: 'frozen', quantity_kind: 'count', unit_label: 'bag' }])
    const [lot] = await lotsOf(household)
    expect(lot!.frozen_at).not.toBeNull()
  })

  it('rechaza el ticket entero si una línea no es válida, sin dejar nada a medias', async () => {
    await expect(applyTicket([milkLine, { ...milkLine, quantity: 0, raw_text: 'OTRA' }])).rejects.toThrow('invalid_amount')
    await expect(applyTicket([milkLine, { ...milkLine, printed_date_type: undefined }])).rejects.toThrow('invalid_input')
    await expect(applyTicket([milkLine, { ...milkLine, zone: 'garage' as never }])).rejects.toThrow('invalid_input')
    await expect(applyTicket([milkLine, { ...milkLine, printed_date: '2026-02-30' }])).rejects.toThrow('invalid_input')
    await expect(applyTicket([{ ...milkLine, name: 'Zumo', content_amount: undefined }])).rejects.toThrow('invalid_input')
    await expect(applyTicket([{ ...milkLine, barcode: '84-80' }])).rejects.toThrow('invalid_input')
    await expect(applyTicket([{ ...milkLine, image_url: 'javascript:alert(1)' }])).rejects.toThrow('invalid_input')
    await expect(applyTicket([])).rejects.toThrow('invalid_input')
    await expect(applyTicket([milkLine], { p_purchased_at: '2999-01-01' })).rejects.toThrow('invalid_input')

    expect(await lotsOf(household)).toEqual([])
    expect(await aliasesOf()).toEqual([])
    expect(await movementsOf(household)).toEqual([])
  })

  it('un producto de otra casa no sirve', async () => {
    const other = await createHousehold(db)
    await addMilk(other, 1, null)
    const foreign = (await productIdByName(other, 'Leche'))!
    await expect(applyTicket([{ zone: 'fridge', quantity: 1, product_id: foreign }])).rejects.toThrow('not_found')
  })

  it('solo pueden usarlo los miembros de la casa', async () => {
    const stranger = { db, userId: await createUser(db) }
    await expect(applyTicket([milkLine], {}, stranger)).rejects.toThrow('not_member')
    await expect(matchLines(['LECHE'], stranger)).rejects.toThrow('not_member')
  })

  it('los alias no se pueden escribir directamente', async () => {
    const milk = (await addMilk(household, 1, null), (await productIdByName(household, 'Leche'))!)
    await expect(
      asUser(db, household.userId, (tx) =>
        tx.query('insert into public.ticket_aliases (house_id, raw_text_normalized, product_id) values ($1, $2, $3)', [household.houseId, 'leche', milk]),
      ),
    ).rejects.toThrow()
  })
})

describe('deshacer un ticket', () => {
  it('quita todo lo añadido, los productos nuevos, las muestras y los alias', async () => {
    await addMilk(household, 2, '2026-12-20', { p_name: 'Leche semidesnatada', p_brand: 'Hacendado' })
    const before = await lotsOf(household)

    const movement = await applyTicket([
      milkLine,
      { zone: 'pantry', quantity: 1, name: 'Galletas', category: 'snacks', quantity_kind: 'count', unit_label: 'package', raw_text: 'GALLETAS MARIA' },
    ])
    await rpc(household, 'undo_movement', { p_movement_id: movement })

    expect(await lotsOf(household)).toEqual(before)
    expect(await productIdByName(household, 'Galletas')).toBeUndefined()
    expect(await aliasesOf()).toEqual([])
    const milk = (await productIdByName(household, 'Leche semidesnatada'))!
    expect(await samplesOf(milk)).toHaveLength(1)
    expect((await movementsOf(household)).map((row) => row.type)).toEqual(['added'])
  })

  it('devuelve el alias anterior a como estaba', async () => {
    await applyTicket([{ ...milkLine, raw_text: 'LECHE ENT 1L', name: 'Leche', brand: 'Pascual' }])
    const milk = (await productIdByName(household, 'Leche'))!
    const movement = await applyTicket([{ ...milkLine, raw_text: 'LECHE ENT 1L', name: 'Leche entera', brand: 'Central' }])
    await rpc(household, 'undo_movement', { p_movement_id: movement })
    expect(await aliasesOf()).toEqual([{ raw_text_normalized: 'leche ent 1l', product_id: milk, brand: 'Pascual' }])
  })

  it('no se deshace si después alguien ha tocado lo añadido', async () => {
    const movement = await applyTicket([milkLine])
    const milk = (await productIdByName(household, 'Leche semidesnatada'))!
    await rpc(household, 'consume', { p_product_id: milk })
    await expect(rpc(household, 'undo_movement', { p_movement_id: movement })).rejects.toThrow('undo_conflict')
  })
})

describe('código de barras y foto en el lote', () => {
  it('add_lot los guarda y update_lot los asigna o los quita', async () => {
    await addMilk(household, 1, null, { p_barcode: ' 8410000000001 ', p_image_url: 'https://images.openfoodfacts.org/a.jpg' })
    const [lot] = await lotsOf(household)
    expect(lot).toMatchObject({ barcode: '8410000000001', image_url: 'https://images.openfoodfacts.org/a.jpg' })

    await rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { barcode: '8410000000002', image_url: null } })
    expect((await lotsOf(household))[0]).toMatchObject({ barcode: '8410000000002', image_url: null })

    await expect(rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { barcode: 'abc' } })).rejects.toThrow('invalid_input')
    await expect(rpc(household, 'update_lot', { p_lot_id: lot!.id, p_patch: { image_url: 'http://insecure.example/x.jpg' } })).rejects.toThrow('invalid_input')
  })

  it('Deshacer de un alta manual sigue funcionando', async () => {
    const movement = await addMilk(household, 1, '2026-12-01', { p_barcode: '8410000000001' })
    await rpc(household, 'undo_movement', { p_movement_id: movement })
    expect(await lotsOf(household)).toEqual([])
    expect(await productIdByName(household, 'Leche')).toBeUndefined()
  })
})

describe('límite diario de lecturas con IA', () => {
  it('cuenta por persona y tipo, y se corta al pasar el límite', async () => {
    const claims: boolean[] = []
    for (let i = 0; i < 21; i++) claims.push(await rpc<boolean>(household, 'claim_ai_use', { p_kind: 'receipt' }))
    expect(claims.filter(Boolean)).toHaveLength(20)
    expect(claims.at(-1)).toBe(false)

    // Las fechas tienen su propio límite, y otra persona, el suyo.
    expect(await rpc<boolean>(household, 'claim_ai_use', { p_kind: 'date' })).toBe(true)
    const other = await createHousehold(db)
    expect(await rpc<boolean>(other, 'claim_ai_use', { p_kind: 'receipt' })).toBe(true)

    await expect(rpc(household, 'claim_ai_use', { p_kind: 'recipes' })).rejects.toThrow('invalid_input')
  })

  it('el contador no es visible desde la app', async () => {
    await expect(asUser(db, household.userId, (tx) => tx.query('select * from private.ai_usage'))).rejects.toThrow()
  })
})

describe('Mis datos', () => {
  it('incluye los alias de cada casa', async () => {
    await applyTicket([milkLine])
    const data = await rpc<{ houses: { ticket_aliases: { raw_text_normalized: string }[] }[] }>(household, 'export_my_data')
    expect(data.houses[0]!.ticket_aliases.map((alias) => alias.raw_text_normalized)).toEqual(['leche semi hacend 1l'])
  })
})
