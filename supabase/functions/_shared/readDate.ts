// Leer la fecha de un envase con la cámara (SPEC §10.2): qué se le pide al modelo y cómo se valida.
// La fecha la compone el código, no el modelo: así "solo mes y año" siempre es el último día del mes.

import { z } from 'zod'
import { addDays } from './dateStatus.ts'
import { printedDateTypes, type PrintedDateType } from './vocabulary.ts'

export const dateModelSchema = z.object({
  year: z.number().nullable(),
  month: z.number().nullable(),
  day: z.number().nullable(),
  date_type: z.enum(printedDateTypes).nullable(),
  raw_text: z.string(),
  confidence: z.enum(['high', 'low']),
})

export type DateModelOutput = z.infer<typeof dateModelSchema>

export interface DateResult {
  date: string | null
  date_type: PrintedDateType | null
  raw_text: string
  confidence: 'high' | 'low'
  /** Solo mes y año: se usa el último día del mes (habitual en conservas). */
  month_only: boolean
  /** El envase no trae año y se ha supuesto el más probable. */
  year_assumed: boolean
}

export const dateSystemPrompt = `You read the date printed on food packaging from a photo, for a household food-inventory app in Spain. People confirm or correct what you return before it is saved.

Return:
- year, month, day: the printed expiry or best-before date. Write the full year ("26" is 2026). If the package shows only month and year, as is common on cans, day is null. If there is no year, year is null. If you cannot read a date, year, month and day are all null.
- date_type: "expiry" if the text marks a use-by date, for example "fecha de caducidad", "consumir antes del", "cad." or "use by"; "best_before" if it marks a best-before date, for example "consumir preferentemente antes del", "cons. pref.", "best before" or "BBE"; null if there is no such text or you cannot tell.
- raw_text: the printed text around the date, exactly as it appears, for example "Cons. pref. antes de: 12/2027 L2304".
- confidence: "high" only if every digit is clearly legible and the reading is unambiguous; otherwise "low".

Rules:
- Ignore lot numbers ("L", "LOTE"), times, prices, weights and packaging or production dates ("envasado", "fabricado", "fecha de envasado"). If the only date is a packaging or production date, return null for year, month and day and say so in raw_text.
- Spanish packaging writes day/month/year. If the order is unclear, read it as day/month/year and set confidence to "low".
- Never guess digits you cannot see.`

/** El texto de la respuesta, validado. Null si no es JSON o no tiene la forma pedida. */
export function parseDateOutput(text: string): DateModelOutput | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw && typeof raw === 'object') {
    const copy = { ...(raw as Record<string, unknown>) }
    for (const field of ['date_type', 'confidence']) if (typeof copy[field] === 'string') copy[field] = (copy[field] as string).toLowerCase()
    raw = copy
  }
  const parsed = dateModelSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isWhole(value: number | null): value is number {
  return value !== null && Number.isInteger(value)
}

/** Las fechas sin año suelen ser de productos frescos: la próxima vez que llegue ese día, o hace poco. */
const recentlyExpiredDays = 7

export function toDateResult(output: DateModelOutput, today: string): DateResult {
  const base = {
    date_type: output.date_type,
    raw_text: output.raw_text.replace(/\s+/g, ' ').trim().slice(0, 200),
    month_only: false,
    year_assumed: false,
  }
  const unreadable: DateResult = { ...base, date: null, confidence: 'low' }

  const { month, day } = output
  if (!isWhole(month) || month < 1 || month > 12) return unreadable
  if (day !== null && (!isWhole(day) || day < 1)) return unreadable

  let year = output.year
  let yearAssumed = false
  if (year === null) {
    if (day === null) return unreadable
    const thisYear = Number(today.slice(0, 4))
    const candidate = `${thisYear}-${pad(month)}-${pad(day)}`
    year = candidate >= addDays(today, -recentlyExpiredDays) ? thisYear : thisYear + 1
    yearAssumed = true
  }
  if (!isWhole(year)) return unreadable
  if (year < 100) year += 2000
  if (year < 2000 || year > 2100) return unreadable

  const lastDay = daysInMonth(year, month)
  if (day !== null && day > lastDay) return unreadable

  return {
    ...base,
    date: `${year}-${pad(month)}-${pad(day ?? lastDay)}`,
    confidence: yearAssumed ? 'low' : output.confidence,
    month_only: day === null,
    year_assumed: yearAssumed,
  }
}
