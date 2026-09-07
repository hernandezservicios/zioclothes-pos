import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Sale, SaleItem } from '../../types';
import { returnsApi } from '../../services/returnsApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { RotateCcw, Search, CheckCircle2, AlertTriangle, ArrowRight, Package, RefreshCcw } from 'lucide-react';

/**
 * MEJORA POS -- DEVOLUCIÓN PARCIAL/MÚLTIPLE DE PRODUCTOS DE UNA MISMA
 * FACTURA: estado de selección de UNA línea de la venta. Se identifica
 * SIEMPRE por `varianteId` (el identificador real y estable de la línea,
 * ya usado por `SaleItem`/`Venta_Items`/`recalculateReturnAuthoritatively`
 * en el backend) -- nunca por nombre de producto, precio ni posición
 * visual, para no confundir dos líneas de una misma factura que compartan
 * nombre pero sean tallas/colores distintos.
 */
interface ReturnLineSelection {
  selected: boolean;
  cantidad: number | string;
}

interface ReturnsViewProps {
  /**
   * MEJORA POS (devolución directa desde Historial de Ventas): número de
   * venta (Sale.numeroVenta) con el que se debe precargar el buscador y
   * ejecutar automáticamente la MISMA búsqueda que "Buscar Venta" -- nunca
   * una segunda ruta de carga que se salte alguna de sus validaciones
   * (venta inexistente / ANULADA / etc.). `undefined` conserva el
   * comportamiento actual sin cambios (llegar aquí desde el menú, sin
   * ninguna venta preseleccionada).
   */
  initialSaleNumber?: string;
}

