import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { HouseSwitcher } from '../components/HouseSwitcher'
import { GearIcon, PencilIcon, PlusIcon } from '../components/icons'
import { Screen, topBarIcon } from '../components/Screen'
import { Sheet } from '../components/Sheet'
import { Button, FullScreenLoader, LoadError, Message, TextField, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useActiveHouseId } from '../data/house'
import { useInventory } from '../data/inventory'
import { shoppingKey, useAddShoppingItem, useShoppingActions, useShoppingList } from '../data/shopping'
import { productIcon, productName, type CatalogById, type CatalogItem, type InventoryData } from '../domain/inventory'
import { createSearch } from '../domain/search'
import { splitShopping, type ShoppingItem } from '../domain/shopping'
import { categoryIcons } from '../domain/types'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'

interface Suggestion {
  key: string
  name: string
  icon: string
  searchTerms: string[]
  productId?: string
}

/** Lo que se puede apuntar tocando: productos de la casa y del catálogo. */
function useSuggestions(data: InventoryData | undefined, catalog: CatalogById, items: CatalogItem[]) {
  const { language } = useDateContext()
  return useMemo(() => {
    const inHouse = new Set(data?.products.map((product) => product.catalog_item_id))
    const fromHouse: Suggestion[] = (data?.products ?? [])
      .filter((product) => product.kind === 'food')
      .map((product) => {
        const item = product.catalog_item_id ? catalog.get(product.catalog_item_id) : undefined
        return {
          key: product.id,
          name: productName(product, catalog, language),
          icon: productIcon(product, catalog),
          searchTerms: item ? [item.name_es, item.name_en, ...item.synonyms_es, ...item.synonyms_en] : [product.name],
          productId: product.id,
        }
      })
    const fromCatalog: Suggestion[] = items
      .filter((item) => !inHouse.has(item.id))
      .map((item) => ({
        key: item.id,
        name: language === 'en' ? item.name_en : item.name_es,
        icon: item.icon,
        searchTerms: [item.name_es, item.name_en, ...item.synonyms_es, ...item.synonyms_en],
      }))
    return createSearch([...fromHouse, ...fromCatalog])
  }, [data, catalog, items, language])
}

