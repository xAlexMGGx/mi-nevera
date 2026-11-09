import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useProfile } from '../profile/useProfile'

/** Solo para pantallas dentro de RequireHouse, donde siempre hay una casa activa. */
export function useActiveHouseId(): string {
  const { data: profile } = useProfile()
  if (!profile?.active_house_id) throw new Error('useActiveHouseId requiere una casa activa')
  return profile.active_house_id
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
