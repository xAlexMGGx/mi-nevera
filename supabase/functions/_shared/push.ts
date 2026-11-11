// Envío de Web Push con claves VAPID (RFC 8291 y 8292). Solo para Deno: lo usan las Edge Functions.

import * as webpush from 'jsr:@negrel/webpush@0.5.0'
import type { PushPayload } from './digest.ts'

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushResult = 'sent' | 'gone' | 'failed'

// Si el móvil no está conectado, el servicio de notificaciones la guarda hasta 12 horas.
const timeToLiveSeconds = 12 * 60 * 60

let server: Promise<webpush.ApplicationServer> | undefined

function applicationServer() {
  server ??= (async () => {
    const keys = Deno.env.get('VAPID_KEYS')
    const subject = Deno.env.get('VAPID_SUBJECT')
    if (!keys || !subject) throw new Error('Faltan los secretos VAPID_KEYS o VAPID_SUBJECT (SETUP.md, paso 12).')
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(keys), { extractable: false })
    return webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys })
  })()
  return server
}

export async function sendPush(subscription: StoredSubscription, payload: PushPayload): Promise<PushResult> {
  const subscriber = (await applicationServer()).subscribe({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  })
  try {
    await subscriber.pushTextMessage(JSON.stringify(payload), { ttl: timeToLiveSeconds })
    return 'sent'
  } catch (error) {
    if (error instanceof webpush.PushMessageError && error.isGone()) return 'gone'
    console.error('No se pudo enviar la notificación', new URL(subscription.endpoint).host, String(error))
    return 'failed'
  }
}
