import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDateContext } from '../data/context'
import { fitQuantity, unitChoiceOf, withContent, withUnitChoice, type CountingSpec, type UnitChoice } from '../domain/lotDraft'
import { formatForInput, formatNumber, parseAmount, unitName } from '../domain/quantity'
import { bulkUnits, contentUnits, unitLabels, type ContentUnit } from '../domain/types'
import { MinusIcon, PlusIcon } from './icons'
import { focusRing } from './ui'

const field = `min-h-12 min-w-0 appearance-none rounded-xl border border-line bg-surface px-3 text-base text-ink ${focusRing}`
const stepButton = `flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink active:opacity-70 disabled:opacity-40 ${focusRing}`

interface QuantityUnitFieldProps {
  quantity: number
  counting: CountingSpec
  /** Un producto de la casa ya tiene su forma de contar: se enseña, pero no se cambia aquí. */
  locked: boolean
  onQuantity: (quantity: number) => void
  onCounting: (counting: CountingSpec) => void
}

/** "Cantidad: 6 [bricks ▾] · cada brick contiene 1 l". Igual a mano, por código y en el ticket. */
export function QuantityUnitField({ quantity, counting, locked, onQuantity, onCounting }: QuantityUnitFieldProps) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const id = useId()
  const bulk = counting.quantityKind === 'bulk'
  const [amountText, setAmountText] = useState(bulk ? formatForInput(quantity, tag) : '')
  const [contentText, setContentText] = useState(counting.contentAmount ? formatForInput(counting.contentAmount, tag) : '')
  // Se recuerda aunque aún no haya cantidad escrita.
  const [contentUnit, setContentUnit] = useState<ContentUnit>(counting.contentUnit ?? 'ml')
  const unit = unitName(counting.unitLabel, Math.max(1, quantity), t)

  function chooseUnit(choice: UnitChoice) {
    const next = withUnitChoice(counting, choice)
    onCounting(next)
    if (next.quantityKind === 'bulk') setAmountText(formatForInput(quantity, tag))
    else onQuantity(fitQuantity(quantity, next))
  }

  const lockedText = bulk
    ? t(`contentUnits.${counting.bulkUnit ?? 'kg'}`)
    : counting.quantityKind === 'divisible' && counting.contentAmount && counting.contentUnit
      ? t('form.containerOf', { unit, amount: formatNumber(counting.contentAmount, tag), measure: t(`contentUnits.${counting.contentUnit}`) })
      : unit

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t('form.quantity')}
      </label>
      <div className="flex items-center gap-2">
        {bulk ? (
          <input
            id={id}
            inputMode="decimal"
            value={amountText}
            onChange={(event) => {
              setAmountText(event.target.value)
              onQuantity(parseAmount(event.target.value) ?? 0)
            }}
            className={`${field} w-28 shrink-0`}
          />
        ) : (
          <>
            <button type="button" aria-label={t('common.decrease')} disabled={quantity <= 1} onClick={() => onQuantity(Math.max(1, quantity - 1))} className={stepButton}>
              <MinusIcon />
            </button>
            <input
              id={id}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                onQuantity(Number.isNaN(parsed) ? 1 : Math.max(1, parsed))
              }}
              className={`${field} w-16 shrink-0 text-center font-semibold`}
            />
            <button type="button" aria-label={t('common.increase')} onClick={() => onQuantity(quantity + 1)} className={stepButton}>
              <PlusIcon />
            </button>
          </>
        )}
        {locked ? (
          <span className="flex min-h-12 min-w-0 flex-1 items-center rounded-xl bg-canvas px-3 text-ink-muted">{lockedText}</span>
        ) : (
          <select aria-label={t('form.unit')} value={unitChoiceOf(counting)} onChange={(event) => chooseUnit(event.target.value as UnitChoice)} className={`${field} flex-1`}>
            <optgroup label={t('form.byUnits')}>
              {unitLabels
                .filter((value) => value !== 'serving')
                .map((value) => (
                  <option key={value} value={`unit:${value}`}>
                    {unitName(value, Math.max(1, Math.round(quantity)), t)}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t('form.byWeight')}>
              {bulkUnits.map((value) => (
                <option key={value} value={`bulk:${value}`}>
                  {t(`contentUnits.${value}`)}
                </option>
              ))}
            </optgroup>
          </select>
        )}
      </div>

      {!locked && !bulk && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">{t('form.eachContains', { unit: unitName(counting.unitLabel, 1, t) })}</span>
            <input
              inputMode="decimal"
              aria-label={t('form.contentAmount')}
              placeholder="—"
              value={contentText}
              onChange={(event) => {
                setContentText(event.target.value)
                onCounting(withContent(counting, parseAmount(event.target.value), contentUnit))
              }}
              className={`${field} w-20 shrink-0 text-center`}
            />
            <select
              aria-label={t('form.contentUnit')}
              value={contentUnit}
              onChange={(event) => {
                const next = event.target.value as ContentUnit
                setContentUnit(next)
                onCounting(withContent(counting, parseAmount(contentText), next))
              }}
              className={`${field} w-20 shrink-0`}
            >
              {contentUnits.map((value) => (
                <option key={value} value={value}>
                  {t(`contentUnits.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-ink-muted">{t('form.eachContainsHint')}</p>
        </div>
      )}
    </div>
  )
}
