import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ChevronIcon, CloseIcon } from '../components/icons'
import { LotFields } from '../components/LotFields'
import { ProductPhoto } from '../components/ProductPhoto'
import { ProductResults, SearchField, type Selection } from '../components/ProductSearch'
import { Screen } from '../components/Screen'
import { Button, FullScreenLoader, LoadError, Message, TextField, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useDateSamples } from '../data/dateSamples'
import { useActiveHouseId } from '../data/house'
import { useInventory, useInventoryAction } from '../data/inventory'
import type { CatalogById, CatalogItem, InventoryData, Product } from '../domain/inventory'
import { learnedDate } from '../domain/learnedDates'
import { addLotArgs, attachScan, emptyLine, lineLabel, lineProblem, targetFromSelection, type DraftLine } from '../domain/lotDraft'
import { useOffline } from '../lib/connectivity'
import { supabase } from '../lib/supabase'
import { lineFromBarcode, scanFacts, type BarcodeResult } from '../scan/identify'
import { ScanBarcodeDialog } from '../scan/ScanBarcodeDialog'
import { DeleteProductSheet } from './product/sheets'

/** Llega así desde "＋ → Escanear código de barras". */
export interface AddPageState {
  scan?: BarcodeResult
  /** "Elegir otro producto": lo propuesto no era, se elige en el buscador. */
  pick?: boolean
}

/** El nombre por el que buscar un código que no se ha podido emparejar. */
function scanQuery(scan: BarcodeResult | null) {
  return scan?.proposal?.name ?? scan?.scanned.name ?? ''
}

function ScannedBanner({ scan, onClear }: { scan: BarcodeResult; onClear: () => void }) {
  const { t } = useTranslation()
  const { scanned } = scan
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
  scan: BarcodeResult | null
  onScan: (scan: BarcodeResult | null) => void
  onPick: (selection: Selection) => void
}

function ProductPicker({ data, catalog, items, scan, onScan, onPick }: PickerProps) {
  const { t } = useTranslation()
  const houseId = useActiveHouseId()
  const { pending } = useInventoryAction()
  const offline = useOffline()
  const [query, setQuery] = useState(scanQuery(scan))
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState<{ product: Product; name: string } | null>(null)

  return (
    <Screen
      title={t('add.title')}
      backTo="/"
      main={
        <div className="flex flex-col gap-2">
          {scan && <ScannedBanner scan={scan} onClear={() => onScan(null)} />}
          {scan && <p className="px-1 text-sm text-ink-muted">{t('barcode.pickProduct')}</p>}
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
          {scanning && (
            <ScanBarcodeDialog
              identify
              houseId={houseId}
              house={data}
              onClose={() => setScanning(false)}
              onResult={(result) => {
                setScanning(false)
                setQuery(scanQuery(result))
                onScan(result)
              }}
              onPickOther={(result) => {
                setScanning(false)
                setQuery(scanQuery(result))
                onScan({ ...result, productId: null, proposal: null })
              }}
            />
          )}
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

interface LotFormProps {
  line: DraftLine
  update: (change: (line: DraftLine) => DraftLine) => void
  data: InventoryData
  catalog: CatalogById
  onBack: () => void
}

/** El mismo formulario que una línea del ticket (LotFields), más la fecha de compra. */
function LotForm({ line, update, data, catalog, onBack }: LotFormProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { language, today } = useDateContext()
  const houseId = useActiveHouseId()
  const samples = useDateSamples(houseId)
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [purchasedAt, setPurchasedAt] = useState(today)
  const [showProblem, setShowProblem] = useState(false)

  const { name, icon } = lineLabel(line.target, data.products, catalog, language)
  const learned = line.target.type === 'product' ? learnedDate(samples.data ?? [], line.target.productId, purchasedAt || today) : null
  const problem = lineProblem(line, data.products)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (problem) return setShowProblem(true)
    setShowProblem(false)
    const zoneId = data.zones.find((row) => row.kind === line.zone)!.id
    const done = await run('added', () =>
      supabase.rpc('add_lot', addLotArgs(line, { houseId, zoneId, purchasedAt: purchasedAt || today, source: line.barcode ? 'barcode' : 'manual' })),
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
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{name || t('lot.newProduct')}</h1>
          <button type="button" onClick={onBack} className={`min-h-10 shrink-0 px-2 text-sm font-semibold text-brand ${focusRing}`}>
            {t('common.change')}
          </button>
        </div>
      </header>
      <main className="safe-bottom mx-auto w-full max-w-xl flex-1 p-4">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
          <LotFields line={line} houseId={houseId} house={data} learned={learned} purchasedAt={purchasedAt || today} update={update} onChangeProduct={onBack} hideProduct />
          <TextField label={t('form.purchasedAt')} type="date" max={today} value={purchasedAt} onChange={(event) => setPurchasedAt(event.target.value)} />
          {showProblem && problem && <Message tone="error">{t(`ticket.problems.${problem}`)}</Message>}
          {errorKey && <Message tone="error">{t(errorKey)}</Message>}
          <Button type="submit" disabled={pending}>
            {t('form.submit')}
          </Button>
        </form>
      </main>
    </div>
  )
}

function AddFlow({ data, catalog, items, initialLine, initialScan }: { data: InventoryData; catalog: CatalogById; items: CatalogItem[]; initialLine: DraftLine | null; initialScan: BarcodeResult | null }) {
  const [scan, setScan] = useState(initialScan)
  const [line, setLine] = useState(initialLine)

  if (line) {
    return (
      <LotForm
        line={line}
        update={(change) => setLine((current) => (current ? change(current) : current))}
        data={data}
        catalog={catalog}
        onBack={() => setLine(null)}
      />
    )
  }

  return (
    <ProductPicker
      data={data}
      catalog={catalog}
      items={items}
      scan={scan}
      onScan={(result) => {
        setScan(result)
        // Si se sabe qué producto es, directamente al formulario.
        const scanned = result && lineFromBarcode(result, data, catalog)
        if (scanned) setLine(scanned)
      }}
      onPick={(selection) => {
        const picked = emptyLine(targetFromSelection(selection, null, data.products), data, catalog)
        setLine(scan ? attachScan(picked, scanFacts(scan)) : picked)
      }}
    />
  )
}

export function AddPage() {
  const inventory = useInventory()
  const catalog = useCatalog()
  const [params] = useSearchParams()
  const location = useLocation()

  if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
  if (inventory.isLoadingError) return <LoadError onRetry={() => void inventory.refetch()} />
  if (catalog.isLoadingError) return <LoadError onRetry={() => void catalog.refetch()} />

  const state = (location.state as AddPageState | null) ?? {}
  const scan = state.scan ?? null
  // Desde el detalle de un producto agotado se llega con el producto ya elegido, y desde
  // "Escanear código", con el producto que dice el código, si se sabe.
  const preselected = inventory.data.products.find((product) => product.id === params.get('product'))
  const initialLine = preselected
    ? emptyLine({ type: 'product', productId: preselected.id }, inventory.data, catalog.byId)
    : scan && !state.pick
      ? lineFromBarcode(scan, inventory.data, catalog.byId)
      : null

  return <AddFlow data={inventory.data} catalog={catalog.byId} items={catalog.items} initialLine={initialLine} initialScan={scan} />
}
