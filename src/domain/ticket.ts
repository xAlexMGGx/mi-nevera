// Vista previa del ticket (SPEC §10.1): el borrador que se revisa antes de aplicar nada.

import type { ReceiptResult } from '../../supabase/functions/_shared/receipt.ts'
import type { CatalogById, Lot, Product, Zone } from './inventory'
import type { BulkUnit, Category, ContentUnit, PrintedDateType, QuantityKind, UnitLabel, ZoneKind } from './types'

export type LineTarget =
  | { type: 'product'; productId: string }
  | { type: 'catalog'; catalogItemId: string }
  | {
      type: 'new'
      name: string
      category: Category
      quantityKind: QuantityKind
      unitLabel: UnitLabel | string
      contentAmount: number | null
      contentUnit: ContentUnit | null
      bulkUnit: BulkUnit | null
    }

export interface DraftLine {
  key: string
  checked: boolean
  /** Tal como venía en el ticket. Las líneas añadidas a mano no tienen. */
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
}

export interface TicketDraft {
  version: 1
  houseId: string
  store: string | null
  purchasedAt: string
  lines: DraftLine[]
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

/** Donde suele estar: la zona de sus existencias, la del catálogo o la que propone el ticket. */
function defaultZone(target: LineTarget, house: HouseData, catalog: CatalogById, suggested: ZoneKind): ZoneKind {
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

export function draftFromReceipt(result: ReceiptResult, houseId: string, today: string, house: HouseData, catalog: CatalogById): TicketDraft {
  const productIds = new Set(house.products.map((product) => product.id))
  const lines = result.lines.map<DraftLine>((line) => {
    const target: LineTarget =
      line.matched_product_id && productIds.has(line.matched_product_id)
        ? { type: 'product', productId: line.matched_product_id }
        : line.catalog_item_id && catalog.has(line.catalog_item_id)
          ? { type: 'catalog', catalogItemId: line.catalog_item_id }
          : {
              type: 'new',
              name: line.name,
              category: line.category,
              quantityKind: line.quantity_kind,
              unitLabel: line.unit_label,
              contentAmount: line.quantity_kind === 'divisible' ? line.content_amount : null,
              contentUnit: line.quantity_kind === 'divisible' ? line.content_unit : null,
              bulkUnit: line.quantity_kind === 'bulk' ? (line.content_unit as BulkUnit | null) : null,
            }
    return {
      key: newLineKey(),
      // Lo que no es comida (el detergente) llega desmarcado.
      checked: line.is_food,
      rawText: line.raw_text || null,
      fromAlias: line.from_alias && target.type === 'product',
      target,
      quantity: line.quantity,
      zone: defaultZone(target, house, catalog, line.suggested_zone),
      brand: line.brand ?? '',
      printedDate: '',
      dateType: null,
      barcode: null,
      imageUrl: null,
    }
  })
  return { version: 1, houseId, store: result.store, purchasedAt: result.date ?? today, lines }
}

/** Una línea añadida a mano desde la vista previa. */
export function manualLine(target: LineTarget, house: HouseData, catalog: CatalogById): DraftLine {
  return {
    key: newLineKey(),
    checked: true,
    rawText: null,
    fromAlias: false,
    target,
    quantity: 1,
    zone: defaultZone(target, house, catalog, 'fridge'),
    brand: '',
    printedDate: '',
    dateType: null,
    barcode: null,
    imageUrl: null,
  }
}

/** Cambia el producto de una línea. La zona sigue al producto. */
export function retargetLine(line: DraftLine, target: LineTarget, house: HouseData, catalog: CatalogById): DraftLine {
  return { ...line, target, fromAlias: false, zone: defaultZone(target, house, catalog, line.zone) }
}

export interface Counting {
  quantity_kind: QuantityKind
  unit_label: string
  bulk_unit: BulkUnit | null
}

/** Cómo se cuenta lo que añade la línea, para mostrar la cantidad. */
export function lineCounting(target: LineTarget, products: readonly Product[], catalog: CatalogById): Counting {
  if (target.type === 'product') {
    const product = products.find((row) => row.id === target.productId)
    if (product) return { quantity_kind: product.quantity_kind, unit_label: product.unit_label, bulk_unit: product.bulk_unit as BulkUnit | null }
  }
  if (target.type === 'catalog') {
    const item = catalog.get(target.catalogItemId)
    if (item) {
      return {
        quantity_kind: item.default_quantity_kind,
        unit_label: item.default_unit_label,
        bulk_unit: item.default_quantity_kind === 'bulk' ? (item.default_content_unit as BulkUnit | null) : null,
      }
    }
  }
  if (target.type === 'new') return { quantity_kind: target.quantityKind, unit_label: target.unitLabel, bulk_unit: target.bulkUnit }
  return { quantity_kind: 'count', unit_label: 'unit', bulk_unit: null }
}

/**
 * Otra casa destino: sus productos son otros. Se busca el mismo producto (por catálogo o nombre) y,
 * si no lo tiene, se creará allí con la misma forma de contar. Los alias son de cada casa.
 */
export function moveDraftToHouse(draft: TicketDraft, houseId: string, from: HouseData, to: HouseData): TicketDraft {
  const lines = draft.lines.map<DraftLine>((line) => {
    if (line.target.type !== 'product') return { ...line, fromAlias: false }
    const productId = line.target.productId
    const product = from.products.find((row) => row.id === productId)
    if (!product) return line
    const match =
      to.products.find((row) => row.kind === 'food' && product.catalog_item_id !== null && row.catalog_item_id === product.catalog_item_id) ??
      to.products.find((row) => row.kind === 'food' && normalizeName(row.name) === normalizeName(product.name))
    const target: LineTarget = match
      ? { type: 'product', productId: match.id }
      : product.catalog_item_id && !product.name_customized
        ? { type: 'catalog', catalogItemId: product.catalog_item_id }
        : {
            type: 'new',
            name: product.name,
            category: product.category,
            quantityKind: product.quantity_kind,
            unitLabel: product.unit_label,
            contentAmount: product.content_amount,
            contentUnit: product.content_unit,
            bulkUnit: product.bulk_unit as BulkUnit | null,
          }
    return { ...line, target, fromAlias: false }
  })
  return { ...draft, houseId, lines }
}

/** Divide una línea de varias unidades en dos lotes, para poner fechas distintas (SPEC §10.3). */
export function splitLine(draft: TicketDraft, key: string): TicketDraft {
  const index = draft.lines.findIndex((line) => line.key === key)
  const line = draft.lines[index]
  if (!line || !Number.isInteger(line.quantity) || line.quantity < 2) return draft
  const copy: DraftLine = { ...line, key: newLineKey(), quantity: 1, printedDate: '', dateType: null }
  const lines = [...draft.lines]
  lines.splice(index, 1, { ...line, quantity: line.quantity - 1 }, copy)
  return { ...draft, lines }
}

export function updateLine(draft: TicketDraft, key: string, patch: Partial<DraftLine>): TicketDraft {
  return { ...draft, lines: draft.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }
}

export function removeLine(draft: TicketDraft, key: string): TicketDraft {
  return { ...draft, lines: draft.lines.filter((line) => line.key !== key) }
}

/** Las líneas marcadas sin fecha, en orden: lo que recorre el escaneo en cadena. */
export function chainQueue(draft: TicketDraft): string[] {
  return draft.lines.filter((line) => line.checked && !line.printedDate).map((line) => line.key)
}

export type LineProblem = 'quantity' | 'dateType' | 'name' | 'content'

export function lineProblem(line: DraftLine, counting: Counting): LineProblem | null {
  const integer = counting.quantity_kind !== 'bulk'
  if (!(line.quantity > 0) || (integer && !Number.isInteger(line.quantity))) return 'quantity'
  if (line.printedDate && !line.dateType) return 'dateType'
  if (line.target.type === 'new') {
    if (!line.target.name.trim()) return 'name'
    if (line.target.quantityKind === 'divisible' && !(line.target.contentAmount && line.target.contentAmount > 0 && line.target.contentUnit)) return 'content'
  }
  return null
}

/** Lo que recibe apply_ticket: solo las líneas marcadas. */
export function applyPayload(draft: TicketDraft) {
  return draft.lines
    .filter((line) => line.checked)
    .map((line) => {
      const { target } = line
      const product =
        target.type === 'product'
          ? { product_id: target.productId }
          : target.type === 'catalog'
            ? { catalog_item_id: target.catalogItemId }
            : {
                name: target.name.trim(),
                category: target.category,
                quantity_kind: target.quantityKind,
                unit_label: target.quantityKind === 'bulk' ? 'unit' : target.unitLabel,
                content_amount: target.quantityKind === 'divisible' ? target.contentAmount : null,
                content_unit: target.quantityKind === 'divisible' ? target.contentUnit : null,
                bulk_unit: target.quantityKind === 'bulk' ? (target.bulkUnit ?? 'kg') : null,
              }
      return {
        ...product,
        zone: line.zone,
        quantity: line.quantity,
        brand: line.brand.trim() || null,
        printed_date: line.printedDate || null,
        printed_date_type: line.printedDate ? line.dateType : null,
        barcode: line.barcode,
        image_url: line.imageUrl,
        raw_text: line.rawText,
      }
    })
}

/** Un borrador guardado es de confianza solo si tiene la forma esperada. */
export function isTicketDraft(value: unknown): value is TicketDraft {
  const draft = value as Partial<TicketDraft> | null
  return (
    !!draft &&
    draft.version === 1 &&
    typeof draft.houseId === 'string' &&
    typeof draft.purchasedAt === 'string' &&
    Array.isArray(draft.lines) &&
    draft.lines.every((line) => typeof line?.key === 'string' && typeof line.quantity === 'number' && typeof line.target?.type === 'string')
  )
}
