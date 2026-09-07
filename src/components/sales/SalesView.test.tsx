import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SalesView } from './SalesView';
import { formatCurrency } from '../../utils/formatters';
import type { Sale } from '../../types';

/**
 * MEJORA POS -- DEVOLUCIÓN DIRECTA DESDE HISTORIAL DE VENTAS.
 *
 * Ejercita SalesView.tsx TAL COMO ES -- Ver/Imprimir/Anular no se
 * modifican, solo se agrega el botón "Devolución" y su doble
 * confirmación. useAuth/useDataStore/useToast/salesApi se sustituyen por
 * dobles de prueba controlados; todo lo demás es el código real.
 */

const { showToast, salesApiVoid, refreshSales, refreshProducts, refreshCredits, refreshCustomers, refreshReturns } = vi.hoisted(() => ({
  showToast: vi.fn(),
  salesApiVoid: vi.fn(),
  refreshSales: vi.fn(),
  refreshProducts: vi.fn(),
  refreshCredits: vi.fn(),
  refreshCustomers: vi.fn(),
  refreshReturns: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    settings: { simboloMoneda: 'RD$', impuestoPorcentaje: 18 },
    hasPermission: () => true,
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../services/salesApi', () => ({
  salesApi: { void: salesApiVoid },
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
      id: 'ITM-1',
      productoId: 'P1',
      varianteId: 'V1',
      nombreProducto: 'Blusa Seda',
      sku: 'SKU1',
      talla: 'M',
      color: 'Negro',
      cantidad: 1,
      costoUnitario: 200,
      precioUnitario: 640,
      descuentoPorcentaje: 0,
      descuentoMonto: 0,
      subtotal: 640,
      impuestoMonto: 0,
      total: 640,
    },
  ],
  subtotal: 640,
  descuentoTotal: 0,
  impuestoTotal: 0,
  total: 640,
  costoTotal: 200,
  metodoPago: 'EFECTIVO',
  pagos: [{ metodo: 'EFECTIVO', monto: 640 }],
  esCredito: false,
  estado: 'COMPLETADA',
  fecha: '2026-09-01 10:00:00',
};

const saleConsumidorFinal: Sale = {
  ...sale117,
  id: 'VEN-112',
  numeroVenta: 'VEN-000112',
  clienteId: undefined,
  clienteNombre: 'Consumidor Final',
  total: 5400,
  subtotal: 5400,
};

const saleAnulada: Sale = { ...sale117, id: 'VEN-099', numeroVenta: 'VEN-000099', estado: 'ANULADA' };

let mockSales: Sale[] = [];
let mockReturns: import('../../types').ReturnRecord[] = [];

vi.mock('../../context/DataStoreContext', () => ({
  useDataStore: () => ({
    sales: mockSales,
    salesLoading: false,
    salesError: null,
    salesStale: false,
    refreshSales,
    refreshProducts,
    refreshCredits,
    refreshCustomers,
    // FASE -- Historial de Movimientos dentro del Detalle de Venta:
    // SalesView ahora también lee `returns` del DataStore.
    returns: mockReturns,
    refreshReturns,
  }),
}));

const returnButtons = () => screen.getAllByLabelText('Procesar devolución');

// El nombre del cliente y el número de venta también aparecen en la fila
// de la tabla detrás del modal -- se acota la búsqueda al contenedor de
// la Confirmación 1 para evitar ambigüedad.
const confirm1Modal = () => screen.getByText(/¿Deseas iniciar una devolución/).closest('.space-y-4') as HTMLElement;

