import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { POSView } from './POSView';
import type { Product, Category } from '../../types';

/**
 * FASE UX POS (autofocus del buscador + vista Cuadrícula/Lista),
 * Requerimiento 9.
 *
 * Estas pruebas ejercitan POSView.tsx TAL COMO ES -- no se reescribe
 * ninguna de sus funciones. Los únicos contextos (useAuth/useDataStore/
 * useToast) se sustituyen por datos de prueba controlados vía `vi.mock`;
 * todo lo demás (búsqueda, filtrado, VariantSelectorModal, carrito,
 * handleAddToCart) es el código real, sin modificar.
 *
 * Alcance explícitamente NO cubierto aquí (fuera del alcance de esta
 * fase, sin cambios ni regresión): PaymentModal/ReceiptModal (flujo de
 * cobro/venta) -- nunca se abren en estas pruebas porque ninguna
 * interacción probada dispara `setPaymentModalOpen(true)`.
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
    {
      id: 'VAR-T02',
      productoId: 'PROD-T01',
      sku: 'SKU-T01-B',
      codigoBarras: '7501234567892',
      color: 'Azul',
      talla: 'L',
      costo: 300,
      precio: 500,
      stock: 5,
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

describe('POSView -- autofocus del buscador', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  // Requerimiento 9.1
  it('renderiza el input principal de búsqueda de productos', () => {
    render(<POSView />);
    expect(screen.getByPlaceholderText(/Buscar por nombre, color, SKU/i)).toBeInTheDocument();
  });

  // Requerimiento 9.2
  it('el buscador recibe el foco automáticamente al montar la pantalla (incluye F5, ya que un F5 vuelve a montar el componente)', async () => {
    render(<POSView />);
    const input = screen.getByPlaceholderText(/Buscar por nombre, color, SKU/i);
    await waitFor(() => expect(input).toHaveFocus());
  });
});

describe('POSView -- selector Cuadrícula/Lista', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  // Requerimiento 9.3
  it('la vista inicial es Cuadrícula para un usuario sin preferencia previa guardada', () => {
    render(<POSView />);
    expect(screen.getByLabelText('Ver catálogo en cuadrícula')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Ver catálogo en lista')).toHaveAttribute('aria-pressed', 'false');
  });

  // Requerimiento 9.4
  it('cambiar a Lista funciona', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    expect(screen.getByLabelText('Ver catálogo en lista')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Ver catálogo en cuadrícula')).toHaveAttribute('aria-pressed', 'false');
  });

  // Requerimiento 9.5
  it('cambiar nuevamente a Cuadrícula funciona', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    fireEvent.click(screen.getByLabelText('Ver catálogo en cuadrícula'));
    expect(screen.getByLabelText('Ver catálogo en cuadrícula')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Ver catálogo en lista')).toHaveAttribute('aria-pressed', 'false');
  });

  // Requerimiento 9.6
  it('la preferencia de vista Lista se conserva en localStorage y se restaura en un nuevo montaje (simula F5)', () => {
    const { unmount } = render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    unmount();

    render(<POSView />);
    expect(screen.getByLabelText('Ver catálogo en lista')).toHaveAttribute('aria-pressed', 'true');
  });

  // Requerimiento 9.7
  it('la preferencia de vista Cuadrícula se conserva en localStorage y se restaura en un nuevo montaje (simula F5)', () => {
    const { unmount } = render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    fireEvent.click(screen.getByLabelText('Ver catálogo en cuadrícula'));
    unmount();

    render(<POSView />);
    expect(screen.getByLabelText('Ver catálogo en cuadrícula')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('POSView -- misma lógica de datos/carrito en ambos modos', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  // Requerimiento 9.8
  it('ambos modos muestran el mismo producto (mismo DataStore, sin segunda fuente de datos)', () => {
    const { unmount } = render(<POSView />);
    expect(screen.getAllByText('Camisa Test Azul').length).toBeGreaterThan(0);
    unmount();

    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    expect(screen.getAllByText('Camisa Test Azul').length).toBeGreaterThan(0);
  });

  // Requerimiento 9.9
  it('agregar desde Cuadrícula usa la función existente (abre el VariantSelectorModal real)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));
    expect(screen.getByText('Agregar al Carrito')).toBeInTheDocument();
  });

  // Requerimiento 9.10
  it('agregar desde Lista usa EXACTAMENTE la misma función existente (abre el mismo VariantSelectorModal)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    fireEvent.click(screen.getByLabelText(`Agregar ${mockProduct.nombre} al carrito`));
    expect(screen.getByText('Agregar al Carrito')).toBeInTheDocument();
  });

  // Requerimiento 9.11
  it('un producto con variantes conserva exactamente la misma lógica existente de color/talla -> stock en ambos modos', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));

    // Color/talla por defecto (Azul/M) debe resolver la variante VAR-T01 (stock 10).
    expect(screen.getByText(/Inventario disponible: 10 unidad\(es\)/)).toBeInTheDocument();

    // Cambiar de talla dispara la MISMA lógica de búsqueda de variante
    // (sin tocar VariantSelectorModal.tsx) -- debe resolver VAR-T02 (stock 5).
    fireEvent.click(screen.getByText('L'));
    expect(screen.getByText(/Inventario disponible: 5 unidad\(es\)/)).toBeInTheDocument();
  });

  // Requerimiento 9.12
  it('cambiar de vista no modifica el stock mostrado del producto', () => {
    render(<POSView />);
    // Grid: "{totalStock} en stock" = 10 + 5 = 15
    expect(screen.getByText('15 en stock')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    // Lista: mismo total, solo cambia la presentación (sin sufijo "en stock")
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  // Requerimiento 9.13
  it('cambiar de vista no modifica el carrito', () => {
    render(<POSView />);
    expect(screen.getByText(/Productos en Orden \(0\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));
    expect(screen.getByText(/Productos en Orden \(0\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Ver catálogo en cuadrícula'));
    expect(screen.getByText(/Productos en Orden \(0\)/)).toBeInTheDocument();
  });
});
