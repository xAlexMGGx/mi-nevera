import { describe, expect, it } from 'vitest'
import {
  cleanRecipeRequest,
  measureOf,
  normalizeTitle,
  parseRecipeOutput,
  recipeTask,
  recipeUserText,
  summarizeStock,
  toRecipeResult,
  type RecipeModelOutput,
  type StockInput,
  type StockProductRow,
} from '../supabase/functions/_shared/recipes.ts'

const today = '2026-11-17'

const counting = { kind: 'food', content_amount: null, content_unit: null, bulk_unit: null, name_customized: false, catalog_item_id: null } as const
const eggs: StockProductRow = { ...counting, id: 'eggs', name: 'Huevos', quantity_kind: 'count', unit_label: 'egg' }
const milk: StockProductRow = { ...counting, id: 'milk', name: 'Leche semidesnatada', catalog_item_id: 'cat-milk', quantity_kind: 'divisible', unit_label: 'brick', content_amount: 1, content_unit: 'l' }
const flour: StockProductRow = { ...counting, id: 'flour', name: 'Harina', quantity_kind: 'bulk', unit_label: 'unit', bulk_unit: 'g' }
const lentils: StockProductRow = { ...counting, id: 'dish', name: 'Lentejas', kind: 'cooked_dish', quantity_kind: 'count', unit_label: 'serving' }
const yogurt: StockProductRow = { ...counting, id: 'yogurt', name: 'Yogur', quantity_kind: 'count', unit_label: 'yogurt' }

const lot = (id: string, product_id: string, quantity: number, effective_date: string | null = null, extra: Partial<StockInput['lots'][number]> = {}) => ({
  id,
  product_id,
  zone_id: 'fridge',
  quantity,
  opened_at: null,
  effective_date,
  effective_basis: effective_date ? ('expiry' as const) : null,
  ...extra,
})

function stockInput(extra: Partial<StockInput> = {}): StockInput {
  return {
    products: [eggs, milk, flour, lentils, yogurt],
    lots: [
      lot('l-eggs', 'eggs', 6, '2026-11-25'),
      lot('l-milk', 'milk', 1, '2026-12-20'),
      lot('l-flour', 'flour', 750),
      lot('l-dish', 'dish', 2, '2026-11-19', { zone_id: 'freezer' }),
      lot('l-yogurt-old', 'yogurt', 2, '2026-11-10'),
    ],
    units: [{ lot_id: 'l-milk', remaining_fraction: 0.4, effective_date: '2026-11-18', effective_basis: 'reminder' }],
    freezerZoneIds: new Set(['freezer']),
    catalogNames: new Map([['cat-milk', { name_es: 'Leche semidesnatada', name_en: 'Semi-skimmed milk' }]]),
    locale: 'es',
    today,
    ...extra,
  }
}

describe('lo que hay en casa', () => {
  it('cada producto en la unidad de la receta, lo que caduca antes arriba y sin lo caducado', () => {
    const stock = summarizeStock(stockInput())
    expect(stock.map((item) => [item.name, item.available, item.unit, item.date])).toEqual([
      ['Leche semidesnatada', 1.4, 'l', '2026-11-18'],
      ['Lentejas', 2, 'serving', '2026-11-19'],
      ['Huevos', 6, 'egg', '2026-11-25'],
      ['Harina', 750, 'g', null],
    ])
    expect(stock.find((item) => item.id === 'milk')).toMatchObject({ opened: true, frozen: false, basis: 'reminder' })
    expect(stock.find((item) => item.id === 'dish')).toMatchObject({ dish: true, frozen: true })
  })

  it('de un producto con lotes caducados, solo cuenta lo que no lo está', () => {
    const input = stockInput()
    const stock = summarizeStock({ ...input, lots: [...input.lots, lot('l-eggs-old', 'eggs', 3, '2026-11-01')] })
    expect(stock.find((item) => item.id === 'eggs')).toMatchObject({ available: 6, date: '2026-11-25' })
  })

  it('en inglés, el catálogo en inglés', () => {
    expect(summarizeStock(stockInput({ locale: 'en' }))[0]!.name).toBe('Semi-skimmed milk')
  })

  it('la unidad de cada forma de contar', () => {
    expect(measureOf(milk)).toEqual({ unit: 'l', perUnit: 1 })
    expect(measureOf({ ...milk, content_amount: 500, content_unit: 'g' })).toEqual({ unit: 'g', perUnit: 500 })
    expect(measureOf(flour)).toEqual({ unit: 'g', perUnit: 1 })
    expect(measureOf(eggs)).toEqual({ unit: 'egg', perUnit: 1 })
    expect(measureOf(lentils)).toEqual({ unit: 'serving', perUnit: 1 })
  })
})

