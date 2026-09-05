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
              urlPattern: ({ url }) => {
                const host = url.hostname;
                const isAppsScript = host === 'script.google.com' || host === 'script.googleusercontent.com';
                return !isAppsScript && /^https?:$/.test(url.protocol);
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