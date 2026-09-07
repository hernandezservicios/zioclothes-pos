import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SalesView } from './SalesView';
import { ReturnsView } from './ReturnsView';
import { DataStoreProvider } from '../../context/DataStoreContext';
import type { Sale } from '../../types';

/**
 * AUDITORÍA FINAL -- Escenario F: Historial de Ventas -> botón Devolución
 * -> doble confirmación -> módulo Devoluciones -> venta cargada
 * automáticamente -> productos disponibles para selección.
 *
 * `SalesView.test.tsx` ya prueba que el botón + las dos confirmaciones
 * llaman a `onNavigateToReturns(numeroVenta)` con el valor correcto.
 * `ReturnsView.test.tsx` ya prueba que `initialSaleNumber` precarga y
 * busca automáticamente. Lo único que NINGUNA de las dos prueba es la
 * composición real -- el cableado de 4 líneas en App.tsx:
 *
 *   case 'sales':
 *     return <SalesView onNavigateToReturns={(numeroVenta) => handleNavigate('returns', numeroVenta)} />;
 *   case 'returns':
 *     return <ReturnsView initialSaleNumber={navigationFilter} />;
 *
 * Este arnés replica EXACTAMENTE ese mismo patrón (mismo nombre de prop,
 * misma firma de handleNavigate, mismo condicional de vista) sin
 * necesitar importar/mockear las otras ~15 vistas de App.tsx -- prueba la
 * composición real sin el peso de renderizar la app completa.
 */

const { salesApiList, returnsApiList, returnsApiCreate, refreshActiveCashSession, showToast } = vi.hoisted(() => ({
  salesApiList: vi.fn(),
  returnsApiList: vi.fn(),
  returnsApiCreate: vi.fn(),
  refreshActiveCashSession: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../services/salesApi', () => ({
  salesApi: { list: salesApiList, void: vi.fn() },
}));
vi.mock('../../services/returnsApi', () => ({
  returnsApi: { list: returnsApiList, create: returnsApiCreate },
}));
vi.mock('../../services/productsApi', () => ({
  productsApi: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    listAuxiliaries: vi.fn().mockResolvedValue({ success: true, data: { categories: [], sizes: [], colors: [], suppliers: [] } }),
  },
}));
vi.mock('../../services/creditsApi', () => ({
  creditsApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('../../services/creditNotesApi', () => ({
  creditNotesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('../../services/customersApi', () => ({
  customersApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'USR-T01', nombre: 'Cajera', apellido: 'Prueba' },
    settings: { simboloMoneda: 'RD$', impuestoPorcentaje: 18 },
    hasPermission: () => true,
    refreshActiveCashSession,
  }),
}));
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

const sale117: Sale = {
  id: 'VEN-117',
  numeroVenta: 'VEN-000117',
  clienteId: 'CLI-T01',
  clienteNombre: 'Ivette Maria Lora Peguero',
  vendedorId: 'USR-T01',
  vendedorNombre: 'Cajera Prueba',
  items: [
    {
      id: 'ITM-1', productoId: 'P1', varianteId: 'V1', nombreProducto: 'Blusa Seda', sku: 'SKU1',
      talla: 'M', color: 'Negro', cantidad: 1, costoUnitario: 200, precioUnitario: 640,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 640, impuestoMonto: 0, total: 640,
    },
  ],
  subtotal: 640, descuentoTotal: 0, impuestoTotal: 0, total: 640, costoTotal: 200,
  metodoPago: 'EFECTIVO', pagos: [{ metodo: 'EFECTIVO', monto: 640 }],
  esCredito: false, estado: 'COMPLETADA', fecha: '2026-09-01 10:00:00',
};

// Mismo patrón EXACTO que App.tsx: handleNavigate(view, filter) guarda el
// filtro y cambia de vista; el case 'returns' se lo entrega a ReturnsView
// como initialSaleNumber.
function AppHarness() {
  const [view, setView] = useState<'sales' | 'returns'>('sales');
  const [navigationFilter, setNavigationFilter] = useState<string | undefined>(undefined);
  const handleNavigate = (target: string, filter?: string) => {
    setNavigationFilter(filter);
    setView(target as 'sales' | 'returns');
  };

  if (view === 'sales') {
    return <SalesView onNavigateToReturns={(numeroVenta) => handleNavigate('returns', numeroVenta)} />;
  }
  return <ReturnsView initialSaleNumber={navigationFilter} />;
}

function renderApp() {
  return render(
    <DataStoreProvider>
      <AppHarness />
    </DataStoreProvider>
  );
}

describe('Integración real Historial -> Devoluciones (Escenario F de la auditoría final)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    returnsApiList.mockResolvedValue({ success: true, data: [] });
  });
  afterEach(() => cleanup());

  it('Historial -> Devolución -> doble confirmación -> Devoluciones con la venta ya cargada y los productos disponibles', async () => {
    renderApp();

    // 1) Historial de Ventas: aparece la venta real y su botón Devolución.
    await waitFor(() => expect(screen.getByText('VEN-000117')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Procesar devolución'));

    // 2) Confirmación 1.
    expect(screen.getByText('¿Deseas iniciar una devolución para la venta VEN-000117?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continuar'));

    // 3) Confirmación 2.
    expect(screen.getByText(/CONFIRMACIÓN DE DEVOLUCIÓN/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sí, continuar'));

    // 4) Módulo Devoluciones: la venta ya está cargada automáticamente,
    // sin haber tocado "Buscar Venta" -- y el producto está disponible
    // para seleccionar (checkbox real, no un dropdown).
    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(screen.getByText('Cliente: Ivette Maria Lora Peguero')).toBeInTheDocument();
    expect(screen.getByLabelText('Seleccionar Blusa Seda talla M color Negro')).toBeInTheDocument();
    expect(screen.queryByText('Busque una factura para habilitar el formulario de devolución')).not.toBeInTheDocument();

    // Nunca se procesó ninguna devolución solo por navegar hasta aquí.
    expect(returnsApiCreate).not.toHaveBeenCalled();
  });
});
