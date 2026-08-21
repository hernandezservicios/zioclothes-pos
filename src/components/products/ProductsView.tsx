import React, { useState, useMemo } from 'react';
import { Product, Category } from '../../types';
import { storageService } from '../../services/storageService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
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
} from 'lucide-react';

export const ProductsView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>(() => storageService.getProducts() || []);
  const categories = storageService.getCategories() || [];

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

  const handleSaveProductData = (productData: {
    nombre: string;
    descripcion: string;
    categoriaId: string;
    marca: string;
    precio: number;
    costo: number;
    imagenUrl: string;
    stockMinimo: number;
    codigoBarras?: string;
    variantes: any[];
  }) => {
    const cat = (categories || []).find((c) => c.id === productData.categoriaId);
    const catNombre = cat ? cat.nombre : 'General';

    if (editingProduct) {
      // Update
      const updated = (products || []).map((p) => {
        if (p.id === editingProduct.id) {
          return {
            ...p,
            nombre: productData.nombre,
            codigoBarras: productData.codigoBarras || p.codigoBarras,
            descripcion: productData.descripcion,
            categoriaId: productData.categoriaId,
            categoriaNombre: catNombre,
            marca: productData.marca,
            precio: productData.precio,
            costo: productData.costo,
            imagenUrl: productData.imagenUrl,
            stockMinimo: productData.stockMinimo,
            variantes: productData.variantes.map((v) => ({
              ...v,
              productoId: editingProduct.id,
            })),
          };
        }
        return p;
      });
      storageService.saveProducts(updated);
      setProducts(updated);
      showToast('Prenda Actualizada', `Se guardaron los cambios de ${productData.nombre}`, 'exito');
    } else {
      // Create new
      const cleanName = productData.nombre.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'PRE';
      const newSku = `ZIO-${cleanName}-${Math.floor(100 + Math.random() * 900)}`;
      const prodId = storageService.getNextSequence('PRD');
      const newProd: Product = {
        id: prodId,
        nombre: productData.nombre,
        descripcion: productData.descripcion,
        categoriaId: productData.categoriaId,
        categoriaNombre: catNombre,
        marca: productData.marca,
        sku: newSku,
        codigoBarras: productData.codigoBarras || `7460000${Math.floor(10000 + Math.random() * 90000)}`,
        precio: productData.precio,
        costo: productData.costo,
        impuesto: 18,
        stockMinimo: productData.stockMinimo,
        imagenUrl: productData.imagenUrl,
        variantes: productData.variantes.map((v) => ({ ...v, productoId: prodId })),
        estado: 'ACTIVO',
        fechaCreacion: new Date().toISOString().replace('T', ' ').substring(0, 19),
      };

      const updated = [newProd, ...(products || [])];
      storageService.saveProducts(updated);
      setProducts(updated);
      showToast('Prenda Registrada', `${newProd.nombre} agregada al catálogo exitosamente`, 'exito');
    }

    setModalOpen(false);
  };

  const handleDeleteProduct = (prod: Product) => {
    if (!window.confirm(`¿Seguro que desea desactivar ${prod.nombre}?`)) return;
    const updated = (products || []).map((p) => (p.id === prod.id ? { ...p, estado: 'INACTIVO' as const } : p));
    storageService.saveProducts(updated);
    setProducts(updated);
    showToast('Prenda Desactivada', `${prod.nombre} ha sido retirada del catálogo activo`, 'informacion');
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
    exportToCSV('Catalogo_Prendas_ZIO', rows);
    showToast('Exportación Exitosa', 'Archivo CSV de inventario generado.', 'exito');
  };

  return (
    <div id="products-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Catálogo & Matriz de Tallas/Colores
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Prendas de Vestir
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
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
              <span>Nueva Prenda</span>
            </button>
          )}
        </div>
      </div>

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
                <th className="py-3 px-4">Prenda</th>
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
                            src={prod.imagenUrl}
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

          {(filteredProducts || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Package className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">No se encontraron prendas en el catálogo</p>
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
        currencySymbol={settings.simboloMoneda}
        onSave={handleSaveProductData}
      />
    </div>
  );
};