describe('SalesView -- devolución directa desde Historial (botón + doble confirmación)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSales = [sale117, saleConsumidorFinal, saleAnulada];
    mockReturns = [];
  });
  afterEach(() => cleanup());

  // TEST 1
  it('el botón Devolución aparece en cada venta elegible (no ANULADA)', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    // 2 elegibles (117, 112) -- la ANULADA (099) no debe tener el botón.
    expect(returnButtons()).toHaveLength(2);
  });

  // TEST 2
  it('el botón tiene aria-label/tooltip accesible e identificable', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    const btn = returnButtons()[0];
    expect(btn).toHaveAttribute('aria-label', 'Procesar devolución');
    expect(btn).toHaveAttribute('title', 'Procesar devolución');
  });

  // TEST 3
  it('la primera confirmación aparece al hacer clic, con los datos reales de la venta', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    fireEvent.click(returnButtons()[0]);

    expect(screen.getByText('¿Deseas iniciar una devolución para la venta VEN-000117?')).toBeInTheDocument();
    expect(within(confirm1Modal()).getByText('Ivette Maria Lora Peguero')).toBeInTheDocument();
    expect(within(confirm1Modal()).getByText(formatCurrency(640, 'RD$'))).toBeInTheDocument();
    expect(within(confirm1Modal()).getByText('La venta será cargada en el módulo de Devoluciones.')).toBeInTheDocument();
  });

  // TEST 4
  it('cancelar la primera confirmación: no navega, no muestra la segunda', () => {
    const onNavigateToReturns = vi.fn();
    render(<SalesView onNavigateToReturns={onNavigateToReturns} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText(/¿Deseas iniciar una devolución/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CONFIRMACIÓN DE DEVOLUCIÓN/i)).not.toBeInTheDocument();
    expect(onNavigateToReturns).not.toHaveBeenCalled();
  });

  // TEST 5
  it('aceptar la primera confirmación (Continuar) muestra la segunda, independiente', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Continuar'));

    expect(screen.getByText(/CONFIRMACIÓN DE DEVOLUCIÓN/i)).toBeInTheDocument();
    expect(screen.getByText('Verifica que la venta y el cliente sean correctos antes de continuar.')).toBeInTheDocument();
    expect(screen.queryByText('¿Deseas iniciar una devolución para la venta VEN-000117?')).not.toBeInTheDocument();
  });

  // TEST 6
  it('cancelar la segunda confirmación: no navega, no modifica nada', () => {
    const onNavigateToReturns = vi.fn();
    render(<SalesView onNavigateToReturns={onNavigateToReturns} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText(/CONFIRMACIÓN DE DEVOLUCIÓN/i)).not.toBeInTheDocument();
    expect(onNavigateToReturns).not.toHaveBeenCalled();
  });

  // TEST 7
  it('aceptar ambas confirmaciones navega al módulo de Devoluciones con el número de venta real', () => {
    const onNavigateToReturns = vi.fn();
    render(<SalesView onNavigateToReturns={onNavigateToReturns} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(screen.getByText('Sí, continuar'));

    expect(onNavigateToReturns).toHaveBeenCalledTimes(1);
    expect(onNavigateToReturns).toHaveBeenCalledWith('VEN-000117');
  });

  // TEST 9
  it('en ningún momento se dispara un toast de devolución -- el botón nunca procesa nada, solo navega', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(screen.getByText('Sí, continuar'));
    expect(showToast).not.toHaveBeenCalled();
  });

  // TEST 11
  it('funciona para una venta de Consumidor Final (sin cliente registrado)', () => {
    const onNavigateToReturns = vi.fn();
    render(<SalesView onNavigateToReturns={onNavigateToReturns} />);
    const [, consumidorFinalButton] = returnButtons();
    fireEvent.click(consumidorFinalButton);

    expect(screen.getByText('¿Deseas iniciar una devolución para la venta VEN-000112?')).toBeInTheDocument();
    expect(within(confirm1Modal()).getByText('Consumidor Final')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(screen.getByText('Sí, continuar'));
    expect(onNavigateToReturns).toHaveBeenCalledWith('VEN-000112');
  });

  // TEST 12
  it('funciona igual para una venta con cliente registrado', () => {
    const onNavigateToReturns = vi.fn();
    render(<SalesView onNavigateToReturns={onNavigateToReturns} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(screen.getByText('Sí, continuar'));
    expect(onNavigateToReturns).toHaveBeenCalledWith('VEN-000117');
  });

  // TEST 16
  it('el carrito/POS no existe en este contexto -- la acción vive enteramente en Historial, sin tocar ningún estado de POS', () => {
    // No hay ningún import de POSView/carrito en SalesView.tsx -- se
    // confirma indirectamente: el único efecto observable de completar el
    // flujo es la llamada a onNavigateToReturns, nada más.
    const onNavigateToReturns = vi.fn();
    render(<SalesView onNavigateToReturns={onNavigateToReturns} />);
    fireEvent.click(returnButtons()[0]);
    fireEvent.click(screen.getByText('Continuar'));
    fireEvent.click(screen.getByText('Sí, continuar'));
    expect(refreshProducts).not.toHaveBeenCalled();
    expect(onNavigateToReturns).toHaveBeenCalledTimes(1);
  });

  // TEST 14
  it('Ver e Imprimir siguen funcionando exactamente igual, sin ninguna confirmación nueva', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);

    fireEvent.click(screen.getAllByTitle('Ver detalle')[0]);
    expect(screen.getByText('Detalle de Venta VEN-000117')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cerrar'));
    expect(screen.queryByText('Detalle de Venta VEN-000117')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle('Reimprimir Comprobante')[0]);
    expect(screen.queryByText(/CONFIRMACIÓN DE DEVOLUCIÓN/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/¿Deseas iniciar una devolución/)).not.toBeInTheDocument();
  });

  // TEST 15
  it('el botón rojo "Anular venta" conserva exactamente su comportamiento actual -- sin ninguna confirmación de devolución de por medio', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    fireEvent.click(screen.getAllByTitle('Anular venta')[0]);

    expect(screen.getByText(/Anular Venta VEN-000117/)).toBeInTheDocument();
    expect(screen.queryByText(/¿Deseas iniciar una devolución/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CONFIRMACIÓN DE DEVOLUCIÓN/i)).not.toBeInTheDocument();
  });
});

