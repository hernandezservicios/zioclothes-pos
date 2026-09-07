import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ReturnsView } from './ReturnsView';
import { DataStoreProvider } from '../../context/DataStoreContext';
import { formatCurrency } from '../../utils/formatters';
import type { Sale } from '../../types';

const formatCurrencyRD = (amount: number) => formatCurrency(amount, 'RD$');

/**
 * MEJORA POS -- DEVOLUCIÓN DIRECTA DESDE HISTORIAL DE VENTAS.
 *
 * A diferencia de un mock completo de useDataStore, estas pruebas envuelven
 * ReturnsView en el DataStoreProvider REAL -- es la única forma de probar
 * honestamente que `initialSaleNumber` reutiliza exactamente
 * refreshSales()/getSales() (mismo mecanismo ya verificado para
 * getCustomers() en la mejora anterior) y la MISMA función de búsqueda
 * (performSaleSearch) que usa el formulario manual, sin una segunda ruta
 * de carga que se salte sus validaciones.
 */

const { salesApiList, returnsApiList, returnsApiCreate, refreshActiveCashSession, showToast } = vi.hoisted(() => ({
  salesApiList: vi.fn(),
  returnsApiList: vi.fn(),
  returnsApiCreate: vi.fn(),
  refreshActiveCashSession: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../services/salesApi', () => ({
  salesApi: { list: salesApiList },
}));
vi.mock('../../services/returnsApi', () => ({
  returnsApi: { list: returnsApiList, create: returnsApiCreate },
}));
// Necesarios porque, tras un returns.create exitoso, ReturnsView invalida
// products/credits/customers (y creditNotes si se emitió un vale/nota) --
// mismos mocks mínimos para que ese camino no dispare llamadas de red
// reales durante las pruebas de devolución parcial/total/formas de
// reembolso que continúan manualmente después de la carga automática.
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
    settings: { simboloMoneda: 'RD$' },
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

// MEJORA POS -- DEVOLUCIÓN PARCIAL/MÚLTIPLE: reproduce EXACTAMENTE el
// ejemplo del reporte -- VEN-000117, RD$640 = 2 prendas de RD$320,
// deliberadamente con el MISMO nombre de producto (TEST 21: se
// distinguen por varianteId, nunca por nombre).
const saleTwoLines: Sale = {
  ...sale117,
  items: [
    {
      id: 'ITM-A', productoId: 'P-A', varianteId: 'VAR-A', nombreProducto: 'Vestido Casual Test', sku: 'SKU-A',
      talla: 'M', color: 'Blanco Perla', cantidad: 1, costoUnitario: 150, precioUnitario: 320,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 320, impuestoMonto: 0, total: 320,
    },
    {
      id: 'ITM-B', productoId: 'P-B', varianteId: 'VAR-B', nombreProducto: 'Vestido Casual Test', sku: 'SKU-B',
      talla: '36', color: 'Blanco Perla', cantidad: 1, costoUnitario: 150, precioUnitario: 320,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 320, impuestoMonto: 0, total: 320,
    },
  ],
  subtotal: 640,
  total: 640,
};

// Selecciona el checkbox de una línea por su identificador REAL (nunca
// por nombre) -- mismo aria-label que arma ReturnsView.tsx.
function checkLine(nombreProducto: string, talla: string, color: string) {
  fireEvent.click(screen.getByLabelText(`Seleccionar ${nombreProducto} talla ${talla} color ${color}`));
}

function setLineQuantity(varianteId: string, value: string) {
  const input = document.getElementById(`return-qty-${varianteId}`);
  if (!input) throw new Error(`No se encontró el input de cantidad para ${varianteId} -- ¿la línea no está marcada?`);
  fireEvent.change(input, { target: { value } });
}

// Flujo completo del botón principal: abre el resumen de confirmación
// (Sección 14) y lo acepta -- clic en "Confirmar Devolución e Incrementar
// Stock" NUNCA ejecuta la devolución por sí solo (Sección 9).
async function confirmAndSubmit() {
  fireEvent.click(screen.getByText('Confirmar Devolución e Incrementar Stock'));
  await screen.findByText('¿Confirmar devolución?');
  fireEvent.click(screen.getByText('Sí, continuar'));
}

function renderReturns(initialSaleNumber?: string) {
  return render(
    <DataStoreProvider>
      <ReturnsView initialSaleNumber={initialSaleNumber} />
    </DataStoreProvider>
  );
}

