import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { POSView } from './POSView';
import { DataStoreProvider } from '../../context/DataStoreContext';
import { storageService } from '../../services/storageService';
import type { CustomerWithCredit } from '../../services/customersApi';
import type { SaleItem } from '../../types';

/**
 * FIX POS -- CLIENTE NUEVO DEBE QUEDAR AUTOMÁTICAMENTE SELECCIONADO.
 *
 * A diferencia de POSView.test.tsx (que sustituye useDataStore por un doble
 * estático), estas pruebas envuelven POSView en el DataStoreProvider REAL.
 * Es la única forma de ejercer honestamente la regresión reportada: una
 * condición de carrera entre refreshCustomers() (actualiza el estado
 * `customers`) y getCustomers() (leía un ref que solo se sincronizaba en
 * un useEffect posterior, todavía sin aplicar en el instante en que
 * POSView.handleCreateQuickCustomer lo consultaba justo después del
 * `await refreshCustomers({force:true})`). Solo se mockea la capa de red
 * (customersApi/productsApi) y los contextos de autenticación/toast --
 * nunca DataStoreContext ni la lógica real de POSView.
 */

const { customersApiList, customersApiSave, productsApiList, productsApiListAuxiliaries, salesApiCreateSale } =
  vi.hoisted(() => ({
    customersApiList: vi.fn(),
    customersApiSave: vi.fn(),
    productsApiList: vi.fn(),
    productsApiListAuxiliaries: vi.fn(),
    salesApiCreateSale: vi.fn(),
  }));

vi.mock('../../services/customersApi', async () => {
  const actual = await vi.importActual<typeof import('../../services/customersApi')>('../../services/customersApi');
  return {
    ...actual,
    customersApi: { list: customersApiList, save: customersApiSave },
  };
});

