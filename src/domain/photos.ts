// Fotos de las tarjetas y del detalle (SPEC §12). Una foto es una URL de Open Food Facts o una foto
// propia en Storage, guardada como "photo:<ruta>".

import type { Lot, Product } from './inventory'

type PhotoLot = Pick<Lot, 'image_url' | 'brand' | 'effective_date' | 'created_at'>

export const ownPhotoPrefix = 'photo:'

export function isOwnPhoto(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && ref.startsWith(ownPhotoPrefix)
}

/** La ruta en el bucket de una foto propia. */
export function photoPath(ref: string): string {
  return ref.slice(ownPhotoPrefix.length)
}

/** La fecha más próxima primero; sin fecha, al final; a igualdad, el más antiguo. */
function byNearest(a: PhotoLot, b: PhotoLot) {
  if (a.effective_date !== b.effective_date) {
    if (!a.effective_date) return 1
    if (!b.effective_date) return -1
    return a.effective_date < b.effective_date ? -1 : 1
  }
  return a.created_at.localeCompare(b.created_at)
}

/**
 * La imagen de una tarjeta: la foto del lote con fecha efectiva más próxima; si no tiene, la del
 * producto; si tampoco, la de otro lote. Sin ninguna, null: se enseña el icono.
 */
export function cardImage(lots: readonly PhotoLot[], product: Pick<Product, 'image_url'>): string | null {
  const sorted = [...lots].sort(byNearest)
  return sorted[0]?.image_url ?? product.image_url ?? sorted.find((lot) => lot.image_url)?.image_url ?? null
}

function brandKey(brand: string | null) {
  return brand?.trim().toLowerCase() || null
}

/** "+N": cuántas marcas más hay, sin contar los lotes sin marca. */
export function extraBrands(lots: readonly Pick<Lot, 'brand'>[]): number {
  const brands = new Set(lots.flatMap((lot) => brandKey(lot.brand) ?? []))
  return Math.max(0, brands.size - 1)
}

export interface BrandPhoto {
  brand: string | null
  ref: string
}

/** El carrusel del detalle: una foto por marca, la del lote más próximo de cada una. */
export function brandPhotos(lots: readonly PhotoLot[], product: Pick<Product, 'image_url'>): BrandPhoto[] {
  const seen = new Set<string | null>()
  const photos: BrandPhoto[] = []
  for (const lot of [...lots].sort(byNearest)) {
    const key = brandKey(lot.brand)
    if (!lot.image_url || seen.has(key)) continue
    seen.add(key)
    photos.push({ brand: lot.brand?.trim() || null, ref: lot.image_url })
  }
  if (photos.length === 0 && product.image_url) photos.push({ brand: null, ref: product.image_url })
  return photos
}
