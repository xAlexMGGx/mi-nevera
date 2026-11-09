import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, use } from 'react'
import { useUser } from '../auth/AuthProvider'
import { useShowError } from '../components/Toast'
import { isOffline } from '../lib/connectivity'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { profileKey, useUpdateProfile } from '../profile/useProfile'

export type HouseRole = Database['public']['Enums']['member_role']

export interface MyHouse {
  id: string
  name: string
  role: HouseRole
}

/**
 * La casa activa con la que se pintó RequireHouse. No se lee del perfil en cada pantalla: si alguien
 * sale de su última casa, una pantalla hija podría ver el perfil ya sin casa antes de que
 * RequireHouse la sustituya por la bienvenida.
 */
export const ActiveHouseContext = createContext<string | null>(null)

/** Solo para pantallas dentro de RequireHouse, donde siempre hay una casa activa. */
export function useActiveHouseId(): string {
  const houseId = use(ActiveHouseContext)
  if (!houseId) throw new Error('useActiveHouseId requiere estar dentro de RequireHouse')
  return houseId
}

export function useActiveHouse() {
  const houseId = useActiveHouseId()
  return useQuery({
    queryKey: ['house', houseId],
    queryFn: async () => {
      const { data, error } = await supabase.from('houses').select('*').eq('id', houseId).single()
      if (error) throw error
      return data
    },
  })
}

export function useHouses() {
  const { id: userId } = useUser()
  return useQuery({
    queryKey: ['houses'],
    queryFn: async (): Promise<MyHouse[]> => {
      const [houses, memberships] = await Promise.all([
        supabase.from('houses').select('id, name').order('created_at'),
        supabase.from('house_members').select('house_id, role').eq('user_id', userId),
      ])
      const error = houses.error ?? memberships.error
      if (error) throw error
      const roles = new Map((memberships.data ?? []).map((row) => [row.house_id, row.role]))
      return (houses.data ?? []).flatMap((house) => {
        const role = roles.get(house.id)
        return role ? [{ ...house, role }] : []
      })
    },
  })
}

/** Las zonas de otra casa, para elegir a dónde mover algo. */
export function useHouseZones(houseId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['zones', houseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('zones').select('*').eq('house_id', houseId).order('sort_order')
      if (error) throw error
      return data
    },
  })
}

export function useHouseMembers(houseId: string) {
  return useQuery({
    queryKey: ['members', houseId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_house_members', { p_house_id: houseId })
      if (error) throw error
      return data
    },
  })
}

/** Las invitaciones aún por usar. Solo el propietario puede verlas. */
export function useHouseInvites(houseId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['invites', houseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('house_invites')
        .select('id, code, expires_at')
        .eq('house_id', houseId)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

type Rpc<T> = (variables: T) => PromiseLike<{ data: unknown; error: unknown }>

/** Una operación sobre casas o miembros, tras la que se refrescan esos datos. */
export function useHouseMutation<T = void>(call: Rpc<T>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: T) => {
      const { data, error } = await call(variables)
      if (error) throw error
      return data
    },
    onSuccess: async () => {
      for (const key of ['house', 'houses', 'members', 'invites']) void queryClient.invalidateQueries({ queryKey: [key] })
      // Hay que esperarlo: la casa activa decide qué pantalla se ve a continuación.
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

/** Cambia la casa activa. Sin conexión solo cambia aquí, para consultar lo que haya guardado. */
export function useSwitchHouse() {
  const { id: userId } = useUser()
  const queryClient = useQueryClient()
  const updateProfile = useUpdateProfile()
  const showError = useShowError()

  return (houseId: string) => {
    if (isOffline()) {
      type Profile = Database['public']['Tables']['profiles']['Row']
      queryClient.setQueryData<Profile>(profileKey(userId), (profile) => profile && { ...profile, active_house_id: houseId })
      return
    }
    updateProfile.mutate(
      { active_house_id: houseId },
      {
        onError: (error) => {
          showError(error)
          void queryClient.invalidateQueries({ queryKey: ['houses'] })
        },
      },
    )
  }
}
