// Notificaciones (SPEC §8). Lo carga el service worker que genera vite-plugin-pwa (importScripts).

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const scope = self.registration.scope

  event.waitUntil(
    self.registration.showNotification(data.title || 'Nevera digital', {
      body: data.body || '',
      // Una notificación nueva de la misma casa sustituye a la de ayer.
      tag: data.tag,
      icon: new URL('pwa-192x192.png', scope).href,
      badge: new URL('pwa-64x64.png', scope).href,
      data: { url: new URL(data.url || '#/alerts', scope).href },
    }),
  )
})

// Al pulsarla se abre la pantalla Avisos de esa casa, en la app si ya estaba abierta.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((client) => client.url.startsWith(self.registration.scope))
      if (open) {
        open.postMessage({ type: 'open-url', url })
        return open.focus()
      }
      return self.clients.openWindow(url)
    })(),
  )
})
