import { describe, expect, it } from 'vitest'
import { formatInviteCode, inviteLink, matchesConfirmation, normalizeInviteCode } from './invite'

describe('códigos de invitación', () => {
  it('se muestran partidos en dos para leerlos mejor', () => {
    expect(formatInviteCode('ABCDEFGH')).toBe('ABCD-EFGH')
  })

  it('se aceptan como los escriba la persona', () => {
    expect(normalizeInviteCode(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(normalizeInviteCode('ab cd ef gh')).toBe('ABCDEFGH')
    expect(formatInviteCode('abcd efgh')).toBe('ABCD-EFGH')
  })

  it('mientras se escribe no añade el guion antes de tiempo', () => {
    expect(formatInviteCode('abc')).toBe('ABC')
    expect(formatInviteCode('abcd')).toBe('ABCD')
    expect(formatInviteCode('abcde')).toBe('ABCD-E')
  })

  it('el enlace apunta a la app publicada', () => {
    expect(inviteLink('abcd-efgh', 'https://xalexmggx.github.io', '/mi-nevera/')).toBe('https://xalexmggx.github.io/mi-nevera/#/join/ABCDEFGH')
  })
})

describe('confirmar escribiendo', () => {
  it('no distingue mayúsculas ni espacios de los extremos', () => {
    expect(matchesConfirmation(' casa de la playa ', 'Casa de la Playa')).toBe(true)
    expect(matchesConfirmation('eliminar', 'ELIMINAR')).toBe(true)
  })

  it('exige el texto entero', () => {
    expect(matchesConfirmation('casa', 'Casa de la playa')).toBe(false)
    expect(matchesConfirmation('', 'ELIMINAR')).toBe(false)
  })
})
