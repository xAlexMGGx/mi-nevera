import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LotFields } from '../../components/LotFields'
import { ProductResults, SearchField, type Selection } from '../../components/ProductSearch'
import { Sheet } from '../../components/Sheet'
import { Button, Message } from '../../components/ui'
import { useCatalog } from '../../data/catalog'
import { useDateContext } from '../../data/context'
import type { InventoryData } from '../../domain/inventory'
import type { LearnedDate } from '../../domain/learnedDates'
import { lineLabel, lineProblem, retargetLine, targetCounting, targetFromSelection, type DraftLine } from '../../domain/lotDraft'

/** Para elegir el producto de una línea o de una línea nueva. */
export function ProductPickerSheet({
  house,
  initialQuery = '',
  title,
  onPick,
  onClose,
}: {
  house: InventoryData
  initialQuery?: string
  title: string
  onPick: (selection: Selection) => void
  onClose: () => void
}) {
  const catalog = useCatalog()
  const [query, setQuery] = useState(initialQuery)
  return (
    <Sheet title={title} onClose={onClose}>
      <SearchField value={query} onChange={setQuery} />
      <ProductResults data={house} catalog={catalog.byId} items={catalog.items} query={query} onPick={onPick} />
    </Sheet>
  )
}

interface LineSheetProps {
  line: DraftLine
  houseId: string
  house: InventoryData
  learned: LearnedDate | null
  purchasedAt: string
  update: (change: (line: DraftLine) => DraftLine) => void
  onSplit: () => void
  onRemove: () => void
  onClose: () => void
}

/** Editar una línea del ticket, con el mismo formulario que el alta manual. Los cambios se ven al momento. */
export function LineSheet({ line, houseId, house, learned, purchasedAt, update, onSplit, onRemove, onClose }: LineSheetProps) {
  const { t } = useTranslation()
  const { language } = useDateContext()
  const catalog = useCatalog()
  const [picking, setPicking] = useState(false)

  const { name } = lineLabel(line.target, house.products, catalog.byId, language)
  const problem = lineProblem(line, house.products)
  const splittable = targetCounting(line.target, house.products).quantityKind !== 'bulk' && line.quantity >= 2

  if (picking) {
    return (
      <ProductPickerSheet
        house={house}
        title={t('ticket.pickProduct')}
        initialQuery={line.target.type === 'new' ? line.target.name : ''}
        onPick={(selection) => {
          update((current) => retargetLine(current, targetFromSelection(selection, current.target, house.products), house, catalog.byId))
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
    )
  }

  return (
    <Sheet title={name || t('ticket.line')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {line.rawText && <p className="text-sm text-ink-muted">{t('ticket.onReceipt', { text: line.rawText })}</p>}

        <LotFields line={line} houseId={houseId} house={house} learned={learned} purchasedAt={purchasedAt} update={update} onChangeProduct={() => setPicking(true)} />

        {splittable && (
          <Button variant="secondary" onClick={onSplit}>
            {t('ticket.split')}
          </Button>
        )}

        {problem && <Message tone="error">{t(`ticket.problems.${problem}`)}</Message>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="danger" onClick={onRemove}>
            {t('ticket.removeLine')}
          </Button>
          <Button onClick={onClose}>{t('ticket.done')}</Button>
        </div>
      </div>
    </Sheet>
  )
}
