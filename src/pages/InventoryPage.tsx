import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { HouseSwitcher } from '../components/HouseSwitcher'
import { CardIcon, GearIcon, GridIcon, ListIcon, SearchIcon } from '../components/icons'
import { ProductPhoto } from '../components/ProductPhoto'
import { Screen, topBarIcon } from '../components/Screen'
import { StatusBadge } from '../components/StatusBadge'
import { Button, FullScreenLoader, LoadError, buttonClass, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useActiveHouse } from '../data/house'
import { useInventory, useInventoryAction } from '../data/inventory'
import { formatDayMonth } from '../domain/dates'
import { buildProductViews, sortModes, sortViews, type ProductView, type Zone } from '../domain/inventory'
import { cardImage, extraBrands } from '../domain/photos'
import { summarize } from '../domain/quantity'
import { createSearch } from '../domain/search'
import { zoneKinds, type Category, type ZoneKind } from '../domain/types'
import { useOffline } from '../lib/connectivity'
import { supabase } from '../lib/supabase'
import { usePersistedState } from '../lib/persistedState'
import { ConsumeAmountSheet } from './product/sheets'

const zoneFilters = ['all', ...zoneKinds] as const

function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium ${
        active ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'
      } ${focusRing}`}
    >
      {label}
    </button>
  )
}

function ProductRow({ view, zoneId }: { view: ProductView; zoneId?: string }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const { run, pending } = useInventoryAction()
  const [askAmount, setAskAmount] = useState(false)
  const { product } = view

  function consumeOne() {
    if (product.quantity_kind === 'bulk') {
      setAskAmount(true)
    } else {
      void run('consumed', () => supabase.rpc('consume', { p_product_id: product.id, p_zone_id: zoneId }))
    }
  }

  return (
    <li className="flex items-center rounded-2xl border border-line bg-surface">
      <Link to={`/product/${product.id}`} className={`flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl py-2.5 pl-3 ${focusRing}`}>
        <span aria-hidden="true" className="w-9 shrink-0 text-center text-3xl leading-none">
          {view.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="w-full truncate font-semibold">
            {view.containerNumber !== null && (
              <span className="text-brand">{t('inventory.containerNumber', { number: view.containerNumber })} </span>
            )}
            {view.name}
          </span>
          <span className="w-full truncate text-sm text-ink-muted">{summarize(product, view.lots, view.units, t, tag)}</span>
          {view.rowDate ? (
            <StatusBadge rowDate={view.rowDate} />
          ) : (
            view.frozenSince && (
              <span className="text-xs font-semibold text-ink-muted">
                {t('inventory.frozenSince', { date: formatDayMonth(view.frozenSince) })}
              </span>
            )
          )}
        </span>
      </Link>
      <button
        type="button"
        aria-label={t('inventory.consumeOne', { name: view.name })}
        disabled={pending}
        onClick={consumeOne}
        className={`mx-2 flex size-12 shrink-0 items-center justify-center rounded-xl border border-line text-base font-bold text-ink transition-opacity active:bg-line disabled:opacity-40 ${focusRing}`}
      >
        {t('inventory.minusOne')}
      </button>
      {askAmount && (
        <ConsumeAmountSheet product={product} name={view.name} lots={view.lots} zoneId={zoneId} onClose={() => setAskAmount(false)} />
      )}
    </li>
  )
}

/** Tarjeta (SPEC §12): imagen, nombre, cantidad y fecha. Sin marca: solo "+N" si hay varias. */
function ProductCard({ view, large }: { view: ProductView; large: boolean }) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const { product } = view
  const extra = extraBrands(view.lots)

  return (
    <li className="min-w-0">
      <Link to={`/product/${product.id}`} className={`flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface ${focusRing}`}>
        <div className={`relative w-full ${large ? 'aspect-[4/3]' : 'aspect-square'}`}>
          <ProductPhoto
            src={cardImage(view.lots, product)}
            icon={view.icon}
            className="size-full"
            iconClassName={`size-full bg-canvas ${large ? 'text-7xl' : 'text-5xl'}`}
          />
          {view.containerNumber !== null && (
            <span className="absolute top-2 left-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-on-brand">
              {t('inventory.containerNumber', { number: view.containerNumber })}
            </span>
          )}
          {extra > 0 && (
            <span
              aria-label={t('inventory.moreBrands', { count: extra })}
              className="absolute top-2 right-2 rounded-full bg-ink/75 px-2 py-0.5 text-xs font-semibold text-canvas"
            >
              {t('inventory.moreBrandsShort', { count: extra })}
            </span>
          )}
        </div>
        <span className="flex flex-1 flex-col items-start gap-1 p-2.5">
          <span className="line-clamp-2 font-semibold leading-snug">{view.name}</span>
          <span className="line-clamp-2 text-sm text-ink-muted">{summarize(product, view.lots, view.units, t, tag)}</span>
          {view.rowDate ? (
            <StatusBadge rowDate={view.rowDate} />
          ) : (
            view.frozenSince && (
              <span className="text-xs font-semibold text-ink-muted">{t('inventory.frozenSince', { date: formatDayMonth(view.frozenSince) })}</span>
            )
          )}
        </span>
      </Link>
    </li>
  )
}

type Layout = { view: 'list' | 'cards'; columns: '1' | '2' }

function ProductList({ views, zoneId, layout }: { views: ProductView[]; zoneId?: string; layout: Layout }) {
  if (layout.view === 'list') {
    return (
      <ul className="flex flex-col gap-2">
        {views.map((view) => (
          <ProductRow key={view.product.id} view={view} zoneId={zoneId} />
        ))}
      </ul>
    )
  }
  return (
    <ul className={`grid gap-3 ${layout.columns === '2' ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {views.map((view) => (
        <ProductCard key={view.product.id} view={view} large={layout.columns === '1'} />
      ))}
    </ul>
  )
}

