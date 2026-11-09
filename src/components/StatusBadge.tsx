import { useTranslation } from 'react-i18next'
import { useDateContext } from '../data/context'
import { formatDate } from '../domain/dates'
import type { RowDate, Status } from '../domain/status'

const looks: Record<Status, string> = {
  expired: 'bg-expired-bg text-expired',
  review: 'bg-review-bg text-review',
  soon: 'bg-soon-bg text-soon',
  ok: 'text-ink-muted',
}

export function statusBadgeClass(status: Status) {
  return `inline-block rounded-full text-xs font-semibold whitespace-nowrap ${status === 'ok' ? '' : 'px-2 py-0.5'} ${looks[status]}`
}

/** El color nunca va solo: el estado también se dice con palabras. */
export function StatusBadge({ rowDate }: { rowDate: RowDate }) {
  const { t } = useTranslation()
  const { tag, today } = useDateContext()
  const date = formatDate(rowDate.date!, tag, today)

  return (
    <span className={statusBadgeClass(rowDate.status)}>
      {rowDate.status === 'ok' ? date : `${t(`status.${rowDate.status}`)} · ${date}`}
    </span>
  )
}
