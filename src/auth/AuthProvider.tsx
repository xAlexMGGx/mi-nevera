import type { Session } from '@supabase/supabase-js'
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authRedirect, supabase } from '../lib/supabase'

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
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_IN') setLinkExpired(false)
    })
    return () => data.subscription.unsubscribe()
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
