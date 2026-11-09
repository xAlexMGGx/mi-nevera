import type { Session } from '@supabase/supabase-js'
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authRedirect, readStoredSession, supabase } from '../lib/supabase'

interface AuthContextValue {
  session: Session | null
  /** Aún no se sabe si hay sesión. */
  loading: boolean
  /** Se ha abierto un enlace de recuperación y falta elegir la contraseña nueva. */
  recovering: boolean
  finishRecovery: () => void
  /** Se ha abierto un enlace de email caducado o ya usado. */
  linkExpired: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(authRedirect === 'recovery')
  const [linkExpired, setLinkExpired] = useState(authRedirect === 'error')

  useEffect(() => {
    let settled = false
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      settled = true
      // Sin red no se puede renovar un token caducado, y el cliente arranca sin sesión aunque siga
      // guardada: solo la borra si el servidor la rechaza. Se usa para consultar los datos en
      // caché, y al volver la red el propio cliente la renueva.
      setSession(nextSession ?? (event === 'INITIAL_SESSION' ? readStoredSession() : null))
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_IN') setLinkExpired(false)
    })

    // Antes de dar la sesión por perdida, el cliente reintenta renovarla durante unos 30 segundos.
    // Mientras, se puede consultar el inventario con la sesión guardada.
    const fallback = setTimeout(
      () => {
        const stored = readStoredSession()
        if (settled || !stored) return
        setSession(stored)
        setLoading(false)
      },
      navigator.onLine ? 3000 : 0,
    )

    return () => {
      clearTimeout(fallback)
      data.subscription.unsubscribe()
    }
  }, [])

  const finishRecovery = useCallback(() => setRecovering(false), [])

  const value = useMemo(
    () => ({ session, loading, recovering, finishRecovery, linkExpired }),
    [session, loading, recovering, finishRecovery, linkExpired],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}

/** Solo para pantallas protegidas, donde la sesión siempre existe. */
export function useUser() {
  const { session } = useAuth()
  if (!session) throw new Error('useUser requiere una sesión iniciada')
  return session.user
}
