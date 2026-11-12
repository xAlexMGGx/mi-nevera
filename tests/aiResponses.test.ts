import { describe, expect, it } from 'vitest'
import { checkImage, maxImageBytes } from '../supabase/functions/_shared/image.ts'
import { dateSystemPrompt, parseDateOutput, toDateResult, type DateModelOutput } from '../supabase/functions/_shared/readDate.ts'
import {
  describeCounting,
  parseReceiptOutput,
  receiptRawTexts,
  receiptSystemPrompt,
  receiptUserText,
  toReceiptResult,
  type CatalogEntry,
  type HouseProduct,
  type ReceiptModelOutput,
} from '../supabase/functions/_shared/receipt.ts'

const today = '2026-11-11'

const catalog: CatalogEntry[] = [
  {
    id: 'cat-milk',
    slug: 'leche-semidesnatada',
    name_es: 'Leche semidesnatada',
    name_en: 'Semi-skimmed milk',
    category: 'dairy_eggs',
    default_quantity_kind: 'divisible',
    default_unit_label: 'brick',
    default_content_amount: 1,
    default_content_unit: 'l',
  },
  {
    id: 'cat-tomato',
    slug: 'tomate',
    name_es: 'Tomate',
    name_en: 'Tomato',
    category: 'vegetables',
    default_quantity_kind: 'bulk',
    default_unit_label: 'unit',
    default_content_amount: null,
    default_content_unit: 'kg',
  },
]

const products: HouseProduct[] = [
  { id: 'prod-eggs', name: 'Huevos', catalog_item_id: null, quantity_kind: 'count', unit_label: 'egg', content_amount: null, content_unit: null, bulk_unit: null },
  { id: 'prod-tomato', name: 'Tomate', catalog_item_id: 'cat-tomato', quantity_kind: 'bulk', unit_label: 'unit', content_amount: null, content_unit: null, bulk_unit: 'kg' },
]

type Line = ReceiptModelOutput['lines'][number]

function line(overrides: Partial<Line> = {}): Line {
  return {
    raw_text: 'LECHE SEMI HACEND 1L',
    name: 'Leche semidesnatada',
    is_food: true,
    product_ref: null,
    catalog_slug: 'leche-semidesnatada',
    category: 'dairy_eggs',
    brand: 'Hacendado',
    quantity: 6,
    quantity_kind: 'divisible',
    unit_label: 'brick',
    content_amount: 1,
    content_unit: 'l',
    suggested_zone: 'fridge',
    ...overrides,
  }
}

function output(lines: Line[], extra: Partial<ReceiptModelOutput> = {}): ReceiptModelOutput {
  return { store: 'Mercadona', date: '2026-11-10', lines, ...extra }
}

function result(model: ReceiptModelOutput, aliasMatches: { raw_text: string; product_id: string; brand: string | null }[] = []) {
  const { refs } = receiptUserText({ locale: 'es', today, products, aliases: [] })
  return toReceiptResult(model, { today, refs, products, catalog, aliasMatches })
}

