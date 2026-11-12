import type { Selection } from '../../components/ProductSearch'
import { productIcon, productName, type CatalogById, type Product } from '../../domain/inventory'
import type { LineTarget } from '../../domain/ticket'
import { categoryIcons, type BulkUnit, type ContentUnit } from '../../domain/types'

/** Nombre e icono de lo que añade la línea. */
export function lineLabel(target: LineTarget, products: readonly Product[], catalog: CatalogById, language: string): { name: string; icon: string } {
  if (target.type === 'product') {
    const product = products.find((row) => row.id === target.productId)
    if (product) return { name: productName(product, catalog, language), icon: productIcon(product, catalog) }
  }
  if (target.type === 'catalog') {
    const item = catalog.get(target.catalogItemId)
    if (item) return { name: language === 'en' ? item.name_en : item.name_es, icon: item.icon }
  }
  if (target.type === 'new') return { name: target.name, icon: categoryIcons[target.category] }
  return { name: '', icon: categoryIcons.other }
}

/** Cómo se cuenta lo que había, para que un producto nuevo empiece igual. */
function currentShape(target: LineTarget, products: readonly Product[], catalog: CatalogById) {
  if (target.type === 'new') return target
  if (target.type === 'product') {
    const product = products.find((row) => row.id === target.productId)
    if (product) {
      return {
        category: product.category,
        quantityKind: product.quantity_kind,
        unitLabel: product.unit_label,
        contentAmount: product.content_amount,
        contentUnit: product.content_unit,
        bulkUnit: product.bulk_unit as BulkUnit | null,
      }
    }
  }
  if (target.type === 'catalog') {
    const item = catalog.get(target.catalogItemId)
    if (item) {
      const divisible = item.default_quantity_kind === 'divisible'
      return {
        category: item.category,
        quantityKind: item.default_quantity_kind,
        unitLabel: item.default_unit_label,
        contentAmount: divisible ? item.default_content_amount : null,
        contentUnit: divisible ? item.default_content_unit : null,
        bulkUnit: item.default_quantity_kind === 'bulk' ? (item.default_content_unit as BulkUnit | null) : null,
      }
    }
  }
  return { category: 'other' as const, quantityKind: 'count' as const, unitLabel: 'unit', contentAmount: null as number | null, contentUnit: null as ContentUnit | null, bulkUnit: null as BulkUnit | null }
}

export function selectionToTarget(selection: Selection, current: LineTarget, products: readonly Product[], catalog: CatalogById): LineTarget {
  if (selection.type === 'product') return { type: 'product', productId: selection.product.id }
  if (selection.type === 'catalog') return { type: 'catalog', catalogItemId: selection.item.id }
  const shape = currentShape(current, products, catalog)
  return {
    type: 'new',
    name: selection.name,
    category: shape.category,
    quantityKind: shape.quantityKind,
    unitLabel: shape.unitLabel,
    contentAmount: shape.contentAmount,
    contentUnit: shape.contentUnit,
    bulkUnit: shape.bulkUnit,
  }
}
