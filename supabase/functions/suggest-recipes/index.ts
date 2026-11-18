// Sugerir recetas (SPEC §14). La llama la app con la sesión de quien pide: las reglas de acceso de
// la base de datos solo le dejan leer el inventario de sus casas y sus propios favoritos.
// Devuelve 3 recetas con los ingredientes emparejados con los productos de la casa. No guarda nada.

import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.7.0/helpers/zod'
import { withSupabase } from 'npm:@supabase/server@1'
import { claudeErrorResponse, claudeFromEnv, errorResponse, structuredText } from '../_shared/claude.ts'
import {
  cleanRecipeRequest,
  parseRecipeOutput,
  recipeModelSchema,
  recipeTask,
  recipeUserText,
  summarizeStock,
  toRecipeResult,
  type StockLotRow,
  type StockProductRow,
  type StockUnitRow,
} from '../_shared/recipes.ts'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const claude = claudeFromEnv()
    if (!claude) return errorResponse('ai_not_configured', 503)

    const body = await req.json().catch(() => null)
    const houseId = typeof body?.house_id === 'string' ? body.house_id : null
    // "Hoy" es el de quien pide, en su zona horaria.
    const today = typeof body?.today === 'string' && isoDate.test(body.today) ? body.today : null
    const request = cleanRecipeRequest(body?.request)
    if (!houseId || !today || !request) return errorResponse('invalid_input', 400)

    const house = await ctx.supabase.from('houses').select('id').eq('id', houseId).maybeSingle()
    if (house.error) return Response.json({ error: house.error.message }, { status: 500 })
    if (!house.data) return errorResponse('not_member', 403)

    const [products, lots, units, zones, catalog, profile, favorites, blocked] = await Promise.all([
      ctx.supabase
        .from('products')
        .select('id, name, name_customized, catalog_item_id, kind, quantity_kind, unit_label, content_amount, content_unit, bulk_unit')
        .eq('house_id', houseId),
      ctx.supabase.from('lots_with_dates').select('id, product_id, zone_id, quantity, opened_at, effective_date, effective_basis').eq('house_id', houseId),
      ctx.supabase.from('opened_units_with_dates').select('lot_id, remaining_fraction, effective_date, effective_basis').eq('house_id', houseId),
      ctx.supabase.from('zones').select('id, kind').eq('house_id', houseId),
      ctx.supabase.from('catalog_items').select('id, name_es, name_en'),
      ctx.supabase.from('profiles').select('locale, recipe_preferences, notify_days_ahead').maybeSingle(),
      ctx.supabase.from('recipe_favorites').select('title').order('created_at', { ascending: false }).limit(10),
      ctx.supabase.from('recipe_blocked').select('title').order('created_at', { ascending: false }).limit(100),
    ])
    const loadError = products.error ?? lots.error ?? units.error ?? zones.error ?? catalog.error ?? profile.error ?? favorites.error ?? blocked.error
    if (loadError) return Response.json({ error: loadError.message }, { status: 500 })

    const quota = await ctx.supabase.rpc('claim_ai_use', { p_kind: 'recipe' })
    if (quota.error) return Response.json({ error: quota.error.message }, { status: 500 })
    if (!quota.data) return errorResponse('ai_quota', 429)

    const locale = profile.data?.locale ?? 'es'
    const stock = summarizeStock({
      products: (products.data ?? []) as StockProductRow[],
      lots: (lots.data ?? []) as StockLotRow[],
      units: (units.data ?? []) as StockUnitRow[],
      freezerZoneIds: new Set((zones.data ?? []).filter((zone) => zone.kind === 'freezer').map((zone) => zone.id as string)),
      catalogNames: new Map((catalog.data ?? []).map((item) => [item.id as string, { name_es: item.name_es as string, name_en: item.name_en as string }])),
      locale,
      today,
    })
    const blockedTitles = (blocked.data ?? []).map((row) => row.title as string)
    const { text, refs } = recipeUserText({
      locale,
      today,
      daysAhead: profile.data?.notify_days_ahead ?? 2,
      request,
      stock,
      preferences: profile.data?.recipe_preferences ?? '',
      favorites: (favorites.data ?? []).map((row) => row.title as string),
      blocked: blockedTitles,
    })

    let message
    try {
      message = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 16000,
        system: recipeTask,
        messages: [{ role: 'user', content: text }],
        // Un esfuerzo medio basta para proponer recetas y responde antes que el alto.
        output_config: { format: zodOutputFormat(recipeModelSchema), effort: 'medium' },
      })
    } catch (error) {
      return claudeErrorResponse(error)
    }

    const output = structuredText(message)
    const parsed = output === null ? null : parseRecipeOutput(output)
    if (!parsed) return errorResponse('ai_unreadable', 422)

    return Response.json(toRecipeResult(parsed, { refs, blocked: blockedTitles }))
  }),
}
