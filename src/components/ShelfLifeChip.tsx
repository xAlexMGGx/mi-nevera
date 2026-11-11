import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import review from '../content/conservation/review.json'
import { useShelfLifeGuide } from '../data/shelfLife'
import { findGuide, guidePeriod, suggestedReminder, type GuidedProduct, type GuideEntry, type ShelfState } from '../domain/shelfLife'
import { focusRing } from './ui'

/** "3–5 días", "3 semanas", "1 año". */
export function usePeriodText() {
  const { t } = useTranslation()
  return (entry: Pick<GuideEntry, 'min_days' | 'max_days'>) => {
    const period = guidePeriod(entry)
    if (!period) return null
    const range = period.min === period.max ? String(period.max) : `${period.min}–${period.max}`
    return t(`shelfLife.period.${period.unit}`, { count: period.max, range })
  }
}

interface ShelfLifeChipProps {
  product: GuidedProduct
  state: ShelfState
  /** Cuándo se abrió, congeló, descongeló o cocinó. */
  baseDate: string
  /** La fecha de aviso actual ('' si no hay). */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Chip orientativo (SPEC §7.3): un toque pone la fecha de aviso que propone la guía y otro la quita.
 * Sin tocarlo, no se rellena nada.
 */
export function ShelfLifeChip({ product, state, baseDate, value, onChange, disabled }: ShelfLifeChipProps) {
  const { t, i18n } = useTranslation()
  const guide = useShelfLifeGuide()
  const periodText = usePeriodText()
  const entry = guide.data ? findGuide(guide.data, product, state) : null
  if (!entry) return null

  const note = i18n.resolvedLanguage === 'en' ? entry.note_en : entry.note_es
  const suggestion = suggestedReminder(entry, baseDate)
  const pending = !review.reviewed && <span> {t('shelfLife.pending')}</span>
  const more = (
    <Link to="/conservation" className={`font-semibold text-brand ${focusRing}`}>
      {t('shelfLife.more')}
    </Link>
  )

  // La fuente desaconseja este estado, por ejemplo congelar huevos con cáscara.
  if (!suggestion) {
    return (
      <p className="rounded-xl bg-review-bg px-3 py-2 text-sm text-review">
        {note}.{pending} {more}
      </p>
    )
  }

  const selected = value === suggestion
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => onChange(selected ? '' : suggestion)}
        className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-opacity active:opacity-70 disabled:opacity-50 ${
          selected ? 'border-brand bg-brand text-on-brand' : 'border-brand bg-surface text-brand'
        } ${focusRing}`}
      >
        {t('shelfLife.chip', { period: periodText(entry) })}
      </button>
      <p className="text-xs text-ink-muted">
        {note}. {selected ? t('shelfLife.chipSelected') : t('shelfLife.chipHint')}
        {pending} {more}
      </p>
    </div>
  )
}
