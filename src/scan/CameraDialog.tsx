import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '../components/icons'
import { focusRing } from '../components/ui'

interface CameraDialogProps {
  title: string
  /** Debajo del título, por ejemplo "Ahora: Leche · 3 de 9". */
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}

/** Pantalla completa sobre todo lo demás, también sobre una hoja abierta. Se cierra al desmontarla. */
export function CameraDialog({ title, subtitle, onClose, children }: CameraDialogProps) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (!element.open) element.showModal()
    return () => element.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="camera"
      aria-labelledby="camera-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="safe-top safe-bottom safe-x flex h-full flex-col">
        <div className="mx-auto flex w-full max-w-xl items-start gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="camera-title" className="truncate text-lg font-bold">
              {title}
            </h2>
            {subtitle && <p className="text-sm text-white/80">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/25 ${focusRing}`}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-xl min-h-0 flex-1 flex-col gap-3 px-4 pb-4">{children}</div>
      </div>
    </dialog>
  )
}

/** Recuadro de la vista de cámara. */
export function CameraFrame({ children }: { children: ReactNode }) {
  return <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-neutral-900">{children}</div>
}