describe('respuesta del ticket', () => {
  it('acepta solo JSON con la forma pedida', () => {
    expect(parseReceiptOutput(JSON.stringify(output([line()])))).toEqual(output([line()]))
    expect(parseReceiptOutput('no es JSON')).toBeNull()
    expect(parseReceiptOutput(JSON.stringify({ store: null, date: null }))).toBeNull()
    expect(parseReceiptOutput(JSON.stringify(output([{ ...line(), quantity: '6' as unknown as number }])))).toBeNull()
    expect(parseReceiptOutput(JSON.stringify(output([{ ...line(), suggested_zone: 'garage' as never }])))).toBeNull()
    const withoutIsFood: Partial<Line> = line()
    delete withoutIsFood.is_food
    expect(parseReceiptOutput(JSON.stringify(output([withoutIsFood as Line])))).toBeNull()
  })

  it('admite una lista con otras mayúsculas', () => {
    const parsed = parseReceiptOutput(JSON.stringify(output([line({ suggested_zone: 'Fridge' as never, category: 'DAIRY_EGGS' as never })])))
    expect(parsed?.lines[0]).toMatchObject({ suggested_zone: 'fridge', category: 'dairy_eggs' })
  })

  it('traduce las referencias cortas a productos de la casa y descarta las inventadas', () => {
    const { lines } = result(output([line({ product_ref: 'p1', catalog_slug: null }), line({ product_ref: 'p99', catalog_slug: null })]))
    expect(lines.map((item) => item.matched_product_id)).toEqual(['prod-eggs', null])
  })

  it('usa el catálogo solo si el producto existe, y si la casa ya lo tiene, su producto', () => {
    const { lines } = result(
      output([
        line(),
        line({ catalog_slug: 'no-existe' }),
        line({ raw_text: 'TOMATE PERA', name: 'Tomate', catalog_slug: 'tomate', quantity_kind: 'bulk', quantity: 1.234, content_amount: null, content_unit: 'kg' }),
      ]),
    )
    expect(lines.map((item) => [item.matched_product_id, item.catalog_item_id])).toEqual([
      [null, 'cat-milk'],
      [null, null],
      ['prod-tomato', null],
    ])
  })

  it('lo aprendido de tickets anteriores manda sobre el modelo', () => {
    const { lines } = result(output([line({ raw_text: '  LECHE SEMI   HACEND 1L ', brand: null, catalog_slug: null })]), [
      { raw_text: 'LECHE SEMI HACEND 1L', product_id: 'prod-milk', brand: 'Hacendado' },
    ])
    expect(lines[0]).toMatchObject({ raw_text: 'LECHE SEMI HACEND 1L', matched_product_id: 'prod-milk', brand: 'Hacendado', from_alias: true, catalog_item_id: null })
  })

  it('pone límites a las cantidades y corrige formas de contar imposibles', () => {
    const { lines } = result(
      output([
        line({ quantity: 2.6 }),
        line({ quantity: -3 }),
        line({ quantity: 5000 }),
        line({ quantity_kind: 'divisible', content_amount: null }),
        line({ quantity_kind: 'bulk', quantity: 0.7564, content_amount: 3, content_unit: 'kg' }),
        line({ quantity_kind: 'bulk', content_unit: 'ud' }),
        line({ quantity_kind: 'count', content_amount: 1, content_unit: 'l', unit_label: 'serving' }),
      ]),
    )
    expect(lines.map((item) => [item.quantity, item.quantity_kind, item.content_amount, item.content_unit, item.unit_label])).toEqual([
      [3, 'divisible', 1, 'l', 'brick'],
      [1, 'divisible', 1, 'l', 'brick'],
      [999, 'divisible', 1, 'l', 'brick'],
      [6, 'count', null, null, 'brick'],
      [0.756, 'bulk', null, 'kg', 'brick'],
      [6, 'count', null, null, 'brick'],
      [6, 'count', null, null, 'unit'],
    ])
  })

  it('recorta los textos y descarta líneas sin nombre', () => {
    const { lines, store } = result(
      output([line({ name: '   ', raw_text: 'x'.repeat(300) }), line({ name: '', raw_text: '' }), line({ brand: '  ' })], { store: `  ${'S'.repeat(90)}  ` }),
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]!.raw_text).toHaveLength(200)
    expect(lines[0]!.name).toHaveLength(80)
    expect(lines[1]!.brand).toBeNull()
    expect(store).toHaveLength(80)
  })

  it('solo acepta una fecha de compra real, pasada y del último año', () => {
    const dateOf = (date: string | null) => result(output([line()], { date })).date
    expect(dateOf('2026-11-10')).toBe('2026-11-10')
    expect(dateOf('2026-11-12')).toBeNull()
    expect(dateOf('2026-02-30')).toBeNull()
    expect(dateOf('10/11/2026')).toBeNull()
    expect(dateOf('2025-01-01')).toBeNull()
    expect(dateOf(null)).toBeNull()
  })

  it('mantiene las líneas que no son comida para que la vista previa las desmarque', () => {
    const { lines } = result(output([line({ name: 'Detergente', is_food: false, catalog_slug: null, category: 'other' })]))
    expect(lines[0]).toMatchObject({ name: 'Detergente', is_food: false })
  })

  it('no admite más de 100 líneas', () => {
    expect(result(output(Array.from({ length: 150 }, () => line()))).lines).toHaveLength(100)
    expect(receiptRawTexts(output([line(), line(), line({ raw_text: ' OTRA ' })]))).toEqual(['LECHE SEMI HACEND 1L', 'OTRA'])
  })
})

