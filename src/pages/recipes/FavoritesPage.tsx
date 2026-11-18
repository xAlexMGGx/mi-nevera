import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ChevronIcon } from '../../components/icons'
import { Screen } from '../../components/Screen'
import { FullScreenLoader, LoadError, focusRing } from '../../components/ui'
import { useCatalog } from '../../data/catalog'
import { useInventory } from '../../data/inventory'
import { useRecipeFavorites } from '../../data/recipes'
import { ingredientViews } from '../../domain/recipes'
import { RecipeCard } from './RecipeCard'

/** Las favoritas de quien mira, con lo que tiene de cada una en la casa activa. */
export function FavoritesPage() {
  const { t } = useTranslation()
  const favorites = useRecipeFavorites()
  const inventory = useInventory()
  const catalog = useCatalog()

  function renderList() {
    if (favorites.isPending || inventory.isPending || catalog.isPending) return <FullScreenLoader />
    if (favorites.isLoadingError || inventory.isLoadingError) {
      return (
        <LoadError
          onRetry={() => {
            void favorites.refetch()
            void inventory.refetch()
          }}
        />
      )
    }
    if (favorites.data.length === 0) return <p className="py-12 text-center text-ink-muted">{t('recipes.favoritesEmpty')}</p>

    return (
      <ul className="flex flex-col gap-2">
        {favorites.data.map((favorite) => {
          const views = ingredientViews(favorite.recipe, inventory.data, catalog.byId).filter((view) => !view.ingredient.tap_water)
          return (
            <li key={favorite.id}>
              <Link
                to={`/recipes/favorites/${favorite.id}`}
                className={`flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 ${focusRing}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{favorite.title}</span>
                  <span className="block text-sm text-ink-muted">
                    {t('recipes.meta', { minutes: favorite.recipe.time_minutes, count: favorite.recipe.servings })} ·{' '}
                    {t('recipes.haveCount', { have: views.filter((view) => view.have).length, total: views.length })}
                  </span>
                </span>
                <span className="text-ink-muted">
                  <ChevronIcon />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return <Screen title={t('recipes.favoritesTitle')} backTo="/recipes" main={renderList()} />
}

export function FavoritePage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const favorites = useRecipeFavorites()
  const inventory = useInventory()
  const catalog = useCatalog()
  const favorite = favorites.data?.find((item) => item.id === id)

  function renderRecipe() {
    if (favorites.isPending || inventory.isPending || catalog.isPending) return <FullScreenLoader />
    if (favorites.isLoadingError || inventory.isLoadingError) return <LoadError onRetry={() => void favorites.refetch()} />
    if (!favorite) return <p className="py-12 text-center text-ink-muted">{t('recipes.favoriteGone')}</p>
    return (
      <RecipeCard
        recipe={favorite.recipe}
        data={inventory.data}
        catalog={catalog.byId}
        onUnfavorite={() => void navigate('/recipes/favorites', { replace: true })}
      />
    )
  }

  return <Screen title={favorite?.title ?? t('recipes.favoritesTitle')} backTo="/recipes/favorites" main={renderRecipe()} />
}