describe('la petición', () => {
  it('solo pasa lo válido', () => {
    expect(cleanRecipeRequest({ mode: 'use_up', filters: ['pasta', 'pasta', 'pizza'], text: '  algo   rápido ', servings: 2, max_minutes: 30 })).toEqual({
      mode: 'use_up',
      filters: ['pasta'],
      text: 'algo rápido',
      servings: 2,
      max_minutes: 30,
    })
    expect(cleanRecipeRequest({ mode: 'balanced', servings: 50, max_minutes: 2.5 })).toEqual({ mode: 'balanced', filters: [], text: null, servings: null, max_minutes: null })
    expect(cleanRecipeRequest({ mode: 'surprise' })).toBeNull()
    expect(cleanRecipeRequest(null)).toBeNull()
  })

  it('lleva el modo, los filtros, las preferencias, los favoritos, lo bloqueado y la casa con referencias', () => {
    const stock = summarizeStock(stockInput())
    const { text, refs } = recipeUserText({
      locale: 'es',
      today,
      daysAhead: 2,
      request: { mode: 'use_up', filters: ['vegetables', 'light_dinner'], text: 'sin horno', servings: 2, max_minutes: 30 },
      stock,
      preferences: 'No me gusta el cilantro.',
      favorites: ['Crema de calabaza'],
      blocked: ['Callos'],
    })
    expect(text).toContain('Write everything in Spanish (Spain)')
    expect(text).toContain('Empty the fridge')
    expect(text).toContain('vegetable-based, light dinner')
    expect(text).toContain('"sin horno"')
    expect(text).toContain('for 2 people')
    expect(text).toContain('30 minutes')
    expect(text).toContain('No me gusta el cilantro.')
    expect(text).toContain('- Crema de calabaza')
    expect(text).toContain('- Callos')
    expect(text).toContain('p1 · Leche semidesnatada · 1.4 l · open · use by (reminder) 2026-11-18, tomorrow · expires soon')
    expect(text).toContain('p2 · Lentejas · 2 serving · leftover dish, already cooked · frozen · expires 2026-11-19, in 2 days · expires soon')
    expect(text).toContain('p3 · Huevos · 6 egg · expires 2026-11-25, in 8 days')
    expect(text).toContain('p4 · Harina · 750 g')
    expect(text).not.toContain('Yogur')
    expect(refs.get('p3')).toBe('eggs')
  })

  it('sin preferencias ni casa, lo dice', () => {
    const { text } = recipeUserText({
      locale: 'en',
      today,
      daysAhead: 2,
      request: { mode: 'free', filters: [], text: null, servings: null, max_minutes: null },
      stock: [],
      preferences: '  ',
      favorites: [],
      blocked: [],
    })
    expect(text).toContain('Write everything in English')
    expect(text).toContain('Free inspiration')
    expect(text).toContain('Filters: none')
    expect(text).toContain('choose a sensible number')
    expect(text).toContain('(nothing at home)')
  })

  it('las instrucciones piden 3 recetas, nada supuesto salvo el agua y nada de seguridad alimentaria', () => {
    expect(recipeTask).toContain('exactly 3 recipes')
    expect(recipeTask).toContain('including salt, oil and spices: only tap water is assumed')
    expect(recipeTask).toContain('Do not give advice about food safety')
  })
})

