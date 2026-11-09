import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { matchesConfirmation } from '../domain/invite'
import { errorKey } from '../lib/errors'
import { Sheet } from './Sheet'
import { Button, Message, TextField } from './ui'

interface ConfirmSheetProps {
  title: string
  body: string
  submit: string
  pending: boolean
  error: unknown
  onConfirm: () => void
  onClose: () => void
  /** Para lo que no tiene vuelta atrás: hay que escribir esto para poder confirmar. */
  typeToConfirm?: { label: string; text: string }
}

/** Confirmación de una acción grave. */
export function ConfirmSheet({ title, body, submit, pending, error, onConfirm, onClose, typeToConfirm }: ConfirmSheetProps) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const confirmed = !typeToConfirm || matchesConfirmation(typed, typeToConfirm.text)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (confirmed && !pending) onConfirm()
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <p className="text-ink-muted">{body}</p>
        {typeToConfirm && (
          <TextField
            label={typeToConfirm.label}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
        {Boolean(error) && <Message tone="error">{t(errorKey(error))}</Message>}
        <Button type="submit" variant="danger" disabled={pending || !confirmed}>
          {submit}
        </Button>
      </form>
    </Sheet>
  )
}
