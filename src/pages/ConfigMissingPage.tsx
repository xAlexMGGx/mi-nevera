import { useTranslation } from 'react-i18next'
import { AuthLayout } from '../components/AuthLayout'

export function ConfigMissingPage() {
  const { t } = useTranslation()
  return (
    <AuthLayout title={t('config.missingTitle')}>
      <p>{t('config.missingBody')}</p>
    </AuthLayout>
  )
}
