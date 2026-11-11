import { describe, expect, it } from 'vitest'
import { generateVapidKeys } from '../scripts/generateVapidKeys'
import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/base64url'

describe('claves en base64url', () => {
  it('la clave pública que genera npm run push:keys es un punto P-256 sin comprimir', async () => {
    const { publicKey, secret } = await generateVapidKeys()
    const bytes = base64UrlToBytes(publicKey)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(4)
    // Es la misma clave que la del secreto de las Edge Functions.
    expect(bytesToBase64Url(bytes.slice(1, 33))).toBe(secret.publicKey.x)
    expect(bytesToBase64Url(bytes.slice(33))).toBe(secret.publicKey.y)
    expect(secret.privateKey.d).toBeTruthy()
  })

  it('ida y vuelta sin perder nada, también sin relleno', () => {
    for (const length of [1, 2, 3, 16, 65]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256)
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes)
    }
  })
})
