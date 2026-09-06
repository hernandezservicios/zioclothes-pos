import React, { useState, useEffect, useMemo } from 'react';
import { Sale } from '../../types';
import { returnsApi } from '../../services/returnsApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { RotateCcw, Search, CheckCircle2, AlertTriangle, ArrowRight, Package, RefreshCcw } from 'lucide-react';

export const ReturnsView: React.FC = () => {
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
  } = useDataStore();

  useEffect(() => {
    refreshSales();
    refreshReturns();
  }, [refreshSales, refreshReturns]);

  const [searchSaleCode, setSearchSaleCode] = useState('');
  const [foundSale, setFoundSale] = useState<Sale | null>(null);

  // Return Form State
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [returnQuantity, setReturnQuantity] = useState<number | string>(1);
  const [returnReason, setReturnReason] = useState('Cambio por talla diferente');
  const [refundType, setRefundType] = useState<string>('EFECTIVO');
  const [processing, setProcessing] = useState(false);
  // FASE 6: confirmación visible del Crédito a Favor/Nota de Crédito recién
  // emitido por el backend (creditoFavorEmitido), si la devolución generó
  // uno -- se limpia al buscar otra venta o iniciar una nueva devolución.
  const [lastIssuedCreditNote, setLastIssuedCreditNote] = useState<{
    numero: string;
    tipo: 'VALE_TIENDA' | 'NOTA_CREDITO';
    montoOriginal: number;
  } | null>(null);

  const handleSearchSale = (e: React.FormEvent) => {
    e.preventDefault();
    const code = searchSaleCode.trim().toUpperCase();
    if (!code) return;

    const sale = (sales || []).find((s) => s.numeroVenta.toUpperCase() === code || s.id === code);
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
    setSelectedVariantId(sale.items?.[0]?.varianteId || '');
    setReturnQuantity(1);
    setRefundType('EFECTIVO');
    setLastIssuedCreditNote(null);
  };

  const selectedItem = (foundSale?.items || []).find((i) => i.varianteId === selectedVariantId);

  // UX únicamente: cuánto de esta variante ya se devolvió en devoluciones
  // reales previas de ESTA venta, para no dejar que el usuario intente una
  // cantidad que el backend rechazaría de todas formas. El backend sigue
  // siendo la autoridad real (recalculateReturnAuthoritatively vuelve a
  // validar esto mismo contra Devoluciones reales dentro del lock).
  const alreadyReturnedForSelectedItem = useMemo(() => {
    if (!foundSale || !selectedItem) return 0;
    return (returns || [])
      .filter((r) => r.ventaId === foundSale.id)
      .flatMap((r) => r.items || [])
      .filter((it) => it.varianteId === selectedItem.varianteId)
      .reduce((sum, it) => sum + (it.cantidad || 0), 0);
  }, [returns, foundSale, selectedItem]);

  const availableToReturn = selectedItem ? Math.max(0, selectedItem.cantidad - alreadyReturnedForSelectedItem) : 0;

  const handleProcessReturn = async () => {
    if (processing) return; // previene doble submit
    if (!foundSale || !selectedItem || !currentUser) return;

    const numQty = typeof returnQuantity === 'number' ? returnQuantity : parseInt(returnQuantity, 10);
    if (!Number.isFinite(numQty) || numQty <= 0) {
      showToast('Cantidad Inválida', 'La cantidad a devolver debe ser mayor a 0.', 'error');
      return;
    }
    if (numQty > availableToReturn) {
      showToast(
        'Cantidad Inválida',
        `Solo quedan ${availableToReturn} unidad(es) disponibles para devolver de esta prenda (vendidas: ${selectedItem.cantidad}, ya devueltas: ${alreadyReturnedForSelectedItem}).`,
        'error'
      );
      return;
    }
    if (!returnReason.trim()) {
      showToast('Motivo Requerido', 'Ingrese el motivo de la devolución.', 'error');
      return;
    }

    setProcessing(true);

    // FASE 3.7F: returns.create real (ReturnsController.handleCreateReturn).
    // Solo se envían datos base (ventaId, varianteId, cantidad, motivo,
    // tipoReembolso) -- el backend recalcula precio/descuento/impuesto/
    // total desde Venta_Items real, reintegra stock, y ya integra caja y
    // crédito internamente en la misma transacción. Nunca se llama
    // cashApi.addMovement() ni se toca storageService.getCredits()/
    // saveCredits() desde aquí.
    const res = await returnsApi.create({
      ventaId: foundSale.id,
      items: [{ varianteId: selectedItem.varianteId, cantidad: numQty }],
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
              {/* Select Item */}
              <div>
                <label className="block text-xs font-bold text-[#2F2A25] mb-1.5 uppercase">
                  Seleccionar Producto a Devolver:
                </label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => {
                    setSelectedVariantId(e.target.value);
                    setReturnQuantity(1);
                  }}
                  disabled={processing}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-semibold text-[#2F2A25]"
                >
                  {(foundSale.items || []).map((i) => (
                    <option key={i.varianteId} value={i.varianteId}>
                      {i.nombreProducto} (Talla {i.talla} / {i.color}) — {i.cantidad} ud(s) facturadas @ {formatCurrency(i.precioUnitario, settings.simboloMoneda)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedItem && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">
                      Cantidad a Devolver (Máx {availableToReturn}
                      {alreadyReturnedForSelectedItem > 0 ? `, ya devueltas ${alreadyReturnedForSelectedItem}` : ''}):
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      placeholder="1"
                      value={returnQuantity === '' ? '' : returnQuantity}
                      disabled={processing || availableToReturn === 0}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') setReturnQuantity('');
                        else {
                          const num = parseInt(val, 10);
                          setReturnQuantity(isNaN(num) ? '' : val);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                    />
                    {availableToReturn === 0 && (
                      <p className="mt-1 text-[10px] text-rose-700">Esta prenda ya fue devuelta en su totalidad.</p>
                    )}
                  </div>

                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Forma de Reembolso:</label>
                    <select
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

                  <div className="sm:col-span-2">
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

              {/* Preview -- estimado solo para UX; el backend recalcula el
                  monto real desde la venta original y puede diferir
                  ligeramente si hubo descuento/impuesto en la línea. */}
              {selectedItem && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-bold text-emerald-900">
                  <span>Monto Estimado a Reembolsar / Acreditar:</span>
                  <span className="text-base">
                    {formatCurrency(
                      selectedItem.precioUnitario *
                        ((typeof returnQuantity === 'number' ? returnQuantity : parseInt(returnQuantity, 10)) || 0),
                      settings.simboloMoneda
                    )}
                  </span>
                </div>
              )}

              <button
                type="button"
                disabled={processing || !selectedItem || availableToReturn === 0}
                onClick={handleProcessReturn}
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
    </div>
  );
};
