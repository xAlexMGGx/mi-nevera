// Resumen de la notificación diaria (SPEC §8): una por casa y día, a cada miembro, a su hora.
// Cuenta productos, como las filas del inventario: cada uno en su estado más grave.

import { mostUrgent, type DatedItem } from './dateStatus.ts'

export interface DigestItem extends DatedItem {
  product_id: string
}

export interface DigestCounts {
  expired: number
  today: number
  soon: number
}

export function countDigest(items: DigestItem[], today: string, daysAhead: number): DigestCounts {
  const byProduct = new Map<string, DatedItem[]>()
  for (const item of items) {
    const list = byProduct.get(item.product_id)
    if (list) list.push(item)
    else byProduct.set(item.product_id, [item])
  }

  const counts: DigestCounts = { expired: 0, today: 0, soon: 0 }
  for (const dated of byProduct.values()) {
    const row = mostUrgent(dated, today, daysAhead)
    if (!row) continue
    if (row.status === 'expired') counts.expired++
    // "Revisar" (consumo preferente pasado) se ve en la pantalla Avisos, pero no se notifica cada día.
    else if (row.status === 'soon') {
      if (row.date === today) counts.today++
      else counts.soon++
    }
  }
  return counts
}

export function hasNews(counts: DigestCounts) {
  return counts.expired + counts.today + counts.soon > 0
}

type Locale = 'es' | 'en'

const texts = {
  es: {
    expired: (n: number) => (n === 1 ? '1 caducado' : `${n} caducados`),
    today: (n: number) => (n === 1 ? '1 caduca hoy' : `${n} caducan hoy`),
    soon: (n: number, days: number) =>
      days === 1 ? `${n} mañana` : `${n} en los próximos ${days} días`,
    testTitle: 'Nevera digital',
    testBody: 'Así te llegarán los avisos de caducidad.',
  },
  en: {
    expired: (n: number) => `${n} expired`,
    today: (n: number) => (n === 1 ? '1 expires today' : `${n} expire today`),
    soon: (n: number, days: number) => (days === 1 ? `${n} tomorrow` : `${n} in the next ${days} days`),
    testTitle: 'Digital Fridge',
    testBody: 'This is how your expiry reminders will look.',
  },
} satisfies Record<Locale, unknown>

function localeOf(locale: string | null | undefined): Locale {
  return locale === 'en' ? 'en' : 'es'
}

export interface PushPayload {
  title: string
  body: string
  /** Relativa al alcance de la app: el service worker la completa. */
  url: string
  /** Una notificación nueva de la misma casa sustituye a la anterior. */
  tag: string
}

/** "Casa · 2 caducan hoy, 3 en los próximos 2 días". */
export function digestPayload(
  counts: DigestCounts,
  house: { id: string; name: string },
  daysAhead: number,
  locale: string | null | undefined,
): PushPayload {
  const t = texts[localeOf(locale)]
  const parts: string[] = []
  if (counts.expired) parts.push(t.expired(counts.expired))
  if (counts.today) parts.push(t.today(counts.today))
  if (counts.soon) parts.push(t.soon(counts.soon, daysAhead))
  return {
    title: house.name,
    body: parts.join(', '),
    url: `#/alerts?house=${house.id}`,
    tag: `digest-${house.id}`,
  }
}

export function testPayload(locale: string | null | undefined): PushPayload {
  const t = texts[localeOf(locale)]
  return { title: t.testTitle, body: t.testBody, url: '#/alerts', tag: 'test' }
}
