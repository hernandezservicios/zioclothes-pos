import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { POSView } from './POSView';
import type { Product, Category } from '../../types';

/**
 * FASE -- AUDITORÍA RESPONSIVE COMPLETA (POS: carrito móvil).
 *
 * `mobileCartOpen` existía como estado desde antes pero nunca se
 * conectaba a ningún control real -- en móvil el carrito completo
 * (cliente, líneas con cantidad/descuento, descuento global, ITBIS,
 * "COBRAR ORDEN") era literalmente inalcanzable; solo se veía el Total y
 * el botón "Cobrar" de la barra flotante. Estas pruebas ejercitan
 * POSView.tsx TAL COMO ES (mismo patrón que POSView.test.tsx) para
 * verificar el nuevo drawer inferior móvil, que reutiliza
 * `renderCartPanel()` -- el MISMO contenido/lógica que ya usaba la
 * columna de escritorio, sin una segunda implementación del carrito.
 */

const refreshProducts = vi.fn();
const refreshCustomers = vi.fn();
const refreshSales = vi.fn();
const refreshCredits = vi.fn();
const refreshCreditNotes = vi.fn();
const getCustomers = vi.fn(() => []);

const mockCategory: Category = { id: 'CAT-T01', nombre: 'Camisas', estado: 'ACTIVO' };

const mockProduct: Product = {
  id: 'PROD-T01',
  sku: 'SKU-T01',
  codigoBarras: '7501234567890',
  nombre: 'Camisa Test Azul',
  descripcion: 'Camisa de prueba',
  categoriaId: 'CAT-T01',
  marca: 'ZIO',
  costo: 300,
  precio: 500,
  impuesto: 18,
  stockMinimo: 3,
  estado: 'ACTIVO',
  tieneVariantes: true,
  variantes: [
    {
      id: 'VAR-T01',
      productoId: 'PROD-T01',
      sku: 'SKU-T01-A',
      codigoBarras: '7501234567891',
      color: 'Azul',
      talla: 'M',
      costo: 300,
      precio: 500,
      stock: 10,
      estado: 'ACTIVO',
    },
  ],
  fechaCreacion: '2026-01-01 00:00:00',
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    settings: {
      simboloMoneda: 'RD$',
      aplicarImpuestoPorDefecto: true,
      impuestoPorcentaje: 18,
    },
    currentUser: { id: 'USR-T01', nombre: 'Usuario Prueba', rol: 'ADMIN' },
    hasPermission: () => true,
    // Requerido por PaymentModal (se abre desde la prueba de "continuar
    // al cobro" -- ver más abajo), no por POSView en sí.
    activeCashSession: { id: 'CAJA-T01' },
  }),
}));

