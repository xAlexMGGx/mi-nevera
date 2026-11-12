import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { DateEntry } from '../../components/DateEntry'
import { ShelfLifeChip } from '../../components/ShelfLifeChip'
import { Sheet } from '../../components/Sheet'
import { Button, Message, Segmented, SelectField, Stepper, TextField } from '../../components/ui'
import { useDateContext } from '../../data/context'
import { useHouses, useHouseZones } from '../../data/house'
import { useInventoryAction } from '../../data/inventory'
import type { Lot, OpenedUnit, Product, Zone } from '../../domain/inventory'
import { formatForInput, formatNumber, formatPercent, formatQuantity, parseAmount } from '../../domain/quantity'
import { categories, type Category, type PrintedDateType, type ZoneKind } from '../../domain/types'
import { errorKey as errorKeyOf } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

/** Campo de cantidad: entero con botones, o decimal a granel. */
function AmountField({
  product,
  label,
  value,
  max,
  min = 0,
  onChange,
}: {
  product: Product
  label: string
  value: string
  max?: number
  min?: number
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  if (product.quantity_kind === 'divisible' || (product.kind === 'food' && product.quantity_kind === 'count')) {
    return <Stepper label={label} value={parseAmount(value) ?? 0} min={min} max={max} onChange={(next) => onChange(String(next))} />
  }
  const suffix = product.bulk_unit ? ` (${t(`contentUnits.${product.bulk_unit}`)})` : ''
  return <TextField label={`${label}${suffix}`} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
}

interface ConsumeAmountSheetProps {
  product: Product
  name: string
  lots: Lot[]
  zoneId?: string
  /** Si se indica, solo se consume de este lote. */
  lotId?: string
  onClose: () => void
}

/** A granel, "−1" no tiene sentido: se pregunta cuánto (SPEC §7.1). */
export function ConsumeAmountSheet({ product, name, lots, zoneId, lotId, onClose }: ConsumeAmountSheetProps) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [amount, setAmount] = useState('')
  const available = lots.filter((lot) => !lotId || lot.id === lotId).reduce((sum, lot) => sum + lot.quantity, 0)
  const parsed = parseAmount(amount)
  const invalid = amount.trim() !== '' && (!parsed || parsed <= 0)

  const scope = { p_product_id: lotId ? undefined : product.id, p_lot_id: lotId, p_zone_id: zoneId }

  async function consume(args: { p_amount?: number; p_all?: boolean }) {
    if (await run('consumed', () => supabase.rpc('consume', { ...scope, ...args }))) onClose()
  }

  return (
    <Sheet title={t('sheets.consume.title', { name })} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (parsed && parsed > 0) void consume({ p_amount: parsed })
        }}
      >
        <TextField
          label={t('sheets.consume.amount', { available: formatQuantity(available, product, t, tag) })}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {invalid && <Message tone="error">{t('form.errors.quantity')}</Message>}
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={pending} onClick={() => void consume({ p_all: true })}>
            {t('sheets.consume.all')}
          </Button>
          <Button type="submit" disabled={pending || !parsed || parsed <= 0}>
            {t('sheets.consume.submit')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

export function AdjustSheet({ product, lot, onClose }: { product: Product; lot: Lot; onClose: () => void }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [value, setValue] = useState(formatForInput(lot.quantity, tag))
  const parsed = parseAmount(value)
  const valid = parsed !== null && parsed >= 0

  return (
    <Sheet title={t('sheets.adjust.title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          void run('adjusted', () => supabase.rpc('adjust_quantity', { p_lot_id: lot.id, p_new_quantity: parsed })).then((done) => {
            if (done) onClose()
          })
        }}
      >
        <AmountField product={product} label={t('sheets.adjust.label')} value={value} onChange={setValue} />
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" disabled={pending || !valid}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  )
}

