// Lectura de tickets (SPEC §10.1): qué se le pide al modelo y cómo se valida lo que devuelve.
// Sin dependencias de Deno, para probarlo con los tests de la app.

import { z } from 'zod'
import { addDays } from './dateStatus.ts'
import {
  categories,
  contentUnits,
  quantityKinds,
  unitLabels,
  zoneKinds,
  type BulkUnit,
  type Category,
  type ContentUnit,
  type QuantityKind,
  type UnitLabel,
  type ZoneKind,
} from './vocabulary.ts'

export const maxLines = 100
const maxProducts = 300
const maxAliases = 300

// Todo obligatorio y sin restricciones numéricas: el formato estructurado de la API no las admite.
// Los límites se aplican después, en toReceiptResult.
export const receiptLineSchema = z.object({
  raw_text: z.string(),
  name: z.string(),
  is_food: z.boolean(),
  product_ref: z.string().nullable(),
  catalog_slug: z.string().nullable(),
  category: z.enum(categories),
  brand: z.string().nullable(),
  quantity: z.number(),
  quantity_kind: z.enum(quantityKinds),
  unit_label: z.enum(unitLabels),
  content_amount: z.number().nullable(),
  content_unit: z.enum(contentUnits).nullable(),
  suggested_zone: z.enum(zoneKinds),
})

export const receiptModelSchema = z.object({
  store: z.string().nullable(),
  date: z.string().nullable(),
  lines: z.array(receiptLineSchema),
})

export type ReceiptModelOutput = z.infer<typeof receiptModelSchema>

export interface CatalogEntry {
  id: string
  slug: string
  name_es: string
  name_en: string
  category: Category
  default_quantity_kind: QuantityKind
  default_unit_label: string
  default_content_amount: number | null
  default_content_unit: ContentUnit | null
}

export interface HouseProduct {
  id: string
  name: string
  catalog_item_id: string | null
  quantity_kind: QuantityKind
  unit_label: string
  content_amount: number | null
  content_unit: ContentUnit | null
  bulk_unit: BulkUnit | null
}

export interface AliasEntry {
  raw_text_normalized: string
  product_id: string
  brand: string | null
}

/** Lo que devuelve `match_ticket_lines`: las líneas que la casa ya conoce. */
export interface AliasMatch {
  raw_text: string
  product_id: string
  brand: string | null
}

/** Una línea tal como la recibe la app (SPEC §10.1, más el producto del catálogo y la categoría). */
export interface ReceiptLine {
  raw_text: string
  name: string
  matched_product_id: string | null
  catalog_item_id: string | null
  brand: string | null
  is_food: boolean
  quantity: number
  quantity_kind: QuantityKind
  unit_label: UnitLabel
  content_amount: number | null
  content_unit: ContentUnit | null
  suggested_zone: ZoneKind
  category: Category
  /** Emparejada por un ticket anterior. */
  from_alias: boolean
}

export interface ReceiptResult {
  store: string | null
  date: string | null
  lines: ReceiptLine[]
}

interface Counting {
  quantity_kind: QuantityKind
  unit_label: string
  content_amount: number | null
  content_unit: ContentUnit | null
  bulk_unit?: BulkUnit | null
}

/** "divisible: brick of 1 l", "count: yogurt", "bulk: kg". */
export function describeCounting(counting: Counting): string {
  if (counting.quantity_kind === 'bulk') return `bulk: ${counting.bulk_unit ?? counting.content_unit ?? 'kg'}`
  if (counting.quantity_kind === 'divisible' && counting.content_amount && counting.content_unit) {
    return `divisible: ${counting.unit_label} of ${counting.content_amount} ${counting.content_unit}`
  }
  return `count: ${counting.unit_label}`
}

