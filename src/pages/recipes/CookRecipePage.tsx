import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Screen } from '../../components/Screen'
import { ShelfLifeChip } from '../../components/ShelfLifeChip'
import { Button, FullScreenLoader, LoadError, Message, Segmented, Stepper, TextField, focusRing } from '../../components/ui'
import { useCatalog } from '../../data/catalog'
import { useDateContext } from '../../data/context'
import { useActiveHouseId } from '../../data/house'
import { useInventory, useInventoryAction } from '../../data/inventory'
import { productIcon, productName, type CatalogById, type InventoryData } from '../../domain/inventory'
import { normalizeName } from '../../domain/lotDraft'
import { cookItems, cookLineProblem, cookLines, ingredientViews, isKitchenRecipe, type CookLine, type KitchenRecipe } from '../../domain/recipes'
import { formatNumber, parseAmount, unitName } from '../../domain/quantity'
import { isUnitLabel } from '../../domain/types'
import type { Json } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'
import type { CookState } from './RecipeCard'

type DishZone = 'fridge' | 'freezer'

/** "6 huevos", "1,4 l", "750 g", "2 raciones". */
function useMeasureText() {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  return (amount: number, unit: string) => {
    const number = formatNumber(amount, tag)
    return isUnitLabel(unit) ? `${number} ${unitName(unit, amount, t)}` : `${number} ${t(`contentUnits.${unit as 'g'}`)}`
  }
}

function LineRow({ line, catalog, onChange }: { line: CookLine; catalog: CatalogById; onChange: (line: CookLine) => void }) {
  const { t } = useTranslation()
  const { language } = useDateContext()
  const measure = useMeasureText()
  const name = productName(line.product, catalog, language)
  const problem = cookLineProblem(line)
  const typed = parseAmount(line.amount) ?? 0
  // "Receta: 3" si el ingrediente es el producto; "Receta: Huevo grande · 1" si la receta lo llama de otra forma.
  const recipeSays = (normalizeName(line.ingredient) === normalizeName(name) ? [line.amountText] : [line.ingredient, line.amountText]).filter(Boolean).join(' · ')

  return (
    <li className={`flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 ${line.checked ? '' : 'opacity-60'}`}>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          aria-label={t('recipes.cookDiscount', { name })}
          checked={line.checked}
          onChange={(event) => onChange({ ...line, checked: event.target.checked })}
          className="size-6 shrink-0 accent-[var(--brand)]"
        />
        <span aria-hidden="true" className="w-7 shrink-0 text-center text-2xl leading-none">
          {productIcon(line.product, catalog)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          {recipeSays && <span className="block text-sm text-ink-muted">{t('recipes.cookRecipeSays', { amount: recipeSays })}</span>}
        </span>
      </label>
      {line.checked && (
        <div className="flex items-center gap-2 pl-9">
          <input
            aria-label={t('recipes.cookAmount', { name })}
            inputMode="decimal"
            autoComplete="off"
            value={line.amount}
            onChange={(event) => onChange({ ...line, amount: event.target.value })}
            className={`min-h-11 w-24 rounded-xl border border-line bg-surface px-3 text-base text-ink ${focusRing}`}
          />
          <span className="min-w-0 flex-1 text-sm">
            {isUnitLabel(line.unit) ? unitName(line.unit, typed, t) : t(`contentUnits.${line.unit as 'g'}`)}
            <span className="block text-ink-muted">{t('recipes.cookAvailable', { amount: measure(line.available, line.unit) })}</span>
          </span>
        </div>
      )}
      {problem === 'invalid' && <Message tone="error">{t('recipes.cookInvalid')}</Message>}
      {problem === 'more_than_available' && <p className="pl-9 text-sm font-medium text-review">{t('recipes.cookMore', { amount: measure(line.available, line.unit) })}</p>}
    </li>
  )
}

function LeftoversForm({ recipe, pending, onSave, onBack }: { recipe: KitchenRecipe; pending: boolean; onSave: (dish: Record<string, unknown>) => void; onBack: () => void }) {
  const { t } = useTranslation()
  const { today } = useDateContext()
  const houseId = useActiveHouseId()
  const [name, setName] = useState(recipe.title.slice(0, 80))
  const [servings, setServings] = useState(1)
  const [zone, setZone] = useState<DishZone>('fridge')
  const [number, setNumber] = useState('')
  const [reminderDate, setReminderDate] = useState('')

  const nextNumber = useQuery({
    queryKey: ['nextContainer', houseId],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('next_container_number', { p_house_id: houseId })
      if (error) throw error
      return data
    },
  })

  const typedNumber = parseAmount(number)
  const invalidNumber = number.trim() !== '' && (!typedNumber || typedNumber < 1 || !Number.isInteger(typedNumber))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (invalidNumber || !name.trim()) return
    onSave({ name: name.trim(), servings, zone, reminder_date: reminderDate || null, container_number: typedNumber ?? null })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <TextField label={t('recipes.leftoversName')} required maxLength={80} autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
      <Stepper label={t('leftover.servings')} value={servings} min={1} max={99} onChange={setServings} />
      <Segmented
        label={t('form.zone')}
        options={(['fridge', 'freezer'] as const).map((value) => ({ value, label: t(`zones.${value}`) }))}
        value={zone}
        onChange={setZone}
      />
      <TextField
        label={t('leftover.containerNumber')}
        hint={t('leftover.containerHint')}
        inputMode="numeric"
        placeholder={nextNumber.data ? String(nextNumber.data) : undefined}
        value={number}
        onChange={(event) => setNumber(event.target.value)}
      />
      {/* En el congelador, el plazo es el de congelación. Nada se rellena solo (principio 2). */}
      <ShelfLifeChip
        product={{ catalog_item_id: null, category: 'cooked' }}
        state={zone === 'freezer' ? 'frozen' : 'cooked'}
        baseDate={today}
        value={reminderDate}
        onChange={setReminderDate}
      />
      <TextField label={t('form.reminder')} hint={t('form.reminderHint')} type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} />
      {invalidNumber && <Message tone="error">{t('leftover.invalidNumber')}</Message>}
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending || !name.trim()}>
          {t('recipes.saveCooked')}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onBack}>
          {t('recipes.back')}
        </Button>
      </div>
    </form>
  )
}

