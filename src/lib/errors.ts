const codes = [
  'not_member',
  'not_found',
  'invalid_amount',
  'invalid_input',
  'nothing_to_consume',
  'nothing_to_open',
  'same_zone',
  'container_number_taken',
  'undo_expired',
  'undo_conflict',
  'product_name_taken',
  'product_has_stock',
] as const

type Code = (typeof codes)[number]
export type ErrorKey = `errors.${Code | 'network' | 'unknown'}`

/** Las funciones de la base de datos usan como mensaje de error un código que se traduce aquí. */
export function errorKey(error: unknown): ErrorKey {
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  if ((codes as readonly string[]).includes(message)) return `errors.${message as Code}`
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(message)) return 'errors.network'
  return 'errors.unknown'
}
