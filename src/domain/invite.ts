/** Lo que se ve y se comparte: ABCD-EFGH. */
export function formatInviteCode(code: string) {
  const clean = normalizeInviteCode(code)
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

/** Lo que se guarda: admite minúsculas, espacios y guiones al escribirlo. */
export function normalizeInviteCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const inviteCodeLength = 8

export function inviteLink(code: string, origin: string, basePath: string) {
  return `${origin}${basePath}#/join/${normalizeInviteCode(code)}`
}

/** Para confirmar una acción grave escribiendo una palabra, sin depender de mayúsculas ni espacios. */
export function matchesConfirmation(typed: string, expected: string) {
  return typed.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase()
}