vi.mock('../../services/productsApi', async () => {
  const actual = await vi.importActual<typeof import('../../services/productsApi')>('../../services/productsApi');
  return {
    ...actual,
    productsApi: {
      list: productsApiList,
      listAuxiliaries: productsApiListAuxiliaries,
      save: vi.fn(),
      remove: vi.fn(),
      uploadImage: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    settings: { simboloMoneda: 'RD$', aplicarImpuestoPorDefecto: false, impuestoPorcentaje: 18 },
    currentUser: { id: 'USR-T01', nombre: 'Cajera', apellido: 'Prueba', rol: 'CAJERO' },
    activeCashSession: { id: 'CAJA-T01' },
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// Necesarios porque TEST 10 llega hasta abrir el PaymentModal REAL (para
// probar el traspaso genuino del cliente recién creado hasta el cobro) --
// mismo patrón de mocks que PaymentModal.test.tsx.
vi.mock('../../services/salesApi', () => ({
  salesApi: { createSale: salesApiCreateSale, list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('../../services/creditsApi', () => ({
  creditsApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('../../services/creditNotesApi', () => ({
  creditNotesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const juan: CustomerWithCredit = {
  id: 'CLI-OLD',
  nombre: 'Juan',
  apellido: 'Prueba',
  documento: '001-1111111-1',
  telefono: '809-000-0001',
  correo: '',
  direccion: '',
  ciudad: '',
  limiteCredito: 10000,
  diasCreditoPorDefecto: 30,
  estado: 'ACTIVO',
  fechaCreacion: '2026-01-01 00:00:00',
  saldoPendiente: 0,
  creditoDisponible: 10000,
};

function renderPOS() {
  return render(
    <DataStoreProvider>
      <POSView />
    </DataStoreProvider>
  );
}

function seedCartItem(): SaleItem {
  return {
    id: 'ITM-SEED-01',
    productoId: 'PROD-SEED',
    varianteId: 'VAR-SEED',
    nombreProducto: 'Producto En Carrito',
    sku: 'SKU-SEED',
    talla: 'M',
    color: 'Negro',
    cantidad: 1,
    costoUnitario: 400,
    precioUnitario: 800,
    descuentoPorcentaje: 0,
    descuentoMonto: 0,
    subtotal: 800,
    impuestoMonto: 0,
    total: 800,
  };
}

const openNewCustomerModal = async () => {
  fireEvent.click(screen.getByText('+ Nuevo Cliente'));
  await screen.findByText('Registrar Nuevo Cliente Rápido');
};

const fillAndSubmit = async (nombre: string) => {
  fireEvent.change(screen.getByPlaceholderText('Ej. Ana'), { target: { value: nombre } });
  fireEvent.click(screen.getByText('Guardar & Seleccionar'));
};

describe('POSView -- cliente nuevo queda seleccionado automáticamente', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    productsApiList.mockResolvedValue({ success: true, data: [] });
    productsApiListAuxiliaries.mockResolvedValue({
      success: true,
      data: { categories: [], sizes: [], colors: [], suppliers: [] },
    });
    customersApiList.mockResolvedValue({ success: true, data: [] });
  });
  afterEach(() => {
    cleanup();
  });

  // TEST 1
  it('sin cliente seleccionado: crear un cliente lo deja seleccionado (no "Consumidor Final")', async () => {
    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-NEW-001' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [{ ...juan, id: 'CLI-NEW-001', nombre: 'Cliente', apellido: 'Nuevo 001', documento: '002-0000000-1' }],
    });

    renderPOS();
    await openNewCustomerModal();
    await fillAndSubmit('Cliente Nuevo 001');

    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement;
      expect(select.value).toBe('CLI-NEW-001');
    });
    expect((screen.getByRole('option', { name: /Cliente Nuevo 001/ }) as HTMLOptionElement).selected).toBe(true);
  });

  // TEST 2
  it('con un cliente ya seleccionado (Juan): crear María la deja seleccionada, no Juan', async () => {
    storageService.saveCustomers([juan] as any);
    storageService.savePosWorkingState({
      cartItems: [],
      selectedCustomerId: 'CLI-OLD',
      discountType: 'PORCENTAJE',
      overallDiscountValue: 0,
      applyTax: false,
    });

    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-NEW-002' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [juan, { ...juan, id: 'CLI-NEW-002', nombre: 'María', apellido: 'Prueba', documento: '001-2222222-2' }],
    });

    renderPOS();
    // Precondición: Juan es el seleccionado inicial (hidratado desde el
    // estado de trabajo persistido).
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement;
      expect(select.value).toBe('CLI-OLD');
    });

    await openNewCustomerModal();
    await fillAndSubmit('María Prueba');

    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement;
      expect(select.value).toBe('CLI-NEW-002');
    });
  });

  // TEST 3
  it('con productos ya en el carrito: crear un cliente NO altera el carrito ni el total, y sí selecciona al cliente', async () => {
    storageService.savePosWorkingState({
      cartItems: [seedCartItem()],
      selectedCustomerId: undefined,
      discountType: 'PORCENTAJE',
      overallDiscountValue: 0,
      applyTax: false,
    });

    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-NEW-003' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [{ ...juan, id: 'CLI-NEW-003', nombre: 'Cliente', apellido: 'Con Carrito' }],
    });

    renderPOS();
    expect(screen.getByText('Productos en Orden (1)')).toBeInTheDocument();
    expect(screen.getAllByText('RD$ 800.00').length).toBeGreaterThan(0);

    await openNewCustomerModal();
    await fillAndSubmit('Cliente Con Carrito');

    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement;
      expect(select.value).toBe('CLI-NEW-003');
    });
    // El carrito sigue exactamente igual -- ni se vació ni cambió el total.
    expect(screen.getByText('Productos en Orden (1)')).toBeInTheDocument();
    expect(screen.getAllByText('RD$ 800.00').length).toBeGreaterThan(0);
  });

  // TEST 4
  it('crear dos clientes consecutivamente: cada uno queda seleccionado en su turno', async () => {
    // customersApiList() se llama más de una vez por creación (montaje +
    // refresh tras cada alta) -- en vez de encadenar mockResolvedValueOnce
    // adivinando cuántas veces se llamará exactamente, se simula un
    // backend real: cada save() agrega al padrón y list() siempre
    // devuelve el padrón actual completo, sin importar cuántas veces se
    // consulte.
    let backendCustomers: (CustomerWithCredit & { id: string })[] = [];
    customersApiSave.mockImplementation(async (data: any) => {
      const id = data.nombre === 'Cliente A' ? 'CLI-A' : 'CLI-B';
      backendCustomers = [...backendCustomers, { ...juan, id, nombre: data.nombre, apellido: '' }];
      return { success: true, message: 'OK', data: { customerId: id } };
    });
    customersApiList.mockImplementation(async () => ({ success: true, data: backendCustomers }));

    renderPOS();
    await openNewCustomerModal();
    await fillAndSubmit('Cliente A');
    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-A');
    });

    await openNewCustomerModal();
    await fillAndSubmit('Cliente B');
    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-B');
    });
  });

  // TEST 5
  it('nombre duplicado entre dos clientes: la selección se resuelve por ID, nunca por nombre', async () => {
    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-DUP-002' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [
        { ...juan, id: 'CLI-DUP-001', nombre: 'Pedro', apellido: 'Pérez', documento: '001-0000000-1' },
        { ...juan, id: 'CLI-DUP-002', nombre: 'Pedro', apellido: 'Pérez', documento: '001-0000000-2' },
      ],
    });

    renderPOS();
    await openNewCustomerModal();
    await fillAndSubmit('Pedro Pérez');

    await waitFor(() => {
      // El seleccionado debe ser el ID real devuelto por el backend
      // (CLI-DUP-002), no el primero que calce por nombre (CLI-DUP-001).
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-DUP-002');
    });
  });

  // TEST 6
  it('cancelar la creación: el cliente seleccionado anteriormente no cambia', async () => {
    storageService.saveCustomers([juan] as any);
    storageService.savePosWorkingState({
      cartItems: [],
      selectedCustomerId: 'CLI-OLD',
      discountType: 'PORCENTAJE',
      overallDiscountValue: 0,
      applyTax: false,
    });
    customersApiList.mockResolvedValue({ success: true, data: [juan] });

    renderPOS();
    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-OLD');
    });

    await openNewCustomerModal();
    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText('Registrar Nuevo Cliente Rápido')).not.toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-OLD');
    expect(customersApiSave).not.toHaveBeenCalled();
  });

  // TEST 7
  it('error del backend al crear: no cambia el cliente seleccionado, no borra el carrito, el POS sigue usable', async () => {
    storageService.saveCustomers([juan] as any);
    storageService.savePosWorkingState({
      cartItems: [seedCartItem()],
      selectedCustomerId: 'CLI-OLD',
      discountType: 'PORCENTAJE',
      overallDiscountValue: 0,
      applyTax: false,
    });
    customersApiList.mockResolvedValue({ success: true, data: [juan] });
    customersApiSave.mockResolvedValue({ success: false, message: 'No se pudo registrar el cliente en el backend.' });

    renderPOS();
    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-OLD');
    });

    await openNewCustomerModal();
    await fillAndSubmit('Cliente Que Falla');

    await waitFor(() => expect(customersApiSave).toHaveBeenCalledTimes(1));
    // El modal de creación sigue abierto (el error no lo cierra de golpe)
    // y el cliente/carrito de la venta en curso no se tocaron.
    expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-OLD');
    expect(screen.getByText('Productos en Orden (1)')).toBeInTheDocument();
  });

  // TEST 8
  it('después de crear, el cliente nuevo aparece en la lista Y queda seleccionado', async () => {
    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-NEW-008' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [{ ...juan, id: 'CLI-NEW-008', nombre: 'Cliente', apellido: 'Ocho', documento: '008-0000000-8' }],
    });

    renderPOS();
    await openNewCustomerModal();
    await fillAndSubmit('Cliente Ocho');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Cliente Ocho/ })).toBeInTheDocument();
    });
    expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-NEW-008');
  });

  // TEST 9 (misma pantalla: POSView ES la venta rápida del sistema)
  it('crear cliente durante una venta en curso: queda seleccionado antes de continuar al cobro', async () => {
    storageService.savePosWorkingState({
      cartItems: [seedCartItem()],
      selectedCustomerId: undefined,
      discountType: 'PORCENTAJE',
      overallDiscountValue: 0,
      applyTax: false,
    });
    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-NEW-009' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [{ ...juan, id: 'CLI-NEW-009', nombre: 'Cliente', apellido: 'Rápido' }],
    });

    renderPOS();
    await openNewCustomerModal();
    await fillAndSubmit('Cliente Rápido');

    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-NEW-009');
    });

    // Continuar al cobro: el botón "Cobrar" abre PaymentModal con el
    // selectedCustomer real ya establecido (mismo prop que usa el resto
    // del checkout -- ver PaymentModal.test.tsx para el flujo de pago).
    fireEvent.click(screen.getByText(/Cobrar/));
    await waitFor(() => expect(screen.getByText('Cobro de Venta')).toBeInTheDocument());
    // "Cliente Rápido" también aparece en el texto del <option> del select
    // ("Cliente Rápido (...)") -- se acota al <span> del encabezado del
    // modal de cobro para verificar específicamente ESE traspaso.
    expect(screen.getByText('Cliente Rápido', { selector: 'span.font-semibold' })).toBeInTheDocument();
  });

  // TEST 10
  it('completar la venta: se registra asociada al cliente recién creado (mismo ID de punta a punta)', async () => {
    storageService.savePosWorkingState({
      cartItems: [seedCartItem()],
      selectedCustomerId: undefined,
      discountType: 'PORCENTAJE',
      overallDiscountValue: 0,
      applyTax: false,
    });
    customersApiSave.mockResolvedValue({ success: true, message: 'OK', data: { customerId: 'CLI-NEW-010' } });
    customersApiList.mockResolvedValue({
      success: true,
      data: [{ ...juan, id: 'CLI-NEW-010', nombre: 'Cliente', apellido: 'Diez', documento: '010-0000000-0' }],
    });
    salesApiCreateSale.mockResolvedValue({
      success: true,
      message: 'OK',
      data: { id: 'VEN-T10', numeroVenta: 'VEN-000010' },
    });

    renderPOS();
    await openNewCustomerModal();
    await fillAndSubmit('Cliente Diez');
    await waitFor(() => {
      expect((screen.getByRole('combobox', { name: 'Cliente' }) as HTMLSelectElement).value).toBe('CLI-NEW-010');
    });

    fireEvent.click(screen.getByText(/Cobrar/));
    await waitFor(() => expect(screen.getByText('Cobro de Venta')).toBeInTheDocument());

    // Pago exacto en efectivo (RD$800, el total del carrito sembrado).
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '800' } });
    fireEvent.click(screen.getByText('Completar Venta & Emitir Factura'));

    await waitFor(() => expect(salesApiCreateSale).toHaveBeenCalledTimes(1));
    const payload = salesApiCreateSale.mock.calls[0][0];
    expect(payload.clienteId).toBe('CLI-NEW-010');
    expect(payload.clienteNombre).toContain('Diez');
  });
});
