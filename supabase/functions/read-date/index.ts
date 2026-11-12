// Leer la fecha de un envase (SPEC §10.2). La llama la app con la sesión de quien hace la foto.
// La foto se envía a Claude y no se guarda. La app enseña la fecha leída y siempre se confirma.

import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.7.0/helpers/zod'
import { withSupabase } from 'npm:@supabase/server@1'
import { claudeErrorResponse, claudeFromEnv, errorResponse, structuredText } from '../_shared/claude.ts'
import { checkImage } from '../_shared/image.ts'
import { dateModelSchema, dateSystemPrompt, parseDateOutput, toDateResult } from '../_shared/readDate.ts'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const claude = claudeFromEnv()
    if (!claude) return errorResponse('ai_not_configured', 503)

    const body = await req.json().catch(() => null)
    // "Hoy" sirve para suponer el año cuando el envase no lo trae.
    const today = typeof body?.today === 'string' && isoDate.test(body.today) ? body.today : null
    if (!today) return errorResponse('invalid_input', 400)

    const image = checkImage(body.image, body.media_type)
    if (image === 'image_too_large') return errorResponse('image_too_large', 413)
    if (image === 'invalid_input') return errorResponse('invalid_input', 400)

    const quota = await ctx.supabase.rpc('claim_ai_use', { p_kind: 'date' })
    if (quota.error) return Response.json({ error: quota.error.message }, { status: 500 })
    if (!quota.data) return errorResponse('ai_quota', 429)

    let message
    try {
      message = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 4000,
        system: dateSystemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
              { type: 'text', text: 'Read the expiry or best-before date in the photo.' },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(dateModelSchema) },
      })
    } catch (error) {
      return claudeErrorResponse(error)
    }

    const output = structuredText(message)
    const parsed = output === null ? null : parseDateOutput(output)
    if (!parsed) return errorResponse('ai_unreadable', 422)

    return Response.json(toDateResult(parsed, today))
  }),
}
