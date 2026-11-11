// Estado y color de una fecha (SPEC §7.2). Es la única implementación: la usan la app
// (src/domain/status.ts la reexporta) y la notificación diaria. Sin dependencias, para que funcione
// igual en el navegador y en Deno.
//
// La fecha efectiva la calcula la base de datos; el estado se calcula aquí porque depende del día de
// hoy de cada persona y la app debe acertarlo también sin conexión.

/** Fechas como texto ISO (AAAA-MM-DD), como las devuelve la base de datos. */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type DateBasis = 'expiry' | 'best_before' | 'reminder'

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

export const severity: Record<Status, number> = { expired: 0, review: 1, soon: 2, ok: 3 }

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