vi.mock('../../context/DataStoreContext', () => ({
  useDataStore: () => ({
    products: [mockProduct],
    categories: [mockCategory],
    customers: [],
    refreshProducts,
    refreshCustomers,
    refreshSales,
    refreshCredits,
    refreshCreditNotes,
    getCustomers,
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// Requeridos únicamente porque la prueba de "continuar al cobro" abre el
// PaymentModal REAL (nunca se sustituye por una versión falsa -- mismo
// componente que ya se prueba a fondo en PaymentModal.test.tsx) -- estos
// son sus límites externos reales (red), mismo patrón de mocks que ya usa
// ese archivo. POSView.tsx en sí no importa ninguno de estos.
vi.mock('../../services/salesApi', () => ({
  salesApi: { createSale: vi.fn() },
}));
vi.mock('../../services/creditsApi', () => ({
  creditsApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('../../services/creditNotesApi', () => ({
  creditNotesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

describe('POSView -- drawer de carrito móvil (responsive)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  // jsdom no evalúa CSS real -- las clases `hidden lg:flex` de la columna
  // de escritorio (siempre presente en el DOM, solo oculta visualmente
  // en un navegador real) no la sacan del árbol para las queries de
  // Testing Library. `renderCartPanel()` se reutiliza tanto ahí como en
  // el drawer móvil (a propósito -- ver comentario en POSView.tsx), así
  // que con el drawer abierto su contenido ("Cliente:", "Productos en
  // Orden", etc.) existe DOS veces en el árbol de pruebas. Se acota
  // explícitamente al drawer (identificado por su encabezado "Carrito de
  // Compra") para no depender de esa ambigüedad -- en un navegador real
  // la columna de escritorio simplemente no se pinta bajo `lg:`.
  const mobileDrawer = () => screen.getByText('Carrito de Compra').closest('.flex-col') as HTMLElement;

  it('el drawer del carrito está cerrado por defecto (el panel completo no es visible)', () => {
    render(<POSView />);
    expect(screen.queryByText('Carrito de Compra')).not.toBeInTheDocument();
    // La barra flotante (Total + Cobrar) sí está siempre visible.
    expect(screen.getByLabelText('Ver carrito de compra')).toBeInTheDocument();
  });

  it('tocar el área de Total abre el drawer con el mismo panel de carrito (reutiliza renderCartPanel, no una segunda implementación)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver carrito de compra'));

    const drawer = mobileDrawer();
    // Contenido real del panel de carrito (idéntico al que ya usaba la
    // columna de escritorio): selector de cliente y lista de productos.
    expect(within(drawer).getByText('Cliente:')).toBeInTheDocument();
    expect(within(drawer).getByText(/Productos en Orden/)).toBeInTheDocument();
    expect(within(drawer).getByText('COBRAR ORDEN')).toBeInTheDocument();
  });

  it('un producto agregado al carrito aparece dentro del drawer móvil al abrirlo (mismo estado real, no una copia)', () => {
    render(<POSView />);

    // Agrega el producto real (mismo flujo que POSView.test.tsx:
    // VariantSelectorModal con selección de color/talla por defecto).
    fireEvent.click(screen.getByText('Camisa Test Azul'));
    fireEvent.click(screen.getByText('Agregar al Carrito'));

    fireEvent.click(screen.getByLabelText('Ver carrito de compra'));
    expect(within(mobileDrawer()).getByText('Productos en Orden (1)')).toBeInTheDocument();
  });

  it('cerrar el drawer con la X lo oculta de nuevo', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver carrito de compra'));
    expect(screen.getByText('Carrito de Compra')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Cerrar carrito'));
    expect(screen.queryByText('Carrito de Compra')).not.toBeInTheDocument();
  });

  it('cerrar el drawer tocando el fondo también lo oculta', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver carrito de compra'));
    expect(screen.getByText('Carrito de Compra')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mobile-cart-backdrop'));
    expect(screen.queryByText('Carrito de Compra')).not.toBeInTheDocument();
  });

  // AUDITORÍA (FASE -- corregir carrito móvil): "Cobrar" es un botón
  // real DISTINTO del de "Total" (aria-label propio), pero ahora AMBOS
  // abren el mismo drawer -- antes "Cobrar" saltaba directo a
  // PaymentModal sin pasar por el carrito, que era exactamente la causa
  // raíz de que el carrito "no apareciera" al usar el control principal
  // esperado en móvil.
  it('el botón "Cobrar" de la barra flotante es un control distinto al de "Total", y con el carrito vacío permanece deshabilitado (sin abrir nada)', () => {
    render(<POSView />);
    const verCarritoBtn = screen.getByLabelText('Ver carrito de compra');
    const cobrarBtn = screen.getByLabelText('Ver carrito de compra y continuar al cobro');

    expect(cobrarBtn).not.toBe(verCarritoBtn);
    expect(cobrarBtn).toBeDisabled();
    fireEvent.click(cobrarBtn);
    expect(screen.queryByText('Carrito de Compra')).not.toBeInTheDocument();
  });

  it('tocar "Cobrar (N)" con productos en el carrito abre el mismo drawer (causa raíz corregida: antes saltaba directo a PaymentModal sin mostrar el carrito)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));
    fireEvent.click(screen.getByText('Agregar al Carrito'));

    const cobrarBtn = screen.getByLabelText('Ver carrito de compra y continuar al cobro');
    expect(cobrarBtn).not.toBeDisabled();
    fireEvent.click(cobrarBtn);

    expect(within(mobileDrawer()).getByText('Productos en Orden (1)')).toBeInTheDocument();
  });

  it('permite cambiar la cantidad de un producto dentro del drawer móvil (misma lógica real, handleUpdateQuantity)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));
    fireEvent.click(screen.getByText('Agregar al Carrito'));
    fireEvent.click(screen.getByLabelText('Ver carrito de compra'));

    const drawer = mobileDrawer();
    fireEvent.click(within(drawer).getByLabelText('Aumentar cantidad de Camisa Test Azul'));
    expect(within(drawer).getByText('2')).toBeInTheDocument();

    fireEvent.click(within(drawer).getByLabelText('Disminuir cantidad de Camisa Test Azul'));
    expect(within(drawer).getByText('1')).toBeInTheDocument();
  });

  it('permite eliminar un producto dentro del drawer móvil (misma lógica real, handleRemoveItem)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));
    fireEvent.click(screen.getByText('Agregar al Carrito'));
    fireEvent.click(screen.getByLabelText('Ver carrito de compra'));

    const drawer = mobileDrawer();
    expect(within(drawer).getByText('Productos en Orden (1)')).toBeInTheDocument();

    fireEvent.click(within(drawer).getByLabelText('Eliminar Camisa Test Azul del carrito'));
    expect(within(drawer).getByText('Productos en Orden (0)')).toBeInTheDocument();
    expect(within(drawer).getByText('El carrito está vacío')).toBeInTheDocument();
  });

  it('desde el drawer móvil, "COBRAR ORDEN" continúa al cobro exactamente igual que en escritorio (mismo PaymentModal real, cierra el drawer al abrirlo)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));
    fireEvent.click(screen.getByText('Agregar al Carrito'));
    fireEvent.click(screen.getByLabelText('Ver carrito de compra y continuar al cobro'));

    fireEvent.click(within(mobileDrawer()).getByText('COBRAR ORDEN'));

    // El drawer se cierra y el PaymentModal real (mismo de siempre) se abre.
    expect(screen.queryByText('Carrito de Compra')).not.toBeInTheDocument();
    expect(screen.getByText('Cobro de Venta')).toBeInTheDocument();
  });
});
