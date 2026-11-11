import { describe, expect, it } from 'vitest'
import { countDigest, digestPayload, hasNews, testPayload, type DigestItem } from '../supabase/functions/_shared/digest.ts'

const today = '2026-11-11'
const house = { id: 'casa-1', name: 'Casa' }

function item(product_id: string, date: string | null, basis: DigestItem['basis'] = 'expiry'): DigestItem {
  return { product_id, date, basis }
}

describe('resumen de la notificación diaria', () => {
  it('cuenta caducados, de hoy y próximos', () => {
    const counts = countDigest(
      [item('a', '2026-11-10'), item('b', '2026-11-11'), item('c', '2026-11-11'), item('d', '2026-11-13'), item('e', '2026-11-20')],
      today,
      2,
    )
    expect(counts).toEqual({ expired: 1, today: 2, soon: 1 })
  })

  it('cuenta productos, no lotes: cada uno en su estado más grave', () => {
    const counts = countDigest([item('leche', '2026-11-10'), item('leche', '2026-11-12'), item('leche', '2026-11-30')], today, 2)
    expect(counts).toEqual({ expired: 1, today: 0, soon: 0 })
  })

  it('el consumo preferente pasado no se notifica, y lo que no tiene fecha tampoco', () => {
    const counts = countDigest([item('arroz', '2026-11-01', 'best_before'), item('sal', null, null)], today, 2)
    expect(counts).toEqual({ expired: 0, today: 0, soon: 0 })
    expect(hasNews(counts)).toBe(false)
  })

  it('una fecha de aviso pasada cuenta como caducada', () => {
    expect(countDigest([item('taper', '2026-11-09', 'reminder')], today, 2)).toEqual({ expired: 1, today: 0, soon: 0 })
  })

  it('respeta los días de antelación de cada persona', () => {
    expect(countDigest([item('a', '2026-11-14')], today, 2).soon).toBe(0)
    expect(countDigest([item('a', '2026-11-14')], today, 3).soon).toBe(1)
  })

  it('el texto sigue el SPEC: "Casa · 2 caducan hoy, 3 en los próximos 2 días"', () => {
    const payload = digestPayload({ expired: 0, today: 2, soon: 3 }, house, 2, 'es')
    expect(payload).toEqual({ title: 'Casa', body: '2 caducan hoy, 3 en los próximos 2 días', url: '#/alerts?house=casa-1', tag: 'digest-casa-1' })
  })

  it('usa singulares, "mañana" con un día de antelación, y el idioma de cada persona', () => {
    expect(digestPayload({ expired: 1, today: 1, soon: 1 }, house, 1, 'es').body).toBe('1 caducado, 1 caduca hoy, 1 mañana')
    expect(digestPayload({ expired: 2, today: 1, soon: 4 }, house, 2, 'en').body).toBe('2 expired, 1 expires today, 4 in the next 2 days')
    expect(digestPayload({ expired: 1, today: 0, soon: 0 }, house, 2, null).body).toBe('1 caducado')
  })

  it('la prueba se envía en el idioma de quien la pide', () => {
    expect(testPayload('en').title).toBe('Digital Fridge')
    expect(testPayload('es').body).toMatch(/avisos/)
  })
})