// main.tsx envuelve TODA la app real en <React.StrictMode> -- en
// desarrollo, StrictMode monta cada componente, lo desmonta (corriendo la
// limpieza de sus efectos) y lo vuelve a montar de inmediato, precisamente
// para exponer efectos que no sean seguros de reiniciar. Un render() sin
// StrictMode (como el resto de este archivo) NUNCA ejercita ese doble
// montaje -- por eso esta prueba, dedicada, envuelve explícitamente en
// StrictMode: es la única forma honesta de reproducir el bug real
// reportado (la carga automática funcionaba en pruebas normales pero
// fallaba en la app real).
function renderReturnsStrict(initialSaleNumber?: string) {
  return render(
    <React.StrictMode>
      <DataStoreProvider>
        <ReturnsView initialSaleNumber={initialSaleNumber} />
      </DataStoreProvider>
    </React.StrictMode>
  );
}

describe('ReturnsView -- venta precargada automáticamente desde Historial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    returnsApiList.mockResolvedValue({ success: true, data: [] });
  });
  afterEach(() => cleanup());

  // TEST 8
  it('con initialSaleNumber, la venta correcta queda precargada -- sin presionar "Buscar Venta"', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117, saleConsumidorFinal] });

    renderReturns('VEN-000117');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(screen.getByText('Cliente: Ivette Maria Lora Peguero')).toBeInTheDocument();
    // El formulario de devolución ya está habilitado (paso 2), no el
    // placeholder de "busque una factura".
    expect(screen.getByText('Seleccionar Productos a Devolver:')).toBeInTheDocument();
    // Nunca se reportó un falso "no encontrada" mientras sales.list
    // resolvía de forma asíncrona.
    expect(showToast).not.toHaveBeenCalledWith('Venta no encontrada', expect.anything(), expect.anything());
  });

  // Regresión real reportada: en la app real (envuelta en StrictMode) el
  // número de venta llegaba a precargarse en el campo, pero la búsqueda
  // automática nunca se ejecutaba -- el formulario se quedaba en "Busque
  // una factura...". Causa: el doble montaje de StrictMode ejecutaba este
  // efecto dos veces; la primera invocación se cancelaba (cleanup) antes
  // de que refreshSales() resolviera, y la segunda invocación abortaba de
  // inmediato por el guard `handledSaleNumberRef` (ya marcado por la
  // primera) -- ninguna de las dos llegaba a llamar performSaleSearch.
  it('[StrictMode -- reproduce el bug real] la carga automática también funciona bajo React.StrictMode (doble montaje de efectos)', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });

    renderReturnsStrict('VEN-000117');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(screen.getByText('Cliente: Ivette Maria Lora Peguero')).toBeInTheDocument();
    expect(screen.getByText('Seleccionar Productos a Devolver:')).toBeInTheDocument();
    expect(screen.queryByText('Busque una factura para habilitar el formulario de devolución')).not.toBeInTheDocument();
  });

  // TEST 9
  it('NO se ejecuta ninguna devolución automáticamente -- solo se carga la venta', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns('VEN-000117');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(returnsApiCreate).not.toHaveBeenCalled();
  });

  // TEST 10
  it('reutiliza la lógica existente: el buscador queda con el mismo código, listo para "Buscar Venta" de nuevo si hiciera falta', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns('VEN-000117');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('VEN-000001')).toHaveValue('VEN-000117');
  });

  // TEST 11
  it('funciona con una venta de Consumidor Final (sin cliente registrado)', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [saleConsumidorFinal] });
    renderReturns('VEN-000112');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000112')).toBeInTheDocument());
    expect(screen.getByText('Cliente: Consumidor Final')).toBeInTheDocument();
    expect(screen.getByText('Seleccionar Productos a Devolver:')).toBeInTheDocument();
  });

  // TEST 12
  it('funciona con una venta que sí tiene cliente registrado', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns('VEN-000117');

    await waitFor(() => expect(screen.getByText('Cliente: Ivette Maria Lora Peguero')).toBeInTheDocument());
  });

  // TEST 13
  it('venta ANULADA (no elegible): conserva el mismo rechazo que el flujo manual, sin cargar el formulario', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [saleAnulada] });
    renderReturns('VEN-000099');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Venta Anulada', 'Esta venta está anulada y no admite devoluciones.', 'advertencia')
    );
    expect(screen.queryByText(/^Venta: VEN-000099/)).not.toBeInTheDocument();
    expect(screen.getByText('Busque una factura para habilitar el formulario de devolución')).toBeInTheDocument();
  });

  it('venta inexistente: conserva el mismo rechazo "no encontrada" que el flujo manual', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns('VEN-999999');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Venta no encontrada',
        expect.stringContaining('VEN-999999'),
        'error'
      )
    );
  });

  it('sin initialSaleNumber: el comportamiento existente no cambia (nada precargado, buscador vacío)', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns(undefined);

    await waitFor(() => expect(salesApiList).toHaveBeenCalled());
    expect(screen.queryByText(/^Venta: VEN-/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('VEN-000001')).toHaveValue('');
  });

  it('el buscador manual sigue funcionando exactamente igual (Buscar Venta)', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns(undefined);
    await waitFor(() => expect(salesApiList).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('VEN-000001'), { target: { value: 'VEN-000117' } });
    fireEvent.click(screen.getByText('Buscar Venta'));

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
  });

  // TEST 5
  it('el producto de la venta aparece disponible para seleccionar tras la carga automática', async () => {
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns('VEN-000117');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(screen.getByLabelText('Seleccionar Blusa Seda talla M color Negro')).toBeInTheDocument();
  });

  // TEST 11
  it('la carga automática NO refresca/incrementa inventario -- solo busca la venta', async () => {
    const { productsApi } = await import('../../services/productsApi');
    salesApiList.mockResolvedValue({ success: true, data: [sale117] });
    renderReturns('VEN-000117');

    await waitFor(() => expect(screen.getByText('Venta: VEN-000117')).toBeInTheDocument());
    expect(productsApi.list).not.toHaveBeenCalled();
  });
});

