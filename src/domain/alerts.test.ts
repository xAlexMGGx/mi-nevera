import { describe, expect, it } from 'vitest'
import { alertCount, buildAlerts } from './alerts'
import type { InventoryData, Lot, OpenedUnit, Product } from './inventory'

const today = '2026-11-11'

function product(id: string): Product {
  return { id, name: id, kind: 'food', quantity_kind: 'divisible', category: 'dairy_eggs' } as Product
}

function lot(id: string, productId: string, extra: Partial<Lot> = {}): Lot {
  return {
    id,
    product_id: productId,
    quantity: 1,
    effective_date: null,
    effective_basis: null,
    opened_at: null,
    ...extra,
  } as Lot
}

function unit(id: string, lotId: string, extra: Partial<OpenedUnit> = {}): OpenedUnit {
  return { id, lot_id: lotId, opened_at: '2026-11-09', effective_date: null, effective_basis: null, remaining_fraction: 0.5, ...extra } as OpenedUnit
}

function data(lots: Lot[], units: OpenedUnit[] = []): InventoryData {
  const ids = [...new Set(lots.map((row) => row.product_id))]
  return { zones: [], products: ids.map(product), lots, units }
}

describe('pantalla Avisos', () => {
  it('reparte por estado y ordena por fecha', () => {
    const alerts = buildAlerts(
      data([
        lot('l1', 'yogur', { effective_date: '2026-11-10', effective_basis: 'expiry' }),
        lot('l2', 'arroz', { effective_date: '2026-11-01', effective_basis: 'best_before' }),
        lot('l3', 'leche', { effective_date: '2026-11-13', effective_basis: 'expiry' }),
        lot('l4', 'queso', { effective_date: '2026-11-12', effective_basis: 'expiry' }),
        lot('l5', 'atun', { effective_date: '2027-05-01', effective_basis: 'best_before' }),
      ]),
      today,
      2,
    )
    expect(alerts.expired.map((item) => item.key)).toEqual(['l1'])
    expect(alerts.review.map((item) => item.key)).toEqual(['l2'])
    expect(alerts.soon.map((item) => item.key)).toEqual(['l4', 'l3'])
    expect(alerts.opened).toEqual([])
    expect(alertCount(alerts)).toBe(4)
  })

  it('una unidad abierta va aparte de la parte cerrada de su lote', () => {
    const alerts = buildAlerts(
      data(
        [lot('l1', 'leche', { quantity: 5, effective_date: '2026-12-01', effective_basis: 'expiry' })],
        [unit('u1', 'l1', { effective_date: '2026-11-12', effective_basis: 'reminder' })],
      ),
      today,
      2,
    )
    expect(alerts.soon.map((item) => item.key)).toEqual(['u1'])
    expect(alerts.soon[0]!.unit?.id).toBe('u1')
  })

  it('lo abierto sin prisa va a "Abiertos", lo más antiguo primero, y lo urgente solo a su sección', () => {
    const alerts = buildAlerts(
      data(
        [
          lot('l1', 'leche', { quantity: 0, effective_date: '2026-12-01', effective_basis: 'expiry' }),
          lot('l2', 'queso', { opened_at: '2026-11-01', effective_date: null }),
        ],
        [
          unit('u1', 'l1', { opened_at: '2026-11-08' }),
          unit('u2', 'l1', { opened_at: '2026-11-10', effective_date: '2026-11-10', effective_basis: 'reminder' }),
        ],
      ),
      today,
      2,
    )
    expect(alerts.opened.map((item) => item.key)).toEqual(['l2', 'u1'])
    expect(alerts.expired.map((item) => item.key)).toEqual(['u2'])
  })

  it('un lote vacío con solo unidades abiertas no aparece como lote', () => {
    const alerts = buildAlerts(data([lot('l1', 'leche', { quantity: 0, effective_date: '2026-11-10', effective_basis: 'expiry' })], []), today, 2)
    expect(alertCount(alerts)).toBe(0)
  })

  it('lo congelado sin fecha de aviso no da guerra', () => {
    const alerts = buildAlerts(data([lot('l1', 'pollo', { frozen_at: '2026-10-01', effective_date: null })]), today, 2)
    expect(alertCount(alerts) + alerts.opened.length).toBe(0)
  })
})
