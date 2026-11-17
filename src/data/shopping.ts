import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ShoppingItem } from '../domain/shopping'
import type { Database, Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useActiveHouseId } from './house'

type Origin = Database['public']['Enums']['shopping_origin']

export function shoppingKey(houseId: string) {
  return ['shopping', houseId] as const
}

export async function fetchShopping(houseId: string): Promise<ShoppingItem[]> {
  const { data, error } = await supabase.from('shopping_items').select('*').eq('house_id', houseId).order('created_at')
  if (error) throw error
  return data
}

/** La lista de la casa activa (o de otra, por ejemplo la del ticket). */
export function useShoppingList(otherHouseId?: string) {
  const activeHouseId = useActiveHouseId()
  const houseId = otherHouseId ?? activeHouseId
  return useQuery({ queryKey: shoppingKey(houseId), queryFn: () => fetchShopping(houseId) })
}

export interface NewShoppingItem {
  houseId: string
  name?: string
  productId?: string
  quantityText?: string
  preferredBrand?: string
  origin?: Origin
}

/** Añade a la lista. Si ya estaba pendiente, no se repite: devuelve added = false. */
export async function addShoppingItem(queryClient: QueryClient, item: NewShoppingItem): Promise<{ id: string; added: boolean }> {
  const { data, error } = await supabase.rpc('add_shopping_item', {
    p_house_id: item.houseId,
    p_name: item.name,
    p_product_id: item.productId,
    p_quantity_text: item.quantityText,
    p_preferred_brand: item.preferredBrand,
    p_origin: item.origin ?? 'manual',
  })
  if (error) throw error
  await queryClient.invalidateQueries({ queryKey: ['shopping'] })
  return data as { id: string; added: boolean }
}

export function useAddShoppingItem() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (item: NewShoppingItem) => addShoppingItem(queryClient, item) })
}

/** Editar, tachar, borrar o borrar lo comprado. Tachar se ve al momento y, si falla, vuelve atrás. */
export function useShoppingActions() {
  const houseId = useActiveHouseId()
  const queryClient = useQueryClient()
  const key = shoppingKey(houseId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shopping'] })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, string | boolean | null> }) => {
      const { error } = await supabase.rpc('update_shopping_item', { p_item_id: id, p_patch: patch as Json })
      if (error) throw error
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ShoppingItem[]>(key)
      if (previous && 'checked' in patch) {
        const checked = patch.checked === true
        queryClient.setQueryData<ShoppingItem[]>(
          key,
          previous.map((item) => (item.id === id ? { ...item, checked, checked_at: checked ? new Date().toISOString() : null } : item)),
        )
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_shopping_item', { p_item_id: id })
      if (error) throw error
    },
    onSettled: refresh,
  })

  const clearBought = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('clear_checked_shopping', { p_house_id: houseId })
      if (error) throw error
      return data
    },
    onSettled: refresh,
  })

  return { update, remove, clearBought }
}
