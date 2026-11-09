import { describe, expect, it } from 'vitest'
import { keepCacheMs } from './cacheConfig'

describe('caché sin conexión', () => {
  // Un valor mayor se dispara al momento y vacía la caché nada más restaurarla.
  it('dura menos que el temporizador más largo que admite el navegador', () => {
    expect(keepCacheMs).toBeLessThanOrEqual(2 ** 31 - 1)
  })
})
