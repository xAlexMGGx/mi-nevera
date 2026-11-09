import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { authErrorKey } from '../auth/authErrors'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Message, TextField } from '../components/ui'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const { t } = useTranslation()
  const { linkExpired } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [errorKey, setErrorKey] = useState<ReturnType<typeof authErrorKey> | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErrorKey(authErrorKey(error))
    setPending(false)
  }

  return (
    <AuthLayout title={t('auth.login.title')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {errorKey && <Message tone="error">{t(errorKey)}</Message>}
        {!errorKey && linkExpired && <Message tone="error">{t('auth.errors.expiredLink')}</Message>}
        <Button type="submit" disabled={pending}>
          {t('auth.login.submit')}
        </Button>
      </form>
      <div className="flex flex-col gap-2 text-center text-sm">
        <Link to="/forgot-password" className="py-1 font-medium text-brand">
          {t('auth.login.forgot')}
        </Link>
        <p className="text-ink-muted">
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="py-1 font-medium text-brand">
            {t('auth.login.toRegister')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
