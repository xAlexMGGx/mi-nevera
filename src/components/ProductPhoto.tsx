import { useState } from 'react'

/** Foto de Open Food Facts. Si no carga (sin conexión, foto borrada), no se enseña nada. */
export function ProductPhoto({ src, className }: { src: string | null; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`shrink-0 bg-canvas object-contain ${className}`} />
}
