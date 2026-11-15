// Lo que se va a añadir: un lote con su producto, cantidad, zona y fechas. Es lo mismo al añadir a
// mano, por código de barras y en cada línea de un ticket, y se edita con el mismo formulario.

import type { ProductProposal } from '../../supabase/functions/_shared/productMatch.ts'
import { productIcon, productName, type CatalogById, type CatalogItem, type Lot, type Product, type Zone } from './inventory'
import { categoryIcons, type BulkUnit, type Category, type ContentUnit, type PrintedDateType, type QuantityKind, type ZoneKind } from './types'

/** Cómo se cuenta: "6 bricks de 1 l", "12 huevos", "1,2 kg". */
export interface CountingSpec {
  quantityKind: QuantityKind
  /** El envase o la unidad (brick, lata…). A granel no se usa. */
  unitLabel: string
  /** Lo que contiene cada envase. Solo si se gasta poco a poco (divisible). */
  contentAmount: number | null
  contentUnit: ContentUnit | null
  /** Solo a granel. */
  bulkUnit: BulkUnit | null
}

export type LineTarget =
  | { type: 'product'; productId: string }
  | { type: 'catalog'; catalogItemId: string; counting: CountingSpec }
  | { type: 'new'; name: string; category: Category; counting: CountingSpec }

export interface DraftLine {
  key: string
  /** En un ticket, si se añade. */
  checked: boolean
  /** Tal como venía en el ticket. Lo demás no tiene. */
  rawText: string | null
  /** Emparejada por un ticket anterior. */
  fromAlias: boolean
  target: LineTarget
  quantity: number
  zone: ZoneKind
  brand: string
  printedDate: string
  dateType: PrintedDateType | null
  barcode: string | null
  imageUrl: string | null
  /** Solo en el congelador. Vacío: el día de compra. */
  frozenAt: string
  /** Solo en el congelador. Vacío: sin aviso. */
  reminderDate: string
}

export interface HouseData {
  products: readonly Product[]
  lots: readonly Pick<Lot, 'product_id' | 'zone_id' | 'barcode'>[]
  zones: readonly Pick<Zone, 'id' | 'kind'>[]
}

let keyCount = 0
export function newLineKey(): string {
  keyCount++
  return `${Date.now().toString(36)}-${keyCount}`
}

/** Igual que private.normalize_name en la base de datos. */
export function normalizeName(name: string): string {
  return name.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ')
}

export function productCounting(product: Product): CountingSpec {
  return {
    quantityKind: product.quantity_kind,
    unitLabel: product.unit_label,
    contentAmount: product.content_amount,
    contentUnit: product.content_unit,
    bulkUnit: product.bulk_unit as BulkUnit | null,
  }
}

export function catalogCounting(item: CatalogItem): CountingSpec {
  const kind = item.default_quantity_kind
  return {
    quantityKind: kind,
    unitLabel: kind === 'bulk' ? 'unit' : item.default_unit_label,
    contentAmount: kind === 'divisible' ? item.default_content_amount : null,
    contentUnit: kind === 'divisible' ? item.default_content_unit : null,
    bulkUnit: kind === 'bulk' ? ((item.default_content_unit as BulkUnit | null) ?? 'kg') : null,
  }
}

const fallbackCounting: CountingSpec = { quantityKind: 'count', unitLabel: 'unit', contentAmount: null, contentUnit: null, bulkUnit: null }

/** Cómo se cuenta lo que añade la línea. Un producto de la casa ya tiene la suya y no cambia. */
export function targetCounting(target: LineTarget, products: readonly Product[]): CountingSpec {
  if (target.type === 'product') {
    const product = products.find((row) => row.id === target.productId)
    return product ? productCounting(product) : fallbackCounting
  }
  return target.counting
}

/** Nombre e icono de lo que se añade. */
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

export interface QuantityShape {
  quantity_kind: QuantityKind
  unit_label: string
  bulk_unit: BulkUnit | null
}

/** Para mostrar la cantidad con formatQuantity. */
export function lineCounting(target: LineTarget, products: readonly Product[]): QuantityShape {
  const counting = targetCounting(target, products)
  return { quantity_kind: counting.quantityKind, unit_label: counting.unitLabel, bulk_unit: counting.bulkUnit }
}

// --------------------------------------------------------------------------------------------- Unidades

/** El selector de unidad junto a la cantidad: un envase ("unit:brick") o peso y volumen ("bulk:kg"). */
export type UnitChoice = `unit:${string}` | `bulk:${BulkUnit}`

export function unitChoiceOf(counting: CountingSpec): UnitChoice {
  return counting.quantityKind === 'bulk' ? `bulk:${counting.bulkUnit ?? 'kg'}` : `unit:${counting.unitLabel}`
}