type Step = 'review' | 'question' | 'leftovers'

function CookFlow({ recipe, data, catalog }: { recipe: KitchenRecipe; data: InventoryData; catalog: CatalogById }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { tag } = useDateContext()
  const houseId = useActiveHouseId()
  const { run, pending, errorKey } = useInventoryAction({ inlineErrors: true })
  const [lines, setLines] = useState(() => cookLines(recipe, data, catalog, tag))
  const [step, setStep] = useState<Step>('review')

  const notHome = ingredientViews(recipe, data, catalog).filter((view) => !view.product && !view.ingredient.tap_water)
  const invalid = lines.some((line) => cookLineProblem(line) === 'invalid')

  async function save(dish: Record<string, unknown> | null) {
    const done = await run('recipe', () =>
      supabase.rpc('cook_recipe', {
        p_house_id: houseId,
        p_title: recipe.title,
        p_items: cookItems(lines) as unknown as Json,
        p_dish: (dish ?? undefined) as Json | undefined,
      }),
    )
    if (done) void navigate('/recipes', { replace: true })
  }

  if (step === 'leftovers') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{t('recipes.leftoversQuestion')}</h2>
        <LeftoversForm recipe={recipe} pending={pending} onSave={(dish) => void save(dish)} onBack={() => setStep('question')} />
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
      </div>
    )
  }

  if (step === 'question') {
    const nothing = cookItems(lines).length === 0
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{t('recipes.leftoversQuestion')}</h2>
        <Button onClick={() => setStep('leftovers')} disabled={pending}>
          {t('recipes.leftoversYes')}
        </Button>
        {/* Sin nada que descontar ni táper, no hay nada que guardar. */}
        <Button variant="secondary" onClick={() => void save(null)} disabled={pending || nothing}>
          {t('recipes.leftoversNo')}
        </Button>
        <Button variant="secondary" onClick={() => setStep('review')} disabled={pending}>
          {t('recipes.back')}
        </Button>
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">{recipe.title}</h2>
        <p className="text-sm text-ink-muted">{t('recipes.cookIntro')}</p>
      </div>
      {lines.length > 0 ? (
        <ul aria-label={t('recipes.cookList')} className="flex flex-col gap-2">
          {lines.map((line) => (
            <LineRow key={line.key} line={line} catalog={catalog} onChange={(next) => setLines(lines.map((item) => (item.key === next.key ? next : item)))} />
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{t('recipes.cookNothing')}</p>
      )}
      {notHome.length > 0 && <p className="text-sm text-ink-muted">{t('recipes.cookNotHome', { names: notHome.map((view) => view.ingredient.name).join(', ') })}</p>}
      <Button disabled={invalid} onClick={() => setStep('question')}>
        {t('recipes.next')}
      </Button>
    </div>
  )
}

export function CookRecipePage() {
  const { t } = useTranslation()
  const location = useLocation()
  const inventory = useInventory()
  const catalog = useCatalog()
  const recipe = (location.state as CookState | null)?.recipe

  if (!isKitchenRecipe(recipe)) return <Navigate to="/recipes" replace />

  function renderFlow() {
    if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
    if (inventory.isLoadingError) return <LoadError onRetry={() => void inventory.refetch()} />
    return <CookFlow recipe={recipe!} data={inventory.data} catalog={catalog.byId} />
  }

  return <Screen title={t('recipes.cookTitle')} backTo="/recipes" main={renderFlow()} />
}