/** La parte fija de las instrucciones, con el catálogo base. */
export function receiptSystemPrompt(catalog: readonly CatalogEntry[]): string {
  const catalogLines = catalog
    .map((item) =>
      `${item.slug} · ${item.name_es} / ${item.name_en} · ${item.category} · ${describeCounting({
        quantity_kind: item.default_quantity_kind,
        unit_label: item.default_unit_label,
        content_amount: item.default_content_amount,
        content_unit: item.default_content_unit,
      })}`,
    )
    .join('\n')

  return `You read photos of supermarket receipts, mostly from Spain, for a household food-inventory app. People review everything you return before it is saved, so be accurate rather than complete: never invent items.

Return one entry in "lines" for each purchased item line of the receipt:
- raw_text: the item description exactly as printed (same letters, abbreviations and spacing), without quantity, unit price, total or tax code. Example: "LECHE SEMI HACEND 1L".
- name: a short generic name for the product, in the language requested below, without brand or size, as people say it at home. Example: "Leche semidesnatada".
- is_food: true for food and drinks; false for anything else (cleaning products, toiletries, bags, bottle deposits, gift cards).
- product_ref: if the item is one of the household's products listed in the message, its ref (for example "p3"); otherwise null. Use only refs from that list.
- catalog_slug: if no household product matches but the item is one of the catalog items below, its slug; otherwise null. Use only slugs from the catalog.
- category: the product category.
- brand: the brand if it is printed or clearly abbreviated ("HACEND" is "Hacendado"); store brands count. Otherwise null.
- quantity_kind, unit_label, content_amount, content_unit: how the product is counted at home.
  - count: simple units such as eggs, cans or yogurts. content_amount and content_unit are null.
  - divisible: containers used little by little, such as a 1 l milk brick or a 500 g pasta package. content_amount and content_unit give the content of one container.
  - bulk: sold by weight or volume, such as loose fruit, vegetables or meat from the counter. content_unit is the unit of the quantity (g, kg, ml or l) and content_amount is null.
  For a matched household product or catalog item, use its counting ("counted as").
- quantity: how much to add in that counting: the number of units for count and divisible, the amount in content_unit for bulk. Multipacks count every unit: "6 x 1L" is 6 bricks. "2 x 1,20" is quantity 2. "0,756 kg x 2,49 €/kg" is bulk, quantity 0.756, content_unit kg.
- suggested_zone: where it is usually kept at home: fridge, freezer (frozen products) or pantry.

Also return store (the shop name, or null) and date (the purchase date as YYYY-MM-DD, or null).

Rules:
- Skip totals, payment, change, discounts, coupons, loyalty points, tax summaries and any other line that is not an item.
- If the same product appears on several lines, return one entry per line.
- Do not return expiry dates: the receipt does not have them.
- If the photo is not a receipt or cannot be read, return no lines.

Catalog (slug · Spanish / English name · category · counted as):
${catalogLines}`
}

export interface ReceiptContext {
  locale: string
  today: string
  products: readonly HouseProduct[]
  aliases: readonly AliasEntry[]
  /** Cuántas fotos del mismo ticket se envían. */
  photos?: number
}

/** La parte que cambia en cada casa. Los productos van con referencias cortas en vez de uuid. */
export function receiptUserText({ locale, today, products, aliases, photos = 1 }: ReceiptContext) {
  const listed = products.slice(0, maxProducts)
  const refs = new Map(listed.map((product, index) => [`p${index + 1}`, product.id]))
  const refOf = new Map(listed.map((product, index) => [product.id, `p${index + 1}`]))

  const productLines = listed.map((product, index) => `p${index + 1} · ${product.name} · ${describeCounting(product)}`).join('\n')
  const aliasLines = aliases
    .slice(0, maxAliases)
    .flatMap((alias) => {
      const ref = refOf.get(alias.product_id)
      return ref ? [`"${alias.raw_text_normalized}" → ${ref}${alias.brand ? ` (${alias.brand})` : ''}`] : []
    })
    .join('\n')

  const text = `Today is ${today}. Write the names in ${locale === 'en' ? 'English' : 'Spanish'}.

Household products (ref · name · counted as):
${productLines || '(none yet)'}

Receipt lines this household has already confirmed (receipt text, lowercased → product ref):
${aliasLines || '(none yet)'}

${
  photos > 1
    ? `The ${photos} photos are consecutive parts of the same receipt, from top to bottom. They may overlap: return a line that appears in two photos only once.`
    : 'Read the receipt in the photo.'
}`

  return { text, refs }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function cleanText(value: string | null, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

const enumFields = ['category', 'quantity_kind', 'unit_label', 'content_unit', 'suggested_zone'] as const

/** El modelo puede devolver un valor de una lista con otras mayúsculas (lo avisa la documentación). */
function lowercaseEnums(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { lines?: unknown }).lines)) return raw
  const lines = (raw as { lines: unknown[] }).lines.map((line) => {
    if (!line || typeof line !== 'object') return line
    const copy: Record<string, unknown> = { ...(line as Record<string, unknown>) }
    for (const field of enumFields) if (typeof copy[field] === 'string') copy[field] = (copy[field] as string).toLowerCase()
    return copy
  })
  return { ...(raw as object), lines }
}

