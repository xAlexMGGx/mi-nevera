import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DateResult } from '../../supabase/functions/_shared/readDate.ts'
import { PhotoButton } from '../components/PhotoButton'
import { Button, Segmented, TextField } from '../components/ui'
import { useDateContext } from '../data/context'
import { formatFullDate } from '../domain/dates'
import type { PrintedDateType } from '../domain/types'
import { errorKey } from '../lib/errors'
import { invokeFunction } from '../lib/functions'
import { captureVideoFrame, prepareImageFile, type PreparedImage } from '../lib/image'
import { CameraDialog, CameraFrame } from './CameraDialog'
import { useCamera } from './useCamera'

export interface DateTarget {
  key: string
  name: string
}

interface ReadDateDialogProps {
  /** Uno, o varios para el escaneo en cadena (SPEC §10.3). */
  targets: DateTarget[]
  chain?: boolean
  onConfirm: (key: string, date: string, type: PrintedDateType) => void
  /** Al terminar o al salir. */
  onClose: () => void
}

type Phase =
  | { type: 'camera' }
  | { type: 'reading'; preview: string }
  | { type: 'result'; preview: string; result: DateResult }
  | { type: 'error'; preview: string; message: string }

/**
 * Leer fecha con la cámara (SPEC §10.2). Siempre se confirma: la fecha leída en grande, el texto
 * reconocido debajo, y Confirmar · Corregir · Repetir foto. La cámara sigue abierta entre productos.
 */
export function ReadDateDialog({ targets, chain = false, onConfirm, onClose }: ReadDateDialogProps) {
  const { t } = useTranslation()
  const { today } = useDateContext()
  const { videoRef, status: cameraStatus, retry: retryCamera } = useCamera()
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>({ type: 'camera' })
  const target = targets[index]

  const read = useMutation({
    mutationFn: (image: PreparedImage) => invokeFunction<DateResult>('read-date', { image: image.data, media_type: image.mediaType, today }),
  })

  async function send(image: PreparedImage) {
    const preview = `data:${image.mediaType};base64,${image.data}`
    setPhase({ type: 'reading', preview })
    try {
      setPhase({ type: 'result', preview, result: await read.mutateAsync(image) })
    } catch (error) {
      setPhase({ type: 'error', preview, message: t(errorKey(error)) })
    }
  }

  function capture() {
    const video = videoRef.current
    if (!video) return
    captureVideoFrame(video).then(send, () => setPhase({ type: 'error', preview: '', message: t('errors.image_unreadable') }))
  }

  function fromFile(file: File) {
    prepareImageFile(file).then(send, () => setPhase({ type: 'error', preview: '', message: t('errors.image_unreadable') }))
  }

  function next() {
    if (index + 1 < targets.length) {
      setIndex(index + 1)
      setPhase({ type: 'camera' })
    } else {
      onClose()
    }
  }

  if (!target) return null

  const subtitle = chain
    ? t('readDate.chainNow', { name: target.name, current: index + 1, total: targets.length })
    : target.name

  return (
    <CameraDialog title={chain ? t('readDate.chainTitle') : t('readDate.title')} subtitle={subtitle} onClose={onClose}>
      <CameraFrame>
        <video ref={videoRef} playsInline muted className={`size-full object-cover ${phase.type === 'camera' ? '' : 'invisible'}`} />
        {phase.type !== 'camera' && phase.preview && <img src={phase.preview} alt="" className="absolute inset-0 size-full object-contain" />}
        {phase.type === 'camera' && cameraStatus !== 'ready' && (
          <p role="status" className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/80">
            {t(`camera.${cameraStatus}`)}
          </p>
        )}
        {phase.type === 'reading' && (
          <p role="status" className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center font-semibold">
            {t('readDate.reading')}
          </p>
        )}
      </CameraFrame>

      {phase.type === 'camera' && (
        <div className="flex flex-col gap-2">
          {cameraStatus === 'ready' && <p className="text-center text-sm text-white/80">{t('readDate.hint')}</p>}
          {cameraStatus === 'ready' ? (
            <Button onClick={capture}>{t('readDate.shoot')}</Button>
          ) : cameraStatus !== 'starting' ? (
            <>
              <PhotoButton camera label={t('readDate.shoot')} onFile={fromFile} />
              <Button variant="secondary" onClick={retryCamera}>
                {t('camera.retry')}
              </Button>
            </>
          ) : null}
          {chain && (
            <Button variant="secondary" onClick={next}>
              {t('readDate.skip')}
            </Button>
          )}
        </div>
      )}

      {phase.type === 'result' && (
        <DateConfirmation
          key={`${target.key}-${phase.preview.length}`}
          result={phase.result}
          chain={chain}
          onConfirm={(date, type) => {
            onConfirm(target.key, date, type)
            next()
          }}
          onRetake={() => setPhase({ type: 'camera' })}
          onSkip={next}
        />
      )}

      {phase.type === 'error' && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 text-ink">
          <p role="alert" className="font-semibold text-danger">
            {phase.message}
          </p>
          <Button onClick={() => setPhase({ type: 'camera' })}>{t('readDate.retake')}</Button>
          {chain && (
            <Button variant="secondary" onClick={next}>
              {t('readDate.skip')}
            </Button>
          )}
        </div>
      )}
    </CameraDialog>
  )
}

