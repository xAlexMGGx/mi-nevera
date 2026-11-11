import { addDays } from './dates'
import type { Category } from './types'

// Chips orientativos (SPEC §7.3): proponen una fecha de aviso, pero nunca la ponen solos.

export type ShelfState = 'opened' | 'frozen' | 'thawed' | 'cooked'

export interface GuideEntry {
  catalog_item_id: string | null
  category: Category | null
  state: ShelfState | 'closed_fridge' | 'closed_pantry'
  /** Sin días: la fuente desaconseja ese estado, por ejemplo congelar huevos con cáscara. */
  min_days: number | null
  max_days: number | null
  note_es: string
  note_en: string
  source: string
}

export interface GuidedProduct {
  catalog_item_id: string | null
  category: Category
}

/**
 * Los productos del catálogo usan sus propias filas: lo que vale para "Pescado" no siempre vale para
 * cada pescado. Los productos propios y los tápers usan las de su categoría.
 */
export function findGuide(entries: readonly GuideEntry[], product: GuidedProduct, state: ShelfState): GuideEntry | null {
  const match = product.catalog_item_id
    ? entries.find((entry) => entry.catalog_item_id === product.catalog_item_id && entry.state === state)
    : entries.find((entry) => entry.category === product.category && entry.state === state)
  return match ?? null
}

/** La fecha que propone el chip: el plazo más largo, contado desde que se abrió, congeló, etc. */
export function suggestedReminder(entry: GuideEntry, baseDate: string): string | null {
  return entry.max_days === null ? null : addDays(baseDate, entry.max_days)
}

export type PeriodUnit = 'days' | 'weeks' | 'months' | 'years'

export interface Period {
  min: number
  max: number
  unit: PeriodUnit
}

/** En la unidad en que lo dan las fuentes: "3–5 días", "3 semanas", "2–3 meses", "1 año". */
export function guidePeriod(entry: Pick<GuideEntry, 'min_days' | 'max_days'>): Period | null {
  const { min_days: min, max_days: max } = entry
  if (min === null || max === null) return null
  if (min % 360 === 0 && max % 360 === 0) return { min: min / 360, max: max / 360, unit: 'years' }
  if (max >= 30 && min % 30 === 0 && max % 30 === 0) return { min: min / 30, max: max / 30, unit: 'months' }
  if (max >= 14 && min % 7 === 0 && max % 7 === 0) return { min: min / 7, max: max / 7, unit: 'weeks' }
  return { min, max, unit: 'days' }
}
