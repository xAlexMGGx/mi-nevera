import { describe, expect, it } from 'vitest'
import { learnedDate, median, type DateSample } from './learnedDates'

let order = 0
function sample(days: number, type: DateSample['printed_date_type'] = 'expiry', productId = 'milk'): DateSample {
  order++
  // Cada muestra, un segundo después de la anterior.
  const createdAt = new Date(Date.UTC(2026, 0, 1) + order * 1000).toISOString()
  return { product_id: productId, days_to_printed_date: days, printed_date_type: type, created_at: createdAt }
}

describe('mediana', () => {
  it('con un número impar de valores, el del medio', () => {
    expect(median([30, 10, 20])).toBe(20)
  })

  it('con un número par, la media de los dos del medio redondeada hacia abajo', () => {
    expect(median([10, 13, 20, 40])).toBe(16)
    expect(median([3, 4])).toBe(3)
  })
})

describe('fecha aprendida', () => {
  it('sin al menos 3 compras del mismo tipo no sugiere nada', () => {
    expect(learnedDate([sample(9), sample(10)], 'milk', '2026-11-11')).toBeNull()
    expect(learnedDate([sample(9), sample(10), sample(11, 'best_before')], 'milk', '2026-11-11')).toBeNull()
  })

  it('suma la mediana al día de compra', () => {
    expect(learnedDate([sample(9), sample(30), sample(10)], 'milk', '2026-11-11')).toEqual({ date: '2026-11-21', type: 'expiry', samples: 3 })
    expect(learnedDate([sample(9), sample(30), sample(10)], 'milk', '2026-12-28')).toMatchObject({ date: '2027-01-07' })
  })

  it('solo cuenta las compras de ese producto', () => {
    expect(learnedDate([sample(9), sample(10), sample(11, 'expiry', 'yogurt')], 'milk', '2026-11-11')).toBeNull()
  })

  it('elige el tipo de fecha que más se repite y, a igualdad, caducidad', () => {
    const bestBefore = [sample(300, 'best_before'), sample(310, 'best_before'), sample(320, 'best_before'), sample(330, 'best_before')]
    expect(learnedDate([sample(9), sample(10), sample(11), ...bestBefore], 'milk', '2026-11-11')).toMatchObject({ type: 'best_before', samples: 4 })
    expect(learnedDate([sample(9), sample(10), sample(11), ...bestBefore.slice(1)], 'milk', '2026-11-11')).toMatchObject({ type: 'expiry' })
  })

  it('usa las 10 compras más recientes e ignora las fechas anteriores a la compra', () => {
    const old = Array.from({ length: 10 }, () => sample(100))
    const recent = Array.from({ length: 10 }, () => sample(10))
    expect(learnedDate([...old, ...recent], 'milk', '2026-11-11')).toMatchObject({ date: '2026-11-21', samples: 10 })
    expect(learnedDate([sample(-5), sample(-3), sample(10), sample(12)], 'milk', '2026-11-11')).toBeNull()
  })
})
