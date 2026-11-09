import type { Tables } from '../lib/database.types'
import { mostUrgent, type RowDate } from './status'
import { categories, categoryIcons, type DateBasis, type ZoneKind } from './types'

export type Zone = Tables<'zones'>
export type Product = Tables<'products'>
export type CatalogItem = Tables<'catalog_items'>
export type Lot = Tables<'lots'> & { effective_date: string | null; effective_basis: DateBasis | null }
export type OpenedUnit = Tables<'opened_units'> & { effective_date: string | null; effective_basis: DateBasis | null }

export interface InventoryData {
  zones: Zone[]
  products: Product[]
  lots: Lot[]
  units: OpenedUnit[]
}

export type CatalogById = ReadonlyMap<string, CatalogItem>

/** Un producto del catálogo se muestra en el idioma de quien lo mira, salvo que se haya renombrado. */
export function productName(
  product: Pick<Product, 'name' | 'name_customized' | 'catalog_item_id'>,
  catalog: CatalogById,
  language: string,
): string {
  const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
  if (!item || product.name_customized) return product.name
  return language === 'en' ? item.name_en : item.name_es
}

export function productIcon(product: Pick<Product, 'icon' | 'catalog_item_id' | 'category'>, catalog: CatalogById): string {
  const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
  return product.icon ?? item?.icon ?? categoryIcons[product.category]
}

export interface ProductView {
  product: Product
  name: string
  icon: string
  /** Texto adicional por el que se puede encontrar el producto. */
  searchTerms: string[]
  lots: Lot[]
  units: OpenedUnit[]
  containerNumber: number | null
  /** La fecha que se muestra en la fila. */
  rowDate: RowDate | null
  /** Para ordenar por "fecha más próxima". */
  earliestDate: string | null
  /** Lo más antiguo congelado sin fecha efectiva: "Congelado desde dd/mm". */
  frozenSince: string | null
}

export interface ViewOptions {
  catalog: CatalogById
  language: string
  today: string
  daysAhead: number
  zone: ZoneKind | 'all'
  leftoversOnly: boolean
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

export function buildProductViews(data: InventoryData, options: ViewOptions): ProductView[] {
  const { catalog, language, today, daysAhead, zone, leftoversOnly } = options
  const zoneKindById = new Map(data.zones.map((row) => [row.id, row.kind]))
  const lotsByProduct = groupBy(data.lots, (lot) => lot.product_id)
  const unitsByLot = groupBy(data.units, (unit) => unit.lot_id)

  const views: ProductView[] = []
  for (const product of data.products) {
    if (leftoversOnly && product.kind !== 'cooked_dish') continue

    const lots = (lotsByProduct.get(product.id) ?? []).filter(
      (lot) => zone === 'all' || zoneKindById.get(lot.zone_id) === zone,
    )
    if (lots.length === 0) continue

    const units = lots.flatMap((lot) => unitsByLot.get(lot.id) ?? [])
    const dated = [
      ...lots
        .filter((lot) => lot.quantity > 0)
        .map((lot) => ({ date: lot.effective_date, basis: lot.effective_basis })),
      ...units.map((unit) => ({ date: unit.effective_date, basis: unit.effective_basis })),
    ]
    const dates = dated.flatMap((item) => (item.date ? [item.date] : []))
    const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined

    views.push({
      product,
      name: productName(product, catalog, language),
      icon: productIcon(product, catalog),
      searchTerms: item ? [item.name_es, item.name_en, ...item.synonyms_es, ...item.synonyms_en] : [product.name],
      lots,
      units,
      containerNumber: lots.find((lot) => lot.container_number !== null)?.container_number ?? null,
      rowDate: mostUrgent(dated, today, daysAhead),
      earliestDate: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      frozenSince: lots
        .filter((lot) => lot.frozen_at && !lot.thawed_at && !lot.effective_date)
        .map((lot) => lot.frozen_at!)
        .sort()[0] ?? null,
    })
  }
  return views
}

export const sortModes = ['date', 'name', 'category'] as const
export type SortMode = (typeof sortModes)[number]

export function sortViews(views: ProductView[], mode: SortMode, localeTag: string): ProductView[] {
  const byName = (a: ProductView, b: ProductView) => a.name.localeCompare(b.name, localeTag, { sensitivity: 'base' })
  const compare: Record<SortMode, (a: ProductView, b: ProductView) => number> = {
    date: (a, b) => {
      if (a.earliestDate && b.earliestDate && a.earliestDate !== b.earliestDate) {
        return a.earliestDate < b.earliestDate ? -1 : 1
      }
      if (a.earliestDate && !b.earliestDate) return -1
      if (!a.earliestDate && b.earliestDate) return 1
      return byName(a, b)
    },
    name: byName,
    category: (a, b) =>
      categories.indexOf(a.product.category) - categories.indexOf(b.product.category) || byName(a, b),
  }
  return [...views].sort(compare[mode])
}
