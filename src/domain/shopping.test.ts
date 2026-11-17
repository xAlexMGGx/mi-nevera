import { describe, expect, it } from 'vitest'
import type { InventoryData, Lot } from './inventory'
import { emptiedProducts, isOnList, splitShopping, type ShoppingItem } from './shopping'
import { milk, product, yogurt } from './testFixtures'

function item(overrides: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: 'i',
    house_id: 'h1',
    product_id: null,
    name: 'Pan',
    quantity_text: null,
    preferred_brand: null,
    checked: false,
    checked_at: null,
    origin: 'manual',
    created_at: '2026-11-16T10:00:00Z',
    updated_at: '2026-11-16T10:00:00Z',
    ...overrides,
  }
}

function inventory(productsWithStock: string[], products = [milk, yogurt, product({ id: 'taper', name: 'Lentejas', kind: 'cooked_dish' })]): InventoryData {
  return { zones: [], units: [], products, lots: productsWithStock.map((id) => ({ product_id: id }) as Lot) }
}

describe('orden de la lista', () => {
  it('pendiente por orden de llegada y, debajo, lo último comprado arriba', () => {
    const { pending, bought } = splitShopping([
      item({ id: 'b', name: 'Pan', created_at: '2026-11-16T11:00:00Z' }),
      item({ id: 'a', name: 'Leche', created_at: '2026-11-16T10:00:00Z' }),
      item({ id: 'c', name: 'Sal', checked: true, checked_at: '2026-11-16T12:00:00Z' }),
      item({ id: 'd', name: 'Azúcar', checked: true, checked_at: '2026-11-16T13:00:00Z' }),
    ])
    expect(pending.map((row) => row.id)).toEqual(['a', 'b'])
    expect(bought.map((row) => row.id)).toEqual(['d', 'c'])
  })
})

describe('¿ya está en la lista?', () => {
  it('por producto o por nombre, y solo si sigue pendiente', () => {
    expect(isOnList([item({ product_id: 'milk', name: 'Leche entera' })], milk)).toBe(true)
    expect(isOnList([item({ name: ' LÉCHE ' })], milk)).toBe(true)
    expect(isOnList([item({ name: 'Leche', checked: true })], milk)).toBe(false)
    expect(isOnList([item({ name: 'Pan' })], milk)).toBe(false)
  })
})

describe('productos que se acaban de terminar', () => {
  it('los que tenían existencias y ya no', () => {
    expect(emptiedProducts(inventory(['milk', 'yogurt']), inventory(['yogurt'])).map((row) => row.id)).toEqual(['milk'])
  })

  it('un táper que se acaba no cuenta, ni lo que no tenía nada', () => {
    expect(emptiedProducts(inventory(['taper']), inventory([]))).toEqual([])
    expect(emptiedProducts(inventory([]), inventory([]))).toEqual([])
  })

  it('sin datos de antes o de después, nada', () => {
    expect(emptiedProducts(undefined, inventory([]))).toEqual([])
  })
})
