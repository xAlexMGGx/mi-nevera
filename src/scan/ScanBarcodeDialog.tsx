import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ProductPhoto } from '../components/ProductPhoto'
import { Button, focusRing } from '../components/ui'
import { CameraDialog, CameraFrame } from './CameraDialog'
import { cleanBarcode, lookUpBarcode, toScannedProduct, type ScannedProduct } from './openFoodFacts'
import { cameraErrorStatus, rearCamera, type CameraStatus } from './useCamera'

interface ScanBarcodeDialogProps {
  onResult: (product: ScannedProduct) => void
  onClose: () => void
}

type Phase = { type: 'scan' } | { type: 'lookup'; barcode: string } | { type: 'result'; product: ScannedProduct; offline: boolean }

/** Lee el código con la cámara, lo busca en Open Food Facts y enseña lo encontrado (SPEC §11). */
export function ScanBarcodeDialog({ onResult, onClose }: ScanBarcodeDialogProps) {
  const { t, i18n } = useTranslation()
  const [phase, setPhase] = useState<Phase>({ type: 'scan' })
  const language = i18n.resolvedLanguage ?? 'es'

  useEffect(() => {
    if (phase.type !== 'lookup') return
    const controller = new AbortController()
    lookUpBarcode(phase.barcode, language, controller.signal)
      .then((product) => setPhase({ type: 'result', product, offline: false }))
      .catch(() => {
        // Sin Open Food Facts también vale: el código se guarda y el resto se rellena a mano.
        if (!controller.signal.aborted) setPhase({ type: 'result', product: toScannedProduct(phase.barcode, null, language), offline: true })
      })
    return () => controller.abort()
  }, [phase, language])

  return (
    <CameraDialog title={t('barcode.title')} onClose={onClose}>
      {phase.type === 'scan' && <Scanner onCode={(barcode) => setPhase({ type: 'lookup', barcode })} />}
      {phase.type === 'lookup' && (
        <p role="status" className="flex flex-1 items-center justify-center text-white/80">
          {t('barcode.lookingUp', { code: phase.barcode })}
        </p>
      )}
      {phase.type === 'result' && (
        <ScanResult
          product={phase.product}
          offline={phase.offline}
          onUse={() => onResult(phase.product)}
          onAgain={() => setPhase({ type: 'scan' })}
        />
      )}
    </CameraDialog>
  )
}

function Scanner({ onCode }: { onCode: (barcode: string) => void }) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [typed, setTyped] = useState('')
  const [invalid, setInvalid] = useState(false)
  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  })

  useEffect(() => {
    const video = videoRef.current
    let stop: (() => void) | null = null
    let cancelled = false
    let found = false

    async function start() {
      // La librería pesa: solo se descarga al abrir el escáner.
      const [{ BrowserMultiFormatOneDReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
      if (cancelled || !video) return
      const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]])
      const reader = new BrowserMultiFormatOneDReader(hints)
      const controls = await reader.decodeFromConstraints(rearCamera, video, (result) => {
        const barcode = result ? cleanBarcode(result.getText()) : null
        if (!barcode || found) return
        found = true
        stop?.()
        onCodeRef.current(barcode)
      })
      stop = () => controls.stop()
      if (cancelled) stop()
      else setStatus('ready')
    }

    start().catch((error: unknown) => {
      if (!cancelled) setStatus(cameraErrorStatus(error))
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    const barcode = cleanBarcode(typed)
    if (barcode) onCode(barcode)
    else setInvalid(true)
  }

  return (
    <>
      <CameraFrame>
        <video ref={videoRef} playsInline muted className="size-full object-cover" />
        {status === 'ready' && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-1/2 h-28 -translate-y-1/2 rounded-xl border-2 border-white/80" />
        )}
        {status !== 'ready' && (
          <p role="status" className="absolute inset-0 flex items-center justify-center p-6 text-center text-white/80">
            {t(`camera.${status}`)}
          </p>
        )}
      </CameraFrame>
      {status === 'ready' && <p className="text-center text-sm text-white/80">{t('barcode.hint')}</p>}
      <form onSubmit={submit} className="flex gap-2">
        <input
          inputMode="numeric"
          autoComplete="off"
          aria-label={t('barcode.manualLabel')}
          placeholder={t('barcode.manualPlaceholder')}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value)
            setInvalid(false)
          }}
          className={`min-h-12 min-w-0 flex-1 rounded-xl border border-white/30 bg-white/10 px-3.5 text-base text-white placeholder:text-white/50 ${focusRing}`}
        />
        <button type="submit" className={`min-h-12 shrink-0 rounded-xl bg-white px-4 font-semibold text-black ${focusRing}`}>
          {t('barcode.search')}
        </button>
      </form>
      {invalid && (
        <p role="alert" className="text-sm font-medium text-red-300">
          {t('barcode.invalid')}
        </p>
      )}
    </>
  )
}

function ScanResult({ product, offline, onUse, onAgain }: { product: ScannedProduct; offline: boolean; onUse: () => void; onAgain: () => void }) {
  const { t } = useTranslation()
  const found = Boolean(product.name)
  return (
    <div className="flex flex-1 flex-col justify-end gap-3">
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 text-ink">
        <div className="flex items-start gap-3">
          <ProductPhoto src={product.imageUrl} className="size-20 rounded-xl" />
          <div className="min-w-0 flex-1">
            {found ? (
              <>
                <p className="text-lg font-bold">{product.name}</p>
                {product.brand && <p className="text-ink-muted">{product.brand}</p>}
                {product.quantityText && <p className="text-sm text-ink-muted">{product.quantityText}</p>}
              </>
            ) : (
              <p className="font-semibold">{offline ? t('barcode.offline') : t('barcode.notFound')}</p>
            )}
            <p className="mt-1 text-xs text-ink-muted">{t('barcode.code', { code: product.barcode })}</p>
          </div>
        </div>
        {!found && <p className="text-sm text-ink-muted">{t('barcode.fillByHand')}</p>}
        <Button onClick={onUse}>{found ? t('barcode.use') : t('barcode.useCode')}</Button>
        <Button variant="secondary" onClick={onAgain}>
          {t('barcode.again')}
        </Button>
      </div>
      {found && <p className="text-center text-xs text-white/60">{t('barcode.source')}</p>}
    </div>
  )
}
