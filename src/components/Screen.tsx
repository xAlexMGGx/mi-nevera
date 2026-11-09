import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { BackIcon } from './icons'
import { focusRing } from './ui'

interface TopBarProps {
  title: string
  /** A dónde volver si no hay historial, por ejemplo tras recargar la página. */
  backTo?: string
  action?: ReactNode
  children?: ReactNode
}

export const topBarIcon = `flex size-11 shrink-0 items-center justify-center rounded-full text-ink active:bg-line ${focusRing}`

export function TopBar({ title, backTo, action, children }: TopBarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  function goBack() {
    if (location.key !== 'default') void navigate(-1)
    else void navigate(backTo ?? '/', { replace: true })
  }

  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-canvas">
      <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-1 px-2">
        {backTo && (
          <button type="button" aria-label={t('common.back')} onClick={goBack} className={topBarIcon}>
            <BackIcon />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate px-2 text-lg font-bold">{title}</h1>
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
