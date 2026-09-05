import React, { useState, useEffect, useCallback } from 'react';
import { Purchase } from '../../types';
import { purchasesApi } from '../../services/purchasesApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { Truck, Plus, Search, Download, CheckCircle2, X, Package, AlertTriangle, RefreshCcw } from 'lucide-react';

export const PurchasesView: React.FC = () => {
  const { currentUser, settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  // FASE 3.7D: compras reales vía purchases.list
  // (PurchasesController.handleListPurchases -> Google Sheets real).
  // Antes se leía storageService.getPurchases(), un arreglo que nadie real
  // vuelve a escribir. `purchases.list` no está duplicado en ninguna otra
  // vista (ver informe de auditoría), así que sigue siendo propio de este
  // componente.
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);

  // CORREGIR AUDITORÍA: el catálogo/variantes ya NO se pide con una
  // llamada propia de esta vista (era una de las 3 llamadas independientes
  // a products.list detectadas en la auditoría) -- se lee del DataStore
  // central compartido con ProductsView/POSView/InventoryView. Recibir una
  // compra actualiza el stock en el backend; invalidar aquí el DataStore
  // hace que Catálogo/POS/Inventario lo vean de inmediato.
  const { products, productsLoading, productsError, productsStale, refreshProducts } = useDataStore();

  const fetchPurchases = useCallback(async () => {
    setPurchasesLoading(true);
    setPurchasesError(null);
    const res = await purchasesApi.list();
    if (res.success) {
      setPurchases(res.data || []);
    } else {
      setPurchasesError(res.message || 'No se pudo obtener el historial real de compras.');
    }
    setPurchasesLoading(false);
  }, []);

  useEffect(() => {
    fetchPurchases();
    refreshProducts();
  }, [fetchPurchases, refreshProducts]);

  const [modalOpen, setModalOpen] = useState(false);

  // Form
  const [proveedor, setProveedor] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [cantidad, setCantidad] = useState<number | string>(1);
  const [costoUnitario, setCostoUnitario] = useState<number | string>(0);
  const [formaPago, setFormaPago] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'CREDITO_PROVEEDOR'>('TRANSFERENCIA');
  const [notas, setNotas] = useState('');
  const [savingPurchase, setSavingPurchase] = useState(false);

  const selectedProduct = (products || []).find((p) => p && p.id === selectedProductId);
  const selectedVariant =
    (selectedProduct?.variantes || []).find((v) => v && v.id === selectedVariantId) ||
    selectedProduct?.variantes?.[0];

  const handleOpenCreate = () => {
    setProveedor('');
    const firstP = products[0];
    setSelectedProductId(firstP?.id || '');
    setSelectedVariantId(firstP?.variantes?.[0]?.id || '');
    setCantidad(1);
    setCostoUnitario(firstP?.costo || 0);
    setFormaPago('TRANSFERENCIA');
    setNotas('');
    setModalOpen(true);
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPurchase) return; // previene doble submit
    if (!currentUser || !selectedProduct || !selectedVariant) return;

    const numCantidad = typeof cantidad === 'number' ? cantidad : parseInt(cantidad, 10);
    const numCosto = typeof costoUnitario === 'number' ? costoUnitario : parseFloat(costoUnitario);

    if (!proveedor.trim()) {
      showToast('Proveedor Requerido', 'Ingrese el nombre del proveedor.', 'error');
      return;
    }
    if (!Number.isFinite(numCantidad) || numCantidad <= 0) {
      showToast('Cantidad Inválida', 'La cantidad debe ser un número entero mayor a 0.', 'error');
      return;
    }
    if (!Number.isFinite(numCosto) || numCosto <= 0) {
      showToast('Costo Inválido', 'El costo unitario debe ser un valor mayor a RD$ 0.00.', 'error');
      return;
    }

    setSavingPurchase(true);

    // Preview local únicamente para mostrarle al usuario lo que va a
    // enviar -- el backend recalcula este mismo total a partir de
    // cantidad×costoUnitario y rechaza la compra completa
    // (PURCHASE_TOTAL_MISMATCH) si no coincide. Nunca se asume que este
    // valor es el definitivo hasta recibir la confirmación real.
    const previewTotal = Math.round(numCantidad * numCosto * 100) / 100;

    // FASE 3.7D: purchases.create real (PurchasesController.
    // handleCreatePurchase). No se actualiza stock/costo localmente antes
    // de la respuesta real -- sin actualización optimista. IMPORTANTE:
    // el backend NO actualiza Variantes.costo (no existe una regla de
    // costo promedio ponderado definida en el sistema, ver reporte de
    // esta fase) -- este costoUnitario queda únicamente en el registro de
    // la compra y en el Kardex, no reemplaza el costo de catálogo.
    const res = await purchasesApi.create({
      proveedor: proveedor.trim(),
      items: [
        {
          varianteId: selectedVariant.id,
          cantidad: numCantidad,
          costoUnitario: numCosto,
          nombreProducto: selectedProduct.nombre,
        },
      ],
      total: previewTotal,
      formaPago,
      notas: notas.trim() || undefined,
    });

    setSavingPurchase(false);

    if (res.success) {
      showToast('Compra Registrada', res.message, 'exito');
      setModalOpen(false);
      // CORREGIR AUDITORÍA: invalida el DataStore central de productos --
      // el stock recién ingresado aparece en Catálogo/POS/Inventario sin
      // logout/login ni F5.
      await Promise.all([fetchPurchases(), refreshProducts({ force: true })]);
    } else {
      showToast('Error', res.message, 'error');
      // No se modifica ni el stock ni el listado de compras mostrados --
      // siguen siendo los últimos reales confirmados por el backend.
    }
  };

  const handleExportCSV = () => {
    const rows = (purchases || []).map((po) => ({
      NumeroCompra: po.numeroCompra,
      Fecha: po.fecha,
      Proveedor: po.proveedor,
      Unidades: (po.items || []).reduce((sum, i) => sum + (i.cantidad || 0), 0),
      Total: po.total,
      FormaPago: po.formaPago,
      Estado: po.estado,
      Usuario: po.usuarioNombre,
    }));
    exportToCSV('Compras_ZIO_CLOTHES', rows);
    showToast('Exportación Exitosa', 'Historial de compras exportado en CSV.', 'exito');
  };

  return (
    <div id="purchases-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Compras & Abastecimiento a Proveedores
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Órdenes de Compra
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              fetchPurchases();
              refreshProducts({ force: true });
            }}
            disabled={purchasesLoading || productsLoading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
            title="Volver a consultar el backend real"
          >
            <RefreshCcw className={`w-4 h-4 text-[#756E65] ${purchasesLoading || productsLoading ? 'animate-spin' : ''}`} />
            <span>{purchasesLoading || productsLoading ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={purchases.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>
          {/* FASE 3.7D: corregido -- el backend real exige 'compras.crear'
              (PurchasesController.handleCreatePurchase), no
              'inventario.crear' como comprobaba el código anterior. */}
          {hasPermission('compras.crear') && (
            <button
              type="button"
              onClick={handleOpenCreate}
              disabled={products.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs disabled:opacity-50"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Registrar Compra de Ropa</span>
            </button>
          )}
        </div>
      </div>

      {/* Errores reales del backend -- nunca se sustituyen por datos demo/locales */}
      {purchasesError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudo cargar el historial real de compras: {purchasesError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchPurchases()}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}
      {productsError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No se pudo cargar el catálogo real de productos: {productsError}
              {productsStale && ' (se muestra la última información disponible, puede no estar actualizada)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => refreshProducts({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Purchases Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        {purchasesLoading && purchases.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando compras reales en el backend...</p>
          </div>
        ) : !purchasesLoading && !purchasesError && purchases.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <Truck className="w-8 h-8 opacity-40 mx-auto" />
            <p className="font-semibold text-xs text-[#2F2A25]">Todavía no hay compras registradas en Google Sheets.</p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4"># Orden</th>
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Proveedor</th>
                <th className="py-3 px-4">Prendas Ingresadas</th>
                <th className="py-3 px-4 text-center">Unidades</th>
                <th className="py-3 px-4 text-right">Total Costo</th>
                <th className="py-3 px-4">Forma de Pago</th>
                <th className="py-3 px-4 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(purchases || []).map((po) => (
                <tr key={po.id} className="hover:bg-[#FAF8F4]/80 transition">
                  <td className="py-3.5 px-4 font-mono font-bold text-[#2F2A25]">{po.numeroCompra}</td>
                  <td className="py-3.5 px-4 text-[#756E65]">{formatDateTime(po.fecha)}</td>
                  <td className="py-3.5 px-4 font-bold text-[#2F2A25]">{po.proveedor}</td>
                  <td className="py-3.5 px-4">
                    {(po.items || []).map((i, idx) => (
                      <div key={idx} className="text-[#2F2A25]">
                        {i.nombreProducto} ({i.talla} / {i.color})
                      </div>
                    ))}
                  </td>
                  <td className="py-3.5 px-4 text-center font-bold">
                    {(po.items || []).reduce((sum, i) => sum + (i.cantidad || 0), 0)} uds
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-[#2F2A25]">
                    {formatCurrency(po.total, settings.simboloMoneda)}
                  </td>
                  <td className="py-3.5 px-4 text-[#756E65]">{po.formaPago}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        po.estado === 'ANULADA'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}
                    >
                      {po.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* CREATE PURCHASE MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Entrada de Mercancía / Compra</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={savingPurchase}
                className="text-[#756E65] p-1 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePurchase} noValidate className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Taller o Proveedor:</label>
                <input
                  type="text"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  disabled={savingPurchase}
                  placeholder="Ej. Confecciones & Textiles del Caribe"
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Prenda a Ingresar:</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    const p = (products || []).find((pr) => pr.id === e.target.value);
                    setSelectedVariantId(p?.variantes?.[0]?.id || '');
                    setCostoUnitario(p?.costo || 0);
                  }}
                  disabled={savingPurchase}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                >
                  {(products || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Variante (Talla / Color):</label>
                <select
                  value={selectedVariantId}
                  onChange={(e) => setSelectedVariantId(e.target.value)}
                  disabled={savingPurchase}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                >
                  {(selectedProduct?.variantes || []).map((v) => (
                    <option key={v.id} value={v.id}>
                      Talla {v.talla} / {v.color} (Stock actual: {v.stock} uds)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Cantidad Comprada:</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    placeholder="1"
                    value={cantidad === '' ? '' : cantidad}
                    disabled={savingPurchase}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setCantidad('');
                      else {
                        const num = parseInt(val, 10);
                        setCantidad(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Costo Unitario (RD$):</label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={costoUnitario === '' ? '' : costoUnitario}
                    disabled={savingPurchase}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setCostoUnitario('');
                      else {
                        const num = parseFloat(val);
                        setCostoUnitario(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Forma de Pago al Proveedor:</label>
                <select
                  value={formaPago}
                  onChange={(e) => setFormaPago(e.target.value as any)}
                  disabled={savingPurchase}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                >
                  <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="CREDITO_PROVEEDOR">A Crédito (Cuenta por Pagar)</option>
                </select>
                {formaPago === 'CREDITO_PROVEEDOR' && (
                  <p className="mt-1.5 text-[10px] text-amber-700">
                    ⚠ Este campo es solo informativo: el sistema todavía no lleva un registro de cuentas por pagar a proveedores.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Notas (opcional):</label>
                <input
                  type="text"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  disabled={savingPurchase}
                  placeholder="Ej. Factura #4521 / Entrega parcial"
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-center justify-between font-bold text-emerald-900">
                <span>Total Compra (estimado):</span>
                <span className="text-sm">
                  {formatCurrency(
                    ((typeof cantidad === 'number' ? cantidad : parseInt(cantidad, 10)) || 0) *
                      ((typeof costoUnitario === 'number' ? costoUnitario : parseFloat(costoUnitario)) || 0),
                    settings.simboloMoneda
                  )}
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={savingPurchase}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPurchase || !selectedVariant}
                  className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md hover:bg-[#403932] disabled:bg-zinc-300"
                >
                  {savingPurchase ? 'Procesando...' : 'Confirmar & Recibir Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
