import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

// TanStack Query da por hecho que hay conexión hasta que el navegador avise de lo contrario.
onlineManager.setOnline(navigator.onLine)

// `navigator.onLine` no detecta una wifi sin internet, ni un servidor pausado.
let serverUnreachable = false
const listeners = new Set<() => void>()

export function setServerReachable(reachable: boolean) {
  if (serverUnreachable === !reachable) return
  serverUnreachable = !reachable
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const stopOnlineManager = onlineManager.subscribe(listener)
  return () => {
    listeners.delete(listener)
    stopOnlineManager()
  }
}

export function isOffline() {
  return !onlineManager.isOnline() || serverUnreachable
}

export function useOffline() {
  return useSyncExternalStore(subscribe, isOffline)
}
