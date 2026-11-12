import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDateContext } from '../data/context'
import { productIcon, productName, type CatalogById, type CatalogItem, type InventoryData, type Product } from '../domain/inventory'
import { createSearch } from '../domain/search'
import { ChevronIcon, SearchIcon, TrashIcon } from './icons'
import { focusRing } from './ui'

export type Selection =
  | { type: 'product'; product: Product }
  | { type: 'catalog'; item: CatalogItem }
  | { type: 'new'; name: string }

interface PickerEntry {
  key: string
  name: string
  icon: string
  searchTerms: string[]
  subtitle: string
  selection: Selection
  /** Producto de la casa sin existencias: se puede eliminar desde aquí. */
  emptyProduct?: Product
}

function useEntries(data: Pick<InventoryData, 'products' | 'lots'>, catalog: CatalogById, items: CatalogItem[]) {
  const { t } = useTranslation()
  const { language, tag } = useDateContext()
  return useMemo<PickerEntry[]>(() => {
    const inHouse = new Set(data.products.map((product) => product.catalog_item_id))
    const withStock = new Set(data.lots.map((lot) => lot.product_id))
    const byName = (a: PickerEntry, b: PickerEntry) => a.name.localeCompare(b.name, tag, { sensitivity: 'base' })
    const fromHouse = data.products
      .filter((product) => product.kind === 'food')
      .map<PickerEntry>((product) => {
        const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
        const stocked = withStock.has(product.id)
        return {
          key: product.id,
          name: productName(product, catalog, language),
          icon: productIcon(product, catalog),
          searchTerms: item ? [item.name_es, item.name_en, ...item.synonyms_es, ...item.synonyms_en] : [product.name],
          subtitle: stocked ? t('add.inHouse') : t('add.noStock'),
          selection: { type: 'product', product },
          emptyProduct: stocked ? undefined : product,
        }
      })
      .sort(byName)
    const fromCatalog = items
      .filter((item) => !inHouse.has(item.id))
      .map<PickerEntry>((item) => ({
        key: item.id,
        name: language === 'en' ? item.name_en : item.name_es,
        icon: item.icon,
        searchTerms: [item.name_es, item.name_en, ...item.synonyms_es, ...item.synonyms_en],
        subtitle: t(`categories.${item.category}`),
        selection: { type: 'catalog', item },
      }))
      .sort(byName)
    return [...fromHouse, ...fromCatalog]
  }, [data.products, data.lots, catalog, items, language, tag, t])
}

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

export function SearchField({ value, onChange, autoFocus }: SearchFieldProps) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-muted">
        <SearchIcon />
      </span>
      <input
        type="search"
        aria-label={t('add.searchLabel')}
        placeholder={t('add.searchPlaceholder')}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-12 w-full appearance-none rounded-xl border border-line bg-surface pr-3 pl-11 text-base text-ink ${focusRing}`}
      />
    </div>
  )
}

interface ProductResultsProps {
  data: Pick<InventoryData, 'products' | 'lots'>
  catalog: CatalogById
  items: CatalogItem[]
  query: string
  onPick: (selection: Selection) => void
  /** Con ella, los productos sin existencias tienen botón de eliminar. */
  onDelete?: (product: Product, name: string) => void
  deleteDisabled?: boolean
}

/** Productos de la casa y del catálogo base (SPEC §6.3), con búsqueda difusa y "Crear". */
export function ProductResults({ data, catalog, items, query, onPick, onDelete, deleteDisabled }: ProductResultsProps) {
  const { t } = useTranslation()
  const entries = useEntries(data, catalog, items)
  const search = useMemo(() => createSearch(entries), [entries])
  const results = search(query)
  const typed = query.trim()
  const exactMatch = results.some((entry) => entry.name.toLowerCase() === typed.toLowerCase())

  const createButton = typed && !exactMatch && (
    <button
      type="button"
      onClick={() => onPick({ type: 'new', name: typed })}
      className={`min-h-14 w-full rounded-2xl border border-dashed border-brand px-4 text-left font-semibold text-brand ${focusRing}`}
    >
      {t('add.create', { name: typed })}
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      {results.length === 0 && createButton}
      <ul className="flex flex-col gap-2">
        {results.map((entry) => {
          const removable = onDelete && entry.emptyProduct
          return (
            <li key={entry.key} className="flex items-center rounded-2xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => onPick(entry.selection)}
                className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left ${focusRing}`}
              >
                <span aria-hidden="true" className="w-9 shrink-0 text-center text-2xl leading-none">
                  {entry.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{entry.name}</span>
                  <span className="block truncate text-sm text-ink-muted">{entry.subtitle}</span>
                </span>
                {!removable && (
                  <span className="shrink-0 text-ink-muted">
                    <ChevronIcon />
                  </span>
                )}
              </button>
              {removable && (
                <button
                  type="button"
                  aria-label={t('add.delete', { name: entry.name })}
                  disabled={deleteDisabled}
                  onClick={() => onDelete(entry.emptyProduct!, entry.name)}
                  className={`mr-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-line disabled:opacity-40 ${focusRing}`}
                >
                  <TrashIcon />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {results.length > 0 && createButton}
    </div>
  )
}
