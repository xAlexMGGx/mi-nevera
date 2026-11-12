import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { maxReceiptPhotos } from '../../supabase/functions/_shared/image.ts'
import type { ReceiptResult } from '../../supabase/functions/_shared/receipt.ts'
import { useUser } from '../auth/AuthProvider'
import { CloseIcon } from '../components/icons'
import { PhotoButton } from '../components/PhotoButton'
import { Screen } from '../components/Screen'
import { Button, FullScreenLoader, LoadError, Message, buttonClass, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { useDateContext } from '../data/context'
import { useActiveHouseId, useHouses } from '../data/house'
import { useInventory } from '../data/inventory'
import { draftFromReceipt, type TicketDraft } from '../domain/ticket'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { invokeFunction } from '../lib/functions'
import { prepareImageFile, type PreparedImage } from '../lib/image'
import { clearDraft, loadDraft, saveDraft } from './ticket/draftStorage'
import { TicketPreview } from './ticket/TicketPreview'

/** Paso 1 (SPEC §10.1): la foto, o varias si el ticket es largo, y la lectura. */
function TicketCapture({ onRead }: { onRead: (draft: TicketDraft) => void }) {
  const { t } = useTranslation()
  const { today } = useDateContext()
  const offline = useOffline()
  const houseId = useActiveHouseId()
  const inventory = useInventory()
  const catalog = useCatalog()
  const [photos, setPhotos] = useState<PreparedImage[]>([])
  const [photoError, setPhotoError] = useState(false)
  const [empty, setEmpty] = useState(false)

  const read = useMutation({
    mutationFn: () =>
      invokeFunction<ReceiptResult>('parse-receipt', {
        house_id: houseId,
        today,
        images: photos.map((photo) => ({ image: photo.data, media_type: photo.mediaType })),
      }),
    onSuccess: (result) => {
      if (result.lines.length === 0 || !inventory.data) return setEmpty(true)
      onRead(draftFromReceipt(result, houseId, today, inventory.data, catalog.byId))
    },
  })

  if (inventory.isPending || catalog.isPending) return <FullScreenLoader />
  if (inventory.isLoadingError) return <Screen title={t('ticket.title')} backTo="/" main={<LoadError onRetry={() => void inventory.refetch()} />} />

  function addPhoto(file: File) {
    setPhotoError(false)
    setEmpty(false)
    read.reset()
    prepareImageFile(file).then(
      (photo) => setPhotos((current) => [...current, photo].slice(0, maxReceiptPhotos)),
      () => setPhotoError(true),
    )
  }

  const busy = read.isPending || offline
  const canAddMore = photos.length < maxReceiptPhotos

  return (
    <Screen
      title={t('ticket.title')}
      backTo="/"
      main={
        <div className="flex flex-col gap-4">
          <p className="text-ink-muted">{t('ticket.photoHint')}</p>

          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((photo, index) => (
                <li key={index} className="relative overflow-hidden rounded-xl border border-line bg-surface">
                  <img src={`data:${photo.mediaType};base64,${photo.data}`} alt={t('ticket.part', { number: index + 1 })} className="aspect-[3/4] w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 text-xs font-semibold text-white">{t('ticket.part', { number: index + 1 })}</span>
                  <button
                    type="button"
                    aria-label={t('ticket.removePart', { number: index + 1 })}
                    disabled={read.isPending}
                    onClick={() => setPhotos((current) => current.filter((_, position) => position !== index))}
                    className={`absolute top-1 right-1 flex size-9 items-center justify-center rounded-full bg-black/60 text-white ${focusRing}`}
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {photos.length === 0 ? (
            <>
              <PhotoButton camera label={t('ticket.takePhoto')} disabled={busy} onFile={addPhoto} />
              <PhotoButton variant="secondary" label={t('ticket.fromGallery')} disabled={busy} onFile={addPhoto} />
            </>
          ) : (
            <>
              {read.isPending ? (
                <p role="status" className="rounded-xl bg-surface p-3 text-center font-semibold">
                  {t('ticket.reading')}
                </p>
              ) : (
                <Button disabled={busy} onClick={() => read.mutate()}>
                  {read.isError ? t('common.retry') : t('ticket.read')}
                </Button>
              )}
              {canAddMore && <PhotoButton variant="secondary" camera label={t('ticket.addPart')} disabled={busy} onFile={addPhoto} />}
            </>
          )}

          {photoError && <Message tone="error">{t('errors.image_unreadable')}</Message>}
          {(read.isError || empty) && (
            <div className="flex flex-col gap-2">
              <Message tone="error">{empty ? t('ticket.nothingFound') : t(errorKey(read.error))}</Message>
              <Link to="/add" className={buttonClass('secondary')}>
                {t('ticket.addByHand')}
              </Link>
            </div>
          )}

          <p className="text-xs text-ink-muted">{t('ticket.privacy')}</p>
        </div>
      }
    />
  )
}

/**
 * Escanear ticket (SPEC §10). El borrador vive en el móvil hasta aplicarlo o descartarlo.
 */
export function TicketPage() {
  const { t } = useTranslation()
  const { id: userId } = useUser()
  const houses = useHouses()
  const [draft, setDraft] = useState<TicketDraft | null>(() => loadDraft(userId))

  useEffect(() => {
    if (draft) saveDraft(userId, draft)
    else clearDraft(userId)
  }, [draft, userId])

  if (!draft) return <TicketCapture onRead={setDraft} />

  // Por ejemplo, han sacado a esta persona de la casa del borrador.
  if (houses.data && !houses.data.some((house) => house.id === draft.houseId)) {
    return (
      <Screen
        title={t('ticket.title')}
        backTo="/"
        main={
          <div className="flex flex-col gap-4">
            <Message tone="error">{t('ticket.houseGone')}</Message>
            <Button onClick={() => setDraft(null)}>{t('ticket.startOver')}</Button>
          </div>
        }
      />
    )
  }

  return <TicketPreview draft={draft} update={(change) => setDraft((current) => (current ? change(current) : current))} onFinished={() => setDraft(null)} />
}
