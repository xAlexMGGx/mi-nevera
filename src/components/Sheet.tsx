import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from './icons'
import { topBarIcon } from './Screen'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Hoja inferior. Se muestra al montarla y se cierra al desmontarla. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (!element.open) element.showModal()
    return () => element.close()
  }, [])

  // Un toque en el fondo llega al propio <dialog>; un toque en el contenido, a sus hijos.
  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialog.current) onClose()
  }

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="sheet-title" onCancel={onClose} onClick={closeOnBackdrop}>
      <div className="safe-bottom safe-x">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <h2 id="sheet-title" className="min-w-0 flex-1 text-lg font-bold">
              {title}
            </h2>
            <button type="button" aria-label={t('common.close')} onClick={onClose} className={topBarIcon}>
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      </div>
    </dialog>
  )
}
