import { describe, expect, it } from 'vitest'
import { parseAuthRedirect } from './authRedirect'

describe('parseAuthRedirect', () => {
  it('reconoce un enlace de recuperación de contraseña', () => {
    expect(parseAuthRedirect('#access_token=abc&refresh_token=def&type=recovery')).toBe('recovery')
  })

  it('reconoce un enlace caducado', () => {
    expect(parseAuthRedirect('#error=access_denied&error_code=otp_expired&error_description=x')).toBe('error')
  })

  it('no confunde las rutas normales de la app con un enlace', () => {
    expect(parseAuthRedirect('#/settings')).toBeNull()
    expect(parseAuthRedirect('#/')).toBeNull()
    expect(parseAuthRedirect('')).toBeNull()
  })

  it('ignora una recuperación sin token', () => {
    expect(parseAuthRedirect('#type=recovery')).toBeNull()
  })
})
