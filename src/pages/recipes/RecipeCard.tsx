import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { CheckIcon, HeartIcon } from '../../components/icons'
import { Button, Message, focusRing } from '../../components/ui'
import { useDateContext } from '../../data/context'
import { useActiveHouseId } from '../../data/house'
import { useRecipeActions, useRecipeFavorites } from '../../data/recipes'
import { addShoppingItem, useShoppingList } from '../../data/shopping'
import { productName, type CatalogById, type InventoryData } from '../../domain/inventory'
import { normalizeName } from '../../domain/lotDraft'
import { ingredientViews, shoppingQuantity, toKitchenRecipe, type KitchenRecipe } from '../../domain/recipes'
import { isOnList } from '../../domain/shopping'
import { useOffline } from '../../lib/connectivity'
import { errorKey } from '../../lib/errors'

/** Lo que recibe la pantalla "He cocinado esto". */
export interface CookState {
  recipe: KitchenRecipe
}

interface RecipeCardProps {
  recipe: KitchenRecipe
  data: InventoryData
  catalog: CatalogById
  /** Solo en las sugerencias: "No me la vuelvas a sugerir". */
  onBlock?: () => void
  /** Al quitarla de favoritas desde su propia pantalla. */
  onUnfavorite?: () => void
}

export function RecipeCard({ recipe, data, catalog, onBlock, onUnfavorite }: RecipeCardProps) {
  const { t } = useTranslation()
  const { language } = useDateContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const houseId = useActiveHouseId()
  const offline = useOffline()
  const favorites = useRecipeFavorites()
  const shopping = useShoppingList()
  const { saveFavorite, removeFavorite } = useRecipeActions()

  const views = ingredientViews(recipe, data, catalog)
  const missing = views.filter((view) => !view.have)
  const onList = (name: string) => isOnList(shopping.data ?? [], { id: '', name })
  const toAdd = missing.filter((view) => !onList(view.ingredient.name)).map((view) => view.ingredient)
  const favorite = favorites.data?.find((item) => normalizeName(item.title) === normalizeName(recipe.title))
  const expiring = recipe.uses_expiring.flatMap((id) => {
    const product = data.products.find((item) => item.id === id)
    return product ? [productName(product, catalog, language)] : []
  })

  // Uno detrás de otro: así cada uno ve lo que ya ha apuntado el anterior.
  const addMissing = useMutation({
    mutationFn: async () => {
      let added = 0
      for (const ingredient of toAdd) {
        const result = await addShoppingItem(queryClient, { houseId, name: ingredient.name, quantityText: shoppingQuantity(ingredient), origin: 'recipe' })
        if (result.added) added++
      }
      return added
    },
  })

  function toggleFavorite() {
    if (favorite) removeFavorite.mutate(favorite.id, { onSuccess: onUnfavorite })
    else saveFavorite.mutate(toKitchenRecipe(recipe, data))
  }

  const favoriteError = saveFavorite.error ?? removeFavorite.error ?? addMissing.error

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-tight font-bold">{recipe.title}</h3>
          <p className="text-sm text-ink-muted">{t('recipes.meta', { minutes: recipe.time_minutes, count: recipe.servings })}</p>
          {expiring.length > 0 && <p className="text-sm font-semibold text-brand">{t('recipes.usesExpiring', { names: expiring.join(', ') })}</p>}
        </div>
        <button
          type="button"
          aria-label={t('recipes.favorite')}
          aria-pressed={Boolean(favorite)}
          disabled={offline || favorites.isPending || saveFavorite.isPending || removeFavorite.isPending}
          onClick={toggleFavorite}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${favorite ? 'text-danger' : 'text-ink-muted'} active:bg-line ${focusRing}`}
        >
          <HeartIcon filled={Boolean(favorite)} />
        </button>
      </header>

      <section className="flex flex-col gap-1.5">
        <h4 className="text-sm font-semibold text-ink-muted">{t('recipes.ingredients')}</h4>
        <ul className="flex flex-col gap-1">
          {views.map(({ ingredient, have }, index) => (
            <li key={index} className="flex items-baseline gap-2">
              <span aria-hidden="true" className={`flex w-4 shrink-0 justify-center self-center ${have ? 'text-success' : 'text-ink-muted'}`}>
                {have ? (
                  <span className="block size-4 [&>svg]:size-4">
                    <CheckIcon />
                  </span>
                ) : (
                  <span className="block size-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                {have && <span className="sr-only">{t('recipes.have')}: </span>}
                {ingredient.name}
                {ingredient.amount_text && <span className="text-ink-muted"> · {ingredient.amount_text}</span>}
              </span>
              {!have && (
                <span className="shrink-0 rounded-full bg-review-bg px-2 text-xs leading-5 font-semibold text-review">
                  {onList(ingredient.name) ? t('recipes.onList') : t('recipes.missing')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <details>
        <summary className={`flex min-h-11 cursor-pointer items-center font-semibold text-brand ${focusRing}`}>{t('recipes.steps', { count: recipe.steps.length })}</summary>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          {recipe.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </details>

      <div className="flex flex-col gap-2">
        <Button disabled={offline} onClick={() => void navigate('/recipes/cook', { state: { recipe } satisfies CookState })}>
          {t('recipes.cook')}
        </Button>
        {toAdd.length > 0 && (
          <Button variant="secondary" disabled={offline || addMissing.isPending} onClick={() => addMissing.mutate()}>
            {t('recipes.addMissing', { count: toAdd.length })}
          </Button>
        )}
        {addMissing.isSuccess ? (
          <Message tone="success">{t('recipes.addedMissing', { count: addMissing.data })}</Message>
        ) : (
          missing.length > 0 && toAdd.length === 0 && <p className="text-sm text-ink-muted">{t('recipes.allOnList')}</p>
        )}
        {favoriteError && <Message tone="error">{t(errorKey(favoriteError))}</Message>}
        {onBlock && (
          <button type="button" disabled={offline} onClick={onBlock} className={`min-h-11 self-center px-2 text-sm text-ink-muted underline underline-offset-2 disabled:opacity-50 ${focusRing}`}>
            {t('recipes.block')}
          </button>
        )}
      </div>
    </article>
  )
}
