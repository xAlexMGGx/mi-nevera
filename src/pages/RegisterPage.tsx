import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { authErrorKey } from '../auth/authErrors'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Message, TextField } from '../components/ui'
import { supabase } from '../lib/supabase'

export function RegisterPage() {
  const { t, i18n } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [errorKey, setErrorKey] = useState<ReturnType<typeof authErrorKey> | null>(null)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim(), locale: i18n.resolvedLanguage } },
    })
    if (error) setErrorKey(authErrorKey(error))
    // Sin sesión significa que la confirmación por email está activada en Supabase.
    else if (!data.session) setAwaitingConfirmation(true)
    setPending(false)
  }

  if (awaitingConfirmation) {
    return (
      <AuthLayout title={t('auth.register.checkInboxTitle')}>
        <p>{t('auth.register.checkInboxBody', { email: email.trim() })}</p>
        <Link to="/login" className="py-1 text-center text-sm font-medium text-brand">
          {t('auth.register.toLogin')}
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.register.title')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label={t('auth.fields.name')}
          name="name"
          autoComplete="given-name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t('auth.fields.email')}
          type="email"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label={t('auth.fields.password')}
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
          {t('auth.register.submit')}
        </Button>
      </form>
      <p className="text-center text-sm text-ink-muted">
        {t('auth.register.hasAccount')}{' '}
        <Link to="/login" className="py-1 font-medium text-brand">
          {t('auth.register.toLogin')}
        </Link>
      </p>
    </AuthLayout>
  )
}
