import { useQuery } from '@tanstack/react-query'
import type { DateSample } from '../domain/learnedDates'
import { supabase } from '../lib/supabase'

/** Las fechas de compras anteriores de una casa, para las fechas aprendidas (SPEC §7.4). */
export function useDateSamples(houseId: string) {
  return useQuery({
    queryKey: ['dateSamples', houseId],
    queryFn: async (): Promise<DateSample[]> => {
      const { data, error } = await supabase
        .from('date_samples')
        .select('product_id, days_to_printed_date, printed_date_type, created_at')
        .eq('house_id', houseId)
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data
    },
  })
}
