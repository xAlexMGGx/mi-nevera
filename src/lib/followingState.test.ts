import { describe, expect, it } from 'vitest'
import { nextFieldValue } from './followingState'

describe('campos que siguen al dato de origen', () => {
  it('un campo sin tocar muestra el valor nuevo', () => {
    expect(nextFieldValue('Pascual', 'Pascual', 'Central Lechera')).toBe('Central Lechera')
  })

  it('un campo que se está editando conserva lo escrito', () => {
    expect(nextFieldValue('Hacend', 'Pascual', 'Central Lechera')).toBe('Hacend')
  })

  it('un campo vaciado a propósito sigue vacío', () => {
    expect(nextFieldValue('', 'Pascual', 'Central Lechera')).toBe('')
  })
})
