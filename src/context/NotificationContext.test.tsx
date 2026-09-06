import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NotificationProvider, useNotifications } from './NotificationContext';
import { AccountReceivable, Product } from '../types';
import { apiService } from '../services/apiService';

/**
 * FASE — SISTEMA GLOBAL DE ALERTAS Y NOTIFICACIONES.
 *
 * Ejercita NotificationContext.tsx TAL COMO ES -- ninguna de sus reglas
 * de derivación se reescribe para la prueba. useDataStore()/useAuth() se
 * sustituyen (misma técnica que el resto del proyecto, ver
 * POSView.test.tsx) para controlar exactamente qué créditos/productos y
 * qué permisos ve el Context en cada escenario.
 */

const mockHasPermission = vi.fn((_perm?: string) => true);
let mockCredits: AccountReceivable[] = [];
let mockProducts: Product[] = [];

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, hasPermission: mockHasPermission }),
}));

vi.mock('./DataStoreContext', () => ({
  useDataStore: () => ({ credits: mockCredits, products: mockProducts }),
}));

vi.mock('../services/storageService', () => ({
  storageService: {
    getReadNotificationIds: vi.fn(() => []),
    saveReadNotificationIds: vi.fn(),
  },
}));

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}
function daysFromNowStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}

function makeCredit(overrides: Partial<AccountReceivable>): AccountReceivable {
  return {
    id: 'CRED-T01',
    numeroCredito: 'CRED-000001',
    clienteId: 'CLI-T01',
    clienteNombre: 'Juan Pérez',
    clienteDocumento: '001-0000000-1',
    clienteTelefono: '809-000-0000',
    ventaId: 'VEN-T01',
    numeroVenta: 'VEN-001023',
    montoOriginal: 5000,
    montoPagado: 0,
    saldoPendiente: 5000,
    fechaCreacion: daysAgoStr(20),
    fechaVencimiento: daysAgoStr(8),
    diasPlazo: 15,
    estado: 'PENDIENTE',
    creadoPor: 'USR-T01',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 'PROD-T01',
    sku: 'SKU-T01',
    codigoBarras: '7501234500001',
    nombre: 'iPhone 15',
    descripcion: '',
    categoriaId: 'CAT-T01',
    marca: 'Apple',
    costo: 30000,
    precio: 45000,
    impuesto: 18,
    stockMinimo: 5,
    estado: 'ACTIVO',
    fechaCreacion: '2026-01-01 00:00:00',
    variantes: [
      {
        id: 'VAR-T01',
        productoId: 'PROD-T01',
        sku: 'SKU-T01-U',
        codigoBarras: '7501234500001',
        color: 'Negro',
        talla: 'U',
        costo: 30000,
        precio: 45000,
        stock: 2,
        estado: 'ACTIVO',
      },
    ],
    ...overrides,
  };
}

function Harness() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  return (
    <div>
      <div data-testid="unread-count">{unreadCount}</div>
      <ul>
        {notifications.map((n) => (
          <li key={n.id} data-testid={`notif-${n.id}`}>
            {n.titulo}: {n.mensaje} [{n.read ? 'read' : 'unread'}]
          </li>
        ))}
      </ul>
      <button onClick={() => notifications[0] && markAsRead(notifications[0].id)}>mark-first</button>
      <button onClick={markAllAsRead}>mark-all</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <NotificationProvider>
      <Harness />
    </NotificationProvider>
  );
}

beforeEach(() => {
  mockHasPermission.mockReturnValue(true);
  mockCredits = [];
  mockProducts = [];
  vi.clearAllMocks();
  mockHasPermission.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
});

