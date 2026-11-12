import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { PencilIcon } from '../../components/icons'
import { LearnedDateChip } from '../../components/LearnedDateChip'
import { Screen } from '../../components/Screen'
import { Button, FullScreenLoader, LoadError, Message, SelectField, TextField, focusRing } from '../../components/ui'
import { useCatalog } from '../../data/catalog'
import { useDateContext } from '../../data/context'
import { useDateSamples } from '../../data/dateSamples'
import { useHouses } from '../../data/house'
import { fetchInventory, inventoryKey, useInventory, useInventoryAction } from '../../data/inventory'
import { formatDate } from '../../domain/dates'
import type { InventoryData } from '../../domain/inventory'
import { learnedDate, type DateSample } from '../../domain/learnedDates'
import { formatQuantity } from '../../domain/quantity'
import {
  applyPayload,
  chainQueue,
  lineCounting,
  lineProblem,
  manualLine,
  moveDraftToHouse,
  removeLine,
  retargetLine,
  splitLine,
  updateLine,
  type DraftLine,
  type TicketDraft,
} from '../../domain/ticket'
import type { Json } from '../../lib/database.types'
import { errorKey as errorKeyOf } from '../../lib/errors'
import { useOffline } from '../../lib/connectivity'
import { supabase } from '../../lib/supabase'
import { ReadDateDialog } from '../../scan/ReadDateDialog'
import { LineSheet, ProductPickerSheet } from './LineSheet'
import { lineLabel, selectionToTarget } from './lineView'

interface TicketPreviewProps {
  draft: TicketDraft
  update: (change: (draft: TicketDraft) => TicketDraft) => void
  onFinished: () => void
}

function lineLearned(line: DraftLine, samples: readonly DateSample[], purchasedAt: string) {
  return line.target.type === 'product' ? learnedDate(samples, line.target.productId, purchasedAt) : null
}

interface LineCardProps {
  line: DraftLine
  house: InventoryData
  samples: readonly DateSample[]
  purchasedAt: string
  onToggle: (checked: boolean) => void
  onDate: (date: string, type: DraftLine['dateType']) => void
  onEdit: () => void
}

