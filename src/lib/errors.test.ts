import { describe, expect, it } from 'vitest'
import { errorKey } from './errors'

describe('errorKey', () => {
  it('traduce los códigos de la base de datos', () => {
    expect(errorKey({ message: 'undo_conflict' })).toBe('errors.undo_conflict')
    expect(errorKey({ message: 'nothing_to_consume' })).toBe('errors.nothing_to_consume')
  })

  it('reconoce la falta de conexión en Chrome, Safari y Firefox', () => {
    expect(errorKey({ message: 'TypeError: Failed to fetch' })).toBe('errors.network')
    expect(errorKey({ message: 'TypeError: Load failed' })).toBe('errors.network')
    expect(errorKey({ message: 'NetworkError when attempting to fetch resource.' })).toBe('errors.network')
  })

  it('no enseña errores técnicos', () => {
    expect(errorKey({ message: 'duplicate key value violates unique constraint' })).toBe('errors.unknown')
    expect(errorKey(null)).toBe('errors.unknown')
    expect(errorKey(undefined)).toBe('errors.unknown')
    expect(errorKey('texto')).toBe('errors.unknown')
  })
})
