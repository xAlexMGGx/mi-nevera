import { Navigate, Outlet } from 'react-router'
import { ActiveHouseContext } from '../data/house'
import { useRealtimeSync } from '../data/realtime'
import { readPendingInvite } from '../lib/pendingInvite'
import { WelcomePage } from '../pages/WelcomePage'
import { useProfile, useProfileLocale } from '../profile/useProfile'
import { BottomNav } from './BottomNav'
import { FullScreenLoader, LoadError } from './ui'

/** Pantallas que requieren una casa. La primera vez, se pide crearla o unirse a una. */
export function RequireHouse() {
  const profile = useProfile()
  useProfileLocale()
  useRealtimeSync(profile.data?.active_house_id ?? null)

  // Venía de un enlace de invitación y acaba de iniciar sesión.
  const pendingInvite = readPendingInvite()
  if (pendingInvite) return <Navigate to={`/join/${pendingInvite}`} replace />

  if (profile.isPending) return <FullScreenLoader />
  if (profile.isLoadingError) return <LoadError onRetry={() => void profile.refetch()} />
  if (!profile.data.active_house_id) return <WelcomePage />
  return (
    <ActiveHouseContext value={profile.data.active_house_id}>
      <Outlet />
    </ActiveHouseContext>
  )
}

/** Pantallas principales, con la barra inferior. */
export function TabsLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}
