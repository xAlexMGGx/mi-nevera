import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { DateEntry } from '../components/DateEntry'
import { ChevronIcon, CloseIcon } from '../components/icons'
import { ProductPhoto } from '../components/ProductPhoto'
import { ProductResults, SearchField, type Selection } from '../components/ProductSearch'
import { Screen } from '../components/Screen'
import { ShelfLifeChip } from '../components/ShelfLifeChip'
import { Button, FullScreenLoader, LoadError, Message, SelectField, Stepper, TextField, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useDateSamples } from '../data/dateSamples'
import { useActiveHouseId } from '../data/house'
import { useInventory, useInventoryAction } from '../data/inventory'
import { productIcon, productName, type CatalogById, type CatalogItem, type InventoryData, type Product } from '../domain/inventory'
import { learnedDate } from '../domain/learnedDates'
import { formatForInput, parseAmount, unitName } from '../domain/quantity'
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
import { useOffline } from '../lib/connectivity'
import { supabase } from '../lib/supabase'
import type { ScannedProduct } from '../scan/openFoodFacts'
import { ScanBarcodeDialog } from '../scan/ScanBarcodeDialog'
import { DeleteProductSheet } from './product/sheets'

/** Llega así desde "＋ → Escanear código". */
export interface AddPageState {
  scanned?: ScannedProduct
}

/** Si la casa ya tiene un lote con ese código, es ese producto. */
function productWithBarcode(data: InventoryData, barcode: string): Product | undefined {
  const lot = data.lots.find((row) => row.barcode === barcode)
  return lot ? data.products.find((product) => product.id === lot.product_id) : undefined
}

function ScannedBanner({ scanned, onClear }: { scanned: ScannedProduct; onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
      <ProductPhoto src={scanned.imageUrl} className="size-12 rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate font-semibold">{scanned.name ?? t('barcode.notFoundShort')}</p>
        <p className="truncate text-ink-muted">{[scanned.brand, scanned.quantityText, scanned.barcode].filter(Boolean).join(' · ')}</p>
      </div>
      <button type="button" aria-label={t('barcode.remove')} onClick={onClear} className={`flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-line ${focusRing}`}>
        <CloseIcon />
      </button>
    </div>
  )
}

interface PickerProps {
  data: InventoryData
  catalog: CatalogById
  items: CatalogItem[]
  scanned: ScannedProduct | null
  onScanned: (scanned: ScannedProduct | null) => void
  onPick: (selection: Selection) => void
}

