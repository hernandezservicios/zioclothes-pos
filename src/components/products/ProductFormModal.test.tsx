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

// AUDITORÍA (FASE -- modales de cliente/producto/variantes): Costo y
// Precio ya NO llegan prellenados (antes 1200/2500) -- cualquier prueba
// que efectivamente guarde un producto NUEVO debe rellenarlos a mano,
// igual que haría una persona real, o `handleSubmit` los rechaza como
// inválidos (campo vacío) antes de llegar a onSave.
function fillRequiredMoneyFields(costo = '300', precio = '700') {
  const [costoInput, precioInput] = screen.getAllByRole('spinbutton');
  fireEvent.change(costoInput, { target: { value: costo } });
  fireEvent.change(precioInput, { target: { value: precio } });
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
    fillRequiredMoneyFields();
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

/**
 * AUDITORÍA -- MODALES DE CLIENTE, PRODUCTO Y VARIANTES.
 *
 * Objetivo 2: "Nuevo Producto" debe iniciar con TODOS los campos vacíos
 * (nunca ZIO/1200/2500/5 ni una categoría/código auto-seleccionados).
 * Objetivos 3-5: las variantes NUNCA deben provenir de una lista fija --
 * "Vaciar Todas" debe dejar el estado real en [], nunca debe reaparecer
 * una combinación eliminada, y un producto nuevo nunca debe heredar
 * variantes de una sesión de edición anterior del mismo modal (siempre
 * montado, nunca desmontado -- ver ProductsView.tsx).
 */
describe('ProductFormModal -- Objetivo 2: "Nuevo Producto" inicia completamente vacío', () => {
  it('TEST 3: ningún campo trae un valor real -- nombre, código, marca, costo, precio, stock mínimo y descripción vacíos; categoría sin seleccionar', () => {
    renderModal(null);

    expect((screen.getByPlaceholderText(/Ej\. Camisa Oxford/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText(/Ej\. 746123456789/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText(/Ej\. Genérica, Samsung/i) as HTMLInputElement).value).toBe('');

    // Costo (placeholder "0.00") y Precio (mismo placeholder "0.00") se
    // distinguen por orden real en el DOM -- "Costo FIRST, Precio SECOND"
    // (ver comentario del propio componente).
    const numberInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const [costoInput, precioInput, stockMinimoInput] = numberInputs;
    expect(costoInput.value).toBe('');
    expect(precioInput.value).toBe('');
    expect(stockMinimoInput.value).toBe('');

    // <select> de Categoría: la única opción seleccionable que calza con
    // el estado inicial ('') es el placeholder deshabilitado -- nunca la
    // primera categoría real del catálogo.
    expect(screen.getByRole('option', { name: 'Seleccionar categoría...' })).toBeInTheDocument();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');

    // Ninguna variante de ejemplo/prueba precargada.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('TEST 2 (equivalente para producto): escribir datos, cerrar sin guardar y reabrir "Nuevo Producto" debe estar vacío otra vez', () => {
    const { rerender } = render(
      <ProductFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingProduct={null}
        categories={[mockCategory]}
        initialSizes={mockSizes}
        initialColors={mockColors}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Ej\. Camisa Oxford/i), { target: { value: 'Producto A Sin Guardar' } });
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '999' } });

    // Cierra (ProductsView.tsx SIEMPRE mantiene este componente montado --
    // `isOpen` es lo único que cambia, nunca se desmonta -- ver
    // ProductsView.tsx línea ~508) sin guardar, y reabre para otro
    // producto nuevo.
    rerender(
      <ProductFormModal
        isOpen={false}
        onClose={vi.fn()}
        editingProduct={null}
        categories={[mockCategory]}
        initialSizes={mockSizes}
        initialColors={mockColors}
        onSave={vi.fn()}
      />
    );
    rerender(
      <ProductFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingProduct={null}
        categories={[mockCategory]}
        initialSizes={mockSizes}
        initialColors={mockColors}
        onSave={vi.fn()}
      />
    );

    expect((screen.getByPlaceholderText(/Ej\. Camisa Oxford/i) as HTMLInputElement).value).toBe('');
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('');
  });
});

describe('ProductFormModal -- Objetivo 5: cargar un producto para editar preserva un stockMinimo real de 0', () => {
  it('un producto guardado con stockMinimo: 0 (alerta desactivada a propósito) se muestra como 0, no como el valor de ejemplo "5"', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
    ]);
    product.stockMinimo = 0;
    product.marca = '';
    renderModal(product);

    const numberInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    const stockMinimoInput = numberInputs.find((i) => i.value === '0');
    expect(stockMinimoInput).toBeTruthy();
    expect((screen.getByPlaceholderText(/Ej\. Genérica, Samsung/i) as HTMLInputElement).value).toBe('');
  });
});