function CategoryGroups({ views, zoneId, layout }: { views: ProductView[]; zoneId?: string; layout: Layout }) {
  const { t } = useTranslation()
  const groups: { category: Category; views: ProductView[] }[] = []
  for (const view of views) {
    const last = groups.at(-1)
    if (last?.category === view.product.category) last.views.push(view)
    else groups.push({ category: view.product.category, views: [view] })
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.category} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-muted">{t(`categories.${group.category}`)}</h2>
          <ProductList views={group.views} zoneId={zoneId} layout={layout} />
        </section>
      ))}
    </div>
  )
}

/** Lista · Tarjetas en dos columnas · Tarjetas en una columna, con iconos para que quepa todo en una fila. */
function ToggleGroup<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; icon: ReactNode }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
          className={`flex size-9 items-center justify-center rounded-md ${value === option.value ? 'bg-brand text-on-brand' : 'text-ink-muted'} ${focusRing}`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  )
}

function zoneIdOf(zones: Zone[], filter: ZoneKind | 'all') {
  return filter === 'all' ? undefined : zones.find((zone) => zone.kind === filter)?.id
}

export function InventoryPage() {
  const { t } = useTranslation()
  const { language, tag, today, daysAhead } = useDateContext()
  const inventory = useInventory()
  const catalog = useCatalog()
  const { data: house } = useActiveHouse()
  const offline = useOffline()

  // La búsqueda va en la URL para seguir ahí al volver del detalle de un producto.
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [zone, setZone] = usePersistedState('nevera.inventory.zone', zoneFilters, 'all')
  const [leftovers, setLeftovers] = usePersistedState('nevera.inventory.leftovers', ['no', 'yes'], 'no')
  const [sort, setSort] = usePersistedState('nevera.inventory.sort', sortModes, 'date')
  const [viewMode, setViewMode] = usePersistedState('nevera.inventory.view', ['list', 'cards'], 'list')
  const [columns, setColumns] = usePersistedState('nevera.inventory.columns', ['1', '2'], '2')
  const layout: Layout = { view: viewMode, columns }

  const views = useMemo(() => {
    if (!inventory.data) return []
    const built = buildProductViews(inventory.data, {
      catalog: catalog.byId,
      language,
      today,
      daysAhead,
      zone,
      leftoversOnly: leftovers === 'yes',
    })
    return query.trim() ? createSearch(built)(query) : sortViews(built, sort, tag)
  }, [inventory.data, catalog.byId, language, tag, today, daysAhead, zone, leftovers, sort, query])

  const hasStock = (inventory.data?.lots.length ?? 0) > 0
  const zoneId = inventory.data ? zoneIdOf(inventory.data.zones, zone) : undefined

  function renderList() {
    if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
    if (inventory.isLoadingError) return <LoadError onRetry={() => void inventory.refetch()} />

    if (!hasStock) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span aria-hidden="true" className="text-5xl">
            🧺
          </span>
          <p className="text-lg font-semibold">{t('inventory.emptyTitle')}</p>
          <p className="text-ink-muted">{t('inventory.emptyBody')}</p>
          {offline ? (
            <Button disabled className="mt-2 max-w-60">
              {t('inventory.emptyAction')}
            </Button>
          ) : (
            <Link to="/add" className={`mt-2 max-w-60 ${buttonClass()}`}>
              {t('inventory.emptyAction')}
            </Link>
          )}
        </div>
      )
    }
    if (views.length === 0) {
      return (
        <p className="py-12 text-center text-ink-muted">
          {query.trim() ? t('inventory.noResults', { query: query.trim() }) : t('inventory.emptyFilter')}
        </p>
      )
    }
    if (sort === 'category' && !query.trim()) return <CategoryGroups views={views} zoneId={zoneId} layout={layout} />
    return <ProductList views={views} zoneId={zoneId} layout={layout} />
  }

  return (
    <Screen
      withNav
      title={house?.name ?? t('app.name')}
      heading={<HouseSwitcher />}
      action={
        <Link to="/settings" aria-label={t('settings.open')} className={topBarIcon}>
          <GearIcon />
        </Link>
      }
      main={renderList()}
    >
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-muted">
            <SearchIcon />
          </span>
          <input
            type="search"
            aria-label={t('inventory.searchLabel')}
            placeholder={t('inventory.searchPlaceholder')}
            value={query}
            onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {}, { replace: true })}
            className={`min-h-11 w-full appearance-none rounded-xl border border-line bg-surface pr-3 pl-11 text-base text-ink ${focusRing}`}
          />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {zoneFilters.map((filter) => (
            <FilterPill
              key={filter}
              active={zone === filter}
              label={filter === 'all' ? t('inventory.zoneAll') : t(`zones.${filter}`)}
              onClick={() => setZone(filter)}
            />
          ))}
          <FilterPill
            active={leftovers === 'yes'}
            label={t('inventory.leftovers')}
            onClick={() => setLeftovers(leftovers === 'yes' ? 'no' : 'yes')}
          />
        </div>
        {hasStock && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              label={t('inventory.view.label')}
              value={viewMode === 'list' ? 'list' : `cards${columns}`}
              onChange={(value) => {
                if (value === 'list') return setViewMode('list')
                setViewMode('cards')
                setColumns(value === 'cards1' ? '1' : '2')
              }}
              options={[
                { value: 'list', icon: <ListIcon />, label: t('inventory.view.list') },
                { value: 'cards2', icon: <GridIcon />, label: t('inventory.view.cardsTwo') },
                { value: 'cards1', icon: <CardIcon />, label: t('inventory.view.cardsOne') },
              ]}
            />
            {!query.trim() && (
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <span className="sr-only">{t('inventory.sortLabel')}</span>
                <select
                  aria-label={t('inventory.sortLabel')}
                  value={sort}
                  onChange={(event) => setSort(event.target.value as (typeof sortModes)[number])}
                  // Con letra menor de 16 px, el iPhone hace zoom al tocarlo.
                  className={`min-h-9 rounded-lg border border-line bg-surface px-2 text-base font-medium text-ink ${focusRing}`}
                >
                  {sortModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`inventory.sort.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>
    </Screen>
  )
}
