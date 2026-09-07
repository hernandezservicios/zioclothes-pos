import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiService } from './apiService';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 *
 * Ejercita `apiService.checkBackendConnection` TAL COMO ES -- la única
 * pieza nueva de transporte HTTP de esta fase. Reutiliza el `doGet` real
 * (Main.gs, sin modificar): estas pruebas mockean `global.fetch`
 * directamente (nunca el backend real -- no hay browser/POST autenticado
 * disponible en este entorno) para simular exactamente las formas de
 * respuesta que ese `doGet` real puede producir.
 */

const URL = 'https://script.google.com/macros/s/AKfycbyTEST/exec';

function mockFetchOnce(response: { ok?: boolean; text: () => Promise<string> }) {
  (global.fetch as any) = vi.fn().mockResolvedValue({
    ok: response.ok !== false,
    text: response.text,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiService.checkBackendConnection', () => {
  it('éxito: success=true, status=ONLINE, spreadsheetConnected=true -> conexión válida', async () => {
    mockFetchOnce({
      text: async () =>
        JSON.stringify({
          success: true,
          service: 'ZIO CLOTHES POS',
          version: '1.0',
          status: 'ONLINE',
          timezone: 'America/Santo_Domingo',
          currentTime: '2026-09-06 10:00:00',
          spreadsheetConnected: true,
          spreadsheetName: 'ZIO CLOTHES DB',
        }),
    });

    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(true);
    expect(res.data?.spreadsheetConnected).toBe(true);
    expect(res.data?.service).toBe('ZIO CLOTHES POS');
    expect(global.fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'GET' }));
  });

  it('error de red: fetch rechaza -> NETWORK_ERROR', async () => {
    (global.fetch as any) = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NETWORK_ERROR');
  });

  it('timeout: fetch rechaza con AbortError -> TIMEOUT_ERROR', async () => {
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    (global.fetch as any) = vi.fn().mockRejectedValue(abortError);
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('TIMEOUT_ERROR');
  });

  it('respuesta vacía -> DATA_FORMAT_ERROR', async () => {
    mockFetchOnce({ text: async () => '' });
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('DATA_FORMAT_ERROR');
  });

  it('respuesta no-JSON (ej. HTML de un error genérico) -> DATA_FORMAT_ERROR', async () => {
    mockFetchOnce({ text: async () => '<html><body>Not Found</body></html>' });
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('DATA_FORMAT_ERROR');
  });

  it('success=false en el JSON -> BACKEND_OFFLINE', async () => {
    mockFetchOnce({ text: async () => JSON.stringify({ success: false, status: 'ONLINE', spreadsheetConnected: true }) });
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('BACKEND_OFFLINE');
  });

  it('status !== "ONLINE" -> BACKEND_OFFLINE', async () => {
    mockFetchOnce({ text: async () => JSON.stringify({ success: true, status: 'DEGRADED', spreadsheetConnected: true }) });
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('BACKEND_OFFLINE');
  });

  it('spreadsheetConnected === false -> SPREADSHEET_DISCONNECTED', async () => {
    mockFetchOnce({ text: async () => JSON.stringify({ success: true, status: 'ONLINE', spreadsheetConnected: false }) });
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SPREADSHEET_DISCONNECTED');
  });

  it('spreadsheetConnected ausente del todo -> también se rechaza (nunca se asume conectado)', async () => {
    mockFetchOnce({ text: async () => JSON.stringify({ success: true, status: 'ONLINE' }) });
    const res = await apiService.checkBackendConnection(URL);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SPREADSHEET_DISCONNECTED');
  });
});
