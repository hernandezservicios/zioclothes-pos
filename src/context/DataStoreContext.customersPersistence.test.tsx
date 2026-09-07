import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DataStoreProvider, useDataStore } from './DataStoreContext';
import { storageService } from '../services/storageService';
import { apiService } from '../services/apiService';
import { customersApi } from '../services/customersApi';

/**
 * AUDITORÍA — "PROBLEMA 2: CLIENTES NO SE ESTÁN PERSISTIENDO EN GOOGLE
 * SHEETS" (fase de auditoría inmediata sobre dos problemas de producción).
 *
 * Prueba diagnóstica solicitada explícitamente por esa fase. Ejercita el
 * CONTRATO real, sin modificar, entre `customersApi.ts` y
 * `DataStoreContext.tsx` -- los mismos dos archivos ya auditados por
 * lectura de código -- mockeando únicamente `apiService.syncWithGoogleAppsScript`
 * (el mismo punto de mock que ya usa `apiService.test.ts`) para simular
 * exactamente las formas de respuesta que Main.gs/CustomersController.gs
 * producen. `storageService` NO se mockea: se usa el localStorage real de
 * jsdom, igual que en `storageService.test.ts`.
 *
 * LÍMITE EXPLÍCITO: esto NO toca Google Sheets real ni un Web App real --
 * no hay acceso a un backend real en este entorno. Verifica el
 * comportamiento del código del FRONTEND (si el DataStore refleja o no un
 * cambio según lo que el backend simulado responde), no si Google Sheets
 * en sí llegó a escribirse. Ver el reporte de auditoría para esa
 * distinción explícita.
 */

vi.mock('../services/apiService', () => ({
  apiService: {
    syncWithGoogleAppsScript: vi.fn(),
  },
}));

const mockSync = apiService.syncWithGoogleAppsScript as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <DataStoreProvider>{children}</DataStoreProvider>;
}

