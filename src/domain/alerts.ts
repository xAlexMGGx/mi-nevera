import type { InventoryData, Lot, OpenedUnit, Product } from './inventory'
import { statusOf, type Status } from './status'
import type { DateBasis } from './types'

// Pantalla Avisos (SPEC §8): cada lote y cada unidad abierta, en la sección de su estado.

export const alertSections = ['expired', 'review', 'soon', 'opened'] as const
export type AlertSection = (typeof alertSections)[number]

export interface AlertItem {
  key: string
  product: Product
  lot: Lot
  /** Si es una unidad abierta; si no, es la parte cerrada (o el lote abierto entero). */
  unit: OpenedUnit | null
  date: string | null
  basis: DateBasis | null
  status: Status
  openedAt: string | null
}

export type Alerts = Record<AlertSection, AlertItem[]>

export function buildAlerts(data: InventoryData, today: string, daysAhead: number): Alerts {
  const products = new Map(data.products.map((product) => [product.id, product]))
  const alerts: Alerts = { expired: [], review: [], soon: [], opened: [] }

  function place(item: Omit<AlertItem, 'status'>) {
    const status = statusOf({ date: item.date, basis: item.basis }, today, daysAhead)
    // Cada cosa aparece una vez: en la sección más grave, y en "Abiertos" solo si no está en otra.
    const section: AlertSection | null = status !== 'ok' ? status : item.openedAt ? 'opened' : null
    if (section) alerts[section].push({ ...item, status })
  }

  for (const lot of data.lots) {
    const product = products.get(lot.product_id)
    if (!product) continue
    if (lot.quantity > 0) {
      place({ key: lot.id, product, lot, unit: null, date: lot.effective_date, basis: lot.effective_basis, openedAt: lot.opened_at })
    }
    for (const unit of data.units.filter((row) => row.lot_id === lot.id)) {
      place({ key: unit.id, product, lot, unit, date: unit.effective_date, basis: unit.effective_basis, openedAt: unit.opened_at })
    }
  }

  const byDate = (a: AlertItem, b: AlertItem) => (a.date ?? '9999').localeCompare(b.date ?? '9999')
  alerts.expired.sort(byDate)
  alerts.review.sort(byDate)
  alerts.soon.sort(byDate)
  // Lo que lleva más tiempo abierto, primero.
  alerts.opened.sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''))
  return alerts
}

export function alertCount(alerts: Alerts) {
  return alerts.expired.length + alerts.review.length + alerts.soon.length
}
