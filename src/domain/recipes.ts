// Recetas (SPEC §14) en la app: qué hay y qué falta de cada receta en la casa activa, y qué se
// descuenta al cocinarla. La receta viene de la Edge Function suggest-recipes o de los favoritos.

import { measureOf, type Recipe, type RecipeIngredient } from '../../supabase/functions/_shared/recipes.ts'
import type { CatalogById, InventoryData, Product } from './inventory'
import { normalizeName } from './lotDraft'
import { formatForInput, parseAmount } from './quantity'
import type { BulkUnit, ContentUnit } from './types'

export {
  maxPreferences,
  measureOf,
  recipeFilters,
  recipeModes,
  type Recipe,
  type RecipeFilter,
  type RecipeIngredient,
  type RecipeMode,
  type RecipeRequest,
  type RecipeResult,
} from '../../supabase/functions/_shared/recipes.ts'

/**
 * Un favorito se puede cocinar en otra casa: cada ingrediente guarda también el nombre y el producto
 * del catálogo con los que se emparejó, para encontrar el equivalente allí.
 */
export interface KitchenIngredient extends RecipeIngredient {
  product_name?: string | null
  catalog_item_id?: string | null
}

export interface KitchenRecipe extends Omit<Recipe, 'ingredients'> {
  ingredients: KitchenIngredient[]
}

const isString = (value: unknown): value is string => typeof value === 'string'

/** Lo guardado en el móvil o en favoritos puede venir de otra versión: se comprueba la forma. */
export function isKitchenRecipe(value: unknown): value is KitchenRecipe {
  if (!value || typeof value !== 'object') return false
  const recipe = value as Record<string, unknown>
  return (
    isString(recipe.title) &&
    typeof recipe.time_minutes === 'number' &&
    typeof recipe.servings === 'number' &&
    Array.isArray(recipe.steps) &&
    recipe.steps.every(isString) &&
    Array.isArray(recipe.uses_expiring) &&
    Array.isArray(recipe.ingredients) &&
    recipe.ingredients.every((item) => {
      const ingredient = item as Record<string, unknown> | null
      return !!ingredient && isString(ingredient.name) && isString(ingredient.amount_text) && typeof ingredient.tap_water === 'boolean'
    })
  )
}

type Counting = Pick<Product, 'kind' | 'quantity_kind' | 'unit_label' | 'content_amount' | 'content_unit' | 'bulk_unit'>

export function productMeasure(product: Counting) {
  return measureOf({
    ...product,
    content_unit: product.content_unit as ContentUnit | null,
    bulk_unit: product.bulk_unit as BulkUnit | null,
  })
}

/** Lo que hay de un producto, en la unidad de la receta (huevos, l, g, raciones…). */
export function availableOf(product: Product, data: InventoryData): number {
  const lots = data.lots.filter((lot) => lot.product_id === product.id)
  const lotIds = new Set(lots.map((lot) => lot.id))
  const open = data.units.filter((unit) => lotIds.has(unit.lot_id)).reduce((sum, unit) => sum + unit.remaining_fraction, 0)
  const total = lots.reduce((sum, lot) => sum + lot.quantity, 0) + open
  return Math.round(total * productMeasure(product).perUnit * 1000) / 1000
}

/**
 * El producto de la casa que corresponde a un ingrediente, si queda algo: el que eligió la IA y,
 * si no está (un favorito de otra casa, o se ha acabado), el mismo del catálogo o del mismo nombre.
 */
export function findProduct(ingredient: KitchenIngredient, data: InventoryData, catalog: CatalogById): Product | null {
  if (ingredient.tap_water) return null
  const stocked = data.products.filter((product) => availableOf(product, data) > 0)

  const chosen = stocked.find((product) => product.id === ingredient.matched_product_id)
  if (chosen) return chosen
  if (ingredient.catalog_item_id) {
    const sameItem = stocked.find((product) => product.catalog_item_id === ingredient.catalog_item_id)
    if (sameItem) return sameItem
  }
  const wanted = new Set([ingredient.product_name, ingredient.name].filter(isString).map(normalizeName))
  return (
    stocked.find((product) => {
      const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
      return [product.name, item?.name_es, item?.name_en].filter(isString).some((name) => wanted.has(normalizeName(name)))
    }) ?? null
  )
}

