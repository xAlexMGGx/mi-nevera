import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useUser } from '../auth/AuthProvider'
import { isKitchenRecipe, recipeFilters, recipeModes, type KitchenRecipe, type RecipeRequest, type RecipeResult } from '../domain/recipes'
import type { Json } from '../lib/database.types'
import { errorKey, type ErrorKey } from '../lib/errors'
import { invokeFunction } from '../lib/functions'
import { supabase } from '../lib/supabase'
import { useActiveHouseId } from './house'

export interface Favorite {
  id: string
  title: string
  house_id: string | null
  recipe: KitchenRecipe
  created_at: string
}

export interface Blocked {
  id: string
  title: string
}

/** Personales: se ven desde todas las casas de quien los guardó. */
export function useRecipeFavorites() {
  const { id } = useUser()
  return useQuery({
    queryKey: ['recipeFavorites', id],
    queryFn: async (): Promise<Favorite[]> => {
      const { data, error } = await supabase.from('recipe_favorites').select('id, title, house_id, recipe, created_at').order('created_at', { ascending: false })
      if (error) throw error
      return data.flatMap((row) => (isKitchenRecipe(row.recipe) ? [{ ...row, recipe: row.recipe }] : []))
    },
  })
}

export function useBlockedRecipes() {
  const { id } = useUser()
  return useQuery({
    queryKey: ['recipeBlocked', id],
    queryFn: async (): Promise<Blocked[]> => {
      const { data, error } = await supabase.from('recipe_blocked').select('id, title').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useRecipeActions() {
  const houseId = useActiveHouseId()
  const queryClient = useQueryClient()
  const refreshFavorites = () => queryClient.invalidateQueries({ queryKey: ['recipeFavorites'] })
  const refreshBlocked = () => queryClient.invalidateQueries({ queryKey: ['recipeBlocked'] })

  const saveFavorite = useMutation({
    mutationFn: async (recipe: KitchenRecipe) => {
      const { data, error } = await supabase.rpc('save_recipe_favorite', { p_house_id: houseId, p_recipe: recipe as unknown as Json })
      if (error) throw error
      return data
    },
    onSettled: refreshFavorites,
  })

  const removeFavorite = useMutation({
    mutationFn: async (favoriteId: string) => {
      const { error } = await supabase.rpc('delete_recipe_favorite', { p_favorite_id: favoriteId })
      if (error) throw error
    },
    onSettled: refreshFavorites,
  })

  const block = useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await supabase.rpc('block_recipe', { p_title: title })
      if (error) throw error
      return data
    },
    onSettled: refreshBlocked,
  })

  const unblock = useMutation({
    mutationFn: async (blockedId: string) => {
      const { error } = await supabase.rpc('unblock_recipe', { p_blocked_id: blockedId })
      if (error) throw error
    },
    onSettled: refreshBlocked,
  })

  return { saveFavorite, removeFavorite, block, unblock }
}

/** Pide 3 recetas a la Edge Function suggest-recipes, con el inventario de la casa activa. */
export function useSuggestRecipes() {
  const houseId = useActiveHouseId()
  return useMutation({
    mutationFn: ({ request, today }: { request: RecipeRequest; today: string }) =>
      invokeFunction<RecipeResult>('suggest-recipes', { house_id: houseId, today, request: { ...request } }),
  })
}

const aiErrors = {
  'errors.ai_not_configured': 'recipes.errors.ai_not_configured',
  'errors.ai_no_credit': 'recipes.errors.ai_no_credit',
  'errors.ai_quota': 'recipes.errors.ai_quota',
  'errors.ai_unavailable': 'recipes.errors.ai_unavailable',
  'errors.ai_unreadable': 'recipes.errors.ai_unreadable',
} as const

/** Los errores de la IA hablan de fotos y tickets: aquí se dicen con palabras de recetas. */
export function recipeErrorKey(error: unknown): ErrorKey | (typeof aiErrors)[keyof typeof aiErrors] {
  const key = errorKey(error)
  return key in aiErrors ? aiErrors[key as keyof typeof aiErrors] : key
}

// ------------------------------------------------------------------------------------------------
// En el móvil: las últimas sugerencias de cada casa (volver a verlas no cuesta otra petición) y lo
// último que se pidió.
// ------------------------------------------------------------------------------------------------

function suggestionsKey(userId: string, houseId: string) {
  return `nevera:recipes:${userId}:${houseId}`
}

export function loadSuggestions(userId: string, houseId: string): KitchenRecipe[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(suggestionsKey(userId, houseId)) ?? 'null')
    return Array.isArray(raw) ? raw.filter(isKitchenRecipe) : []
  } catch {
    return []
  }
}

export function saveSuggestions(userId: string, houseId: string, recipes: KitchenRecipe[]) {
  try {
    localStorage.setItem(suggestionsKey(userId, houseId), JSON.stringify(recipes))
  } catch {
    // Sin almacenamiento, duran hasta cerrar la app.
  }
}

const requestKey = 'nevera.recipes.request'

export const defaultRequest: RecipeRequest = { mode: 'use_up', filters: [], text: null, servings: null, max_minutes: null }

export function loadRequest(): RecipeRequest {
  try {
    const raw = JSON.parse(localStorage.getItem(requestKey) ?? 'null') as Partial<RecipeRequest> | null
    if (!raw || !recipeModes.includes(raw.mode!)) return defaultRequest
    return {
      mode: raw.mode!,
      filters: Array.isArray(raw.filters) ? raw.filters.filter((filter) => recipeFilters.includes(filter)) : [],
      text: typeof raw.text === 'string' ? raw.text : null,
      servings: typeof raw.servings === 'number' ? raw.servings : null,
      max_minutes: typeof raw.max_minutes === 'number' ? raw.max_minutes : null,
    }
  } catch {
    return defaultRequest
  }
}

export function saveRequest(request: RecipeRequest) {
  try {
    localStorage.setItem(requestKey, JSON.stringify(request))
  } catch {
    // Se pierde al cerrar la app, sin más.
  }
}
