import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { authErrorKey } from '../auth/authErrors'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Message, TextField } from '../components/ui'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { finishRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [errorKey, setErrorKey] = useState<ReturnType<typeof authErrorKey> | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setErrorKey(authErrorKey(error))
    else setDone(true)
    setPending(false)
  }

  if (done) {
    return (
      <AuthLayout title={t('auth.reset.doneTitle')}>
        <p>{t('auth.reset.doneBody')}</p>
        <Button onClick={finishRecovery}>{t('auth.reset.continue')}</Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.reset.title')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label={t('auth.fields.newPassword')}
          hint={t('auth.fields.passwordHint')}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        <Button type="submit" disabled={pending}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