export interface IngredientView {
  ingredient: KitchenIngredient
  product: Product | null
  have: boolean
}

export function ingredientViews(recipe: KitchenRecipe, data: InventoryData, catalog: CatalogById): IngredientView[] {
  return recipe.ingredients.map((ingredient) => {
    const product = findProduct(ingredient, data, catalog)
    return { ingredient, product, have: ingredient.tap_water || product !== null }
  })
}

/** Lo que falta en casa, para la lista de la compra. */
export function missingIngredients(recipe: KitchenRecipe, data: InventoryData, catalog: CatalogById): KitchenIngredient[] {
  return ingredientViews(recipe, data, catalog)
    .filter((view) => !view.have)
    .map((view) => view.ingredient)
}

/** La cantidad para la lista: "200 g" sí, "al gusto" no. */
export function shoppingQuantity(ingredient: RecipeIngredient): string | undefined {
  return /\d/.test(ingredient.amount_text) ? ingredient.amount_text.slice(0, 40) : undefined
}

/** Para guardar en favoritos: con lo necesario para encontrar cada producto en otra casa. */
export function toKitchenRecipe(recipe: KitchenRecipe, data: InventoryData | undefined): KitchenRecipe {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => {
      const product = ingredient.matched_product_id ? data?.products.find((item) => item.id === ingredient.matched_product_id) : undefined
      return product
        ? { ...ingredient, product_name: product.name, catalog_item_id: product.catalog_item_id }
        : ingredient
    }),
  }
}

// ------------------------------------------------------------------------------------------------
// He cocinado esto
// ------------------------------------------------------------------------------------------------

export interface CookLine {
  key: string
  /** Como lo dice la receta: "Huevos", "4". */
  ingredient: string
  amountText: string
  product: Product
  /** Unidad de la receta para ese producto y cuánto de ella hay en una unidad del inventario. */
  unit: string
  perUnit: number
  available: number
  /** Lo que se va a descontar, en `unit`, tal como se escribe. */
  amount: string
  checked: boolean
}

const weightsAndVolumes = new Set(['g', 'kg', 'ml', 'l'])
/** Las recetas hablan de ml y g: los litros y los kilos se enseñan así. */
const smallerUnit: Record<string, string> = { l: 'ml', kg: 'g' }

/** Una línea por ingrediente que hay en casa, con lo que dice la receta ya puesto. */
export function cookLines(recipe: KitchenRecipe, data: InventoryData, catalog: CatalogById, localeTag: string): CookLine[] {
  return ingredientViews(recipe, data, catalog).flatMap((view, index) => {
    const { product, ingredient } = view
    if (!product) return []
    const measure = productMeasure(product)
    const factor = smallerUnit[measure.unit] ? 1000 : 1
    const unit = smallerUnit[measure.unit] ?? measure.unit
    // La cantidad de la IA está en la unidad del producto que eligió; con otro producto no vale.
    const suggested = product.id === ingredient.matched_product_id && ingredient.use_amount !== null ? ingredient.use_amount * factor : null
    const amount = suggested ?? (weightsAndVolumes.has(unit) ? null : 1)
    return [
      {
        key: String(index),
        ingredient: ingredient.name,
        amountText: ingredient.amount_text,
        product,
        unit,
        perUnit: measure.perUnit * factor,
        available: Math.round(availableOf(product, data) * factor * 1000) / 1000,
        amount: amount === null ? '' : formatForInput(amount, localeTag),
        checked: true,
      },
    ]
  })
}

export type CookLineProblem = 'invalid' | 'more_than_available' | null

export function cookLineProblem(line: CookLine): CookLineProblem {
  if (!line.checked) return null
  const value = parseAmount(line.amount)
  if (value === null || value <= 0) return 'invalid'
  return value > line.available ? 'more_than_available' : null
}

/** Lo que recibe cook_recipe: cantidades en la unidad del inventario (0,2 bricks, no 200 ml). */
export function cookItems(lines: readonly CookLine[]): { product_id: string; amount: number }[] {
  return lines.flatMap((line) => {
    const value = line.checked ? parseAmount(line.amount) : null
    if (value === null || value <= 0) return []
    return [{ product_id: line.product.id, amount: Math.round((value / line.perUnit) * 10000) / 10000 }]
  })
}