describe('ProductFormModal -- Objetivos 3/4: "Vaciar Todas" deja el estado real en [], nunca reaparecen variantes eliminadas', () => {
  it('TEST 5: tras "Vaciar Todas" el conteo real es 0 -- guardar con "tiene variantes" activo exige generar de nuevo (prueba que el estado interno de verdad quedó vacío, no solo oculto en la UI)', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
      { id: 'VAR-000002', productoId: 'PROD-VAR-01', sku: 'SKU-M-NEG', codigoBarras: '2', color: 'Negro', talla: 'M', costo: 300, precio: 700, stock: 3, estado: 'ACTIVO' },
    ]);
    const { onSave } = renderModal(product);

    expect(screen.getByText(/Combinaciones Generadas \(2\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Vaciar Todas/i }));

    expect(screen.getByText(/Combinaciones Generadas \(0\)/i)).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      'Variantes Vaciadas',
      expect.stringContaining('eliminaron todas'),
      'informacion'
    );

    // Si el estado real NO hubiera quedado en [] (ej. solo se hubiera
    // ocultado en la tabla), este intento de guardar pasaría de largo en
    // vez de exigir generar de nuevo -- es la prueba de que el array
    // interno de verdad es [].
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));
    expect(showToast).toHaveBeenCalledWith(
      'Variantes Requeridas',
      expect.stringContaining('Generar Combinaciones'),
      'error'
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('TEST 6: tras "Vaciar Todas", crear una nueva talla/color genera ÚNICAMENTE la combinación nueva -- ninguna variante anterior regresa', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
      { id: 'VAR-000002', productoId: 'PROD-VAR-01', sku: 'SKU-M-NEG', codigoBarras: '2', color: 'Negro', talla: 'M', costo: 300, precio: 700, stock: 3, estado: 'ACTIVO' },
    ]);
    renderModal(product);

    fireEvent.click(screen.getByRole('button', { name: /Vaciar Todas/i }));
    expect(screen.getByText(/Combinaciones Generadas \(0\)/i)).toBeInTheDocument();

    // "Vaciar Todas" también limpia la selección de tallas/colores del
    // generador de matriz -- S/M/Negro ya no aparecen marcados. Se agrega
    // una combinación totalmente nueva (L/Blanco) a mano.
    addVariant('L', 'Blanco');

    expect(screen.getByText(/Combinaciones Generadas \(1\)/i)).toBeInTheDocument();
    const table = variantsTable();
    expect(within(table).getByText('L')).toBeInTheDocument();
    expect(within(table).getByText('Blanco')).toBeInTheDocument();
    // Ninguna de las combinaciones anteriores (S/Negro, M/Negro) reaparece.
    expect(within(table).queryByText('S')).not.toBeInTheDocument();
    expect(within(table).queryByText('M')).not.toBeInTheDocument();
  });

  it('TEST 10: "Vaciar Todas" + guardar envía variantes:[] y las 2 ids reales en deletedVariantIds', () => {
    const product = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-VAR-01', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
      { id: 'VAR-000002', productoId: 'PROD-VAR-01', sku: 'SKU-M-NEG', codigoBarras: '2', color: 'Negro', talla: 'M', costo: 300, precio: 700, stock: 3, estado: 'ACTIVO' },
    ]);
    const { onSave } = renderModal(product);

    fireEvent.click(screen.getByRole('button', { name: /Vaciar Todas/i }));
    // Producto simple sin variantes: desactiva "tiene variantes" para
    // poder guardar (con 0 combinaciones, ya no exige generar ninguna).
    fireEvent.click(screen.getByLabelText(/Este producto tiene variantes/i));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.variantes.filter((v: any) => v.talla && v.talla !== 'U').length).toBe(0);
    expect(payload.deletedVariantIds.sort()).toEqual(['VAR-000001', 'VAR-000002']);
  });
});

describe('ProductFormModal -- Objetivo 5: "Nuevo Producto" nunca hereda variantes de una edición anterior en el mismo modal', () => {
  it('TEST 8: editar el Producto A (con variantes) y luego abrir "Nuevo Producto" -- el nuevo formulario no trae ninguna variante de A', () => {
    const productA = makeVariantProduct([
      { id: 'VAR-000001', productoId: 'PROD-A', sku: 'SKU-S-NEG', codigoBarras: '1', color: 'Negro', talla: 'S', costo: 300, precio: 700, stock: 5, estado: 'ACTIVO' },
      { id: 'VAR-000002', productoId: 'PROD-A', sku: 'SKU-M-ROJ', codigoBarras: '2', color: 'Rojo', talla: 'M', costo: 300, precio: 700, stock: 3, estado: 'ACTIVO' },
    ]);

    // ProductsView.tsx SIEMPRE mantiene un único ProductFormModal montado
    // -- editingProduct/isOpen son las únicas props que cambian al pasar
    // de "editar A" a "nuevo producto" (nunca se desmonta/remonta el
    // componente). `rerender` reproduce exactamente esa misma transición.
    const { rerender } = render(
      <ProductFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingProduct={productA}
        categories={[mockCategory]}
        initialSizes={mockSizes}
        initialColors={mockColors}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/Combinaciones Generadas \(2\)/i)).toBeInTheDocument();

    // Cierra el editor de A (isOpen=false, como hace onClose) y abre
    // "Nuevo Producto" (editingProduct=null, isOpen=true).
    rerender(
      <ProductFormModal
        isOpen={false}
        onClose={vi.fn()}
        editingProduct={productA}
        categories={[mockCategory]}
        initialSizes={mockSizes}
        initialColors={mockColors}
        onSave={vi.fn()}
      />
    );
    rerender(
      <ProductFormModal
        isOpen={true}
        onClose={vi.fn()}
        editingProduct={null}
        categories={[mockCategory]}
        initialSizes={mockSizes}
        initialColors={mockColors}
        onSave={vi.fn()}
      />
    );

    // Producto B: sin ninguna variante de A, ni marca/costo/precio heredados.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText(/Ej\. Camisa Oxford/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText(/Ej\. Genérica, Samsung/i) as HTMLInputElement).value).toBe('');
    const numberInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(numberInputs[0].value).toBe('');
    expect(numberInputs[1].value).toBe('');
  });
});
