// Leer un ticket (SPEC §10.1). La llama la app con la sesión de quien escanea: las reglas de acceso
// de la base de datos solo le dejan leer los productos y los alias de sus casas.
// La foto se envía a Claude y no se guarda. La app muestra el resultado para revisarlo antes de aplicar.

import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.7.0/helpers/zod'
import { withSupabase } from 'npm:@supabase/server@1'
import { claudeErrorResponse, claudeFromEnv, errorResponse, structuredText } from '../_shared/claude.ts'
import { checkImage, maxReceiptPhotos, type CheckedImage } from '../_shared/image.ts'
import {
  parseReceiptOutput,
  receiptModelSchema,
  receiptRawTexts,
  receiptSystemPrompt,
  receiptUserText,
  toReceiptResult,
  type AliasEntry,
  type AliasMatch,
  type CatalogEntry,
  type HouseProduct,
} from '../_shared/receipt.ts'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const claude = claudeFromEnv()
    if (!claude) return errorResponse('ai_not_configured', 503)

    const body = await req.json().catch(() => null)
    const houseId = typeof body?.house_id === 'string' ? body.house_id : null
    // "Hoy" es el de quien escanea, en su zona horaria.
    const today = typeof body?.today === 'string' && isoDate.test(body.today) ? body.today : null
    if (!houseId || !today) return errorResponse('invalid_input', 400)

    // Una foto o, si el ticket es largo, varias partes en orden.
    const photos: unknown[] = Array.isArray(body.images) ? body.images : []
    if (photos.length === 0 || photos.length > maxReceiptPhotos) return errorResponse('invalid_input', 400)
    const images: CheckedImage[] = []
    for (const photo of photos) {
      const image = checkImage((photo as { image?: unknown })?.image, (photo as { media_type?: unknown })?.media_type)
      if (image === 'image_too_large') return errorResponse('image_too_large', 413)
      if (image === 'invalid_input') return errorResponse('invalid_input', 400)
      images.push(image)
    }

    const house = await ctx.supabase.from('houses').select('id').eq('id', houseId).maybeSingle()
    if (house.error) return Response.json({ error: house.error.message }, { status: 500 })
    if (!house.data) return errorResponse('not_member', 403)

    const [catalog, products, aliases, profile] = await Promise.all([
      ctx.supabase
        .from('catalog_items')
        .select('id, slug, name_es, name_en, category, default_quantity_kind, default_unit_label, default_content_amount, default_content_unit')
        .order('slug'),
      ctx.supabase
        .from('products')
        .select('id, name, catalog_item_id, quantity_kind, unit_label, content_amount, content_unit, bulk_unit')
        .eq('house_id', houseId)
        .eq('kind', 'food')
        .order('name')
        .limit(300),
      ctx.supabase
        .from('ticket_aliases')
        .select('raw_text_normalized, product_id, brand')
        .eq('house_id', houseId)
        .order('updated_at', { ascending: false })
        .limit(300),
      ctx.supabase.from('profiles').select('locale').maybeSingle(),
    ])
    const loadError = catalog.error ?? products.error ?? aliases.error ?? profile.error
    if (loadError) return Response.json({ error: loadError.message }, { status: 500 })

    const quota = await ctx.supabase.rpc('claim_ai_use', { p_kind: 'receipt' })
    if (quota.error) return Response.json({ error: quota.error.message }, { status: 500 })
    if (!quota.data) return errorResponse('ai_quota', 429)

    const houseProducts = (products.data ?? []) as HouseProduct[]
    const catalogItems = (catalog.data ?? []) as CatalogEntry[]
    const { text, refs } = receiptUserText({
      locale: profile.data?.locale ?? 'es',
      today,
      products: houseProducts,
      aliases: (aliases.data ?? []) as AliasEntry[],
      photos: images.length,
    })

    let message
    try {
      message = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 16000,
        system: receiptSystemPrompt(catalogItems),
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.media_type, data: image.data } })),
              { type: 'text', text },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(receiptModelSchema) },
      })
    } catch (error) {
      return claudeErrorResponse(error)
    }

    const output = structuredText(message)
    const parsed = output === null ? null : parseReceiptOutput(output)
    if (!parsed) return errorResponse('ai_unreadable', 422)

    // Lo aprendido de tickets anteriores manda sobre lo que proponga el modelo.
    const rawTexts = receiptRawTexts(parsed)
    let aliasMatches: AliasMatch[] = []
    if (rawTexts.length > 0) {
      const matches = await ctx.supabase.rpc('match_ticket_lines', { p_house_id: houseId, p_raw_texts: rawTexts })
      if (matches.error) return Response.json({ error: matches.error.message }, { status: 500 })
      aliasMatches = (matches.data ?? []) as AliasMatch[]
    }

    return Response.json(toReceiptResult(parsed, { today, refs, products: houseProducts, catalog: catalogItems, aliasMatches }))
  }),
}
