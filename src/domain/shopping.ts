// Lista de la compra (SPEC §13).

import type { Tables } from '../lib/database.types'
import type { InventoryData, Product } from './inventory'
import { normalizeName } from './lotDraft'

export type ShoppingItem = Tables<'shopping_items'>

/** Lo pendiente, por orden de llegada; debajo, lo comprado, lo último arriba. */
export function splitShopping(items: readonly ShoppingItem[]): { pending: ShoppingItem[]; bought: ShoppingItem[] } {
  const pending = items.filter((item) => !item.checked).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const bought = items.filter((item) => item.checked).sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))
  return { pending, bought }
}

/** Si el producto ya está pendiente en la lista, por enlace o por nombre. */
export function isOnList(items: readonly ShoppingItem[], product: Pick<Product, 'id' | 'name'>): boolean {
  const name = normalizeName(product.name)
  return items.some((item) => !item.checked && (item.product_id === product.id || normalizeName(item.name) === name))
}

/**
 * Productos que tenían existencias y ya no (SPEC §13: "al terminar la última unidad"). Los tápers no
 * cuentan: un resto que se acaba no se vuelve a comprar.
 */
export function emptiedProducts(before: InventoryData | undefined, after: InventoryData | undefined): Product[] {
  if (!before || !after) return []
  const stockedBefore = new Set([...before.lots.map((lot) => lot.product_id)])
  const stockedAfter = new Set([...after.lots.map((lot) => lot.product_id)])
  return after.products.filter((product) => product.kind === 'food' && stockedBefore.has(product.id) && !stockedAfter.has(product.id))
}