/** Unidades abiertas que se pueden seleccionar para mover o tirar. */
function UnitChecklist({ units, selected, onChange }: { units: OpenedUnit[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  if (units.length === 0) return null
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="pb-1 text-sm font-medium">{t('sheets.openUnits')}</legend>
      {units.map((unit) => (
        <label key={unit.id} className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-[var(--brand)]"
            checked={selected.includes(unit.id)}
            onChange={(event) => onChange(event.target.checked ? [...selected, unit.id] : selected.filter((id) => id !== unit.id))}
          />
          {t('sheets.openUnit', { percent: formatPercent(unit.remaining_fraction, tag) })}
        </label>
      ))}
    </fieldset>
  )
}

interface MoveSheetProps {
  product: Product
  lot: Lot
  units: OpenedUnit[]
  zones: Zone[]
  /** Congelar y Descongelar llegan con el destino ya elegido. */
  target?: ZoneKind
  onClose: () => void
}

export function MoveSheet({ product, lot, units, zones, target, onClose }: MoveSheetProps) {
  const { t } = useTranslation()
  const { tag, today } = useDateContext()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const houses = useHouses()
  const currentZone = zones.find((zone) => zone.id === lot.zone_id)
  const others = zones.filter((zone) => zone.id !== lot.zone_id)

  const [targetHouseId, setTargetHouseId] = useState(lot.house_id)
  const [targetKind, setTargetKind] = useState<ZoneKind>(target ?? others[0]!.kind)
  const [amount, setAmount] = useState(formatForInput(lot.quantity, tag))
  const [unitIds, setUnitIds] = useState(units.map((unit) => unit.id))
  const [reminder, setReminder] = useState('')

  const otherHouse = targetHouseId !== lot.house_id
  const otherHouseZones = useHouseZones(targetHouseId, otherHouse)
  const targetZones = otherHouse ? (otherHouseZones.data ?? []) : others
  const targetZoneId = targetZones.find((zone) => zone.kind === targetKind)?.id

  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed >= 0 && parsed <= lot.quantity && (parsed > 0 || unitIds.length > 0) && Boolean(targetZoneId)
  const freezing = targetKind === 'freezer' && currentZone?.kind !== 'freezer'
  const thawing = currentZone?.kind === 'freezer' && targetKind !== 'freezer'
  const showReminder = freezing || thawing
  // Entre casas siempre es "mover", aunque de paso se congele o descongele.
  const action = otherHouse ? 'move' : freezing ? 'freeze' : thawing ? 'thaw' : 'move'
  const title = { move: t('sheets.move.title'), freeze: t('sheets.move.freezeTitle'), thaw: t('sheets.move.thawTitle') }[action]
  const submit = { move: t('sheets.move.submit'), freeze: t('sheets.move.freezeSubmit'), thaw: t('sheets.move.thawSubmit') }[action]

  function selectHouse(houseId: string) {
    setTargetHouseId(houseId)
    // En otra casa lo natural es dejarlo en la misma zona. En esta, ya está ahí.
    if (houseId !== lot.house_id && currentZone) setTargetKind(currentZone.kind)
    else if (currentZone?.kind === targetKind) setTargetKind(others[0]!.kind)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || !targetZoneId) return
    const toast = { move: 'moved', freeze: 'frozen', thaw: 'thawed' } as const
    const done = await run(toast[action], () =>
      supabase.rpc('move_lot', {
        p_lot_id: lot.id,
        p_quantity: parsed,
        p_target_zone_id: targetZoneId,
        p_opened_unit_ids: unitIds,
        p_reminder_date: showReminder && reminder ? reminder : undefined,
      }),
    )
    if (done) onClose()
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        {!target && houses.data && houses.data.length > 1 && (
          <SelectField label={t('sheets.move.house')} value={targetHouseId} onChange={(event) => selectHouse(event.target.value)}>
            {houses.data.map((house) => (
              <option key={house.id} value={house.id}>
                {house.id === lot.house_id ? t('sheets.move.thisHouse', { name: house.name }) : house.name}
              </option>
            ))}
          </SelectField>
        )}
        <Segmented
          label={t('sheets.move.to')}
          options={targetZones.map((zone) => ({ value: zone.kind, label: t(`zones.${zone.kind}`) }))}
          value={targetKind}
          onChange={setTargetKind}
        />
        {lot.quantity > 0 && <AmountField product={product} label={t('sheets.move.amount')} value={amount} max={lot.quantity} onChange={setAmount} />}
        <UnitChecklist units={units} selected={unitIds} onChange={setUnitIds} />
        {showReminder && (
          <>
            <ShelfLifeChip product={product} state={freezing ? 'frozen' : 'thawed'} baseDate={today} value={reminder} onChange={setReminder} />
            <TextField
              label={t('form.reminder')}
              hint={t(freezing ? 'sheets.move.freezeHint' : 'sheets.move.thawHint')}
              type="date"
              value={reminder}
              onChange={(event) => setReminder(event.target.value)}
            />
          </>
        )}
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" disabled={pending || !valid}>
          {submit}
        </Button>
      </form>
    </Sheet>
  )
}

interface DiscardSheetProps {
  product: Product
  lot: Lot
  units: OpenedUnit[]
  /** Cuánto de lo cerrado se propone tirar. Sin indicarlo, todo. */
  initialAmount?: number
  onClose: () => void
}

