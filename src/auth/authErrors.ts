import { isAuthError } from '@supabase/supabase-js'

type AuthErrorKey = `auth.errors.${
  | 'invalidCredentials'
  | 'emailTaken'
  | 'invalidEmail'
  | 'weakPassword'
  | 'samePassword'
  | 'signupDisabled'
  | 'rateLimited'
  | 'emailNotAuthorized'
  | 'network'
  | 'unknown'}`

const keyByCode: Record<string, AuthErrorKey> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  user_already_exists: 'auth.errors.emailTaken',
  email_exists: 'auth.errors.emailTaken',
  email_address_invalid: 'auth.errors.invalidEmail',
  validation_failed: 'auth.errors.invalidEmail',
  weak_password: 'auth.errors.weakPassword',
  same_password: 'auth.errors.samePassword',
  signup_disabled: 'auth.errors.signupDisabled',
  email_provider_disabled: 'auth.errors.signupDisabled',
  over_email_send_rate_limit: 'auth.errors.rateLimited',
  over_request_rate_limit: 'auth.errors.rateLimited',
  email_address_not_authorized: 'auth.errors.emailNotAuthorized',
}

/** Traduce un error de Supabase Auth a la clave del mensaje que debe ver el usuario. */
export function authErrorKey(error: unknown): AuthErrorKey {
  if (!isAuthError(error)) return 'auth.errors.unknown'
  if (error.name === 'AuthRetryableFetchError') return 'auth.errors.network'
  return keyByCode[error.code ?? ''] ?? 'auth.errors.unknown'
}
