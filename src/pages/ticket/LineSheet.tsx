import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateEntry } from '../../components/DateEntry'
import { CloseIcon } from '../../components/icons'
import { ProductPhoto } from '../../components/ProductPhoto'
import { ProductResults, SearchField, type Selection } from '../../components/ProductSearch'
import { Sheet } from '../../components/Sheet'
import { Button, Message, Segmented, SelectField, Stepper, TextField, focusRing } from '../../components/ui'
import { useCatalog } from '../../data/catalog'
import { useDateContext } from '../../data/context'
import type { InventoryData } from '../../domain/inventory'
import type { LearnedDate } from '../../domain/learnedDates'
import { formatForInput, parseAmount } from '../../domain/quantity'
import { lineCounting, lineProblem, type DraftLine, type LineTarget } from '../../domain/ticket'
import {
  bulkUnits,
  categories,
  contentUnits,
  quantityKinds,
  unitLabels,
  zoneKinds,
  type BulkUnit,
  type Category,
  type ContentUnit,
  type QuantityKind,
} from '../../domain/types'
import { useOffline } from '../../lib/connectivity'
import type { ScannedProduct } from '../../scan/openFoodFacts'
import { ScanBarcodeDialog } from '../../scan/ScanBarcodeDialog'
import { lineLabel, selectionToTarget } from './lineView'

interface LineSheetProps {
  line: DraftLine
  house: InventoryData
  learned: LearnedDate | null
  onChange: (patch: Partial<DraftLine>) => void
  onRetarget: (target: LineTarget) => void
  onSplit: () => void
  onRemove: () => void
  onClose: () => void
}

/** Para elegir el producto de una línea o de una línea nueva. */
export function ProductPickerSheet({ house, initialQuery = '', title, onPick, onClose }: { house: InventoryData; initialQuery?: string; title: string; onPick: (selection: Selection) => void; onClose: () => void }) {
  const catalog = useCatalog()
  const [query, setQuery] = useState(initialQuery)
  return (
    <Sheet title={title} onClose={onClose}>
      <SearchField value={query} onChange={setQuery} />
      <ProductResults data={house} catalog={catalog.byId} items={catalog.items} query={query} onPick={onPick} />
    </Sheet>
  )
}

/** Cantidad: entera con botones o, a granel, decimal. */
function QuantityField({ bulk, value, onChange }: { bulk: boolean; value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const [text, setText] = useState(formatForInput(value, tag))
  if (!bulk) return <Stepper label={t('form.quantity')} value={value} min={1} onChange={onChange} />
  return (
    <TextField
      label={t('form.quantity')}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onChange(parseAmount(event.target.value) ?? 0)
      }}
    />
  )
}

