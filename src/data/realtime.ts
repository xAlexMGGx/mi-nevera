import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useUser } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

const houseQueries = ['inventory', 'movements', 'house', 'houses', 'members', 'invites', 'dateSamples']
// Una misma operación puede generar varias señales seguidas.
const debounceMs = 250
// Cerrar un canal tarda un momento y, mientras tanto, pedir otro con el mismo nombre devuelve el
// viejo. Con un nombre distinto cada vez, volver a suscribirse enseguida siempre funciona.
let channelCount = 0

/**
 * Mantiene los datos al día cuando otra persona cambia algo. La base de datos solo avisa de que
 * hay cambios: los datos se vuelven a leer con los permisos de siempre.
 */
export function useRealtimeSync(houseId: string | null) {
  const { id: userId } = useUser()
  const queryClient = useQueryClient()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    function refreshHouse() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const key of houseQueries) void queryClient.invalidateQueries({ queryKey: [key] })
      }, debounceMs)
    }

    // Por ejemplo, otra persona me ha expulsado de la casa activa o la ha borrado.
    function refreshProfile() {
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['houses'] })
    }

    const channel = supabase
      .channel(`sync:${houseId ?? 'none'}:${++channelCount}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, refreshProfile)

    if (houseId) {
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'house_changes', filter: `house_id=eq.${houseId}` }, refreshHouse)
    }

    // También al reconectar, por ejemplo al volver a la app: se han podido perder avisos.
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        refreshHouse()
        refreshProfile()
      }
    })

    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [houseId, userId, queryClient])
}
