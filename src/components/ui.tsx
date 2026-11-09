import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { locales, type Locale } from '../i18n'

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const look =
    variant === 'primary' ? 'bg-brand text-on-brand' : 'border border-line bg-surface text-ink'
  return (
    <button
      {...props}
      className={`min-h-12 w-full rounded-xl px-4 text-base font-semibold transition-opacity active:opacity-80 disabled:opacity-50 ${look} ${focusRing} ${className}`}
    />
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function TextField({ label, hint, ...props }: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        {...props}
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={`min-h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink ${focusRing}`}
      />
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

export function Message({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return tone === 'error' ? (
    <p role="alert" className="text-sm font-medium text-danger">
      {children}
    </p>
  ) : (
    <p role="status" className="text-sm font-medium text-success">
      {children}
    </p>
  )
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">{children}</section>
}

export function FullScreenLoader() {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center text-ink-muted">
      {t('app.loading')}
    </div>
  )
}

export function LanguageSwitcher({ onChange }: { onChange?: (locale: Locale) => void }) {
  const { t, i18n: { resolvedLanguage } } = useTranslation()

  function select(locale: Locale) {
    void i18n.changeLanguage(locale)
    onChange?.(locale)
  }

  return (
    <div role="group" aria-label={t('language.label')} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
      {locales.map((locale) => {
        const active = resolvedLanguage === locale
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={active}
            onClick={() => select(locale)}
            className={`min-h-11 rounded-lg text-sm font-semibold ${active ? 'bg-brand text-on-brand' : 'text-ink-muted'} ${focusRing}`}
          >
            {t(`language.${locale}`)}
          </button>
        )
      })}
    </div>
  )
}
