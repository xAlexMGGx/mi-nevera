const codes = [
  'not_member',
  'not_owner',
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
  'incompatible_product',
  'invalid_invite',
  'already_member',
  // Lecturas con IA (Edge Functions parse-receipt y read-date).
  'ai_not_configured',
  'ai_no_credit',
  'ai_quota',
  'ai_unavailable',
  'ai_unreadable',
  'image_too_large',
  // La foto no se ha podido abrir en el móvil (src/lib/image.ts).
  'image_unreadable',
] as const

type Code = (typeof codes)[number]
export type ErrorKey = `errors.${Code | 'network' | 'unknown'}`

/** Las funciones de la base de datos usan como mensaje de error un código que se traduce aquí. */
export function errorKey(error: unknown): ErrorKey {
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  if ((codes as readonly string[]).includes(message)) return `errors.${message as Code}`
  if (/failed to fetch|load failed|networkerror|network request failed|failed to send a request/i.test(message)) return 'errors.network'
  return 'errors.unknown'
}
