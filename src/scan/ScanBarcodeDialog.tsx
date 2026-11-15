import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ProductPhoto } from '../components/ProductPhoto'
import { Button, focusRing } from '../components/ui'
import { useCatalog } from '../data/catalog'
import { productName, type InventoryData } from '../domain/inventory'
import { CameraDialog, CameraFrame } from './CameraDialog'
import { resolveBarcode, type BarcodeResult, type ResolveStage } from './identify'
import { cleanBarcode } from './openFoodFacts'
import { cameraErrorStatus, rearCamera, type CameraStatus } from './useCamera'

interface ScanBarcodeDialogProps {
  houseId: string
  house: InventoryData
  /** Identificar el producto con la IA si la casa no conoce el código: desde ＋ y desde Añadir. */
  identify?: boolean
  onResult: (result: BarcodeResult) => void
  /** "Elegir otro producto": lo propuesto no es, y se elige en el buscador con el código ya leído. */
  onPickOther?: (result: BarcodeResult) => void
  onClose: () => void
}

type Phase = { type: 'scan' } | { type: 'resolving'; barcode: string; stage: ResolveStage } | { type: 'result'; result: BarcodeResult }

/** Lee el código, averigua qué producto es y lo enseña para confirmarlo (SPEC §11). */
export function ScanBarcodeDialog({ houseId, house, identify = false, onResult, onPickOther, onClose }: ScanBarcodeDialogProps) {
  const { t, i18n } = useTranslation()
  const [phase, setPhase] = useState<Phase>({ type: 'scan' })
  const language = i18n.resolvedLanguage ?? 'es'
  const barcode = phase.type === 'resolving' ? phase.barcode : null

  useEffect(() => {
    if (!barcode) return
    const controller = new AbortController()
    resolveBarcode(barcode, {
      houseId,
      house,
      language,
      identify,
      signal: controller.signal,
      onStage: (stage) => setPhase({ type: 'resolving', barcode, stage }),
    }).then(
      (result) => setPhase({ type: 'result', result }),
      () => {
        // Se ha cerrado o se ha vuelto a escanear: no hay nada que enseñar.
      },
    )
    return () => controller.abort()
    // Solo al leer un código nuevo; los datos de la casa no cambian mientras tanto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcode])

  return (
    <CameraDialog title={t('barcode.title')} onClose={onClose}>
      {phase.type === 'scan' && <Scanner onCode={(code) => setPhase({ type: 'resolving', barcode: code, stage: 'looking' })} />}
      {phase.type === 'resolving' && (
        <p role="status" className="flex flex-1 items-center justify-center text-center text-white/80">
          {phase.stage === 'identifying' ? t('barcode.identifying') : t('barcode.lookingUp', { code: phase.barcode })}
        </p>
      )}
      {phase.type === 'result' && (
        <ScanResult
          result={phase.result}
          house={house}
          identify={identify}
          onUse={() => onResult(phase.result)}
          onPickOther={onPickOther ? () => onPickOther(phase.result) : undefined}
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
        // Una lectura que llega tarde, cuando ya se ha escrito otro código a mano, no cuenta.
        if (!barcode || found || cancelled) return
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

interface ScanResultProps {
  result: BarcodeResult
  house: InventoryData
  identify: boolean
  onUse: () => void
  onPickOther?: () => void
  onAgain: () => void
}

function ScanResult({ result, house, identify, onUse, onPickOther, onAgain }: ScanResultProps) {
  const { t, i18n } = useTranslation()
  const catalog = useCatalog()
  const language = i18n.resolvedLanguage ?? 'es'
  const { scanned, proposal } = result

  const product = result.productId ? house.products.find((row) => row.id === result.productId) : undefined
  const catalogItem = !product && proposal?.catalog_item_id ? catalog.byId.get(proposal.catalog_item_id) : undefined
  const title = product
    ? productName(product, catalog.byId, language)
    : catalogItem
      ? language === 'en' ? catalogItem.name_en : catalogItem.name_es
      : (proposal?.name ?? scanned.name)
  const kind = product ? t('barcode.inHouse') : catalogItem ? t('barcode.fromCatalog') : proposal ? t('barcode.newProduct') : null
  const original = result.source !== 'house' && scanned.name && scanned.name !== title ? scanned.name : null
  const found = Boolean(title)

  return (
    <div className="flex flex-1 flex-col justify-end gap-3">
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 text-ink">
        <div className="flex items-start gap-3">
          <ProductPhoto src={scanned.imageUrl} className="size-20 rounded-xl" />
          <div className="min-w-0 flex-1">
            {found ? (
              <>
                <p className="text-lg font-bold">{title}</p>
                {kind && <p className="text-sm font-semibold text-brand">{kind}</p>}
                {(scanned.brand || scanned.quantityText) && <p className="text-ink-muted">{[scanned.brand, scanned.quantityText].filter(Boolean).join(' · ')}</p>}
                {original && <p className="text-sm text-ink-muted">{t('barcode.original', { name: original })}</p>}
              </>
            ) : (
              <p className="font-semibold">{result.offline ? t('barcode.offline') : t('barcode.notFound')}</p>
            )}
            <p className="mt-1 text-xs text-ink-muted">{t('barcode.code', { code: scanned.barcode })}</p>
          </div>
        </div>
        {!found && <p className="text-sm text-ink-muted">{t('barcode.fillByHand')}</p>}
        {identify && result.aiError && (
          <p className="text-sm text-ink-muted">
            {t('barcode.notIdentified')} {t(result.aiError)}
          </p>
        )}
        <Button onClick={onUse}>{found ? t('barcode.use') : t('barcode.useCode')}</Button>
        {onPickOther && found && (
          <Button variant="secondary" onClick={onPickOther}>
            {t('barcode.pickOther')}
          </Button>
        )}
        <Button variant="secondary" onClick={onAgain}>
          {t('barcode.again')}
        </Button>
      </div>
      {result.source !== 'house' && scanned.name && <p className="text-center text-xs text-white/60">{t('barcode.source')}</p>}
    </div>
  )
}
