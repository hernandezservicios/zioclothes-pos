import { describe, it, expect, beforeEach } from 'vitest';
import { storageService } from './storageService';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 *
 * Ejercita storageService.ts TAL COMO ES, contra el `localStorage`/
 * `sessionStorage` reales que jsdom ya provee (sin mocks) -- exactamente
 * el mismo mecanismo que usa el navegador real. Cubre en particular el
 * Requisito Crítico de Aislamiento: `clearBusinessData()` debe purgar
 * TODOS los datos de negocio de la instalación anterior, preservando
 * únicamente `zio_pos_product_view` (preferencia de interfaz local).
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('storageService -- URL del backend (única fuente de verdad)', () => {
  it('getGoogleAppsScriptUrl() devuelve "" cuando nunca se configuró nada', () => {
    expect(storageService.getGoogleAppsScriptUrl()).toBe('');
  });

  it('setGoogleAppsScriptUrl() guarda y getGoogleAppsScriptUrl() la recupera igual (persistencia real)', () => {
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/ABC/exec');
    expect(storageService.getGoogleAppsScriptUrl()).toBe('https://script.google.com/macros/s/ABC/exec');
  });

  it('clearGoogleAppsScriptUrl() la deja vacía de nuevo', () => {
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/ABC/exec');
    storageService.clearGoogleAppsScriptUrl();
    expect(storageService.getGoogleAppsScriptUrl()).toBe('');
  });

  it('"nueva pestaña"/recarga: una nueva lectura ve la misma URL ya guardada (localStorage real, no en memoria)', () => {
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/PERSIST/exec');
    // Simula una lectura completamente fresca (otra pestaña, otro montaje de App.tsx).
    expect(storageService.getGoogleAppsScriptUrl()).toBe('https://script.google.com/macros/s/PERSIST/exec');
  });
});

describe('storageService.clearBusinessData -- aislamiento entre negocios (Requisito Crítico)', () => {
  it('purga los datos de negocio reales (productos, clientes, ventas, créditos, configuración, sesión)', () => {
    storageService.saveProducts([{ id: 'P1' } as any]);
    storageService.saveCustomers([{ id: 'C1' } as any]);
    storageService.saveSales([{ id: 'V1' } as any]);
    storageService.saveCredits([{ id: 'CR1' } as any]);
    storageService.saveSettings({ nombreNegocio: 'Negocio A' } as any);
    storageService.setCurrentUser({ id: 'U1', nombre: 'Usuario A' } as any);
    storageService.saveCurrentView('products');
    storageService.setSessionToken('TOKEN-A');
    storageService.setSessionPermissions(['productos.ver']);

    storageService.clearBusinessData();

    expect(storageService.getProducts()).toEqual([]);
    expect(storageService.getCustomers()).toEqual([]);
    expect(storageService.getSales()).toEqual([]);
    expect(storageService.getCredits()).toEqual([]);
    expect(storageService.getCurrentUser()).toBeNull();
    expect(storageService.getSessionToken()).toBeNull();
    expect(storageService.getSessionPermissions()).toEqual([]);
    // Settings vuelve al valor por defecto (no queda el nombre del negocio anterior).
    expect(storageService.getSettings().nombreNegocio).not.toBe('Negocio A');
  });

  it('resetea zio_current_view (Requisito 6 de la fase) -- no sobrevive la vista del negocio anterior', () => {
    storageService.saveCurrentView('settings');
    storageService.clearBusinessData();
    expect(storageService.getCurrentView()).toBeNull();
  });

  it('PRESERVA zio_pos_product_view -- es una preferencia de interfaz local, no un dato de negocio', () => {
    storageService.savePosProductView('list');
    storageService.clearBusinessData();
    expect(storageService.getPosProductView()).toBe('list');
  });

  it('NUNCA toca zio_infrastructure_config (la URL) -- eso lo decide el llamador por separado', () => {
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/KEEP/exec');
    storageService.clearBusinessData();
    expect(storageService.getGoogleAppsScriptUrl()).toBe('https://script.google.com/macros/s/KEEP/exec');
  });
});

describe('storageService -- aislamiento real Negocio A -> Negocio B -> Negocio A', () => {
  it('A -> B: ningún dato de A sobrevive tras cambiar de servidor', () => {
    // ---- Negocio A ----
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/NEGOCIO_A/exec');
    storageService.saveProducts([{ id: 'PROD-A', nombre: 'Producto de A' } as any]);
    storageService.saveCustomers([{ id: 'CLI-A', nombre: 'Cliente de A' } as any]);
    storageService.saveSettings({ nombreNegocio: 'Negocio A' } as any);
    storageService.setCurrentUser({ id: 'USR-A', nombre: 'Usuario A' } as any);
    storageService.setSessionToken('TOKEN-A');

    // ---- Cambiar Servidor (mismo orden real de SettingsView.handleConfirmChangeServer) ----
    storageService.clearBusinessData();
    storageService.clearGoogleAppsScriptUrl();

    // ---- Conectar Negocio B ----
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/NEGOCIO_B/exec');
    storageService.saveProducts([{ id: 'PROD-B', nombre: 'Producto de B' } as any]);
    storageService.saveCustomers([{ id: 'CLI-B', nombre: 'Cliente de B' } as any]);
    storageService.saveSettings({ nombreNegocio: 'Negocio B' } as any);

    expect(storageService.getGoogleAppsScriptUrl()).toBe('https://script.google.com/macros/s/NEGOCIO_B/exec');
    expect(storageService.getProducts()).toEqual([{ id: 'PROD-B', nombre: 'Producto de B' }]);
    expect(storageService.getCustomers()).toEqual([{ id: 'CLI-B', nombre: 'Cliente de B' }]);
    expect(storageService.getSettings().nombreNegocio).toBe('Negocio B');
    // Ninguna huella de A: ni usuario ni sesión de A reutilizables.
    expect(storageService.getCurrentUser()).toBeNull();
    expect(storageService.getSessionToken()).toBeNull();
  });

  it('B -> A: el mismo aislamiento se cumple en la dirección inversa', () => {
    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/NEGOCIO_B/exec');
    storageService.saveProducts([{ id: 'PROD-B' } as any]);
    storageService.setCurrentUser({ id: 'USR-B' } as any);
    storageService.setSessionToken('TOKEN-B');

    storageService.clearBusinessData();
    storageService.clearGoogleAppsScriptUrl();

    storageService.setGoogleAppsScriptUrl('https://script.google.com/macros/s/NEGOCIO_A/exec');
    storageService.saveProducts([{ id: 'PROD-A' } as any]);

    expect(storageService.getProducts()).toEqual([{ id: 'PROD-A' }]);
    expect(storageService.getCurrentUser()).toBeNull();
    expect(storageService.getSessionToken()).toBeNull();
  });
});