describe('instrucciones del ticket', () => {
  it('lleva el catálogo con su forma de contar', () => {
    const prompt = receiptSystemPrompt(catalog)
    expect(prompt).toContain('leche-semidesnatada · Leche semidesnatada / Semi-skimmed milk · dairy_eggs · divisible: brick of 1 l')
    expect(prompt).toContain('tomate · Tomate / Tomato · vegetables · bulk: kg')
    expect(prompt).toContain('Do not return expiry dates')
  })

  it('nombra los productos con referencias cortas y solo enseña alias de productos listados', () => {
    const { text, refs } = receiptUserText({
      locale: 'en',
      today,
      products,
      aliases: [
        { raw_text_normalized: 'huevos l docena', product_id: 'prod-eggs', brand: 'Pazo' },
        { raw_text_normalized: 'otro', product_id: 'prod-desconocido', brand: null },
      ],
    })
    expect([...refs]).toEqual([
      ['p1', 'prod-eggs'],
      ['p2', 'prod-tomato'],
    ])
    expect(text).toContain('Write the names in English.')
    expect(text).toContain('p1 · Huevos · count: egg')
    expect(text).toContain('"huevos l docena" → p1 (Pazo)')
    expect(text).not.toContain('prod-')
    expect(describeCounting({ quantity_kind: 'divisible', unit_label: 'brick', content_amount: null, content_unit: null })).toBe('count: brick')
  })
})

function dateOutput(overrides: Partial<DateModelOutput> = {}): DateModelOutput {
  return { year: 2026, month: 12, day: 20, date_type: 'expiry', raw_text: 'Fecha de caducidad 20/12/2026', confidence: 'high', ...overrides }
}

describe('respuesta de la fecha', () => {
  it('acepta solo JSON con la forma pedida', () => {
    expect(parseDateOutput(JSON.stringify(dateOutput()))).toEqual(dateOutput())
    expect(parseDateOutput(JSON.stringify({ ...dateOutput(), confidence: 'HIGH' }))?.confidence).toBe('high')
    expect(parseDateOutput(JSON.stringify({ ...dateOutput(), date_type: 'packaged' }))).toBeNull()
    expect(parseDateOutput('{')).toBeNull()
  })

  it('compone la fecha y conserva el tipo leído', () => {
    expect(toDateResult(dateOutput(), today)).toEqual({
      date: '2026-12-20',
      date_type: 'expiry',
      raw_text: 'Fecha de caducidad 20/12/2026',
      confidence: 'high',
      month_only: false,
      year_assumed: false,
    })
    expect(toDateResult(dateOutput({ date_type: null }), today).date_type).toBeNull()
  })

  it('con solo mes y año usa el último día del mes y lo indica', () => {
    expect(toDateResult(dateOutput({ day: null, month: 2, year: 2028 }), today)).toMatchObject({ date: '2028-02-29', month_only: true })
    expect(toDateResult(dateOutput({ day: null, month: 2, year: 27 }), today)).toMatchObject({ date: '2027-02-28', month_only: true })
  })

  it('sin año supone el próximo y baja la confianza', () => {
    expect(toDateResult(dateOutput({ year: null, month: 11, day: 20 }), today)).toMatchObject({ date: '2026-11-20', year_assumed: true, confidence: 'low' })
    expect(toDateResult(dateOutput({ year: null, month: 11, day: 8 }), today)).toMatchObject({ date: '2026-11-08' })
    expect(toDateResult(dateOutput({ year: null, month: 1, day: 15 }), today)).toMatchObject({ date: '2027-01-15' })
  })

  it('una fecha imposible o ilegible no se rellena', () => {
    for (const overrides of [
      { day: 31, month: 4 },
      { month: 13 },
      { month: null },
      { day: 0 },
      { day: 1.5 },
      { year: 1999 },
      { year: null, day: null },
    ]) {
      expect(toDateResult(dateOutput(overrides), today)).toMatchObject({ date: null, confidence: 'low' })
    }
  })

  it('las instrucciones piden ignorar lotes y fechas de envasado', () => {
    expect(dateSystemPrompt).toContain('Ignore lot numbers')
    expect(dateSystemPrompt).toContain('packaging or production dates')
  })
})

describe('foto recibida', () => {
  it('acepta JPEG, PNG y WebP en base64, también con prefijo data:', () => {
    expect(checkImage('/9j/4AAQ', 'image/jpeg')).toEqual({ data: '/9j/4AAQ', media_type: 'image/jpeg' })
    expect(checkImage('data:image/png;base64,iVBORw==', 'image/png')).toEqual({ data: 'iVBORw==', media_type: 'image/png' })
  })

  it('rechaza otros formatos, texto que no es base64 y fotos demasiado grandes', () => {
    expect(checkImage('/9j/4AAQ', 'image/gif')).toBe('invalid_input')
    expect(checkImage('no base64!', 'image/jpeg')).toBe('invalid_input')
    expect(checkImage('', 'image/jpeg')).toBe('invalid_input')
    expect(checkImage(undefined, 'image/jpeg')).toBe('invalid_input')
    expect(checkImage('A'.repeat(Math.ceil((maxImageBytes + 4) / 3) * 4), 'image/jpeg')).toBe('image_too_large')
  })
})
