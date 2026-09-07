import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PaymentModal } from './PaymentModal';
import { formatCurrency } from '../../utils/formatters';
import type { SaleItem, Customer } from '../../types';

/**
 * FASE — AUDITORÍA Y CORRECCIÓN CRÍTICA / MODAL POS COBRO DE VENTA.
 *
 * Estas pruebas ejercitan PaymentModal.tsx TAL COMO ES -- no se reescribe
 * ninguna de sus funciones, solo se sustituyen contextos/servicios
 * externos (useAuth/useToast/salesApi/creditsApi/creditNotesApi/
 * canvas-confetti) por dobles de prueba controlados vía `vi.mock`.
 *
 * Cubre la regresión reportada ("Cambio a Devolver: RD$0.00" cuando en
 * realidad faltaba dinero) y confirma que el resto de formas de pago
 * (Tarjeta, Transferencia, A Crédito, Mixto, Saldo a Favor) no se
 * rompieron con la corrección.
 */

// vi.mock(...) es hoisted al inicio del módulo por Vitest -- las
// referencias que sus factories usan deben venir de vi.hoisted() para no
// intentar leer una `const` normal antes de que se inicialice.
const { showToast, createSale } = vi.hoisted(() => ({
  showToast: vi.fn(),
  createSale: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'USR-T01', nombre: 'Cajera', apellido: 'Prueba', rol: 'CAJERO' },
    settings: { simboloMoneda: 'RD$' },
    activeCashSession: { id: 'CAJA-T01' },
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../services/salesApi', () => ({
  salesApi: { createSale },
}));

vi.mock('../../services/creditsApi', () => ({
  creditsApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));

vi.mock('../../services/creditNotesApi', () => ({
  creditNotesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const items: SaleItem[] = [
  {
    id: 'ITM-T01',
    productoId: 'PROD-T01',
    varianteId: 'VAR-T01',
    nombreProducto: 'Camisa Test',
    sku: 'SKU-T01',
    talla: 'M',
    color: 'Azul',
    cantidad: 1,
    costoUnitario: 2000,
    precioUnitario: 5400,
    descuentoPorcentaje: 0,
    descuentoMonto: 0,
    subtotal: 5400,
    impuestoMonto: 0,
    total: 5400,
  },
];

const baseProps = {
  items,
  subtotal: 5400,
  descuentoTotal: 0,
  impuestoTotal: 0,
  total: 5400,
  applyTax: false,
  selectedCustomer: null as Customer | null,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

const customer: Customer = {
  id: 'CLI-T01',
  nombre: 'Ana',
  apellido: 'Pérez',
  documento: '001-0000000-1',
  telefono: '809-000-0000',
  correo: 'ana@example.com',
  direccion: 'Calle Falsa 123',
  ciudad: 'Santo Domingo',
  limiteCredito: 20000,
  diasCreditoPorDefecto: 30,
  estado: 'ACTIVO',
  fechaCreacion: '2026-01-01 00:00:00',
  saldoPendiente: 0,
  creditoDisponible: 20000,
};

const efectivoInput = () => screen.getByPlaceholderText('0.00') as HTMLInputElement;

describe('PaymentModal -- Efectivo: cambio y faltante (regresión corregida)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  // Caso reportado: total RD$5,400 / recibido RD$5,000.
  it('recibido menor al total: muestra "Falta por Cobrar" con el monto exacto, NUNCA "Cambio a Devolver: RD$0.00"', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.change(efectivoInput(), { target: { value: '5000' } });

    expect(screen.getByText('Falta por Cobrar:')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(400, 'RD$'))).toBeInTheDocument();
    expect(screen.queryByText('Cambio a Devolver:')).not.toBeInTheDocument();
  });

  it('recibido igual al total: muestra "Cambio a Devolver: RD$ 0.00"', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.change(efectivoInput(), { target: { value: '5400' } });

    expect(screen.getByText('Cambio a Devolver:')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(0, 'RD$'))).toBeInTheDocument();
    expect(screen.queryByText('Falta por Cobrar:')).not.toBeInTheDocument();
  });

  it('recibido mayor al total: muestra "Cambio a Devolver" con el vuelto correcto', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.change(efectivoInput(), { target: { value: '6000' } });

    expect(screen.getByText('Cambio a Devolver:')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(600, 'RD$'))).toBeInTheDocument();
  });

  it('los valores se actualizan inmediatamente al seguir escribiendo (5000 -> 6000)', () => {
    render(<PaymentModal {...baseProps} />);
    const input = efectivoInput();
    fireEvent.change(input, { target: { value: '5000' } });
    expect(screen.getByText('Falta por Cobrar:')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '6000' } });
    expect(screen.getByText('Cambio a Devolver:')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(600, 'RD$'))).toBeInTheDocument();
  });

  it('el botón rápido "Exacto" sigue funcionando y liquida el pago (cambio RD$0.00)', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.click(screen.getByText(/Exacto \(/));
    expect(screen.getByText('Cambio a Devolver:')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(0, 'RD$'))).toBeInTheDocument();
  });

  it('los botones rápidos de billetes siguen funcionando (RD$ 5,000 sobre un total de RD$5,400 -> falta RD$400)', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.click(screen.getByText('RD$ 5,000'));
    expect(screen.getByText('Falta por Cobrar:')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(400, 'RD$'))).toBeInTheDocument();
  });

  it('el botón "Completar Venta" rechaza un pago insuficiente: no llama a salesApi.createSale ni a onSuccess', async () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.change(efectivoInput(), { target: { value: '5000' } });
    fireEvent.click(screen.getByText('Completar Venta & Emitir Factura'));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0][0]).toBe('Monto Insuficiente');
    expect(createSale).not.toHaveBeenCalled();
    expect(baseProps.onSuccess).not.toHaveBeenCalled();
  });

  it('el botón "Completar Venta" con pago exacto envía el mismo cambio (0) mostrado en pantalla', async () => {
    createSale.mockResolvedValueOnce({ success: true, message: 'OK', data: { id: 'VEN-T01', numeroVenta: 'VEN-000001' } });
    render(<PaymentModal {...baseProps} />);
    fireEvent.change(efectivoInput(), { target: { value: '5400' } });
    fireEvent.click(screen.getByText('Completar Venta & Emitir Factura'));

    await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1));
    const payload = createSale.mock.calls[0][0];
    expect(payload.cambioEntregado).toBe(0);
    expect(payload.pagos).toEqual([{ metodo: 'EFECTIVO', monto: 5400 }]);
  });

  it('el botón "Completar Venta" con pago mayor al total envía el mismo cambio (600) mostrado en pantalla', async () => {
    createSale.mockResolvedValueOnce({ success: true, message: 'OK', data: { id: 'VEN-T02', numeroVenta: 'VEN-000002' } });
    render(<PaymentModal {...baseProps} />);
    fireEvent.change(efectivoInput(), { target: { value: '6000' } });
    fireEvent.click(screen.getByText('Completar Venta & Emitir Factura'));

    await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1));
    const payload = createSale.mock.calls[0][0];
    expect(payload.cambioEntregado).toBe(600);
    expect(payload.pagos).toEqual([{ metodo: 'EFECTIVO', monto: 5400 }]);
  });
});

