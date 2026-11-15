import { useState } from 'react'
import { usePhotoUrl } from '../data/photos'

interface ProductPhotoProps {
  /** URL de Open Food Facts o foto propia ("photo:…"). */
  src: string | null
  className: string
  /** Lo que se enseña sin foto o si no carga. Sin él, nada. */
  icon?: string
  iconClassName?: string
}

/** Foto de un producto o de un lote. Si no hay, no carga o no hay conexión, el icono. */
export function ProductPhoto({ src, className, icon, iconClassName = '' }: ProductPhotoProps) {
  const url = usePhotoUrl(src)
  const [failed, setFailed] = useState<string | null>(null)

  if (url && failed !== url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        // Open Food Facts y Storage lo permiten: así el service worker la guarda sin ocupar de más.
        crossOrigin="anonymous"
        onError={() => setFailed(url)}
        className={`shrink-0 bg-white object-contain ${className}`}
      />
    )
  }
  if (!icon) return null
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center leading-none ${iconClassName}`}>
      {icon}
    </span>
  )
}
