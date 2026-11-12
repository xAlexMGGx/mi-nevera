import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearnedDate } from '../domain/learnedDates'
import type { PrintedDateType } from '../domain/types'
import { useOffline } from '../lib/connectivity'
import { ReadDateDialog } from '../scan/ReadDateDialog'
import { LearnedDateChip } from './LearnedDateChip'
import { PrintedDateFields } from './PrintedDateFields'
import { Button } from './ui'

interface DateEntryProps {
  /** Para quien lee la fecha con la cámara: "Leche semidesnatada". */
  name: string
  date: string
  type: PrintedDateType | null
  onChange: (date: string, type: PrintedDateType | null) => void
  /** Fecha aprendida (SPEC §7.4), en el alta manual y en el ticket. */
  learned?: LearnedDate | null
}

/** Fecha impresa: a mano, con el chip aprendido o leída con la cámara (SPEC §6.3 y §10.2). */
export function DateEntry({ name, date, type, onChange, learned = null }: DateEntryProps) {
  const { t } = useTranslation()
  const offline = useOffline()
  const [reading, setReading] = useState(false)

  return (
    <>
      <PrintedDateFields date={date} type={type} onDateChange={(next) => onChange(next, type)} onTypeChange={(next) => onChange(date, next)} />
      <LearnedDateChip learned={learned} date={date} type={type} onChange={onChange} />
      <Button variant="secondary" disabled={offline} onClick={() => setReading(true)}>
        {t('readDate.open')}
      </Button>
      {reading && (
        <ReadDateDialog
          targets={[{ key: 'date', name }]}
          onConfirm={(_key, nextDate, nextType) => onChange(nextDate, nextType)}
          onClose={() => setReading(false)}
        />
      )}
    </>
  )
}
