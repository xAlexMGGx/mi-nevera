// Datos de producto por código de barras (SPEC §11) con la API pública de Open Food Facts.
// Se consulta desde el móvil: el límite de 15 lecturas por minuto es por dirección, y así es de cada persona.

import type { ContentUnit } from '../domain/types'

const fields = [
  'code',
  'product_name',
  'product_name_es',
  'product_name_en',
  'generic_name_es',
  'generic_name',
  'brands',
  'quantity',
  'image_front_url',
  'image_url',
].join(',')

export interface ScannedProduct {
  barcode: string
  /** Lo que se sabe del producto. Sin resultado, solo hay código. */
  name: string | null
  brand: string | null
  /** "1 l", "400 g", tal cual lo da Open Food Facts. */
  quantityText: string | null
  contentAmount: number | null
  contentUnit: ContentUnit | null
  imageUrl: string | null
}

interface OffProduct {
  product_name?: string
  product_name_es?: string
  product_name_en?: string
  generic_name_es?: string
  generic_name?: string
  brands?: string
  quantity?: string
  image_front_url?: string
  image_url?: string
}

/** EAN-8, EAN-13, UPC-A y UPC-E: solo cifras. */
export function cleanBarcode(text: string): string | null {
  const digits = text.replace(/[\s-]/g, '')
  return /^\d{6,14}$/.test(digits) ? digits : null
}

const unitAliases: Record<string, ContentUnit> = {
  g: 'g',
  gr: 'g',
  grs: 'g',
  gramos: 'g',
  kg: 'kg',
  ml: 'ml',
  cl: 'ml',
  l: 'l',
  lt: 'l',
  litro: 'l',
  litros: 'l',
}

/** "1 l", "400.0 g", "6 x 1 L" (el contenido de cada envase), "75 cl". */
export function parseQuantity(text: string | null | undefined): { amount: number; unit: ContentUnit } | null {
  if (!text) return null
  const match = /(?:\d+\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)\b/.exec(text.trim())
  if (!match) return null
  const unit = unitAliases[match[2]!.toLowerCase()]
  const value = Number(match[1]!.replace(',', '.'))
  if (!unit || !Number.isFinite(value) || value <= 0) return null
  // Los centilitros se guardan como mililitros.
  return match[2]!.toLowerCase() === 'cl' ? { amount: value * 10, unit } : { amount: value, unit }
}

function text(value: string | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed : null
}

function secureUrl(value: string | undefined): string | null {
  return value && /^https:\/\/\S+$/.test(value) ? value : null
}

export function toScannedProduct(barcode: string, product: OffProduct | null, language: string): ScannedProduct {
  const names =
    language === 'en'
      ? [product?.product_name_en, product?.product_name, product?.product_name_es]
      : [product?.product_name_es, product?.product_name, product?.product_name_en]
  const name = [...names, product?.generic_name_es, product?.generic_name].map(text).find(Boolean) ?? null
  const quantityText = text(product?.quantity)
  const quantity = parseQuantity(quantityText)
  return {
    barcode,
    name: name ? name.slice(0, 80) : null,
    brand: text(product?.brands?.split(',')[0])?.slice(0, 80) ?? null,
    quantityText,
    contentAmount: quantity?.amount ?? null,
    contentUnit: quantity?.unit ?? null,
    imageUrl: secureUrl(product?.image_front_url) ?? secureUrl(product?.image_url),
  }
}

/** Devuelve lo que haya. Si el producto no está en Open Food Facts, solo el código (SPEC §11). */
export async function lookUpBarcode(barcode: string, language: string, signal?: AbortSignal): Promise<ScannedProduct> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=${fields}`
  // El navegador no deja cambiar el User-Agent; Open Food Facts admite identificarse con esta cabecera.
  const response = await fetch(url, { signal, headers: { 'X-User-Agent': `NeveraDigital/1.0 (${window.location.origin})` } })
  if (response.status === 404) return toScannedProduct(barcode, null, language)
  if (!response.ok) throw new Error('off_unavailable')
  const body = (await response.json()) as { status?: number; product?: OffProduct }
  return toScannedProduct(barcode, body.status === 1 ? (body.product ?? null) : null, language)
}
