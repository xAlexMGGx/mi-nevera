import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useUser } from '../auth/AuthProvider'
import { uploadPhoto } from '../data/photos'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { PhotoButton } from './PhotoButton'
import { ProductPhoto } from './ProductPhoto'
import { Sheet } from './Sheet'
import { Button, Message } from './ui'

interface PhotoSheetProps {
  title: string
  current: string | null
  /** Guarda la foto nueva ("photo:…") o null para quitarla. */
  onSave: (ref: string | null) => Promise<unknown> | void
  onClose: () => void
}

/** Hacer, elegir o quitar una foto propia (SPEC §12). Se sube reducida a un bucket privado. */
export function PhotoSheet({ title, current, onSave, onClose }: PhotoSheetProps) {
  const { t } = useTranslation()
  const { id: userId } = useUser()
  const offline = useOffline()

  const save = useMutation({
    mutationFn: async (file: File | null) => {
      const ref = file ? await uploadPhoto(userId, file) : null
      await onSave(ref)
    },
    onSuccess: onClose,
  })

  const busy = save.isPending || offline
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {current && <ProductPhoto src={current} className="aspect-[4/3] w-full rounded-xl border border-line" />}
        {save.isPending && (
          <p role="status" className="text-sm font-semibold text-ink-muted">
            {t('photo.uploading')}
          </p>
        )}
        <PhotoButton camera label={t('photo.take')} disabled={busy} onFile={(file) => save.mutate(file)} />
        <PhotoButton variant="secondary" label={t('photo.gallery')} disabled={busy} onFile={(file) => save.mutate(file)} />
        {current && (
          <Button variant="danger" disabled={busy} onClick={() => save.mutate(null)}>
            {t('photo.remove')}
          </Button>
        )}
        {save.isError && <Message tone="error">{t(errorKey(save.error))}</Message>}
        <p className="text-xs text-ink-muted">{t('photo.hint')}</p>
      </div>
    </Sheet>
  )
}
