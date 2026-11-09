import { useInfiniteQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Screen } from '../components/Screen'
import { Button, FullScreenLoader, LoadError } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useActiveHouseId } from '../data/house'
import { addDays, formatLongDay, formatTime, todayIn } from '../domain/dates'
import type { CatalogById } from '../domain/inventory'
import { formatPercent, formatQuantity } from '../domain/quantity'
import type { BulkUnit, QuantityKind, ZoneKind } from '../domain/types'
import { supabase } from '../lib/supabase'

const pageSize = 50

const columns = 'id, seq, type, product_name, catalog_item_id, details, created_at'

interface MovementDetails {
  amount?: number
  fraction?: number
  edited?: boolean
  zone?: ZoneKind
  to_zone?: ZoneKind
  container_number?: number
  quantity_kind: QuantityKind
  unit_label: string
  bulk_unit: BulkUnit | null
}

interface Movement {
  id: string
  seq: number
  type: string
  product_name: string
  catalog_item_id: string | null
  details: MovementDetails
  created_at: string
}

function movementText(movement: Movement, catalog: CatalogById, t: TFunction, tag: string, language: string): string {
  const item = movement.catalog_item_id ? catalog.get(movement.catalog_item_id) : undefined
  const name = item ? (language === 'en' ? item.name_en : item.name_es) : movement.product_name
  const { details } = movement
  const amount = details.amount ?? 0
  const qty = formatQuantity(amount, details, t, tag)
  const zone = details.zone ? t(`zones.${details.zone}`) : ''
  const toZone = details.to_zone ? t(`zones.${details.to_zone}`) : ''

  switch (movement.type) {
    case 'added':
      return t('movements.types.added', { count: amount, qty, name, zone })
    case 'consumed':
      return t('movements.types.consumed', { count: amount, qty, name })
    case 'opened':
      return t('movements.types.opened', { name })
    case 'finished':
      return t('movements.types.finished', { qty, name })
    case 'adjusted':
      if (details.edited) return t('movements.types.edited', { name })
      if (details.fraction !== undefined) {
        return t('movements.types.adjustedFraction', { name, percent: formatPercent(details.fraction, tag) })
      }
      return t('movements.types.adjusted', { name, qty })
    case 'moved_zone':
      return t('movements.types.moved', { count: amount, qty, name, zone: toZone })
    case 'frozen':
      return t('movements.types.frozen', { count: amount, qty, name })
    case 'thawed':
      return t('movements.types.thawed', { count: amount, qty, name, zone: toZone })
    case 'discarded':
      return t('movements.types.discarded', { count: amount, qty, name })
    case 'cooked':
      return t('movements.types.cooked', { number: details.container_number, name, qty })
    default:
      return t('movements.types.other', { name })
  }
}

export function MovementsPage() {
  const { t } = useTranslation()
  const { language, tag, timezone, today } = useDateContext()
  const houseId = useActiveHouseId()
  const catalog = useCatalog()

  const query = useInfiniteQuery({
    queryKey: ['movements', houseId],
    initialPageParam: 0,
    getNextPageParam: (lastPage: Movement[], pages) => (lastPage.length === pageSize ? pages.length * pageSize : undefined),
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from('movements')
        .select(columns)
        .eq('house_id', houseId)
        .order('seq', { ascending: false })
        .range(pageParam, pageParam + pageSize - 1)
      if (error) throw error
      return data as unknown as Movement[]
    },
  })

  function renderList() {
    if (query.isPending || catalog.isPending) return <FullScreenLoader />
    if (query.isError) return <LoadError onRetry={() => void query.refetch()} />

    const movements = query.data.pages.flat()
    if (movements.length === 0) return <p className="py-12 text-center text-ink-muted">{t('movements.empty')}</p>

    const days = new Map<string, Movement[]>()
    for (const movement of movements) {
      const day = todayIn(timezone, new Date(movement.created_at))
      days.set(day, [...(days.get(day) ?? []), movement])
    }

    return (
      <div className="flex flex-col gap-5">
        {[...days.entries()].map(([day, entries]) => (
          <section key={day} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-muted first-letter:uppercase">
              {day === today ? t('movements.today') : day === addDays(today, -1) ? t('movements.yesterday') : formatLongDay(day, tag)}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
              {entries.map((movement) => (
                <li key={movement.id} className="flex items-baseline gap-3 px-3.5 py-3">
                  <p className="min-w-0 flex-1">{movementText(movement, catalog.byId, t, tag, language)}</p>
                  <time className="shrink-0 text-xs text-ink-muted">{formatTime(movement.created_at, tag, timezone)}</time>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {query.hasNextPage && (
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t('movements.loadMore')}
          </Button>
        )}
      </div>
    )
  }

  return <Screen title={t('movements.title')} backTo="/settings" main={renderList()} />
}
