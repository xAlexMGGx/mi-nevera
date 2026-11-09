import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { PencilIcon } from '../components/icons'
import { Screen, topBarIcon } from '../components/Screen'
import { StatusBadge } from '../components/StatusBadge'
import { ActionChip, Button, Card, FullScreenLoader, LoadError, Message, TextAreaField, TextField, buttonClass } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useInventory, useInventoryAction } from '../data/inventory'
import { formatDate, formatDayMonth } from '../domain/dates'
import { productIcon, productName, type Lot, type OpenedUnit, type Product, type Zone } from '../domain/inventory'
import { formatPercent, formatNumber, formatQuantity, summarize, totalContent } from '../domain/quantity'
import { statusOf, type RowDate } from '../domain/status'
import type { ZoneKind } from '../domain/types'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'
import {
  AdjustSheet,
  ConsumeAmountSheet,
  DeleteProductSheet,
  DiscardSheet,
  EditLotSheet,
  ExactRemainingSheet,
  MoveSheet,
  RenameSheet,
  UnitDatesSheet,
  useProductUpdate,
} from './product/sheets'

type SheetState =
  | { type: 'consume'; lotId?: string }
  | { type: 'adjust'; lot: Lot }
  | { type: 'move'; lot: Lot; target?: ZoneKind }
  | { type: 'discard'; lot: Lot }
  | { type: 'edit'; lot: Lot }
  | { type: 'exact'; unit: OpenedUnit }
  | { type: 'unitDates'; unit: OpenedUnit }
  | { type: 'rename' }
  | { type: 'delete' }

const fractions = [
  { key: 'quarter', value: 0.25 },
  { key: 'half', value: 0.5 },
  { key: 'threeQuarters', value: 0.75 },
  { key: 'empty', value: 0 },
] as const

function useRowDate(date: string | null, basis: Lot['effective_basis']): RowDate | null {
  const { today, daysAhead } = useDateContext()
  return date ? { date, basis, status: statusOf({ date, basis }, today, daysAhead) } : null
}

function DateBadge({ item }: { item: Pick<Lot, 'effective_date' | 'effective_basis'> }) {
  const { t } = useTranslation()
  const rowDate = useRowDate(item.effective_date, item.effective_basis)
  // Una fecha impresa sin novedad ya aparece en el encabezado del grupo.
  if (!rowDate || (rowDate.status === 'ok' && rowDate.basis !== 'reminder')) return null
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex items-center gap-1.5">
        {rowDate.basis === 'reminder' && rowDate.status === 'ok' && (
          <span className="text-xs font-semibold text-ink-muted">{t('product.reminder')}</span>
        )}
        <StatusBadge rowDate={rowDate} />
      </span>
      {rowDate.status === 'review' && <span className="text-xs text-review">{t('status.reviewNote')}</span>}
    </span>
  )
}

function UnitRow({ unit, product, onOpenSheet }: { unit: OpenedUnit; product: Product; onOpenSheet: (sheet: SheetState) => void }) {
  const { t } = useTranslation()
  const { tag, today } = useDateContext()
  const { run, pending } = useInventoryAction()
  const content =
    product.content_amount && product.content_unit
      ? `${formatNumber(unit.remaining_fraction * product.content_amount, tag)} ${t(`contentUnits.${product.content_unit}`)}`
      : null

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">
          {t('product.remaining', { percent: formatPercent(unit.remaining_fraction, tag) })}
          {content && <span className="font-normal text-ink-muted"> · {content}</span>}
        </p>
        <p className="text-xs text-ink-muted">{t('product.openedSince', { date: formatDate(unit.opened_at, tag, today) })}</p>
      </div>
      <DateBadge item={unit} />
      <div className="flex gap-1.5">
        {fractions.map(({ key, value }) => (
          <ActionChip
            key={key}
            disabled={pending || unit.remaining_fraction === value}
            className="min-w-0 flex-1 !px-1"
            onClick={() =>
              void run(value === 0 ? 'finished' : 'adjusted', () =>
                supabase.rpc('set_remaining', { p_opened_unit_id: unit.id, p_fraction: value }),
              )
            }
          >
            {t(`product.fractions.${key}`)}
          </ActionChip>
        ))}
        <ActionChip className="shrink-0" onClick={() => onOpenSheet({ type: 'exact', unit })}>
          {t('product.fractions.exact')}
        </ActionChip>
      </div>
      <button
        type="button"
        onClick={() => onOpenSheet({ type: 'unitDates', unit })}
        className="min-h-9 self-start text-sm font-medium text-brand"
      >
        {unit.reminder_date ? t('product.editReminder') : t('product.addReminder')}
      </button>
    </div>
  )
}

