import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProductsView } from './ProductsView';
import type { Product, Category } from '../../types';

/**
 * FASE -- AUDITORÍA Y CORRECCIÓN: REGRESIÓN DE IMÁGENES Y LOGO.
 * Ver comentario completo en src/components/layout/ImageFallback.test.tsx
 * -- mismo mecanismo (`onError` -> fallback ya existente), aplicado a la
 * tabla de Productos (mismo `toDisplayableImageUrl`, ninguna lógica
 * paralela).
 */

const mockCategory: Category = { id: 'CAT-T01', nombre: 'Camisas', estado: 'ACTIVO' };
const mockProduct: Product = {
  id: 'PROD-T01', sku: 'SKU-T01', codigoBarras: '7501234567890', nombre: 'Camisa Test Azul',
  descripcion: '', categoriaId: 'CAT-T01', marca: 'ZIO', costo: 300, precio: 500, impuesto: 18,
  stockMinimo: 3, estado: 'ACTIVO', tieneVariantes: true,
  imagenUrl: 'https://drive.google.com/uc?export=view&id=FOTO123',
  variantes: [
    { id: 'VAR-T01', productoId: 'PROD-T01', sku: 'SKU-T01-A', codigoBarras: '1', color: 'Azul', talla: 'M', costo: 300, precio: 500, stock: 10, estado: 'ACTIVO' },
  ],
  fechaCreacion: '2026-01-01 00:00:00',
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    settings: { simboloMoneda: 'RD$' },
    hasPermission: () => true,
  }),
}));
vi.mock('../../context/DataStoreContext', () => ({
  useDataStore: () => ({
    products: [mockProduct], categories: [mockCategory], sizes: [], colors: [], suppliers: [],
    productsLoading: false, productsError: null, productsStale: false,
    refreshProducts: vi.fn(),
  }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe('ProductsView -- fallback de imagen ante fallo real de carga', () => {
  afterEach(() => cleanup());

  it('URL de imagen válida: renderiza el <img> real, transformado por toDisplayableImageUrl', () => {
    render(<ProductsView />);
    const img = screen.getByAltText('Camisa Test Azul') as HTMLImageElement;
    expect(img.src).toBe('https://drive.google.com/thumbnail?id=FOTO123');
  });

  it('imagen inválida (falla real de carga): cae al ícono ya existente, la fila sigue mostrando el producto', () => {
    render(<ProductsView />);
    const img = screen.getByAltText('Camisa Test Azul');

    fireEvent.error(img);

    expect(screen.queryByAltText('Camisa Test Azul')).not.toBeInTheDocument();
    expect(screen.getByText('Camisa Test Azul')).toBeInTheDocument();
    expect(screen.getByText('SKU-T01')).toBeInTheDocument();
  });
});