export function DiscardSheet({ product, lot, units, initialAmount, onClose }: DiscardSheetProps) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [amount, setAmount] = useState(formatForInput(initialAmount ?? lot.quantity, tag))
  const [unitIds, setUnitIds] = useState(units.map((unit) => unit.id))
  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed >= 0 && parsed <= lot.quantity && (parsed > 0 || unitIds.length > 0)

  return (
    <Sheet title={t('sheets.discard.title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          void run('discarded', () =>
            supabase.rpc('discard', { p_lot_id: lot.id, p_quantity: parsed, p_opened_unit_ids: unitIds }),
          ).then((done) => {
            if (done) onClose()
          })
        }}
      >
        {lot.quantity > 0 && <AmountField product={product} label={t('sheets.discard.amount')} value={amount} max={lot.quantity} onChange={setAmount} />}
        <UnitChecklist units={units} selected={unitIds} onChange={setUnitIds} />
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" variant="danger" disabled={pending || !valid}>
          {t('sheets.discard.submit')}
        </Button>
      </form>
    </Sheet>
  )
}

export function EditLotSheet({ product, name, lot, onClose }: { product: Product; name: string; lot: Lot; onClose: () => void }) {
  const { t } = useTranslation()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const isDish = product.kind === 'cooked_dish'
  const isFrozen = Boolean(lot.frozen_at && !lot.thawed_at)
  const isThawed = Boolean(lot.thawed_at)
  const isOpen = Boolean(lot.opened_at)

  const [printedDate, setPrintedDate] = useState(lot.printed_date ?? '')
  const [dateType, setDateType] = useState<PrintedDateType | null>(lot.printed_date_type)
  const [brand, setBrand] = useState(lot.brand ?? '')
  const [purchasedAt, setPurchasedAt] = useState(lot.purchased_at)
  const [cookedAt, setCookedAt] = useState(lot.cooked_at ?? '')
  const [frozenAt, setFrozenAt] = useState(lot.frozen_at ?? '')
  const [thawedAt, setThawedAt] = useState(lot.thawed_at ?? '')
  const [openedAt, setOpenedAt] = useState(lot.opened_at ?? '')
  const [reminder, setReminder] = useState(lot.reminder_date ?? '')
  const [container, setContainer] = useState(String(lot.container_number ?? ''))
  const [missingType, setMissingType] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (printedDate && !dateType) return setMissingType(true)
    setMissingType(false)

    const patch = isDish
      ? {
          cooked_at: cookedAt || null,
          reminder_date: reminder || null,
          container_number: parseAmount(container),
          ...(isFrozen ? { frozen_at: frozenAt || null } : {}),
          ...(isThawed ? { thawed_at: thawedAt || null } : {}),
        }
      : {
          printed_date: printedDate || null,
          printed_date_type: printedDate ? dateType : null,
          brand: brand.trim() || null,
          purchased_at: purchasedAt || null,
          ...(isFrozen || isThawed || isOpen ? { reminder_date: reminder || null } : {}),
          ...(isFrozen ? { frozen_at: frozenAt || null } : {}),
          ...(isThawed ? { thawed_at: thawedAt || null } : {}),
          ...(isOpen ? { opened_at: openedAt || null } : {}),
        }

    if (await run('edited', () => supabase.rpc('update_lot', { p_lot_id: lot.id, p_patch: patch }))) onClose()
  }

  return (
    <Sheet title={t('sheets.edit.title')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        {isDish ? (
          <>
            <TextField label={t('leftover.containerNumber')} inputMode="numeric" value={container} onChange={(event) => setContainer(event.target.value)} />
            <TextField label={t('leftover.cookedAt')} type="date" value={cookedAt} onChange={(event) => setCookedAt(event.target.value)} />
          </>
        ) : (
          <>
            <DateEntry
              name={name}
              date={printedDate}
              type={dateType}
              onChange={(date, type) => {
                setPrintedDate(date)
                setDateType(type)
              }}
            />
            <TextField label={t('form.brand')} autoComplete="off" value={brand} onChange={(event) => setBrand(event.target.value)} />
            <TextField label={t('form.purchasedAt')} type="date" value={purchasedAt} onChange={(event) => setPurchasedAt(event.target.value)} />
          </>
        )}
        {isFrozen && <TextField label={t('form.frozenAt')} type="date" value={frozenAt} onChange={(event) => setFrozenAt(event.target.value)} />}
        {isThawed && <TextField label={t('sheets.edit.thawedAt')} type="date" value={thawedAt} onChange={(event) => setThawedAt(event.target.value)} />}
        {isOpen && <TextField label={t('sheets.edit.openedAt')} type="date" value={openedAt} onChange={(event) => setOpenedAt(event.target.value)} />}
        {(isDish || isFrozen || isThawed || isOpen) && (
          <TextField label={t('form.reminder')} hint={t('form.reminderHint')} type="date" value={reminder} onChange={(event) => setReminder(event.target.value)} />
        )}
        {missingType && <Message tone="error">{t('form.errors.dateType')}</Message>}
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  )
}

