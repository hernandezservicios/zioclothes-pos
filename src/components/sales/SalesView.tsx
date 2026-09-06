import React, { useState, useMemo, useEffect } from 'react';
import { Sale } from '../../types';
import { salesApi } from '../../services/salesApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { ReceiptModal } from '../pos/ReceiptModal';
import {
  Search,
  Receipt,
  Printer,
  Ban,
  Filter,
  Download,
  Eye,
  Calendar,
  AlertCircle,
  X,
  CheckCircle2,
  RefreshCcw,
} from 'lucide-react';

export const SalesView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  // FASE 3.7A / CORREGIR AUDITORÍA: el historial de ventas viene
  // EXCLUSIVAMENTE de sales.list (SalesController.handleListSales ->
  // Google Sheets real) -- ahora leído del DataStore central, la MISMA
  // colección que también consumen ReturnsView, DashboardView y
  // ReportsView (antes cada una lo pedía por su cuenta, 4 llamadas
  // independientes a sales.list, ver informe de auditoría).
  const {
    sales,
    salesLoading: loading,
    salesError: loadError,
    salesStale,
    refreshSales,
    refreshProducts,
    refreshCredits,
    refreshCustomers,
  } = useDataStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'COMPLETADA' | 'ANULADA'>('TODOS');
  const [paymentFilter, setPaymentFilter] = useState<string>('TODOS');

  // Modals
  const [selectedSaleDetail, setSelectedSaleDetail] = useState<Sale | null>(null);
  const [saleForReceipt, setSaleForReceipt] = useState<Sale | null>(null);
  const [voidModalSale, setVoidModalSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [loadingVoid, setLoadingVoid] = useState(false);

  useEffect(() => {
    refreshSales();
  }, [refreshSales]);

  const filteredSales = useMemo(() => {
    return (sales || []).filter((s) => {
      if (!s) return false;
      const matchesStatus = statusFilter === 'TODOS' || s.estado === statusFilter;
      const matchesPayment = paymentFilter === 'TODOS' || s.metodoPago === paymentFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (s.numeroVenta && s.numeroVenta.toLowerCase().includes(q)) ||
        (s.clienteNombre && s.clienteNombre.toLowerCase().includes(q)) ||
        (s.vendedorNombre && s.vendedorNombre.toLowerCase().includes(q)) ||
        (s.items || []).some((i) => (i.nombreProducto && i.nombreProducto.toLowerCase().includes(q)) || (i.sku && i.sku.toLowerCase().includes(q)));

      return matchesStatus && matchesPayment && matchesSearch;
    });
  }, [sales, statusFilter, paymentFilter, searchQuery]);

  const handleExportCSV = () => {
    const rows = (filteredSales || []).map((s) => ({
      NumeroVenta: s.numeroVenta,
      Fecha: s.fecha,
      Cliente: s.clienteNombre,
      Vendedor: s.vendedorNombre,
      MetodoPago: s.metodoPago,
      Subtotal: s.subtotal,
      Descuento: s.descuentoTotal,
      Impuesto: s.impuestoTotal,
      Total: s.total,
      EsCredito: s.esCredito ? 'SI' : 'NO',
      Estado: s.estado,
    }));
    exportToCSV('Ventas_ZIO_CLOTHES', rows);
    showToast('Exportación Exitosa', 'El archivo CSV de ventas ha sido generado.', 'exito');
  };

  const handleConfirmVoid = async () => {
    if (!voidModalSale) return;
    if (!voidReason.trim()) {
      showToast('Motivo Requerido', 'Debe ingresar el motivo de la anulación.', 'error');
      return;
    }

    setLoadingVoid(true);
    // FASE 3.7A: sales.void real (SalesController.handleVoidSale). El
    // backend valida el permiso ventas.anular, restaura stock, cancela el
    // crédito asociado y marca la venta ANULADA (nunca la borra) -- si
    // rechaza, se muestra el error real y NO se toca el estado local.
    const res = await salesApi.void(voidModalSale.id, voidReason.trim());
    setLoadingVoid(false);

    if (res.success) {
      showToast('Venta Anulada', res.message, 'exito');
      setVoidModalSale(null);
      setVoidReason('');
      if (selectedSaleDetail?.id === voidModalSale.id) {
        setSelectedSaleDetail(null);
      }
      // CORREGIR AUDITORÍA (§5 "Anulación de venta"): invalida el
      // DataStore central de ventas, productos (el stock se restauró) y
      // créditos (si la venta tenía una cuenta por cobrar asociada, el
      // backend ya la anuló) -- Dashboard/Reportes/Inventario/POS/Créditos
      // reflejan el resultado de inmediato, sin logout/login ni F5.
      await Promise.all([
        refreshSales({ force: true }),
        refreshProducts({ force: true }),
        refreshCredits({ force: true }),
        refreshCustomers({ force: true }),
      ]);
    } else {
      showToast('Error', res.message, 'error');
    }
  };

  return (
    <div id="sales-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Ventas & Facturación
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Historial de Ventas
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => refreshSales({ force: true })}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
            title="Volver a consultar el backend real"
          >
            <RefreshCcw className={`w-4 h-4 text-[#756E65] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={sales.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Backend error state -- nunca se sustituye por datos demo/locales */}
      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              No se pudo cargar el historial de ventas desde el backend: {loadError}
              {salesStale && ' (se muestra la última información disponible, puede no estar actualizada)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => refreshSales({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por # venta, cliente, prenda o SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
          >
            <option value="TODOS">Todos los Estados</option>
            <option value="COMPLETADA">Completadas</option>
            <option value="ANULADA">Anuladas</option>
          </select>

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
          >
            <option value="TODOS">Todas las Formas de Pago</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TARJETA">Tarjeta</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="CREDITO">Crédito</option>
            <option value="MIXTO">Mixto</option>
          </select>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        {loading && sales.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando ventas reales en el backend...</p>
          </div>
        ) : !loading && !loadError && sales.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <Receipt className="w-8 h-8 opacity-40 mx-auto" />
            <p className="font-semibold text-xs text-[#2F2A25]">
              Todavía no hay ventas registradas en Google Sheets.
            </p>
            <p className="text-[11px]">Las ventas realizadas desde el POS aparecerán aquí automáticamente.</p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4"># Venta</th>
                <th className="py-3 px-4">Fecha & Hora</th>
                <th className="py-3 px-4">Cliente</th>
                <th className="py-3 px-4">Productos</th>
                <th className="py-3 px-4">Forma de Pago</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-center">Estado</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredSales || []).map((sale) => (
                <tr key={sale.id} className="hover:bg-[#FAF8F4]/80 transition">
                  <td className="py-3.5 px-4 font-mono font-bold text-[#2F2A25]">
                    {sale.numeroVenta}
                  </td>
                  <td className="py-3.5 px-4 text-[#756E65]">
                    {formatDateTime(sale.fecha)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-[#2F2A25]">{sale.clienteNombre}</div>
                    <div className="text-[10px] text-[#756E65]">Vendedor: {sale.vendedorNombre}</div>
                  </td>
                  <td className="py-3.5 px-4 text-[#756E65]">
                    {(sale.items || []).length} prenda(s) ({(sale.items || []).reduce((acc, i) => acc + i.cantidad, 0)} uds)
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[11px] font-semibold text-[#2F2A25]">
                      {sale.metodoPago}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-[#2F2A25]">
                    {formatCurrency(sale.total, settings.simboloMoneda)}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        sale.estado === 'COMPLETADA'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-rose-50 text-rose-800 border-rose-200'
                      }`}
                    >
                      {sale.estado}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedSaleDetail(sale)}
                        className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                        title="Ver detalle"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaleForReceipt(sale)}
                        className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                        title="Reimprimir Comprobante"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      {sale.estado !== 'ANULADA' && hasPermission('ventas.anular') && (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidModalSale(sale);
                            setVoidReason('');
                          }}
                          className="p-1.5 rounded-lg text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition"
                          title="Anular venta"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {sales.length > 0 && (filteredSales || []).length === 0 && (
            <div className="text-center py-12 space-y-2 text-[#756E65]">
              <Receipt className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">Ningún resultado coincide con los filtros aplicados</p>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Sale Detail Drawer / Modal */}
      {selectedSaleDetail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#2F2A25]">
                  Detalle de Venta {selectedSaleDetail.numeroVenta}
                </h3>
                <span className="text-[11px] text-[#756E65]">
                  {formatDateTime(selectedSaleDetail.fecha)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSaleDetail(null)}
                className="text-[#756E65] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-white rounded-2xl border border-[#E4DDD2] space-y-1">
                <p>
                  <span className="text-[#756E65]">Cliente:</span>{' '}
                  <span className="font-bold text-[#2F2A25]">{selectedSaleDetail.clienteNombre}</span>
                </p>
                <p>
                  <span className="text-[#756E65]">Vendedor:</span>{' '}
                  <span className="font-bold text-[#2F2A25]">{selectedSaleDetail.vendedorNombre}</span>
                </p>
                <p>
                  <span className="text-[#756E65]">Forma de Pago:</span>{' '}
                  <span className="font-bold text-[#2F2A25]">{selectedSaleDetail.metodoPago}</span>
                </p>
                {selectedSaleDetail.estado === 'ANULADA' && (
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 mt-2">
                    <p className="font-bold">VENTA ANULADA</p>
                    <p>Motivo: {selectedSaleDetail.motivoAnulacion}</p>
                    <p className="text-[10px]">Por: {selectedSaleDetail.anuladaPor}</p>
                  </div>
                )}
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <span className="font-bold text-[#2F2A25] uppercase text-[10px]">Productos Facturados:</span>
                {(selectedSaleDetail.items || []).map((it, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-white border border-[#E4DDD2] rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-[#2F2A25]">{it.nombreProducto}</p>
                      <p className="text-[10px] text-[#756E65]">
                        Talla {it.talla} • {it.color} • SKU: {it.sku}
                      </p>
                      <p className="text-[10px] text-[#756E65]">
                        {it.cantidad} ud(s) x {formatCurrency(it.precioUnitario, settings.simboloMoneda)}
                      </p>
                    </div>
                    <span className="font-bold text-[#2F2A25]">
                      {formatCurrency(it.total, settings.simboloMoneda)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total Breakdown */}
              <div className="p-3 bg-[#F6F1E8] rounded-2xl space-y-1 font-mono">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(selectedSaleDetail.subtotal, settings.simboloMoneda)}</span>
                </div>
                {selectedSaleDetail.descuentoTotal > 0 && (
                  <div className="flex justify-between text-emerald-800">
                    <span>Descuento:</span>
                    <span>-{formatCurrency(selectedSaleDetail.descuentoTotal, settings.simboloMoneda)}</span>
                  </div>
                )}
                {selectedSaleDetail.impuestoTotal > 0 && (
                  <div className="flex justify-between">
                    <span>ITBIS:</span>
                    <span>{formatCurrency(selectedSaleDetail.impuestoTotal, settings.simboloMoneda)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm pt-1 border-t border-[#E4DDD2]">
                  <span>TOTAL:</span>
                  <span>{formatCurrency(selectedSaleDetail.total, settings.simboloMoneda)}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedSaleDetail(null)}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaleForReceipt(selectedSaleDetail);
                  setSelectedSaleDetail(null);
                }}
                className="flex-1 py-2 rounded-xl bg-[#2F2A25] text-xs font-bold text-white flex items-center justify-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir Ticket</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Sale Reason Modal */}
      {voidModalSale && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-800 font-bold text-sm border-b border-[#E4DDD2] pb-3">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              <span>Anular Venta {voidModalSale.numeroVenta}</span>
            </div>

            <p className="text-xs text-[#756E65] leading-relaxed">
              Esta acción revertirá automáticamente el stock de las prendas al inventario y anulará la cuenta por cobrar asociada si fue a crédito.
            </p>

            <div>
              <label className="block text-xs font-bold text-[#2F2A25] mb-1 uppercase">
                Motivo de Anulación:
              </label>
              <textarea
                rows={3}
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Ej. Error en digitación de prendas / Solicitud del cliente"
                className="w-full p-2.5 rounded-xl border border-[#E4DDD2] bg-white text-xs text-[#2F2A25] focus:outline-none focus:border-rose-600"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVoidModalSale(null)}
                disabled={loadingVoid}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loadingVoid || !voidReason.trim()}
                onClick={handleConfirmVoid}
                className="flex-1 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-xs font-bold text-white transition disabled:bg-zinc-300"
              >
                {loadingVoid ? 'Anulando...' : 'Confirmar Anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {saleForReceipt && (
        <ReceiptModal sale={saleForReceipt} onClose={() => setSaleForReceipt(null)} />
      )}
    </div>
  );
};
