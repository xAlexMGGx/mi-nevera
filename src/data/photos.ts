import { useQuery } from '@tanstack/react-query'
import { isOwnPhoto, ownPhotoPrefix, photoPath } from '../domain/photos'
import { preparePhotoBlob } from '../lib/image'
import { supabase } from '../lib/supabase'

const bucket = 'photos'
const day = 24 * 60 * 60
/** Una URL firmada vale una semana; se renueva un día antes. */
const signedForSeconds = 7 * day
const renewAfterMs = 6 * day * 1000

/** Caché del service worker con las fotos (vite.config.ts). Se vacía al cerrar sesión. */
export const photoCaches = ['own-photos', 'off-images']

/**
 * La URL para enseñar una foto. Las de Open Food Facts ya lo son; las propias están en un bucket
 * privado y se piden firmadas. Se guardan con los datos, así se ven también sin conexión.
 */
export function usePhotoUrl(ref: string | null | undefined): string | null {
  const own = isOwnPhoto(ref)
  const signed = useQuery({
    queryKey: ['photoUrl', ref],
    enabled: own,
    staleTime: renewAfterMs,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(photoPath(ref!), signedForSeconds)
      if (error) throw error
      return data.signedUrl
    },
  })
  if (!ref) return null
  return own ? (signed.data ?? null) : ref
}

/** Sube una foto hecha o elegida en el móvil, reducida a JPEG. Devuelve lo que se guarda en el lote o producto. */
export async function uploadPhoto(userId: string, file: Blob): Promise<string> {
  const blob = await preparePhotoBlob(file)
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: String(signedForSeconds) })
  if (error) throw error
  return `${ownPhotoPrefix}${path}`
}

/** Al cerrar sesión, las fotos guardadas en el móvil también se van. */
export async function clearPhotoCaches() {
  try {
    await Promise.all(photoCaches.map((name) => caches.delete(name)))
  } catch {
    // Sin Cache Storage no hay nada guardado.
  }
}
