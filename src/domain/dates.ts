// Las fechas se manejan como texto ISO (AAAA-MM-DD), como las devuelve la base de datos.

const fallbackTimeZone = 'Europe/Madrid'

/** La fecha de hoy en una zona horaria. */
export function todayIn(timeZone: string, now = new Date()): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  try {
    return format(timeZone)
  } catch {
    return format(fallbackTimeZone)
  }
}

function toUtc(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

// La comparte con la notificación diaria.
export { addDays } from '../../supabase/functions/_shared/dateStatus.ts'

/** Días entre dos fechas ISO: positivo si `to` es posterior. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

/** "1 oct", y con el año si no es el actual: "1 oct 2028". */
export function formatDate(iso: string, localeTag: string, today: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
  }).format(toUtc(iso))
}

/** "20 de noviembre de 2026", para confirmar una fecha leída. */
export function formatFullDate(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(toUtc(iso))
}

/** "01/11" (SPEC: dd/mm). */
export function formatDayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** "lunes, 9 de noviembre" */
export function formatLongDay(iso: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(toUtc(iso))
}

/** "14:05" */
export function formatTime(timestamp: string, localeTag: string, timeZone: string): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}
