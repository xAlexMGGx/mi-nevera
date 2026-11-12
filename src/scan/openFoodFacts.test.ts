import { describe, expect, it } from 'vitest'
import { cleanBarcode, parseQuantity, toScannedProduct } from './openFoodFacts'

describe('código de barras', () => {
  it('acepta cifras, con espacios o guiones de por medio', () => {
    expect(cleanBarcode(' 8410 0000-00001 ')).toBe('8410000000001')
    expect(cleanBarcode('12345')).toBeNull()
    expect(cleanBarcode('84A0000000001')).toBeNull()
  })
})

describe('cantidad del envase', () => {
  it('lee las formas habituales', () => {
    expect(parseQuantity('1 l')).toEqual({ amount: 1, unit: 'l' })
    expect(parseQuantity('400.0 g')).toEqual({ amount: 400, unit: 'g' })
    expect(parseQuantity('1,5 L')).toEqual({ amount: 1.5, unit: 'l' })
    expect(parseQuantity('6 x 1 L')).toEqual({ amount: 1, unit: 'l' })
    expect(parseQuantity('75 cl')).toEqual({ amount: 750, unit: 'ml' })
    expect(parseQuantity('500gr')).toEqual({ amount: 500, unit: 'g' })
  })

  it('sin unidad conocida no se inventa nada', () => {
    expect(parseQuantity('12 huevos')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity(null)).toBeNull()
  })
})

describe('producto de Open Food Facts', () => {
  const product = {
    product_name: 'Nutella',
    product_name_es: 'Crema de cacao Nutella',
    brands: 'Ferrero, Nutella',
    quantity: '400.0 g',
    image_front_url: 'https://images.openfoodfacts.org/images/products/301/762/401/0701/front_en.100.400.jpg',
  }

  it('usa el nombre en el idioma de la persona, la primera marca y la foto', () => {
    expect(toScannedProduct('3017624010701', product, 'es')).toEqual({
      barcode: '3017624010701',
      name: 'Crema de cacao Nutella',
      brand: 'Ferrero',
      quantityText: '400.0 g',
      contentAmount: 400,
      contentUnit: 'g',
      imageUrl: product.image_front_url,
    })
    expect(toScannedProduct('3017624010701', product, 'en').name).toBe('Nutella')
  })

  it('sin resultado guarda igualmente el código', () => {
    expect(toScannedProduct('8410000000001', null, 'es')).toEqual({
      barcode: '8410000000001',
      name: null,
      brand: null,
      quantityText: null,
      contentAmount: null,
      contentUnit: null,
      imageUrl: null,
    })
  })

  it('descarta fotos que no van por https y textos vacíos', () => {
    const scanned = toScannedProduct('1', { product_name: '  ', image_front_url: 'http://x/y.jpg', brands: ' ' }, 'es')
    expect(scanned).toMatchObject({ name: null, brand: null, imageUrl: null })
  })
})
