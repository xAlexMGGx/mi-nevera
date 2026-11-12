import { describe, expect, it } from 'vitest'
import type { ReceiptLine, ReceiptResult } from '../../supabase/functions/_shared/receipt.ts'
import type { CatalogItem, Product } from './inventory'
import {
  applyPayload,
  chainQueue,
  draftFromReceipt,
  lineCounting,
  lineProblem,
  moveDraftToHouse,
  normalizeName,
  removeLine,
  retargetLine,
  splitLine,
  updateLine,
  type HouseData,
} from './ticket'

const today = '2026-11-11'

function catalogItem(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: 'cat',
    slug: 'cat',
    name_es: 'Cat',
    name_en: 'Cat',
    icon: '🍽️',
    category: 'other',
    default_zone: 'pantry',
    default_quantity_kind: 'count',
    default_unit_label: 'unit',
    default_content_amount: null,
    default_content_unit: null,
    synonyms_es: [],
    synonyms_en: [],
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const catalog = new Map([
  ['cat-yogurt', catalogItem({ id: 'cat-yogurt', name_es: 'Yogur natural', default_zone: 'fridge', default_unit_label: 'yogurt' })],
  ['cat-peas', catalogItem({ id: 'cat-peas', name_es: 'Guisantes congelados', default_zone: 'freezer', default_unit_label: 'bag' })],
])

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p',
    house_id: 'h1',
    catalog_item_id: null,
    name: 'P',
    name_customized: false,
    name_normalized: 'p',
    category: 'other',
    icon: null,
    kind: 'food',
    quantity_kind: 'count',
    unit_label: 'unit',
    content_amount: null,
    content_unit: null,
    bulk_unit: null,
    preferred_brand: null,
    brand_notes: null,
    image_url: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const milk = product({ id: 'milk', name: 'Leche', category: 'dairy_eggs', quantity_kind: 'divisible', unit_label: 'brick', content_amount: 1, content_unit: 'l' })
const yogurt = product({ id: 'yogurt', name: 'Yogur natural', catalog_item_id: 'cat-yogurt', unit_label: 'yogurt' })

const house: HouseData = {
  products: [milk, yogurt],
  lots: [{ product_id: 'milk', zone_id: 'z-pantry', barcode: null }],
  zones: [
    { id: 'z-fridge', kind: 'fridge' },
    { id: 'z-pantry', kind: 'pantry' },
  ],
}

function receiptLine(overrides: Partial<ReceiptLine>): ReceiptLine {
  return {
    raw_text: 'LINEA',
    name: 'Producto',
    matched_product_id: null,
    catalog_item_id: null,
    brand: null,
    is_food: true,
    quantity: 1,
    quantity_kind: 'count',
    unit_label: 'unit',
    content_amount: null,
    content_unit: null,
    suggested_zone: 'fridge',
    category: 'other',
    from_alias: false,
    ...overrides,
  }
}

const receipt: ReceiptResult = {
  store: 'Mercadona',
  date: '2026-11-10',
  lines: [
    receiptLine({ raw_text: 'LECHE SEMI HACEND 1L', name: 'Leche', matched_product_id: 'milk', brand: 'Hacendado', quantity: 6, from_alias: true }),
    receiptLine({ raw_text: 'GUISANTES CONG', name: 'Guisantes', catalog_item_id: 'cat-peas', suggested_zone: 'fridge' }),
    receiptLine({ raw_text: 'DETERGENTE', name: 'Detergente', is_food: false, suggested_zone: 'pantry' }),
    receiptLine({ raw_text: 'TOMATE', name: 'Tomate', quantity_kind: 'bulk', quantity: 0.75, content_unit: 'kg', category: 'vegetables', suggested_zone: 'pantry' }),
    receiptLine({ raw_text: 'FANTASMA', name: 'Fantasma', matched_product_id: 'no-existe' }),
  ],
}

function draft() {
  return draftFromReceipt(receipt, 'h1', today, house, catalog)
}

describe('borrador del ticket', () => {
  it('empareja, propone zonas y desmarca lo que no es comida', () => {
    const { lines, store, purchasedAt } = draft()
    expect(store).toBe('Mercadona')
    expect(purchasedAt).toBe('2026-11-10')
    expect(lines.map((line) => [line.target.type, line.checked, line.zone, line.fromAlias])).toEqual([
      // La leche está en la despensa de esta casa.
      ['product', true, 'pantry', true],
      // Lo del catálogo, donde dice el catálogo.
      ['catalog', true, 'freezer', false],
      ['new', false, 'pantry', false],
      ['new', true, 'pantry', false],
      // Un producto que no es de esta casa no se empareja.
      ['new', true, 'fridge', false],
    ])
    expect(lines[0]).toMatchObject({ quantity: 6, brand: 'Hacendado', printedDate: '', dateType: null, rawText: 'LECHE SEMI HACEND 1L' })
    expect(lines[3]!.target).toMatchObject({ type: 'new', quantityKind: 'bulk', bulkUnit: 'kg' })
  })

  it('sin fecha en el ticket, se compra hoy', () => {
    expect(draftFromReceipt({ ...receipt, date: null }, 'h1', today, house, catalog).purchasedAt).toBe(today)
  })

  it('cuenta según el producto emparejado', () => {
    const { lines } = draft()
    expect(lineCounting(lines[0]!.target, house.products, catalog)).toEqual({ quantity_kind: 'divisible', unit_label: 'brick', bulk_unit: null })
    expect(lineCounting(lines[1]!.target, house.products, catalog)).toEqual({ quantity_kind: 'count', unit_label: 'bag', bulk_unit: null })
    expect(lineCounting(lines[3]!.target, house.products, catalog)).toEqual({ quantity_kind: 'bulk', unit_label: 'unit', bulk_unit: 'kg' })
  })

  it('cambiar el producto quita el emparejamiento del ticket anterior y mueve la zona', () => {
    const line = draft().lines[0]!
    const changed = retargetLine(line, { type: 'catalog', catalogItemId: 'cat-yogurt' }, house, catalog)
    expect(changed).toMatchObject({ fromAlias: false, zone: 'fridge', quantity: 6, brand: 'Hacendado' })
  })

  it('dividir una línea deja dos lotes con la misma cantidad total y la fecha solo en el primero', () => {
    let current = draft()
    const key = current.lines[0]!.key
    current = updateLine(current, key, { printedDate: '2026-11-20', dateType: 'expiry' })
    current = splitLine(current, key)
    expect(current.lines.slice(0, 2).map((line) => [line.quantity, line.printedDate, line.target])).toEqual([
      [5, '2026-11-20', { type: 'product', productId: 'milk' }],
      [1, '', { type: 'product', productId: 'milk' }],
    ])
    expect(new Set(current.lines.map((line) => line.key)).size).toBe(current.lines.length)
    // Una sola unidad o a granel no se divide.
    expect(splitLine(current, current.lines[1]!.key)).toBe(current)
  })

  it('el escaneo en cadena recorre las líneas marcadas sin fecha', () => {
    let current = draft()
    const [first, second] = current.lines
    current = updateLine(current, first!.key, { printedDate: '2026-11-20', dateType: 'expiry' })
    current = removeLine(current, second!.key)
    expect(chainQueue(current)).toEqual([current.lines[2]!.key, current.lines[3]!.key])
  })

  it('avisa de lo que impide aplicar', () => {
    const [line] = draft().lines
    const counting = lineCounting(line!.target, house.products, catalog)
    expect(lineProblem(line!, counting)).toBeNull()
    expect(lineProblem({ ...line!, quantity: 0 }, counting)).toBe('quantity')
    expect(lineProblem({ ...line!, quantity: 1.5 }, counting)).toBe('quantity')
    expect(lineProblem({ ...line!, printedDate: '2026-11-20' }, counting)).toBe('dateType')
    const newLine = draft().lines[3]!
    const bulk = lineCounting(newLine.target, house.products, catalog)
    expect(lineProblem(newLine, bulk)).toBeNull()
    expect(lineProblem({ ...newLine, target: { ...(newLine.target as Extract<typeof newLine.target, { type: 'new' }>), name: ' ' } }, bulk)).toBe('name')
    const divisible = { ...newLine, target: { type: 'new' as const, name: 'Zumo', category: 'drinks' as const, quantityKind: 'divisible' as const, unitLabel: 'brick', contentAmount: null, contentUnit: null, bulkUnit: null }, quantity: 2 }
    expect(lineProblem(divisible, lineCounting(divisible.target, house.products, catalog))).toBe('content')
  })

  it('aplica solo lo marcado, con fecha, tipo y producto según la línea', () => {
    let current = draft()
    current = updateLine(current, current.lines[0]!.key, { printedDate: '2026-11-20', dateType: 'expiry', barcode: '8410000000001' })
    current = updateLine(current, current.lines[4]!.key, { checked: false })
    expect(applyPayload(current)).toEqual([
      {
        product_id: 'milk',
        zone: 'pantry',
        quantity: 6,
        brand: 'Hacendado',
        printed_date: '2026-11-20',
        printed_date_type: 'expiry',
        barcode: '8410000000001',
        image_url: null,
        raw_text: 'LECHE SEMI HACEND 1L',
      },
      { catalog_item_id: 'cat-peas', zone: 'freezer', quantity: 1, brand: null, printed_date: null, printed_date_type: null, barcode: null, image_url: null, raw_text: 'GUISANTES CONG' },
      {
        name: 'Tomate',
        category: 'vegetables',
        quantity_kind: 'bulk',
        unit_label: 'unit',
        content_amount: null,
        content_unit: null,
        bulk_unit: 'kg',
        zone: 'pantry',
        quantity: 0.75,
        brand: null,
        printed_date: null,
        printed_date_type: null,
        barcode: null,
        image_url: null,
        raw_text: 'TOMATE',
      },
    ])
  })
})

describe('cambiar la casa destino', () => {
  it('busca el mismo producto en la otra casa o lo creará con la misma forma de contar', () => {
    const beach: HouseData = {
      products: [product({ id: 'beach-yogurt', house_id: 'h2', name: 'Yogures', catalog_item_id: 'cat-yogurt' }), product({ id: 'beach-milk', house_id: 'h2', name: 'LECHE ' })],
      lots: [],
      zones: [],
    }
    let current = draft()
    current = { ...current, lines: [...current.lines, { ...current.lines[0]!, key: 'y', target: { type: 'product', productId: 'yogurt' } }] }
    const moved = moveDraftToHouse(current, 'h2', house, beach)
    expect(moved.houseId).toBe('h2')
    expect(moved.lines[0]!.target).toEqual({ type: 'product', productId: 'beach-milk' })
    expect(moved.lines.at(-1)!.target).toEqual({ type: 'product', productId: 'beach-yogurt' })
    expect(moved.lines.every((line) => !line.fromAlias)).toBe(true)

    const empty: HouseData = { products: [], lots: [], zones: [] }
    const fresh = moveDraftToHouse(current, 'h3', house, empty)
    expect(fresh.lines[0]!.target).toMatchObject({ type: 'new', name: 'Leche', quantityKind: 'divisible', contentAmount: 1, contentUnit: 'l' })
    expect(fresh.lines.at(-1)!.target).toEqual({ type: 'catalog', catalogItemId: 'cat-yogurt' })
  })

  it('normaliza los nombres como la base de datos', () => {
    expect(normalizeName('  Léche   Entera ')).toBe('leche entera')
  })
})