function LotCard({
  lot,
  units,
  product,
  zones,
  onOpenSheet,
}: {
  lot: Lot
  units: OpenedUnit[]
  product: Product
  zones: Zone[]
  onOpenSheet: (sheet: SheetState) => void
}) {
  const { t } = useTranslation()
  const { tag, today } = useDateContext()
  const { run, pending } = useInventoryAction()

  const zoneKind = zones.find((zone) => zone.id === lot.zone_id)?.kind ?? 'fridge'
  const isDish = product.kind === 'cooked_dish'
  const isBulk = product.quantity_kind === 'bulk'
  const isFrozen = Boolean(lot.frozen_at && !lot.thawed_at)
  const canOpen = !isDish && lot.quantity > 0 && !lot.opened_at

  function consumeOne() {
    if (isBulk) onOpenSheet({ type: 'consume', lotId: lot.id })
    else void run('consumed', () => supabase.rpc('consume', { p_lot_id: lot.id }))
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-ink-muted">{t(`zones.${zoneKind}`)}</span>
          {lot.quantity > 0 && <span className="font-semibold">{formatQuantity(lot.quantity, product, t, tag)}</span>}
          {lot.brand && <span className="text-sm text-ink-muted">{lot.brand}</span>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
          {isFrozen && <span>{t('inventory.frozenSince', { date: formatDayMonth(lot.frozen_at!) })}</span>}
          {lot.thawed_at && <span>{t('product.thawedOn', { date: formatDayMonth(lot.thawed_at) })}</span>}
          {lot.opened_at && <span>{t('product.openedSince', { date: formatDate(lot.opened_at, tag, today) })}</span>}
        </div>
        {(lot.quantity > 0 || units.length === 0) && <DateBadge item={lot} />}
      </div>

      {units.map((unit) => (
        <UnitRow key={unit.id} unit={unit} product={product} onOpenSheet={onOpenSheet} />
      ))}

      <div className="flex flex-wrap gap-1.5">
        <ActionChip disabled={pending} onClick={consumeOne}>
          {t('inventory.minusOne')}
        </ActionChip>
        {canOpen && (
          <ActionChip disabled={pending} onClick={() => void run('opened', () => supabase.rpc('open_unit', { p_lot_id: lot.id }))}>
            {isBulk ? t('product.actions.markOpen') : t('product.actions.openOne')}
          </ActionChip>
        )}
        <ActionChip onClick={() => onOpenSheet({ type: 'adjust', lot })}>{t('product.actions.adjust')}</ActionChip>
        <ActionChip onClick={() => onOpenSheet({ type: 'move', lot })}>{t('product.actions.move')}</ActionChip>
        {zoneKind === 'freezer' ? (
          <ActionChip onClick={() => onOpenSheet({ type: 'move', lot, target: 'fridge' })}>{t('product.actions.thaw')}</ActionChip>
        ) : (
          <ActionChip onClick={() => onOpenSheet({ type: 'move', lot, target: 'freezer' })}>{t('product.actions.freeze')}</ActionChip>
        )}
        <ActionChip onClick={() => onOpenSheet({ type: 'discard', lot })}>{t('product.actions.discard')}</ActionChip>
        <ActionChip onClick={() => onOpenSheet({ type: 'edit', lot })}>{t('product.actions.edit')}</ActionChip>
      </div>
    </div>
  )
}

function BrandForm({ product }: { product: Product }) {
  const { t } = useTranslation()
  const update = useProductUpdate()
  const [preferred, setPreferred] = useState(product.preferred_brand ?? '')
  const [notes, setNotes] = useState(product.brand_notes ?? '')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate({ id: product.id, patch: { preferred_brand: preferred || null, brand_notes: notes || null } })
  }

  function edit(setter: (value: string) => void, value: string) {
    setter(value)
    update.reset()
  }

  return (
    <Card>
      <h2 className="font-semibold">{t('product.brandTitle')}</h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField label={t('product.preferredBrand')} autoComplete="off" value={preferred} onChange={(event) => edit(setPreferred, event.target.value)} />
        <TextAreaField
          label={t('product.brandNotes')}
          placeholder={t('product.brandNotesPlaceholder')}
          rows={2}
          value={notes}
          onChange={(event) => edit(setNotes, event.target.value)}
        />
        {update.isSuccess && <Message tone="success">{t('settings.saved')}</Message>}
        {update.isError && <Message tone="error">{t(errorKey(update.error))}</Message>}
        <Button type="submit" variant="secondary" disabled={update.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  )
}

function groupTitle(lot: Lot, t: ReturnType<typeof useTranslation>['t'], tag: string, today: string) {
  if (lot.cooked_at) return t('product.cookedOn', { date: formatDate(lot.cooked_at, tag, today) })
  if (!lot.printed_date) return t('product.noDate')
  const date = formatDate(lot.printed_date, tag, today)
  return lot.printed_date_type === 'best_before' ? t('product.bestBeforeOn', { date }) : t('product.expiresOn', { date })
}

export function ProductPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { language, tag, today } = useDateContext()
  const inventory = useInventory()
  const catalog = useCatalog()
  const { run, pending } = useInventoryAction()
  const [sheet, setSheet] = useState<SheetState | null>(null)

  if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
  if (inventory.isError) {
    return <Screen title={t('app.name')} backTo="/" main={<LoadError onRetry={() => void inventory.refetch()} />} />
  }

  const product = inventory.data.products.find((row) => row.id === id)
  if (!product) {
    return (
      <Screen
        title={t('app.name')}
        backTo="/"
        main={<p className="py-12 text-center text-ink-muted">{t('product.notFound')}</p>}
      />
    )
  }

  const name = productName(product, catalog.byId, language)
  const icon = productIcon(product, catalog.byId)
  const lots = inventory.data.lots
    .filter((lot) => lot.product_id === product.id)
    .sort((a, b) => (a.effective_date ?? '9999').localeCompare(b.effective_date ?? '9999') || a.created_at.localeCompare(b.created_at))
  const units = inventory.data.units.filter((unit) => lots.some((lot) => lot.id === unit.lot_id))
  const unitsOf = (lot: Lot) => units.filter((unit) => unit.lot_id === lot.id)

  // Lotes agrupados por fecha impresa (SPEC §6.2).
  const groups = new Map<string, Lot[]>()
  for (const lot of lots) {
    const key = lot.cooked_at ? lot.id : `${lot.printed_date}|${lot.printed_date_type}`
    groups.set(key, [...(groups.get(key) ?? []), lot])
  }

  const hasStock = lots.length > 0
  const isBulk = product.quantity_kind === 'bulk'
  const isDish = product.kind === 'cooked_dish'
  const total = hasStock ? summarize(product, lots, units, t, tag) : ''
  const content = hasStock ? totalContent(product, lots, units, t, tag) : null
  const canOpenAny = !isDish && !isBulk && lots.some((lot) => lot.quantity > 0 && !lot.opened_at)
  const number = lots.find((lot) => lot.container_number !== null)?.container_number

  function renderSheet() {
    if (!sheet || !product) return null
    const close = () => setSheet(null)
    switch (sheet.type) {
      case 'consume':
        return <ConsumeAmountSheet product={product} name={name} lots={lots} lotId={sheet.lotId} onClose={close} />
      case 'adjust':
        return <AdjustSheet product={product} lot={sheet.lot} onClose={close} />
      case 'move':
        return <MoveSheet product={product} lot={sheet.lot} units={unitsOf(sheet.lot)} zones={inventory.data!.zones} target={sheet.target} onClose={close} />
      case 'discard':
        return <DiscardSheet product={product} lot={sheet.lot} units={unitsOf(sheet.lot)} onClose={close} />
      case 'edit':
        return <EditLotSheet product={product} lot={sheet.lot} onClose={close} />
      case 'exact':
        return <ExactRemainingSheet product={product} unit={sheet.unit} onClose={close} />
      case 'unitDates':
        return <UnitDatesSheet unit={sheet.unit} onClose={close} />
      case 'rename':
        return <RenameSheet product={product} name={name} onClose={close} />
      case 'delete':
        return <DeleteProductSheet product={product} name={name} onClose={close} />
    }
  }

  return (
    <Screen
      title={name}
      backTo="/"
      action={
        <button type="button" aria-label={t('product.rename')} onClick={() => setSheet({ type: 'rename' })} className={topBarIcon}>
          <PencilIcon />
        </button>
      }
      main={
        <div className="flex flex-col gap-5">
          <section className="flex items-center gap-4">
            <span aria-hidden="true" className="text-5xl leading-none">
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              {number !== undefined && number !== null && (
                <p className="font-bold text-brand">{t('inventory.containerNumber', { number })}</p>
              )}
              <p className="text-sm text-ink-muted">{t(`categories.${product.category}`)}</p>
              {hasStock && <p className="text-lg font-semibold">{total}</p>}
              {content && <p className="text-sm text-ink-muted">{t('product.totalContent', { amount: content })}</p>}
            </div>
          </section>

          {hasStock ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  disabled={pending}
                  className={canOpenAny ? '' : 'col-span-2'}
                  onClick={() => {
                    if (isBulk) setSheet({ type: 'consume' })
                    else void run('consumed', () => supabase.rpc('consume', { p_product_id: product.id }))
                  }}
                >
                  {t('inventory.minusOne')}
                </Button>
                {canOpenAny && (
                  <Button variant="secondary" disabled={pending} onClick={() => void run('opened', () => supabase.rpc('open_unit', { p_product_id: product.id }))}>
                    {t('product.actions.openOne')}
                  </Button>
                )}
              </div>
              {[...groups.entries()].map(([key, group]) => (
                <section key={key} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-ink-muted">{groupTitle(group[0]!, t, tag, today)}</h2>
                  {group.map((lot) => (
                    <LotCard key={lot.id} lot={lot} units={unitsOf(lot)} product={product} zones={inventory.data.zones} onOpenSheet={setSheet} />
                  ))}
                </section>
              ))}
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-center">
              <p className="font-semibold">{t('product.emptyTitle')}</p>
              <Link to={`/add?product=${product.id}`} className={buttonClass()}>
                {t('product.addMore')}
              </Link>
              <Button variant="danger" onClick={() => setSheet({ type: 'delete' })}>
                {t('product.delete')}
              </Button>
            </div>
          )}

          {!isDish && <BrandForm key={product.id} product={product} />}
          {renderSheet()}
        </div>
      }
    />
  )
}