export function withUnitChoice(counting: CountingSpec, choice: UnitChoice): CountingSpec {
  const [kind, value] = choice.split(':') as ['unit' | 'bulk', string]
  if (kind === 'bulk') return { quantityKind: 'bulk', unitLabel: 'unit', contentAmount: null, contentUnit: null, bulkUnit: value as BulkUnit }
  const hasContent = counting.quantityKind === 'divisible' && counting.contentAmount !== null
  return { ...counting, quantityKind: hasContent ? 'divisible' : 'count', unitLabel: value, bulkUnit: null }
}

/** Con contenido, el envase se gasta poco a poco (se puede abrir y apuntar lo que queda); sin él, se cuenta entero. */
export function withContent(counting: CountingSpec, amount: number | null, unit: ContentUnit): CountingSpec {
  if (counting.quantityKind === 'bulk') return counting
  return amount && amount > 0
    ? { ...counting, quantityKind: 'divisible', contentAmount: amount, contentUnit: unit }
    : { ...counting, quantityKind: 'count', contentAmount: null, contentUnit: null }
}

/** Al pasar de granel a unidades, la cantidad tiene que ser entera. */
export function fitQuantity(quantity: number, counting: CountingSpec): number {
  if (counting.quantityKind === 'bulk') return quantity
  return Math.max(1, Math.round(quantity) || 1)
}

// --------------------------------------------------------------------------------------------- Líneas

/** Donde suele estar: la zona de sus existencias, la del catálogo o la propuesta. */
export function defaultZone(target: LineTarget, house: HouseData, catalog: CatalogById, suggested: ZoneKind): ZoneKind {
  if (target.type === 'product') {
    const lot = house.lots.find((row) => row.product_id === target.productId)
    const zone = lot && house.zones.find((row) => row.id === lot.zone_id)
    if (zone) return zone.kind
    const product = house.products.find((row) => row.id === target.productId)
    const item = product?.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
    return item?.default_zone ?? suggested
  }
  if (target.type === 'catalog') return catalog.get(target.catalogItemId)?.default_zone ?? suggested
  return suggested
}

export function emptyLine(target: LineTarget, house: HouseData, catalog: CatalogById, suggestedZone: ZoneKind = 'fridge'): DraftLine {
  return {
    key: newLineKey(),
    checked: true,
    rawText: null,
    fromAlias: false,
    target,
    quantity: 1,
    zone: defaultZone(target, house, catalog, suggestedZone),
    brand: '',
    printedDate: '',
    dateType: null,
    barcode: null,
    imageUrl: null,
    frozenAt: '',
    reminderDate: '',
  }
}

/** Cambia el producto de una línea. La zona sigue al producto y la cantidad, a su forma de contar. */
export function retargetLine(line: DraftLine, target: LineTarget, house: HouseData, catalog: CatalogById): DraftLine {
  const zone = line.target.type === target.type && target.type !== 'product' ? line.zone : defaultZone(target, house, catalog, line.zone)
  return { ...line, target, fromAlias: false, zone, quantity: fitQuantity(line.quantity, targetCounting(target, house.products)) }
}

/** Lo elegido en el buscador de productos. Un producto nuevo empieza contándose como lo que había. */
export function targetFromSelection(
  selection: { type: 'product'; product: Product } | { type: 'catalog'; item: CatalogItem } | { type: 'new'; name: string },
  current: LineTarget | null,
  products: readonly Product[],
): LineTarget {
  if (selection.type === 'product') return { type: 'product', productId: selection.product.id }
  if (selection.type === 'catalog') return { type: 'catalog', catalogItemId: selection.item.id, counting: catalogCounting(selection.item) }
  const category: Category =
    current?.type === 'new' ? current.category : current?.type === 'product' ? (products.find((row) => row.id === current.productId)?.category ?? 'other') : 'other'
  return { type: 'new', name: selection.name, category, counting: current ? targetCounting(current, products) : fallbackCounting }
}

/** Lo que propone la IA para un código escaneado. */
export function targetFromProposal(proposal: ProductProposal, products: readonly Product[], catalog: CatalogById): LineTarget {
  if (proposal.matched_product_id && products.some((row) => row.id === proposal.matched_product_id)) {
    return { type: 'product', productId: proposal.matched_product_id }
  }
  const kind = proposal.quantity_kind
  const counting: CountingSpec = {
    quantityKind: kind,
    unitLabel: kind === 'bulk' ? 'unit' : proposal.unit_label,
    contentAmount: kind === 'divisible' ? proposal.content_amount : null,
    contentUnit: kind === 'divisible' ? proposal.content_unit : null,
    bulkUnit: kind === 'bulk' ? ((proposal.content_unit as BulkUnit | null) ?? 'kg') : null,
  }
  if (proposal.catalog_item_id && catalog.has(proposal.catalog_item_id)) return { type: 'catalog', catalogItemId: proposal.catalog_item_id, counting }
  return { type: 'new', name: proposal.name, category: proposal.category, counting }
}

