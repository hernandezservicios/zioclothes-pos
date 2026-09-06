import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ProductFormModal } from './ProductFormModal';
import type { Product, Category, Size, Color } from '../../types';

/**
 * FASE -- CORRECCIÓN DEFINITIVA DE VARIANTES Y GUARDADO INDIVIDUAL.
 *
 * Ejercita ProductFormModal.tsx TAL COMO ES -- ninguna de sus funciones
 * se reescribe para la prueba. Solo se sustituye useToast (para poder
 * inspeccionar los mensajes mostrados) vía vi.mock, igual que ya hace
 * POSView.test.tsx con sus propios contextos.
 *
 * Alcance: cubre específicamente el comportamiento NUEVO de esta fase
 * (alta individual de una variante, generación de matriz aditiva y no
 * duplicante, validación de duplicados antes de guardar, y el hilo de
 * `deletedVariantIds` hacia onSave) -- no re-prueba exhaustivamente el
 * resto del formulario (fotos, catálogo de tallas/colores, etc.), que
 * está fuera del alcance de esta fase y no fue modificado.
 */

const showToast = vi.fn();
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

const mockCategory: Category = { id: 'CAT-T01', nombre: 'Camisas', estado: 'ACTIVO' };
const mockSizes: Size[] = [
  { id: 'SIZ-1', nombre: 'S', orden: 1 },
  { id: 'SIZ-2', nombre: 'M', orden: 2 },
  { id: 'SIZ-3', nombre: 'L', orden: 3 },
];
const mockColors: Color[] = [
  { id: 'COL-1', nombre: 'Negro', hex: '#000000' },
  { id: 'COL-2', nombre: 'Blanco', hex: '#FFFFFF' },
];

function renderModal(editingProduct: Product | null, onSave = vi.fn()) {
  render(
    <ProductFormModal
      isOpen={true}
      onClose={vi.fn()}
      editingProduct={editingProduct}
      categories={[mockCategory]}
      initialSizes={mockSizes}
      initialColors={mockColors}
      onSave={onSave}
    />
  );
  return { onSave };
}

function makeVariantProduct(variants: Product['variantes']): Product {
  return {
    id: 'PROD-VAR-01',
    sku: 'SKU-VAR-01',
    codigoBarras: '7501111111111',
    nombre: 'Camiseta Test',
    descripcion: '',
    categoriaId: 'CAT-T01',
    marca: 'ZIO',
    costo: 300,
    precio: 700,
    impuesto: 18,
    stockMinimo: 3,
    estado: 'ACTIVO',
    tieneVariantes: true,
    variantes: variants,
    fechaCreacion: '2026-01-01 00:00:00',
  };
}

function enableVariantsMode() {
  fireEvent.click(screen.getByLabelText(/Este producto tiene variantes/i));
}

function addVariant(talla: string, color: string) {
  fireEvent.click(screen.getByRole('button', { name: /\+ Agregar Variante/i }));
  fireEvent.change(screen.getByPlaceholderText(/Ej\. S, 38/i), { target: { value: talla } });
  fireEvent.change(screen.getByPlaceholderText(/Ej\. Negro/i), { target: { value: color } });
  fireEvent.click(screen.getByRole('button', { name: /Agregar Esta Variante/i }));
}

// products.save real siempre exige nombre -- necesario en cualquier
// prueba que efectivamente llegue a pulsar "Guardar".
function fillNombre(value = 'Camiseta Test') {
  fireEvent.change(screen.getByPlaceholderText(/Ej\. Camisa Oxford/i), { target: { value } });
}

function variantsTable() {
  return screen.getByRole('table');
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('ProductFormModal -- alta individual de una variante ("+ Agregar Variante")', () => {
  it('agrega exactamente 1 variante nueva sin generar ninguna otra combinación', () => {
    renderModal(null);
    enableVariantsMode();
    addVariant('S', 'Negro');

    expect(screen.getByText(/Combinaciones Generadas \(1\)/i)).toBeInTheDocument();
    const table = variantsTable();
    expect(within(table).getByText('S')).toBeInTheDocument();
    expect(within(table).getByText('Negro')).toBeInTheDocument();
    // Nunca fuerza ninguna otra combinación (ej. no debe existir una
    // segunda fila "M" en la tabla).
    expect(within(table).queryByText('M')).not.toBeInTheDocument();
  });

  it('rechaza agregar una variante duplicada (misma talla/color ya presente) sin crearla', () => {
    renderModal(null);
    enableVariantsMode();
    addVariant('S', 'Negro');

    // Intenta agregar la misma combinación otra vez, con espacios/mayúsculas distintas.
    addVariant(' s ', ' negro ');

    expect(screen.getByText(/Combinaciones Generadas \(1\)/i)).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      'Variante Duplicada',
      expect.stringContaining('S / Negro'),
      'error'
    );
  });
});

