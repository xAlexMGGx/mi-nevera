import { useState } from 'react'

// El almacenamiento puede fallar o venir vacío (modo privado, datos borrados): nunca debe romper la app.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento, la preferencia dura hasta cerrar la app.
  }
}

/** Una preferencia del dispositivo, como el orden de la lista. */
export function usePersistedState<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = read(key)
    return allowed.includes(stored as T) ? (stored as T) : fallback
  })

  function update(next: T) {
    write(key, next)
    setValue(next)
  }

  return [value, update] as const
}
