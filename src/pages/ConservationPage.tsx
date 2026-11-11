import { useTranslation } from 'react-i18next'
import { usePeriodText } from '../components/ShelfLifeChip'
import { Screen } from '../components/Screen'
import { Card } from '../components/ui'
import guideEn from '../content/conservation/guide.en.json'
import guideEs from '../content/conservation/guide.es.json'
import review from '../content/conservation/review.json'
import sourcesData from '../content/conservation/sources.json'
import { useCatalog } from '../data/catalog'
import { formatDate } from '../domain/dates'
import type { GuideEntry, ShelfState } from '../domain/shelfLife'
import { useDateContext } from '../data/context'
import { useShelfLifeGuide } from '../data/shelfLife'

// Conservación y seguridad (SPEC §9). El contenido vive en src/content/conservation, separado del
// código, con la fuente de cada frase y de cada plazo.

const sources = sourcesData.sources
const sourceNumber = new Map(sources.map((source, index) => [source.id, index + 1]))
const states: ShelfState[] = ['opened', 'frozen', 'thawed', 'cooked']

function SourceRefs({ ids }: { ids?: string[] }) {
  if (!ids?.length) return null
  return (
    <span className="text-xs text-ink-muted">
      {' '}
      {ids.map((id) => (
        <a key={id} href={`#/conservation`} onClick={(event) => {
          event.preventDefault()
          document.getElementById(`source-${id}`)?.scrollIntoView({ behavior: 'smooth' })
        }} className="font-semibold text-brand">
          [{sourceNumber.get(id)}]
        </a>
      ))}
    </span>
  )
}

function TimesTable() {
  const { t, i18n } = useTranslation()
  const guide = useShelfLifeGuide()
  const catalog = useCatalog()
  const periodText = usePeriodText()
  const english = i18n.resolvedLanguage === 'en'
  if (!guide.data) return null

  function subject(entry: GuideEntry) {
    if (entry.catalog_item_id) {
      const item = catalog.byId.get(entry.catalog_item_id)
      return item ? (english ? item.name_en : item.name_es) : ''
    }
    return t('conservation.categoryFallback', { category: t(`categories.${entry.category!}`) })
  }

  return (
    <Card>
      <h2 className="font-semibold">{t('conservation.timesTitle')}</h2>
      <p className="text-sm text-ink-muted">{t('conservation.timesIntro')}</p>
      {states.map((state) => {
        const rows = guide.data
          .filter((entry) => entry.state === state)
          .map((entry) => ({ entry, subject: subject(entry) }))
          .sort((a, b) => a.subject.localeCompare(b.subject))
        if (rows.length === 0) return null
        return (
          <section key={state} className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t(`conservation.states.${state}`)}</h3>
            <ul className="flex flex-col divide-y divide-line">
              {rows.map(({ entry, subject }) => (
                <li key={`${subject}-${state}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0">
                    {subject}
                    <span className="block text-xs text-ink-muted">{english ? entry.note_en : entry.note_es}</span>
                  </span>
                  <span className="shrink-0 text-right font-semibold">
                    {periodText(entry) ?? t('conservation.dontFreeze')}
                    <SourceRefs ids={[entry.source]} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </Card>
  )
}

export function ConservationPage() {
  const { t, i18n } = useTranslation()
  const { tag, today } = useDateContext()
  const guide = i18n.resolvedLanguage === 'en' ? guideEn : guideEs
  const english = i18n.resolvedLanguage === 'en'

  return (
    <Screen
      title={t('conservation.title')}
      backTo="/settings"
      main={
        <div className="flex flex-col gap-4">
          {!review.reviewed && (
            <p role="note" className="rounded-xl bg-review-bg px-4 py-3 text-sm font-semibold text-review">
              {t('conservation.pending')}
            </p>
          )}
          <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">{t('conservation.disclaimer')}</p>

          {guide.sections.map((section) => (
            <Card key={section.id}>
              <h2 className="font-semibold">{section.title}</h2>
              <ul className="flex list-disc flex-col gap-2 pl-5">
                {section.items.map((item) => (
                  <li key={item.text}>
                    {item.text}
                    <SourceRefs ids={'sources' in item ? item.sources : undefined} />
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          <TimesTable />

          <Card>
            <h2 className="font-semibold">{t('conservation.sourcesTitle')}</h2>
            <ol className="flex flex-col gap-2 text-sm">
              {sources.map((source, index) => (
                <li key={source.id} id={`source-${source.id}`}>
                  <span className="font-semibold">[{index + 1}]</span> {source.publisher}.{' '}
                  <a href={source.url} target="_blank" rel="noreferrer" className="break-words text-brand underline">
                    {english ? source.title_en : source.title_es}
                  </a>
                </li>
              ))}
            </ol>
            <p className="text-sm text-ink-muted">{t('conservation.consulted', { date: formatDate(sourcesData.consulted, tag, today) })}</p>
          </Card>
        </div>
      }
    />
  )
}