export const ReturnsView: React.FC<ReturnsViewProps> = ({ initialSaleNumber }) => {
  const { currentUser, settings, hasPermission, refreshActiveCashSession } = useAuth();
  const { showToast } = useToast();

  // FASE 3.7F / CORREGIR AUDITORÍA: ventas reales leídas del DataStore
  // central (misma colección compartida con SalesView/Dashboard/Reportes
  // -- antes cada una pedía sales.list por su cuenta, ver informe de
  // auditoría). FASE 10 (auditoría E2E): `returns` pasa a ser TAMBIÉN un
  // dominio compartido del DataStore (antes era exclusivo de esta vista,
  // con su propio useState/fetch local) -- Dashboard y Reportes ahora
  // también lo consumen para calcular "ventas netas" restando lo
  // realmente devuelto, en vez de cada uno inventar su propio filtro.
  const {
    sales,
    salesLoading,
    salesError,
    salesStale,
    refreshSales,
    refreshProducts,
    refreshCredits,
    refreshCreditNotes,
    refreshCustomers,
    returns,
    returnsLoading,
    returnsError,
    refreshReturns,
    getSales,
  } = useDataStore();

  useEffect(() => {
    refreshSales();
    refreshReturns();
  }, [refreshSales, refreshReturns]);

  const [searchSaleCode, setSearchSaleCode] = useState('');
  const [foundSale, setFoundSale] = useState<Sale | null>(null);

  // Return Form State -- MEJORA POS (selección múltiple): una factura
  // puede tener varias prendas; cada una se marca/desmarca y edita su
  // propia cantidad de forma independiente, en vez de forzar un único
  // producto por dropdown. `returnReason`/`refundType` siguen siendo
  // decisiones a nivel de TODA la devolución (el backend solo acepta un
  // `tipoReembolso` por petición, no uno distinto por línea) -- sin cambios.
  const [returnSelections, setReturnSelections] = useState<Record<string, ReturnLineSelection>>({});
  const [returnReason, setReturnReason] = useState('Cambio por talla diferente');
  const [refundType, setRefundType] = useState<string>('EFECTIVO');
  const [processing, setProcessing] = useState(false);
  // MEJORA POS (Sección 14 -- confirmación adicional antes de procesar):
  // marcar/desmarcar checkboxes NUNCA ejecuta la devolución por sí solo
  // (Sección 9). Al presionar "Confirmar Devolución e Incrementar Stock"
  // se abre este resumen -- solo "Sí, continuar" dispara la llamada real a
  // returnsApi.create (ejecutada en executeProcessReturn). Esto es
  // ADICIONAL a las dos confirmaciones ya existentes del flujo de
  // Devolución Directa (Historial -> SalesView), que no se tocan.
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  // FASE 6: confirmación visible del Crédito a Favor/Nota de Crédito recién
  // emitido por el backend (creditoFavorEmitido), si la devolución generó
  // uno -- se limpia al buscar otra venta o iniciar una nueva devolución.
  const [lastIssuedCreditNote, setLastIssuedCreditNote] = useState<{
    numero: string;
    tipo: 'VALE_TIENDA' | 'NOTA_CREDITO';
    montoOriginal: number;
  } | null>(null);

  // MEJORA POS (devolución directa): misma lógica que antes vivía dentro
  // de handleSearchSale, extraída para que tanto el formulario manual
  // como la precarga automática desde Historial ejecuten EXACTAMENTE el
  // mismo camino -- nunca una segunda implementación que pudiera divergir
  // (saltarse la validación de ANULADA, por ejemplo).
  const performSaleSearch = useCallback(
    (rawCode: string, salesList: Sale[]) => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return;

      const sale = (salesList || []).find((s) => s.numeroVenta.toUpperCase() === code || s.id === code);
      if (!sale) {
        showToast('Venta no encontrada', `No existe ninguna venta con el número ${code} en el historial real.`, 'error');
        setFoundSale(null);
        return;
      }

      if (sale.estado === 'ANULADA') {
        showToast('Venta Anulada', 'Esta venta está anulada y no admite devoluciones.', 'advertencia');
        setFoundSale(null);
        return;
      }

      setFoundSale(sale);
      // MEJORA POS (selección múltiple): al cargar/recargar una venta
      // (búsqueda manual O devolución directa desde Historial -- mismo
      // camino, ver comentario de más abajo) ninguna línea inicia
      // marcada -- el usuario decide explícitamente cuáles prendas
      // devolver (Sección 2: "NO debe ser obligatorio devolver toda la
      // factura").
      const initialSelections: Record<string, ReturnLineSelection> = {};
      (sale.items || []).forEach((it) => {
        initialSelections[it.varianteId] = { selected: false, cantidad: 1 };
      });
      setReturnSelections(initialSelections);
      setRefundType('EFECTIVO');
      setLastIssuedCreditNote(null);
      setShowConfirmSubmit(false);
    },
    [showToast]
  );

  const handleSearchSale = (e: React.FormEvent) => {
    e.preventDefault();
    performSaleSearch(searchSaleCode, sales);
  };

  // MEJORA POS (devolución directa desde Historial de Ventas): si se
  // llegó con un número de venta ya identificado, se precarga el
  // buscador Y se ejecuta la búsqueda automáticamente -- el usuario NO
  // debe presionar "Buscar Venta" de nuevo. `await refreshSales()` +
  // `getSales()` (en vez de la `sales` del closure de este efecto)
  // porque se necesita el arreglo recién traído del backend de forma
  // confiable, sin depender del timing de re-render de otro efecto (ver
  // el mismo fix ya aplicado en refreshCustomers/getCustomers).
  //
  // FIX (regresión real bajo React.StrictMode -- main.tsx envuelve toda la
  // app en <StrictMode>, que en desarrollo monta cada componente, corre la
  // limpieza de sus efectos y lo vuelve a montar de inmediato): la versión
  // anterior marcaba `handledSaleNumberRef.current = initialSaleNumber`
  // ANTES de iniciar la búsqueda. Bajo ese doble montaje, la PRIMERA
  // invocación del efecto se cancelaba (cleanup -> cancelled=true) antes
  // de que refreshSales() resolviera, y la SEGUNDA invocación abortaba de
  // inmediato porque el ref ya estaba marcado por la primera -- ninguna de
  // las dos llegaba a ejecutar performSaleSearch, aunque el campo de texto
  // sí quedaba precargado (esa línea corría antes de la cancelación). El
  // ref ahora se marca únicamente DESPUÉS de que la búsqueda real se
  // ejecuta con éxito (dentro del `.then()`, tras comprobar `cancelled`),
  // nunca por adelantado -- así, la invocación cancelada nunca "reclama"
  // el ref y bloquea a la invocación real que sí sobrevive.
  const handledSaleNumberRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialSaleNumber) return;
    if (handledSaleNumberRef.current === initialSaleNumber) return;

    let cancelled = false;
    setSearchSaleCode(initialSaleNumber);
    refreshSales().then(() => {
      if (cancelled) return;
      handledSaleNumberRef.current = initialSaleNumber;
      performSaleSearch(initialSaleNumber, getSales());
    });
    return () => {
      cancelled = true;
    };
  }, [initialSaleNumber, refreshSales, getSales, performSaleSearch]);

  // MEJORA POS (selección múltiple) -- por cada línea REAL de la venta
  // (identificada por varianteId, nunca por nombre): cuánto ya se devolvió
  // en devoluciones previas reales, cuánto queda disponible, y el estado
  // de selección/cantidad actual del usuario para esa línea. UX únicamente
  // -- el backend sigue siendo la autoridad real
  // (recalculateReturnAuthoritatively vuelve a validar cantidades contra
  // Devoluciones reales dentro del lock, Sección 20).
  const returnLineStates = useMemo(() => {
    if (!foundSale) return [] as Array<{
      item: SaleItem;
      selected: boolean;
      cantidad: number | string;
      yaDevuelta: number;
      disponible: number;
      cantidadNumerica: number;
      cantidadValida: boolean;
    }>;

    return (foundSale.items || []).map((item) => {
      const yaDevuelta = (returns || [])
        .filter((r) => r.ventaId === foundSale.id)
        .flatMap((r) => r.items || [])
        .filter((it) => it.varianteId === item.varianteId)
        .reduce((sum, it) => sum + (it.cantidad || 0), 0);
      const disponible = Math.max(0, item.cantidad - yaDevuelta);

      const sel = returnSelections[item.varianteId] || { selected: false, cantidad: 1 };
      const cantidadNumerica = typeof sel.cantidad === 'number' ? sel.cantidad : parseInt(String(sel.cantidad), 10);
      const cantidadValida = sel.selected && Number.isFinite(cantidadNumerica) && cantidadNumerica > 0 && cantidadNumerica <= disponible;

      return { item, selected: sel.selected, cantidad: sel.cantidad, yaDevuelta, disponible, cantidadNumerica, cantidadValida };
    });
  }, [foundSale, returns, returnSelections]);

  const checkedLines = returnLineStates.filter((l) => l.selected);
  const hasInvalidChecked = checkedLines.some((l) => !l.cantidadValida);
  const validSelectedLines = checkedLines.filter((l) => l.cantidadValida);

  const montoEstimadoDevolucion = useMemo(
    () => validSelectedLines.reduce((sum, l) => sum + l.item.precioUnitario * l.cantidadNumerica, 0),
    [validSelectedLines]
  );

  // Estimado SOLO para UX (Sección 21: "Estado después de esta
  // devolución") -- misma regla de negocio que ahora aplica el backend
  // (Sección 7: TOTAL únicamente si TODAS las líneas quedan completas),
  // nunca la autoridad real. `null` mientras no haya ninguna línea válida
  // seleccionada todavía.
  const estadoPreview = useMemo(() => {
    if (!foundSale || validSelectedLines.length === 0) return null;
    const todasCompletas = returnLineStates.every((l) => {
      const enEstaDevolucion = validSelectedLines.find((v) => v.item.varianteId === l.item.varianteId)?.cantidadNumerica || 0;
      return l.yaDevuelta + enEstaDevolucion >= l.item.cantidad;
    });
    return todasCompletas ? 'DEVUELTA_TOTAL' : 'DEVUELTA_PARCIAL';
  }, [foundSale, returnLineStates, validSelectedLines]);

  const handleToggleLine = (varianteId: string, checked: boolean) => {
    setReturnSelections((prev) => ({
      ...prev,
      [varianteId]: { cantidad: prev[varianteId]?.cantidad ?? 1, selected: checked },
    }));
  };

  const handleChangeLineQuantity = (varianteId: string, rawValue: string) => {
    setReturnSelections((prev) => {
      const current = prev[varianteId] || { selected: false, cantidad: 1 };
      if (rawValue === '') return { ...prev, [varianteId]: { ...current, cantidad: '' } };
      const num = parseInt(rawValue, 10);
      return { ...prev, [varianteId]: { ...current, cantidad: isNaN(num) ? current.cantidad : rawValue } };
    });
  };

  // Sección 15: el botón de envío solo se habilita cuando hay al menos una
  // línea seleccionada y válida, hay una venta cargada, y no hay ninguna
  // cantidad inválida entre las líneas marcadas.
  const canSubmitReturn = !!foundSale && validSelectedLines.length > 0 && !hasInvalidChecked && !processing;

  // Sección 14/9: presionar el botón principal NUNCA ejecuta la
  // devolución -- solo abre el resumen de confirmación. La llamada real
  // al backend vive en executeProcessReturn, disparada ÚNICAMENTE por
  // "Sí, continuar" de ese resumen.
  const handleClickProcessReturn = () => {
    if (!canSubmitReturn) return;
    if (!returnReason.trim()) {
      showToast('Motivo Requerido', 'Ingrese el motivo de la devolución.', 'error');
      return;
    }
    setShowConfirmSubmit(true);
  };

  const executeProcessReturn = async () => {
    if (processing) return; // previene doble submit
    if (!foundSale || !currentUser || validSelectedLines.length === 0) return;

    setShowConfirmSubmit(false);
    setProcessing(true);

    // FASE 3.7F / MEJORA POS (selección múltiple): returns.create real
    // (ReturnsController.handleCreateReturn) YA aceptaba un arreglo de
    // líneas -- CreateReturnPayload.items: Array<{varianteId, cantidad}>
    // nunca estuvo limitado a una sola prenda, solo esta pantalla lo
    // estaba. Se envían TODAS las líneas marcadas y válidas en una sola
    // petición; el backend recalcula precio/descuento/impuesto/total de
    // CADA línea desde Venta_Items real, reintegra stock línea por línea,
    // y ya integra caja y crédito internamente en la misma transacción.
    // Nunca se llama cashApi.addMovement() ni se toca
    // storageService.getCredits()/saveCredits() desde aquí.
    const res = await returnsApi.create({
      ventaId: foundSale.id,
      items: validSelectedLines.map((l) => ({ varianteId: l.item.varianteId, cantidad: l.cantidadNumerica })),
      motivo: returnReason.trim(),
      tipoReembolso: refundType,
    });

    setProcessing(false);

    if (res.success) {
      showToast('Devolución Procesada', res.message, 'exito');
      setFoundSale(null);
      setSearchSaleCode('');
      // FASE 6: si la devolución emitió un Crédito a Favor/Nota de Crédito
      // real (creditoFavorEmitido), se muestra su número de inmediato --
      // ausente si el reembolso fue en efectivo, si la venta ya tenía
      // cuenta por cobrar propia, o en devoluciones históricas.
      setLastIssuedCreditNote(res.data?.creditoFavorEmitido
        ? {
            numero: res.data.creditoFavorEmitido.numero,
            tipo: res.data.creditoFavorEmitido.tipo,
            montoOriginal: res.data.creditoFavorEmitido.montoOriginal,
          }
        : null);
      // CORREGIR AUDITORÍA (§5): invalida el DataStore central de ventas,
      // productos (stock reintegrado) y créditos (el backend reduce el
      // saldo de la cuenta por cobrar asociada si existía, sin importar
      // tipoReembolso -- ver ReturnsController.gs) -- POS/Catálogo/
      // Inventario/Créditos/Dashboard/Reportes reflejan el resultado de
      // inmediato, sin logout/login ni F5. Si el reembolso fue en
      // efectivo, la caja activa real también pudo cambiar. FASE 6: además
      // invalida creditNotes si se emitió un Crédito a Favor/Nota de
      // Crédito real.
      await Promise.all([
        refreshReturns({ force: true }),
        refreshSales({ force: true }),
        refreshProducts({ force: true }),
        refreshCredits({ force: true }),
        refreshCustomers({ force: true }),
        ...(res.data?.creditoFavorEmitido ? [refreshCreditNotes({ force: true })] : []),
      ]);
      if (refundType === 'EFECTIVO') {
        await refreshActiveCashSession();
      }
    } else {
      showToast('Error', res.message, 'error');
      // No se modifica stock, caja, crédito ni el historial mostrado --
      // siguen siendo los últimos reales confirmados por el backend.
    }
  };

  return (
    <div id="returns-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Servicio al Cliente & Garantías
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Devoluciones y Cambios
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            refreshSales({ force: true });
            refreshReturns({ force: true });
          }}
          disabled={salesLoading || returnsLoading}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          title="Volver a consultar el backend real"
        >
          <RefreshCcw className={`w-4 h-4 text-[#756E65] ${salesLoading || returnsLoading ? 'animate-spin' : ''}`} />
          <span>{salesLoading || returnsLoading ? 'Actualizando...' : 'Actualizar'}</span>
        </button>
      </div>

      {/* Errores reales del backend -- nunca se sustituyen por datos demo/locales */}
      {salesError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No se pudo cargar el historial real de ventas: {salesError}
              {salesStale && ' (se muestra la última información disponible, puede no estar actualizada)'}
            </span>
          </div>
          <button type="button" onClick={() => refreshSales({ force: true })} className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0">
            Reintentar
          </button>
        </div>
      )}
      {returnsError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudo cargar el historial real de devoluciones: {returnsError}</span>
          </div>
          <button type="button" onClick={() => refreshReturns({ force: true })} className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0">
            Reintentar
          </button>
        </div>
      )}

      {/* FASE 6: confirmación del Crédito a Favor/Nota de Crédito recién emitido */}
      {lastIssuedCreditNote && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              Se emitió {lastIssuedCreditNote.tipo === 'NOTA_CREDITO' ? 'la Nota de Crédito' : 'el Crédito a Favor / Vale'}{' '}
              <strong className="font-mono">{lastIssuedCreditNote.numero}</strong> por{' '}
              {formatCurrency(lastIssuedCreditNote.montoOriginal, settings.simboloMoneda)}. Puede consultarlo en{' '}
              {lastIssuedCreditNote.tipo === 'NOTA_CREDITO' ? '"Notas de Crédito"' : '"Créditos a Favor / Vales"'} en el menú.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastIssuedCreditNote(null)}
            className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-[11px] shrink-0"
          >
            Entendido
          </button>
        </div>
      )}

      {/* Top Action: Search Sale */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs">
          <h3 className="text-sm font-bold text-[#2F2A25] flex items-center gap-2">
            <Search className="w-4 h-4 text-[#756E65]" />
            <span>1. Buscar Factura de Venta</span>
          </h3>

          <form onSubmit={handleSearchSale} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-[#2F2A25] mb-1">
                Número de Venta (ej. VEN-000001):
              </label>
              <input
                type="text"
                placeholder="VEN-000001"
                value={searchSaleCode}
                onChange={(e) => setSearchSaleCode(e.target.value)}
                disabled={salesLoading}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] font-mono text-xs font-bold text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
              />
            </div>
            <button
              type="submit"
              disabled={salesLoading}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-[#2F2A25] hover:bg-[#403932] transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Search className="w-3.5 h-3.5 text-[#E8DCC8]" />
              <span>{salesLoading ? 'Cargando ventas...' : 'Buscar Venta'}</span>
            </button>
          </form>

          {/* Found Sale Preview */}
          {foundSale && (
            <div className="p-3 bg-[#FAF8F4] border border-[#E4DDD2] rounded-2xl space-y-2 text-xs">
              <div className="flex justify-between font-bold">
                <span>Venta: {foundSale.numeroVenta}</span>
                <span className="text-emerald-700">{foundSale.estado}</span>
              </div>
              <p className="text-[#756E65]">Cliente: {foundSale.clienteNombre}</p>
              <p className="text-[#756E65]">Fecha: {formatDateTime(foundSale.fecha)}</p>
              <p className="font-bold text-[#2F2A25]">
                Total Original: {formatCurrency(foundSale.total, settings.simboloMoneda)}
              </p>
              {foundSale.cuentaCobrarId && (
                <p className="text-amber-700 text-[10px] leading-relaxed">
                  ⚠ Esta venta fue a crédito: el saldo pendiente del cliente se reducirá automáticamente al procesar la devolución, sin importar la forma de reembolso elegida (así lo determina el backend real).
                </p>
              )}
            </div>
          )}
        </div>

        {/* Process Return Panel */}
        <div className="lg:col-span-2 bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs">
          <h3 className="text-sm font-bold text-[#2F2A25] flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-[#C2410C]" />
            <span>2. Procesar Devolución & Reingreso a Inventario</span>
          </h3>

          {!hasPermission('devoluciones.crear') ? (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <AlertTriangle className="w-10 h-10 opacity-30 mx-auto" />
              <p className="text-xs font-medium">No tiene permiso para procesar devoluciones.</p>
            </div>
          ) : !foundSale ? (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Package className="w-10 h-10 opacity-30 mx-auto" />
              <p className="text-xs font-medium">Busque una factura para habilitar el formulario de devolución</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* MEJORA POS (selección múltiple, Sección 2/3/4/21): cada
                  prenda de la factura tiene su propio checkbox + cantidad
                  independiente, identificada SIEMPRE por varianteId
                  (nunca por nombre -- dos líneas pueden llamarse igual y
                  ser tallas/colores distintos, Sección 4/21). El usuario
                  puede marcar una, varias, todas, o ninguna. */}
              <div>
                <label className="block text-xs font-bold text-[#2F2A25] mb-1.5 uppercase">
                  Seleccionar Productos a Devolver:
                </label>
                <div className="space-y-2">
                  {returnLineStates.map((line) => {
                    const agotada = line.disponible === 0;
                    return (
                      <label
                        key={line.item.varianteId}
                        className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${
                          agotada
                            ? 'bg-zinc-50 border-zinc-200 opacity-60 cursor-not-allowed'
                            : line.selected
                            ? 'bg-[#FAF8F4] border-[#2F2A25]'
                            : 'bg-white border-[#E4DDD2]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={line.selected}
                          disabled={processing || agotada}
                          onChange={(e) => handleToggleLine(line.item.varianteId, e.target.checked)}
                          className="mt-0.5 w-4 h-4 shrink-0"
                          aria-label={`Seleccionar ${line.item.nombreProducto} talla ${line.item.talla} color ${line.item.color}`}
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#2F2A25]">{line.item.nombreProducto}</span>
                            <span className="font-bold text-[#2F2A25] shrink-0">
                              {formatCurrency(line.item.precioUnitario, settings.simboloMoneda)}
                            </span>
                          </div>
                          <p className="text-[#756E65]">
                            Talla {line.item.talla} / {line.item.color}
                          </p>
                          <p className="text-[#756E65]">
                            Facturadas: {line.item.cantidad} · Devueltas: {line.yaDevuelta} · Disponibles:{' '}
                            <span className={agotada ? 'text-rose-700 font-bold' : 'font-bold text-[#2F2A25]'}>
                              {line.disponible}
                            </span>
                          </p>
                          {agotada && (
                            <p className="text-[10px] text-rose-700">Esta prenda ya fue devuelta en su totalidad.</p>
                          )}
                          {line.selected && !agotada && (
                            <div className="flex items-center gap-2 pt-1">
                              <label htmlFor={`return-qty-${line.item.varianteId}`} className="font-bold text-[#2F2A25]">
                                Cantidad:
                              </label>
                              <input
                                id={`return-qty-${line.item.varianteId}`}
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                value={line.cantidad === '' ? '' : line.cantidad}
                                disabled={processing}
                                onChange={(e) => handleChangeLineQuantity(line.item.varianteId, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-20 px-2 py-1 rounded-lg border border-[#E4DDD2] bg-white font-bold"
                              />
                              {!line.cantidadValida && (
                                <span className="text-[10px] text-rose-700">
                                  Máximo {line.disponible}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {checkedLines.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label htmlFor="return-refund-type" className="block font-bold text-[#2F2A25] mb-1">Forma de Reembolso:</label>
                    <select
                      id="return-refund-type"
                      value={refundType}
                      onChange={(e) => setRefundType(e.target.value)}
                      disabled={processing}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                    >
                      <option value="EFECTIVO">Efectivo (afecta la caja real)</option>
                      <option value="VALE_TIENDA">Crédito a Favor / Vale</option>
                      <option value="NOTA_CREDITO">Nota de Crédito</option>
                    </select>
                    {/* FASE 6: emitir un Crédito a Favor/Nota de Crédito real
                        exige un cliente registrado (para que el saldo sea
                        recuperable) -- el backend rechaza con
                        CLIENTE_REQUERIDO si la venta es "Consumidor Final". */}
                    {(refundType === 'VALE_TIENDA' || refundType === 'NOTA_CREDITO') && !foundSale.clienteId && (
                      <p className="mt-1 text-[10px] text-rose-700 leading-relaxed">
                        ⚠ Esta venta no tiene un cliente registrado (Consumidor Final). El backend rechazará esta
                        devolución: un Crédito a Favor/Nota de Crédito debe quedar asociado a un cliente real para
                        poder recuperarse después.
                      </p>
                    )}
                    {/* FASE 7 (Parte 19 -- evitar doble reconocimiento del
                        mismo monto): si la venta original ya generó una
                        cuenta por cobrar, el backend SIEMPRE reduce esa
                        deuda por el monto devuelto y, deliberadamente, NO
                        emite además un Crédito a Favor/Nota de Crédito
                        nuevo (ver ReturnsController.gs) -- se avisa aquí
                        para que el cajero no piense que eligiendo "Vale" o
                        "Nota de Crédito" se generará un documento aparte
                        en este caso. */}
                    {(refundType === 'VALE_TIENDA' || refundType === 'NOTA_CREDITO') && foundSale.clienteId && foundSale.cuentaCobrarId && (
                      <p className="mt-1 text-[10px] text-amber-700 leading-relaxed">
                        ⚠ Esta venta fue a crédito: el sistema reducirá el saldo pendiente de la cuenta por cobrar por
                        este monto y NO emitirá además un Vale/Nota de Crédito aparte (evita reconocer el mismo
                        monto dos veces).
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Motivo de Devolución:</label>
                    <input
                      type="text"
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      disabled={processing}
                      placeholder="Ej. Talla inadecuada / Defecto en costura / Cambio de color"
                      className="w-full px-3.5 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                    />
                  </div>
                </div>
              )}

              {/* MEJORA POS (Sección 5/21 -- recálculo automático): monto,
                  cantidad de líneas seleccionadas y estado esperado se
                  recalculan en cada marca/desmarca o cambio de cantidad --
                  estimado solo para UX, el backend recalcula el monto real
                  desde la venta original (Sección 6/20: puede diferir
                  ligeramente si hubo descuento/impuesto de línea, nunca es
                  la autoridad). */}
              {checkedLines.length > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-[#2F2A25]">
                    <span>Productos seleccionados:</span>
                    <span className="font-bold">{validSelectedLines.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-[#2F2A25]">
                    <span>Unidades a devolver:</span>
                    <span className="font-bold">{validSelectedLines.reduce((sum, l) => sum + l.cantidadNumerica, 0)}</span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-emerald-900 pt-1 border-t border-emerald-200">
                    <span>Monto Estimado a Reembolsar / Acreditar:</span>
                    <span className="text-base">{formatCurrency(montoEstimadoDevolucion, settings.simboloMoneda)}</span>
                  </div>
                  {estadoPreview && (
                    <div className="flex items-center justify-between text-[#2F2A25] pt-1">
                      <span>Estado después de esta devolución:</span>
                      <span className={`font-bold ${estadoPreview === 'DEVUELTA_TOTAL' ? 'text-rose-700' : 'text-amber-700'}`}>
                        {estadoPreview === 'DEVUELTA_TOTAL' ? 'DEVUELTA_TOTAL' : 'DEVUELTA_PARCIAL'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={!canSubmitReturn}
                onClick={handleClickProcessReturn}
                className="w-full py-3 px-4 rounded-2xl text-xs font-bold text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] disabled:bg-zinc-300 transition shadow-md flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{processing ? 'Procesando...' : 'Confirmar Devolución e Incrementar Stock'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Historical Returns Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        <div className="p-4 bg-[#F6F1E8] border-b border-[#E4DDD2] font-bold text-xs text-[#2F2A25]">
          Historial de Devoluciones Procesadas
        </div>
        {returnsLoading && returns.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando devoluciones reales en el backend...</p>
          </div>
        ) : !returnsLoading && !returnsError && returns.length === 0 ? (
          <div className="text-center py-10 text-xs text-[#756E65]">
            Todavía no hay devoluciones registradas en Google Sheets.
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#FAF8F4] text-[#756E65] border-b border-[#E4DDD2] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-4"># Devolución</th>
                <th className="py-2.5 px-4"># Venta</th>
                <th className="py-2.5 px-4">Cliente</th>
                <th className="py-2.5 px-4">Producto Reingresado</th>
                <th className="py-2.5 px-4">Motivo</th>
                <th className="py-2.5 px-4 text-right">Monto</th>
                <th className="py-2.5 px-4">Reembolso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(returns || []).map((ret) => (
                <tr key={ret.id} className="hover:bg-[#FAF8F4]">
                  <td className="py-3 px-4 font-mono font-bold text-[#2F2A25]">{ret.numeroDevolucion}</td>
                  <td className="py-3 px-4 font-mono text-[#756E65]">{ret.numeroVenta}</td>
                  <td className="py-3 px-4 font-bold text-[#2F2A25]">{ret.clienteNombre}</td>
                  <td className="py-3 px-4">
                    {(ret.items || []).map((it, idx) => (
                      <div key={idx}>
                        {it.nombreProducto} ({it.talla} / {it.color}) x {it.cantidad} ud
                      </div>
                    ))}
                  </td>
                  <td className="py-3 px-4 text-[#756E65]">{ret.motivo}</td>
                  <td className="py-3 px-4 text-right font-bold text-rose-700">
                    -{formatCurrency(ret.montoDevuelto, settings.simboloMoneda)}
                  </td>
                  <td className="py-3 px-4 text-[11px] font-semibold text-[#756E65]">
                    {ret.tipoReembolso}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* MEJORA POS (Sección 14) -- resumen de confirmación ANTES de
          procesar de verdad la devolución. Marcar checkboxes/cantidades
          nunca ejecuta nada por sí solo (Sección 9); esta es la única
          puerta real hacia executeProcessReturn. Es ADICIONAL a las dos
          confirmaciones ya existentes del flujo de Devolución Directa
          (Historial -> SalesView), que se mantienen intactas y sin
          cambios -- esta pantalla puede llegar tanto desde ahí como desde
          "Buscar Venta" manual, y en ambos casos pasa por este mismo
          resumen antes de tocar el backend. */}
      {showConfirmSubmit && foundSale && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 border-b border-[#E4DDD2] pb-3">
              <div className="w-9 h-9 rounded-xl bg-[#F6F1E8] text-[#756E65] flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#2F2A25]">¿Confirmar devolución?</h3>
            </div>

            <div className="text-xs text-[#756E65] space-y-2">
              <p>
                Venta: <span className="font-bold text-[#2F2A25]">{foundSale.numeroVenta}</span>
              </p>
              <div>
                <span className="font-bold text-[#2F2A25]">Productos:</span>
                <ul className="mt-1 space-y-1">
                  {validSelectedLines.map((l) => (
                    <li key={l.item.varianteId}>
                      - {l.item.nombreProducto} — Talla {l.item.talla} — {l.cantidadNumerica} unidad(es) —{' '}
                      {formatCurrency(l.item.precioUnitario * l.cantidadNumerica, settings.simboloMoneda)}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="flex items-center justify-between pt-1 border-t border-[#E4DDD2]">
                <span className="font-bold text-[#2F2A25]">Total a devolver:</span>
                <span className="font-bold text-emerald-800 text-sm">
                  {formatCurrency(montoEstimadoDevolucion, settings.simboloMoneda)}
                </span>
              </p>
              <p>
                Forma de reembolso:{' '}
                <span className="font-bold text-[#2F2A25]">
                  {refundType === 'EFECTIVO' ? 'Efectivo' : refundType === 'VALE_TIENDA' ? 'Crédito a Favor / Vale' : 'Nota de Crédito'}
                </span>
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmSubmit(false)}
                disabled={processing}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeProcessReturn}
                disabled={processing}
                className="flex-1 py-2 rounded-xl bg-[#2F2A25] hover:bg-[#403932] text-xs font-bold text-white transition disabled:bg-zinc-300"
              >
                {processing ? 'Procesando...' : 'Sí, continuar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
