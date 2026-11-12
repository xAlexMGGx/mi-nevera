// Llamadas a Claude desde las Edge Functions (SPEC §3: la clave y el modelo solo viven aquí, como
// secretos de Supabase). Solo para Deno.

import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'

/** Los códigos que traduce la app (src/lib/errors.ts). */
export type FunctionErrorCode =
  | 'ai_not_configured'
  | 'ai_no_credit'
  | 'ai_quota'
  | 'ai_unavailable'
  | 'ai_unreadable'
  | 'image_too_large'
  | 'invalid_input'
  | 'not_member'

export function errorResponse(code: FunctionErrorCode, status: number): Response {
  return Response.json({ error: code }, { status })
}

/** Sin clave o sin modelo, las lecturas con IA están desactivadas. */
export function claudeFromEnv(): { client: Anthropic; model: string } | null {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const model = Deno.env.get('ANTHROPIC_MODEL')
  if (!apiKey || !model) return null
  // Una Edge Function puede durar unos 150 s: un reintento cabe si el primer fallo es rápido.
  return { client: new Anthropic({ apiKey, timeout: 110_000, maxRetries: 1 }), model }
}

/** El JSON de una respuesta con formato estructurado, o null si el modelo no la terminó. */
export function structuredText(message: Anthropic.Message): string | null {
  // Con refusal o max_tokens la respuesta puede no seguir el formato pedido.
  if (message.stop_reason !== 'end_turn') {
    console.warn('respuesta incompleta', message.stop_reason)
    return null
  }
  const block = message.content.find((item) => item.type === 'text')
  return block?.type === 'text' ? block.text : null
}

export function claudeErrorResponse(error: unknown): Response {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.NotFoundError) {
    // Clave no válida o nombre de modelo que no existe: hay que revisar los secretos.
    console.error('configuración de Claude', error.status, error.message)
    return errorResponse('ai_not_configured', 503)
  }
  if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
    // La cuenta de Anthropic se ha quedado sin crédito: no es culpa de la foto.
    console.error('sin crédito en Anthropic')
    return errorResponse('ai_no_credit', 503)
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Por ejemplo, una imagen que la API no acepta.
    console.error('petición rechazada', error.message)
    return errorResponse('ai_unreadable', 422)
  }
  if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
    console.error('Claude no disponible', error.message)
    return errorResponse('ai_unavailable', 503)
  }
  throw error
}
