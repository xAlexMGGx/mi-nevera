import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Screen } from '../components/Screen'
import { Button, Card, Message, TextAreaField, focusRing } from '../components/ui'
import { useBlockedRecipes, useRecipeActions } from '../data/recipes'
import { maxPreferences } from '../domain/recipes'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { useFollowingState } from '../lib/followingState'
import { useProfile, useUpdateProfile } from '../profile/useProfile'

function PreferencesForm({ initial }: { initial: string }) {
  const { t } = useTranslation()
  const offline = useOffline()
  const updateProfile = useUpdateProfile()
  const [text, setText] = useFollowingState(initial)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    updateProfile.mutate({ recipe_preferences: text.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <TextAreaField
        label={t('recipePrefs.preferences')}
        rows={4}
        maxLength={maxPreferences}
        placeholder={t('recipePrefs.placeholder')}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          updateProfile.reset()
        }}
      />
      <p className="text-sm text-ink-muted">{t('recipePrefs.counter', { length: text.length, max: maxPreferences })}</p>
      {updateProfile.isSuccess && <Message tone="success">{t('settings.saved')}</Message>}
      {updateProfile.isError && <Message tone="error">{t('settings.saveError')}</Message>}
      <Button type="submit" variant="secondary" disabled={updateProfile.isPending || offline}>
        {t('common.save')}
      </Button>
    </form>
  )
}

/** Ajustes → Preferencias de recetas (SPEC §14). Solo las ve y las usa quien las escribe. */
export function RecipePreferencesPage() {
  const { t } = useTranslation()
  const offline = useOffline()
  const { data: profile } = useProfile()
  const blocked = useBlockedRecipes()
  const { unblock } = useRecipeActions()

  return (
    <Screen
      title={t('recipePrefs.title')}
      backTo="/settings"
      main={
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-sm text-ink-muted">{t('recipePrefs.intro')}</p>
            {profile && <PreferencesForm initial={profile.recipe_preferences} />}
          </Card>
          <Card>
            <h2 className="font-semibold">{t('recipePrefs.blockedTitle')}</h2>
            {blocked.data && blocked.data.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line">
                {blocked.data.map((item) => (
                  <li key={item.id} className="flex min-h-12 items-center gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <button
                      type="button"
                      aria-label={t('recipePrefs.unblockLabel', { title: item.title })}
                      disabled={offline || unblock.isPending}
                      onClick={() => unblock.mutate(item.id)}
                      className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-brand disabled:opacity-50 ${focusRing}`}
                    >
                      {t('recipePrefs.unblock')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">{t('recipePrefs.blockedEmpty')}</p>
            )}
            {unblock.isError && <Message tone="error">{t(errorKey(unblock.error))}</Message>}
          </Card>
        </div>
      }
    />
  )
}