describe('ReturnsView -- selección múltiple de productos de una misma factura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    returnsApiList.mockResolvedValue({ success: true, data: [] });
    returnsApiCreate.mockResolvedValue({ success: true, message: 'Devolución procesada', data: {} });
  });
  afterEach(() => cleanup());

  async function loadAndOpenForm(sale: Sale) {
    salesApiList.mockResolvedValue({ success: true, data: [sale] });
    renderReturns(sale.numeroVenta);
    await waitFor(() => expect(screen.getByText(`Venta: ${sale.numeroVenta}`)).toBeInTheDocument());
  }

  // TEST 1
  it('una factura con 2 productos: ambos aparecen con su propio checkbox', async () => {
    await loadAndOpenForm(saleTwoLines);

    expect(screen.getByLabelText('Seleccionar Vestido Casual Test talla M color Blanco Perla')).toBeInTheDocument();
    expect(screen.getByLabelText('Seleccionar Vestido Casual Test talla 36 color Blanco Perla')).toBeInTheDocument();
  });

  // TEST 2
  it('seleccionar solo el producto A: el producto B queda sin seleccionar', async () => {
    await loadAndOpenForm(saleTwoLines);

    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');

    const checkboxA = screen.getByLabelText('Seleccionar Vestido Casual Test talla M color Blanco Perla') as HTMLInputElement;
    const checkboxB = screen.getByLabelText('Seleccionar Vestido Casual Test talla 36 color Blanco Perla') as HTMLInputElement;
    expect(checkboxA.checked).toBe(true);
    expect(checkboxB.checked).toBe(false);
  });

  // TEST 3
  it('seleccionar A: el monto corresponde únicamente a A', async () => {
    await loadAndOpenForm(saleTwoLines);
    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');

    // RD$320.00 también aparece en el precio de cada checkbox -- se acota
    // al resumen (junto a su propia etiqueta) para evitar ambigüedad.
    const montoLabel = screen.getByText('Monto Estimado a Reembolsar / Acreditar:');
    const resumen = montoLabel.closest('div') as HTMLElement;
    expect(within(resumen).getByText(formatCurrencyRD(320))).toBeInTheDocument();
    expect(within(resumen).queryByText(formatCurrencyRD(640))).not.toBeInTheDocument();
  });

  // TEST 4
  it('seleccionar A + B: el monto corresponde a ambos', async () => {
    await loadAndOpenForm(saleTwoLines);
    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');
    checkLine('Vestido Casual Test', '36', 'Blanco Perla');

    // RD$640.00 también es el "Total Original" de la factura completa
    // (panel izquierdo) -- se acota al resumen de la devolución.
    const montoLabel = screen.getByText('Monto Estimado a Reembolsar / Acreditar:');
    const resumen = montoLabel.closest('div') as HTMLElement;
    expect(within(resumen).getByText(formatCurrencyRD(640))).toBeInTheDocument();
  });

  // TEST 5 (backend) -- TEST 6 (preview de estado, aquí a nivel de UI)
  it('seleccionar solo A: la UI anticipa DEVUELTA_PARCIAL; seleccionar A+B: anticipa DEVUELTA_TOTAL', async () => {
    await loadAndOpenForm(saleTwoLines);

    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');
    expect(screen.getByText('DEVUELTA_PARCIAL')).toBeInTheDocument();

    checkLine('Vestido Casual Test', '36', 'Blanco Perla');
    expect(screen.getByText('DEVUELTA_TOTAL')).toBeInTheDocument();
  });

  // TEST 7
  it('una línea con cantidad 5 permite devolver una cantidad parcial', async () => {
    const saleQtyFive: Sale = {
      ...sale117,
      items: [{ ...sale117.items[0], cantidad: 5, subtotal: 3200, total: 3200 }],
      subtotal: 3200,
      total: 3200,
    };
    await loadAndOpenForm(saleQtyFive);

    checkLine('Blusa Seda', 'M', 'Negro');
    setLineQuantity('V1', '2');

    expect(screen.getByText(formatCurrencyRD(1280))).toBeInTheDocument(); // 2 x 640
  });

  // TEST 8
  it('después de que el backend confirma 2 de 5 ya devueltas, solo permite devolver 3', async () => {
    const saleQtyFive: Sale = {
      ...sale117,
      items: [{ ...sale117.items[0], cantidad: 5, subtotal: 3200, total: 3200 }],
      subtotal: 3200,
      total: 3200,
    };
    returnsApiList.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'DEV-1', numeroDevolucion: 'DEV-000001', ventaId: sale117.id, numeroVenta: sale117.numeroVenta,
          clienteNombre: sale117.clienteNombre, items: [{ varianteId: 'V1', cantidad: 2 }], montoDevuelto: 1280,
          tipoReembolso: 'EFECTIVO', motivo: 'Ya devuelto', usuarioId: 'USR-T01', usuarioNombre: 'Cajera', fecha: '2026-09-02 00:00:00',
        },
      ],
    });
    await loadAndOpenForm(saleQtyFive);

    expect(screen.getByText(/Facturadas: 5 · Devueltas: 2 · Disponibles:/)).toBeInTheDocument();
    checkLine('Blusa Seda', 'M', 'Negro');
    setLineQuantity('V1', '4'); // excede lo disponible (3)

    expect(screen.getByText('Máximo 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar Devolución e Incrementar Stock' })).toBeDisabled();
  });

  // TEST 13
  it('devolución PARCIAL: returns.create recibe únicamente la línea/cantidad seleccionada', async () => {
    const saleTwoUnits: Sale = {
      ...sale117,
      id: 'VEN-200', numeroVenta: 'VEN-000200',
      items: [{ ...sale117.items[0], cantidad: 2, subtotal: 1280, total: 1280 }],
      subtotal: 1280, total: 1280,
    };
    await loadAndOpenForm(saleTwoUnits);

    checkLine('Blusa Seda', 'M', 'Negro');
    setLineQuantity('V1', '1');
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    const payload = returnsApiCreate.mock.calls[0][0];
    expect(payload.ventaId).toBe('VEN-200');
    expect(payload.items).toEqual([{ varianteId: 'V1', cantidad: 1 }]);
  });

  // TEST 14
  it('devolución TOTAL: returns.create recibe la cantidad total vendida', async () => {
    const saleTwoUnits: Sale = {
      ...sale117,
      id: 'VEN-200', numeroVenta: 'VEN-000200',
      items: [{ ...sale117.items[0], cantidad: 2, subtotal: 1280, total: 1280 }],
      subtotal: 1280, total: 1280,
    };
    await loadAndOpenForm(saleTwoUnits);

    checkLine('Blusa Seda', 'M', 'Negro');
    setLineQuantity('V1', '2');
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].items).toEqual([{ varianteId: 'V1', cantidad: 2 }]);
  });

  // TEST 4 (backend) -- aquí a nivel de UI: ambas líneas en una sola petición.
  it('seleccionar A + B: returns.create recibe AMBAS líneas en una sola petición', async () => {
    await loadAndOpenForm(saleTwoLines);
    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');
    checkLine('Vestido Casual Test', '36', 'Blanco Perla');
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].items).toEqual([
      { varianteId: 'VAR-A', cantidad: 1 },
      { varianteId: 'VAR-B', cantidad: 1 },
    ]);
  });

  // TEST 15
  it('Vale a Tienda continúa funcionando', async () => {
    await loadAndOpenForm(sale117);
    checkLine('Blusa Seda', 'M', 'Negro');

    fireEvent.change(screen.getByLabelText('Forma de Reembolso:'), { target: { value: 'VALE_TIENDA' } });
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].tipoReembolso).toBe('VALE_TIENDA');
  });

  // TEST 16
  it('Nota de Crédito continúa funcionando', async () => {
    await loadAndOpenForm(sale117);
    checkLine('Blusa Seda', 'M', 'Negro');

    fireEvent.change(screen.getByLabelText('Forma de Reembolso:'), { target: { value: 'NOTA_CREDITO' } });
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].tipoReembolso).toBe('NOTA_CREDITO');
  });

  // Crédito a Cuenta: la venta original fue a crédito (cuentaCobrarId); el
  // aviso y el envío siguen intactos con la nueva selección múltiple.
  it('venta original a crédito ("Crédito a Cuenta"): el aviso y el envío a returns.create siguen funcionando', async () => {
    const saleCredito: Sale = { ...sale117, id: 'VEN-201', numeroVenta: 'VEN-000201', cuentaCobrarId: 'CRED-201' };
    await loadAndOpenForm(saleCredito);

    expect(screen.getByText(/el saldo pendiente del cliente se reducirá automáticamente/)).toBeInTheDocument();

    checkLine('Blusa Seda', 'M', 'Negro');
    await confirmAndSubmit();
    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].ventaId).toBe('VEN-201');
  });

  // TEST 18 (Efectivo, forma de reembolso por defecto)
  it('Efectivo (default) continúa funcionando', async () => {
    await loadAndOpenForm(sale117);
    checkLine('Blusa Seda', 'M', 'Negro');
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].tipoReembolso).toBe('EFECTIVO');
    await waitFor(() => expect(refreshActiveCashSession).toHaveBeenCalled());
  });

  // TEST 17
  it('el botón "Confirmar Devolución e Incrementar Stock" está deshabilitado sin ningún producto seleccionado', async () => {
    await loadAndOpenForm(saleTwoLines);
    expect(screen.getByRole('button', { name: 'Confirmar Devolución e Incrementar Stock' })).toBeDisabled();
  });

  it('el botón se habilita al seleccionar un producto válido', async () => {
    await loadAndOpenForm(saleTwoLines);
    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');
    expect(screen.getByRole('button', { name: 'Confirmar Devolución e Incrementar Stock' })).not.toBeDisabled();
  });

  // TEST 18 (las confirmaciones siguen funcionando): marcar checkboxes
  // nunca ejecuta la devolución -- se necesita el resumen + "Sí, continuar".
  it('marcar checkboxes nunca ejecuta la devolución por sí solo -- se requiere el resumen de confirmación', async () => {
    await loadAndOpenForm(sale117);
    checkLine('Blusa Seda', 'M', 'Negro');
    setLineQuantity('V1', '1');

    expect(returnsApiCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirmar Devolución e Incrementar Stock'));
    await screen.findByText('¿Confirmar devolución?');
    expect(returnsApiCreate).not.toHaveBeenCalled(); // abrir el resumen tampoco ejecuta nada

    fireEvent.click(screen.getByText('Cancelar'));
    expect(screen.queryByText('¿Confirmar devolución?')).not.toBeInTheDocument();
    expect(returnsApiCreate).not.toHaveBeenCalled(); // cancelar el resumen tampoco

    fireEvent.click(screen.getByText('Confirmar Devolución e Incrementar Stock'));
    await screen.findByText('¿Confirmar devolución?');
    fireEvent.click(screen.getByText('Sí, continuar'));
    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1)); // solo aquí se ejecuta
  });

  it('el resumen de confirmación muestra la venta, los productos seleccionados, el total y la forma de reembolso', async () => {
    await loadAndOpenForm(saleTwoLines);
    checkLine('Vestido Casual Test', 'M', 'Blanco Perla');

    fireEvent.click(screen.getByText('Confirmar Devolución e Incrementar Stock'));
    await screen.findByText('¿Confirmar devolución?');

    expect(screen.getByText('VEN-000117')).toBeInTheDocument();
    expect(screen.getByText(/Vestido Casual Test — Talla M — 1 unidad/)).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
  });

  // TEST 21 (a nivel de UI): dos líneas con el mismo nombre se distinguen
  // por varianteId -- marcar una nunca marca/afecta la otra.
  it('dos líneas con el mismo nombre de producto se distinguen y se procesan de forma independiente', async () => {
    await loadAndOpenForm(saleTwoLines);
    checkLine('Vestido Casual Test', '36', 'Blanco Perla');
    await confirmAndSubmit();

    await waitFor(() => expect(returnsApiCreate).toHaveBeenCalledTimes(1));
    expect(returnsApiCreate.mock.calls[0][0].items).toEqual([{ varianteId: 'VAR-B', cantidad: 1 }]);
  });
});
