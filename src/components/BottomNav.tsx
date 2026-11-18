import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router'
import { useActiveHouseId } from '../data/house'
import { useInventory } from '../data/inventory'
import { useShoppingList } from '../data/shopping'
import { useOffline } from '../lib/connectivity'
import type { AddPageState } from '../pages/AddPage'
import { ScanBarcodeDialog } from '../scan/ScanBarcodeDialog'
import { BellIcon, CartIcon, ListIcon, PlusIcon, PotIcon } from './icons'
import { Sheet } from './Sheet'
import { Button, focusRing } from './ui'

const addButton = 'mx-auto flex size-14 -translate-y-3 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg'

/** `badge.label` es el nombre completo para lectores de pantalla: "Compra, 3 pendientes". */
function Tab({ to, icon, label, badge }: { to: string; icon: ReactNode; label: string; badge?: { count: number; label: string } }) {
  return (
    <NavLink
      to={to}
      end
      aria-label={badge && badge.count > 0 ? badge.label : undefined}
      className={({ isActive }) =>
        `relative flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-brand' : 'text-ink-muted'} ${focusRing}`
      }
    >
      {icon}
      {label}
      {badge && badge.count > 0 && (
        <span aria-hidden="true" className="absolute top-1.5 left-1/2 ml-2 min-w-5 rounded-full bg-brand px-1.5 text-center text-xs leading-5 font-bold text-on-brand">
          {badge.count}
        </span>
      )}
    </NavLink>
  )
}

/** ＋: Añadir manualmente · Escanear código · Escanear ticket (SPEC §6). */
function AddMenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const houseId = useActiveHouseId()
  const inventory = useInventory()
  const [scanning, setScanning] = useState(false)

  if (scanning && inventory.data) {
    return (
      <ScanBarcodeDialog
        identify
        houseId={houseId}
        house={inventory.data}
        onResult={(scan) => void navigate('/add', { state: { scan } satisfies AddPageState })}
        onPickOther={(scan) => void navigate('/add', { state: { scan, pick: true } satisfies AddPageState })}
        onClose={onClose}
      />
    )
  }

  return (
    <Sheet title={t('addMenu.title')} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <Button onClick={() => void navigate('/add')}>{t('addMenu.manual')}</Button>
        <Button variant="secondary" disabled={!inventory.data} onClick={() => setScanning(true)}>
          {t('addMenu.barcode')}
        </Button>
        <Button variant="secondary" onClick={() => void navigate('/ticket')}>
          {t('addMenu.ticket')}
        </Button>
      </div>
    </Sheet>
  )
}

// Cinco huecos (SPEC §6): Inventario, Avisos, ＋, Compra y Recetas.
export function BottomNav() {
  const { t } = useTranslation()
  const offline = useOffline()
  const shopping = useShoppingList()
  const [menuOpen, setMenuOpen] = useState(false)
  const pending = shopping.data?.filter((item) => !item.checked).length ?? 0

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
        <Tab to="/shopping" icon={<CartIcon />} label={t('nav.shopping')} badge={{ count: pending, label: t('nav.shoppingPending', { count: pending }) }} />
        <Tab to="/recipes" icon={<PotIcon />} label={t('nav.recipes')} />
      </div>
      {menuOpen && <AddMenu onClose={() => setMenuOpen(false)} />}
    </nav>
  )
}
