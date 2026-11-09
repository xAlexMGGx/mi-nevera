import { describe, expect, it } from 'vitest'
import { mostUrgent, statusOf } from './status'

const today = '2026-11-09'
const daysAhead = 2

describe('statusOf', () => {
  it.each([
    ['caducidad pasada', '2026-11-08', 'expiry', 'expired'],
    ['aviso pasado', '2026-11-08', 'reminder', 'expired'],
    ['consumo preferente pasado', '2026-11-08', 'best_before', 'review'],
    ['caduca hoy', '2026-11-09', 'expiry', 'soon'],
    ['consumo preferente hoy', '2026-11-09', 'best_before', 'soon'],
    ['aviso hoy', '2026-11-09', 'reminder', 'soon'],
    ['justo en el límite de antelación', '2026-11-11', 'expiry', 'soon'],
    ['un día después del límite', '2026-11-12', 'expiry', 'ok'],
    ['lejos', '2027-01-01', 'best_before', 'ok'],
  ] as const)('%s', (_, date, basis, expected) => {
    expect(statusOf({ date, basis }, today, daysAhead)).toBe(expected)
  })

  it('sin fecha está bien', () => {
    expect(statusOf({ date: null, basis: null }, today, daysAhead)).toBe('ok')
  })

  it('respeta los días de antelación de cada persona', () => {
    const item = { date: '2026-11-14', basis: 'expiry' } as const
    expect(statusOf(item, today, 2)).toBe('ok')
    expect(statusOf(item, today, 5)).toBe('soon')
    expect(statusOf({ date: today, basis: 'expiry' }, today, 0)).toBe('soon')
  })
})

describe('mostUrgent', () => {
  it('prefiere el estado más grave aunque otra fecha sea anterior', () => {
    const result = mostUrgent(
      [
        { date: '2026-10-01', basis: 'best_before' },
        { date: '2026-11-08', basis: 'expiry' },
      ],
      today,
      daysAhead,
    )
    expect(result).toMatchObject({ date: '2026-11-08', status: 'expired' })
  })

  it('a igual estado, la fecha más próxima', () => {
    const result = mostUrgent(
      [
        { date: '2027-03-01', basis: 'expiry' },
        { date: '2027-01-01', basis: 'expiry' },
      ],
      today,
      daysAhead,
    )
    expect(result).toMatchObject({ date: '2027-01-01', status: 'ok' })
  })

  it('ignora lo que no tiene fecha', () => {
    expect(mostUrgent([{ date: null, basis: null }], today, daysAhead)).toBeNull()
    expect(mostUrgent([], today, daysAhead)).toBeNull()
  })
})
