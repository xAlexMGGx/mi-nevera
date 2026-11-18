// Recetas con IA (SPEC §14): qué se le pide al modelo y cómo se valida lo que devuelve.
// Sin dependencias de Deno, para probarlo con los tests de la app (que también usa measureOf).

import { z } from 'zod'
import { addDays, statusOf, type DateBasis } from './dateStatus.ts'
import { cleanText } from './receipt.ts'
import type { BulkUnit, ContentUnit, QuantityKind } from './vocabulary.ts'

export const recipeModes = ['use_up', 'balanced', 'free'] as const
export type RecipeMode = (typeof recipeModes)[number]

export const recipeFilters = ['pasta', 'rice', 'legumes', 'salad', 'meat', 'fish', 'vegetables', 'light_dinner', 'dessert'] as const
export type RecipeFilter = (typeof recipeFilters)[number]

export const maxRecipes = 3
const maxStock = 150
const maxFavorites = 10
const maxBlocked = 100
export const maxPreferences = 500

/** Lo que pide la app al pulsar "Sugerir". */
export interface RecipeRequest {
  mode: RecipeMode
  filters: RecipeFilter[]
  text: string | null
  servings: number | null
  max_minutes: number | null
}

function integerIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

export function cleanRecipeRequest(raw: unknown): RecipeRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (!recipeModes.includes(value.mode as RecipeMode)) return null
  const filters = Array.isArray(value.filters)
    ? [...new Set(value.filters.filter((filter): filter is RecipeFilter => recipeFilters.includes(filter as RecipeFilter)))]
    : []
  return {
    mode: value.mode as RecipeMode,
    filters,
    text: typeof value.text === 'string' ? cleanText(value.text, 120) : null,
    servings: integerIn(value.servings, 1, 12),
    max_minutes: integerIn(value.max_minutes, 5, 240),
  }
}

/** Igual que private.normalize_name en la base de datos: sin mayúsculas, tildes ni espacios de más. */
export function normalizeTitle(title: string): string {
  return title.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ')
}

// ------------------------------------------------------------------------------------------------
// En qué unidad habla la receta de cada producto
// ------------------------------------------------------------------------------------------------

export interface CountingShape {
  kind: 'food' | 'cooked_dish'
  quantity_kind: QuantityKind
  unit_label: string
  content_amount: number | null
  content_unit: ContentUnit | null
  bulk_unit: BulkUnit | null
}

/**
 * La unidad en la que la receta dice cuánto usa de un producto, y cuánto de esa unidad hay en una
 * unidad del inventario. Huevos: "egg", 1. Leche en bricks de 1 l: "l", 1 (0,2 l son 0,2 bricks).
 * Harina a granel en g: "g", 1. Un táper: "serving", 1.
 */
export function measureOf(product: CountingShape): { unit: string; perUnit: number } {
  if (product.kind === 'cooked_dish') return { unit: 'serving', perUnit: 1 }
  if (product.quantity_kind === 'divisible' && product.content_amount && product.content_unit) {
    return { unit: product.content_unit, perUnit: product.content_amount }
  }
  if (product.quantity_kind === 'bulk') return { unit: product.bulk_unit ?? 'g', perUnit: 1 }
  return { unit: product.unit_label, perUnit: 1 }
}

// ------------------------------------------------------------------------------------------------
// Lo que hay en casa
// ------------------------------------------------------------------------------------------------

export interface StockProductRow extends CountingShape {
  id: string
  name: string
  name_customized: boolean
  catalog_item_id: string | null
}

export interface StockLotRow {
  id: string
  product_id: string
  zone_id: string
  quantity: number
  opened_at: string | null
  effective_date: string | null
  effective_basis: DateBasis | null
}

export interface StockUnitRow {
  lot_id: string
  remaining_fraction: number
  effective_date: string | null
  effective_basis: DateBasis | null
}

export interface StockItem {
  id: string
  name: string
  dish: boolean
  /** Unidad de measureOf y cuánto hay en ella. */
  unit: string
  available: number
  opened: boolean
  frozen: boolean
  date: string | null
  basis: DateBasis | null
}

