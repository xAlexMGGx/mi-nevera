import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/Toast'
import type { InventoryData, Lot, OpenedUnit } from '../domain/inventory'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useActiveHouseId } from './house'

export function useInventory() {
  const houseId = useActiveHouseId()
  return useQuery({
    queryKey: ['inventory', houseId],
    queryFn: async (): Promise<InventoryData> => {
      const [zones, products, lots, units] = await Promise.all([
        supabase.from('zones').select('*').eq('house_id', houseId).order('sort_order'),
        supabase.from('products').select('*').eq('house_id', houseId),
        supabase.from('lots_with_dates').select('*').eq('house_id', houseId),
        supabase.from('opened_units_with_dates').select('*').eq('house_id', houseId),
      ])
      const error = zones.error ?? products.error ?? lots.error ?? units.error
      if (error) throw error
      return {
        zones: zones.data ?? [],
        products: products.data ?? [],
        // Las vistas se generan con todas las columnas opcionales, pero son las de sus tablas.
        lots: (lots.data ?? []) as unknown as Lot[],
        units: (units.data ?? []) as unknown as OpenedUnit[],
      }
    },
  })
}

export type ToastKey =
  | 'added'
  | 'cooked'
  | 'consumed'
  | 'opened'
  | 'adjusted'
  | 'finished'
  | 'moved'
  | 'frozen'
  | 'thawed'
  | 'discarded'
  | 'edited'

type Rpc = () => PromiseLike<{ data: unknown; error: unknown }>

interface ActionOptions {
  /** En una hoja, el error se muestra dentro: el aviso inferior quedaría detrás de ella. */
  inlineErrors?: boolean
}

/** Ejecuta una operación del inventario, refresca los datos y ofrece deshacerla. */
export function useInventoryAction({ inlineErrors = false }: ActionOptions = {}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { showUndo, showError } = useToast()

  const mutation = useMutation({
    mutationFn: async ({ call }: { toast: ToastKey; call: Rpc }) => {
      const { data, error } = await call()
      if (error) throw error
      return data
    },
    onSuccess: async (movementId, { toast }) => {
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      if (typeof movementId === 'string') showUndo(t(`toast.${toast}`), movementId)
    },
    onError: (error) => {
      if (!inlineErrors) showError(t(errorKey(error)))
    },
  })

  return {
    /** Devuelve si ha ido bien. */
    run: (toast: ToastKey, call: Rpc) =>
      mutation.mutateAsync({ toast, call }).then(
        () => true,
        () => false,
      ),
    pending: mutation.isPending,
    errorKey: mutation.error ? errorKey(mutation.error) : null,
  }
}
