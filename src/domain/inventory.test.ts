import { describe, expect, it } from 'vitest'
import { buildProductViews, productName, sortViews, type CatalogItem, type InventoryData, type Lot, type OpenedUnit, type Product } from './inventory'

const zones = [
  { id: 'z-fridge', house_id: 'h', kind: 'fridge', sort_order: 1, created_at: '', updated_at: '' },
  { id: 'z-freezer', house_id: 'h', kind: 'freezer', sort_order: 2, created_at: '', updated_at: '' },
  { id: 'z-pantry', house_id: 'h', kind: 'pantry', sort_order: 3, created_at: '', updated_at: '' },
] as InventoryData['zones']

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name,
    house_id: 'h',
    catalog_item_id: null,
    name_customized: false,
    name_normalized: name.toLowerCase(),
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
    ...extra,
  }
}

function lot(id: string, productId: string, extra: Partial<Lot> = {}): Lot {
  return {
    id,
    product_id: productId,
    house_id: 'h',
    zone_id: 'z-fridge',
    quantity: 1,
    brand: null,
    barcode: null,
    image_url: null,
    printed_date: null,
    printed_date_type: null,
    purchased_at: '2026-11-01',
    cooked_at: null,
    frozen_at: null,
    thawed_at: null,
    reminder_date: null,
    container_number: null,
    opened_at: null,
    source: 'manual',
    created_at: '',
    updated_at: '',
    effective_date: null,
    effective_basis: null,
    ...extra,
  }
}

function unit(id: string, lotId: string, extra: Partial<OpenedUnit> = {}): OpenedUnit {
  return {
    id,
    lot_id: lotId,
    house_id: 'h',
    remaining_fraction: 1,
    opened_at: '2026-11-05',
    reminder_date: null,
    created_at: '',
    updated_at: '',
    effective_date: null,
    effective_basis: null,
    ...extra,
  }
}

const options = {
  catalog: new Map<string, CatalogItem>(),
  language: 'es',
  today: '2026-11-09',
  daysAhead: 2,
  zone: 'all',
  leftoversOnly: false,
} as const

describe('buildProductViews', () => {
  it('oculta los productos sin existencias', () => {
    const data = { zones, products: [product('p', 'Leche')], lots: [], units: [] }
    expect(buildProductViews(data, options)).toEqual([])
  })

  it('una zona solo muestra lo que hay en esa zona', () => {
    const data: InventoryData = {
      zones,
      products: [product('p', 'Leche'), product('q', 'Arroz')],
      lots: [lot('a', 'p', { quantity: 3 }), lot('b', 'p', { zone_id: 'z-pantry', quantity: 6 }), lot('c', 'q', { zone_id: 'z-pantry' })],
      units: [],
    }

    const fridge = buildProductViews(data, { ...options, zone: 'fridge' })
    expect(fridge.map((view) => view.name)).toEqual(['Leche'])
    expect(fridge[0]!.lots.map((row) => row.id)).toEqual(['a'])

    expect(buildProductViews(data, options)[0]!.lots).toHaveLength(2)
  })

  it('el filtro Restos solo deja los tápers', () => {
    const data: InventoryData = {
      zones,
      products: [product('p', 'Leche'), product('d', 'Lentejas', { kind: 'cooked_dish' })],
      lots: [lot('a', 'p'), lot('b', 'd', { container_number: 3 })],
      units: [],
    }

    const views = buildProductViews(data, { ...options, leftoversOnly: true })
    expect(views.map((view) => view.name)).toEqual(['Lentejas'])
    expect(views[0]!.containerNumber).toBe(3)
  })

  it('la fecha de la fila tiene en cuenta los lotes y las unidades abiertas', () => {
    const data: InventoryData = {
      zones,
      products: [product('p', 'Leche')],
      lots: [lot('a', 'p', { quantity: 5, effective_date: '2027-01-01', effective_basis: 'expiry' })],
      units: [unit('u', 'a', { effective_date: '2026-11-10', effective_basis: 'reminder' })],
    }

    const [view] = buildProductViews(data, options)
    expect(view!.rowDate).toMatchObject({ date: '2026-11-10', status: 'soon' })
    expect(view!.earliestDate).toBe('2026-11-10')
  })

  it('un lote vacío con solo unidades abiertas no aporta su fecha', () => {
    const data: InventoryData = {
      zones,
      products: [product('p', 'Leche')],
      lots: [lot('a', 'p', { quantity: 0, effective_date: '2026-01-01', effective_basis: 'expiry' })],
      units: [unit('u', 'a', { effective_date: '2026-11-20', effective_basis: 'reminder' })],
    }

    expect(buildProductViews(data, options)[0]!.rowDate?.date).toBe('2026-11-20')
  })

  it('lo congelado sin fecha muestra desde cuándo lo está', () => {
    const data: InventoryData = {
      zones,
      products: [product('p', 'Pollo')],
      lots: [
        lot('a', 'p', { zone_id: 'z-freezer', frozen_at: '2026-10-05' }),
        lot('b', 'p', { zone_id: 'z-freezer', frozen_at: '2026-10-01' }),
      ],
      units: [],
    }

    const [view] = buildProductViews(data, options)
    expect(view!.rowDate).toBeNull()
    expect(view!.frozenSince).toBe('2026-10-01')
  })
})

describe('productName', () => {
  const catalog = new Map([['c', { name_es: 'Leche', name_en: 'Milk' } as CatalogItem]])

  it('traduce lo que viene del catálogo', () => {
    const milk = { name: 'Leche', name_customized: false, catalog_item_id: 'c' }
    expect(productName(milk, catalog, 'en')).toBe('Milk')
    expect(productName(milk, catalog, 'es')).toBe('Leche')
  })

  it('respeta lo renombrado y lo escrito a mano', () => {
    expect(productName({ name: 'Leche de casa', name_customized: true, catalog_item_id: 'c' }, catalog, 'en')).toBe('Leche de casa')
    expect(productName({ name: 'Mi salsa', name_customized: false, catalog_item_id: null }, catalog, 'en')).toBe('Mi salsa')
  })
})

describe('sortViews', () => {
  const data: InventoryData = {
    zones,
    products: [
      product('a', 'Zanahoria', { category: 'vegetables' }),
      product('b', 'Atún', { category: 'canned' }),
      product('c', 'Leche', { category: 'dairy_eggs' }),
      product('d', 'Ñoquis', { category: 'canned' }),
    ],
    lots: [
      lot('1', 'a', { effective_date: '2026-11-20' }),
      lot('2', 'b'),
      lot('3', 'c', { effective_date: '2026-11-10' }),
      lot('4', 'd'),
    ],
    units: [],
  }
  const views = buildProductViews(data, options)
  const names = (mode: 'date' | 'name' | 'category') => sortViews(views, mode, 'es-ES').map((view) => view.name)

  it('por fecha: lo más próximo primero y lo que no tiene fecha al final', () => {
    expect(names('date')).toEqual(['Leche', 'Zanahoria', 'Atún', 'Ñoquis'])
  })

  it('por nombre: con el orden del idioma', () => {
    expect(names('name')).toEqual(['Atún', 'Leche', 'Ñoquis', 'Zanahoria'])
  })

  it('por categoría: en el orden del SPEC', () => {
    expect(names('category')).toEqual(['Leche', 'Zanahoria', 'Atún', 'Ñoquis'])
  })
})