function LineCard({ line, house, samples, purchasedAt, onToggle, onDate, onEdit }: LineCardProps) {
  const { t } = useTranslation()
  const { language, tag, today } = useDateContext()
  const catalog = useCatalog()
  const { name, icon } = lineLabel(line.target, house.products, catalog.byId, language)
  const counting = lineCounting(line.target, house.products, catalog.byId)
  const problem = line.checked ? lineProblem(line, counting) : null
  const learned = line.checked && !line.printedDate ? lineLearned(line, samples, purchasedAt) : null
  const details = [formatQuantity(line.quantity, counting, t, tag), t(`zones.${line.zone}`), line.brand.trim()].filter(Boolean).join(' · ')

  return (
    <li className={`flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 ${line.checked ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={t('ticket.include', { name })}
          checked={line.checked}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-2 size-6 shrink-0 accent-[var(--brand)]"
        />
        <button type="button" onClick={onEdit} className={`flex min-w-0 flex-1 items-start gap-2 rounded-xl text-left ${focusRing}`}>
          <span aria-hidden="true" className="pt-1 text-2xl leading-none">
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{name}</span>
            <span className="block text-sm text-ink-muted">{details}</span>
            {line.rawText && <span className="block truncate text-xs text-ink-muted">{line.rawText}</span>}
            {line.fromAlias && <span className="block text-xs font-semibold text-brand">{t('ticket.fromAlias')}</span>}
            {line.target.type === 'new' && line.checked && <span className="block text-xs font-semibold text-ink-muted">{t('ticket.newProduct')}</span>}
          </span>
        </button>
        <button type="button" aria-label={t('ticket.editLine', { name })} onClick={onEdit} className={`flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted active:bg-line ${focusRing}`}>
          <PencilIcon />
        </button>
      </div>
      {line.checked && (
        <div className="pl-9">
          {line.printedDate ? (
            <p className="text-sm">
              {line.dateType === 'best_before'
                ? t('product.bestBeforeOn', { date: formatDate(line.printedDate, tag, today) })
                : line.dateType === 'expiry'
                  ? t('product.expiresOn', { date: formatDate(line.printedDate, tag, today) })
                  : formatDate(line.printedDate, tag, today)}
            </p>
          ) : learned ? (
            <LearnedDateChip learned={learned} date={line.printedDate} type={line.dateType} onChange={onDate} />
          ) : (
            <p className="text-sm text-ink-muted">{t('product.noDate')}</p>
          )}
        </div>
      )}
      {problem && (
        <div className="pl-9">
          <Message tone="error">{t(`ticket.problems.${problem}`)}</Message>
        </div>
      )}
    </li>
  )
}

/** Vista previa editable (SPEC §10.1, paso 4). Nada se añade hasta confirmar. */
export function TicketPreview({ draft, update, onFinished }: TicketPreviewProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { language, today } = useDateContext()
  const offline = useOffline()
  const houses = useHouses()
  const inventory = useInventory(draft.houseId)
  const catalog = useCatalog()
  const samples = useDateSamples(draft.houseId)
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [chain, setChain] = useState<{ key: string; name: string }[] | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [houseError, setHouseError] = useState<unknown>(null)

  if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
  if (inventory.isLoadingError) return <Screen title={t('ticket.title')} backTo="/" main={<LoadError onRetry={() => void inventory.refetch()} />} />

  const house = inventory.data
  const sampleRows = samples.data ?? []
  const checked = draft.lines.filter((line) => line.checked)
  const problems = checked.filter((line) => lineProblem(line, lineCounting(line.target, house.products, catalog.byId)))
  const queue = chainQueue(draft)
  const editingLine = draft.lines.find((line) => line.key === editing)
  const nameOf = (line: DraftLine) => lineLabel(line.target, house.products, catalog.byId, language).name

  async function changeHouse(houseId: string) {
    setHouseError(null)
    try {
      const target = await queryClient.fetchQuery({ queryKey: inventoryKey(houseId), queryFn: () => fetchInventory(houseId) })
      update((current) => moveDraftToHouse(current, houseId, house, target))
    } catch (error) {
      setHouseError(error)
    }
  }

  async function apply() {
    const done = await run('ticket', () =>
      supabase.rpc('apply_ticket', {
        p_house_id: draft.houseId,
        p_lines: applyPayload(draft) as unknown as Json,
        p_purchased_at: draft.purchasedAt,
        p_store: draft.store ?? undefined,
      }),
    )
    if (done) {
      onFinished()
      void navigate('/', { replace: true })
    }
  }

  return (
    <Screen
      title={t('ticket.title')}
      backTo="/"
      main={
        <div className="flex flex-col gap-4 pb-28">
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
            {houses.data && houses.data.length > 1 && (
              <SelectField label={t('ticket.house')} value={draft.houseId} disabled={pending} onChange={(event) => void changeHouse(event.target.value)}>
                {houses.data.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </SelectField>
            )}
            {Boolean(houseError) && <Message tone="error">{t(errorKeyOf(houseError))}</Message>}
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('ticket.store')} value={draft.store ?? ''} maxLength={80} autoComplete="off" onChange={(event) => update((current) => ({ ...current, store: event.target.value || null }))} />
              <TextField
                label={t('form.purchasedAt')}
                type="date"
                max={today}
                value={draft.purchasedAt}
                onChange={(event) => update((current) => ({ ...current, purchasedAt: event.target.value || today }))}
              />
            </div>
          </section>

          <p className="text-sm text-ink-muted">{t('ticket.reviewHint')}</p>

          {queue.length > 0 && (
            <Button
              variant="secondary"
              disabled={offline}
              onClick={() => setChain(draft.lines.filter((line) => queue.includes(line.key)).map((line) => ({ key: line.key, name: nameOf(line) })))}
            >
              {t('ticket.chain', { count: queue.length })}
            </Button>
          )}

          <ul className="flex flex-col gap-2">
            {draft.lines.map((line) => (
              <LineCard
                key={line.key}
                line={line}
                house={house}
                samples={sampleRows}
                purchasedAt={draft.purchasedAt}
                onToggle={(value) => update((current) => updateLine(current, line.key, { checked: value }))}
                onDate={(printedDate, dateType) => update((current) => updateLine(current, line.key, { printedDate, dateType }))}
                onEdit={() => setEditing(line.key)}
              />
            ))}
          </ul>

          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('ticket.addLine')}
          </Button>
          <button type="button" onClick={() => setDiscarding(true)} className={`min-h-11 self-center px-3 text-sm font-semibold text-danger ${focusRing}`}>
            {t('ticket.discard')}
          </button>

          <div className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas">
            <div className="mx-auto flex w-full max-w-xl flex-col gap-2 p-3">
              {problems.length > 0 && <Message tone="error">{t('ticket.fixProblems', { count: problems.length })}</Message>}
              {errorKey && <Message tone="error">{t(errorKey)}</Message>}
              <Button disabled={pending || checked.length === 0 || problems.length > 0} onClick={() => void apply()}>
                {t('ticket.apply', { count: checked.length })}
              </Button>
            </div>
          </div>

          {editingLine && (
            <LineSheet
              key={editingLine.key}
              line={editingLine}
              house={house}
              learned={lineLearned(editingLine, sampleRows, draft.purchasedAt)}
              onChange={(patch) => update((current) => updateLine(current, editingLine.key, patch))}
              onRetarget={(target) =>
                update((current) => {
                  const line = current.lines.find((row) => row.key === editingLine.key)
                  return line ? updateLine(current, line.key, retargetLine(line, target, house, catalog.byId)) : current
                })
              }
              onSplit={() => update((current) => splitLine(current, editingLine.key))}
              onRemove={() => {
                setEditing(null)
                update((current) => removeLine(current, editingLine.key))
              }}
              onClose={() => setEditing(null)}
            />
          )}

          {adding && (
            <ProductPickerSheet
              house={house}
              title={t('ticket.addLine')}
              onClose={() => setAdding(false)}
              onPick={(selection) => {
                const line = manualLine(selectionToTarget(selection, { type: 'new', name: '', category: 'other', quantityKind: 'count', unitLabel: 'unit', contentAmount: null, contentUnit: null, bulkUnit: null }, house.products, catalog.byId), house, catalog.byId)
                update((current) => ({ ...current, lines: [...current.lines, line] }))
                setAdding(false)
                setEditing(line.key)
              }}
            />
          )}

          {chain && (
            <ReadDateDialog
              chain
              targets={chain}
              onConfirm={(key, printedDate, dateType) => update((current) => updateLine(current, key, { printedDate, dateType }))}
              onClose={() => setChain(null)}
            />
          )}

          {discarding && (
            <ConfirmSheet
              title={t('ticket.discardTitle')}
              body={t('ticket.discardBody')}
              submit={t('ticket.discard')}
              pending={false}
              error={null}
              onConfirm={() => {
                onFinished()
                void navigate('/', { replace: true })
              }}
              onClose={() => setDiscarding(false)}
            />
          )}
        </div>
      }
    />
  )
}
