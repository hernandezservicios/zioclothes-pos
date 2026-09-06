import { defineConfig } from 'vitest/config';

// FASE UX POS (autofocus + vista cuadrícula/lista, Requerimiento 9):
// configuración de pruebas SEPARADA de `vite.config.ts` -- a propósito,
// para no tocar la configuración de build de producción (base de GitHub
// Pages, plugin PWA/Service Worker, alias, HMR) con nada relacionado a
// pruebas. `vite build`/`vite dev` nunca leen este archivo; solo lo lee
// `vitest`.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Node 22+ expone su propio `localStorage` global (Web Storage API
    // nativa de Node), que choca con el `localStorage` que provee el
    // entorno jsdom de Vitest -- sin este flag, `storageService.ts`
    // (import real, sin mocks) recibe el `localStorage` roto de Node
    // ("localStorage.getItem is not a function") en vez del de jsdom.
    // Se desactiva únicamente para el proceso de pruebas, vía flag de
    // Node -- no afecta `vite build`/`vite dev` (ese flujo nunca lee este
    // archivo) ni ningún código de producción.
    execArgv: ['--no-experimental-webstorage'],
  },
});
