import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NotificationBell } from './NotificationBell';
import { AppNotification } from '../../types';

/**
 * FASE — SISTEMA GLOBAL DE ALERTAS Y NOTIFICACIONES.
 *
 * Ejercita NotificationBell.tsx TAL COMO ES -- solo se sustituye
 * useNotifications() (la fuente central, ya probada exhaustivamente por
 * separado en NotificationContext.test.tsx) para controlar exactamente
 * qué lista/contador ve el componente en cada escenario.
 */

const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
let mockNotifications: AppNotification[] = [];
let mockUnreadCount = 0;

vi.mock('../../context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: mockUnreadCount,
    markAsRead,
    markAllAsRead,
  }),
}));

function makeNotification(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: 'CREDITO_VENCIDO:CRED-T01',
    tipo: 'CREDITO_VENCIDO',
    titulo: 'Crédito vencido',
    mensaje: 'Juan Pérez tiene RD$ 12,500.00 pendientes vencidos.',
    severidad: 'error',
    createdAt: new Date().toISOString(),
    read: false,
    targetView: 'credits',
    navigationFilter: 'VENCIDA',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNotifications = [];
  mockUnreadCount = 0;
});
afterEach(() => {
  cleanup();
});

describe('NotificationBell -- campanita y contador', () => {
  it('no muestra contador cuando no hay notificaciones sin leer', () => {
    mockNotifications = [];
    mockUnreadCount = 0;
    render(<NotificationBell onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('muestra el número real de notificaciones sin leer', () => {
    mockUnreadCount = 3;
    render(<NotificationBell onNavigate={vi.fn()} />);
    expect(screen.getByTestId('notification-badge').textContent).toBe('3');
  });

  it('muestra "99+" cuando hay más de 99 notificaciones sin leer', () => {
    mockUnreadCount = 150;
    render(<NotificationBell onNavigate={vi.fn()} />);
    expect(screen.getByTestId('notification-badge').textContent).toBe('99+');
  });
});

describe('NotificationBell -- panel y estado vacío', () => {
  it('TEST 18: estado vacío muestra "Todo está al día" / "No tienes notificaciones pendientes."', () => {
    mockNotifications = [];
    render(<NotificationBell onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    expect(screen.getByText('Todo está al día')).toBeInTheDocument();
    expect(screen.getByText('No tienes notificaciones pendientes.')).toBeInTheDocument();
  });

  it('abre y cierra el panel al hacer clic en la campanita', () => {
    mockNotifications = [makeNotification({})];
    render(<NotificationBell onNavigate={vi.fn()} />);
    expect(screen.queryByText('Notificaciones')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Notificaciones'));
    expect(screen.getByText('Notificaciones')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Notificaciones'));
    expect(screen.queryByText('Notificaciones')).not.toBeInTheDocument();
  });
});

describe('NotificationBell -- navegación al hacer clic en una notificación', () => {
  it('TEST 15: click en crédito vencido navega a Cuentas por Cobrar con el filtro VENCIDA', () => {
    const onNavigate = vi.fn();
    mockNotifications = [makeNotification({ id: 'CREDITO_VENCIDO:CRED-X', targetView: 'credits', navigationFilter: 'VENCIDA' })];
    mockUnreadCount = 1;
    render(<NotificationBell onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    fireEvent.click(screen.getByText('Crédito vencido'));

    expect(onNavigate).toHaveBeenCalledWith('credits', 'VENCIDA');
    expect(markAsRead).toHaveBeenCalledWith('CREDITO_VENCIDO:CRED-X');
    // Cierra el panel al navegar.
    expect(screen.queryByText('Notificaciones')).not.toBeInTheDocument();
  });

  it('TEST 16: click en venta pendiente navega a Créditos con el filtro correspondiente', () => {
    const onNavigate = vi.fn();
    mockNotifications = [
      makeNotification({
        id: 'VENTA_PENDIENTE:CRED-Y',
        tipo: 'VENTA_PENDIENTE',
        titulo: 'Venta pendiente',
        mensaje: 'Venta VEN-1023 tiene RD$ 5,000.00 pendientes de pago.',
        severidad: 'advertencia',
        targetView: 'credits',
        navigationFilter: 'PENDIENTE',
      }),
    ];
    mockUnreadCount = 1;
    render(<NotificationBell onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    fireEvent.click(screen.getByText('Venta pendiente'));

    expect(onNavigate).toHaveBeenCalledWith('credits', 'PENDIENTE');
  });

  it('TEST 17: click en stock bajo navega a Inventario con el filtro STOCK_BAJO', () => {
    const onNavigate = vi.fn();
    mockNotifications = [
      makeNotification({
        id: 'STOCK_BAJO:VAR-Z',
        tipo: 'STOCK_BAJO',
        titulo: 'Stock bajo',
        mensaje: 'iPhone 15 — Negro tiene 2 unidad(es) disponibles.',
        severidad: 'advertencia',
        targetView: 'inventory',
        navigationFilter: 'STOCK_BAJO',
      }),
    ];
    mockUnreadCount = 1;
    render(<NotificationBell onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    fireEvent.click(screen.getByText('Stock bajo'));

    expect(onNavigate).toHaveBeenCalledWith('inventory', 'STOCK_BAJO');
  });
});

describe('NotificationBell -- marcar como leída desde el panel', () => {
  it('el botón individual de marcar leída no navega (stopPropagation)', () => {
    const onNavigate = vi.fn();
    mockNotifications = [makeNotification({ id: 'CREDITO_VENCIDO:CRED-W' })];
    mockUnreadCount = 1;
    render(<NotificationBell onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    fireEvent.click(screen.getByLabelText('Marcar como leída: Crédito vencido'));

    expect(markAsRead).toHaveBeenCalledWith('CREDITO_VENCIDO:CRED-W');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('"Marcar todas" solo aparece cuando hay notificaciones sin leer, y llama a markAllAsRead', () => {
    mockNotifications = [makeNotification({})];
    mockUnreadCount = 1;
    render(<NotificationBell onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    fireEvent.click(screen.getByText('Marcar todas'));
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('no muestra "Marcar todas" cuando no hay notificaciones sin leer', () => {
    mockNotifications = [makeNotification({ read: true })];
    mockUnreadCount = 0;
    render(<NotificationBell onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Notificaciones'));
    expect(screen.queryByText('Marcar todas')).not.toBeInTheDocument();
  });
});
