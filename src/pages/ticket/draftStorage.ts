import { isTicketDraft, type TicketDraft } from '../../domain/ticket'

// El borrador se guarda en el móvil mientras se revisa: si el iPhone recarga la app al volver de la
// cámara, o se sale sin querer, no se pierde lo leído (ni se paga otra lectura).

function key(userId: string) {
  return `nevera:ticket-draft:${userId}`
}

export function loadDraft(userId: string): TicketDraft | null {
  try {
    const raw = localStorage.getItem(key(userId))
    const draft: unknown = raw ? JSON.parse(raw) : null
    return isTicketDraft(draft) ? draft : null
  } catch {
    return null
  }
}

export function saveDraft(userId: string, draft: TicketDraft) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(draft))
  } catch {
    // Sin almacenamiento, el borrador dura hasta cerrar la app.
  }
}

export function clearDraft(userId: string) {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    // Nada que borrar.
  }
}