/** Lo que se sabe por el código de barras. */
export interface ScanFacts {
  barcode: string
  brand: string | null
  imageUrl: string | null
  contentAmount: number | null
  contentUnit: ContentUnit | null
}

/**
 * Añade el código a una línea: la foto, la marca si no tenía, y el contenido del envase si es un
 * producto por crear que aún no lo tiene.
 */
export function attachScan(line: DraftLine, scan: ScanFacts): DraftLine {
  let target = line.target
  if (target.type !== 'product' && target.counting.quantityKind !== 'bulk' && !target.counting.contentAmount && scan.contentAmount && scan.contentUnit) {
    target = { ...target, counting: withContent(target.counting, scan.contentAmount, scan.contentUnit) }
  }
  return {
    ...line,
    target,
    barcode: scan.barcode,
    imageUrl: scan.imageUrl ?? line.imageUrl,
    brand: line.brand.trim() ? line.brand : (scan.brand ?? ''),
  }
}

export type LineProblem = 'quantity' | 'dateType' | 'name' | 'content'

export function lineProblem(line: DraftLine, products: readonly Product[]): LineProblem | null {
  const counting = targetCounting(line.target, products)
  if (!(line.quantity > 0) || (counting.quantityKind !== 'bulk' && !Number.isInteger(line.quantity))) return 'quantity'
  if (line.printedDate && !line.dateType) return 'dateType'
  if (line.target.type === 'new' && !line.target.name.trim()) return 'name'
  if (line.target.type !== 'product' && counting.quantityKind === 'divisible' && !(counting.contentAmount && counting.contentAmount > 0 && counting.contentUnit)) {
    return 'content'
  }
  return null
}

function countingPayload(counting: CountingSpec) {
  const kind = counting.quantityKind
  return {
    quantity_kind: kind,
    unit_label: kind === 'bulk' ? 'unit' : counting.unitLabel,
    content_amount: kind === 'divisible' ? counting.contentAmount : null,
    content_unit: kind === 'divisible' ? counting.contentUnit : null,
    bulk_unit: kind === 'bulk' ? (counting.bulkUnit ?? 'kg') : null,
  }
}

/** Una línea tal como la reciben apply_ticket y add_lot (sin prefijo). */
export function linePayload(line: DraftLine) {
  const { target } = line
  const product =
    target.type === 'product'
      ? { product_id: target.productId }
      : target.type === 'catalog'
        ? { catalog_item_id: target.catalogItemId, ...countingPayload(target.counting) }
        : { name: target.name.trim(), category: target.category, ...countingPayload(target.counting) }
  const freezer = line.zone === 'freezer'
  return {
    ...product,
    zone: line.zone,
    quantity: line.quantity,
    brand: line.brand.trim() || null,
    printed_date: line.printedDate || null,
    printed_date_type: line.printedDate ? line.dateType : null,
    barcode: line.barcode,
    image_url: line.imageUrl,
    frozen_at: freezer ? line.frozenAt || null : null,
    reminder_date: freezer ? line.reminderDate || null : null,
  }
}

/** Los parámetros de add_lot para añadir una sola línea a mano o por código. */
export function addLotArgs(line: DraftLine, options: { houseId: string; zoneId: string; purchasedAt: string; source: 'manual' | 'barcode' }) {
  const { target } = line
  const counting = target.type === 'product' ? null : countingPayload(target.counting)
  const freezer = line.zone === 'freezer'
  return {
    p_house_id: options.houseId,
    p_zone_id: options.zoneId,
    p_quantity: line.quantity,
    p_product_id: target.type === 'product' ? target.productId : undefined,
    p_catalog_item_id: target.type === 'catalog' ? target.catalogItemId : undefined,
    p_name: target.type === 'new' ? target.name.trim() : undefined,
    p_category: target.type === 'new' ? target.category : undefined,
    p_quantity_kind: counting?.quantity_kind,
    p_unit_label: counting?.unit_label,
    p_content_amount: counting?.content_amount ?? undefined,
    p_content_unit: counting?.content_unit ?? undefined,
    p_bulk_unit: counting?.bulk_unit ?? undefined,
    p_brand: line.brand.trim() || undefined,
    p_printed_date: line.printedDate || undefined,
    p_printed_date_type: line.printedDate && line.dateType ? line.dateType : undefined,
    p_purchased_at: options.purchasedAt,
    p_frozen_at: freezer ? line.frozenAt || options.purchasedAt : undefined,
    p_reminder_date: freezer ? line.reminderDate || undefined : undefined,
    p_source: options.source,
    p_barcode: line.barcode ?? undefined,
    p_image_url: line.imageUrl ?? undefined,
  }
}
