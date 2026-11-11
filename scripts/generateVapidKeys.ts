// Genera las claves VAPID de las notificaciones (SETUP.md, paso 12).
//
// Uso: npm run push:keys
// - Escribe la pareja de claves en supabase/.env.functions (Git lo ignora), lista para
//   `npx supabase secrets set --env-file supabase/.env.functions`.
// - Muestra la clave pública, que va en .env.local y en las variables de GitHub.
// Si ya existen, no las sobrescribe: con claves nuevas, todos los móviles tendrían que volver a activar
// los avisos. Para regenerarlas a propósito: npm run push:keys -- --force

import type { webcrypto } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const defaultSubject = 'https://xalexmggx.github.io/mi-nevera/'

export interface VapidKeys {
  /** Formato de exportVapidKeys() de @negrel/webpush: las dos claves en JWK. */
  secret: { publicKey: webcrypto.JsonWebKey; privateKey: webcrypto.JsonWebKey }
  /** Clave pública para el navegador (applicationServerKey): punto sin comprimir en base64url. */
  publicKey: string
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const [publicKey, privateKey, raw] = await Promise.all([
    crypto.subtle.exportKey('jwk', keys.publicKey),
    crypto.subtle.exportKey('jwk', keys.privateKey),
    crypto.subtle.exportKey('raw', keys.publicKey),
  ])
  return { secret: { publicKey, privateKey }, publicKey: Buffer.from(raw).toString('base64url') }
}

/** Las comillas simples hacen que el JSON se lea tal cual, sin interpretar nada. */
export function functionsEnvFile(keys: VapidKeys, subject = defaultSubject) {
  return `# Secretos de las Edge Functions. Git ignora este archivo: no lo subas ni lo compartas.
# Súbelos con: npx supabase secrets set --env-file supabase/.env.functions
VAPID_KEYS='${JSON.stringify(keys.secret)}'
VAPID_SUBJECT=${subject}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf('--out')
  const file = outIndex > 0 ? process.argv[outIndex + 1]! : join(import.meta.dirname, '..', 'supabase', '.env.functions')

  if (existsSync(file) && readFileSync(file, 'utf8').includes('VAPID_KEYS=') && !process.argv.includes('--force')) {
    console.error(`Ya hay claves en ${file}. Con claves nuevas, todos los móviles tendrían que volver a activar los avisos.`)
    console.error('Si de verdad quieres cambiarlas: npm run push:keys -- --force')
    process.exit(1)
  }

  const keys = await generateVapidKeys()
  writeFileSync(file, functionsEnvFile(keys))
  console.log(`Claves secretas guardadas en ${file}`)
  console.log('')
  console.log('Clave pública (para .env.local y para las variables de GitHub):')
  console.log(`VITE_VAPID_PUBLIC_KEY=${keys.publicKey}`)
}
