import { useTranslation } from 'react-i18next'
import { todayIn } from '../domain/dates'
import { useProfile } from '../profile/useProfile'

const defaults = { timezone: 'Europe/Madrid', daysAhead: 2 }

/** Idioma, hoy y días de antelación de quien está mirando. */
export function useDateContext() {
  const { i18n } = useTranslation()
  const { data: profile } = useProfile()
  const language = i18n.resolvedLanguage ?? 'es'
  const timezone = profile?.timezone ?? defaults.timezone

  return {
    language,
    // Fechas con día/mes también en inglés: la app se usa en España.
    tag: language === 'en' ? 'en-GB' : 'es-ES',
    timezone,
    today: todayIn(timezone),
    daysAhead: profile?.notify_days_ahead ?? defaults.daysAhead,
  }
}
