import { useTranslation } from 'react-i18next'
import type { PrintedDateType } from '../domain/types'
import { Segmented, TextField } from './ui'

interface PrintedDateFieldsProps {
  date: string
  type: PrintedDateType | null
  onDateChange: (date: string) => void
  onTypeChange: (type: PrintedDateType) => void
}

/** Fecha impresa y su tipo. Nada viene rellenado (SPEC, principio 2). */
export function PrintedDateFields({ date, type, onDateChange, onTypeChange }: PrintedDateFieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <TextField
        label={t('form.printedDate')}
        type="date"
        value={date}
        onChange={(event) => onDateChange(event.target.value)}
      />
      {date && (
        <Segmented
          label={t('form.dateType')}
          options={[
            { value: 'expiry', label: t('dateTypes.expiry') },
            { value: 'best_before', label: t('dateTypes.best_before') },
          ]}
          value={type}
          onChange={onTypeChange}
        />
      )}
    </>
  )
}
