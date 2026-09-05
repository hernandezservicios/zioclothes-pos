import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    // GitHub Pages:
    // https://zioclothes.github.io/shop/
    base: '/shop/',

    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/favicon.svg', 'icons/icon-192.svg', 'icons/icon-512.svg'],
        manifest: {
          name: 'ZIO CLOTHES - Punto de Venta',
          short_name: 'ZIO CLOTHES',
          description: 'Sistema de Punto de Venta para ZIO CLOTHES',
          theme_color: '#2F2A25',
          background_color: '#FAF8F4',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/shop/',
          start_url: '/shop/',
          id: '/shop/',
          icons: [
            { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
            { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
            { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,json,woff2}'],
          runtimeCaching: [
            {
              // CORREGIR AUDITORÍA (hallazgo #9): el patrón anterior
              // (/^https?:\/\/.*$/) coincidía con CUALQUIER URL http(s),
              // incluidas las llamadas reales a Google Apps Script
              // (script.google.com / script.googleusercontent.com). Bajo
              // NetworkFirst eso significa que, si en algún momento la red
              // falla, el Service Worker podría servir/guardar por hasta
              // 24h una respuesta de error (HTML, 404) como si fuera una
              // respuesta válida cacheada -- agravando exactamente el
              // síntoma "Unexpected token '<'" reportado en la auditoría.
              // Las llamadas al backend real de la app SIEMPRE deben ir a
              // la red; nunca deben tratarse como una caché genérica.
              //
              // AUDITORÍA 2 (fotos de productos -- imágenes de Drive rotas
              // solo con Service Worker activo): este mismo catch-all
              // también capturaba, sin que nadie lo excluyera nunca, las
              // fotos de productos servidas desde Drive
              // (drive.google.com/thumbnail, y el redirect final hacia
              // lh3.googleusercontent.com). Esas URLs SIEMPRE redirigen
              // antes de llegar a la imagen real (confirmado con curl:
              // 302/303 -> 200 image/png) -- y la Cache Storage API
              // rechaza (TypeError) guardar una respuesta que resultó de
              // seguir una redirección, lo que hacía fallar la carga de la
              // imagen únicamente cuando el Service Worker la interceptaba
              // (nunca fuera de él, por eso curl sí funcionaba). Se excluyen
              // aquí explícitamente para que el navegador las pida
              // directamente a la red, igual que ya se hacía con Apps
              // Script -- el resto de este catch-all (NetworkFirst /
              // api-cache) sigue exactamente igual para cualquier otra URL.
              urlPattern: ({ url }) => {
                const host = url.hostname;
                const isAppsScript = host === 'script.google.com' || host === 'script.googleusercontent.com';
                const isGoogleDriveImageHost =
                  host === 'drive.google.com' ||
                  host === 'drive.usercontent.google.com' ||
                  host === 'googleusercontent.com' ||
                  host.endsWith('.googleusercontent.com');
                return !isAppsScript && !isGoogleDriveImageHost && /^https?:$/.test(url.protocol);
              },
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
                networkTimeoutSeconds: 10,
              },
            },
          ],
        },
      }),
    ],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',

      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});