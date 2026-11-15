// Datos de prueba compartidos por los tests de lotDraft y ticket.
import type { CatalogItem, Product } from './inventory'
import type { HouseData } from './lotDraft'

export function catalogItem(overrides: Partial<CatalogItem>): CatalogItem {
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

export function product(overrides: Partial<Product>): Product {
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

export const catalog = new Map([
  ['cat-yogurt', catalogItem({ id: 'cat-yogurt', name_es: 'Yogur natural', default_zone: 'fridge', default_unit_label: 'yogurt' })],
  ['cat-peas', catalogItem({ id: 'cat-peas', name_es: 'Guisantes congelados', default_zone: 'freezer', default_unit_label: 'bag' })],
  [
    'cat-beans',
    catalogItem({ id: 'cat-beans', name_es: 'Judías verdes', category: 'vegetables', default_zone: 'fridge', default_quantity_kind: 'bulk', default_content_unit: 'kg' }),
  ],
])

export const milk = product({ id: 'milk', name: 'Leche', category: 'dairy_eggs', quantity_kind: 'divisible', unit_label: 'brick', content_amount: 1, content_unit: 'l' })
export const yogurt = product({ id: 'yogurt', name: 'Yogur natural', catalog_item_id: 'cat-yogurt', unit_label: 'yogurt' })

export const house: HouseData = {
  products: [milk, yogurt],
  lots: [{ product_id: 'milk', zone_id: 'z-pantry', barcode: '8410000000001' }],
  zones: [
    { id: 'z-fridge', kind: 'fridge' },
    { id: 'z-pantry', kind: 'pantry' },
  ],
}