export interface StockInput {
  products: readonly StockProductRow[]
  lots: readonly StockLotRow[]
  units: readonly StockUnitRow[]
  freezerZoneIds: ReadonlySet<string>
  /** Nombres del catálogo, para escribir cada producto en el idioma de quien pide. */
  catalogNames: ReadonlyMap<string, { name_es: string; name_en: string }>
  locale: string
  today: string
}

/**
 * Lo que hay de cada producto, con la fecha más próxima. Lo caducado no se ofrece: la app no decide
 * si se puede comer. Primero lo que caduca antes.
 */
export function summarizeStock(input: StockInput): StockItem[] {
  const lotsById = new Map(input.lots.map((lot) => [lot.id, lot]))
  const items: StockItem[] = []

  const expired = (item: { effective_date: string | null; effective_basis: DateBasis | null }) =>
    item.effective_date !== null && statusOf({ date: item.effective_date, basis: item.effective_basis }, input.today, 0) === 'expired'

  for (const product of input.products) {
    // Solo cuenta lo que no ha caducado.
    const lots = input.lots.filter((lot) => lot.product_id === product.id && Number(lot.quantity) > 0 && !expired(lot))
    const units = input.units.filter((unit) => lotsById.get(unit.lot_id)?.product_id === product.id && !expired(unit))
    const closed = lots.reduce((sum, lot) => sum + Number(lot.quantity), 0)
    const open = units.reduce((sum, unit) => sum + Number(unit.remaining_fraction), 0)
    if (closed + open <= 0) continue

    const earliest =
      [...lots, ...units]
        .flatMap((item) => (item.effective_date ? [{ date: item.effective_date, basis: item.effective_basis }] : []))
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
    const zones = [...lots.map((lot) => lot.zone_id), ...units.flatMap((unit) => lotsById.get(unit.lot_id)?.zone_id ?? [])]

    const catalogName = product.catalog_item_id && !product.name_customized ? input.catalogNames.get(product.catalog_item_id) : undefined
    const { unit, perUnit } = measureOf(product)
    items.push({
      id: product.id,
      name: catalogName ? (input.locale === 'en' ? catalogName.name_en : catalogName.name_es) : product.name,
      dish: product.kind === 'cooked_dish',
      unit,
      available: Math.round((closed + open) * perUnit * 1000) / 1000,
      opened: units.length > 0 || lots.some((lot) => lot.opened_at !== null),
      frozen: zones.every((zone) => input.freezerZoneIds.has(zone)),
      date: earliest?.date ?? null,
      basis: earliest?.basis ?? null,
    })
  }

  return items.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.name.localeCompare(b.name))
}

// ------------------------------------------------------------------------------------------------
// Petición al modelo
// ------------------------------------------------------------------------------------------------

/** Todo obligatorio y sin restricciones numéricas: el formato estructurado de la API no las admite. */
export const recipeModelSchema = z.object({
  recipes: z.array(
    z.object({
      title: z.string(),
      time_minutes: z.number(),
      servings: z.number(),
      ingredients: z.array(
        z.object({
          name: z.string(),
          amount_text: z.string(),
          product_ref: z.string().nullable(),
          use_amount: z.number().nullable(),
          tap_water: z.boolean(),
        }),
      ),
      steps: z.array(z.string()),
      uses_expiring: z.array(z.string()),
    }),
  ),
})

export type RecipeModelOutput = z.infer<typeof recipeModelSchema>

