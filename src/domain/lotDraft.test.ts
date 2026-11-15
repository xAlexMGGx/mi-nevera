import { describe, expect, it } from 'vitest'
import type { ProductProposal } from '../../supabase/functions/_shared/productMatch.ts'
import {
  addLotArgs,
  attachScan,
  emptyLine,
  fitQuantity,
  lineCounting,
  lineProblem,
  linePayload,
  retargetLine,
  targetFromProposal,
  targetFromSelection,
  unitChoiceOf,
  withContent,
  withUnitChoice,
  type CountingSpec,
  type LineTarget,
} from './lotDraft'
import { catalog, catalogItem, house, milk } from './testFixtures'

const brick: CountingSpec = { quantityKind: 'divisible', unitLabel: 'brick', contentAmount: 1, contentUnit: 'l', bulkUnit: null }

describe('unidades junto a la cantidad', () => {
  it('el selector distingue envases de peso y volumen', () => {
    expect(unitChoiceOf(brick)).toBe('unit:brick')
    expect(unitChoiceOf({ ...brick, quantityKind: 'bulk', bulkUnit: 'kg' })).toBe('bulk:kg')
  })

  it('pasar a kg cuenta a granel y vuelve a envases sin contenido', () => {
    const bulk = withUnitChoice(brick, 'bulk:kg')
    expect(bulk).toEqual({ quantityKind: 'bulk', unitLabel: 'unit', contentAmount: null, contentUnit: null, bulkUnit: 'kg' })
    expect(withUnitChoice(bulk, 'unit:bag')).toEqual({ quantityKind: 'count', unitLabel: 'bag', contentAmount: null, contentUnit: null, bulkUnit: null })
  })

  it('cambiar de envase conserva lo que contiene', () => {
    expect(withUnitChoice(brick, 'unit:bottle')).toEqual({ ...brick, unitLabel: 'bottle' })
  })

  it('con contenido se gasta poco a poco; sin él, se cuenta entero', () => {
    const count: CountingSpec = { quantityKind: 'count', unitLabel: 'jar', contentAmount: null, contentUnit: null, bulkUnit: null }
    expect(withContent(count, 400, 'g')).toEqual({ ...count, quantityKind: 'divisible', contentAmount: 400, contentUnit: 'g' })
    expect(withContent(brick, null, 'l')).toEqual({ ...brick, quantityKind: 'count', contentAmount: null, contentUnit: null })
  })

  it('en unidades la cantidad es entera', () => {
    expect(fitQuantity(1.2, brick)).toBe(1)
    expect(fitQuantity(0.3, brick)).toBe(1)
    expect(fitQuantity(1.2, { ...brick, quantityKind: 'bulk' })).toBe(1.2)
  })
})

describe('qué se añade', () => {
  it('un producto del catálogo empieza con su forma de contar, que se puede cambiar', () => {
    const target = targetFromSelection({ type: 'catalog', item: catalog.get('cat-beans')! }, null, house.products)
    expect(target).toEqual({ type: 'catalog', catalogItemId: 'cat-beans', counting: { quantityKind: 'bulk', unitLabel: 'unit', contentAmount: null, contentUnit: null, bulkUnit: 'kg' } })
  })

  it('un producto nuevo hereda la forma de contar y la categoría de lo que había', () => {
    const target = targetFromSelection({ type: 'new', name: 'Leche de cabra' }, { type: 'product', productId: 'milk' }, house.products)
    expect(target).toEqual({ type: 'new', name: 'Leche de cabra', category: 'dairy_eggs', counting: brick })
  })

  it('un producto de la casa se cuenta siempre como en la casa', () => {
    expect(lineCounting({ type: 'product', productId: 'milk' }, house.products)).toEqual({ quantity_kind: 'divisible', unit_label: 'brick', bulk_unit: null })
  })

  it('cambiar de producto lleva la zona y ajusta la cantidad', () => {
    const line = { ...emptyLine({ type: 'catalog', catalogItemId: 'cat-beans', counting: withUnitChoice(brick, 'bulk:kg') }, house, catalog), quantity: 1.5 }
    const changed = retargetLine(line, { type: 'product', productId: 'milk' }, house, catalog)
    expect(changed).toMatchObject({ zone: 'pantry', quantity: 2 })
  })
})

