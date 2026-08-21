import React, { useState, useMemo } from 'react';
import { InventoryMovement, Product, ProductVariant } from '../../types';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import {
  Package,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Search,
  Filter,
  Download,
  AlertTriangle,
  Plus,
  X,
  CheckCircle2,
} from 'lucide-react';

interface InventoryViewProps {
  initialTab?: 'KARDEX' | 'STOCK_BAJO' | 'STOCK_ACTUAL';
  initialSearchQuery?: string;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  initialTab,
  initialSearchQuery,
}) => {
  const { currentUser, settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [movements, setMovements] = useState<InventoryMovement[]>(() => storageService.getMovements() || []);
  const [products, setProducts] = useState<Product[]>(() => storageService.getProducts() || []);

  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('TODOS');
  const [activeTab, setActiveTab] = useState<'KARDEX' | 'STOCK_BAJO' | 'STOCK_ACTUAL'>(
    initialTab || 'STOCK_ACTUAL'
  );

  React.useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  React.useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Adjustment Modal State
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<'ENTRADA' | 'SALIDA' | 'AJUSTE'>('ENTRADA');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState<number | string>(1);
  const [adjustmentReason, setAdjustmentReason] = useState('Reabastecimiento de proveedor');
  const [loading, setLoading] = useState(false);

  const selectedProduct = (products || []).find((p) => p && p.id === selectedProductId);
  const selectedProductVariants = selectedProduct?.variantes || [];
  const selectedVariant = selectedProductVariants.find((v) => v.id === selectedVariantId) || selectedProductVariants[0];

  // Critical Low Stock Products
  const lowStockVariants = useMemo(() => {
    const list: { product: Product; variant: ProductVariant }[] = [];
    (products || []).forEach((p) => {
      if (p && p.variantes) {
        (p.variantes || []).forEach((v) => {
          if (v && (v.stock || 0) <= (p.stockMinimo || 4)) {
            list.push({ product: p, variant: v });
          }
        });
      }
    });
    return list;
  }, [products]);

  // Filtered Kardex Movements
  const filteredMovements = useMemo(() => {
    return (movements || []).filter((m) => {
      if (!m) return false;
      const matchesType = movementTypeFilter === 'TODOS' || m.tipo === movementTypeFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (m.productoNombre && m.productoNombre.toLowerCase().includes(q)) ||
        (m.sku && m.sku.toLowerCase().includes(q)) ||
        (m.motivo && m.motivo.toLowerCase().includes(q)) ||
        (m.usuarioNombre && m.usuarioNombre.toLowerCase().includes(q));

      return matchesType && matchesSearch;
    });
  }, [movements, movementTypeFilter, searchQuery]);

  const handleOpenAdjustmentFor = (prod: Product, variant: ProductVariant) => {
    setSelectedProductId(prod.id);
    setSelectedVariantId(variant.id);
    setAdjustmentType('ENTRADA');
    setAdjustmentQuantity(1);
    setAdjustmentReason('Reabastecimiento rápido de stock bajo');
    setAdjustmentModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedProduct || !selectedVariant) return;

    const numQty = typeof adjustmentQuantity === 'number' ? adjustmentQuantity : parseInt(adjustmentQuantity, 10);
    if (!Number.isFinite(numQty) || numQty <= 0) {
      showToast('Cantidad Inválida', 'La cantidad debe ser un número entero mayor a 0.', 'error');
      return;
    }
    if (!adjustmentReason.trim()) {
      showToast('Motivo Requerido', 'Debe ingresar un motivo o justificación.', 'error');
      return;
    }

    setLoading(true);

    const delta = adjustmentType === 'SALIDA' ? -adjustmentQuantity : adjustmentQuantity;
    const res = await apiService.adjustInventory({
      productoId: selectedProduct.id,
      varianteId: selectedVariant.id,
      cantidad: delta,
      tipo: adjustmentType,
      motivo: adjustmentReason,
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
    });

    setLoading(false);

    if (res.success) {
      showToast('Ajuste Registrado', res.message, 'exito');
      setProducts(storageService.getProducts());
      setMovements(storageService.getMovements());
      setAdjustmentModalOpen(false);
    } else {
      showToast('Error', res.message, 'error');
    }
  };

  const handleExportKardexCSV = () => {
    const rows = (filteredMovements || []).map((m) => ({
      ID_Movimiento: m.id,
      Fecha: m.fecha,
      Tipo: m.tipo,
      Prenda: m.productoNombre,
      Talla: m.talla,
      Color: m.color,
      SKU: m.sku,
      Cantidad: m.cantidad,
      Stock_Anterior: m.stockAnterior,
      Stock_Nuevo: m.stockNuevo,
      Motivo: m.motivo,
      Referencia: m.referencia || 'N/A',
      Usuario: m.usuarioNombre,
    }));
    exportToCSV('Kardex_Inventario_ZIO', rows);
    showToast('Exportación Exitosa', 'Kardex descargado en CSV.', 'exito');
  };

  return (
    <div id="inventory-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Control de Stock & Kardex
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Inventario de Boutique
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportKardexCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar Kardex</span>
          </button>

          {hasPermission('inventario.ajustar') && (
            <button
              type="button"
              onClick={() => {
                setSelectedProductId(products[0]?.id || '');
                setSelectedVariantId(products[0]?.variantes?.[0]?.id || '');
                setAdjustmentModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Ajustar Stock / Entrada</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#F6F1E8] border border-[#E4DDD2] p-1 rounded-2xl w-fit text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('STOCK_ACTUAL')}
          className={`px-4 py-2 rounded-xl transition ${
            activeTab === 'STOCK_ACTUAL'
              ? 'bg-[#2F2A25] text-[#FAF8F4] shadow-xs'
              : 'text-[#756E65] hover:text-[#2F2A25]'
          }`}
        >
          Stock por Variantes
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('STOCK_BAJO')}
          className={`px-4 py-2 rounded-xl transition flex items-center gap-2 ${
            activeTab === 'STOCK_BAJO'
              ? 'bg-[#2F2A25] text-[#FAF8F4] shadow-xs'
              : 'text-[#756E65] hover:text-[#2F2A25]'
          }`}
        >
          <span>Alertas Stock Bajo</span>
          {(lowStockVariants || []).length > 0 && (
            <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center">
              {(lowStockVariants || []).length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('KARDEX')}
          className={`px-4 py-2 rounded-xl transition ${
            activeTab === 'KARDEX'
              ? 'bg-[#2F2A25] text-[#FAF8F4] shadow-xs'
              : 'text-[#756E65] hover:text-[#2F2A25]'
          }`}
        >
          Kardex & Movimientos
        </button>
      </div>

      {/* TAB 1: STOCK ACTUAL POR VARIANTES */}
      {activeTab === 'STOCK_ACTUAL' && (
        <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3 px-4">Prenda</th>
                  <th className="py-3 px-4">SKU / Código</th>
                  <th className="py-3 px-4">Talla</th>
                  <th className="py-3 px-4">Color</th>
                  <th className="py-3 px-4 text-center">Stock Actual</th>
                  {hasPermission('inventario.ver_costos') && (
                    <th className="py-3 px-4 text-right">Valor Total (Costo)</th>
                  )}
                  <th className="py-3 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(products || []).flatMap((prod) =>
                  (prod.variantes || []).map((v) => (
                    <tr key={v.id} className="hover:bg-[#FAF8F4]/80 transition">
                      <td className="py-3 px-4 font-bold text-[#2F2A25]">{prod.nombre}</td>
                      <td className="py-3 px-4 font-mono text-[#756E65] text-[11px]">{v.sku}</td>
                      <td className="py-3 px-4 font-semibold">{v.talla}</td>
                      <td className="py-3 px-4 text-[#756E65]">{v.color}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`font-bold px-2.5 py-0.5 rounded-full border text-[11px] ${
                            v.stock === 0
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : v.stock <= (prod.stockMinimo || 4)
                              ? 'bg-amber-50 text-amber-900 border-amber-200'
                              : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                          }`}
                        >
                          {v.stock} uds
                        </span>
                      </td>
                      {hasPermission('inventario.ver_costos') && (
                        <td className="py-3 px-4 text-right font-bold text-[#2F2A25]">
                          {formatCurrency(v.stock * v.costo, settings.simboloMoneda)}
                        </td>
                      )}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleOpenAdjustmentFor(prod, v)}
                          className="px-2.5 py-1 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[11px] font-bold text-[#2F2A25] hover:bg-[#F6F1E8]"
                        >
                          Ajustar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: CRITICAL LOW STOCK */}
      {activeTab === 'STOCK_BAJO' && (
        <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs space-y-4 p-5">
          <div className="flex items-center gap-3 text-amber-900 font-bold text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <span>Prendas con Stock Crítico o Agotado</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#FAF8F4] text-[#756E65] border-b border-[#E4DDD2] uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Prenda</th>
                  <th className="py-2.5 px-4">Variante (Talla / Color)</th>
                  <th className="py-2.5 px-4">SKU</th>
                  <th className="py-2.5 px-4 text-center">Stock Actual</th>
                  <th className="py-2.5 px-4 text-center">Stock Mínimo</th>
                  <th className="py-2.5 px-4 text-center">Acción de Reabastecimiento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(lowStockVariants || []).map(({ product, variant }) => (
                  <tr key={variant.id} className="hover:bg-[#FAF8F4]">
                    <td className="py-3 px-4 font-bold text-[#2F2A25]">{product.nombre}</td>
                    <td className="py-3 px-4">
                      {variant.talla} / {variant.color}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#756E65]">{variant.sku}</td>
                    <td className="py-3 px-4 text-center font-bold text-rose-700">
                      {variant.stock} uds
                    </td>
                    <td className="py-3 px-4 text-center text-[#756E65]">
                      {product.stockMinimo || 4} uds
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleOpenAdjustmentFor(product, variant)}
                        className="px-3 py-1 rounded-xl bg-[#2F2A25] text-white text-[11px] font-bold hover:bg-[#403932]"
                      >
                        + Reabastecer Entrada
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(lowStockVariants || []).length === 0 && (
              <div className="text-center py-12 text-emerald-800 space-y-2">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600" />
                <p className="font-bold text-xs">Todos los niveles de inventario se encuentran óptimos.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: KARDEX MOVEMENTS LOG */}
      {activeTab === 'KARDEX' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar en Kardex por prenda, motivo, usuario..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
              />
            </div>

            <select
              value={movementTypeFilter}
              onChange={(e) => setMovementTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
            >
              <option value="TODOS">Todos los Tipos</option>
              <option value="ENTRADA">Entrada / Compra</option>
              <option value="VENTA">Venta POS</option>
              <option value="DEVOLUCION">Devolución</option>
              <option value="AJUSTE">Ajuste Manual</option>
              <option value="SALIDA">Salida / Merma</option>
            </select>
          </div>

          <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
                  <tr>
                    <th className="py-3 px-4">Fecha & Hora</th>
                    <th className="py-3 px-4">Tipo</th>
                    <th className="py-3 px-4">Prenda & Variante</th>
                    <th className="py-3 px-4 text-center">Cantidad</th>
                    <th className="py-3 px-4 text-center">Saldo Stock</th>
                    <th className="py-3 px-4">Motivo / Detalle</th>
                    <th className="py-3 px-4">Responsable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4DDD2]/60">
                  {(filteredMovements || []).map((m) => {
                    const isPositive = m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCION';
                    return (
                      <tr key={m.id} className="hover:bg-[#FAF8F4]/80 transition">
                        <td className="py-3 px-4 text-[#756E65]">{formatDateTime(m.fecha)}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              m.tipo === 'VENTA'
                                ? 'bg-blue-50 text-blue-800 border-blue-200'
                                : m.tipo === 'ENTRADA'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : m.tipo === 'DEVOLUCION'
                                ? 'bg-purple-50 text-purple-800 border-purple-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {m.tipo}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#2F2A25]">{m.productoNombre}</div>
                          <div className="text-[10px] text-[#756E65]">
                            Talla {m.talla} • {m.color} • {m.sku}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-bold">
                          <span className={isPositive ? 'text-emerald-700' : 'text-rose-700'}>
                            {isPositive ? `+${m.cantidad}` : `-${m.cantidad}`}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[11px] text-[#756E65]">
                          {m.stockAnterior} → <span className="font-bold text-[#2F2A25]">{m.stockNuevo}</span>
                        </td>
                        <td className="py-3 px-4 text-[#756E65]">{m.motivo}</td>
                        <td className="py-3 px-4 text-[#756E65]">{m.usuarioNombre}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {(filteredMovements || []).length === 0 && (
                <div className="text-center py-12 text-[#756E65] text-xs">
                  No hay movimientos registrados con los filtros aplicados.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {adjustmentModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">
                Ajuste Manual / Entrada de Inventario
              </h3>
              <button
                type="button"
                onClick={() => setAdjustmentModalOpen(false)}
                className="text-[#756E65] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} noValidate className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Prenda:</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    const p = (products || []).find((pr) => pr.id === e.target.value);
                    setSelectedVariantId(p?.variantes?.[0]?.id || '');
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Tipo de Operación:</label>
                  <select
                    value={adjustmentType}
                    onChange={(e) => setAdjustmentType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                  >
                    <option value="ENTRADA">Entrada / Compra (+)</option>
                    <option value="SALIDA">Salida / Merma (-)</option>
                    <option value="AJUSTE">Ajuste Conteo</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Cantidad de Unidades:</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="1"
                    value={adjustmentQuantity === '' ? '' : adjustmentQuantity}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setAdjustmentQuantity('');
                      else {
                        const num = parseInt(val, 10);
                        setAdjustmentQuantity(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold text-[#2F2A25]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Motivo / Justificación:</label>
                <input
                  type="text"
                  required
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Ej. Conteo físico semanal / Mercancía de taller"
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 rounded-xl bg-[#2F2A25] text-xs font-bold text-white shadow-md hover:bg-[#403932]"
                >
                  {loading ? 'Aplicando...' : 'Aplicar al Kardex'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