function AddItemForm({ data, catalog, items }: { data: InventoryData | undefined; catalog: CatalogById; items: CatalogItem[] }) {
  const { t } = useTranslation()
  const houseId = useActiveHouseId()
  const offline = useOffline()
  const add = useAddShoppingItem()
  const queryClient = useQueryClient()
  const search = useSuggestions(data, catalog, items)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [already, setAlready] = useState<string | null>(null)
  const suggestions = name.trim().length >= 2 ? search(name).slice(0, 4) : []

  function submit(values: { name: string; productId?: string }) {
    setAlready(null)
    add.mutate(
      { houseId, name: values.name, productId: values.productId, quantityText: quantity.trim() || undefined },
      {
        onSuccess: (result) => {
          // El nombre con el que ya estaba apuntado, no el que se acaba de escribir.
          const existing = queryClient.getQueryData<ShoppingItem[]>(shoppingKey(houseId))?.find((item) => item.id === result.id)
          if (!result.added) setAlready(existing?.name ?? values.name)
          setName('')
          setQuantity('')
        },
      },
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim()) submit({ name: name.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          aria-label={t('shopping.addLabel')}
          placeholder={t('shopping.addPlaceholder')}
          autoComplete="off"
          maxLength={80}
          value={name}
          disabled={offline}
          onChange={(event) => {
            setName(event.target.value)
            setAlready(null)
            add.reset()
          }}
          className={`min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-base text-ink disabled:opacity-50 ${focusRing}`}
        />
        <input
          aria-label={t('shopping.quantityLabel')}
          placeholder={t('shopping.quantityPlaceholder')}
          autoComplete="off"
          maxLength={40}
          value={quantity}
          disabled={offline}
          onChange={(event) => setQuantity(event.target.value)}
          className={`min-h-11 w-20 shrink-0 rounded-xl border border-line bg-surface px-2.5 text-base text-ink disabled:opacity-50 ${focusRing}`}
        />
        <button
          type="submit"
          aria-label={t('shopping.add')}
          disabled={offline || add.isPending || !name.trim()}
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand disabled:opacity-40 ${focusRing}`}
        >
          <PlusIcon />
        </button>
      </div>
      {suggestions.length > 0 && (
        <ul aria-label={t('shopping.suggestions')} className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion.key}>
              <button
                type="button"
                disabled={offline || add.isPending}
                onClick={() => submit({ name: suggestion.name, productId: suggestion.productId })}
                className={`flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-medium disabled:opacity-50 ${focusRing}`}
              >
                <span aria-hidden="true">{suggestion.icon}</span>
                {suggestion.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {already && <Message tone="success">{t('shopping.already', { name: already })}</Message>}
      {add.isError && <Message tone="error">{t(errorKey(add.error))}</Message>}
    </form>
  )
}

function EditItemSheet({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const { t } = useTranslation()
  const { update, remove } = useShoppingActions()
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(item.quantity_text ?? '')
  const [brand, setBrand] = useState(item.preferred_brand ?? '')
  const error = update.error ?? remove.error

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate({ id: item.id, patch: { name, quantity_text: quantity || null, preferred_brand: brand || null } }, { onSuccess: onClose })
  }

  return (
    <Sheet title={t('shopping.editTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField label={t('shopping.name')} required maxLength={80} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        <TextField label={t('shopping.quantity')} maxLength={40} autoComplete="off" placeholder={t('shopping.quantityExample')} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        <TextField label={t('product.preferredBrand')} maxLength={80} autoComplete="off" value={brand} onChange={(event) => setBrand(event.target.value)} />
        {Boolean(error) && <Message tone="error">{t(errorKey(error))}</Message>}
        <Button type="submit" disabled={update.isPending || !name.trim()}>
          {t('common.save')}
        </Button>
        <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(item.id, { onSuccess: onClose })}>
          {t('shopping.remove')}
        </Button>
      </form>
    </Sheet>
  )
}

function ItemRow({ item, icon, onEdit }: { item: ShoppingItem; icon: string; onEdit: () => void }) {
  const { t } = useTranslation()
  const offline = useOffline()
  const { update } = useShoppingActions()
  const details = [item.quantity_text, item.preferred_brand].filter(Boolean).join(' · ')

  return (
    <li className={`flex items-center gap-1 rounded-2xl border border-line bg-surface py-1.5 pr-1.5 pl-3 ${item.checked ? 'opacity-70' : ''}`}>
      {/* Toda la fila tacha: en el súper se acierta mejor con una mano. */}
      <label className={`flex min-w-0 flex-1 items-center gap-3 ${offline ? '' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          aria-label={t('shopping.check', { name: item.name })}
          checked={item.checked}
          disabled={offline}
          onChange={(event) => update.mutate({ id: item.id, patch: { checked: event.target.checked } })}
          className="size-6 shrink-0 accent-[var(--brand)]"
        />
        <span aria-hidden="true" className="w-7 shrink-0 text-center text-2xl leading-none">
          {icon}
        </span>
        <span className="flex min-h-12 min-w-0 flex-1 flex-col justify-center">
          <span className={`truncate ${item.checked ? 'text-ink-muted line-through' : 'font-semibold'}`}>{item.name}</span>
          {details && <span className="truncate text-sm text-ink-muted">{details}</span>}
        </span>
      </label>
      <button
        type="button"
        aria-label={t('shopping.edit', { name: item.name })}
        disabled={offline}
        onClick={onEdit}
        className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-line disabled:opacity-40 ${focusRing}`}
      >
        <PencilIcon />
      </button>
    </li>
  )
}

/** Lista de la compra de la casa (SPEC §13): compartida, en tiempo real, con la marca preferida. */
export function ShoppingPage() {
  const { t } = useTranslation()
  const list = useShoppingList()
  const inventory = useInventory()
  const catalog = useCatalog()
  const offline = useOffline()
  const { clearBought } = useShoppingActions()
  const [editing, setEditing] = useState<ShoppingItem | null>(null)
  const [clearing, setClearing] = useState(false)

  const products = useMemo(() => new Map((inventory.data?.products ?? []).map((product) => [product.id, product])), [inventory.data])
  const iconOf = (item: ShoppingItem) => {
    const product = item.product_id ? products.get(item.product_id) : undefined
    return product ? productIcon(product, catalog.byId) : categoryIcons.other
  }

  function renderList() {
    if (list.isPending) return <FullScreenLoader />
    if (list.isLoadingError) return <LoadError onRetry={() => void list.refetch()} />
    const { pending, bought } = splitShopping(list.data)

    if (pending.length === 0 && bought.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-lg font-semibold">{t('shopping.emptyTitle')}</p>
          <p className="text-ink-muted">{t('shopping.emptyBody')}</p>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-5">
        {pending.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-muted">{t('shopping.pending', { count: pending.length })}</h2>
            <ul className="flex flex-col gap-2">
              {pending.map((item) => (
                <ItemRow key={item.id} item={item} icon={iconOf(item)} onEdit={() => setEditing(item)} />
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-center font-semibold text-success">{t('shopping.allBought')}</p>
        )}
        {bought.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-muted">{t('shopping.bought', { count: bought.length })}</h2>
            <ul className="flex flex-col gap-2">
              {bought.map((item) => (
                <ItemRow key={item.id} item={item} icon={iconOf(item)} onEdit={() => setEditing(item)} />
              ))}
            </ul>
            <Button variant="secondary" disabled={offline || clearBought.isPending} onClick={() => setClearing(true)}>
              {t('shopping.clearBought', { count: bought.length })}
            </Button>
          </section>
        )}
      </div>
    )
  }

  return (
    <Screen
      withNav
      title={t('shopping.title')}
      heading={<HouseSwitcher />}
      action={
        <Link to="/settings" aria-label={t('settings.open')} className={topBarIcon}>
          <GearIcon />
        </Link>
      }
      main={
        <>
          {renderList()}
          {editing && <EditItemSheet key={editing.id} item={editing} onClose={() => setEditing(null)} />}
          {clearing && (
            <ConfirmSheet
              title={t('shopping.clearTitle')}
              body={t('shopping.clearBody', { count: list.data?.filter((item) => item.checked).length ?? 0 })}
              submit={t('shopping.clearSubmit')}
              pending={clearBought.isPending}
              error={clearBought.error}
              onConfirm={() => clearBought.mutate(undefined, { onSuccess: () => setClearing(false) })}
              onClose={() => setClearing(false)}
            />
          )}
        </>
      }
    >
      <AddItemForm data={inventory.data} catalog={catalog.byId} items={catalog.items} />
    </Screen>
  )
}
