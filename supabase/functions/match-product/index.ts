// Identificar un producto escaneado (SPEC §11). La llama la app con la sesión de quien escanea, solo
// la primera vez que la casa ve ese código: después, el código ya lleva a su producto.
// Recibe lo que dice Open Food Facts (en cualquier idioma) y devuelve con qué producto de la casa o
// del catálogo se corresponde, o cómo crearlo. La app lo enseña para confirmarlo o cambiarlo.

import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.7.0/helpers/zod'
import { withSupabase } from 'npm:@supabase/server@1'
import { claudeErrorResponse, claudeFromEnv, errorResponse, structuredText } from '../_shared/claude.ts'
import { cleanDescription, parseProductOutput, productModelSchema, productTask, productUserText, toProductProposal } from '../_shared/productMatch.ts'
import { catalogPrompt, type CatalogEntry, type HouseProduct } from '../_shared/receipt.ts'

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const claude = claudeFromEnv()
    if (!claude) return errorResponse('ai_not_configured', 503)

    const body = await req.json().catch(() => null)
    const houseId = typeof body?.house_id === 'string' ? body.house_id : null
    const description = cleanDescription(body?.product)
    if (!houseId || !description) return errorResponse('invalid_input', 400)

    const house = await ctx.supabase.from('houses').select('id').eq('id', houseId).maybeSingle()
    if (house.error) return Response.json({ error: house.error.message }, { status: 500 })
    if (!house.data) return errorResponse('not_member', 403)

    const [catalog, products, profile] = await Promise.all([
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
      ctx.supabase.from('profiles').select('locale').maybeSingle(),
    ])
    const loadError = catalog.error ?? products.error ?? profile.error
    if (loadError) return Response.json({ error: loadError.message }, { status: 500 })

    const quota = await ctx.supabase.rpc('claim_ai_use', { p_kind: 'product' })
    if (quota.error) return Response.json({ error: quota.error.message }, { status: 500 })
    if (!quota.data) return errorResponse('ai_quota', 429)

    const houseProducts = (products.data ?? []) as HouseProduct[]
    const catalogItems = (catalog.data ?? []) as CatalogEntry[]
    const { text, refs } = productUserText({ locale: profile.data?.locale ?? 'es', products: houseProducts, description })

    let message
    try {
      message = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 4000,
        system: [
          // Igual en cada petición: al escanear varios productos seguidos, se lee de la caché.
          { type: 'text', text: catalogPrompt(catalogItems), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: productTask },
        ],
        messages: [{ role: 'user', content: text }],
        output_config: { format: zodOutputFormat(productModelSchema) },
      })
    } catch (error) {
      return claudeErrorResponse(error)
    }

    const output = structuredText(message)
    const parsed = output === null ? null : parseProductOutput(output)
    if (!parsed) return errorResponse('ai_unreadable', 422)

    return Response.json(toProductProposal(parsed, { refs, products: houseProducts, catalog: catalogItems, description }))
  }),
}