/** Un producto que se creará al aplicar: nombre y forma de contar. */
function NewProductFields({ target, onChange }: { target: Extract<LineTarget, { type: 'new' }>; onChange: (target: LineTarget) => void }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const [content, setContent] = useState(target.contentAmount ? formatForInput(target.contentAmount, tag) : '')
  const set = (patch: Partial<typeof target>) => onChange({ ...target, ...patch })

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-3">
      <p className="text-sm text-ink-muted">{t('ticket.newProductHint')}</p>
      <TextField label={t('sheets.rename.name')} maxLength={80} autoComplete="off" value={target.name} onChange={(event) => set({ name: event.target.value })} />
      <SelectField label={t('form.category')} value={target.category} onChange={(event) => set({ category: event.target.value as Category })}>
        {categories.map((value) => (
          <option key={value} value={value}>
            {t(`categories.${value}`)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t('form.quantityKind')}
        value={target.quantityKind}
        onChange={(event) => {
          const quantityKind = event.target.value as QuantityKind
          set({ quantityKind, bulkUnit: quantityKind === 'bulk' ? (target.bulkUnit ?? 'kg') : target.bulkUnit })
        }}
      >
        {quantityKinds.map((value) => (
          <option key={value} value={value}>
            {t(`quantityKinds.${value}`)}
          </option>
        ))}
      </SelectField>
      {target.quantityKind === 'bulk' ? (
        <SelectField label={t('form.contentUnit')} value={target.bulkUnit ?? 'kg'} onChange={(event) => set({ bulkUnit: event.target.value as BulkUnit })}>
          {bulkUnits.map((value) => (
            <option key={value} value={value}>
              {t(`contentUnits.${value}`)}
            </option>
          ))}
        </SelectField>
      ) : (
        <SelectField label={t('form.unit')} value={target.unitLabel} onChange={(event) => set({ unitLabel: event.target.value })}>
          {unitLabels
            .filter((value) => value !== 'serving')
            .map((value) => (
              <option key={value} value={value}>
                {t(`units.${value}`, { count: 1 })}
              </option>
            ))}
        </SelectField>
      )}
      {target.quantityKind === 'divisible' && (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('form.contentAmount')}
            inputMode="decimal"
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              set({ contentAmount: parseAmount(event.target.value), contentUnit: target.contentUnit ?? 'ml' })
            }}
          />
          <SelectField label={t('form.contentUnit')} value={target.contentUnit ?? 'ml'} onChange={(event) => set({ contentUnit: event.target.value as ContentUnit })}>
            {contentUnits.map((value) => (
              <option key={value} value={value}>
                {t(`contentUnits.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
      )}
    </div>
  )
}

/** Editar una línea del ticket. Los cambios se ven al momento en la vista previa. */
export function LineSheet({ line, house, learned, onChange, onRetarget, onSplit, onRemove, onClose }: LineSheetProps) {
  const { t } = useTranslation()
  const { language } = useDateContext()
  const catalog = useCatalog()
  const offline = useOffline()
  const [picking, setPicking] = useState(false)
  const [scanning, setScanning] = useState(false)

  const { name, icon } = lineLabel(line.target, house.products, catalog.byId, language)
  const counting = lineCounting(line.target, house.products, catalog.byId)
  const problem = lineProblem(line, counting)

  function handleScan(scanned: ScannedProduct) {
    setScanning(false)
    onChange({ barcode: scanned.barcode, imageUrl: scanned.imageUrl ?? line.imageUrl, brand: line.brand.trim() ? line.brand : (scanned.brand ?? '') })
    // Un código que la casa ya conoce dice qué producto es; si no, Open Food Facts da el nombre.
    const lot = house.lots.find((row) => row.barcode === scanned.barcode)
    if (lot) onRetarget({ type: 'product', productId: lot.product_id })
    else if (line.target.type === 'new' && scanned.name) {
      const withContent = line.target.quantityKind === 'divisible' && !line.target.contentAmount && scanned.contentAmount
      onRetarget({
        ...line.target,
        name: scanned.name,
        ...(withContent ? { contentAmount: scanned.contentAmount, contentUnit: scanned.contentUnit } : {}),
      })
    }
  }

  if (picking) {
    return (
      <ProductPickerSheet
        house={house}
        title={t('ticket.pickProduct')}
        initialQuery={line.target.type === 'new' ? line.target.name : ''}
        onPick={(selection) => {
          onRetarget(selectionToTarget(selection, line.target, house.products, catalog.byId))
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
    )
  }

  return (
    <Sheet title={name || t('ticket.line')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {line.rawText && <p className="text-sm text-ink-muted">{t('ticket.onReceipt', { text: line.rawText })}</p>}

        <div className="flex items-center gap-3 rounded-xl border border-line p-3">
          <span aria-hidden="true" className="text-2xl leading-none">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{name}</p>
            <p className="text-sm text-ink-muted">{line.target.type === 'new' ? t('ticket.newProduct') : t('ticket.existingProduct')}</p>
          </div>
          <button type="button" onClick={() => setPicking(true)} className={`min-h-10 shrink-0 px-2 text-sm font-semibold text-brand ${focusRing}`}>
            {t('common.change')}
          </button>
        </div>

        {line.target.type === 'new' && <NewProductFields target={line.target} onChange={onRetarget} />}

        <QuantityField key={counting.quantity_kind} bulk={counting.quantity_kind === 'bulk'} value={line.quantity} onChange={(quantity) => onChange({ quantity })} />

        <Segmented
          label={t('form.zone')}
          options={zoneKinds.map((zone) => ({ value: zone, label: t(`zones.${zone}`) }))}
          value={line.zone}
          onChange={(zone) => onChange({ zone })}
        />

        <TextField label={t('form.brand')} autoComplete="off" value={line.brand} onChange={(event) => onChange({ brand: event.target.value })} />

        <DateEntry
          name={name}
          date={line.printedDate}
          type={line.dateType}
          learned={learned}
          onChange={(printedDate, dateType) => onChange({ printedDate, dateType })}
        />

        {line.barcode ? (
          <div className="flex items-center gap-3 rounded-xl border border-line p-2.5">
            <ProductPhoto src={line.imageUrl} className="size-12 rounded-lg" />
            <p className="min-w-0 flex-1 truncate text-sm">{t('barcode.code', { code: line.barcode })}</p>
            <button
              type="button"
              aria-label={t('barcode.remove')}
              onClick={() => onChange({ barcode: null, imageUrl: null })}
              className={`flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-line ${focusRing}`}
            >
              <CloseIcon />
            </button>
          </div>
        ) : (
          <Button variant="secondary" disabled={offline} onClick={() => setScanning(true)}>
            {t('barcode.scanToFill')}
          </Button>
        )}

        {counting.quantity_kind !== 'bulk' && line.quantity >= 2 && (
          <Button variant="secondary" onClick={onSplit}>
            {t('ticket.split')}
          </Button>
        )}

        {problem && <Message tone="error">{t(`ticket.problems.${problem}`)}</Message>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="danger" onClick={onRemove}>
            {t('ticket.removeLine')}
          </Button>
          <Button onClick={onClose}>{t('ticket.done')}</Button>
        </div>
      </div>
      {scanning && <ScanBarcodeDialog onResult={handleScan} onClose={() => setScanning(false)} />}
    </Sheet>
  )
}