describe('ProductFormModal -- "Generar Combinaciones" es aditivo (Parte 4/13)', () => {
  it('no elimina una variante agregada individualmente que está fuera de la selección actual', () => {
    renderModal(null);
    enableVariantsMode();

    // Alta individual de L/Blanco (fuera de cualquier selección de matriz).
    addVariant('L', 'Blanco');
    expect(screen.getByText(/Combinaciones Generadas \(1\)/i)).toBeInTheDocument();

    // Selecciona S + Negro y genera combinaciones -- NO debe borrar L/Blanco.
    fireEvent.click(screen.getByRole('button', { name: 'S' }));
    fireEvent.click(screen.getByRole('button', { name: 'Negro' }));
    fireEvent.click(screen.getByRole('button', { name: /Generar Combinaciones/i }));

    expect(screen.getByText(/Combinaciones Generadas \(2\)/i)).toBeInTheDocument();
    const rows = within(variantsTable()).getAllByRole('row').slice(1);
    const keys = rows.map((r) => within(r).getAllByRole('cell').slice(0, 2).map((c) => c.textContent).join('|'));
    expect(keys).toContain('L|Blanco');
    expect(keys).toContain('S|Negro');
  });

  it('al editar un producto con S/Negro y M/Negro ya existentes, genera solo las combinaciones faltantes', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 11, estado: 'ACTIVO' },
      { id: 'VAR-000002', productoId: 'PROD-VAR-01', sku: 'SKU-M-NEG', codigoBarras: '2', color: 'Negro', talla: 'M', costo: 300, precio: 700, stock: 7, estado: 'ACTIVO' },
    ]);
    renderModal(product);

    // Selecciona {S,M} x {Negro,Blanco} y genera -- ya existen S/Negro y M/Negro.
    fireEvent.click(screen.getByRole('button', { name: 'Blanco' }));
    fireEvent.click(screen.getByRole('button', { name: /Generar Combinaciones/i }));

    expect(screen.getByText(/Combinaciones Generadas \(4\)/i)).toBeInTheDocument();
    // Las 2 preexistentes deben conservar su stock original (no reseteado).
    const rows = within(variantsTable()).getAllByRole('row').slice(1);
    const stockOf = (talla: string, color: string) => {
      const row = rows.find((r) => within(r).queryByText(talla) && within(r).queryByText(color));
      expect(row).toBeTruthy();
      return within(row as HTMLElement).getByRole('spinbutton') as HTMLInputElement;
    };
    expect(stockOf('S', 'Negro').value).toBe('11');
    expect(stockOf('M', 'Negro').value).toBe('7');
  });
});

describe('ProductFormModal -- validación de duplicados antes de guardar (Parte 5)', () => {
  it('el alta individual ya impide que 2 variantes con la misma combinación coexistan al guardar', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
    ]);
    const { onSave } = renderModal(product);

    // Intenta agregar individualmente la misma combinación ya existente --
    // debe rechazarse ANTES de llegar siquiera a intentar guardar.
    addVariant('S', 'Negro');
    expect(showToast).toHaveBeenCalledWith('Variante Duplicada', expect.stringContaining('S / Negro'), 'error');

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    const count = payload.variantes.filter((v: any) => v.talla === 'S' && v.color === 'Negro').length;
    expect(count).toBe(1);
  });
});

describe('ProductFormModal -- eliminación de variantes informa al backend (Parte 6/11)', () => {
  it('al eliminar una variante YA existente (id real), su id se envía en deletedVariantIds', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
      { id: 'VAR-000002', productoId: 'PROD-VAR-01', sku: 'SKU-M-NEG', codigoBarras: '2', color: 'Negro', talla: 'M', costo: 300, precio: 700, stock: 3, estado: 'ACTIVO' },
    ]);
    const { onSave } = renderModal(product);

    const deleteButtons = screen.getAllByTitle('Eliminar combinación');
    fireEvent.click(deleteButtons[0]); // elimina la primera fila (S/Negro)

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.deletedVariantIds).toEqual(['VAR-000001']);
    expect(payload.variantes.some((v: any) => v.id === 'VAR-000001')).toBe(false);
    expect(payload.variantes.some((v: any) => v.id === 'VAR-000002')).toBe(true);
  });

  it('al eliminar una variante NUEVA (id temporal, nunca guardada), no se envía nada en deletedVariantIds', () => {
    const { onSave } = renderModal(null);
    fillNombre();
    enableVariantsMode();

    addVariant('S', 'Negro');
    fireEvent.click(screen.getByTitle('Eliminar combinación'));

    // Sin ninguna variante, el checkbox de "tiene variantes" exige al
    // menos 1 -- se agrega otra para poder guardar y así inspeccionar el payload.
    addVariant('U', 'Único');

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.deletedVariantIds).toEqual([]);
  });
});

describe('ProductFormModal -- columna Estado (Guardada/Nueva, Parte 12)', () => {
  it('marca una variante existente como "Guardada" y una nueva como "Nueva"', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
    ]);
    renderModal(product);

    expect(screen.getByText('Guardada')).toBeInTheDocument();

    addVariant('M', 'Negro');

    expect(screen.getByText('Guardada')).toBeInTheDocument();
    expect(screen.getByText('Nueva')).toBeInTheDocument();
  });
});
