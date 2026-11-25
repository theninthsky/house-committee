import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // ask before reloading into a new version, so an open form is never lost
      registerType: 'prompt',
      injectRegister: false,
      // nothing is precached: every same-origin request goes network-first (see workbox below)
      includeManifestIcons: false,
      integration: {
        // the plugin always precaches the web manifest; drop it so it is network-first too
        beforeBuildServiceWorker(options) {
          options.workbox.additionalManifestEntries = (options.workbox.additionalManifestEntries || []).filter(
            (e) => (typeof e === 'string' ? e : e.url) !== options.manifestFilename,
          );
        },
      },
      manifest: {
        id: './',
        name: 'ניהול ועד בית',
        short_name: 'ועד הבית',
        description: 'ניהול כספי ועד בית: גבייה, קבלות, ספקים, קופה קטנה, התאמות בנק ודוחות',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f6f9',
        theme_color: '#0f1b2d',
        categories: ['finance', 'business', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          { name: 'קליטת תשלום מדייר', short_name: 'תשלום', url: './#/payments', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'מטריצת גבייה', short_name: 'גבייה', url: './#/collection', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'התאמות בנק', short_name: 'בנק', url: './#/bank', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // network-first, fall back to cache: always the latest version when online,
        // the last version seen when offline
        globPatterns: [],
        importScripts: ['sw-cleanup.js'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin }) => sameOrigin,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app',
              expiration: { maxEntries: 100, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  base: './',
  server: { port: 3000 },
});
