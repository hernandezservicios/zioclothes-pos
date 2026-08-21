import React, { useState } from 'react';
import { Sale, SaleItem, ReturnRecord } from '../../types';
import { storageService } from '../../services/storageService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { RotateCcw, Search, CheckCircle2, AlertTriangle, ArrowRight, Package } from 'lucide-react';

export const ReturnsView: React.FC = () => {
  const { currentUser, settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [sales] = useState<Sale[]>(() => storageService.getSales());
  const [returns, setReturns] = useState<ReturnRecord[]>(() => storageService.getReturns());
  const [searchSaleCode, setSearchSaleCode] = useState('');
  const [foundSale, setFoundSale] = useState<Sale | null>(null);

  // Return Form State
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [returnQuantity, setReturnQuantity] = useState<number | string>(1);
  const [returnReason, setReturnReason] = useState('Cambio por talla diferente');
  const [refundType, setRefundType] = useState<'EFECTIVO' | 'CREDITO_CUENTA' | 'VALE_TIENDA'>('EFECTIVO');
  const [loading, setLoading] = useState(false);

  const handleSearchSale = (e: React.FormEvent) => {
    e.preventDefault();
    const code = searchSaleCode.trim().toUpperCase();
    if (!code) return;

    const sale = sales.find((s) => s.numeroVenta.toUpperCase() === code || s.id === code);
    if (!sale) {
      showToast('Venta no encontrada', `No existe ninguna venta con el número ${code}`, 'error');
      setFoundSale(null);
      return;
    }

    if (sale.estado === 'ANULADA') {
      showToast('Venta Anulada', 'Esta venta está anulada y no admite devoluciones.', 'advertencia');
      setFoundSale(null);
      return;
    }

    setFoundSale(sale);
    setSelectedItemId(sale.items?.[0]?.id || '');
    setReturnQuantity(1);
  };

  const selectedItem = (foundSale?.items || []).find((i) => i.id === selectedItemId);

  const handleProcessReturn = () => {
    if (!foundSale || !selectedItem || !currentUser) return;
    const numQty = typeof returnQuantity === 'number' ? returnQuantity : parseInt(returnQuantity, 10);
    if (!Number.isFinite(numQty) || numQty <= 0 || numQty > selectedItem.cantidad) {
      showToast('Cantidad Inválida', `La cantidad a devolver debe estar entre 1 y ${selectedItem.cantidad} unidades.`, 'error');
      return;
    }

    setLoading(true);

    try {
      const returnNum = storageService.getNextSequence('DEV');
      const refundAmount = selectedItem.precioUnitario * numQty;

      // 1. Reintegrate stock into Product Variant
      const products = storageService.getProducts();
      const pIndex = products.findIndex((p) => p.id === selectedItem.productoId);
      if (pIndex !== -1) {
        const vIndex = products[pIndex].variantes.findIndex((v) => v.id === selectedItem.varianteId);
        if (vIndex !== -1) {
          const variant = products[pIndex].variantes[vIndex];
          const stockAnterior = variant.stock;
          const stockNuevo = stockAnterior + numQty;
          products[pIndex].variantes[vIndex].stock = stockNuevo;
          storageService.saveProducts(products);

          // Log movement
          const movements = storageService.getMovements();
          movements.unshift({
            id: storageService.getNextSequence('MOV'),
            productoId: selectedItem.productoId,
            productoNombre: selectedItem.nombreProducto,
            varianteId: selectedItem.varianteId,
            sku: selectedItem.sku,
            talla: selectedItem.talla,
            color: selectedItem.color,
            cantidad: numQty,
            tipo: 'DEVOLUCION',
            stockAnterior,
            stockNuevo,
            motivo: `Devolución ${returnNum} de venta ${foundSale.numeroVenta}: ${returnReason}`,
            referencia: returnNum,
            usuarioId: currentUser.id,
            usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
            fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
          });
          storageService.saveMovements(movements);
        }
      }

      // 2. If credit sale & refundType is CREDITO_CUENTA, deduct from Account Receivable
      if (foundSale.cuentaCobrarId && refundType === 'CREDITO_CUENTA') {
        const credits = storageService.getCredits();
        const cIndex = credits.findIndex((c) => c.id === foundSale.cuentaCobrarId);
        if (cIndex !== -1) {
          const credit = credits[cIndex];
          credit.saldoPendiente = Math.max(0, credit.saldoPendiente - refundAmount);
          if (credit.saldoPendiente === 0) credit.estado = 'PAGADA';
          credits[cIndex] = credit;
          storageService.saveCredits(credits);
        }
      }

      // 3. If refund is cash, deduct from active cash register
      if (refundType === 'EFECTIVO') {
        const activeCash = storageService.getActiveCashSession();
        if (activeCash) {
          const cashSessions = storageService.getCashSessions();
          const sIndex = cashSessions.findIndex((s) => s.id === activeCash.id);
          if (sIndex !== -1) {
            cashSessions[sIndex].devolucionesEfectivo += refundAmount;
            cashSessions[sIndex].efectivoEsperado -= refundAmount;
            storageService.saveCashSessions(cashSessions);
          }
        }
      }

      // 4. Save Return Record
      const newReturn: ReturnRecord = {
        id: `DEV-${Date.now()}`,
        numeroDevolucion: returnNum,
        ventaId: foundSale.id,
        numeroVenta: foundSale.numeroVenta,
        clienteId: foundSale.clienteId,
        clienteNombre: foundSale.clienteNombre,
        items: [
          {
            saleItemId: selectedItem.id,
            productoId: selectedItem.productoId,
            varianteId: selectedItem.varianteId,
            nombreProducto: selectedItem.nombreProducto,
            talla: selectedItem.talla,
            color: selectedItem.color,
            cantidad: returnQuantity,
            precioUnitario: selectedItem.precioUnitario,
            total: refundAmount,
          },
        ],
        montoDevuelto: refundAmount,
        tipoReembolso: refundType,
        motivo: returnReason,
        usuarioId: currentUser.id,
        usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      };

      const currentReturns = storageService.getReturns();
      currentReturns.unshift(newReturn);
      storageService.saveReturns(currentReturns);
      setReturns(currentReturns);

      // Audit Log
      storageService.logAudit({
        usuarioId: currentUser.id,
        usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        usuarioRol: currentUser.rol,
        accion: 'RETURN',
        modulo: 'DEVOLUCIONES',
        entidad: 'ReturnRecord',
        entidadId: newReturn.id,
        descripcion: `Devolución ${returnNum} por RD$${refundAmount.toLocaleString()} de venta ${foundSale.numeroVenta}. Prenda: ${selectedItem.nombreProducto}`,
        resultado: 'EXITO',
      });

      showToast('Devolución Procesada', `Comprobante ${returnNum} emitido e inventario reingresado.`, 'exito');
      setFoundSale(null);
      setSearchSaleCode('');
    } catch (err: any) {
      showToast('Error', err.message || 'No se pudo procesar la devolución', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="returns-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="pb-4 border-b border-[#E4DDD2]">
        <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
          Servicio al Cliente & Garantías
        </span>
        <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
          Devoluciones y Cambios de Ropa
        </h1>
      </div>

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
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] font-mono text-xs font-bold text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-[#2F2A25] hover:bg-[#403932] transition flex items-center justify-center gap-2"
            >
              <Search className="w-3.5 h-3.5 text-[#E8DCC8]" />
              <span>Buscar Venta</span>
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
            </div>
          )}
        </div>

        {/* Process Return Panel */}
        <div className="lg:col-span-2 bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs">
          <h3 className="text-sm font-bold text-[#2F2A25] flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-[#C2410C]" />
            <span>2. Procesar Devolución & Reingreso a Inventario</span>
          </h3>

          {!foundSale ? (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Package className="w-10 h-10 opacity-30 mx-auto" />
              <p className="text-xs font-medium">Busque una factura para habilitar el formulario de devolución</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Select Item */}
              <div>
                <label className="block text-xs font-bold text-[#2F2A25] mb-1.5 uppercase">
                  Seleccionar Prenda a Devolver:
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-semibold text-[#2F2A25]"
                >
                  {(foundSale.items || []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombreProducto} (Talla {i.talla} / {i.color}) — {i.cantidad} ud(s) facturadas @ {formatCurrency(i.precioUnitario, settings.simboloMoneda)}
                    </option>
                  ))}
                </select>
              </div>

              {selectedItem && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">
                      Cantidad a Devolver (Máx {selectedItem.cantidad}):
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      placeholder="1"
                      value={returnQuantity === '' ? '' : returnQuantity}
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
                  </div>

                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Forma de Reembolso:</label>
                    <select
                      value={refundType}
                      onChange={(e) => setRefundType(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                    >
                      <option value="EFECTIVO">Efectivo de Caja</option>
                      {foundSale.esCredito && (
                        <option value="CREDITO_CUENTA">Deducir de Cuenta por Cobrar</option>
                      )}
                      <option value="VALE_TIENDA">Vale de Tienda / Crédito a Favor</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-bold text-[#2F2A25] mb-1">Motivo de Devolución:</label>
                    <input
                      type="text"
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      placeholder="Ej. Talla inadecuada / Defecto en costura / Cambio de color"
                      className="w-full px-3.5 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Total Calculation */}
              {selectedItem && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs font-bold text-emerald-900">
                  <span>Monto Total a Reembolsar / Acreditar:</span>
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
                disabled={loading}
                onClick={handleProcessReturn}
                className="w-full py-3 px-4 rounded-2xl text-xs font-bold text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] disabled:bg-zinc-300 transition shadow-md flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{loading ? 'Procesando...' : 'Confirmar Devolución e Incrementar Stock'}</span>
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
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#FAF8F4] text-[#756E65] border-b border-[#E4DDD2] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-4"># Devolución</th>
                <th className="py-2.5 px-4"># Venta</th>
                <th className="py-2.5 px-4">Cliente</th>
                <th className="py-2.5 px-4">Prenda Reingresada</th>
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

          {(returns || []).length === 0 && (
            <div className="text-center py-8 text-xs text-[#756E65]">
              No hay devoluciones registradas hasta el momento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
