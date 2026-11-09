import type { TFunction } from 'i18next'
import type { Lot, OpenedUnit, Product } from './inventory'
import { feminineUnits, isUnitLabel } from './types'

type QuantityShape = Pick<Product, 'quantity_kind' | 'bulk_unit' | 'unit_label'>

export function formatNumber(value: number, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, { maximumFractionDigits: 2 }).format(value)
}

/** Para precargar un campo editable: sin separador de miles, que al leerlo se confundiría con decimales. */
export function formatForInput(value: number, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, { maximumFractionDigits: 2, useGrouping: false }).format(value)
}

export function formatPercent(fraction: number, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, { style: 'percent', maximumFractionDigits: 0 }).format(fraction)
}

/** Acepta coma o punto decimal. Devuelve null si no es un número. */
export function parseAmount(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(value) ? value : null
}

export function unitName(label: string, count: number, t: TFunction): string {
  return isUnitLabel(label) ? t(`units.${label}`, { count }) : label
}

/** "3 bricks", "1,2 kg", "1 ración" */
export function formatQuantity(amount: number, shape: QuantityShape, t: TFunction, localeTag: string): string {
  const number = formatNumber(amount, localeTag)
  if (shape.quantity_kind === 'bulk' && shape.bulk_unit) return `${number} ${shape.bulk_unit}`
  return `${number} ${unitName(shape.unit_label, amount, t)}`
}

function openedLabel(count: number, unitLabel: string, t: TFunction, localeTag: string): string {
  const amount = formatNumber(count, localeTag)
  return isUnitLabel(unitLabel) && feminineUnits.has(unitLabel)
    ? t('inventory.summary.openFeminine', { count, amount })
    : t('inventory.summary.openMasculine', { count, amount })
}

/** "5 bricks + 1 abierto (60 %)", "12 huevos", "1,2 kg", "3 raciones" */
export function summarize(product: Product, lots: Lot[], units: OpenedUnit[], t: TFunction, localeTag: string): string {
  if (product.quantity_kind === 'bulk') {
    const total = lots.reduce((sum, lot) => sum + lot.quantity, 0)
    const text = formatQuantity(total, product, t, localeTag)
    return lots.some((lot) => lot.opened_at) ? t('inventory.summary.bulkOpen', { amount: text }) : text
  }

  const closed = lots.filter((lot) => !lot.opened_at).reduce((sum, lot) => sum + lot.quantity, 0)
  const openLots = lots.filter((lot) => lot.opened_at).reduce((sum, lot) => sum + lot.quantity, 0)
  const openCount = openLots + units.length

  const parts: string[] = []
  if (closed > 0) parts.push(formatQuantity(closed, product, t, localeTag))
  if (openCount > 0) {
    const percents = units.map((unit) => formatPercent(unit.remaining_fraction, localeTag)).join(', ')
    const label = openedLabel(openCount, product.unit_label, t, localeTag)
    parts.push(percents ? `${label} (${percents})` : label)
  }
  return parts.join(' + ')
}

/** Contenido total de los envases con contenido, contando lo que queda en los abiertos: "5,6 l". */
export function totalContent(product: Product, lots: Lot[], units: OpenedUnit[], t: TFunction, localeTag: string): string | null {
  if (product.quantity_kind !== 'divisible' || !product.content_amount || !product.content_unit) return null
  const containers =
    lots.reduce((sum, lot) => sum + lot.quantity, 0) + units.reduce((sum, unit) => sum + unit.remaining_fraction, 0)
  return `${formatNumber(containers * product.content_amount, localeTag)} ${t(`contentUnits.${product.content_unit}`)}`
}