/** Cantidad exacta de una unidad abierta, en porcentaje y con su equivalente. */
export function ExactRemainingSheet({ product, unit, onClose }: { product: Product; unit: OpenedUnit; onClose: () => void }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [percent, setPercent] = useState(String(Math.round(unit.remaining_fraction * 100)))
  const parsed = parseAmount(percent)
  const valid = parsed !== null && parsed >= 0 && parsed <= 100
  const equivalent =
    valid && product.content_amount && product.content_unit
      ? `${formatNumber((parsed / 100) * product.content_amount, tag)} ${t(`contentUnits.${product.content_unit}`)}`
      : null

  return (
    <Sheet title={t('sheets.exact.title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          const toast = parsed === 0 ? 'finished' : 'adjusted'
          void run(toast, () => supabase.rpc('set_remaining', { p_opened_unit_id: unit.id, p_fraction: parsed / 100 })).then((done) => {
            if (done) onClose()
          })
        }}
      >
        <TextField
          label={t('sheets.exact.label')}
          hint={equivalent ? t('sheets.exact.equivalent', { amount: equivalent }) : undefined}
          inputMode="decimal"
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
        />
        {!valid && <Message tone="error">{t('sheets.exact.invalid')}</Message>}
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" disabled={pending || !valid}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  )
}

export function UnitDatesSheet({ unit, onClose }: { unit: OpenedUnit; onClose: () => void }) {
  const { t } = useTranslation()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [openedAt, setOpenedAt] = useState(unit.opened_at)
  const [reminder, setReminder] = useState(unit.reminder_date ?? '')

  return (
    <Sheet title={t('sheets.unitDates.title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void run('edited', () =>
            supabase.rpc('update_opened_unit', {
              p_opened_unit_id: unit.id,
              p_patch: { opened_at: openedAt || null, reminder_date: reminder || null },
            }),
          ).then((done) => {
            if (done) onClose()
          })
        }}
      >
        <TextField label={t('sheets.edit.openedAt')} type="date" value={openedAt} onChange={(event) => setOpenedAt(event.target.value)} />
        <TextField label={t('form.reminder')} hint={t('form.reminderHint')} type="date" value={reminder} onChange={(event) => setReminder(event.target.value)} />
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  )
}

function useProductUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, string | null> }) => {
      const { error } = await supabase.rpc('update_product', { p_product_id: id, p_patch: patch })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory'] }),
  })
}

export { useProductUpdate }

export function RenameSheet({ product, name, onClose }: { product: Product; name: string; onClose: () => void }) {
  const { t } = useTranslation()
  const update = useProductUpdate()
  const [value, setValue] = useState(name)
  const [category, setCategory] = useState<Category>(product.category)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const patch: Record<string, string> = { category }
    // Sin cambios, un producto del catálogo sigue traduciéndose según el idioma.
    if (value.trim() !== name) patch.name = value
    update.mutate({ id: product.id, patch }, { onSuccess: onClose })
  }

  return (
    <Sheet title={t('sheets.rename.title')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <TextField label={t('sheets.rename.name')} required maxLength={80} autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} />
        <SelectField label={t('form.category')} value={category} onChange={(event) => setCategory(event.target.value as Category)}>
          {categories.map((option) => (
            <option key={option} value={option}>
              {t(`categories.${option}`)}
            </option>
          ))}
        </SelectField>
        {update.isError && <Message tone="error">{t(errorKeyOf(update.error))}</Message>}
        <Button type="submit" disabled={update.isPending || !value.trim()}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  )
}

interface DeleteProductSheetProps {
  product: Product
  name: string
  onClose: () => void
  /** Sin indicarlo, vuelve al inventario, porque el detalle del producto deja de existir. */
  onDeleted?: () => void
}

export function DeleteProductSheet({ product, name, onClose, onDeleted }: DeleteProductSheetProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_product', { p_product_id: product.id })
      if (error) throw error
    },
    onSuccess: async () => {
      if (onDeleted) onDeleted()
      else await navigate('/', { replace: true })
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
  })

  return (
    <Sheet title={t('sheets.delete.title', { name })} onClose={onClose}>
      <p className="text-ink-muted">{t('sheets.delete.body')}</p>
      {remove.isError && <Message tone="error">{t(errorKeyOf(remove.error))}</Message>}
      <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
        {t('sheets.delete.submit')}
      </Button>
    </Sheet>
  )
}
