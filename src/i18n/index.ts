import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import es from '../locales/es.json'

export const locales = ['es', 'en'] as const
export type Locale = (typeof locales)[number]

export function isLocale(value: string | null | undefined): value is Locale {
  return locales.includes(value as Locale)
}

function syncDocument() {
  // `resolvedLanguage` es "es" aunque el navegador diga "es-ES".
  document.documentElement.lang = i18n.resolvedLanguage ?? 'es'
  document.title = i18n.t('app.name')
}

i18n.on('languageChanged', syncDocument)

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Las traducciones van en el propio código, así que se inicia de forma síncrona.
    initAsync: false,
    resources: { es: { translation: es }, en: { translation: en } },
    supportedLngs: locales,
    fallbackLng: 'es',
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'nevera.locale',
      caches: ['localStorage'],
    },
  })

export default i18n