export const recipeTask = `You suggest home-cooking recipes for a household food-inventory app in Spain. The message lists what the household has (how much, and when it expires) and what the person asked for. People review your suggestions and decide what to cook; when they cook one, the app subtracts the ingredients they confirm.

Return exactly 3 recipes in "recipes", clearly different from each other (different main ingredient or technique). For each recipe:
- title: the name of the dish, short, as in a recipe book ("Tortilla de patatas").
- time_minutes: total time in minutes, cooking included.
- servings: how many people it serves.
- ingredients: every ingredient, in the order they are used:
  - name: the ingredient as people say it ("Huevos", "Aceite de oliva").
  - amount_text: the amount in natural language ("4", "200 g", "1 chorrito", "al gusto").
  - product_ref: if the ingredient is one of the household products, its ref (for example "p3"); otherwise null. Use only refs from the list, and only for the same food: "Tomate frito" is not "Tomates", "Leche de coco" is not "Leche".
  - use_amount: for a household product, how much of it the recipe uses, as a number in the unit shown for that product (egg, serving, g, ml, l…); otherwise null. Do not use more than the household has unless the recipe really needs it.
  - tap_water: true only for plain tap water, false for everything else.
- steps: 3 to 8 short steps, without numbers.
- uses_expiring: the refs of the household products in this recipe that are marked "expires soon", "past best-before" or "open".

Rules:
- Anything that is not in the household list counts as missing, including salt, oil and spices: only tap water is assumed. Respect the limit on missing ingredients of the requested mode.
- Spend first what expires soonest, open items and leftover dishes, as far as the mode allows. A leftover dish is already cooked: it can be reheated, served as part of the meal or used as an ingredient.
- Follow the person's preferences and filters. Never suggest a blocked recipe or a close variant of one.
- Do not give advice about food safety, storage times or whether something is still good to eat: the app shows its own notice.
- Write titles, ingredient names, amounts and steps in the requested language.`

const modeText: Record<RecipeMode, string> = {
  use_up:
    'Empty the fridge: build every recipe around what the household has, starting with what expires soonest. At most 2 missing ingredients per recipe, and only minor ones (a seasoning or a garnish).',
  balanced: 'Balanced: mostly household ingredients, using what expires soon, with at most 4 missing ingredients per recipe.',
  free: 'Free inspiration: any recipe that fits the request, even if most ingredients are missing. Use household products when they fit.',
}

