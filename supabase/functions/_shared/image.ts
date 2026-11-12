// La foto llega en base64 desde la app, ya comprimida (lado largo ~1600 px). No se guarda en ningún sitio.

export const imageMediaTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageMediaType = (typeof imageMediaTypes)[number]

/** Bastante por encima de lo que manda la app, y por debajo del límite de la API de Claude (5 MB). */
export const maxImageBytes = 4 * 1024 * 1024

/** Un ticket largo se puede fotografiar en varias partes. */
export const maxReceiptPhotos = 3

export interface CheckedImage {
  data: string
  media_type: ImageMediaType
}

export function checkImage(image: unknown, mediaType: unknown): CheckedImage | 'image_too_large' | 'invalid_input' {
  if (typeof image !== 'string' || typeof mediaType !== 'string') return 'invalid_input'
  if (!(imageMediaTypes as readonly string[]).includes(mediaType)) return 'invalid_input'
  const data = image.replace(/^data:[^;]+;base64,/, '')
  if (data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return 'invalid_input'
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  if ((data.length / 4) * 3 - padding > maxImageBytes) return 'image_too_large'
  return { data, media_type: mediaType as ImageMediaType }
}
