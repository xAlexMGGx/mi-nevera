import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import type { InventoryData } from '../domain/inventory'
import type { LearnedDate } from '../domain/learnedDates'
import { attachScan, lineLabel, retargetLine, targetCounting, type DraftLine } from '../domain/lotDraft'
import { categories, zoneKinds, type Category } from '../domain/types'
import { useOffline } from '../lib/connectivity'
import { scanFacts } from '../scan/identify'
import { ScanBarcodeDialog } from '../scan/ScanBarcodeDialog'
import { CloseIcon } from './icons'
import { DateEntry } from './DateEntry'
import { ProductPhoto } from './ProductPhoto'
import { QuantityUnitField } from './QuantityUnitField'
import { ShelfLifeChip } from './ShelfLifeChip'
import { Button, Segmented, SelectField, TextField, focusRing } from './ui'

interface LotFieldsProps {
  line: DraftLine
  houseId: string
  house: InventoryData
  /** Fecha aprendida del producto (SPEC §7.4). */
  learned: LearnedDate | null
  /** El día de compra: por defecto, también el de congelado. */
  purchasedAt: string
  update: (change: (line: DraftLine) => DraftLine) => void
  /** Elegir otro producto en el buscador. */
  onChangeProduct: () => void
  /** La pantalla ya enseña el producto (en Añadir, en la cabecera). */
  hideProduct?: boolean
}

/**
 * Lo que se va a añadir: producto, cantidad con su unidad, zona, fechas, marca y código. Es el mismo
 * formulario a mano, por código de barras y en cada línea del ticket; lo escaneado solo lo rellena.
 */
export function LotFields({ line, houseId, house, learned, purchasedAt, update, onChangeProduct, hideProduct = false }: LotFieldsProps) {
  const { t } = useTranslation()
  const { language } = useDateContext()
  const catalog = useCatalog()
  const offline = useOffline()
  const [scanning, setScanning] = useState(false)

  const { target } = line
  const { name, icon } = lineLabel(target, house.products, catalog.byId, language)
  const counting = targetCounting(target, house.products)
  const product = target.type === 'product' ? house.products.find((row) => row.id === target.productId) : undefined
  const item = target.type === 'catalog' ? catalog.byId.get(target.catalogItemId) : undefined
  const guided = {
    catalog_item_id: product?.catalog_item_id ?? item?.id ?? null,
    category: product?.category ?? item?.category ?? (target.type === 'new' ? target.category : 'other'),
  }
  const frozenAt = line.frozenAt || purchasedAt
  const countingKey = `${target.type === 'product' ? target.productId : target.type === 'catalog' ? target.catalogItemId : 'new'}:${counting.quantityKind === 'bulk'}`

  const patch = (values: Partial<DraftLine>) => update((current) => ({ ...current, ...values }))

  return (
    <div className="flex flex-col gap-5">
      {hideProduct ? (
        <p className="-mb-2 text-sm text-ink-muted">
          {target.type === 'product' ? t('lot.inHouse') : target.type === 'catalog' ? t('lot.fromCatalog') : t('lot.newProduct')}
        </p>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
          <span aria-hidden="true" className="text-2xl leading-none">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{name || t('lot.newProduct')}</p>
            <p className="text-sm text-ink-muted">
              {target.type === 'product' ? t('lot.inHouse') : target.type === 'catalog' ? t('lot.fromCatalog') : t('lot.newProduct')}
            </p>
          </div>
          <button type="button" onClick={onChangeProduct} className={`min-h-10 shrink-0 px-2 text-sm font-semibold text-brand ${focusRing}`}>
            {t('common.change')}
          </button>
        </div>
      )}

      {target.type === 'new' && (
        <>
          <TextField
            label={t('lot.name')}
            maxLength={80}
            autoComplete="off"
            value={target.name}
            onChange={(event) => update((current) => (current.target.type === 'new' ? { ...current, target: { ...current.target, name: event.target.value } } : current))}
          />
          <SelectField
            label={t('form.category')}
            value={target.category}
            onChange={(event) =>
              update((current) => (current.target.type === 'new' ? { ...current, target: { ...current.target, category: event.target.value as Category } } : current))
            }
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {t(`categories.${value}`)}
              </option>
            ))}
          </SelectField>
        </>
      )}

      <QuantityUnitField
        key={countingKey}
        quantity={line.quantity}
        counting={counting}
        locked={target.type === 'product'}
        onQuantity={(quantity) => patch({ quantity })}
        onCounting={(next) => update((current) => (current.target.type === 'product' ? current : { ...current, target: { ...current.target, counting: next } }))}
      />
      {target.type === 'product' && <p className="-mt-3 text-xs text-ink-muted">{t('lot.countedLikeThis')}</p>}

      <Segmented
        label={t('form.zone')}
        options={zoneKinds.map((zone) => ({ value: zone, label: t(`zones.${zone}`) }))}
        value={line.zone}
        onChange={(zone) => patch({ zone })}
      />

      {line.zone === 'freezer' && (
        <>
          <p className="-mt-2 text-sm text-ink-muted">{t('form.frozenHint')}</p>
          <TextField label={t('form.frozenAt')} type="date" value={frozenAt} onChange={(event) => patch({ frozenAt: event.target.value })} />
          <ShelfLifeChip product={guided} state="frozen" baseDate={frozenAt} value={line.reminderDate} onChange={(reminderDate) => patch({ reminderDate })} />
          <TextField
            label={t('form.reminder')}
            hint={t('form.reminderHint')}
            type="date"
            value={line.reminderDate}
            onChange={(event) => patch({ reminderDate: event.target.value })}
          />
        </>
      )}

      <DateEntry name={name} date={line.printedDate} type={line.dateType} learned={learned} onChange={(printedDate, dateType) => patch({ printedDate, dateType })} />

      <TextField label={t('form.brand')} autoComplete="off" value={line.brand} onChange={(event) => patch({ brand: event.target.value })} />

      {line.barcode ? (
        <div className="flex items-center gap-3 rounded-xl border border-line p-2.5">
          <ProductPhoto src={line.imageUrl} className="size-12 rounded-lg" />
          <p className="min-w-0 flex-1 truncate text-sm">{t('barcode.code', { code: line.barcode })}</p>
          <button
            type="button"
            aria-label={t('barcode.remove')}
            onClick={() => patch({ barcode: null, imageUrl: null })}
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

      {scanning && (
        <ScanBarcodeDialog
          houseId={houseId}
          house={house}
          onClose={() => setScanning(false)}
          onResult={(result) => {
            setScanning(false)
            update((current) => {
              // Un código que la casa ya conoce dice qué producto es.
              const known = result.productId && !(current.target.type === 'product' && current.target.productId === result.productId)
              const base = known ? retargetLine(current, { type: 'product', productId: result.productId! }, house, catalog.byId) : current
              return attachScan(base, scanFacts(result))
            })
          }}
        />
      )}
    </div>
  )
}
