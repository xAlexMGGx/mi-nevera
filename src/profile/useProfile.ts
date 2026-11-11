import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useUser } from '../auth/AuthProvider'
import i18n, { isLocale } from '../i18n'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type Profile = Database['public']['Tables']['profiles']['Row']
type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

export function profileKey(userId: string) {
  return ['profile', userId] as const
}

export function useProfile() {
  const { id } = useUser()
  return useQuery({
    queryKey: profileKey(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
  })
}

/** Se ve el cambio al momento y, si el servidor lo rechaza, se deshace. */
export function useUpdateProfile() {
  const { id } = useUser()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: ProfileUpdate) => {
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: profileKey(id) })
      const previous = queryClient.getQueryData<Profile>(profileKey(id))
      if (previous) queryClient.setQueryData<Profile>(profileKey(id), { ...previous, ...patch } as Profile)
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(profileKey(id), context.previous)
    },
    onSuccess: (profile) => queryClient.setQueryData(profileKey(id), profile),
  })
}

/** El idioma guardado en el perfil manda sobre el del navegador. */
export function useProfileLocale() {
  const { data: profile } = useProfile()
  const locale = profile?.locale

  useEffect(() => {
    if (isLocale(locale) && locale !== i18n.resolvedLanguage) void i18n.changeLanguage(locale)
  }, [locale])
}
