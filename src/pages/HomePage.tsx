import { useTranslation } from 'react-i18next'
import { useProfile } from '../profile/useProfile'

export function HomePage() {
  const { t } = useTranslation()
  const { data: profile } = useProfile()

  return (
    <div className="flex flex-col gap-2 pt-6">
      <h1 className="text-2xl font-bold">
        {profile?.display_name ? t('home.greeting', { name: profile.display_name }) : t('home.greetingNoName')}
      </h1>
      <p className="text-ink-muted">{t('home.placeholder')}</p>
    </div>
  )
}
