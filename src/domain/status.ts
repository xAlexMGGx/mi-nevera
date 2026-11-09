import { addDays } from './dates'
import type { DateBasis } from './types'

// Estado y color (SPEC §7.2). La fecha efectiva la calcula la base de datos; el estado se
// calcula aquí porque depende del día de hoy y debe seguir siendo correcto sin conexión.

export type Status = 'expired' | 'review' | 'soon' | 'ok'

export interface DatedItem {
  date: string | null
  basis: DateBasis | null
}

export function statusOf({ date, basis }: DatedItem, today: string, daysAhead: number): Status {
  if (!date) return 'ok'
  if (date < today) return basis === 'best_before' ? 'review' : 'expired'
  return date <= addDays(today, daysAhead) ? 'soon' : 'ok'
}

const severity: Record<Status, number> = { expired: 0, review: 1, soon: 2, ok: 3 }

export interface RowDate extends DatedItem {
  status: Status
}

/** La fecha que representa a varios lotes: la del estado más grave y, a igual estado, la más próxima. */
export function mostUrgent(items: DatedItem[], today: string, daysAhead: number): RowDate | null {
  let best: RowDate | null = null
  for (const item of items) {
    if (!item.date) continue
    const candidate = { ...item, status: statusOf(item, today, daysAhead) }
    if (
      !best ||
      severity[candidate.status] < severity[best.status] ||
      (severity[candidate.status] === severity[best.status] && candidate.date! < best.date!)
    ) {
      best = candidate
    }
  }
  return best
}