/** El texto de la respuesta, validado. Null si no es JSON o no tiene la forma pedida. */
export function parseReceiptOutput(text: string): ReceiptModelOutput | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = receiptModelSchema.safeParse(lowercaseEnums(raw))
  return parsed.success ? parsed.data : null
}

/** Los textos de línea que se buscan entre los alias de la casa, igual que los usa toReceiptResult. */
export function receiptRawTexts(output: ReceiptModelOutput): string[] {
  return [...new Set(output.lines.slice(0, maxLines).flatMap((line) => cleanText(line.raw_text, 200) ?? []))]
}

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null
}

const maxQuantity = 999

function cleanCounting(line: ReceiptModelOutput['lines'][number]) {
  let kind = line.quantity_kind
  const unit: UnitLabel = line.unit_label === 'serving' ? 'unit' : line.unit_label
  let contentAmount = positive(line.content_amount)
  let contentUnit = line.content_unit

  // Sin contenido no se puede contar por envases, y a granel hace falta una unidad de peso o volumen.
  if (kind === 'divisible' && (!contentAmount || !contentUnit)) kind = 'count'
  if (kind === 'bulk' && (!contentUnit || contentUnit === 'ud')) kind = 'count'
  if (kind === 'count') {
    contentAmount = null
    contentUnit = null
  }
  if (kind === 'bulk') contentAmount = null

  const raw = positive(line.quantity)
  const quantity =
    kind === 'bulk'
      ? Math.min(maxQuantity, raw ? Math.round(raw * 1000) / 1000 : 1)
      : Math.min(maxQuantity, Math.max(1, Math.round(raw ?? 1)))

  return { quantity_kind: kind, unit_label: unit, content_amount: contentAmount, content_unit: contentUnit, quantity }
}

export interface ResultContext {
  today: string
  /** Referencia corta → id del producto, de receiptUserText. */
  refs: ReadonlyMap<string, string>
  products: readonly HouseProduct[]
  catalog: readonly CatalogEntry[]
  aliasMatches: readonly AliasMatch[]
}

/** Lo validado, con límites, ids reales y lo aprendido de tickets anteriores, que manda sobre el modelo. */
export function toReceiptResult(output: ReceiptModelOutput, context: ResultContext): ReceiptResult {
  const catalogBySlug = new Map(context.catalog.map((item) => [item.slug, item]))
  const productByCatalog = new Map(context.products.flatMap((product) => (product.catalog_item_id ? [[product.catalog_item_id, product.id] as const] : [])))
  const aliasByText = new Map(context.aliasMatches.map((match) => [match.raw_text, match]))

  const date = output.date && isIsoDate(output.date) && output.date <= context.today && output.date >= addDays(context.today, -365) ? output.date : null

  const lines = output.lines.slice(0, maxLines).flatMap<ReceiptLine>((line) => {
    const rawText = cleanText(line.raw_text, 200)
    const name = cleanText(line.name, 80) ?? (rawText ? rawText.slice(0, 80) : null)
    if (!name) return []

    const catalogItem = line.catalog_slug ? catalogBySlug.get(line.catalog_slug.trim().toLowerCase()) : undefined
    let productId = line.product_ref ? (context.refs.get(line.product_ref.trim().toLowerCase()) ?? null) : null
    // El modelo eligió el catálogo, pero la casa ya tiene ese producto.
    if (!productId && catalogItem) productId = productByCatalog.get(catalogItem.id) ?? null

    let brand = cleanText(line.brand, 80)
    const alias = rawText ? aliasByText.get(rawText) : undefined
    if (alias) {
      productId = alias.product_id
      brand = alias.brand ?? brand
    }

    return [
      {
        raw_text: rawText ?? '',
        name,
        matched_product_id: productId,
        catalog_item_id: productId ? null : (catalogItem?.id ?? null),
        brand,
        is_food: line.is_food,
        ...cleanCounting(line),
        suggested_zone: line.suggested_zone,
        category: catalogItem?.category ?? line.category,
        from_alias: Boolean(alias),
      },
    ]
  })

  return { store: cleanText(output.store, 80), date, lines }
}
