import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useUser } from '../auth/AuthProvider'
import i18n, { isLocale } from '../i18n'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

function profileKey(userId: string) {
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

export function useUpdateProfile() {
  const { id } = useUser()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: ProfileUpdate) => {
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select().single()
      if (error) throw error
      return data
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
