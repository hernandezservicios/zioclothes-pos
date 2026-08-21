import React, { useState } from 'react';
import { PurchaseOrder, Product } from '../../types';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { Truck, Plus, Search, Download, CheckCircle2, X, Package } from 'lucide-react';

export const PurchasesView: React.FC = () => {
  const { currentUser, settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [purchases, setPurchases] = useState<PurchaseOrder[]>(() => storageService.getPurchases() || []);
  const products = storageService.getProducts() || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  // Form
  const [proveedor, setProveedor] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [cantidad, setCantidad] = useState<number | string>(1);
  const [costoUnitario, setCostoUnitario] = useState<number | string>(0);
  const [formaPago, setFormaPago] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'CREDITO_PROVEEDOR'>('TRANSFERENCIA');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);

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
    if (!Number.isFinite(numCosto) || numCosto < 0) {
      showToast('Costo Inválido', 'El costo unitario debe ser un valor mayor o igual a RD$ 0.00.', 'error');
      return;
    }

    setLoading(true);

    const total = numCantidad * numCosto;
    const purchaseNum = storageService.getNextSequence('COM');

    // 1. Increment Stock in Product
    const currentProducts = storageService.getProducts() || [];
    const pIdx = currentProducts.findIndex((p) => p && p.id === selectedProduct.id);
    if (pIdx !== -1) {
      const vIdx = (currentProducts[pIdx].variantes || []).findIndex((v) => v && v.id === selectedVariant.id);
      if (vIdx !== -1) {
        const v = currentProducts[pIdx].variantes[vIdx];
        const stockAnterior = v.stock || 0;
        const stockNuevo = stockAnterior + numCantidad;
        currentProducts[pIdx].variantes[vIdx].stock = stockNuevo;
        currentProducts[pIdx].variantes[vIdx].costo = numCosto;
        storageService.saveProducts(currentProducts);

        // 2. Add Kardex movement
        const movements = storageService.getMovements() || [];
        movements.unshift({
          id: storageService.getNextSequence('MOV'),
          productoId: selectedProduct.id,
          productoNombre: selectedProduct.nombre,
          varianteId: selectedVariant.id,
          sku: selectedVariant.sku,
          talla: selectedVariant.talla,
          color: selectedVariant.color,
          cantidad: numCantidad,
          tipo: 'COMPRA',
          stockAnterior,
          stockNuevo,
          motivo: `Compra a Proveedor ${purchaseNum}: ${proveedor.trim()}`,
          referencia: purchaseNum,
          usuarioId: currentUser.id,
          usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
          fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
        });
        storageService.saveMovements(movements);
      }
    }

    // 3. Save Purchase Order
    const newPurchase: PurchaseOrder = {
      id: `COM-${Date.now()}`,
      numeroCompra: purchaseNum,
      proveedor: proveedor.trim(),
      items: [
        {
          productoId: selectedProduct.id,
          varianteId: selectedVariant.id,
          nombreProducto: selectedProduct.nombre,
          talla: selectedVariant.talla,
          color: selectedVariant.color,
          cantidad: numCantidad,
          costoUnitario: numCosto,
          total,
        },
      ],
      total,
      formaPago,
      estado: 'RECIBIDA',
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      notas: notas.trim() || undefined,
    };

    const currentPurchases = storageService.getPurchases() || [];
    currentPurchases.unshift(newPurchase);
    storageService.savePurchases(currentPurchases);
    setPurchases(currentPurchases);

    setLoading(false);
    setModalOpen(false);
    showToast('Compra Registrada', `Se ingresaron ${numCantidad} unidades al inventario.`, 'exito');
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
          {hasPermission('inventario.crear') && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Registrar Compra de Ropa</span>
            </button>
          )}
        </div>
      </div>

      {/* Purchases Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
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
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                      {po.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(purchases || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Truck className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">No hay órdenes de compra registradas</p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE PURCHASE MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Entrada de Mercancía / Compra</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-[#756E65] p-1">
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
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="1"
                    value={cantidad === '' ? '' : cantidad}
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
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={costoUnitario === '' ? '' : costoUnitario}
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
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                >
                  <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="CREDITO_PROVEEDOR">A Crédito (Cuenta por Pagar)</option>
                </select>
              </div>

              <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-center justify-between font-bold text-emerald-900">
                <span>Total Compra:</span>
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
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md hover:bg-[#403932]"
                >
                  {loading ? 'Procesando...' : 'Confirmar & Recibir Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
