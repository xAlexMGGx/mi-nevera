import { useState } from 'react'

/** Qué muestra el campo cuando el dato de origen cambia de `lastSource` a `source`. */
export function nextFieldValue(value: string, lastSource: string, source: string) {
  return value === lastSource ? source : value
}

/**
 * Estado de un campo de formulario que sigue al dato de origen mientras nadie lo edite. Al abrir la
 * app se muestra primero lo guardado en el móvil, y otra persona puede cambiarlo mientras se mira:
 * cuando llega el valor nuevo, el campo se actualiza, salvo que ya se esté escribiendo en él.
 */
export function useFollowingState(source: string) {
  const [value, setValue] = useState(source)
  const [lastSource, setLastSource] = useState(source)

  if (source !== lastSource) {
    setLastSource(source)
    setValue(nextFieldValue(value, lastSource, source))
  }

  return [value, setValue] as const
}
