import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useOffline } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

const visibleMs = 5000
/** Con una acción ("Se ha acabado: X." · A la lista) hace falta algo más de tiempo para decidir. */
const visibleWithActionMs = 8000

export interface ToastAction {
  label: string
  run: () => Promise<void>
}

interface ToastState {
  text: string
  tone: 'info' | 'error'
  movementId?: string
  action?: ToastAction
}

interface ToastContextValue {
  showUndo: (text: string, movementId: string, action?: ToastAction) => void
  showInfo: (text: string) => void
  showError: (text: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [undoing, setUndoing] = useState(false)
  const offline = useOffline()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Cada aviso sustituye al anterior y reinicia su tiempo.
  useEffect(() => {
    if (!toast) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), toast.action ? visibleWithActionMs : visibleMs)
    return () => clearTimeout(timer.current)
  }, [toast])

  const value = useMemo<ToastContextValue>(
    () => ({
      showUndo: (text, movementId, action) => setToast({ text, tone: 'info', movementId, action }),
      showInfo: (text) => setToast({ text, tone: 'info' }),
      showError: (text) => setToast({ text, tone: 'error' }),
    }),
    [],
  )

  async function runAction(action: ToastAction) {
    setUndoing(true)
    try {
      await action.run()
    } catch (error) {
      setToast({ text: t(errorKey(error)), tone: 'error' })
    }
    setUndoing(false)
  }

  async function undo(movementId: string) {
    setUndoing(true)
    const { error } = await supabase.rpc('undo_movement', { p_movement_id: movementId })
    if (error) {
      setToast({ text: t(errorKey(error)), tone: 'error' })
    } else {
      await queryClient.invalidateQueries({ queryKey: ['inventory'] })
      await queryClient.invalidateQueries({ queryKey: ['movements'] })
      // Deshacer un ticket vuelve a dejar pendiente lo que tachó de la lista.
      void queryClient.invalidateQueries({ queryKey: ['shopping'] })
      setToast({ text: t('toast.undone'), tone: 'info' })
    }
    setUndoing(false)
  }

  return (
    <ToastContext value={value}>
      {children}
      <div aria-live="polite" className="safe-x above-nav pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4">
        {toast && (
          <div
            className={`pointer-events-auto flex min-h-12 w-full max-w-md items-center gap-3 rounded-xl py-2 pr-2 pl-4 text-sm font-medium shadow-lg ${
              toast.tone === 'error' ? 'bg-expired-bg text-expired' : 'bg-ink text-canvas'
            }`}
          >
            <p className="min-w-0 flex-1 py-1.5">{toast.text}</p>
            {toast.action && !offline && (
              <button
                type="button"
                disabled={undoing}
                onClick={() => void runAction(toast.action!)}
                className="min-h-10 shrink-0 rounded-lg bg-canvas px-3 font-bold text-ink active:opacity-70 disabled:opacity-50"
              >
                {toast.action.label}
              </button>
            )}
            {toast.movementId && !offline && (
              <button
                type="button"
                disabled={undoing}
                onClick={() => void undo(toast.movementId!)}
                className="min-h-10 shrink-0 rounded-lg px-3 font-bold underline underline-offset-2 active:opacity-70 disabled:opacity-50"
              >
                {t('toast.undo')}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext>
  )
}

export function useToast() {
  const context = use(ToastContext)
  if (!context) throw new Error('useToast debe usarse dentro de ToastProvider')
  return context
}

/** Para las pantallas que solo avisan de un error, sin ofrecer deshacer. */
export function useShowError() {
  const { showError } = useToast()
  const { t } = useTranslation()
  return useCallback((error: unknown) => showError(t(errorKey(error))), [showError, t])
}
