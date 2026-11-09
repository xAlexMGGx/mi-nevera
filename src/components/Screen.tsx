import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { useOffline } from '../lib/connectivity'
import { BackIcon } from './icons'
import { focusRing } from './ui'

const recheckMs = 20_000

/** Avisa de que no se puede editar (SPEC §3) y sigue probando hasta que vuelve el servidor. */
function OfflineBanner() {
  const { t } = useTranslation()
  const offline = useOffline()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!offline) return
    const timer = setInterval(() => void queryClient.invalidateQueries(), recheckMs)
    return () => clearInterval(timer)
  }, [offline, queryClient])

  if (!offline) return null
  return (
    <p role="status" className="bg-review-bg px-4 py-1.5 text-center text-sm font-semibold text-review">
      {t('offline.banner')}
    </p>
  )
}

interface TopBarProps {
  title: string
  /** Sustituye al título, por ejemplo por el selector de casa. Debe incluir su propio h1. */
  heading?: ReactNode
  /** A dónde volver si no hay historial, por ejemplo tras recargar la página. */
  backTo?: string
  action?: ReactNode
  children?: ReactNode
}

export const topBarIcon = `flex size-11 shrink-0 items-center justify-center rounded-full text-ink active:bg-line ${focusRing}`

export function TopBar({ title, heading, backTo, action, children }: TopBarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  function goBack() {
    if (location.key !== 'default') void navigate(-1)
    else void navigate(backTo ?? '/', { replace: true })
  }

  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-canvas">
      <OfflineBanner />
      <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-1 px-2">
        {backTo && (
          <button type="button" aria-label={t('common.back')} onClick={goBack} className={topBarIcon}>
            <BackIcon />
          </button>
        )}
        {heading ?? <h1 className="min-w-0 flex-1 truncate px-2 text-lg font-bold">{title}</h1>}
        {action}
      </div>
      {children && <div className="mx-auto w-full max-w-xl px-4 pb-3">{children}</div>}
    </header>
  )
}

interface ScreenProps extends TopBarProps {
  main: ReactNode
  withNav?: boolean
}

export function Screen({ main, withNav, ...topBar }: ScreenProps) {
  return (
    <div className="safe-x flex min-h-dvh flex-col">
      <TopBar {...topBar} />
      <main className={`mx-auto w-full max-w-xl flex-1 p-4 ${withNav ? 'pb-nav' : 'safe-bottom'}`}>{main}</main>
    </div>
  )
}
