import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { devApi } from './devApi.ts';

export default defineConfig(({ mode }) => {
  // Loaded into process.env for the dev API only — no VITE_ prefix, so Vite never
  // inlines these into the client bundle.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [
      react(),
      tailwindcss(),
      devApi(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png', 'favicon-32.png', 'icon.svg'],
        manifest: {
          name: 'Lexicon',
          short_name: 'Lexicon',
          description: 'A personal vocabulary book.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#131211',
          theme_color: '#faf9f7',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              // Same artwork: the glyph already sits inside the maskable safe zone.
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          // Routes like /w/obdurate are client-side, so an offline deep link must
          // fall back to the shell rather than 404.
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // Lookups must never be served stale — a cached card would silently
              // shadow the IndexedDB copy the app actually trusts.
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
            },
            {
              // Pronunciation audio lives on Merriam-Webster's CDN. Without this,
              // "all saved cards readable offline" quietly excludes the audio.
              urlPattern: ({ url }) => url.hostname === 'media.merriam-webster.com',
              handler: 'CacheFirst',
              options: {
                cacheName: 'mw-audio',
                expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          // A service worker in dev fights HMR; verify with `npm run build && npm run preview`.
          enabled: false,
        },
      }),
    ],
  };
});
