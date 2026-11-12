import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router'
import { useOffline } from '../lib/connectivity'
import type { AddPageState } from '../pages/AddPage'
import { ScanBarcodeDialog } from '../scan/ScanBarcodeDialog'
import { BellIcon, ListIcon, PlusIcon } from './icons'
import { Sheet } from './Sheet'
import { Button, focusRing } from './ui'

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

/** ＋: Añadir manualmente · Escanear código · Escanear ticket (SPEC §6). */
function AddMenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(false)

  if (scanning) {
    return (
      <ScanBarcodeDialog
        onResult={(scanned) => void navigate('/add', { state: { scanned } satisfies AddPageState })}
        onClose={onClose}
      />
    )
  }

  return (
    <Sheet title={t('addMenu.title')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Button onClick={() => void navigate('/add')}>{t('addMenu.manual')}</Button>
        <Button variant="secondary" onClick={() => setScanning(true)}>
          {t('addMenu.barcode')}
        </Button>
        <Button variant="secondary" onClick={() => void navigate('/ticket')}>
          {t('addMenu.ticket')}
        </Button>
      </div>
    </Sheet>
  )
}

// Cinco huecos fijos: Compra y Recetas aparecerán aquí en sus fases, sin mover lo demás.
export function BottomNav() {
  const { t } = useTranslation()
  const offline = useOffline()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav aria-label={t('nav.label')} className="safe-bottom safe-x fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface">
      <div className="mx-auto grid h-16 w-full max-w-xl grid-cols-5 items-center">
        <Tab to="/" icon={<ListIcon />} label={t('nav.inventory')} />
        <Tab to="/alerts" icon={<BellIcon />} label={t('nav.alerts')} />
        <button
          type="button"
          aria-label={t('nav.add')}
          aria-haspopup="dialog"
          disabled={offline}
          onClick={() => setMenuOpen(true)}
          className={`${addButton} transition-opacity active:opacity-80 disabled:opacity-40 ${focusRing}`}
        >
          <PlusIcon />
        </button>
      </div>
      {menuOpen && <AddMenu onClose={() => setMenuOpen(false)} />}
    </nav>
  )
}
