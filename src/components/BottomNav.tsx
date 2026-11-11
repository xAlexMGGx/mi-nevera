import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router'
import { useOffline } from '../lib/connectivity'
import { BellIcon, ListIcon, PlusIcon } from './icons'
import { focusRing } from './ui'

const addButton = 'mx-auto flex size-14 -translate-y-3 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg'

function Tab({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-brand' : 'text-ink-muted'} ${focusRing}`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

// Cinco huecos fijos: Compra y Recetas aparecerán aquí en sus fases, sin mover lo demás.
export function BottomNav() {
  const { t } = useTranslation()
  const offline = useOffline()

  return (
    <nav aria-label={t('nav.label')} className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface">
      <div className="mx-auto grid h-16 w-full max-w-xl grid-cols-5 items-center">
        <Tab to="/" icon={<ListIcon />} label={t('nav.inventory')} />
        <Tab to="/alerts" icon={<BellIcon />} label={t('nav.alerts')} />
        {offline ? (
          <span role="link" aria-disabled="true" aria-label={t('nav.add')} className={`${addButton} opacity-40`}>
            <PlusIcon />
          </span>
        ) : (
          <Link to="/add" aria-label={t('nav.add')} className={`${addButton} transition-opacity active:opacity-80 ${focusRing}`}>
            <PlusIcon />
          </Link>
        )}
      </div>
    </nav>
  )
}