describe('PaymentModal -- otras formas de pago no se rompieron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('Tarjeta: no muestra cambio/faltante de efectivo', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.click(screen.getByText('Tarjeta'));
    expect(screen.getByText('Referencia / Código de Aprobación POS:')).toBeInTheDocument();
    expect(screen.queryByText('Cambio a Devolver:')).not.toBeInTheDocument();
    expect(screen.queryByText('Falta por Cobrar:')).not.toBeInTheDocument();
  });

  it('Transferencia: no muestra cambio/faltante de efectivo', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.click(screen.getByText('Transferencia'));
    expect(screen.getByText('Comprobante / Banco Emisor:')).toBeInTheDocument();
    expect(screen.queryByText('Cambio a Devolver:')).not.toBeInTheDocument();
    expect(screen.queryByText('Falta por Cobrar:')).not.toBeInTheDocument();
  });

  it('A Crédito: sigue mostrando el estado de crédito del cliente, sin convertirlo en efectivo', () => {
    render(<PaymentModal {...baseProps} selectedCustomer={customer} />);
    fireEvent.click(screen.getByText('A Crédito'));
    expect(screen.getByText('Límite de Crédito:')).toBeInTheDocument();
    expect(screen.getByText('Crédito Disponible:')).toBeInTheDocument();
    expect(screen.queryByText('Cambio a Devolver:')).not.toBeInTheDocument();
  });

  it('Mixto: pago exacto entre vías se sigue reportando como cuadrado exacto', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.click(screen.getByText('Mixto'));
    const [cashInput, cardInput] = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(cashInput, { target: { value: '5000' } });
    fireEvent.change(cardInput, { target: { value: '400' } });
    expect(screen.getByText('✓ Cuadrado Exacto')).toBeInTheDocument();
  });

  it('Mixto: un faltante se sigue reportando (no se oculta como cuadrado)', () => {
    render(<PaymentModal {...baseProps} />);
    fireEvent.click(screen.getByText('Mixto'));
    const [cashInput] = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(cashInput, { target: { value: '5000' } });
    expect(screen.queryByText('✓ Cuadrado Exacto')).not.toBeInTheDocument();
    expect(screen.getByText(/Faltan \/ Sobran/)).toBeInTheDocument();
  });

  it('Saldo a Favor: sigue apareciendo cuando el cliente tiene un documento disponible, sin romper el cálculo de restante', async () => {
    const { creditNotesApi } = await import('../../services/creditNotesApi');
    (creditNotesApi.list as any).mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'CN-01',
          numero: 'VALE-000001',
          tipo: 'VALE',
          estado: 'ACTIVA',
          saldoDisponible: 1000,
          fechaCreacion: '2026-01-01',
        },
      ],
    });

    render(<PaymentModal {...baseProps} selectedCustomer={customer} />);

    await waitFor(() => expect(screen.getByText(/Saldo a Favor del Cliente/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/VALE-000001/));

    // Se aplica el máximo posible (RD$1,000 de los RD$5,400) -- resta por
    // pagar por un método tradicional: RD$4,400. El mismo monto aparece
    // dos veces (resumen "Resta por Pagar" + "Falta por Cobrar" en
    // Efectivo, porque nada se ha recibido todavía) -- ambos confirman
    // que totalRestante se recalculó correctamente tras aplicar el vale.
    expect(screen.getByText('Resta por Pagar:')).toBeInTheDocument();
    expect(screen.getAllByText(formatCurrency(4400, 'RD$')).length).toBeGreaterThanOrEqual(1);
  });
});
