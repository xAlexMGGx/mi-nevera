import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// GitHub Pages sirve la app en /<nombre-del-repo>/. Si renombras el repo, cambia también esto.
const base = '/mi-nevera/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: { config: true, overrideManifestIcons: true, injectThemeColor: false },
      manifest: {
        id: base,
        name: 'Nevera digital',
        short_name: 'Nevera',
        description: 'Qué comida hay en cada casa, cuánta y cuándo caduca.',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#f5f7f6',
        background_color: '#f5f7f6',
      },
      workbox: {
        // Las pantallas de arranque de iOS no se precargan: cada móvil solo usa una.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['**/apple-splash-*'],
        // Recibir y abrir las notificaciones (public/push-sw.js).
        importScripts: ['push-sw.js'],
        // Las fotos de las tarjetas se guardan para verlas sin conexión (SPEC §12). Los nombres de
        // las cachés están también en src/data/photos.ts, que las vacía al cerrar sesión.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/images\.openfoodfacts\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'off-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Fotos propias: URL firmadas del bucket privado. La app reutiliza la misma URL varios días.
            urlPattern: /\/storage\/v1\/object\/sign\/photos\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'own-photos',
              // Como los datos guardados para consultar sin conexión (src/data/cacheConfig.ts).
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 21 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Arrancar Postgres en memoria tarda varios segundos con los tests en paralelo.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