describe('SalesView -- Historial de Movimientos dentro del Detalle de Venta', () => {
  const devolucionDeOtraVenta: import('../../types').ReturnRecord = {
    id: 'DEV-999', numeroDevolucion: 'DEV-000999', ventaId: 'VEN-OTRA', numeroVenta: 'VEN-000900',
    clienteNombre: 'Otro Cliente',
    items: [{ productoId: 'PX', varianteId: 'VX', nombreProducto: 'Producto Ajeno', talla: 'S', color: 'Rojo', cantidad: 1, precioUnitario: 100, total: 100 }],
    montoDevuelto: 100, tipoReembolso: 'EFECTIVO', motivo: 'No debe aparecer aquí', usuarioId: 'USR-X', usuarioNombre: 'Otro Usuario',
    fecha: '2026-08-01 08:00:00',
  };

  // Montos deliberadamente ≤ sale117.total (640) -- una devolución nunca
  // puede exceder el total de su venta original (el backend real lo
  // rechazaría), así que "Total neto" (original - devuelto) da un
  // resultado económicamente coherente, nunca negativo.
  const devolucionMultiProducto: import('../../types').ReturnRecord = {
    id: 'DEV-500', numeroDevolucion: 'DEV-000500', ventaId: 'VEN-117', numeroVenta: 'VEN-000117',
    clienteNombre: 'Ivette Maria Lora Peguero',
    items: [
      { productoId: 'P1', varianteId: 'V1', nombreProducto: 'Blusa Seda', talla: 'M', color: 'Negro', cantidad: 1, precioUnitario: 240, total: 240 },
      { productoId: 'P2', varianteId: 'V2', nombreProducto: 'Falda Plisada', talla: 'S', color: 'Beige', cantidad: 2, precioUnitario: 55, total: 110 },
    ],
    montoDevuelto: 350, tipoReembolso: 'VALE_TIENDA', motivo: 'Talla incorrecta', usuarioId: 'USR-T01', usuarioNombre: 'Cajera Prueba',
    fecha: '2026-09-02 09:30:00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSales = [sale117, saleConsumidorFinal, saleAnulada];
    mockReturns = [];
  });
  afterEach(() => cleanup());

  const openDetail = (title = 'Ver detalle') => fireEvent.click(screen.getAllByTitle(title)[0]);
  const modal = () => screen.getByText('Movimientos de esta Venta:').closest('.space-y-4') as HTMLElement;
  // El modal "Detalle de Venta" se superpone sobre la tabla del historial
  // (que sigue montada detrás); el nombre del cliente se repite en ambos
  // (fila de la tabla + modal), así que hay que acotar al modal para no
  // obtener "Found multiple elements".
  const detailModal = () => screen.getByText(/^Detalle de Venta /).closest('.max-w-lg') as HTMLElement;

  // C/D/H
  it('venta sin movimientos: la venta original se ve exactamente igual y debajo aparece "Sin movimientos posteriores"', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    openDetail();

    // La información original de la venta sigue exactamente igual.
    expect(screen.getByText('Detalle de Venta VEN-000117')).toBeInTheDocument();
    expect(within(detailModal()).getByText('Ivette Maria Lora Peguero')).toBeInTheDocument();
    expect(within(detailModal()).getByText('Blusa Seda')).toBeInTheDocument();

    expect(screen.getByText('Movimientos de esta Venta:')).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos posteriores')).toBeInTheDocument();
  });

  // E/F -- devolución real, multi-producto.
  it('venta con devolución real: aparece con producto, variante, cantidad, monto, fecha, tipo de reembolso e ID correctos (multi-producto)', () => {
    mockReturns = [devolucionMultiProducto];
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    openDetail();

    const seccion = modal();
    const devolucionCard = within(seccion).getByText('Devolución DEV-000500').closest('div') as HTMLElement;
    // El monto se renderiza como "-{formatCurrency(...)}" -- dos hijos JSX
    // concatenados en un mismo <span>, por lo que su textContent real es
    // "-RD$ 350.00" (sin espacio). Se compara ese texto completo y exacto,
    // acotado a la tarjeta de esta devolución específica -- el resumen
    // "Total devuelto:" de arriba muestra el mismo monto ("-RD$ 350.00")
    // porque solo hay una devolución, así que sin acotar el query
    // encontraría dos elementos ("Found multiple elements").
    expect(within(devolucionCard).getByText(`-${formatCurrency(350, 'RD$')}`)).toBeInTheDocument();
    expect(within(seccion).getByText(/Blusa Seda \(Talla M \/ Negro\) x 1/)).toBeInTheDocument();
    expect(within(seccion).getByText(/Falda Plisada \(Talla S \/ Beige\) x 2/)).toBeInTheDocument();
    expect(within(seccion).getByText('Motivo: Talla incorrecta')).toBeInTheDocument();
    expect(within(seccion).getByText('Reembolso: VALE_TIENDA')).toBeInTheDocument();
    expect(within(seccion).getByText('Registrado por: Cajera Prueba')).toBeInTheDocument();
  });

  // G -- exclusión de devoluciones de otras ventas.
  it('NO muestra devoluciones de otras ventas', () => {
    mockReturns = [devolucionDeOtraVenta, devolucionMultiProducto];
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    openDetail();

    const seccion = modal();
    expect(within(seccion).getByText('Devolución DEV-000500')).toBeInTheDocument();
    expect(within(seccion).queryByText('Devolución DEV-000999')).not.toBeInTheDocument();
    expect(within(seccion).queryByText(/Producto Ajeno/)).not.toBeInTheDocument();
  });

  // I -- venta anulada.
  it('venta ANULADA: aparece "Anulación de Venta" con motivo y usuario', () => {
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    fireEvent.click(screen.getAllByTitle('Ver detalle')[2]); // saleAnulada es la 3ª fila (117, 112, 099)

    const seccion = modal();
    expect(within(seccion).getByText('Anulación de Venta')).toBeInTheDocument();
  });

  // J -- devolución + anulación en la misma venta, ambas aparecen por separado.
  it('venta con devolución Y anulación: ambas aparecen, cada una como su propia entrada', () => {
    mockReturns = [{ ...devolucionMultiProducto, ventaId: 'VEN-099', numeroVenta: 'VEN-000099' }];
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    fireEvent.click(screen.getAllByTitle('Ver detalle')[2]); // saleAnulada

    const seccion = modal();
    expect(within(seccion).getByText('Devolución DEV-000500')).toBeInTheDocument();
    expect(within(seccion).getByText('Anulación de Venta')).toBeInTheDocument();
  });

  // K -- el total original registrado nunca se modifica.
  it('el total original de la venta (Total Breakdown) no cambia aunque exista una devolución', () => {
    mockReturns = [devolucionMultiProducto];
    render(<SalesView onNavigateToReturns={vi.fn()} />);
    openDetail();

    // "TOTAL:" (el breakdown histórico original) sigue mostrando RD$640.00,
    // el total real registrado de la venta -- nunca 1040 (la devolución) ni
    // ninguna resta.
    const totalRow = screen.getByText('TOTAL:').closest('div') as HTMLElement;
    expect(within(totalRow).getByText(formatCurrency(640, 'RD$'))).toBeInTheDocument();

    // Y la sección nueva SÍ muestra el desglose original/devuelto/neto,
    // sin tocar el breakdown de arriba.
    const seccion = modal();
    expect(within(seccion).getByText('Total original:')).toBeInTheDocument();
    expect(within(seccion).getByText('Total devuelto:')).toBeInTheDocument();
    expect(within(seccion).getByText('Total neto:')).toBeInTheDocument();
  });
});