describe('la respuesta', () => {
  const refs = new Map([
    ['p1', 'milk'],
    ['p3', 'eggs'],
  ])
  const output: RecipeModelOutput = {
    recipes: [
      {
        title: '  Tortilla  francesa ',
        time_minutes: 10.4,
        servings: 0,
        ingredients: [
          { name: 'Huevos', amount_text: '3', product_ref: 'P3', use_amount: 3, tap_water: false },
          { name: 'Sal', amount_text: 'al gusto', product_ref: null, use_amount: 2, tap_water: false },
          { name: 'Agua', amount_text: '1 vaso', product_ref: null, use_amount: null, tap_water: true },
          { name: 'Leche', amount_text: '50 ml', product_ref: 'p1', use_amount: 0.05, tap_water: true },
          { name: 'Queso', amount_text: '30 g', product_ref: 'p99', use_amount: 30, tap_water: false },
        ],
        steps: ['Batir los huevos', '  ', 'Cuajar'],
        uses_expiring: ['p1', 'p3', 'p99'],
      },
      { title: 'Callos', time_minutes: 120, servings: 4, ingredients: [{ name: 'Callos', amount_text: '1 kg', product_ref: null, use_amount: null, tap_water: false }], steps: ['Cocer'], uses_expiring: [] },
      { title: 'tortilla Francesa', time_minutes: 10, servings: 2, ingredients: [{ name: 'Huevos', amount_text: '2', product_ref: 'p3', use_amount: 2, tap_water: false }], steps: ['Batir'], uses_expiring: [] },
      { title: 'Sin pasos', time_minutes: 10, servings: 2, ingredients: [{ name: 'Huevos', amount_text: '2', product_ref: 'p3', use_amount: 2, tap_water: false }], steps: [], uses_expiring: [] },
      { title: 'Natillas', time_minutes: 30, servings: 4, ingredients: [{ name: 'Leche', amount_text: '500 ml', product_ref: 'p1', use_amount: 0.5, tap_water: false }], steps: ['Calentar'], uses_expiring: ['p1'] },
    ],
  }

  it('ids reales, límites, sin bloqueadas ni repetidas, y "lo hay" solo con producto o agua del grifo', () => {
    const result = toRecipeResult(output, { refs, blocked: ['CALLOS'] })
    expect(result.recipes.map((recipe) => recipe.title)).toEqual(['Tortilla francesa', 'Natillas'])
    const [omelette] = result.recipes
    expect(omelette).toMatchObject({ time_minutes: 10, servings: 1, steps: ['Batir los huevos', 'Cuajar'], uses_expiring: ['milk', 'eggs'] })
    expect(omelette!.ingredients).toEqual([
      { name: 'Huevos', amount_text: '3', have: true, matched_product_id: 'eggs', use_amount: 3, tap_water: false },
      { name: 'Sal', amount_text: 'al gusto', have: false, matched_product_id: null, use_amount: null, tap_water: false },
      { name: 'Agua', amount_text: '1 vaso', have: true, matched_product_id: null, use_amount: null, tap_water: true },
      { name: 'Leche', amount_text: '50 ml', have: true, matched_product_id: 'milk', use_amount: 0.05, tap_water: false },
      { name: 'Queso', amount_text: '30 g', have: false, matched_product_id: null, use_amount: null, tap_water: false },
    ])
  })

  it('como mucho 3 recetas', () => {
    const many: RecipeModelOutput = {
      recipes: ['A', 'B', 'C', 'D'].map((title) => ({ ...output.recipes[4]!, title })),
    }
    expect(toRecipeResult(many, { refs, blocked: [] }).recipes).toHaveLength(3)
  })

  it('lo que no es JSON o no tiene la forma pedida no pasa', () => {
    expect(parseRecipeOutput('no')).toBeNull()
    expect(parseRecipeOutput(JSON.stringify({ recipes: [{ title: 'X' }] }))).toBeNull()
    expect(parseRecipeOutput(JSON.stringify(output))).toEqual(output)
  })

  it('el título se compara sin mayúsculas, tildes ni espacios de más', () => {
    expect(normalizeTitle('  Crema de  CALABAZA ')).toBe(normalizeTitle('crema de calabazá'))
  })
})
