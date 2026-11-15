// Qué es un código escaneado (SPEC §11): primero lo que la casa ya conoce; si no, Open Food Facts
// y, para emparejarlo con un producto de la casa o del catálogo, la IA (Edge Function match-product).

import type { ProductProposal } from '../../supabase/functions/_shared/productMatch.ts'
import type { CatalogById, InventoryData } from '../domain/inventory'
import { attachScan, emptyLine, targetFromProposal, type DraftLine, type ScanFacts } from '../domain/lotDraft'
import { errorKey, type ErrorKey } from '../lib/errors'
import { invokeFunction } from '../lib/functions'
import { supabase } from '../lib/supabase'
import { lookUpBarcode, toScannedProduct, type ScannedProduct } from './openFoodFacts'

export interface BarcodeResult {
  scanned: ScannedProduct
  /** Producto de la casa: por el código guardado o porque así lo ha identificado la IA. */
  productId: string | null
  /** Lo que propone la IA cuando la casa aún no conoce el código. */
  proposal: ProductProposal | null
  source: 'house' | 'ai' | 'off' | 'none'
  /** Open Food Facts no ha respondido. */
  offline: boolean
  /** La IA no ha podido identificarlo (sin configurar, sin crédito…): se elige a mano. */
  aiError: ErrorKey | null
}

export type ResolveStage = 'looking' | 'identifying'

interface ResolveOptions {
  houseId: string
  house: Pick<InventoryData, 'products'>
  language: string
  /** Con IA: desde ＋ y desde Añadir. Para asignar el código a algo ya elegido, no hace falta. */
  identify: boolean
  signal: AbortSignal
  onStage: (stage: ResolveStage) => void
}

export async function resolveBarcode(barcode: string, options: ResolveOptions): Promise<BarcodeResult> {
  const { houseId, house, language, identify, signal, onStage } = options
  onStage('looking')

  // Un código que la casa ya ha usado lleva a su producto, sin preguntar a nadie.
  const { data: known } = await supabase.from('product_barcodes').select('product_id, brand, image_url').eq('house_id', houseId).eq('barcode', barcode).maybeSingle()
  const product = known && house.products.find((row) => row.id === known.product_id)
  if (known && product) {
    return {
      scanned: { ...toScannedProduct(barcode, null, language), name: product.name, names: [product.name], brand: known.brand, imageUrl: known.image_url },
      productId: known.product_id,
      proposal: null,
      source: 'house',
      offline: false,
      aiError: null,
    }
  }

  let scanned: ScannedProduct
  let offline = false
  try {
    scanned = await lookUpBarcode(barcode, language, signal)
  } catch (error) {
    if (signal.aborted) throw error
    scanned = toScannedProduct(barcode, null, language)
    offline = true
  }
  if (!scanned.name) return { scanned, productId: null, proposal: null, source: 'none', offline, aiError: null }
  if (!identify) return { scanned, productId: null, proposal: null, source: 'off', offline: false, aiError: null }

  onStage('identifying')
  try {
    const proposal = await invokeFunction<ProductProposal>('match-product', {
      house_id: houseId,
      product: { names: scanned.names, brand: scanned.brand, quantity: scanned.quantityText, categories: scanned.categories },
    })
    return { scanned, productId: proposal.matched_product_id, proposal, source: 'ai', offline: false, aiError: null }
  } catch (error) {
    if (signal.aborted) throw error
    return { scanned, productId: null, proposal: null, source: 'off', offline: false, aiError: errorKey(error) }
  }
}

export function scanFacts(result: BarcodeResult): ScanFacts {
  const { scanned } = result
  return { barcode: scanned.barcode, brand: scanned.brand, imageUrl: scanned.imageUrl, contentAmount: scanned.contentAmount, contentUnit: scanned.contentUnit }
}

/** Lo que se va a añadir, si se sabe qué producto es. Si no, hay que elegirlo en el buscador. */
export function lineFromBarcode(result: BarcodeResult, house: InventoryData, catalog: CatalogById): DraftLine | null {
  let line: DraftLine | null = null
  if (result.productId && house.products.some((product) => product.id === result.productId)) {
    line = emptyLine({ type: 'product', productId: result.productId }, house, catalog)
  } else if (result.proposal) {
    const target = targetFromProposal(result.proposal, house.products, catalog)
    const base = emptyLine(target, house, catalog)
    // Por ejemplo, unas judías verdes congeladas van al congelador aunque las del catálogo sean frescas.
    line = target.type === 'product' ? base : { ...base, zone: result.proposal.suggested_zone }
  }
  return line && attachScan(line, scanFacts(result))
}
