const key = 'nevera.pendingInvite'

// Quien abre un enlace de invitación sin haber entrado debe poder iniciar sesión o registrarse
// antes de unirse, así que el código se guarda hasta entonces.

export function rememberInvite(code: string) {
  try {
    localStorage.setItem(key, code)
  } catch {
    // Sin almacenamiento, tendrá que escribir el código a mano.
  }
}

export function readPendingInvite(): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(key)
  } catch {
    // No hay nada que limpiar.
  }
}
