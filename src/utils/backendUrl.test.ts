import { describe, it, expect } from 'vitest';
import { normalizeAppsScriptUrl } from './backendUrl';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN, Requisito 3/9.
 */

describe('normalizeAppsScriptUrl', () => {
  it('acepta una URL válida de Web App tal cual', () => {
    expect(normalizeAppsScriptUrl('https://script.google.com/macros/s/AKfycbyABC123/exec')).toBe(
      'https://script.google.com/macros/s/AKfycbyABC123/exec'
    );
  });

  it('recorta espacios al inicio/fin', () => {
    expect(normalizeAppsScriptUrl('   https://script.google.com/macros/s/AKfycbyABC123/exec   ')).toBe(
      'https://script.google.com/macros/s/AKfycbyABC123/exec'
    );
  });

  it('recorta una barra final sobrante (/exec/)', () => {
    expect(normalizeAppsScriptUrl('https://script.google.com/macros/s/AKfycbyABC123/exec/')).toBe(
      'https://script.google.com/macros/s/AKfycbyABC123/exec'
    );
  });

  it('rechaza cadena vacía', () => {
    expect(normalizeAppsScriptUrl('')).toBeNull();
  });

  it('rechaza solo espacios', () => {
    expect(normalizeAppsScriptUrl('   ')).toBeNull();
  });

  it('rechaza una URL que no es de Apps Script', () => {
    expect(normalizeAppsScriptUrl('https://example.com/macros/s/ABC/exec')).toBeNull();
  });

  it('rechaza http (no https)', () => {
    expect(normalizeAppsScriptUrl('http://script.google.com/macros/s/ABC/exec')).toBeNull();
  });

  it('rechaza la URL del editor (/d/<id>/edit)', () => {
    expect(normalizeAppsScriptUrl('https://script.google.com/d/AKfycbyABC123/edit')).toBeNull();
  });

  it('rechaza una URL incompleta (sin ID de despliegue)', () => {
    expect(normalizeAppsScriptUrl('https://script.google.com/macros/s//exec')).toBeNull();
  });

  it('rechaza una URL que no termina en /exec', () => {
    expect(normalizeAppsScriptUrl('https://script.google.com/macros/s/ABC123/dev')).toBeNull();
  });

  it('rechaza texto que no es una URL en absoluto', () => {
    expect(normalizeAppsScriptUrl('no es una url')).toBeNull();
  });

  it('rechaza tipos no-string de forma segura (nunca lanza)', () => {
    expect(normalizeAppsScriptUrl(undefined as any)).toBeNull();
    expect(normalizeAppsScriptUrl(null as any)).toBeNull();
  });
});
