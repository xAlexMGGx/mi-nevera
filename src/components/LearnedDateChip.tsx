import { useTranslation } from 'react-i18next'
import { useDateContext } from '../data/context'
import { formatDate } from '../domain/dates'
import type { LearnedDate } from '../domain/learnedDates'
import type { PrintedDateType } from '../domain/types'
import { focusRing } from './ui'

interface LearnedDateChipProps {
  learned: LearnedDate | null
  date: string
  type: PrintedDateType | null
  onChange: (date: string, type: PrintedDateType | null) => void
}

/**
 * "¿20 nov? (como sueles)" (SPEC §7.4). Un toque pone la fecha y su tipo; otro, los quita.
 * Sin tocarlo no se rellena nada.
 */
export function LearnedDateChip({ learned, date, type, onChange }: LearnedDateChipProps) {
  const { t } = useTranslation()
  const { tag, today } = useDateContext()
  if (!learned) return null

  const selected = date === learned.date && type === learned.type
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => (selected ? onChange('', null) : onChange(learned.date, learned.type))}
        className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-opacity active:opacity-70 ${
          selected ? 'border-brand bg-brand text-on-brand' : 'border-brand bg-surface text-brand'
        } ${focusRing}`}
      >
        {t('learned.chip', { date: formatDate(learned.date, tag, today) })}
      </button>
      <p className="text-xs text-ink-muted">
        {t(`learned.hint.${learned.type}`, { count: learned.samples })} {selected ? t('learned.selected') : t('learned.tap')}
      </p>
    </div>
  )
}
