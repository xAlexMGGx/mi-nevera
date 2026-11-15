import { describe, expect, it } from 'vitest'
import { brandPhotos, cardImage, extraBrands, isOwnPhoto, photoPath } from './photos'

function lot(overrides: { image_url?: string | null; brand?: string | null; effective_date?: string | null; created_at?: string }) {
  return { image_url: null, brand: null, effective_date: null, created_at: '2026-11-01T10:00:00Z', ...overrides }
}

describe('imagen de la tarjeta', () => {
  it('la foto del lote que caduca antes', () => {
    const lots = [lot({ image_url: 'b.jpg', effective_date: '2026-12-01' }), lot({ image_url: 'a.jpg', effective_date: '2026-11-20' }), lot({ image_url: 'c.jpg' })]
    expect(cardImage(lots, { image_url: 'p.jpg' })).toBe('a.jpg')
  })

  it('si ese lote no tiene, la del producto; si tampoco, la de otro lote; si no, ninguna', () => {
    const lots = [lot({ effective_date: '2026-11-20' }), lot({ image_url: 'b.jpg', effective_date: '2026-12-01' })]
    expect(cardImage(lots, { image_url: 'p.jpg' })).toBe('p.jpg')
    expect(cardImage(lots, { image_url: null })).toBe('b.jpg')
    expect(cardImage([lot({})], { image_url: null })).toBeNull()
  })

  it('a igualdad de fecha, el lote más antiguo', () => {
    const lots = [lot({ image_url: 'nuevo.jpg', created_at: '2026-11-02T00:00:00Z' }), lot({ image_url: 'viejo.jpg', created_at: '2026-11-01T00:00:00Z' })]
    expect(cardImage(lots, { image_url: null })).toBe('viejo.jpg')
  })
})

describe('"+N" marcas', () => {
  it('cuenta las marcas distintas además de una, sin mayúsculas ni lotes sin marca', () => {
    expect(extraBrands([lot({ brand: 'Pascual' }), lot({ brand: 'pascual ' }), lot({ brand: null })])).toBe(0)
    expect(extraBrands([lot({ brand: 'Pascual' }), lot({ brand: 'Hacendado' }), lot({ brand: 'Central' })])).toBe(2)
    expect(extraBrands([])).toBe(0)
  })
})

describe('carrusel del detalle', () => {
  it('una foto por marca, la del lote más próximo de cada una', () => {
    const lots = [
      lot({ brand: 'Pascual', image_url: 'pascual-2.jpg', effective_date: '2026-12-10' }),
      lot({ brand: 'Pascual', image_url: 'pascual-1.jpg', effective_date: '2026-12-01' }),
      lot({ brand: 'Hacendado', image_url: 'hacendado.jpg', effective_date: '2026-12-05' }),
      lot({ brand: 'Central', effective_date: '2026-11-20' }),
      lot({ brand: null, image_url: 'sin-marca.jpg' }),
    ]
    expect(brandPhotos(lots, { image_url: 'producto.jpg' })).toEqual([
      { brand: 'Pascual', ref: 'pascual-1.jpg' },
      { brand: 'Hacendado', ref: 'hacendado.jpg' },
      { brand: null, ref: 'sin-marca.jpg' },
    ])
  })

  it('sin fotos de lotes, la del producto', () => {
    expect(brandPhotos([lot({ brand: 'Pascual' })], { image_url: 'producto.jpg' })).toEqual([{ brand: null, ref: 'producto.jpg' }])
    expect(brandPhotos([], { image_url: null })).toEqual([])
  })
})

describe('fotos propias', () => {
  it('se reconocen por el prefijo y se guarda la ruta del bucket', () => {
    expect(isOwnPhoto('photo:u/f.jpg')).toBe(true)
    expect(isOwnPhoto('https://images.openfoodfacts.org/x.jpg')).toBe(false)
    expect(isOwnPhoto(null)).toBe(false)
    expect(photoPath('photo:u/f.jpg')).toBe('u/f.jpg')
  })
})
