import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router'
import { useProfileLocale } from '../profile/useProfile'
import { BackIcon, GearIcon } from './icons'

const iconLink = 'flex size-11 items-center justify-center rounded-full text-ink active:bg-line'

export function AppShell() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  useProfileLocale()

  const inSettings = pathname === '/settings'

  return (
    <div className="safe-x flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-line bg-canvas">
        <div className="flex h-14 items-center gap-1 px-2">
          {inSettings && (
            <Link to="/" aria-label={t('settings.back')} className={iconLink}>
              <BackIcon />
            </Link>
          )}
          <p className="flex-1 truncate px-2 text-lg font-bold">
            {inSettings ? t('settings.title') : t('app.name')}
          </p>
          {!inSettings && (
            <Link to="/settings" aria-label={t('settings.open')} className={iconLink}>
              <GearIcon />
            </Link>
          )}
        </div>
      </header>
      <main className="safe-bottom mx-auto w-full max-w-xl flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
