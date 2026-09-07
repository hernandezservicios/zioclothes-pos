import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DataStoreProvider, useDataStore } from './DataStoreContext';
import type { CustomerWithCredit } from '../services/customersApi';

/**
 * FIX POS -- CLIENTE NUEVO DEBE QUEDAR AUTOMÁTICAMENTE SELECCIONADO.
 *
 * Prueba dirigida, a nivel de DataStoreContext, de la causa raíz exacta:
 * `getCustomers()` lee `customersRef.current`, un espejo del estado
 * `customers` que -- antes de este fix -- solo se actualizaba dentro de un
 * `useEffect([customers])`. Ese efecto corre en un render POSTERIOR, nunca
 * antes de que la promesa de `refreshCustomers()` se resuelva. Un caller
 * como POSView.handleCreateQuickCustomer hace exactamente:
 *
 *   await refreshCustomers({ force: true });
 *   const created = getCustomers().find(c => c.id === nuevoId);
 *
 * en UN SOLO intento, sin reintentos -- si `getCustomers()` todavía
 * devuelve el arreglo viejo en ese instante, `created` es `undefined` y la
 * selección automática se pierde en silencio, para siempre (nada vuelve a
 * intentarlo).
 *
 * IMPORTANTE (por qué esta prueba NO usa `act()` ni `waitFor`): ambos
 * fuerzan a React a volcar los efectos pendientes antes de continuar, lo
 * que "arregla" la condición de carrera como efecto secundario del propio
 * arnés de pruebas -- enmascarando exactamente el bug que se quiere
 * demostrar. Se hace un `await` crudo sobre la misma promesa que usa el
 * código real, y se lee `getCustomers()` de inmediato, en el mismo punto
 * del microtask queue que usaría el navegador real.
 */

const { customersApiList } = vi.hoisted(() => ({ customersApiList: vi.fn() }));

vi.mock('../services/customersApi', async () => {
  const actual = await vi.importActual<typeof import('../services/customersApi')>('../services/customersApi');
  return {
    ...actual,
    customersApi: { list: customersApiList, save: vi.fn() },
  };
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DataStoreProvider>{children}</DataStoreProvider>
);

const newCustomer: CustomerWithCredit = {
  id: 'CLI-RACE-01',
  nombre: 'Recién',
  apellido: 'Creado',
  documento: '900-0000000-9',
  telefono: '809-000-0009',
  correo: '',
  direccion: '',
  ciudad: '',
  limiteCredito: 5000,
  diasCreditoPorDefecto: 30,
  estado: 'ACTIVO',
  fechaCreacion: '2026-01-01 00:00:00',
  saldoPendiente: 0,
  creditoDisponible: 5000,
};

describe('DataStoreContext -- getCustomers() debe reflejar refreshCustomers() de inmediato', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('justo después de "await refreshCustomers({force:true})", getCustomers() YA incluye el cliente nuevo -- en un solo intento, sin waitFor', async () => {
    customersApiList.mockResolvedValue({ success: true, data: [newCustomer] });

    const { result } = renderHook(() => useDataStore(), { wrapper });

    // Mismo patrón exacto que POSView.handleCreateQuickCustomer: un único
    // await, sin act() ni reintentos.
    await result.current.refreshCustomers({ force: true });

    const found = result.current.getCustomers().find((c) => c.id === 'CLI-RACE-01');
    expect(found).toBeDefined();
    expect(found?.nombre).toBe('Recién');
  });

  it('getCustomers() nunca debe ir más de una versión atrás: dos refrescos consecutivos (venta rápida creando 2 clientes seguidos)', async () => {
    customersApiList.mockResolvedValueOnce({ success: true, data: [newCustomer] });
    const { result } = renderHook(() => useDataStore(), { wrapper });

    await result.current.refreshCustomers({ force: true });
    expect(result.current.getCustomers().find((c) => c.id === 'CLI-RACE-01')).toBeDefined();

    const second: CustomerWithCredit = { ...newCustomer, id: 'CLI-RACE-02', nombre: 'Segundo' };
    customersApiList.mockResolvedValueOnce({ success: true, data: [newCustomer, second] });

    await result.current.refreshCustomers({ force: true });
    const found = result.current.getCustomers().find((c) => c.id === 'CLI-RACE-02');
    expect(found).toBeDefined();
    expect(found?.nombre).toBe('Segundo');
  });
});
