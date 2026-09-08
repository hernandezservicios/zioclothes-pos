import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { POSView } from './POSView';
import type { Product, Category } from '../../types';

/**
 * FASE -- AUDITORÍA Y CORRECCIÓN: REGRESIÓN DE IMÁGENES Y LOGO.
 * Ver comentario completo en src/components/layout/ImageFallback.test.tsx
 * -- mismo mecanismo, aplicado a las fotos de producto del catálogo POS
 * (vista Cuadrícula y vista Lista comparten `imageLoadFailedIds`, un
 * único Set por producto, no un sistema paralelo).
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
  imagenUrl: 'https://drive.google.com/uc?export=view&id=FOTO123',
  variantes: [
    {
      id: 'VAR-T01', productoId: 'PROD-T01', sku: 'SKU-T01-A', codigoBarras: '7501234567891',
      color: 'Azul', talla: 'M', costo: 300, precio: 500, stock: 10, estado: 'ACTIVO',
    },
  ],
  fechaCreacion: '2026-01-01 00:00:00',
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    settings: { simboloMoneda: 'RD$', aplicarImpuestoPorDefecto: true, impuestoPorcentaje: 18 },
    currentUser: { id: 'USR-T01', nombre: 'Usuario Prueba', rol: 'ADMIN' },
    hasPermission: () => true,
    activeCashSession: { id: 'CAJA-T01' },
  }),
}));
const mockProductNoImage: Product = { ...mockProduct, id: 'PROD-T02', sku: 'SKU-T02', nombre: 'Pantalón Sin Foto', precio: 750, imagenUrl: undefined };

vi.mock('../../context/DataStoreContext', () => ({
  useDataStore: () => ({
    products: [mockProduct, mockProductNoImage], categories: [mockCategory], customers: [],
    refreshProducts, refreshCustomers, refreshSales, refreshCredits, refreshCreditNotes, getCustomers,
  }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe('POSView -- fallback de imagen de producto ante fallo real de carga', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('URL de imagen válida (vista Cuadrícula): renderiza el <img> real, transformado por toDisplayableImageUrl', () => {
    render(<POSView />);
    const img = screen.getByAltText('Camisa Test Azul') as HTMLImageElement;
    expect(img.src).toBe('https://drive.google.com/thumbnail?id=FOTO123');
  });

  it('imagen inválida (falla real de carga): cae al ícono de bolsa ya existente, no al ícono roto del navegador', () => {
    render(<POSView />);
    const img = screen.getByAltText('Camisa Test Azul');

    fireEvent.error(img);

    expect(screen.queryByAltText('Camisa Test Azul')).not.toBeInTheDocument();
    // El producto sigue siendo completamente utilizable -- nombre, SKU,
    // precio y la posibilidad de seleccionarlo no se tocan.
    expect(screen.getByText('Camisa Test Azul')).toBeInTheDocument();
    expect(screen.getByText('RD$ 500.00')).toBeInTheDocument();
  });

  it('el fallback también aplica en la vista Lista (mismo Set compartido, ninguna lógica paralela)', () => {
    render(<POSView />);
    fireEvent.click(screen.getByLabelText('Ver catálogo en lista'));

    const img = screen.getByAltText('Camisa Test Azul');
    fireEvent.error(img);

    expect(screen.queryByAltText('Camisa Test Azul')).not.toBeInTheDocument();
    expect(screen.getByText('Camisa Test Azul')).toBeInTheDocument();
  });

  it('producto sin imagenUrl configurada: muestra el ícono de bolsa directamente (comportamiento ya existente, sin cambios)', () => {
    render(<POSView />);
    expect(screen.queryByAltText('Pantalón Sin Foto')).not.toBeInTheDocument();
    expect(screen.getByText('Pantalón Sin Foto')).toBeInTheDocument();
  });

  // VariantSelectorModal reutiliza la MISMA `toDisplayableImageUrl` y el
  // mismo mecanismo -- se abre desde el catálogo, nunca una fuente de
  // datos de imagen distinta.
  it('VariantSelectorModal: imagen válida se transforma igual; si falla al cargar, se oculta sin romper la selección de variante', () => {
    render(<POSView />);
    fireEvent.click(screen.getByText('Camisa Test Azul'));

    // El catálogo de fondo también tiene un <img alt="Camisa Test Azul">
    // -- se acota al modal (identificado por "Agregar al Carrito") para
    // no depender de esa ambigüedad.
    const modal = screen.getByText('Agregar al Carrito').closest('.rounded-3xl') as HTMLElement;
    const img = within(modal).getByAltText('Camisa Test Azul') as HTMLImageElement;
    expect(img.src).toBe('https://drive.google.com/thumbnail?id=FOTO123');

    fireEvent.error(img);
    expect(within(modal).queryByAltText('Camisa Test Azul')).not.toBeInTheDocument();
    // El selector de talla/color y el botón de agregar siguen intactos.
    expect(within(modal).getByText('Agregar al Carrito')).toBeInTheDocument();
  });
});
