import { describe, expect, it } from 'vitest'
import { findGuide, guidePeriod, suggestedReminder, type GuideEntry } from './shelfLife'

function entry(partial: Partial<GuideEntry>): GuideEntry {
  return { catalog_item_id: null, category: null, state: 'opened', min_days: 3, max_days: 4, note_es: 'x', note_en: 'x', source: 'fda-chart-2018', ...partial }
}

const guide = [
  entry({ catalog_item_id: 'merluza', state: 'frozen', min_days: 180, max_days: 240 }),
  entry({ catalog_item_id: 'merluza', state: 'thawed', min_days: 1, max_days: 2 }),
  entry({ category: 'fish', state: 'thawed', min_days: 1, max_days: 2 }),
  entry({ category: 'cooked', state: 'cooked', min_days: 3, max_days: 4 }),
  entry({ catalog_item_id: 'huevos', state: 'frozen', min_days: null, max_days: null }),
]

describe('chips orientativos', () => {
  it('un producto del catálogo usa su propia fila', () => {
    expect(findGuide(guide, { catalog_item_id: 'merluza', category: 'fish' }, 'frozen')?.max_days).toBe(240)
  })

  it('un producto del catálogo sin fila propia no hereda la de su categoría', () => {
    expect(findGuide(guide, { catalog_item_id: 'pulpo', category: 'fish' }, 'thawed')).toBeNull()
  })

  it('un producto propio o un táper usan la de su categoría', () => {
    expect(findGuide(guide, { catalog_item_id: null, category: 'fish' }, 'thawed')?.max_days).toBe(2)
    expect(findGuide(guide, { catalog_item_id: null, category: 'cooked' }, 'cooked')?.max_days).toBe(4)
    expect(findGuide(guide, { catalog_item_id: null, category: 'meat' }, 'thawed')).toBeNull()
  })

  it('propone el plazo más largo contado desde la fecha del cambio', () => {
    const cooked = findGuide(guide, { catalog_item_id: null, category: 'cooked' }, 'cooked')!
    expect(suggestedReminder(cooked, '2026-11-11')).toBe('2026-11-15')
  })

  it('lo que no se debe congelar no propone fecha', () => {
    const eggs = findGuide(guide, { catalog_item_id: 'huevos', category: 'dairy_eggs' }, 'frozen')!
    expect(suggestedReminder(eggs, '2026-11-11')).toBeNull()
    expect(guidePeriod(eggs)).toBeNull()
  })

  it('muestra el plazo en la unidad de la fuente', () => {
    expect(guidePeriod({ min_days: 3, max_days: 5 })).toEqual({ min: 3, max: 5, unit: 'days' })
    expect(guidePeriod({ min_days: 5, max_days: 7 })).toEqual({ min: 5, max: 7, unit: 'days' })
    expect(guidePeriod({ min_days: 21, max_days: 21 })).toEqual({ min: 3, max: 3, unit: 'weeks' })
    expect(guidePeriod({ min_days: 60, max_days: 90 })).toEqual({ min: 2, max: 3, unit: 'months' })
    expect(guidePeriod({ min_days: 270, max_days: 270 })).toEqual({ min: 9, max: 9, unit: 'months' })
    expect(guidePeriod({ min_days: 180, max_days: 360 })).toEqual({ min: 6, max: 12, unit: 'months' })
    expect(guidePeriod({ min_days: 360, max_days: 360 })).toEqual({ min: 1, max: 1, unit: 'years' })
  })
})
