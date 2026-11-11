import { useQuery } from '@tanstack/react-query'
import type { GuideEntry } from '../domain/shelfLife'
import { supabase } from '../lib/supabase'

const oneDay = 24 * 60 * 60 * 1000

/** La guía de conservación es global y solo cambia con una migración. */
export function useShelfLifeGuide() {
  return useQuery({
    queryKey: ['shelfLifeGuide'],
    staleTime: oneDay,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shelf_life_guide')
        .select('catalog_item_id, category, state, min_days, max_days, note_es, note_en, source')
      if (error) throw error
      return data as GuideEntry[]
    },
  })
}
