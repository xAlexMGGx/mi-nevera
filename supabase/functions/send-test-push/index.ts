// "Enviar notificación de prueba" (SPEC §8). La llama la app con la sesión de quien la pide: las
// reglas de acceso de la base de datos solo le dejan ver sus propias suscripciones.

import { withSupabase } from 'npm:@supabase/server@1'
import { testPayload } from '../_shared/digest.ts'
import { sendPush } from '../_shared/push.ts'

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    // Si la app indica su suscripción, la prueba va solo a este móvil.
    const body = await req.json().catch(() => ({}))
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null

    let query = ctx.supabase.from('push_subscriptions').select('endpoint, p256dh, auth')
    if (endpoint) query = query.eq('endpoint', endpoint)
    const [subscriptions, profile] = await Promise.all([query, ctx.supabase.from('profiles').select('locale').maybeSingle()])
    if (subscriptions.error) return Response.json({ error: subscriptions.error.message }, { status: 500 })

    const payload = testPayload(profile.data?.locale)
    const result = { sent: 0, gone: 0, failed: 0 }
    for (const subscription of subscriptions.data ?? []) {
      const outcome = await sendPush(subscription, payload)
      result[outcome]++
      if (outcome === 'gone') await ctx.supabase.rpc('delete_push_subscription', { p_endpoint: subscription.endpoint })
    }
    return Response.json(result)
  }),
}
