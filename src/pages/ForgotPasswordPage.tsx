import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { authErrorKey } from '../auth/authErrors'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Message, TextField } from '../components/ui'
import { supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorKey, setErrorKey] = useState<ReturnType<typeof authErrorKey> | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
    })
    if (error) setErrorKey(authErrorKey(error))
    else setSent(true)
    setPending(false)
  }

  return (
    <AuthLayout title={t('auth.forgot.title')}>
      {sent ? (
        <Message tone="success">{t('auth.forgot.sent')}</Message>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-ink-muted">{t('auth.forgot.body')}</p>
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
          {errorKey && <Message tone="error">{t(errorKey)}</Message>}
          <Button type="submit" disabled={pending}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
      <Link to="/login" className="py-1 text-center text-sm font-medium text-brand">
        {t('auth.forgot.back')}
      </Link>
    </AuthLayout>
  )
}
