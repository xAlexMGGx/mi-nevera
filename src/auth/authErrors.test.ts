import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { authErrorKey } from './authErrors'

describe('authErrorKey', () => {
  it.each([
    ['invalid_credentials', 'auth.errors.invalidCredentials'],
    ['user_already_exists', 'auth.errors.emailTaken'],
    ['weak_password', 'auth.errors.weakPassword'],
    ['signup_disabled', 'auth.errors.signupDisabled'],
    ['email_address_not_authorized', 'auth.errors.emailNotAuthorized'],
    ['over_email_send_rate_limit', 'auth.errors.rateLimited'],
  ])('traduce el código %s', (code, key) => {
    expect(authErrorKey(new AuthApiError('msg', 400, code))).toBe(key)
  })

  it('reconoce la falta de conexión', () => {
    expect(authErrorKey(new AuthRetryableFetchError('fallo', 0))).toBe('auth.errors.network')
  })

  it('usa un mensaje genérico para lo desconocido', () => {
    expect(authErrorKey(new AuthApiError('msg', 500, 'algo_nuevo'))).toBe('auth.errors.unknown')
    expect(authErrorKey(new Error('otra cosa'))).toBe('auth.errors.unknown')
  })
})
