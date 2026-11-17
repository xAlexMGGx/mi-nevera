import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast, type ToastAction } from '../components/Toast'
import { productName, type CatalogItem, type InventoryData, type Lot, type OpenedUnit } from '../domain/inventory'
import { emptiedProducts, isOnList } from '../domain/shopping'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useActiveHouseId } from './house'
import { addShoppingItem, fetchShopping, shoppingKey } from './shopping'

export async function fetchInventory(houseId: string): Promise<InventoryData> {
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
}

export function inventoryKey(houseId: string) {
  return ['inventory', houseId] as const
}

/** El inventario de la casa activa o, por ejemplo para aplicar un ticket en otra, el de esa casa. */
export function useInventory(otherHouseId?: string) {
  const activeHouseId = useActiveHouseId()
  const houseId = otherHouseId ?? activeHouseId
  return useQuery({
    queryKey: inventoryKey(houseId),
    queryFn: () => fetchInventory(houseId),
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
  | 'ticket'

type Rpc = () => PromiseLike<{ data: unknown; error: unknown }>

interface ActionOptions {
  /** En una hoja, el error se muestra dentro: el aviso inferior quedaría detrás de ella. */
  inlineErrors?: boolean
}

/** Acciones tras las que un producto puede quedarse sin nada (SPEC §13). Mover no: sigue existiendo en otro sitio. */
const finishingActions: ReadonlySet<ToastKey> = new Set(['consumed', 'finished', 'discarded', 'adjusted'])

/** Ejecuta una operación del inventario, refresca los datos y ofrece deshacerla. */
export function useInventoryAction({ inlineErrors = false }: ActionOptions = {}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const houseId = useActiveHouseId()
  const { showUndo, showInfo, showError } = useToast()
  const offline = useOffline()

  /** Si se ha terminado la última unidad de un producto que no está en la lista: "¿Añadir a la lista?". */
  async function finishedQuestion(before: InventoryData | undefined): Promise<{ text: string; action: ToastAction } | null> {
    const [product] = emptiedProducts(before, queryClient.getQueryData<InventoryData>(inventoryKey(houseId)))
    if (!product) return null
    const list = await queryClient.ensureQueryData({ queryKey: shoppingKey(houseId), queryFn: () => fetchShopping(houseId) }).catch(() => [])
    if (isOnList(list, product)) return null

    const catalog = new Map((queryClient.getQueryData<CatalogItem[]>(['catalog']) ?? []).map((item) => [item.id, item]))
    const name = productName(product, catalog, i18n.resolvedLanguage ?? 'es')
    return {
      text: t('toast.finishedAsk', { name }),
      action: {
        label: t('toast.addToList'),
        run: async () => {
          await addShoppingItem(queryClient, { houseId, productId: product.id, name, origin: 'finished' })
          showInfo(t('toast.addedToList', { name }))
        },
      },
    }
  }

  const mutation = useMutation({
    mutationFn: async ({ call }: { toast: ToastKey; call: Rpc }) => {
      const { data, error } = await call()
      if (error) throw error
      return data
    },
    onSuccess: async (movementId, { toast }) => {
      const before = queryClient.getQueryData<InventoryData>(inventoryKey(houseId))
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      // Al añadir con fecha, la casa aprende cuánto suele durar (SPEC §7.4).
      void queryClient.invalidateQueries({ queryKey: ['dateSamples'] })
      // Un ticket tacha lo comprado de la lista.
      void queryClient.invalidateQueries({ queryKey: ['shopping'] })
      if (typeof movementId !== 'string') return

      const question = finishingActions.has(toast) ? await finishedQuestion(before) : null
      if (question) showUndo(question.text, movementId, question.action)
      else showUndo(t(`toast.${toast}`), movementId)
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
    /** También sin conexión: el inventario es de solo lectura y los botones quedan desactivados. */
    pending: mutation.isPending || offline,
    errorKey: mutation.error ? errorKey(mutation.error) : null,
  }
}
