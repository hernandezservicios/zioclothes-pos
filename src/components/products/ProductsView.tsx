import React, { useState, useMemo, useEffect } from 'react';
import { Product } from '../../types';
import { productsApi } from '../../services/productsApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import { ProductFormModal } from './ProductFormModal';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Package,
  Layers,
  Filter,
  Download,
  ShoppingBag,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

/**
 * FASE 3.6B (corrección de fuente de datos): Productos, sus variantes y
 * las categorías/tallas/colores/proveedores auxiliares vienen
 * EXCLUSIVAMENTE de productsApi (backend real, ver ProductsController.gs).
 * No hay ningún array hardcodeado ni fallback a storageService/demo aquí
 * -- si el backend devuelve vacío, se muestra vacío; si falla, se muestra
 * error con Retry.
 */
export const ProductsView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  // CORREGIR AUDITORÍA: productos/categorías/tallas/colores/proveedores ya
  // no viven en un estado local propio de esta vista -- se leen del
  // DataStore central, la MISMA colección que ahora también consumen
  // POSView, InventoryView y PurchasesView. Guardar/editar/eliminar aquí
  // invalida el DataStore (refreshProducts({force:true})) en vez de
  // recargar solo esta vista, así que el POS y las demás vistas reciben el
  // cambio de inmediato, sin logout/login ni F5.
  const {
    products,
    categories,
    sizes,
    colors,
    suppliers,
    productsLoading: loading,
    productsError: error,
    productsStale,
    refreshProducts,
  } = useDataStore();

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refreshProducts();
  }, [refreshProducts]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODOS');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  // Edit / Create Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const filteredProducts = useMemo(() => {
    return (products || []).filter((p) => {
      if (!p) return false;
      const matchesCat = selectedCategory === 'TODOS' || p.categoriaId === selectedCategory;
      const totalStock = (p.variantes || []).reduce((sum, v) => sum + (v.stock || 0), 0);
      const isLow = totalStock <= (p.stockMinimo || 5);
      const matchesLow = !onlyLowStock || isLow;

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (p.nombre && p.nombre.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.codigoBarras && p.codigoBarras.toLowerCase().includes(q)) ||
        (p.marca && p.marca.toLowerCase().includes(q)) ||
        (p.variantes || []).some(
          (v) =>
            (v.talla && v.talla.toLowerCase().includes(q)) ||
            (v.color && v.color.toLowerCase().includes(q)) ||
            (v.sku && v.sku.toLowerCase().includes(q)) ||
            (v.codigoBarras && v.codigoBarras.toLowerCase().includes(q))
        );

      return matchesCat && matchesLow && matchesSearch;
    });
  }, [products, selectedCategory, onlyLowStock, searchQuery]);

  const handleOpenCreate = () => {
    setEditingProduct(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (prod: Product) => {
    setEditingProduct(prod);
    setModalOpen(true);
  };

  // FASE 3.6B: crea/actualiza vía products.save real (ProductsController.gs
  // -- LockService, genera SKU/barcode reales si faltan, persiste en
  // Productos/Variantes). El modal permanece abierto si falla, y se
  // recarga la lista completa desde el backend tras un éxito (en vez de
  // fusionar localmente) para reflejar exactamente lo que el backend
  // aceptó -- incluye la Prueba C/D pedida (crear -> aparece en Sheets ->
  // recargar trae lo mismo de vuelta).
  const handleSaveProductData = async (productData: {
    nombre: string;
    descripcion: string;
    categoriaId: string;
    marca: string;
    precio: number;
    costo: number;
    imagenUrl: string;
    stockMinimo: number;
    codigoBarras?: string;
    tieneVariantes?: boolean;
    variantes: any[];
  }) => {
    setSaving(true);
    const res = await productsApi.save({
      id: editingProduct ? editingProduct.id : undefined,
      nombre: productData.nombre,
      categoriaId: productData.categoriaId,
      descripcion: productData.descripcion,
      marca: productData.marca,
      codigoBarras: productData.codigoBarras,
      precio: productData.precio,
      costo: productData.costo,
      imagenUrl: productData.imagenUrl,
      stockMinimo: productData.stockMinimo,
      tieneVariantes: productData.tieneVariantes,
      variantes: productData.variantes.map((v) => ({
        // Solo se envía el id si tiene el formato real emitido por el
        // backend (VAR-000001, ver Sequences.gs). Los ids temporales que
        // genera ProductFormModal al armar la matriz talla×color
        // (VAR-<timestamp>-<random>) se envían como undefined para que
        // products.save los cree como variantes NUEVAS -- si se enviaran
        // tal cual, ProductsController los trataría como un id de
        // variante real inexistente.
        id: /^VAR-\d+$/.test(String(v.id)) ? v.id : undefined,
        sku: v.sku,
        codigoBarras: v.codigoBarras,
        color: v.color,
        talla: v.talla,
        costo: v.costo,
        precio: v.precio,
        stock: v.stock,
        estado: v.estado,
      })),
    });
    setSaving(false);

    if (!res.success) {
      showToast('Error al Guardar', res.message || 'No se pudo guardar el producto.', 'error');
      return; // El modal permanece abierto para reintentar.
    }

    showToast(
      editingProduct ? 'Producto Actualizado' : 'Producto Registrado',
      res.message || `${productData.nombre} guardado exitosamente.`,
      'exito'
    );
    setModalOpen(false);
    // CORREGIR AUDITORÍA: invalida el DataStore central -- POS, Inventario
    // y Compras ven el producto nuevo/editado sin recargar sesión ni F5.
    await refreshProducts({ force: true });
  };

  // FASE 3.6B: contra products.delete real (soft-delete -> estado
  // INACTIVO en Productos/Variantes, ver ProductsController.gs). La UI se
  // actualiza recargando desde el backend, no marcando localmente.
  const handleDeleteProduct = async (prod: Product) => {
    if (!window.confirm(`¿Seguro que desea desactivar ${prod.nombre}?`)) return;

    const res = await productsApi.remove(prod.id);
    if (!res.success) {
      showToast('Error al Desactivar', res.message || 'No se pudo desactivar el producto.', 'error');
      return;
    }

    showToast('Producto Desactivado', res.message || `${prod.nombre} ha sido retirado del catálogo activo`, 'informacion');
    // CORREGIR AUDITORÍA: idem -- el resto de vistas deja de ver el producto
    // desactivado de inmediato, sin logout/login ni F5.
    await refreshProducts({ force: true });
  };

  const handleExportCSV = () => {
    const rows: any[] = [];
    (filteredProducts || []).forEach((p) => {
      (p.variantes || []).forEach((v) => {
        rows.push({
          ID_Producto: p.id,
          Nombre: p.nombre,
          Categoria: p.categoriaNombre,
          Marca: p.marca,
          SKU_Variante: v.sku,
          CodigoBarras: v.codigoBarras,
          Talla: v.talla,
          Color: v.color,
          Stock: v.stock,
          Costo: v.costo,
          Precio: v.precio,
          Total_Valor_Inventario: (v.stock || 0) * (v.costo || 0),
        });
      });
    });
    exportToCSV('Catalogo_Productos', rows);
    showToast('Exportación Exitosa', 'Archivo CSV de inventario generado.', 'exito');
  };

  return (
    <div id="products-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Catálogo de Productos
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Productos
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => refreshProducts({ force: true })}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-[#756E65] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Cargando...' : 'Recargar'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {hasPermission('productos.crear') && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Nuevo Producto</span>
            </button>
          )}
        </div>
      </div>

      {/* FASE 3.6B / CORREGIR AUDITORÍA: estado de error explícito con
          Retry -- nunca cae a datos demo/locales. Si `productsStale` es
          true, la tabla de abajo SÍ sigue mostrando productos, pero son de
          una carga anterior -- se aclara explícitamente para no dar a
          entender que están confirmados como actuales (hallazgo #6 de la
          auditoría). */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-rose-800">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-bold text-xs">No se pudo cargar el catálogo desde el backend</p>
              <p className="text-[11px]">{error}</p>
              {productsStale && (
                <p className="text-[11px] mt-1 font-semibold text-rose-900">
                  La tabla de abajo muestra la última información disponible ({products.length} prenda
                  {products.length === 1 ? '' : 's'}) -- no se pudo confirmar si sigue siendo la actual.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => refreshProducts({ force: true })}
            className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nombre, talla, color, SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
          >
            <option value="TODOS">Todas las Categorías</option>
            {(categories || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] cursor-pointer">
            <input
              type="checkbox"
              checked={onlyLowStock}
              onChange={(e) => setOnlyLowStock(e.target.checked)}
              className="rounded text-[#2F2A25]"
            />
            <span>Stock Bajo</span>
          </label>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Producto</th>
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4">Matriz Talla / Color</th>
                <th className="py-3 px-4 text-right">Precio Venta</th>
                {hasPermission('inventario.ver_costos') && (
                  <th className="py-3 px-4 text-right">Costo</th>
                )}
                <th className="py-3 px-4 text-center">Stock Total</th>
                <th className="py-3 px-4 text-center">Estado</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredProducts || []).map((prod) => {
                const totalStock = (prod.variantes || []).reduce((sum, v) => sum + (v.stock || 0), 0);
                const isLow = totalStock <= (prod.stockMinimo || 5);

                return (
                  <tr key={prod.id} className="hover:bg-[#FAF8F4]/80 transition">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {prod.imagenUrl ? (
                          <img
                            src={toDisplayableImageUrl(prod.imagenUrl)}
                            alt={prod.nombre}
                            className="w-10 h-10 rounded-xl object-cover border border-[#E4DDD2]"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-[#F6F1E8] border border-[#E4DDD2] flex items-center justify-center text-[#756E65]">
                            <ShoppingBag className="w-5 h-5 opacity-40" />
                          </div>
                        )}
                        <div>
                          <h4 className="font-bold text-[#2F2A25]">{prod.nombre}</h4>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#756E65] font-mono">
                            <span>{prod.sku}</span>
                            {prod.codigoBarras && (
                              <>
                                <span>•</span>
                                <span className="text-[#C2410C] font-semibold">{prod.codigoBarras}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#756E65]">
                      {prod.categoriaNombre}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {(prod.variantes || []).slice(0, 4).map((v) => (
                          <span
                            key={v.id}
                            className="px-1.5 py-0.5 rounded bg-[#F6F1E8] border border-[#E4DDD2] text-[10px] text-[#2F2A25]"
                          >
                            {v.talla}/{v.color} ({v.stock})
                          </span>
                        ))}
                        {(prod.variantes || []).length > 4 && (
                          <span className="text-[10px] text-[#756E65] font-bold self-center">
                            +{(prod.variantes || []).length - 4} más
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-[#2F2A25]">
                      {formatCurrency(prod.precio, settings.simboloMoneda)}
                    </td>
                    {hasPermission('inventario.ver_costos') && (
                      <td className="py-3 px-4 text-right text-[#756E65]">
                        {formatCurrency(prod.costo, settings.simboloMoneda)}
                      </td>
                    )}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                          totalStock === 0
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : isLow
                            ? 'bg-amber-50 text-amber-900 border-amber-200'
                            : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                        }`}
                      >
                        {totalStock} uds
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          prod.estado === 'ACTIVO'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                        }`}
                      >
                        {prod.estado}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {hasPermission('productos.editar') && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(prod)}
                            className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                            title="Editar prenda"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('productos.eliminar') && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct(prod)}
                            className="p-1.5 rounded-lg text-rose-600 hover:text-rose-800 hover:bg-rose-50 transition"
                            title="Desactivar prenda"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {loading && products.length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <RefreshCw className="w-8 h-8 opacity-40 mx-auto animate-spin" />
              <p className="font-semibold text-xs text-[#2F2A25]">Cargando catálogo desde Google Sheets...</p>
            </div>
          )}

          {/* FASE 3.6B: estado vacío honesto -- si el backend devuelve []
              (o el filtro no encuentra nada), se muestra vacío. Nunca se
              rellena con datos demo. */}
          {!loading && !error && (filteredProducts || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Package className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">
                {products.length === 0
                  ? 'El catálogo está vacío en Google Sheets'
                  : 'No se encontraron prendas con ese filtro'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE / EDIT PRODUCT MODAL */}
      <ProductFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        editingProduct={editingProduct}
        categories={categories}
        initialSizes={sizes}
        initialColors={colors}
        currencySymbol={settings.simboloMoneda}
        saving={saving}
        onSave={handleSaveProductData}
      />
    </div>
  );
};