describe('lo propuesto para un código escaneado', () => {
  const proposal: ProductProposal = {
    matched_product_id: null,
    catalog_item_id: 'cat-beans',
    name: 'Judías verdes',
    category: 'vegetables',
    quantity_kind: 'divisible',
    unit_label: 'bag',
    content_amount: 1,
    content_unit: 'kg',
    suggested_zone: 'freezer',
  }

  it('un producto de la casa, del catálogo o uno nuevo', () => {
    expect(targetFromProposal({ ...proposal, matched_product_id: 'milk' }, house.products, catalog)).toEqual({ type: 'product', productId: 'milk' })
    expect(targetFromProposal({ ...proposal, matched_product_id: 'otra-casa' }, house.products, catalog).type).toBe('catalog')
    expect(targetFromProposal(proposal, house.products, catalog)).toEqual({
      type: 'catalog',
      catalogItemId: 'cat-beans',
      counting: { quantityKind: 'divisible', unitLabel: 'bag', contentAmount: 1, contentUnit: 'kg', bulkUnit: null },
    })
    expect(targetFromProposal({ ...proposal, catalog_item_id: null, name: 'Judías verdes finas' }, house.products, catalog)).toMatchObject({ type: 'new', name: 'Judías verdes finas', category: 'vegetables' })
  })

  it('el código añade foto, marca si no había y el contenido si falta', () => {
    const jar: LineTarget = { type: 'new', name: 'Mermelada', category: 'breakfast', counting: { quantityKind: 'count', unitLabel: 'jar', contentAmount: null, contentUnit: null, bulkUnit: null } }
    const line = attachScan(emptyLine(jar, house, catalog), { barcode: '84100', brand: 'Hero', imageUrl: 'https://x/y.jpg', contentAmount: 340, contentUnit: 'g' })
    expect(line).toMatchObject({ barcode: '84100', brand: 'Hero', imageUrl: 'https://x/y.jpg' })
    expect(line.target).toMatchObject({ counting: { quantityKind: 'divisible', contentAmount: 340, contentUnit: 'g' } })
    // La marca escrita no se pisa.
    expect(attachScan({ ...line, brand: 'Mía' }, { barcode: '1', brand: 'Hero', imageUrl: null, contentAmount: null, contentUnit: null })).toMatchObject({ brand: 'Mía', imageUrl: 'https://x/y.jpg' })
  })
})

describe('antes de añadir', () => {
  it('avisa de lo que falta', () => {
    const line = emptyLine({ type: 'product', productId: 'milk' }, house, catalog)
    expect(lineProblem(line, house.products)).toBeNull()
    expect(lineProblem({ ...line, quantity: 1.5 }, house.products)).toBe('quantity')
    expect(lineProblem({ ...line, printedDate: '2026-12-01' }, house.products)).toBe('dateType')
    expect(lineProblem(emptyLine({ type: 'new', name: ' ', category: 'other', counting: brick }, house, catalog), house.products)).toBe('name')
    expect(lineProblem(emptyLine({ type: 'new', name: 'Zumo', category: 'drinks', counting: { ...brick, contentAmount: null } }, house, catalog), house.products)).toBe('content')
  })

  it('add_lot recibe el producto, su forma de contar y las fechas', () => {
    const line = {
      ...emptyLine({ type: 'catalog', catalogItemId: 'cat-beans', counting: brick }, house, catalog),
      zone: 'freezer' as const,
      quantity: 2,
      brand: ' Bonduelle ',
      reminderDate: '2027-05-01',
      barcode: '84100',
    }
    expect(addLotArgs(line, { houseId: 'h1', zoneId: 'z-freezer', purchasedAt: '2026-11-12', source: 'barcode' })).toEqual({
      p_house_id: 'h1',
      p_zone_id: 'z-freezer',
      p_quantity: 2,
      p_product_id: undefined,
      p_catalog_item_id: 'cat-beans',
      p_name: undefined,
      p_category: undefined,
      p_quantity_kind: 'divisible',
      p_unit_label: 'brick',
      p_content_amount: 1,
      p_content_unit: 'l',
      p_bulk_unit: undefined,
      p_brand: 'Bonduelle',
      p_printed_date: undefined,
      p_printed_date_type: undefined,
      p_purchased_at: '2026-11-12',
      p_frozen_at: '2026-11-12',
      p_reminder_date: '2027-05-01',
      p_source: 'barcode',
      p_barcode: '84100',
      p_image_url: undefined,
    })
  })

  it('fuera del congelador no se mandan sus fechas', () => {
    const line = { ...emptyLine({ type: 'product', productId: milk.id }, house, catalog), frozenAt: '2026-11-01', reminderDate: '2027-01-01' }
    expect(linePayload(line)).toMatchObject({ product_id: 'milk', zone: 'pantry', frozen_at: null, reminder_date: null })
  })

  it('el catálogo puede no tener contenido por defecto', () => {
    expect(targetFromSelection({ type: 'catalog', item: catalogItem({ id: 'x', default_quantity_kind: 'divisible' }) }, null, [])).toMatchObject({
      counting: { quantityKind: 'divisible', contentAmount: null },
    })
  })
})
