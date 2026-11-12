import { useEffect, useRef, useState } from 'react'

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable'

/** Cámara trasera, con resolución suficiente para leer letra pequeña. */
export const rearCamera: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
}

export function cameraErrorStatus(error: unknown): CameraStatus {
  const name = (error as { name?: string } | null)?.name
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
}

/** La cámara se abre al montar y se apaga al desmontar o al salir de la app. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // El <video> ya está en la página cuando se ejecuta el efecto.
    const video = videoRef.current
    let stream: MediaStream | null = null
    let cancelled = false
    const request = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia(rearCamera)
      : Promise.reject(new DOMException('', 'NotFoundError'))

    request
      .then(async (media) => {
        stream = media
        if (cancelled || !video) {
          for (const track of media.getTracks()) track.stop()
          return
        }
        video.srcObject = media
        await video.play()
        if (!cancelled) setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus(cameraErrorStatus(error))
      })

    return () => {
      cancelled = true
      for (const track of stream?.getTracks() ?? []) track.stop()
      if (video) video.srcObject = null
    }
  }, [attempt])

  function retry() {
    setStatus('starting')
    setAttempt((value) => value + 1)
  }

  return { videoRef, status, retry }
}