function ProductPicker({ data, catalog, items, scanned, onScanned, onPick }: PickerProps) {
  const { t } = useTranslation()
  const { pending } = useInventoryAction()
  const offline = useOffline()
  const [query, setQuery] = useState(scanned?.name ?? '')
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState<{ product: Product; name: string } | null>(null)

  function handleScan(result: ScannedProduct) {
    setScanning(false)
    onScanned(result)
    const known = productWithBarcode(data, result.barcode)
    if (known) onPick({ type: 'product', product: known })
    else if (result.name) setQuery(result.name)
  }

  return (
    <Screen
      title={t('add.title')}
      backTo="/"
      main={
        <div className="flex flex-col gap-2">
          {scanned && <ScannedBanner scanned={scanned} onClear={() => onScanned(null)} />}
          {scanned && <p className="px-1 text-sm text-ink-muted">{t('barcode.pickProduct')}</p>}
          <ProductResults
            data={data}
            catalog={catalog}
            items={items}
            query={query}
            onPick={onPick}
            onDelete={(product, name) => setDeleting({ product, name })}
            deleteDisabled={pending}
          />
          {deleting && (
            <DeleteProductSheet product={deleting.product} name={deleting.name} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
          )}
          {scanning && <ScanBarcodeDialog onResult={handleScan} onClose={() => setScanning(false)} />}
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <SearchField value={query} onChange={setQuery} />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={offline}
            onClick={() => setScanning(true)}
            className={`min-h-10 rounded-xl px-1 text-sm font-semibold text-brand disabled:opacity-40 ${focusRing}`}
          >
            {t('barcode.scan')}
          </button>
          <Link to="/add/leftover" className={`flex min-h-10 items-center gap-1 rounded-xl px-1 text-sm font-semibold text-brand ${focusRing}`}>
            {t('add.leftover')}
            <ChevronIcon />
          </Link>
        </div>
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

interface LotFormProps {
  selection: Selection
  data: InventoryData
  catalog: CatalogById
  scanned: ScannedProduct | null
  onScanned: (scanned: ScannedProduct | null) => void
  onBack: () => void
}

function LotForm({ selection, data, catalog, scanned, onScanned, onBack }: LotFormProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { language, today, tag } = useDateContext()
  const houseId = useActiveHouseId()
  const samples = useDateSamples(houseId)
  const offline = useOffline()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })

  const existing = selection.type === 'product' ? selection.product : null
  const item = selection.type === 'catalog' ? selection.item : null
  // El contenido del envase que da Open Food Facts sirve para un producto nuevo.
  const scannedContent = selection.type === 'new' && scanned?.contentAmount && scanned.contentUnit ? scanned : null

  const [quantityKind, setQuantityKind] = useState<QuantityKind>(
    existing?.quantity_kind ?? item?.default_quantity_kind ?? (scannedContent ? 'divisible' : 'count'),
  )
  const [unitLabel, setUnitLabel] = useState<string>(existing?.unit_label ?? item?.default_unit_label ?? 'unit')
  const [contentAmount, setContentAmount] = useState(
    item?.default_content_amount != null ? String(item.default_content_amount) : scannedContent ? formatForInput(scannedContent.contentAmount!, tag) : '',
  )
  const [contentUnit, setContentUnit] = useState<ContentUnit>(
    item?.default_quantity_kind === 'divisible' && item.default_content_unit ? item.default_content_unit : (scannedContent?.contentUnit ?? 'ml'),
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
  const [brand, setBrand] = useState(scanned?.brand ?? '')
  const [purchasedAt, setPurchasedAt] = useState(today)
  const [scanning, setScanning] = useState(false)
  const [formError, setFormError] = useState<'quantity' | 'content' | 'dateType' | null>(null)

  const name =
    selection.type === 'new'
      ? selection.name
      : selection.type === 'catalog'
        ? language === 'en' ? selection.item.name_en : selection.item.name_es
        : productName(selection.product, catalog, language)
  const icon = existing ? productIcon(existing, catalog) : item ? item.icon : categoryIcons[category]
  const learned = existing ? learnedDate(samples.data ?? [], existing.id, purchasedAt || today) : null

  function handleScan(result: ScannedProduct) {
    setScanning(false)
    onScanned(result)
    if (!brand.trim() && result.brand) setBrand(result.brand)
  }

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
        p_source: scanned ? 'barcode' : 'manual',
        p_barcode: scanned?.barcode,
        p_image_url: scanned?.imageUrl ?? undefined,
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
          {scanned ? (
            <ScannedBanner scanned={scanned} onClear={() => onScanned(null)} />
          ) : (
            <Button variant="secondary" disabled={offline} onClick={() => setScanning(true)}>
              {t('barcode.scanToFill')}
            </Button>
          )}

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
              <ShelfLifeChip
                product={{ catalog_item_id: existing?.catalog_item_id ?? item?.id ?? null, category: existing?.category ?? item?.category ?? category }}
                state="frozen"
                baseDate={frozenAt || today}
                value={reminderDate}
                onChange={setReminderDate}
              />
              <TextField label={t('form.reminder')} hint={t('form.reminderHint')} type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} />
            </>
          )}

          <DateEntry
            name={name}
            date={printedDate}
            type={dateType}
            learned={learned}
            onChange={(date, type) => {
              setPrintedDate(date)
              setDateType(type)
            }}
          />

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
        {scanning && <ScanBarcodeDialog onResult={handleScan} onClose={() => setScanning(false)} />}
      </main>
    </div>
  )
}

export function AddPage() {
  const inventory = useInventory()
  const catalog = useCatalog()
  const [params] = useSearchParams()
  const location = useLocation()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [scanned, setScanned] = useState<ScannedProduct | null>(() => (location.state as AddPageState | null)?.scanned ?? null)
  // Tras "Cambiar", el producto que venía elegido deja de elegirse solo.
  const [dismissed, setDismissed] = useState(false)

  if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
  if (inventory.isLoadingError) return <LoadError onRetry={() => void inventory.refetch()} />
  if (catalog.isLoadingError) return <LoadError onRetry={() => void catalog.refetch()} />

  // Desde el detalle de un producto agotado se llega con el producto ya elegido, y desde
  // "Escanear código", con el producto que ya tiene ese código en casa.
  const preselected = dismissed
    ? undefined
    : (inventory.data.products.find((product) => product.id === params.get('product')) ??
      (scanned ? productWithBarcode(inventory.data, scanned.barcode) : undefined))
  const current: Selection | null = selection ?? (preselected ? { type: 'product', product: preselected } : null)

  if (current) {
    return (
      <LotForm
        selection={current}
        data={inventory.data}
        catalog={catalog.byId}
        scanned={scanned}
        onScanned={setScanned}
        onBack={() => {
          setSelection(null)
          setDismissed(true)
        }}
      />
    )
  }
  return <ProductPicker data={inventory.data} catalog={catalog.byId} items={catalog.items} scanned={scanned} onScanned={setScanned} onPick={setSelection} />
}
