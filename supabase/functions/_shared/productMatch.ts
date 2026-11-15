// Identificar un producto escaneado (SPEC §11): lo que da Open Food Facts, en cualquier idioma, se
// empareja con un producto de la casa o del catálogo, o se propone uno nuevo con un nombre genérico.
// Sin dependencias de Deno, para probarlo con los tests de la app.

import { z } from 'zod'
import { cleanCounting, cleanText, productListing, type CatalogEntry, type HouseProduct } from './receipt.ts'
import {
  categories,
  contentUnits,
  quantityKinds,
  unitLabels,
  zoneKinds,
  type Category,
  type ContentUnit,
  type QuantityKind,
  type UnitLabel,
  type ZoneKind,
} from './vocabulary.ts'

export const productModelSchema = z.object({
  product_ref: z.string().nullable(),
  catalog_slug: z.string().nullable(),
  name: z.string(),
  category: z.enum(categories),
  quantity_kind: z.enum(quantityKinds),
  unit_label: z.enum(unitLabels),
  content_amount: z.number().nullable(),
  content_unit: z.enum(contentUnits).nullable(),
  suggested_zone: z.enum(zoneKinds),
})

export type ProductModelOutput = z.infer<typeof productModelSchema>

/** Lo que la app sabe del código por Open Food Facts. */
export interface ScannedDescription {
  /** Nombres en el idioma que haya: el de la persona primero. */
  names: string[]
  brand: string | null
  /** "400 g", "6 x 1 l". */
  quantity: string | null
  /** Etiquetas de categoría de Open Food Facts, como "en:green-beans". */
  categories: string[]
}

/** Lo que manda la app, con límites: viene de una base de datos pública que cualquiera puede editar. */
export function cleanDescription(raw: unknown): ScannedDescription | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const texts = (list: unknown, max: number, length: number) =>
    Array.isArray(list) ? [...new Set(list.flatMap((item) => (typeof item === 'string' ? (cleanText(item, length) ?? []) : [])))].slice(0, max) : []
  const names = texts(value.names, 6, 160)
  if (names.length === 0) return null
  return {
    names,
    brand: typeof value.brand === 'string' ? cleanText(value.brand, 80) : null,
    quantity: typeof value.quantity === 'string' ? cleanText(value.quantity, 40) : null,
    categories: texts(value.categories, 12, 80),
  }
}

/** Las instrucciones. El catálogo va antes, en un bloque aparte que se puede reutilizar (caché). */
export const productTask = `You identify a packaged food product scanned by its barcode, for a household food-inventory app in Spain. The product data comes from Open Food Facts and may be in any language. People review your answer before anything is saved.

Return:
- product_ref: if the product is one of the household's products listed in the message, its ref (for example "p3"); otherwise null. Use only refs from that list.
- catalog_slug: if no household product matches but the product is one of the catalog items above, its slug; otherwise null. Use only slugs from the catalog.
- name: a short generic name in the language requested in the message, without brand or size, as people say it at home: "Judías verdes", not "Haricots verts extra-fins Bonduelle 400 g". If it matches a household product or a catalog item, use that name.
- category: the product category.
- quantity_kind, unit_label, content_amount, content_unit: how it is counted at home.
  - count: simple units such as cans, yogurts or bags used at once. content_amount and content_unit are null.
  - divisible: containers used little by little, such as a 1 l milk brick or a 400 g jar. content_amount and content_unit give the content of one container, from the package quantity.
  - bulk: sold by weight or volume. content_unit is the unit (g, kg, ml or l) and content_amount is null.
  For a household product, use its counting.
- suggested_zone: where it is usually kept at home: fridge, freezer (frozen products) or pantry.

Rules:
- Match by what the product is, in any language and regardless of brand or size: "Haricots verts extra-fins" is "Judías verdes", and frozen green beans are still green beans unless the household has them as a separate product.
- Do not match different products that only share a word: "Tomate frito" is not "Tomates", and "Leche de coco" is not "Leche".
- If you are not sure, return no match and a good generic name: a new product is easy to fix, a wrong match is not.`

export function productUserText({ locale, products, description }: { locale: string; products: readonly HouseProduct[]; description: ScannedDescription }) {
  const { refs, lines } = productListing(products)
  const text = `Write the name in ${locale === 'en' ? 'English' : 'Spanish'}.

Household products (ref · name · counted as):
${lines}

Scanned product (Open Food Facts):
Names: ${description.names.map((name) => `"${name}"`).join(', ')}
Brand: ${description.brand ?? 'unknown'}
Package quantity: ${description.quantity ?? 'unknown'}
Categories: ${description.categories.join(', ') || 'unknown'}`
  return { text, refs }
}

/** El texto de la respuesta, validado. Null si no es JSON o no tiene la forma pedida. */
export function parseProductOutput(text: string): ProductModelOutput | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw && typeof raw === 'object') {
    const copy = { ...(raw as Record<string, unknown>) }
    for (const field of ['category', 'quantity_kind', 'unit_label', 'content_unit', 'suggested_zone']) {
      if (typeof copy[field] === 'string') copy[field] = (copy[field] as string).toLowerCase()
    }
    raw = copy
  }
  const parsed = productModelSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Lo que recibe la app: a qué producto corresponde o cómo crearlo. */
export interface ProductProposal {
  matched_product_id: string | null
  catalog_item_id: string | null
  name: string
  category: Category
  quantity_kind: QuantityKind
  unit_label: UnitLabel
  content_amount: number | null
  content_unit: ContentUnit | null
  suggested_zone: ZoneKind
}

export interface ProposalContext {
  refs: ReadonlyMap<string, string>
  products: readonly HouseProduct[]
  catalog: readonly CatalogEntry[]
  description: ScannedDescription
}

export function toProductProposal(output: ProductModelOutput, context: ProposalContext): ProductProposal {
  const catalogItem = output.catalog_slug ? context.catalog.find((item) => item.slug === output.catalog_slug!.trim().toLowerCase()) : undefined
  let productId = output.product_ref ? (context.refs.get(output.product_ref.trim().toLowerCase()) ?? null) : null
  // El modelo eligió el catálogo, pero la casa ya tiene ese producto.
  if (!productId && catalogItem) productId = context.products.find((product) => product.catalog_item_id === catalogItem.id)?.id ?? null

  const counting = cleanCounting({ ...output, quantity: 1 })
  return {
    matched_product_id: productId,
    catalog_item_id: productId ? null : (catalogItem?.id ?? null),
    name: cleanText(output.name, 80) ?? context.description.names[0]!.slice(0, 80),
    category: catalogItem?.category ?? output.category,
    quantity_kind: counting.quantity_kind,
    unit_label: counting.unit_label,
    content_amount: counting.content_amount,
    content_unit: counting.content_unit,
    suggested_zone: output.suggested_zone,
  }
}
