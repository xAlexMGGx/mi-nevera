import { describe, expect, it } from 'vitest'
import type { InventoryData, Lot, OpenedUnit } from './inventory'
import {
  availableOf,
  cookItems,
  cookLineProblem,
  cookLines,
  findProduct,
  ingredientViews,
  isKitchenRecipe,
  missingIngredients,
  shoppingQuantity,
  toKitchenRecipe,
  type KitchenIngredient,
  type KitchenRecipe,
} from './recipes'
import { catalog, catalogItem, milk, product, yogurt } from './testFixtures'

const eggs = product({ id: 'eggs', name: 'Huevos', unit_label: 'egg' })
const flour = product({ id: 'flour', name: 'Harina', quantity_kind: 'bulk', bulk_unit: 'g' })
const emptyRice = product({ id: 'rice', name: 'Arroz', quantity_kind: 'bulk', bulk_unit: 'g' })

const lot = (product_id: string, quantity: number, id = `lot-${product_id}`) => ({ id, product_id, quantity }) as Lot

const data: InventoryData = {
  zones: [],
  products: [milk, yogurt, eggs, flour, emptyRice],
  lots: [lot('milk', 1), lot('yogurt', 4), lot('eggs', 6), lot('flour', 750)],
  units: [{ lot_id: 'lot-milk', remaining_fraction: 0.4 } as OpenedUnit],
}

const ingredient = (overrides: Partial<KitchenIngredient>): KitchenIngredient => ({
  name: 'X',
  amount_text: '',
  have: false,
  matched_product_id: null,
  use_amount: null,
  tap_water: false,
  ...overrides,
})

const recipe: KitchenRecipe = {
  title: 'Crepes',
  time_minutes: 20,
  servings: 2,
  steps: ['Mezclar', 'Hacer'],
  uses_expiring: ['milk'],
  ingredients: [
    ingredient({ name: 'Huevos', amount_text: '2', matched_product_id: 'eggs', use_amount: 2 }),
    ingredient({ name: 'Leche', amount_text: '250 ml', matched_product_id: 'milk', use_amount: 0.25 }),
    ingredient({ name: 'Harina', amount_text: '125 g', matched_product_id: 'flour', use_amount: 125 }),
    ingredient({ name: 'Arroz', amount_text: '100 g', matched_product_id: 'rice', use_amount: 100 }),
    ingredient({ name: 'Mantequilla', amount_text: 'al gusto' }),
    ingredient({ name: 'Agua', amount_text: '1 vaso', tap_water: true }),
  ],
}

describe('lo que hay en casa', () => {
  it('en la unidad de la receta, contando lo abierto', () => {
    expect(availableOf(milk, data)).toBe(1.4)
    expect(availableOf(eggs, data)).toBe(6)
    expect(availableOf(flour, data)).toBe(750)
    expect(availableOf(emptyRice, data)).toBe(0)
  })

  it('qué hay y qué falta: lo agotado falta, el agua del grifo no', () => {
    const views = ingredientViews(recipe, data, catalog)
    expect(views.map((view) => [view.ingredient.name, view.have, view.product?.id ?? null])).toEqual([
      ['Huevos', true, 'eggs'],
      ['Leche', true, 'milk'],
      ['Harina', true, 'flour'],
      ['Arroz', false, null],
      ['Mantequilla', false, null],
      ['Agua', true, null],
    ])
    expect(missingIngredients(recipe, data, catalog).map((item) => item.name)).toEqual(['Arroz', 'Mantequilla'])
  })

  it('un favorito de otra casa encuentra su producto por catálogo o por nombre', () => {
    const otherYogurt = product({ id: 'other-yogurt', name: 'Yogures', catalog_item_id: 'cat-yogurt', unit_label: 'yogurt' })
    const otherEggs = product({ id: 'other-eggs', name: 'huevos', unit_label: 'egg' })
    const other: InventoryData = { zones: [], units: [], products: [otherYogurt, otherEggs], lots: [lot('other-yogurt', 2), lot('other-eggs', 3)] }
    expect(findProduct(ingredient({ name: 'Yogur', matched_product_id: 'yogurt', catalog_item_id: 'cat-yogurt' }), other, catalog)?.id).toBe('other-yogurt')
    expect(findProduct(ingredient({ name: 'Huevo', matched_product_id: 'eggs', product_name: 'Huevos' }), other, catalog)?.id).toBe('other-eggs')
    // Por el nombre del catálogo en cualquier idioma.
    const withCatalog = new Map([...catalog, ['cat-yogurt', catalogItem({ id: 'cat-yogurt', name_es: 'Yogur natural', name_en: 'Plain yogurt' })]])
    expect(findProduct(ingredient({ name: 'Plain yogurt' }), other, withCatalog)?.id).toBe('other-yogurt')
    expect(findProduct(ingredient({ name: 'Leche' }), other, catalog)).toBeNull()
  })

  it('al guardar en favoritos, cada ingrediente se lleva el nombre y el catálogo de su producto', () => {
    const saved = toKitchenRecipe({ ...recipe, ingredients: [ingredient({ name: 'Yogur', matched_product_id: 'yogurt' }), ingredient({ name: 'Sal' })] }, data)
    expect(saved.ingredients).toMatchObject([{ product_name: 'Yogur natural', catalog_item_id: 'cat-yogurt' }, { name: 'Sal' }])
    expect(saved.ingredients[1]).not.toHaveProperty('product_name')
  })

  it('para la lista, la cantidad solo si tiene números', () => {
    expect(shoppingQuantity(ingredient({ amount_text: '200 g' }))).toBe('200 g')
    expect(shoppingQuantity(ingredient({ amount_text: 'al gusto' }))).toBeUndefined()
  })

  it('reconoce una receta guardada y rechaza lo que no lo es', () => {
    expect(isKitchenRecipe(recipe)).toBe(true)
    expect(isKitchenRecipe({ ...recipe, ingredients: [{ name: 'Sal' }] })).toBe(false)
    expect(isKitchenRecipe({ title: 'X' })).toBe(false)
    expect(isKitchenRecipe(null)).toBe(false)
  })
})

