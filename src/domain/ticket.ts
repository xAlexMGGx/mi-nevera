// Vista previa del ticket (SPEC §10.1): el borrador que se revisa antes de aplicar nada.
// Cada línea es un lote como los del alta manual (lotDraft.ts).

import type { ReceiptLine, ReceiptResult } from '../../supabase/functions/_shared/receipt.ts'
import type { CatalogById } from './inventory'
import {
  defaultZone,
  linePayload,
  newLineKey,
  normalizeName,
  productCounting,
  type CountingSpec,
  type DraftLine,
  type HouseData,
  type LineTarget,
} from './lotDraft'
import type { BulkUnit } from './types'

export interface TicketDraft {
  /** 2: el producto lleva su forma de contar (fase 4, segunda parte). */
  version: 2
  houseId: string
  store: string | null
  purchasedAt: string
  lines: DraftLine[]
}

/** La cantidad del ticket viene en esta forma de contar, así que la línea la conserva. */
function receiptCounting(line: ReceiptLine): CountingSpec {
  const kind = line.quantity_kind
  return {
    quantityKind: kind,
    unitLabel: kind === 'bulk' ? 'unit' : line.unit_label,
    contentAmount: kind === 'divisible' ? line.content_amount : null,
    contentUnit: kind === 'divisible' ? line.content_unit : null,
    bulkUnit: kind === 'bulk' ? ((line.content_unit as BulkUnit | null) ?? 'kg') : null,
  }
}

export function draftFromReceipt(result: ReceiptResult, houseId: string, today: string, house: HouseData, catalog: CatalogById): TicketDraft {
  const productIds = new Set(house.products.map((product) => product.id))
  const lines = result.lines.map<DraftLine>((line) => {
    const target: LineTarget =
      line.matched_product_id && productIds.has(line.matched_product_id)
        ? { type: 'product', productId: line.matched_product_id }
        : line.catalog_item_id && catalog.has(line.catalog_item_id)
          ? { type: 'catalog', catalogItemId: line.catalog_item_id, counting: receiptCounting(line) }
          : { type: 'new', name: line.name, category: line.category, counting: receiptCounting(line) }
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
      frozenAt: '',
      reminderDate: '',
    }
  })
  return { version: 2, houseId, store: result.store, purchasedAt: result.date ?? today, lines }
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
        ? { type: 'catalog', catalogItemId: product.catalog_item_id, counting: productCounting(product) }
        : { type: 'new', name: product.name, category: product.category, counting: productCounting(product) }
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

/** Lo que recibe apply_ticket: solo las líneas marcadas, cada una con su texto del ticket. */
export function applyPayload(draft: TicketDraft) {
  return draft.lines.filter((line) => line.checked).map((line) => ({ ...linePayload(line), raw_text: line.rawText }))
}

/** Un borrador guardado es de confianza solo si tiene la forma esperada. */
export function isTicketDraft(value: unknown): value is TicketDraft {
  const draft = value as Partial<TicketDraft> | null
  return (
    !!draft &&
    draft.version === 2 &&
    typeof draft.houseId === 'string' &&
    typeof draft.purchasedAt === 'string' &&
    Array.isArray(draft.lines) &&
    draft.lines.every(
      (line) =>
        typeof line?.key === 'string' &&
        typeof line.quantity === 'number' &&
        typeof line.frozenAt === 'string' &&
        (line.target?.type === 'product' || typeof (line.target as { counting?: unknown } | undefined)?.counting === 'object'),
    )
  )
}
