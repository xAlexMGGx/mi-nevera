import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useUser } from '../../auth/AuthProvider'
import { HouseSwitcher } from '../../components/HouseSwitcher'
import { GearIcon, HeartIcon } from '../../components/icons'
import { Screen, topBarIcon } from '../../components/Screen'
import { useToast } from '../../components/Toast'
import { Button, FullScreenLoader, LoadError, Message, SelectField, TextField, focusRing } from '../../components/ui'
import { useCatalog } from '../../data/catalog'
import { useDateContext } from '../../data/context'
import { useActiveHouseId } from '../../data/house'
import { useInventory } from '../../data/inventory'
import { loadRequest, loadSuggestions, recipeErrorKey, saveRequest, saveSuggestions, useRecipeActions, useSuggestRecipes } from '../../data/recipes'
import { recipeFilters, recipeModes, type KitchenRecipe, type RecipeMode, type RecipeRequest } from '../../domain/recipes'
import { useOffline } from '../../lib/connectivity'
import { errorKey } from '../../lib/errors'
import { RecipeCard } from './RecipeCard'

const servingOptions = [1, 2, 3, 4, 5, 6, 8]
const timeOptions = [15, 30, 45, 60, 90]

/** Deslizador de 3 posiciones (SPEC §14). */
function ModeSlider({ value, onChange }: { value: RecipeMode; onChange: (mode: RecipeMode) => void }) {
  const { t } = useTranslation()
  const id = useId()
  const index = recipeModes.indexOf(value)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t('recipes.mode')}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={recipeModes.length - 1}
        step={1}
        value={index}
        aria-valuetext={t(`recipes.modes.${value}`)}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(recipeModes[Number(event.target.value)]!)}
        className={`h-11 w-full cursor-pointer accent-[var(--brand)] ${focusRing}`}
      />
      {/* Las etiquetas también se pueden tocar; el lector de pantalla ya oye el valor del deslizador. */}
      <div aria-hidden="true" className="grid grid-cols-3 text-sm">
        {recipeModes.map((mode, position) => (
          <button
            key={mode}
            type="button"
            tabIndex={-1}
            onClick={() => onChange(mode)}
            className={`${['text-left', 'text-center', 'text-right'][position]} ${mode === value ? 'font-bold text-brand' : 'text-ink-muted'}`}
          >
            {t(`recipes.modes.${mode}`)}
          </button>
        ))}
      </div>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        {t(`recipes.modeHints.${value}`)}
      </p>
    </div>
  )
}

function RequestForm({ pending, onSubmit }: { pending: boolean; onSubmit: (request: RecipeRequest) => void }) {
  const { t } = useTranslation()
  const offline = useOffline()
  const [request, setRequest] = useState(loadRequest)

  function update(patch: Partial<RecipeRequest>) {
    const next = { ...request, ...patch }
    setRequest(next)
    saveRequest(next)
  }

  function toggleFilter(filter: (typeof recipeFilters)[number]) {
    update({ filters: request.filters.includes(filter) ? request.filters.filter((item) => item !== filter) : [...request.filters, filter] })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit({ ...request, text: request.text?.trim() || null })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4">
      <ModeSlider value={request.mode} onChange={(mode) => update({ mode })} />

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('recipes.filters')}</p>
        <div role="group" aria-label={t('recipes.filters')} className="flex flex-wrap gap-1.5">
          {recipeFilters.map((filter) => {
            const active = request.filters.includes(filter)
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFilter(filter)}
                className={`min-h-10 rounded-full border px-3.5 text-sm font-medium ${active ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'} ${focusRing}`}
              >
                {t(`recipes.filter.${filter}`)}
              </button>
            )
          })}
        </div>
      </div>

      <TextField
        label={t('recipes.extra')}
        placeholder={t('recipes.extraPlaceholder')}
        maxLength={120}
        autoComplete="off"
        value={request.text ?? ''}
        onChange={(event) => update({ text: event.target.value })}
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField label={t('recipes.servings')} value={request.servings ?? ''} onChange={(event) => update({ servings: event.target.value ? Number(event.target.value) : null })}>
          <option value="">{t('recipes.anyServings')}</option>
          {servingOptions.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('recipes.maxTime')} value={request.max_minutes ?? ''} onChange={(event) => update({ max_minutes: event.target.value ? Number(event.target.value) : null })}>
          <option value="">{t('recipes.anyTime')}</option>
          {timeOptions.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t('recipes.minutes', { count: minutes })}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button type="submit" disabled={pending || offline}>
          {pending ? t('recipes.thinking') : t('recipes.suggest')}
        </Button>
        {pending && (
          <p role="status" className="text-center text-sm text-ink-muted">
            {t('recipes.thinkingHint')}
          </p>
        )}
      </div>
    </form>
  )
}

/** Con la casa como `key`: al cambiar de casa se ven las sugerencias de esa casa. */
function RecipesContent() {
  const { t } = useTranslation()
  const { id: userId } = useUser()
  const houseId = useActiveHouseId()
  const { today } = useDateContext()
  const inventory = useInventory()
  const catalog = useCatalog()
  const suggest = useSuggestRecipes()
  const { block } = useRecipeActions()
  const { showInfo } = useToast()
  const [recipes, setRecipes] = useState<KitchenRecipe[]>(() => loadSuggestions(userId, houseId))
  const [empty, setEmpty] = useState(false)

  function show(next: KitchenRecipe[]) {
    setRecipes(next)
    saveSuggestions(userId, houseId, next)
  }

  function submit(request: RecipeRequest) {
    setEmpty(false)
    suggest.mutate(
      { request, today },
      {
        onSuccess: (result) => {
          show(result.recipes)
          setEmpty(result.recipes.length === 0)
        },
      },
    )
  }

  function blockRecipe(recipe: KitchenRecipe) {
    block.mutate(recipe.title, {
      onSuccess: () => {
        show(recipes.filter((item) => item !== recipe))
        showInfo(t('recipes.blocked', { title: recipe.title }))
      },
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-2xl bg-review-bg px-4 py-3 text-sm text-review">{t('recipes.notice')}</p>
      <RequestForm pending={suggest.isPending} onSubmit={submit} />
      {suggest.isError && <Message tone="error">{t(recipeErrorKey(suggest.error))}</Message>}
      {block.isError && <Message tone="error">{t(errorKey(block.error))}</Message>}
      {empty && <Message tone="error">{t('recipes.noRecipes')}</Message>}

      {recipes.length > 0 &&
        (inventory.isPending || catalog.isPending ? (
          <FullScreenLoader />
        ) : inventory.isLoadingError ? (
          <LoadError onRetry={() => void inventory.refetch()} />
        ) : (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink-muted">{t('recipes.suggestions')}</h2>
            {recipes.map((recipe, index) => (
              <RecipeCard key={`${index}-${recipe.title}`} recipe={recipe} data={inventory.data} catalog={catalog.byId} onBlock={() => blockRecipe(recipe)} />
            ))}
          </section>
        ))}
    </div>
  )
}

export function RecipesPage() {
  const { t } = useTranslation()
  const houseId = useActiveHouseId()

  return (
    <Screen
      withNav
      title={t('recipes.title')}
      heading={<HouseSwitcher />}
      action={
        <>
          <Link to="/recipes/favorites" aria-label={t('recipes.favorites')} className={topBarIcon}>
            <HeartIcon />
          </Link>
          <Link to="/settings" aria-label={t('settings.open')} className={topBarIcon}>
            <GearIcon />
          </Link>
        </>
      }
      main={<RecipesContent key={houseId} />}
    />
  )
}
