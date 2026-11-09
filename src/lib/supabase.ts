import { createClient, type Session } from '@supabase/supabase-js'
import { parseAuthRedirect } from './authRedirect'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://not-configured.invalid'
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && publishableKey)

// Se lee antes de crear el cliente, porque el cliente limpia el hash de la URL al arrancar.
export const authRedirect = parseAuthRedirect(window.location.hash)

// Es el nombre que Supabase usa por defecto. Se fija aquí para poder leer la sesión sin conexión.
const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`

export const supabase = createClient<Database>(url, publishableKey ?? 'not-configured', {
  auth: {
    // Con PKCE, el enlace de recuperación fallaría si se pide desde la app instalada y se
    // abre en Safari, porque no comparten almacenamiento. El flujo implicit no tiene ese problema.
    flowType: 'implicit',
    detectSessionInUrl: true,
    storageKey,
  },
})

/** La sesión guardada en este dispositivo, aunque su token haya caducado. */
export function readStoredSession(): Session | null {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Session | null
    return stored?.access_token && stored.user ? stored : null
  } catch {
    return null
  }
}
