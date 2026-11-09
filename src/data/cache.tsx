import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { del, get, keys, set } from 'idb-keyval'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { setServerReachable } from '../lib/connectivity'
import { errorKey } from '../lib/errors'
import { cachePrefix, cacheVersion, keepCacheMs } from './cacheConfig'

// Lo que quien sale deja pendiente de guardar llega, como mucho, un segundo después.
const lastSaveMs = 2000

function noteFailure(error: unknown) {
  if (errorKey(error) === 'errors.network') setServerReachable(false)
}

function noteSuccess() {
  setServerReachable(true)
}

function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: noteFailure, onSuccess: noteSuccess }),
    mutationCache: new MutationCache({ onError: noteFailure, onSuccess: noteSuccess }),
    defaultOptions: {
      queries: { gcTime: keepCacheMs },
      // Sin conexión, escribir falla enseguida: no queda pendiente para aplicarse horas después.
      mutations: { networkMode: 'always' },
    },
  })
}

function createPersistOptions(userId: string) {
  return {
    persister: createAsyncStoragePersister({
      key: `${cachePrefix}${userId}`,
      storage: { getItem: get<string>, setItem: set, removeItem: del },
    }),
    maxAge: keepCacheMs,
    buster: cacheVersion,
    dehydrateOptions: {
      // Un fallo al actualizar sin conexión deja la consulta en error, pero sus datos siguen valiendo.
      shouldDehydrateQuery: (query: { state: { data: unknown }; queryKey: readonly unknown[] }) =>
        query.state.data !== undefined && query.queryKey[0] !== 'nextContainer',
    },
  }
}

async function removeOtherCaches(userId: string | null) {
  try {
    const stored = await keys()
    const others = stored.filter((key) => typeof key === 'string' && key.startsWith(cachePrefix) && key !== `${cachePrefix}${userId}`)
    await Promise.all(others.map((key) => del(key)))
  } catch {
    // Sin IndexedDB no se ha guardado nada.
  }
}

function UserCache({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [client] = useState(createQueryClient)
  const [persistOptions] = useState(() => (userId ? createPersistOptions(userId) : null))

  return persistOptions ? (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  ) : (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/**
 * Datos en caché para consultarlos sin conexión. Cada cuenta tiene los suyos y se borran al salir,
 * así quien entra después en el mismo móvil nunca ve lo de la anterior.
 */
export function SessionCache({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (loading) return
    void removeOtherCaches(userId)
    const timer = setTimeout(() => void removeOtherCaches(userId), lastSaveMs)
    return () => clearTimeout(timer)
  }, [loading, userId])

  return (
    <UserCache key={userId ?? 'guest'} userId={userId}>
      {children}
    </UserCache>
  )
}
