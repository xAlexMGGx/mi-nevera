import { Outlet } from 'react-router'
import { WelcomePage } from '../pages/WelcomePage'
import { useProfile, useProfileLocale } from '../profile/useProfile'
import { BottomNav } from './BottomNav'
import { FullScreenLoader, LoadError } from './ui'

/** Pantallas que requieren una casa. La primera vez, se pide crearla. */
export function RequireHouse() {
  const profile = useProfile()
  useProfileLocale()

  if (profile.isPending) return <FullScreenLoader />
  if (profile.isError) return <LoadError onRetry={() => void profile.refetch()} />
  if (!profile.data.active_house_id) return <WelcomePage />
  return <Outlet />
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
