// Notificación diaria (SPEC §8). La llama cada hora la tarea programada de la base de datos, con la
// clave secreta. Avisa a quien tiene esta hora elegida, una vez por casa y día, y solo si hay algo.

import { withSupabase } from 'npm:@supabase/server@1'
import { countDigest, digestPayload, hasNews, type DigestItem } from '../_shared/digest.ts'
import { sendPush, type StoredSubscription } from '../_shared/push.ts'

interface DigestTarget {
  user_id: string
  locale: string
  day: string
  days_ahead: number
  house_id: string
  house_name: string
  items: DigestItem[]
  subscriptions: StoredSubscription[] | null
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    const { data, error } = await ctx.supabaseAdmin.rpc('digest_batch')
    if (error) {
      console.error('digest_batch', error.message)
      return Response.json({ error: error.message }, { status: 500 })
    }

    const summary = { checked: 0, notified: 0, sent: 0, gone: 0, failed: 0 }
    for (const target of (data ?? []) as DigestTarget[]) {
      summary.checked++
      // "Hoy" es el de cada persona, en su zona horaria.
      const counts = countDigest(target.items, target.day, target.days_ahead)
      if (!hasNews(counts)) continue

      const { data: claimed } = await ctx.supabaseAdmin.rpc('claim_digest', {
        p_user_id: target.user_id,
        p_house_id: target.house_id,
        p_day: target.day,
      })
      if (!claimed) continue
      summary.notified++

      const payload = digestPayload(counts, { id: target.house_id, name: target.house_name }, target.days_ahead, target.locale)
      for (const subscription of target.subscriptions ?? []) {
        const result = await sendPush(subscription, payload)
        summary[result]++
        if (result === 'gone') await ctx.supabaseAdmin.rpc('forget_push_subscription', { p_endpoint: subscription.endpoint })
      }
    }

    return Response.json(summary)
  }),
}