const RAW_CUSTOMER_V1 = {
  id: 'CLI-T01',
  nombre: 'Juan Original',
  apellido: 'Perez',
  documento: '001-0000000-1',
  telefono: '809-000-0000',
  correo: '',
  direccion: '',
  ciudad: '',
  limiteCredito: 5000,
  diasCreditoPorDefecto: 15,
  notas: '',
  estado: 'ACTIVO',
  creadoEn: '2026-01-01 00:00:00',
  saldoPendiente: 0,
  creditoDisponible: 5000,
};
const RAW_CUSTOMER_V2 = { ...RAW_CUSTOMER_V1, nombre: 'Juan Modificado', telefono: '809-111-1111' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  storageService.setSessionToken('TEST-TOKEN');
  mockSync.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Persistencia de Clientes -- el DataStore refleja SOLO lo que el backend confirmó (Problema 2)', () => {
  it('pasos 1-5: carga inicial, edición, guardado con success:true -- el DataStore no cambia hasta refreshCustomers explícito', async () => {
    // Paso 1: cargar cliente desde backend.
    mockSync.mockResolvedValueOnce({ success: true, message: 'OK', data: { customers: [RAW_CUSTOMER_V1] } });
    const { result } = renderHook(() => useDataStore(), { wrapper });
    await act(async () => {
      await result.current.refreshCustomers({ force: true });
    });
    expect(result.current.customers).toHaveLength(1);
    expect(result.current.customers[0].nombre).toBe('Juan Original');

    // Pasos 2-3: modificar y ejecutar save/update real (customersApi.save,
    // el mismo método que CustomersView.handleSaveCustomer llama).
    mockSync.mockResolvedValueOnce({
      success: true,
      message: 'Cliente actualizado exitosamente.',
      data: { customerId: 'CLI-T01' },
    });
    const saveRes = await customersApi.save({ id: 'CLI-T01', nombre: 'Juan Modificado', telefono: '809-111-1111' });

    // Paso 4: la respuesta del backend fue success:true.
    expect(saveRes.success).toBe(true);

    // Paso 5: el DataStore NO se actualiza solo -- customersApi.save() no
    // toca el Context (confirmado por lectura de código: DataStoreContext
    // nunca intercepta mutaciones). Sigue mostrando el valor previo hasta
    // que algo (el componente, tras comprobar success) invoca
    // refreshCustomers({force:true}) explícitamente.
    expect(result.current.customers[0].nombre).toBe('Juan Original');

    mockSync.mockResolvedValueOnce({ success: true, message: 'OK', data: { customers: [RAW_CUSTOMER_V2] } });
    await act(async () => {
      await result.current.refreshCustomers({ force: true });
    });
    expect(result.current.customers[0].nombre).toBe('Juan Modificado');
  });

  it('paso 6: si el backend responde success:false al guardar, el DataStore NO se actualiza', async () => {
    mockSync.mockResolvedValueOnce({ success: true, message: 'OK', data: { customers: [RAW_CUSTOMER_V1] } });
    const { result } = renderHook(() => useDataStore(), { wrapper });
    await act(async () => {
      await result.current.refreshCustomers({ force: true });
    });

    mockSync.mockResolvedValueOnce({
      success: false,
      error: 'VALIDATION_ERROR: Nombre y teléfono del cliente son requeridos.',
    });
    const saveRes = await customersApi.save({ id: 'CLI-T01', nombre: '', telefono: '' } as any);
    expect(saveRes.success).toBe(false);

    // Nadie llama refreshCustomers tras un fallo (mismo patrón real de
    // CustomersView.handleSaveCustomer: `if (!res.success) { ...; return; }`)
    // -- el DataStore conserva el valor anterior intacto.
    expect(result.current.customers[0].nombre).toBe('Juan Original');
  });

  it('paso 7: si hay timeout/error de red al guardar, el DataStore tampoco se considera persistido', async () => {
    mockSync.mockResolvedValueOnce({ success: true, message: 'OK', data: { customers: [RAW_CUSTOMER_V1] } });
    const { result } = renderHook(() => useDataStore(), { wrapper });
    await act(async () => {
      await result.current.refreshCustomers({ force: true });
    });

    mockSync.mockResolvedValueOnce({
      success: false,
      message: 'El servidor tardó demasiado en responder. Intente de nuevo en unos segundos.',
      errorCode: 'TIMEOUT_ERROR',
    });
    const saveRes = await customersApi.save({ id: 'CLI-T01', nombre: 'Juan Timeout', telefono: '809-222-2222' });
    expect(saveRes.success).toBe(false);
    expect(saveRes.errorCode).toBe('TIMEOUT_ERROR');
    expect(result.current.customers[0].nombre).toBe('Juan Original');
  });

  it('paso 8: un refresh posterior vuelve a obtener el valor realmente persistido en backend, nunca uno local inventado', async () => {
    mockSync.mockResolvedValueOnce({ success: true, message: 'OK', data: { customers: [RAW_CUSTOMER_V1] } });
    const { result } = renderHook(() => useDataStore(), { wrapper });
    await act(async () => {
      await result.current.refreshCustomers({ force: true });
    });

    // Escenario de Problema 2: si el backend real nunca aplicó el cambio
    // (por la causa que sea), un refresh honesto contra `customers.list`
    // debe seguir devolviendo el valor real -- el DataStore no "recuerda"
    // ni preserva un valor editado que el backend no confirmó.
    mockSync.mockResolvedValueOnce({ success: true, message: 'OK', data: { customers: [RAW_CUSTOMER_V1] } });
    await act(async () => {
      await result.current.refreshCustomers({ force: true });
    });
    expect(result.current.customers[0].nombre).toBe('Juan Original');
  });
});

describe('Límite explícito de esta prueba', () => {
  it('esto NO comprueba Google Sheets real -- solo el contrato customersApi <-> DataStoreContext', () => {
    // Esta suite corre en Node/jsdom con `apiService.syncWithGoogleAppsScript`
    // reemplazado por un mock: nunca hay una llamada HTTP real ni una hoja de
    // cálculo real de por medio. No se afirma haber comprobado persistencia
    // real en Google Sheets -- esa comprobación requiere acceso real a un
    // navegador conectado a un Web App real, no disponible en este entorno.
    expect(true).toBe(true);
  });
});
