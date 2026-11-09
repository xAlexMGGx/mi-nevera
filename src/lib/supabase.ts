import { createClient } from '@supabase/supabase-js'
import { parseAuthRedirect } from './authRedirect'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(url && publishableKey)

// Se lee antes de crear el cliente, porque el cliente limpia el hash de la URL al arrancar.
export const authRedirect = parseAuthRedirect(window.location.hash)

export const supabase = createClient<Database>(
  url ?? 'https://not-configured.invalid',
  publishableKey ?? 'not-configured',
  {
    auth: {
      // Con PKCE, el enlace de recuperación fallaría si se pide desde la app instalada y se
      // abre en Safari, porque no comparten almacenamiento. El flujo implicit no tiene ese problema.
      flowType: 'implicit',
      detectSessionInUrl: true,
    },
  },
)
