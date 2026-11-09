import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { CatalogById } from '../domain/inventory'
import { supabase } from '../lib/supabase'

const oneDay = 24 * 60 * 60 * 1000

/** El catálogo es global y casi nunca cambia. */
export function useCatalog() {
  const query = useQuery({
    queryKey: ['catalog'],
    staleTime: oneDay,
    queryFn: async () => {
      const { data, error } = await supabase.from('catalog_items').select('*')
      if (error) throw error
      return data
    },
  })

  const byId = useMemo<CatalogById>(() => new Map((query.data ?? []).map((item) => [item.id, item])), [query.data])

  return { ...query, items: query.data ?? [], byId }
}
