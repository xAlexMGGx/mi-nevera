export type AuthRedirect = 'recovery' | 'error' | null

/** Reconoce el resultado de un enlace de email de Supabase en el hash de la URL. */
export function parseAuthRedirect(hash: string): AuthRedirect {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.has('error') || params.has('error_code')) return 'error'
  if (params.get('type') === 'recovery' && params.has('access_token')) return 'recovery'
  return null
}
