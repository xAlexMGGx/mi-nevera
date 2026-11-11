import { base64UrlToBytes, bytesToBase64Url } from '../lib/base64url'
import { supabase } from '../lib/supabase'

// Notificaciones en este móvil (SPEC §8). Cada móvil se suscribe por separado; el aviso diario
// llega a todos los de la persona.

const vapidPublicKey: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY

export type PushSupport = 'not-configured' | 'unsupported' | 'needs-install' | 'ready'

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function pushSupport(): PushSupport {
  if (!vapidPublicKey) return 'not-configured'
  // En iPhone solo funciona con la app instalada en la pantalla de inicio.
  if (isIos() && !isInstalled()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ready'
}

export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied'
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service-worker-timeout')), 10_000))
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ready') return null
  // Sin esperar a que el service worker esté listo: si aún no hay ninguno, tampoco hay suscripción.
  const existing = await navigator.serviceWorker.getRegistration()
  return existing ? existing.pushManager.getSubscription() : null
}

async function save(subscription: PushSubscription) {
  const json = subscription.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint!,
    p_p256dh: json.keys!.p256dh!,
    p_auth: json.keys!.auth!,
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

/** Hay que llamarla justo al pulsar un botón: el iPhone solo pide permiso tras un toque. */
export async function subscribeThisDevice(): Promise<'subscribed' | 'denied'> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const pushManager = (await registration()).pushManager
  let subscription = await pushManager.getSubscription()
  // Si las claves del servidor han cambiado, la suscripción vieja ya no sirve.
  const key = subscription?.options.applicationServerKey
  if (subscription && (!key || bytesToBase64Url(key) !== vapidPublicKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey!) })
  await save(subscription)
  return 'subscribed'
}

export async function unsubscribeThisDevice() {
  const subscription = await currentSubscription()
  if (!subscription) return
  await supabase.rpc('delete_push_subscription', { p_endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

/** Al cerrar sesión, este móvil deja de recibir los avisos de esa cuenta. Nunca impide salir. */
export async function forgetThisDevice() {
  try {
    await unsubscribeThisDevice()
  } catch {
    // Sin conexión o sin service worker: la suscripción caducará o pasará a la próxima cuenta.
  }
}

export interface TestResult {
  sent: number
  gone: number
  failed: number
}

export async function sendTestNotification(): Promise<TestResult> {
  const subscription = await currentSubscription()
  const { data, error } = await supabase.functions.invoke<TestResult>('send-test-push', {
    body: { endpoint: subscription?.endpoint ?? null },
  })
  if (error) throw error
  return data ?? { sent: 0, gone: 0, failed: 0 }
}

/** Si la app ya estaba abierta al pulsar una notificación, el service worker le pide ir a su pantalla. */
export function listenForNotificationClicks() {
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<{ type?: string; url?: string }>) => {
    if (event.data?.type !== 'open-url' || !event.data.url) return
    const target = new URL(event.data.url)
    if (target.origin === window.location.origin) window.location.hash = target.hash
  })
}
