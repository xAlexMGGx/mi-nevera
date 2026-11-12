// Fotos para leer con IA: se reducen en el móvil antes de enviarlas (SPEC §10.1, lado largo ~1600 px).

export const maxSide = 1600
const quality = 0.82

export interface PreparedImage {
  /** Base64 sin el prefijo "data:". */
  data: string
  mediaType: 'image/jpeg'
}

/** Tamaño final manteniendo la proporción, sin ampliar nunca. */
export function fitWithin(width: number, height: number, limit = maxSide): { width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function canvasToImage(canvas: HTMLCanvasElement): Promise<PreparedImage> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('image_unreadable')
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
  return { data: btoa(binary), mediaType: 'image/jpeg' }
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const size = fitWithin(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('image_unreadable')
  context.drawImage(source, 0, 0, size.width, size.height)
  return canvas
}

/** Una foto elegida o hecha con la cámara del sistema. El navegador ya la gira según la cámara. */
export async function prepareImageFile(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return await canvasToImage(draw(bitmap, bitmap.width, bitmap.height))
  } finally {
    bitmap.close()
  }
}

/** Lo que muestra ahora mismo la cámara de la app. */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<PreparedImage> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('image_unreadable')
  return canvasToImage(draw(video, video.videoWidth, video.videoHeight))
}
