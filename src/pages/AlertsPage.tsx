import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { HouseSwitcher } from '../components/HouseSwitcher'
import { GearIcon } from '../components/icons'
import { Screen, topBarIcon } from '../components/Screen'
import { StatusBadge } from '../components/StatusBadge'
import { ActionChip, FullScreenLoader, LoadError, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useActiveHouseId, useHouses, useSwitchHouse } from '../data/house'
import { useInventory, useInventoryAction } from '../data/inventory'
import { alertSections, buildAlerts, type AlertItem, type AlertSection } from '../domain/alerts'
import { daysBetween } from '../domain/dates'
import { productIcon, productName, type Zone } from '../domain/inventory'
import { formatPercent, formatQuantity } from '../domain/quantity'
import { supabase } from '../lib/supabase'
import { ConsumeAmountSheet, DiscardSheet } from './product/sheets'

type SheetState = { type: 'consume'; item: AlertItem } | { type: 'discard'; item: AlertItem }

function OpenedSince({ openedAt }: { openedAt: string }) {
  const { t } = useTranslation()
  const { today } = useDateContext()
  const days = daysBetween(openedAt, today)
  const text = days <= 0 ? t('alerts.openedToday') : days === 1 ? t('alerts.openedYesterday') : t('alerts.openedDays', { count: days })
  return <span className="text-xs font-semibold text-ink-muted">{text}</span>
}

function AlertRow({ item, zones, onOpenSheet }: { item: AlertItem; zones: Zone[]; onOpenSheet: (sheet: SheetState) => void }) {
  const { t } = useTranslation()
  const { language, tag } = useDateContext()
  const catalog = useCatalog()
  const { run, pending } = useInventoryAction()
  const { product, lot, unit } = item
  const zone = zones.find((row) => row.id === lot.zone_id)
  const name = productName(product, catalog.byId, language)
  const amount = unit ? t('alerts.unitLine', { percent: formatPercent(unit.remaining_fraction, tag) }) : formatQuantity(lot.quantity, product, t, tag)

  function consume() {
    if (unit) {
      void run('finished', () => supabase.rpc('set_remaining', { p_opened_unit_id: unit.id, p_fraction: 0 }))
    } else if (product.quantity_kind === 'bulk') {
      onOpenSheet({ type: 'consume', item })
    } else {
      void run('consumed', () => supabase.rpc('consume', { p_lot_id: lot.id }))
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="w-9 shrink-0 text-center text-3xl leading-none">
          {productIcon(product, catalog.byId)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <p className="w-full truncate font-semibold">
            {lot.container_number !== null && <span className="text-brand">{t('inventory.containerNumber', { number: lot.container_number })} </span>}
            {name}
          </p>
          <p className="w-full truncate text-sm text-ink-muted">
            {zone && `${t(`zones.${zone.kind}`)} · `}
            {amount}
          </p>
          {item.date && <StatusBadge rowDate={{ date: item.date, basis: item.basis, status: item.status }} />}
          {item.status === 'review' && <span className="text-xs text-review">{t('status.reviewNote')}</span>}
          {item.openedAt && <OpenedSince openedAt={item.openedAt} />}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <ActionChip disabled={pending} onClick={consume}>
          {unit ? t('alerts.finish') : t('inventory.minusOne')}
        </ActionChip>
        <ActionChip disabled={pending} onClick={() => onOpenSheet({ type: 'discard', item })}>
          {t('alerts.discard')}
        </ActionChip>
        <Link to={`/product/${product.id}`} className={`inline-flex min-h-10 items-center rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink ${focusRing}`}>
          {t('alerts.view')}
        </Link>
      </div>
    </li>
  )
}

/** Si se llega desde una notificación de otra casa, se cambia a esa casa. */
function useHouseFromLink() {
  const [params, setParams] = useSearchParams()
  const activeId = useActiveHouseId()
  const houses = useHouses()
  const switchHouse = useSwitchHouse()
  const wanted = params.get('house')

  useEffect(() => {
    if (!wanted || !houses.data) return
    if (wanted !== activeId && houses.data.some((house) => house.id === wanted)) switchHouse(wanted)
    setParams({}, { replace: true })
  }, [wanted, activeId, houses.data, switchHouse, setParams])
}

export function AlertsPage() {
  const { t } = useTranslation()
  const { language, today, daysAhead } = useDateContext()
  const inventory = useInventory()
  const catalog = useCatalog()
  const [sheet, setSheet] = useState<SheetState | null>(null)
  useHouseFromLink()

  const alerts = useMemo(() => (inventory.data ? buildAlerts(inventory.data, today, daysAhead) : null), [inventory.data, today, daysAhead])

  function renderSheet() {
    if (!sheet || !inventory.data) return null
    const { item } = sheet
    const close = () => setSheet(null)
    const name = productName(item.product, catalog.byId, language)
    if (sheet.type === 'consume') {
      return <ConsumeAmountSheet product={item.product} name={name} lots={[item.lot]} lotId={item.lot.id} onClose={close} />
    }
    // Desde una unidad abierta se propone tirar solo esa unidad.
    return item.unit ? (
      <DiscardSheet product={item.product} lot={item.lot} units={[item.unit]} initialAmount={0} onClose={close} />
    ) : (
      <DiscardSheet product={item.product} lot={item.lot} units={[]} onClose={close} />
    )
  }

  function renderSections() {
    if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
    if (inventory.isLoadingError) return <LoadError onRetry={() => void inventory.refetch()} />
    if (!alerts) return null

    const visible = alertSections.filter((section) => alerts[section].length > 0)
    return (
      <div className="flex flex-col gap-6">
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span aria-hidden="true" className="text-5xl">
              ✅
            </span>
            <p className="text-lg font-semibold">{t('alerts.emptyTitle')}</p>
            <p className="text-ink-muted">{t('alerts.emptyBody')}</p>
          </div>
        )}
        {visible.map((section: AlertSection) => (
          <section key={section} className="flex flex-col gap-2" aria-labelledby={`alerts-${section}`}>
            <h2 id={`alerts-${section}`} className="text-sm font-semibold text-ink-muted">
              {t(`alerts.sections.${section}`)} · {alerts[section].length}
            </h2>
            <ul className="flex flex-col gap-2">
              {alerts[section].map((item) => (
                <AlertRow key={item.key} item={item} zones={inventory.data!.zones} onOpenSheet={setSheet} />
              ))}
            </ul>
          </section>
        ))}
        <Link to="/conservation" className={`self-center text-sm font-semibold text-brand ${focusRing}`}>
          {t('alerts.conservation')}
        </Link>
        {renderSheet()}
      </div>
    )
  }

  return (
    <Screen
      withNav
      title={t('alerts.title')}
      heading={<HouseSwitcher />}
      action={
        <Link to="/settings" aria-label={t('settings.open')} className={topBarIcon}>
          <GearIcon />
        </Link>
      }
      main={renderSections()}
    />
  )
}