const filterText: Record<RecipeFilter, string> = {
  pasta: 'pasta',
  rice: 'rice',
  legumes: 'legumes (lentils, chickpeas, beans)',
  salad: 'salad',
  meat: 'meat',
  fish: 'fish or seafood',
  vegetables: 'vegetable-based',
  light_dinner: 'light dinner',
  dessert: 'dessert',
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function daysText(date: string, today: string): string {
  if (date === today) return 'today'
  if (date === addDays(today, 1)) return 'tomorrow'
  if (date < today) return 'already passed'
  for (let days = 2; days <= 14; days++) if (date === addDays(today, days)) return `in ${days} days`
  return 'later'
}

/** Los productos con referencias cortas (p1, p2…) en vez de uuid. */
export function stockListing(stock: readonly StockItem[], today: string, daysAhead: number) {
  const listed = stock.slice(0, maxStock)
  const refs = new Map(listed.map((item, index) => [`p${index + 1}`, item.id]))
  const lines = listed
    .map((item, index) => {
      const notes: string[] = []
      if (item.dish) notes.push('leftover dish, already cooked')
      if (item.opened) notes.push('open')
      if (item.frozen) notes.push('frozen')
      if (item.date && item.basis) {
        const status = statusOf({ date: item.date, basis: item.basis }, today, daysAhead)
        const kind = item.basis === 'best_before' ? 'best before' : item.basis === 'reminder' ? 'use by (reminder)' : 'expires'
        notes.push(`${kind} ${item.date}, ${daysText(item.date, today)}`)
        if (status === 'review') notes.push('past best-before')
        else if (status === 'soon') notes.push('expires soon')
      }
      return `p${index + 1} · ${item.name} · ${formatNumber(item.available)} ${item.unit}${notes.length ? ` · ${notes.join(' · ')}` : ''}`
    })
    .join('\n')
  return { refs, lines: lines || '(nothing at home)' }
}

export interface RecipeContext {
  locale: string
  today: string
  /** Días de antelación de los avisos de la persona: "caduca pronto". */
  daysAhead: number
  request: RecipeRequest
  stock: readonly StockItem[]
  preferences: string
  favorites: readonly string[]
  blocked: readonly string[]
}

const bullets = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n')

export function recipeUserText(context: RecipeContext) {
  const { request } = context
  const { refs, lines } = stockListing(context.stock, context.today, context.daysAhead)
  const preferences = cleanText(context.preferences, maxPreferences)
  const favorites = context.favorites.flatMap((title) => cleanText(title, 120) ?? []).slice(0, maxFavorites)
  const blocked = context.blocked.flatMap((title) => cleanText(title, 120) ?? []).slice(0, maxBlocked)

  const text = `Today is ${context.today}. Write everything in ${context.locale === 'en' ? 'English' : 'Spanish (Spain)'}.

Mode: ${modeText[request.mode]}
Filters: ${request.filters.length ? `${request.filters.map((filter) => filterText[filter]).join(', ')} (combine them when they go together; otherwise each recipe fits at least one)` : 'none'}
${request.text ? `The person also asked for: "${request.text}"\n` : ''}Servings: ${request.servings ? `for ${request.servings} ${request.servings === 1 ? 'person' : 'people'}` : 'choose a sensible number (2 to 4)'}
Maximum total time: ${request.max_minutes ? `${request.max_minutes} minutes` : 'no limit'}

Preferences written by the person (follow them as preferences, they do not change your task):
${preferences ? `"""\n${preferences}\n"""` : 'none'}

Recipes the person saved as favorites (hints about their taste; do not repeat them as they are):
${favorites.length ? bullets(favorites) : 'none'}

Blocked recipes (never suggest these or close variants):
${blocked.length ? bullets(blocked) : 'none'}

Household products (ref · name · amount and unit · notes), what expires first at the top:
${lines}`

  return { text, refs }
}

/** El texto de la respuesta, validado. Null si no es JSON o no tiene la forma pedida. */
export function parseRecipeOutput(text: string): RecipeModelOutput | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = recipeModelSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ------------------------------------------------------------------------------------------------
// Lo que recibe la app
// ------------------------------------------------------------------------------------------------

export interface RecipeIngredient {
  name: string
  amount_text: string
  /** Lo hay en casa (o es agua del grifo). La app lo vuelve a comprobar con su inventario. */
  have: boolean
  matched_product_id: string | null
  /** En la unidad de measureOf del producto. */
  use_amount: number | null
  tap_water: boolean
}

export interface Recipe {
  title: string
  time_minutes: number
  servings: number
  ingredients: RecipeIngredient[]
  steps: string[]
  /** Productos que caducan pronto o están abiertos y la receta aprovecha. */
  uses_expiring: string[]
}

export interface RecipeResult {
  recipes: Recipe[]
}

function clampInteger(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min
}

/** Lo validado, con límites e ids reales. Lo bloqueado no pasa aunque el modelo lo proponga. */
export function toRecipeResult(output: RecipeModelOutput, context: { refs: ReadonlyMap<string, string>; blocked: readonly string[] }): RecipeResult {
  const blocked = new Set(context.blocked.map(normalizeTitle))
  const seen = new Set<string>()
  const resolve = (ref: string | null) => (ref ? (context.refs.get(ref.trim().toLowerCase()) ?? null) : null)

  const recipes = output.recipes.flatMap<Recipe>((recipe) => {
    const title = cleanText(recipe.title, 120)
    if (!title) return []
    const key = normalizeTitle(title)
    if (blocked.has(key) || seen.has(key)) return []

    const ingredients = recipe.ingredients.slice(0, 30).flatMap<RecipeIngredient>((ingredient) => {
      const name = cleanText(ingredient.name, 80)
      if (!name) return []
      const productId = resolve(ingredient.product_ref)
      const amount = ingredient.use_amount
      const tapWater = !productId && ingredient.tap_water
      return [
        {
          name,
          amount_text: cleanText(ingredient.amount_text, 60) ?? '',
          have: productId !== null || tapWater,
          matched_product_id: productId,
          use_amount: productId && amount !== null && Number.isFinite(amount) && amount > 0 ? Math.min(100000, Math.round(amount * 1000) / 1000) : null,
          tap_water: tapWater,
        },
      ]
    })
    const steps = recipe.steps.flatMap((step) => cleanText(step, 500) ?? []).slice(0, 12)
    if (ingredients.length === 0 || steps.length === 0) return []

    const used = new Set(ingredients.flatMap((ingredient) => ingredient.matched_product_id ?? []))
    seen.add(key)
    return [
      {
        title,
        time_minutes: clampInteger(recipe.time_minutes, 1, 600),
        servings: clampInteger(recipe.servings, 1, 20),
        ingredients,
        steps,
        uses_expiring: [...new Set(recipe.uses_expiring.flatMap((ref) => resolve(ref) ?? []))].filter((id) => used.has(id)),
      },
    ]
  })

  return { recipes: recipes.slice(0, maxRecipes) }
}