interface DateConfirmationProps {
  result: DateResult
  chain: boolean
  onConfirm: (date: string, type: PrintedDateType) => void
  onRetake: () => void
  onSkip: () => void
}

function DateConfirmation({ result, chain, onConfirm, onRetake, onSkip }: DateConfirmationProps) {
  const { t } = useTranslation()
  const { tag } = useDateContext()
  const [editing, setEditing] = useState(!result.date)
  const [date, setDate] = useState(result.date ?? '')
  const [type, setType] = useState<PrintedDateType | null>(result.date_type)
  const low = result.confidence === 'low'

  return (
    <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-4 text-ink">
      {editing ? (
        <>
          {!result.date && <p className="font-semibold">{t('readDate.notFound')}</p>}
          <TextField label={t('form.printedDate')} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </>
      ) : (
        <div className={`rounded-xl p-3 ${low ? 'bg-review-bg text-review' : 'bg-canvas'}`}>
          <p className="text-2xl font-bold first-letter:uppercase">{formatFullDate(date, tag)}</p>
          {low && <p className="text-sm font-semibold">{t('readDate.lowConfidence')}</p>}
          {result.month_only && <p className="text-sm">{t('readDate.monthOnly')}</p>}
          {result.year_assumed && <p className="text-sm">{t('readDate.yearAssumed', { year: date.slice(0, 4) })}</p>}
        </div>
      )}
      {result.raw_text && <p className="text-sm text-ink-muted">{t('readDate.recognized', { text: result.raw_text })}</p>}
      <Segmented
        label={t('form.dateType')}
        options={[
          { value: 'expiry', label: t('dateTypes.expiry') },
          { value: 'best_before', label: t('dateTypes.best_before') },
        ]}
        value={type}
        onChange={setType}
      />
      {!result.date_type && <p className="-mt-1 text-sm text-ink-muted">{t('readDate.chooseType')}</p>}
      <Button disabled={!date || !type} onClick={() => date && type && onConfirm(date, type)}>
        {chain ? t('readDate.confirmNext') : t('readDate.confirm')}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        {!editing && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('readDate.correct')}
          </Button>
        )}
        <Button variant="secondary" className={editing ? 'col-span-2' : ''} onClick={onRetake}>
          {t('readDate.retake')}
        </Button>
      </div>
      {chain && (
        <Button variant="secondary" onClick={onSkip}>
          {t('readDate.skip')}
        </Button>
      )}
    </div>
  )
}
