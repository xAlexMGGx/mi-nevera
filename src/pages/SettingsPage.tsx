import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useUser } from '../auth/AuthProvider'
import { ChevronIcon } from '../components/icons'
import { Screen } from '../components/Screen'
import { Button, Card, LanguageSwitcher, Message, TextField, focusRing } from '../components/ui'
import { useOffline } from '../lib/connectivity'
import { useFollowingState } from '../lib/followingState'
import { supabase } from '../lib/supabase'
import { useProfile, useUpdateProfile } from '../profile/useProfile'

function ProfileForm({ initialName }: { initialName: string }) {
  const { t } = useTranslation()
  const updateProfile = useUpdateProfile()
  const offline = useOffline()
  const [name, setName] = useFollowingState(initialName)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    updateProfile.mutate({ display_name: name.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <TextField
        label={t('auth.fields.name')}
        name="name"
        autoComplete="given-name"
        maxLength={80}
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          updateProfile.reset()
        }}
      />
      {updateProfile.isSuccess && <Message tone="success">{t('settings.saved')}</Message>}
      {updateProfile.isError && <Message tone="error">{t('settings.saveError')}</Message>}
      <Button type="submit" variant="secondary" disabled={updateProfile.isPending || offline}>
        {t('common.save')}
      </Button>
    </form>
  )
}

function SettingsLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={`flex min-h-14 items-center justify-between rounded-2xl border border-line bg-surface px-4 font-semibold ${focusRing}`}>
      {label}
      <span className="text-ink-muted">
        <ChevronIcon />
      </span>
    </Link>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const user = useUser()
  const offline = useOffline()
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()

  return (
    <Screen
      title={t('settings.title')}
      backTo="/"
      main={
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="font-semibold">{t('settings.profile')}</h2>
            {profile && <ProfileForm initialName={profile.display_name} />}
          </Card>
          <Card>
            <h2 className="font-semibold">{t('language.label')}</h2>
            <LanguageSwitcher onChange={(locale) => updateProfile.mutate({ locale })} />
            {updateProfile.isError && <Message tone="error">{t('settings.saveError')}</Message>}
          </Card>
          <SettingsLink to="/houses" label={t('houses.title')} />
          <SettingsLink to="/movements" label={t('movements.title')} />
          <SettingsLink to="/my-data" label={t('myData.title')} />
          <Card>
            <p className="text-sm break-words text-ink-muted">{t('settings.signedInAs', { email: user.email })}</p>
            {/* Los datos de este móvil se borran al perder la sesión (ver SessionCache). */}
            <Button variant="secondary" disabled={offline} onClick={() => void supabase.auth.signOut({ scope: 'local' })}>
              {t('settings.signOut')}
            </Button>
          </Card>
        </div>
      }
    />
  )
}
