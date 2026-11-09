import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useUser } from '../auth/AuthProvider'
import { Button, Card, LanguageSwitcher, Message, TextField } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useProfile, useUpdateProfile } from '../profile/useProfile'

function ProfileForm({ initialName }: { initialName: string }) {
  const { t } = useTranslation()
  const updateProfile = useUpdateProfile()
  const [name, setName] = useState(initialName)

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
      <Button type="submit" variant="secondary" disabled={updateProfile.isPending}>
        {t('settings.save')}
      </Button>
    </form>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const user = useUser()
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' })
    queryClient.clear()
  }

  return (
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
      <Card>
        <p className="text-sm break-words text-ink-muted">{t('settings.signedInAs', { email: user.email })}</p>
        <Button variant="secondary" onClick={signOut}>
          {t('settings.signOut')}
        </Button>
      </Card>
    </div>
  )
}
