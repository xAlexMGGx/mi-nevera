// Fechas aprendidas (SPEC §7.4): estadística simple con lo que la casa ha comprado antes, sin IA.

import { addDays } from './dates'
import type { PrintedDateType } from './types'

export interface DateSample {
  product_id: string
  days_to_printed_date: number
  printed_date_type: PrintedDateType
  created_at: string
}

export interface LearnedDate {
  date: string
  type: PrintedDateType
  /** Cuántas compras respaldan la sugerencia. */
  samples: number
}

export const minSamples = 3
/** Los hábitos cambian (otra marca, otra tienda): cuentan las últimas compras. */
const recentSamples = 10

/** Mediana redondeada hacia abajo: ante la duda, la fecha más temprana. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.floor((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/**
 * Con ≥ 3 compras del mismo tipo de fecha, sugiere el día de compra + la mediana de días.
 * Si los dos tipos tienen bastantes, el que más se repite; a igualdad, caducidad, que es el más prudente.
 */
export function learnedDate(samples: readonly DateSample[], productId: string, purchasedAt: string): LearnedDate | null {
  const options = (['expiry', 'best_before'] as const).flatMap((type) => {
    const days = samples
      .filter((sample) => sample.product_id === productId && sample.printed_date_type === type && sample.days_to_printed_date >= 0)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, recentSamples)
      .map((sample) => sample.days_to_printed_date)
    return days.length >= minSamples ? [{ type, days }] : []
  })
  const best = options.sort((a, b) => b.days.length - a.days.length)[0]
  if (!best) return null
  return { date: addDays(purchasedAt, median(best.days)), type: best.type, samples: best.days.length }
}