describe('NotificationContext -- Créditos vencidos / Ventas pendientes', () => {
  it('TEST 3: crédito vencido genera notificación CREDITO_VENCIDO', () => {
    mockCredits = [makeCredit({ id: 'CRED-A', fechaVencimiento: daysAgoStr(8), saldoPendiente: 12500 })];
    renderHarness();
    expect(screen.getByTestId('notif-CREDITO_VENCIDO:CRED-A')).toBeInTheDocument();
    expect(screen.getByTestId('notif-CREDITO_VENCIDO:CRED-A').textContent).toContain('Juan Pérez');
    expect(screen.getByTestId('notif-CREDITO_VENCIDO:CRED-A').textContent).toContain('12,500.00');
  });

  it('TEST 4: crédito no vencido (fecha futura) NO genera notificación de vencido', () => {
    mockCredits = [makeCredit({ id: 'CRED-B', fechaVencimiento: daysFromNowStr(5) })];
    renderHarness();
    expect(screen.queryByTestId('notif-CREDITO_VENCIDO:CRED-B')).not.toBeInTheDocument();
  });

  it('TEST 5: cuenta saldada (PAGADA) NO genera notificación de vencido aunque la fecha ya haya pasado', () => {
    mockCredits = [makeCredit({ id: 'CRED-C', estado: 'PAGADA', saldoPendiente: 0, fechaVencimiento: daysAgoStr(30) })];
    renderHarness();
    expect(screen.queryByTestId('notif-CREDITO_VENCIDO:CRED-C')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notif-VENTA_PENDIENTE:CRED-C')).not.toBeInTheDocument();
  });

  it('TEST 6: venta con saldo pendiente y fecha aún no vencida genera notificación VENTA_PENDIENTE', () => {
    mockCredits = [makeCredit({ id: 'CRED-D', fechaVencimiento: daysFromNowStr(5), saldoPendiente: 5000, numeroVenta: 'VEN-1023' })];
    renderHarness();
    const el = screen.getByTestId('notif-VENTA_PENDIENTE:CRED-D');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('VEN-1023');
  });

  it('TEST 7: venta pagada (estado PAGADA) NO genera notificación pendiente', () => {
    mockCredits = [makeCredit({ id: 'CRED-E', estado: 'PAGADA', saldoPendiente: 0, fechaVencimiento: daysFromNowStr(5) })];
    renderHarness();
    expect(screen.queryByTestId('notif-VENTA_PENDIENTE:CRED-E')).not.toBeInTheDocument();
  });

  it('TEST 8: cuenta anulada (ANULADA) NO genera ninguna notificación', () => {
    mockCredits = [makeCredit({ id: 'CRED-F', estado: 'ANULADA', saldoPendiente: 5000, fechaVencimiento: daysAgoStr(10) })];
    renderHarness();
    expect(screen.queryByTestId('notif-CREDITO_VENCIDO:CRED-F')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notif-VENTA_PENDIENTE:CRED-F')).not.toBeInTheDocument();
  });
});

describe('NotificationContext -- Stock bajo', () => {
  it('TEST 9: stock <= stock_minimo genera alerta STOCK_BAJO', () => {
    mockProducts = [makeProduct({ id: 'PROD-A', stockMinimo: 5, variantes: [{ id: 'VAR-A', productoId: 'PROD-A', sku: 'S', codigoBarras: 'B', color: 'Negro', talla: 'U', costo: 1, precio: 1, stock: 2, estado: 'ACTIVO' }] })];
    renderHarness();
    expect(screen.getByTestId('notif-STOCK_BAJO:VAR-A')).toBeInTheDocument();
  });

  it('TEST 10: stock > stock_minimo NO genera alerta', () => {
    mockProducts = [makeProduct({ id: 'PROD-B', stockMinimo: 5, variantes: [{ id: 'VAR-B', productoId: 'PROD-B', sku: 'S', codigoBarras: 'B', color: 'Negro', talla: 'U', costo: 1, precio: 1, stock: 20, estado: 'ACTIVO' }] })];
    renderHarness();
    expect(screen.queryByTestId('notif-STOCK_BAJO:VAR-B')).not.toBeInTheDocument();
  });

  it('TEST 11: variantes INACTIVAS no generan alerta de stock aunque su stock sea 0', () => {
    mockProducts = [makeProduct({ id: 'PROD-C', stockMinimo: 5, variantes: [{ id: 'VAR-C', productoId: 'PROD-C', sku: 'S', codigoBarras: 'B', color: 'Negro', talla: 'U', costo: 1, precio: 1, stock: 0, estado: 'INACTIVO' }] })];
    renderHarness();
    expect(screen.queryByTestId('notif-STOCK_BAJO:VAR-C')).not.toBeInTheDocument();
  });
});

describe('NotificationContext -- deduplicación y actualización', () => {
  it('TEST 12: la misma entidad nunca genera notificaciones duplicadas', () => {
    mockCredits = [makeCredit({ id: 'CRED-DUP', fechaVencimiento: daysAgoStr(3) })];
    mockProducts = [makeProduct({ id: 'PROD-DUP' })];
    const { rerender } = renderHarness();
    // Re-renderiza varias veces con los MISMOS datos (misma referencia) --
    // simula cambios de pantalla / renders de React / abrir-cerrar Navbar.
    for (let i = 0; i < 5; i++) {
      rerender(
        <NotificationProvider>
          <Harness />
        </NotificationProvider>
      );
    }
    const items = screen.getAllByRole('listitem');
    const ids = items.map((el) => el.getAttribute('data-testid'));
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('TEST 19: cuando los datos cambian (crédito saldado), la notificación desaparece', () => {
    mockCredits = [makeCredit({ id: 'CRED-G', fechaVencimiento: daysAgoStr(3), estado: 'PENDIENTE', saldoPendiente: 3000 })];
    const { rerender } = renderHarness();
    expect(screen.getByTestId('notif-CREDITO_VENCIDO:CRED-G')).toBeInTheDocument();

    // El cliente pagó -- DataStore ahora refleja la cuenta saldada.
    mockCredits = [makeCredit({ id: 'CRED-G', fechaVencimiento: daysAgoStr(3), estado: 'PAGADA', saldoPendiente: 0 })];
    rerender(
      <NotificationProvider>
        <Harness />
      </NotificationProvider>
    );
    expect(screen.queryByTestId('notif-CREDITO_VENCIDO:CRED-G')).not.toBeInTheDocument();
  });

  it('TEST 20: el sistema nunca dispara peticiones de red propias, ni siquiera con múltiples renders', async () => {
    const spy = vi.spyOn(apiService, 'syncWithGoogleAppsScript');
    mockCredits = [makeCredit({ id: 'CRED-H', fechaVencimiento: daysAgoStr(1) })];
    mockProducts = [makeProduct({ id: 'PROD-H' })];
    const { rerender } = renderHarness();
    for (let i = 0; i < 10; i++) {
      rerender(
        <NotificationProvider>
          <Harness />
        </NotificationProvider>
      );
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('NotificationContext -- marcar como leída', () => {
  it('TEST 13: marcar una notificación como leída actualiza el contador', () => {
    mockCredits = [makeCredit({ id: 'CRED-I', fechaVencimiento: daysAgoStr(2) })];
    renderHarness();
    expect(screen.getByTestId('unread-count').textContent).toBe('1');
    fireEvent.click(screen.getByText('mark-first'));
    expect(screen.getByTestId('unread-count').textContent).toBe('0');
    expect(screen.getByTestId('notif-CREDITO_VENCIDO:CRED-I').textContent).toContain('[read]');
  });

  it('TEST 14: "Marcar todas como leídas" deja el contador en cero', () => {
    mockCredits = [
      makeCredit({ id: 'CRED-J1', fechaVencimiento: daysAgoStr(2) }),
      makeCredit({ id: 'CRED-J2', fechaVencimiento: daysAgoStr(3) }),
    ];
    mockProducts = [makeProduct({ id: 'PROD-J' })];
    renderHarness();
    expect(Number(screen.getByTestId('unread-count').textContent)).toBeGreaterThan(1);
    fireEvent.click(screen.getByText('mark-all'));
    expect(screen.getByTestId('unread-count').textContent).toBe('0');
  });

  it('leída no equivale a resuelta: un crédito marcado como leído sigue apareciendo en la lista, solo cambia su estado de lectura', () => {
    mockCredits = [makeCredit({ id: 'CRED-K', fechaVencimiento: daysAgoStr(2) })];
    renderHarness();
    fireEvent.click(screen.getByText('mark-first'));
    // Sigue en la lista (el crédito SIGUE vencido -- la condición de negocio no cambió).
    expect(screen.getByTestId('notif-CREDITO_VENCIDO:CRED-K')).toBeInTheDocument();
  });
});

describe('NotificationContext -- permisos', () => {
  it('oculta notificaciones de créditos vencidos si el usuario no tiene creditos.ver_vencidas', () => {
    mockHasPermission.mockImplementation((perm: string) => perm !== 'creditos.ver_vencidas');
    mockCredits = [makeCredit({ id: 'CRED-L', fechaVencimiento: daysAgoStr(5) })];
    renderHarness();
    expect(screen.queryByTestId('notif-CREDITO_VENCIDO:CRED-L')).not.toBeInTheDocument();
  });

  it('oculta notificaciones de stock bajo si el usuario no tiene inventario.ver', () => {
    mockHasPermission.mockImplementation((perm: string) => perm !== 'inventario.ver');
    mockProducts = [makeProduct({ id: 'PROD-M' })];
    renderHarness();
    expect(screen.queryByTestId('notif-STOCK_BAJO:VAR-T01')).not.toBeInTheDocument();
  });
});
