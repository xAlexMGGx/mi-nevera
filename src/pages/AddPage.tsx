import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ChevronIcon, SearchIcon } from '../components/icons'
import { PrintedDateFields } from '../components/PrintedDateFields'
import { Screen } from '../components/Screen'
import { Button, FullScreenLoader, LoadError, Message, SelectField, Stepper, TextField, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useActiveHouseId } from '../data/house'
import { useInventory, useInventoryAction } from '../data/inventory'
import { productIcon, productName, type CatalogById, type CatalogItem, type InventoryData, type Product } from '../domain/inventory'
import { parseAmount, unitName } from '../domain/quantity'
import { createSearch } from '../domain/search'
import {
  bulkUnits,
  categories,
  categoryIcons,
  contentUnits,
  quantityKinds,
  unitLabels,
  zoneKinds,
  type BulkUnit,
  type Category,
  type ContentUnit,
  type PrintedDateType,
  type QuantityKind,
  type ZoneKind,
} from '../domain/types'
import { supabase } from '../lib/supabase'

type Selection =
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
}

function ProductPicker({ data, catalog, items, onPick }: { data: InventoryData; catalog: CatalogById; items: CatalogItem[]; onPick: (selection: Selection) => void }) {
  const { t } = useTranslation()
  const { language, tag } = useDateContext()
  const [query, setQuery] = useState('')

  const entries = useMemo<PickerEntry[]>(() => {
    const inHouse = new Set(data.products.map((product) => product.catalog_item_id))
    const byName = (a: PickerEntry, b: PickerEntry) => a.name.localeCompare(b.name, tag, { sensitivity: 'base' })
    const fromHouse = data.products
      .filter((product) => product.kind === 'food')
      .map<PickerEntry>((product) => {
        const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
        return {
          key: product.id,
          name: productName(product, catalog, language),
          icon: productIcon(product, catalog),
          searchTerms: item ? [item.name_es, item.name_en, ...item.synonyms_es, ...item.synonyms_en] : [product.name],
          subtitle: t('add.inHouse'),
          selection: { type: 'product', product },
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
  }, [data.products, catalog, items, language, tag, t])

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
    <Screen
      title={t('add.title')}
      backTo="/"
      main={
        <div className="flex flex-col gap-2">
          {results.length === 0 && createButton}
          <ul className="flex flex-col gap-2">
            {results.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => onPick(entry.selection)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2 text-left ${focusRing}`}
                >
                  <span aria-hidden="true" className="w-9 shrink-0 text-center text-2xl leading-none">
                    {entry.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{entry.name}</span>
                    <span className="block truncate text-sm text-ink-muted">{entry.subtitle}</span>
                  </span>
                  <span className="shrink-0 text-ink-muted">
                    <ChevronIcon />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {results.length > 0 && createButton}
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-muted">
            <SearchIcon />
          </span>
          <input
            type="search"
            aria-label={t('add.searchLabel')}
            placeholder={t('add.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`min-h-12 w-full appearance-none rounded-xl border border-line bg-surface pr-3 pl-11 text-base text-ink ${focusRing}`}
          />
        </div>
        <Link to="/add/leftover" className={`flex min-h-10 items-center justify-between rounded-xl px-1 text-sm font-semibold text-brand ${focusRing}`}>
          {t('add.leftover')}
          <ChevronIcon />
        </Link>
      </div>
    </Screen>
  )
}

function defaultZone(selection: Selection, data: InventoryData, catalog: CatalogById): ZoneKind {
  if (selection.type === 'catalog') return selection.item.default_zone
  if (selection.type === 'product') {
    const { catalog_item_id: itemId, id } = selection.product
    const lot = data.lots.find((row) => row.product_id === id)
    const zone = lot && data.zones.find((row) => row.id === lot.zone_id)
    return zone?.kind ?? (itemId ? catalog.get(itemId)?.default_zone : undefined) ?? 'fridge'
  }
  return 'fridge'
}

function LotForm({ selection, data, catalog, onBack }: { selection: Selection; data: InventoryData; catalog: CatalogById; onBack: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { language, today } = useDateContext()
  const houseId = useActiveHouseId()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })

  const existing = selection.type === 'product' ? selection.product : null
  const item = selection.type === 'catalog' ? selection.item : null

  const [quantityKind, setQuantityKind] = useState<QuantityKind>(existing?.quantity_kind ?? item?.default_quantity_kind ?? 'count')
  const [unitLabel, setUnitLabel] = useState<string>(existing?.unit_label ?? item?.default_unit_label ?? 'unit')
  const [contentAmount, setContentAmount] = useState(String(item?.default_content_amount ?? ''))
  const [contentUnit, setContentUnit] = useState<ContentUnit>(
    item?.default_quantity_kind === 'divisible' && item.default_content_unit ? item.default_content_unit : 'ml',
  )
  const [bulkUnit, setBulkUnit] = useState<BulkUnit>(
    (existing?.bulk_unit ?? (item?.default_quantity_kind === 'bulk' ? item.default_content_unit : null) ?? 'kg') as BulkUnit,
  )
  const [category, setCategory] = useState<Category>('other')
  const [count, setCount] = useState(1)
  const [amountText, setAmountText] = useState('')
  const [zone, setZone] = useState<ZoneKind>(() => defaultZone(selection, data, catalog))
  const [printedDate, setPrintedDate] = useState('')
  const [dateType, setDateType] = useState<PrintedDateType | null>(null)
  const [frozenAt, setFrozenAt] = useState(today)
  const [reminderDate, setReminderDate] = useState('')
  const [brand, setBrand] = useState('')
  const [purchasedAt, setPurchasedAt] = useState(today)
  const [formError, setFormError] = useState<'quantity' | 'content' | 'dateType' | null>(null)

  const name =
    selection.type === 'new'
      ? selection.name
      : selection.type === 'catalog'
        ? language === 'en' ? selection.item.name_en : selection.item.name_es
        : productName(selection.product, catalog, language)
  const icon = existing ? productIcon(existing, catalog) : item ? item.icon : categoryIcons[category]

  const countingFields = (
    <>
      <SelectField label={t('form.quantityKind')} value={quantityKind} onChange={(event) => setQuantityKind(event.target.value as QuantityKind)}>
        {quantityKinds.map((value) => (
          <option key={value} value={value}>
            {t(`quantityKinds.${value}`)}
          </option>
        ))}
      </SelectField>
      {quantityKind !== 'bulk' && (
        <SelectField label={t('form.unit')} value={unitLabel} onChange={(event) => setUnitLabel(event.target.value)}>
          {unitLabels
            .filter((value) => value !== 'serving')
            .map((value) => (
              <option key={value} value={value}>
                {t(`units.${value}`, { count: 1 })}
              </option>
            ))}
        </SelectField>
      )}
      {quantityKind === 'divisible' && (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('form.contentAmount')}
            inputMode="decimal"
            value={contentAmount}
            onChange={(event) => setContentAmount(event.target.value)}
          />
          <SelectField label={t('form.contentUnit')} value={contentUnit} onChange={(event) => setContentUnit(event.target.value as ContentUnit)}>
            {contentUnits.map((value) => (
              <option key={value} value={value}>
                {t(`contentUnits.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
      )}
    </>
  )

  function countedAs() {
    if (quantityKind === 'bulk') return t(`contentUnits.${bulkUnit}`)
    const unit = unitName(unitLabel, 1, t)
    return quantityKind === 'divisible'
      ? t('form.containerOf', { unit, amount: contentAmount, measure: t(`contentUnits.${contentUnit}`) })
      : unit
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const quantity = quantityKind === 'bulk' ? parseAmount(amountText) : count
    if (!quantity || quantity <= 0) return setFormError('quantity')

    const content = parseAmount(contentAmount)
    if (!existing && quantityKind === 'divisible' && (!content || content <= 0)) return setFormError('content')
    if (printedDate && !dateType) return setFormError('dateType')
    setFormError(null)

    const zoneId = data.zones.find((row) => row.kind === zone)!.id
    const done = await run('added', () =>
      supabase.rpc('add_lot', {
        p_house_id: houseId,
        p_zone_id: zoneId,
        p_quantity: quantity,
        p_product_id: existing?.id,
        p_catalog_item_id: item?.id,
        p_name: selection.type === 'new' ? selection.name : undefined,
        p_category: selection.type === 'new' ? category : undefined,
        p_quantity_kind: existing ? undefined : quantityKind,
        p_unit_label: existing ? undefined : quantityKind === 'bulk' ? 'unit' : unitLabel,
        p_content_amount: !existing && quantityKind === 'divisible' ? content! : undefined,
        p_content_unit: !existing && quantityKind === 'divisible' ? contentUnit : undefined,
        p_bulk_unit: !existing && quantityKind === 'bulk' ? bulkUnit : undefined,
        p_brand: brand.trim() || undefined,
        p_printed_date: printedDate || undefined,
        p_printed_date_type: printedDate && dateType ? dateType : undefined,
        p_purchased_at: purchasedAt || undefined,
        p_frozen_at: zone === 'freezer' ? frozenAt || undefined : undefined,
        p_reminder_date: zone === 'freezer' ? reminderDate || undefined : undefined,
      }),
    )
    if (done) void navigate('/', { replace: true })
  }

  return (
    <div className="safe-x flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
          <span aria-hidden="true" className="text-2xl leading-none">
            {icon}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{name}</h1>
          <button type="button" onClick={onBack} className={`min-h-10 shrink-0 px-2 text-sm font-semibold text-brand ${focusRing}`}>
            {t('common.change')}
          </button>
        </div>
      </header>
      <main className="safe-bottom mx-auto w-full max-w-xl flex-1 p-4">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
          {selection.type === 'new' && (
            <SelectField label={t('form.category')} value={category} onChange={(event) => setCategory(event.target.value as Category)}>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {t(`categories.${value}`)}
                </option>
              ))}
            </SelectField>
          )}

          {selection.type === 'new' && countingFields}

          {quantityKind === 'bulk' ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t('form.quantity')}
                inputMode="decimal"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
              />
              {existing ? (
                <TextField label={t('form.contentUnit')} value={t(`contentUnits.${bulkUnit}`)} disabled />
              ) : (
                <SelectField label={t('form.contentUnit')} value={bulkUnit} onChange={(event) => setBulkUnit(event.target.value as BulkUnit)}>
                  {bulkUnits.map((value) => (
                    <option key={value} value={value}>
                      {t(`contentUnits.${value}`)}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
          ) : (
            <Stepper label={t('form.quantity')} value={count} min={1} onChange={setCount} />
          )}

          <SelectField label={t('form.zone')} value={zone} onChange={(event) => setZone(event.target.value as ZoneKind)}>
            {zoneKinds.map((value) => (
              <option key={value} value={value}>
                {t(`zones.${value}`)}
              </option>
            ))}
          </SelectField>

          {zone === 'freezer' && (
            <>
              <p className="text-sm text-ink-muted">{t('form.frozenHint')}</p>
              <TextField label={t('form.frozenAt')} type="date" value={frozenAt} onChange={(event) => setFrozenAt(event.target.value)} />
              <TextField label={t('form.reminder')} hint={t('form.reminderHint')} type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} />
            </>
          )}

          <PrintedDateFields date={printedDate} type={dateType} onDateChange={setPrintedDate} onTypeChange={setDateType} />

          <details className="rounded-xl border border-line bg-surface p-3">
            <summary className="min-h-8 cursor-pointer font-medium">{t('form.moreDetails')}</summary>
            <div className="mt-3 flex flex-col gap-4">
              <TextField label={t('form.brand')} value={brand} autoComplete="off" onChange={(event) => setBrand(event.target.value)} />
              <TextField label={t('form.purchasedAt')} type="date" value={purchasedAt} onChange={(event) => setPurchasedAt(event.target.value)} />
              {/* Los valores del catálogo suelen servir: se pueden cambiar, pero no estorban. */}
              {selection.type === 'catalog' && (
                <>
                  <p className="text-sm text-ink-muted">{t('form.countedAs', { what: countedAs() })}</p>
                  {countingFields}
                </>
              )}
            </div>
          </details>

          {formError && <Message tone="error">{t(`form.errors.${formError}`)}</Message>}
          {errorKey && <Message tone="error">{t(errorKey)}</Message>}

          <Button type="submit" disabled={pending}>
            {t('form.submit')}
          </Button>
        </form>
      </main>
    </div>
  )
}

export function AddPage() {
  const inventory = useInventory()
  const catalog = useCatalog()
  const [params] = useSearchParams()
  const [selection, setSelection] = useState<Selection | null>(null)

  if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
  if (inventory.isError) return <LoadError onRetry={() => void inventory.refetch()} />
  if (catalog.isError) return <LoadError onRetry={() => void catalog.refetch()} />

  // Desde el detalle de un producto agotado se llega con el producto ya elegido.
  const preselected = inventory.data.products.find((product) => product.id === params.get('product'))
  const current: Selection | null = selection ?? (preselected ? { type: 'product', product: preselected } : null)

  if (current) {
    return <LotForm selection={current} data={inventory.data} catalog={catalog.byId} onBack={() => setSelection(null)} />
  }
  return <ProductPicker data={inventory.data} catalog={catalog.byId} items={catalog.items} onPick={setSelection} />
}
