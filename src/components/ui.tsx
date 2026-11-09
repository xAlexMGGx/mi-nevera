import { useIsRestoring } from '@tanstack/react-query'
import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { locales, type Locale } from '../i18n'
import { useOffline } from '../lib/connectivity'
import { MinusIcon, PlusIcon } from './icons'

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
const fieldLook = `min-h-12 w-full min-w-0 appearance-none rounded-xl border border-line bg-surface px-3.5 text-base text-ink ${focusRing}`

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
}

const buttonLooks = {
  primary: 'bg-brand text-on-brand',
  secondary: 'border border-line bg-surface text-ink',
  danger: 'border border-danger bg-surface text-danger',
}

/** También para enlaces que deben verse como un botón. */
export function buttonClass(variant: NonNullable<ButtonProps['variant']> = 'primary') {
  return `inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-base font-semibold transition-opacity active:opacity-80 disabled:opacity-50 ${buttonLooks[variant]} ${focusRing}`
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button type="button" {...props} className={`${buttonClass(variant)} ${className}`} />
}

/** Botón pequeño para las acciones de un lote. */
export function ActionChip({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-10 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-opacity active:opacity-70 disabled:opacity-50 ${focusRing} ${className}`}
    />
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function TextField({ label, hint, ...props }: TextFieldProps) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <input {...props} id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={fieldLook} />
    </Field>
  )
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
}

export function TextAreaField({ label, ...props }: TextAreaFieldProps) {
  const id = useId()
  return (
    <Field id={id} label={label}>
      <textarea {...props} id={id} className={`${fieldLook} py-3`} />
    </Field>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
}

export function SelectField({ label, children, ...props }: SelectFieldProps) {
  const id = useId()
  return (
    <Field id={id} label={label}>
      <select {...props} id={id} className={fieldLook}>
        {children}
      </select>
    </Field>
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

/** Mientras se decide qué mostrar al arrancar. */
export function BootLoader() {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center text-ink-muted">
      {t('app.loading')}
    </div>
  )
}

/** Mientras llegan los datos. Sin conexión no van a llegar, así que lo dice. */
export function FullScreenLoader() {
  const { t } = useTranslation()
  const offline = useOffline()
  const restoring = useIsRestoring()
  if (offline && !restoring) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center p-6 text-center text-ink-muted">
        {t('offline.noData')}
      </div>
    )
  }
  return <BootLoader />
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-ink-muted">{t('common.loadError')}</p>
      <Button variant="secondary" className="max-w-48" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}

interface StepperProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  hint?: string
}

/** Cantidad entera: con botones para el pulgar y escribible para cantidades grandes. */
export function Stepper({ label, value, onChange, min = 0, max, hint }: StepperProps) {
  const { t } = useTranslation()
  const id = useId()
  const clamp = (next: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next))
  const stepButton = `flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink active:opacity-70 disabled:opacity-40 ${focusRing}`

  return (
    <Field id={id} label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t('common.decrease')} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} className={stepButton}>
          <MinusIcon />
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            onChange(clamp(Number.isNaN(parsed) ? min : parsed))
          }}
          className={`${fieldLook} text-center font-semibold`}
        />
        <button type="button" aria-label={t('common.increase')} disabled={max !== undefined && value >= max} onClick={() => onChange(clamp(value + 1))} className={stepButton}>
          <PlusIcon />
        </button>
      </div>
    </Field>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | null
  onChange: (value: T) => void
  /** La etiqueta solo la oyen los lectores de pantalla. */
  hideLabel?: boolean
}

export function Segmented<T extends string>({ label, options, value, onChange, hideLabel }: SegmentedProps<T>) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {!hideLabel && <p className="text-sm font-medium">{label}</p>}
      <div
        role="group"
        aria-label={label}
        className="grid gap-1 rounded-xl border border-line bg-surface p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`min-h-11 rounded-lg px-1 text-sm font-semibold ${active ? 'bg-brand text-on-brand' : 'text-ink-muted'} ${focusRing}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
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
    <Segmented
      label={t('language.label')}
      hideLabel
      options={locales.map((locale) => ({ value: locale, label: t(`language.${locale}`) }))}
      value={locales.find((locale) => locale === resolvedLanguage) ?? null}
      onChange={select}
    />
  )
}