describe('he cocinado esto', () => {
  it('una línea por lo que hay, con la cantidad de la receta', () => {
    const lines = cookLines(recipe, data, catalog, 'es-ES')
    // Los litros, en ml, como en las recetas.
    expect(lines.map((line) => [line.ingredient, line.unit, line.amount, line.available])).toEqual([
      ['Huevos', 'egg', '2', 6],
      ['Leche', 'ml', '250', 1400],
      ['Harina', 'g', '125', 750],
    ])
  })

  it('sin cantidad de la IA: una unidad, o vacío si va al peso', () => {
    const lines = cookLines(
      { ...recipe, ingredients: [ingredient({ name: 'Huevos', matched_product_id: 'eggs' }), ingredient({ name: 'Harina', matched_product_id: 'flour' })] },
      data,
      catalog,
      'es-ES',
    )
    expect(lines.map((line) => line.amount)).toEqual(['1', ''])
    expect(cookLineProblem(lines[1]!)).toBe('invalid')
  })

  it('la cantidad de la IA solo vale para el producto que eligió', () => {
    const otherMilk = product({ ...milk, id: 'milk-2', content_amount: 500, content_unit: 'ml' })
    const other: InventoryData = { zones: [], units: [], products: [otherMilk], lots: [lot('milk-2', 2)] }
    const [line] = cookLines({ ...recipe, ingredients: [ingredient({ name: 'Leche', matched_product_id: 'milk', use_amount: 0.25 })] }, other, catalog, 'es-ES')
    expect(line).toMatchObject({ unit: 'ml', amount: '', available: 1000 })
  })

  it('avisa si se pide más de lo que hay, y no cuenta lo desmarcado', () => {
    const [first] = cookLines(recipe, data, catalog, 'es-ES')
    expect(cookLineProblem({ ...first!, amount: '8' })).toBe('more_than_available')
    expect(cookLineProblem({ ...first!, amount: 'dos' })).toBe('invalid')
    expect(cookLineProblem({ ...first!, amount: 'dos', checked: false })).toBeNull()
  })

  it('lo que se descuenta va en la unidad del inventario', () => {
    const lines = cookLines(recipe, data, catalog, 'es-ES')
    lines[2] = { ...lines[2]!, checked: false }
    expect(cookItems(lines)).toEqual([
      { product_id: 'eggs', amount: 2 },
      { product_id: 'milk', amount: 0.25 },
    ])
    const halfLitreBricks = cookItems([{ ...lines[1]!, perUnit: 500, amount: '200' }])
    expect(halfLitreBricks).toEqual([{ product_id: 'milk', amount: 0.4 }])
  })
})
