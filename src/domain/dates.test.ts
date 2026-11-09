import { describe, expect, it } from 'vitest'
import { addDays, formatDate, formatDayMonth, todayIn } from './dates'

describe('todayIn', () => {
  it('respeta la zona horaria alrededor de medianoche', () => {
    const now = new Date('2026-11-09T23:30:00Z')
    expect(todayIn('Europe/Madrid', now)).toBe('2026-11-10')
    expect(todayIn('America/New_York', now)).toBe('2026-11-09')
  })

  it('con una zona horaria inválida usa la de Madrid en lugar de fallar', () => {
    expect(todayIn('Marte/Olympus', new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10')
  })
})

describe('addDays', () => {
  it('cruza meses, años y años bisiestos', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-11-09', 0)).toBe('2026-11-09')
  })
})

describe('formato', () => {
  it('muestra el año solo si no es el actual', () => {
    expect(formatDate('2026-10-01', 'es-ES', '2026-11-09')).toBe('1 oct')
    expect(formatDate('2027-10-01', 'es-ES', '2026-11-09')).toContain('2027')
  })

  it('el día no se desplaza por la zona horaria', () => {
    expect(formatDate('2026-11-01', 'es-ES', '2026-11-09')).toBe('1 nov')
    expect(formatDate('2026-11-30', 'en-GB', '2026-11-09')).toBe('30 Nov')
  })

  it('dd/mm', () => {
    expect(formatDayMonth('2026-11-01')).toBe('01/11')
  })
})
