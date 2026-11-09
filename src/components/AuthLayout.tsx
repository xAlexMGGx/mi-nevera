import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './ui'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <main className="safe-top safe-bottom safe-x mx-auto flex min-h-dvh w-full max-w-sm flex-col">
      <div className="flex flex-1 flex-col justify-center gap-8 px-5 py-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={64} height={64} />
          <div>
            <p className="text-lg font-bold">{t('app.name')}</p>
            <p className="text-sm text-ink-muted">{t('app.tagline')}</p>
          </div>
        </header>
        <div className="flex flex-col gap-5">
          <h1 className="text-2xl font-bold">{title}</h1>
          {children}
        </div>
        <LanguageSwitcher />
      </div>
    </main>
  )
}
