import React, { useState, useMemo, useEffect } from 'react';
import { Product, ProductVariant, Customer, SaleItem, Sale } from '../../types';
import { storageService } from '../../services/storageService';
import { customersApi } from '../../services/customersApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/formatters';
import { sounds } from '../../utils/soundEffects';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import { VariantSelectorModal } from './VariantSelectorModal';
import { PaymentModal } from './PaymentModal';
import { ReceiptModal } from './ReceiptModal';
import {
  Search,
  Barcode,
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  Percent,
  UserPlus,
  ArrowRight,
  Sparkles,
  Tag,
  AlertCircle,
  X,
  CreditCard,
} from 'lucide-react';

/**
 * FIX P0 (buscador POS / pantalla en blanco): compara un campo del
 * catálogo contra el texto buscado sin asumir que ese campo sea
 * realmente un string en runtime -- antes, expresiones como
 * `campo && campo.toLowerCase()` lanzaban TypeError si `campo` llegaba
 * como `number` (posible si Google Sheets guarda un SKU/código de
 * barras/talla como celda numérica). Segunda capa de defensa: aunque
 * productsApi.ts ya normaliza estos campos a texto en el mapeo, el
 * buscador no depende únicamente de eso para no volver a romperse ante
 * cualquier dato externo inesperado. Mismo comportamiento que antes
 * para valores ya-string: case-insensitive, vacío/ausente nunca coincide.
 */
function normalizeSearchField(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).toLowerCase();
}

export const POSView: React.FC = () => {
  const { settings, currentUser } = useAuth();
  const { showToast } = useToast();

  // CORREGIR AUDITORÍA (requisito crítico): el POS ya NO lee
  // storageService.getProducts()/getCustomers() como fuente viva -- ese
  // caché de localStorage solo se llenaba en login/"Sincronizar Ahora" y
  // quedaba completamente desconectado de lo que Catálogo/Inventario/
  // Compras mostraban en memoria (ver informe de auditoría). Ahora el POS
  // lee el mismo DataStore central que esas vistas, así que un producto
  // creado/editado/desactivado en Catálogo aparece aquí de inmediato, sin
  // logout/login ni F5. `storageService` sigue existiendo (ver
  // DataStoreContext) solo como persistencia para la hidratación inicial.
  const {
    products,
    categories,
    customers,
    refreshProducts,
    refreshCustomers,
    refreshSales,
    refreshCredits,
    refreshCreditNotes,
    getCustomers,
  } = useDataStore();

  // Verifica que el catálogo/clientes estén vigentes al entrar al POS
  // (respeta el TTL/deduplicación del DataStore -- si otra vista ya los
  // refrescó hace poco, esto no dispara ninguna llamada de red nueva).
  useEffect(() => {
    refreshProducts();
    refreshCustomers();
  }, [refreshProducts, refreshCustomers]);

  // Unified Search & Barcode Scanner State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODOS');

  // Cart State
  // PARTE 5 (Hydration-First / F5): se hidrata SINCRÓNICAMENTE desde
  // storageService en la inicialización del estado (no en un useEffect
  // posterior), para que el primer render ya muestre el carrito
  // persistido en vez de mostrar vacío por un instante y luego "saltar".
  // Es solo estado de trabajo/UX -- nunca fuente de verdad de stock/venta.
  const persistedPosState = useMemo(() => storageService.getPosWorkingState(), []);

  const [cartItems, setCartItems] = useState<SaleItem[]>(() => persistedPosState?.cartItems || []);
  // FASE 3.6C (corrección de crash con catálogo vacío): "sin cliente
  // seleccionado" es un estado VÁLIDO (Consumidor Final), no un bug a
  // enmascarar. Antes se intentaba adivinar un cliente por defecto
  // (id fijo 'CLI-005', un residuo del seed de demostración que ya no
  // sembramos, o directamente el primer cliente de la lista) -- si
  // `customers` está vacío (Sheets sin clientes reales todavía) ambos
  // fallbacks devuelven undefined, y ese undefined se usaba después como
  // si fuera un Customer real (selectedCustomer.id), provocando el crash.
  // Ahora el tipo es explícitamente Customer | null.
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(() => {
    const persistedId = persistedPosState?.selectedCustomerId;
    if (!persistedId) return null;
    return (customers || []).find((c) => c.id === persistedId) || null;
  });
  const [discountType, setDiscountType] = useState<'PORCENTAJE' | 'MONTO'>(
    () => persistedPosState?.discountType || 'PORCENTAJE'
  );
  const [overallDiscountValue, setOverallDiscountValue] = useState<number | string>(
    () => persistedPosState?.overallDiscountValue ?? 0
  );
  const [applyTax, setApplyTax] = useState<boolean>(
    () => persistedPosState?.applyTax ?? settings.aplicarImpuestoPorDefecto
  );

  // Modals
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<Product | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState<boolean>(false);
  const [mobileCartOpen, setMobileCartOpen] = useState<boolean>(false);

  // New Customer Form State
  const [newCustNombre, setNewCustNombre] = useState('');
  const [newCustApellido, setNewCustApellido] = useState('');
  const [newCustDoc, setNewCustDoc] = useState('');
  const [newCustTel, setNewCustTel] = useState('');
  const [newCustLimite, setNewCustLimite] = useState(25000);
  const [creatingQuickCustomer, setCreatingQuickCustomer] = useState(false);

  // PARTE 5 (Hydration-First / F5): persiste el estado de trabajo del POS
  // en cada cambio relevante, para que un F5 posterior lo recupere. Nunca
  // se usa para autorizar nada -- el checkout siempre valida/recalcula
  // contra el backend real (ver PaymentModal -> salesApi.createSale).
  useEffect(() => {
    storageService.savePosWorkingState({
      cartItems,
      selectedCustomerId: selectedCustomer?.id,
      discountType,
      overallDiscountValue:
        typeof overallDiscountValue === 'number' ? overallDiscountValue : Number(overallDiscountValue) || 0,
      applyTax,
    });
  }, [cartItems, selectedCustomer, discountType, overallDiscountValue, applyTax]);

  // Filtered Products for Live Search & Category Filtering
  const filteredProducts = useMemo(() => {
    return (products || []).filter((p) => {
      if (!p || p.estado !== 'ACTIVO') return false;
      const matchesCat = selectedCategory === 'TODOS' || p.categoriaId === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        normalizeSearchField(p.nombre).includes(q) ||
        normalizeSearchField(p.sku).includes(q) ||
        normalizeSearchField(p.codigoBarras).includes(q) ||
        normalizeSearchField(p.marca).includes(q) ||
        (p.variantes || []).some(
          (v) =>
            normalizeSearchField(v.sku).includes(q) ||
            normalizeSearchField(v.codigoBarras).includes(q) ||
            normalizeSearchField(v.color).includes(q) ||
            normalizeSearchField(v.talla).includes(q)
        );
      return matchesCat && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Unified Handler for Scanner Gun (Enter) & Quick Search Submissions
  const handleSearchOrScanSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    const queryLower = query.toLowerCase();

    // 1. Exact match on Variant Barcode, Variant SKU, Product Barcode, or Product SKU
    let foundProduct: Product | undefined;
    let foundVariant: ProductVariant | undefined;

    for (const prod of products || []) {
      if (prod.estado !== 'ACTIVO') continue;
      const prodVariants = prod.variantes || [];

      // Check variant exact barcode or SKU first
      const vMatch = prodVariants.find(
        (vr) =>
          normalizeSearchField(vr.codigoBarras) === queryLower ||
          normalizeSearchField(vr.sku) === queryLower
      );
      if (vMatch) {
        foundProduct = prod;
        foundVariant = vMatch;
        break;
      }

      // Check product exact barcode or SKU
      if (
        normalizeSearchField(prod.codigoBarras) === queryLower ||
        normalizeSearchField(prod.sku) === queryLower
      ) {
        foundProduct = prod;
        foundVariant = prodVariants.find((v) => v.stock > 0) || prodVariants[0];
        break;
      }
    }

    if (foundProduct && foundVariant) {
      // If matched the general product barcode and product has multiple active variants, open selector modal
      if (
        (foundProduct.variantes || []).length > 1 &&
        normalizeSearchField(foundProduct.codigoBarras) === queryLower &&
        !foundProduct.variantes.some((v) => normalizeSearchField(v.codigoBarras) === queryLower)
      ) {
        setSelectedProductForVariant(foundProduct);
        sounds.playBeep();
        setSearchQuery('');
        return;
      }

      if (foundVariant.stock <= 0) {
        sounds.playError();
        showToast(
          'Variante Agotada',
          `No hay stock disponible para ${foundProduct.nombre} (${foundVariant.talla}/${foundVariant.color})`,
          'error'
        );
      } else {
        handleAddToCart(foundProduct, foundVariant, 1);
        sounds.playBeep();
        showToast(
          'Agregado al Carrito',
          `${foundProduct.nombre} (${foundVariant.talla} / ${foundVariant.color})`,
          'exito'
        );
        setSearchQuery(''); // Clears search ready for next scan
      }
      return;
    }

    // 2. If no exact barcode match, check if filtered search narrowed down to 1 single product
    if (filteredProducts.length === 1) {
      const singleProd = filteredProducts[0];
      const prodVariants = singleProd.variantes || [];
      if (prodVariants.length === 1) {
        const v = prodVariants[0];
        if (v.stock <= 0) {
          sounds.playError();
          showToast('Producto Agotado', `Sin existencias para ${singleProd.nombre}`, 'error');
        } else {
          handleAddToCart(singleProd, v, 1);
          sounds.playBeep();
          showToast('Agregado al Carrito', `${singleProd.nombre} (${v.talla} / ${v.color})`, 'exito');
          setSearchQuery('');
        }
        return;
      } else if (prodVariants.length > 1) {
        setSelectedProductForVariant(singleProd);
        sounds.playBeep();
        setSearchQuery('');
        return;
      }
    }

    // 3. If no matching product found at all
    if (filteredProducts.length === 0) {
      sounds.playError();
      showToast(
        'No Encontrado',
        `No se encontró ninguna prenda o código coincidente con "${query}"`,
        'advertencia'
      );
    }
  };

  // Add Item to Cart
  const handleAddToCart = (product: Product, variant: ProductVariant, quantity: number) => {
    setCartItems((prev) => {
      const existingIdx = prev.findIndex((item) => item.varianteId === variant.id);
      if (existingIdx !== -1) {
        const item = prev[existingIdx];
        const newQty = item.cantidad + quantity;
        if (newQty > variant.stock) {
          showToast('Stock Límite', `No puede agregar más de ${variant.stock} unidades en stock`, 'advertencia');
          return prev;
        }
        const unitPrice = item.precioUnitario;
        const sub = unitPrice * newQty;
        const descMonto = sub * (item.descuentoPorcentaje / 100);
        const impMonto = applyTax ? (sub - descMonto) * (settings.impuestoPorcentaje / 100) : 0;
        const total = sub - descMonto + impMonto;

        const updated = [...prev];
        updated[existingIdx] = {
          ...item,
          cantidad: newQty,
          subtotal: sub,
          descuentoMonto: descMonto,
          impuestoMonto: impMonto,
          total,
        };
        return updated;
      } else {
        const unitPrice = variant.precio || product.precio;
        const sub = unitPrice * quantity;
        const descMonto = 0;
        const impMonto = applyTax ? sub * (settings.impuestoPorcentaje / 100) : 0;
        const total = sub + impMonto;

        const newItem: SaleItem = {
          id: `ITEM-${Date.now()}-${Math.random()}`,
          productoId: product.id,
          varianteId: variant.id,
          nombreProducto: product.nombre,
          sku: variant.sku,
          talla: variant.talla,
          color: variant.color,
          cantidad: quantity,
          costoUnitario: variant.costo,
          precioUnitario: unitPrice,
          descuentoPorcentaje: 0,
          descuentoMonto: descMonto,
          subtotal: sub,
          impuestoMonto: impMonto,
          total,
        };
        return [...prev, newItem];
      }
    });
  };

  // Update Cart Quantity
  const handleUpdateQuantity = (varianteId: string, delta: number) => {
    setCartItems((prev) => {
      return (prev || [])
        .map((item) => {
          if (item.varianteId === varianteId) {
            const product = (products || []).find((p) => p.id === item.productoId);
            const variant = (product?.variantes || []).find((v) => v.id === varianteId);
            const maxStock = variant ? variant.stock : 999;
            const newQty = item.cantidad + delta;

            if (newQty <= 0) return null;
            if (newQty > maxStock) {
              showToast('Stock Máximo', `Solo hay ${maxStock} unidades disponibles`, 'advertencia');
              return item;
            }

            const sub = item.precioUnitario * newQty;
            const descMonto = item.descuentoPorcentaje > 0 
              ? sub * (item.descuentoPorcentaje / 100) 
              : Math.min(item.descuentoMonto || 0, sub);
            const impMonto = applyTax ? (sub - descMonto) * (settings.impuestoPorcentaje / 100) : 0;
            const total = sub - descMonto + impMonto;

            return {
              ...item,
              cantidad: newQty,
              subtotal: sub,
              descuentoMonto: descMonto,
              impuestoMonto: impMonto,
              total,
            };
          }
          return item;
        })
        .filter(Boolean) as SaleItem[];
    });
  };

  // Update Item Discount (Percent or Fixed Amount)
  const handleUpdateItemDiscount = (
    varianteId: string,
    type: 'PORCENTAJE' | 'MONTO',
    value: number
  ) => {
    setCartItems((prev) =>
      (prev || []).map((item) => {
        if (item.varianteId === varianteId) {
          const sub = item.subtotal;
          let descMonto = 0;
          let descPorc = 0;

          if (type === 'PORCENTAJE') {
            descPorc = Math.max(0, Math.min(100, value));
            descMonto = (sub * descPorc) / 100;
          } else {
            descMonto = Math.max(0, Math.min(sub, value));
            descPorc = sub > 0 ? (descMonto / sub) * 100 : 0;
          }

          const impMonto = applyTax ? (sub - descMonto) * (settings.impuestoPorcentaje / 100) : 0;
          const total = sub - descMonto + impMonto;

          return {
            ...item,
            descuentoPorcentaje: descPorc,
            descuentoMonto: descMonto,
            impuestoMonto: impMonto,
            total,
          };
        }
        return item;
      })
    );
  };

  // Remove Item
  const handleRemoveItem = (varianteId: string) => {
    setCartItems((prev) => (prev || []).filter((item) => item.varianteId !== varianteId));
  };

  // Clear Cart
  const handleClearCart = () => {
    if ((cartItems || []).length === 0) return;
    setCartItems([]);
    setOverallDiscountValue(0);
    storageService.clearPosWorkingState();
    showToast('Carrito Vacío', 'Se limpiaron todas las prendas del carrito', 'informacion');
  };

  // Totals Calculations with Support for % and Fixed RD$ Amount
  const rawSubtotal = (cartItems || []).reduce((acc, item) => acc + item.subtotal, 0);
  const lineDiscounts = (cartItems || []).reduce((acc, item) => acc + item.descuentoMonto, 0);
  const subtotalAfterLineDiscounts = Math.max(0, rawSubtotal - lineDiscounts);

  const numOverallDiscountVal =
    typeof overallDiscountValue === 'number'
      ? overallDiscountValue
      : parseFloat(overallDiscountValue) || 0;

  const overallDiscountMonto =
    discountType === 'PORCENTAJE'
      ? (subtotalAfterLineDiscounts * Math.max(0, Math.min(100, numOverallDiscountVal))) / 100
      : Math.max(0, Math.min(subtotalAfterLineDiscounts, numOverallDiscountVal));

  const totalDiscount = lineDiscounts + overallDiscountMonto;
  const taxableBase = Math.max(0, rawSubtotal - totalDiscount);
  const totalTax = applyTax ? taxableBase * (settings.impuestoPorcentaje / 100) : 0;
  const grandTotal = Math.max(0, taxableBase + totalTax);

  // Quick Customer Creation
  // FASE 3.6D (Parte 5): crea el cliente vía customersApi.save (backend
  // real) -- ya no se escribe un cliente sintético directo a
  // storageService. Antes, un cliente creado aquí solo existía en el
  // navegador y una venta a crédito con él fallaba en el backend real
  // (CREDIT_ERROR: El cliente no existe) porque nunca llegaba a
  // `Clientes`. Si el backend rechaza la creación, no se inventa ningún
  // cliente local ni se continúa como si existiera.
  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustNombre.trim()) {
      showToast('Datos Incompletos', 'Ingrese el nombre del cliente.', 'error');
      return;
    }

    setCreatingQuickCustomer(true);
    const res = await customersApi.save({
      nombre: newCustNombre.trim(),
      apellido: newCustApellido.trim(),
      documento: newCustDoc.trim() || undefined,
      telefono: newCustTel.trim() || 'N/A',
      limiteCredito: Number(newCustLimite) || 25000,
      diasCreditoPorDefecto: 30,
    });

    if (!res.success || !res.data) {
      setCreatingQuickCustomer(false);
      showToast('Error al Crear Cliente', res.message || 'No se pudo registrar el cliente en el backend.', 'error');
      return; // No se crea ningún cliente local ni se continúa como si existiera.
    }

    // CORREGIR AUDITORÍA: invalida el DataStore central de clientes (misma
    // colección que usa CustomersView) en vez de mantener un
    // storageService.saveCustomers() paralelo -- getCustomers() lee el
    // valor ya actualizado inmediatamente después del refresh, sin
    // esperar al siguiente render. Nunca se construye un registro
    // sintético: se busca por el ID real que el backend confirmó.
    await refreshCustomers({ force: true });
    setCreatingQuickCustomer(false);

    const created = getCustomers().find((c) => c.id === res.data!.customerId);
    if (created) {
      setSelectedCustomer(created);
    }

    setNewCustomerModalOpen(false);
    setNewCustNombre('');
    setNewCustApellido('');
    setNewCustDoc('');
    setNewCustTel('');
    showToast('Cliente Creado', `Se registró y seleccionó a ${newCustNombre.trim()} en Google Sheets.`, 'exito');
  };

  return (
    <div id="pos-module-container" className="flex flex-col lg:flex-row h-[calc(100vh-4.5rem)] bg-[#FAF8F4] overflow-hidden">
      {/* LEFT COLUMN: Product Catalog & Fast Search */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-[#E4DDD2] overflow-hidden">
        {/* Top Unified Search Bar & Barcode Scanner */}
        <div className="p-3.5 sm:p-4 bg-[#F6F1E8] border-b border-[#E4DDD2]">
          <form onSubmit={handleSearchOrScanSubmit} noValidate className="relative flex items-center">
            <div className="absolute left-3.5 flex items-center gap-2 text-[#756E65] pointer-events-none">
              <Search className="w-4 h-4 text-[#2F2A25]" />
              <span className="text-[#E4DDD2]">|</span>
              <Barcode className="w-4 h-4 text-[#C2410C]" />
            </div>

            <input
              type="text"
              placeholder="Buscar por nombre, color, SKU o escanear código de barras / Serial / IMEI (Enter para agregar)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-16 pr-24 sm:pr-28 py-2.5 rounded-2xl bg-white border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] placeholder-[#756E65]/75 focus:outline-none focus:border-[#2F2A25] focus:ring-1 focus:ring-[#2F2A25] shadow-2xs transition"
            />

            <div className="absolute right-2.5 flex items-center gap-1.5">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 rounded-full text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition cursor-pointer"
                  title="Limpiar buscador"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="submit"
                className="px-2.5 py-1 rounded-xl bg-[#2F2A25] text-[#FAF8F4] text-[10px] font-bold tracking-wider uppercase hover:bg-[#433D36] transition flex items-center gap-1 cursor-pointer shadow-2xs"
                title="Procesar código o agregar"
              >
                <span>Enter</span>
                <ArrowRight className="w-3 h-3 text-[#E8DCC8]" />
              </button>
            </div>
          </form>
        </div>

        {/* Category Pills Bar */}
        <div className="px-4 py-2.5 bg-[#FAF8F4] border-b border-[#E4DDD2] overflow-x-auto flex gap-2 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedCategory('TODOS')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              selectedCategory === 'TODOS'
                ? 'bg-[#2F2A25] text-[#FAF8F4] shadow-xs'
                : 'bg-white text-[#2F2A25] border border-[#E4DDD2] hover:bg-[#F6F1E8]'
            }`}
          >
            Todos los Productos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                selectedCategory === cat.id
                  ? 'bg-[#2F2A25] text-[#FAF8F4] shadow-xs'
                  : 'bg-white text-[#2F2A25] border border-[#E4DDD2] hover:bg-[#F6F1E8]'
              }`}
            >
              {cat.nombre}
            </button>
          ))}
        </div>

        {/* Product Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {(filteredProducts || []).map((prod) => {
              const totalStock = (prod.variantes || []).reduce((sum, v) => sum + v.stock, 0);
              const isAvailable = totalStock > 0;
              const isLow = totalStock > 0 && totalStock <= (prod.stockMinimo || 6);

              return (
                <div
                  key={prod.id}
                  onClick={() => setSelectedProductForVariant(prod)}
                  className="group cursor-pointer bg-white border border-[#E4DDD2] hover:border-[#2F2A25] rounded-2xl overflow-hidden flex flex-col justify-between p-3 transition-all hover:shadow-md"
                >
                  <div className="space-y-2">
                    {/* Image with status badge */}
                    <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-[#F6F1E8] border border-[#E4DDD2]/60">
                      {prod.imagenUrl ? (
                        <img
                          src={toDisplayableImageUrl(prod.imagenUrl)}
                          alt={prod.nombre}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#756E65]">
                          <ShoppingBag className="w-8 h-8 opacity-40" />
                        </div>
                      )}

                      {/* Stock Pill Badge */}
                      <span
                        className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-xs ${
                          !isAvailable
                            ? 'bg-rose-100 text-rose-800 border-rose-200'
                            : isLow
                            ? 'bg-amber-100 text-amber-900 border-amber-200'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                        }`}
                      >
                        {!isAvailable ? 'Agotado' : `${totalStock} en stock`}
                      </span>
                    </div>

                    {/* Info */}
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-[#756E65] font-semibold">
                        {prod.marca}
                      </span>
                      <h4 className="text-xs font-bold text-[#2F2A25] line-clamp-1 group-hover:text-[#C2410C] transition">
                        {prod.nombre}
                      </h4>
                      <p className="text-[10px] text-[#756E65] font-mono">{prod.sku}</p>
                    </div>
                  </div>

                  {/* Price & Action */}
                  <div className="pt-2 mt-2 border-t border-[#E4DDD2]/60 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[#2F2A25]">
                        {formatCurrency(prod.precio, settings.simboloMoneda)}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-[#756E65] group-hover:text-[#2F2A25] bg-[#F6F1E8] px-2 py-1 rounded-lg">
                      {(prod.variantes || []).length} tallas/colores
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* FASE 3.6C: catálogo real vacío es un estado válido -- se
              distingue de "sin resultados para este filtro/búsqueda" para
              no confundir al usuario ni sugerirle reintentar algo que
              nunca va a encontrar nada. */}
          {(filteredProducts || []).length === 0 && (products || []).length === 0 && (
            <div className="text-center py-16 space-y-3">
              <ShoppingBag className="w-12 h-12 text-[#756E65]/40 mx-auto" />
              <p className="text-sm font-semibold text-[#2F2A25]">Sin productos disponibles</p>
              <p className="text-xs text-[#756E65]">Crea productos desde Productos para comenzar una venta.</p>
            </div>
          )}

          {(filteredProducts || []).length === 0 && (products || []).length > 0 && (
            <div className="text-center py-16 space-y-3">
              <ShoppingBag className="w-12 h-12 text-[#756E65]/40 mx-auto" />
              <p className="text-sm font-semibold text-[#2F2A25]">No se encontraron prendas</p>
              <p className="text-xs text-[#756E65]">Intente con otro término o seleccione otra categoría.</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: POS Cart & Checkout Dashboard (Desktop) */}
      <div className="hidden lg:flex w-96 xl:w-105 bg-white flex-col justify-between h-full border-l border-[#E4DDD2]">
        {/* Cart Top Header: Customer Selector */}
        <div className="p-4 bg-[#F6F1E8] border-b border-[#E4DDD2] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#2F2A25] uppercase tracking-wider">Cliente:</span>
            <button
              type="button"
              onClick={() => setNewCustomerModalOpen(true)}
              className="text-[11px] text-[#C2410C] hover:underline font-bold flex items-center gap-1"
            >
              <UserPlus className="w-3 h-3" />
              <span>+ Nuevo Cliente</span>
            </button>
          </div>

          <select
            value={selectedCustomer?.id || ''}
            onChange={(e) => {
              if (e.target.value === '') {
                setSelectedCustomer(null);
                return;
              }
              const cust = (customers || []).find((c) => c.id === e.target.value);
              if (cust) setSelectedCustomer(cust);
            }}
            className="w-full px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          >
            <option value="">Consumidor Final (sin cliente)</option>
            {(customers || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} {c.apellido} ({c.documento})
              </option>
            ))}
          </select>

          {/* Customer Credit Brief Pill -- solo si hay un cliente real
              seleccionado (ya no se compara contra el id fijo 'CLI-005',
              residuo del seed de demostración). */}
          {selectedCustomer && (
            <div className="p-2 bg-[#FAF8F4] rounded-xl border border-[#E4DDD2] flex items-center justify-between text-[11px]">
              <span className="text-[#756E65]">Crédito Disponible:</span>
              <span className="font-bold text-[#2F2A25]">
                {formatCurrency(selectedCustomer.limiteCredito, settings.simboloMoneda)}
              </span>
            </div>
          )}
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#E4DDD2]">
            <span className="text-xs font-bold text-[#2F2A25]">
              Productos en Orden ({(cartItems || []).reduce((acc, i) => acc + i.cantidad, 0)})
            </span>
            {(cartItems || []).length > 0 && (
              <button
                type="button"
                onClick={handleClearCart}
                className="text-[11px] text-rose-600 hover:text-rose-800 font-medium flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                <span>Vaciar</span>
              </button>
            )}
          </div>

          {(cartItems || []).length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <ShoppingBag className="w-10 h-10 text-[#756E65]/30 mx-auto" />
              <p className="text-xs text-[#756E65] font-medium">El carrito está vacío</p>
              <p className="text-[11px] text-[#756E65]/70">Seleccione prendas del catálogo para cobrar</p>
            </div>
          ) : (
            (cartItems || []).map((item) => (
              <div
                key={item.varianteId}
                className="p-3 bg-[#FAF8F4] border border-[#E4DDD2] rounded-2xl space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h5 className="text-xs font-bold text-[#2F2A25] leading-tight">{item.nombreProducto}</h5>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#756E65] mt-0.5">
                      <span className="font-semibold px-1.5 py-0.2 rounded bg-[#E8DCC8]/60 text-[#2F2A25]">
                        Talla {item.talla}
                      </span>
                      <span>•</span>
                      <span>{item.color}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.varianteId)}
                    className="text-[#756E65] hover:text-rose-600 p-1 rounded-lg transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Item Line Discount Controls */}
                <div className="bg-white/70 p-1.5 rounded-xl border border-[#E4DDD2]/80 flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-[#756E65] font-semibold flex items-center gap-1">
                    <Percent className="w-3 h-3 text-[#C2410C]" />
                    <span>Desc. Producto:</span>
                  </span>

                  <div className="flex items-center gap-1.5">
                    {/* Amount vs % quick entry for this item */}
                    <div className="flex items-center gap-1 bg-[#FAF8F4] px-1.5 py-0.5 rounded-lg border border-[#E4DDD2]">
                      <span className="font-bold text-[#756E65]">RD$</span>
                      <input
                        type="number"
                        min="0"
                        max={item.subtotal}
                        step="1"
                        placeholder="0"
                        value={item.descuentoMonto === 0 ? '' : Math.round(item.descuentoMonto)}
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          handleUpdateItemDiscount(item.varianteId, 'MONTO', val);
                        }}
                        className="w-12 text-right bg-transparent font-bold text-[#2F2A25] focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-0.5">
                      {[0, 10, 20].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleUpdateItemDiscount(item.varianteId, 'PORCENTAJE', p)}
                          className={`px-1 py-0.5 rounded text-[9px] font-bold transition cursor-pointer ${
                            item.descuentoPorcentaje === p && item.descuentoMonto > 0
                              ? 'bg-[#C2410C] text-white'
                              : 'bg-white text-[#756E65] border border-[#E4DDD2] hover:bg-[#F6F1E8]'
                          }`}
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {/* Quantity Counter */}
                  <div className="flex items-center border border-[#E4DDD2] bg-white rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(item.varianteId, -1)}
                      className="p-1 hover:bg-[#F6F1E8] text-[#2F2A25] cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="px-2 text-xs font-bold text-[#2F2A25]">{item.cantidad}</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateQuantity(item.varianteId, 1)}
                      className="p-1 hover:bg-[#F6F1E8] text-[#2F2A25] cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Price */}
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      {item.descuentoMonto > 0 && (
                        <span className="text-[10px] text-[#756E65] line-through">
                          {formatCurrency(item.subtotal, settings.simboloMoneda)}
                        </span>
                      )}
                      <span className="text-xs font-bold text-[#2F2A25]">
                        {formatCurrency(item.total, settings.simboloMoneda)}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#756E65]">
                      @{formatCurrency(item.precioUnitario, settings.simboloMoneda)} c/u
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cart Bottom Summary & Checkout */}
        <div className="p-4 bg-[#F6F1E8] border-t border-[#E4DDD2] space-y-3">
          {/* Discount & Tax Toggles */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-[11px] font-bold text-[#756E65]">
                <Tag className="w-3.5 h-3.5 text-[#C2410C]" />
                <span>Descuento Global:</span>
              </div>

              {/* Discount Mode Switcher (% or RD$) */}
              <div className="inline-flex rounded-lg border border-[#E4DDD2] bg-white p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('PORCENTAJE');
                    setOverallDiscountValue(0);
                  }}
                  className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                    discountType === 'PORCENTAJE'
                      ? 'bg-[#2F2A25] text-white shadow-xs'
                      : 'text-[#756E65] hover:text-[#2F2A25]'
                  }`}
                >
                  % Porc.
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('MONTO');
                    setOverallDiscountValue(0);
                  }}
                  className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                    discountType === 'MONTO'
                      ? 'bg-[#C2410C] text-white shadow-xs'
                      : 'text-[#756E65] hover:text-[#2F2A25]'
                  }`}
                >
                  RD$ Monto
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {discountType === 'PORCENTAJE' ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <select
                    value={overallDiscountValue}
                    onChange={(e) => setOverallDiscountValue(Number(e.target.value))}
                    className="flex-1 px-2 py-1.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-bold text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
                  >
                    <option value={0}>Sin Descuento (0%)</option>
                    <option value={5}>5% de Descuento</option>
                    <option value={10}>10% de Descuento</option>
                    <option value={15}>15% de Descuento</option>
                    <option value={20}>20% de Descuento</option>
                    <option value={25}>25% de Descuento</option>
                    <option value={30}>30% de Descuento</option>
                    <option value={50}>50% de Descuento</option>
                  </select>
                </div>
              ) : (
                <div className="flex-1 relative flex items-center">
                  <span className="absolute left-2.5 text-xs font-bold text-[#756E65] pointer-events-none">
                    RD$
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={subtotalAfterLineDiscounts}
                    step="1"
                    placeholder="Ej. 100"
                    value={overallDiscountValue === 0 ? '' : overallDiscountValue}
                    onChange={(e) => {
                      const val = e.target.value === '' ? 0 : Number(e.target.value);
                      setOverallDiscountValue(Math.max(0, val));
                    }}
                    className="w-full pl-10 pr-16 py-1.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-bold text-[#2F2A25] focus:outline-none focus:border-[#C2410C]"
                  />
                  {numOverallDiscountVal > 0 && (
                    <button
                      type="button"
                      onClick={() => setOverallDiscountValue(0)}
                      className="absolute right-2 text-[10px] font-bold text-[#756E65] hover:text-rose-600 px-1.5 py-0.5 rounded bg-[#FAF8F4]"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              )}

              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-[#756E65] select-none shrink-0 bg-white px-2.5 py-1.5 rounded-xl border border-[#E4DDD2]">
                <input
                  type="checkbox"
                  checked={applyTax}
                  onChange={(e) => setApplyTax(e.target.checked)}
                  className="rounded text-[#2F2A25] focus:ring-[#2F2A25]"
                />
                <span>ITBIS ({settings.impuestoPorcentaje}%)</span>
              </label>
            </div>

            {/* Quick Amount Suggestion Badges if in MONTO mode */}
            {discountType === 'MONTO' && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-[#756E65] font-semibold">Rápido:</span>
                {[50, 100, 200, 300, 500].map((quickAmt) => (
                  <button
                    key={quickAmt}
                    type="button"
                    onClick={() => setOverallDiscountValue(quickAmt)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                      numOverallDiscountVal === quickAmt
                        ? 'bg-[#C2410C] text-white border-[#C2410C]'
                        : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                    }`}
                  >
                    -RD$ {quickAmt}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Subtotals breakdown */}
          <div className="space-y-1 text-xs text-[#756E65]">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>{formatCurrency(rawSubtotal, settings.simboloMoneda)}</span>
            </div>
            {totalDiscount > 0 && (
              <div className="flex justify-between text-emerald-800 font-medium">
                <span>Descuento Aplicado:</span>
                <span>-{formatCurrency(totalDiscount, settings.simboloMoneda)}</span>
              </div>
            )}
            {applyTax && (
              <div className="flex justify-between">
                <span>ITBIS ({settings.impuestoPorcentaje}%):</span>
                <span>{formatCurrency(totalTax, settings.simboloMoneda)}</span>
              </div>
            )}
          </div>

          {/* Large Total */}
          <div className="pt-2 border-t border-[#E4DDD2] flex items-baseline justify-between">
            <span className="text-sm font-bold text-[#2F2A25]">TOTAL A PAGAR:</span>
            <span className="text-2xl font-serif font-bold text-[#2F2A25]">
              {formatCurrency(grandTotal, settings.simboloMoneda)}
            </span>
          </div>

          {/* Checkout Button */}
          <button
            type="button"
            disabled={(cartItems || []).length === 0}
            onClick={() => setPaymentModalOpen(true)}
            className="w-full py-3 px-4 rounded-2xl font-bold text-sm text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] disabled:bg-zinc-300 disabled:cursor-not-allowed transition shadow-md flex items-center justify-center gap-2"
          >
            <span>COBRAR ORDEN</span>
            <ArrowRight className="w-4 h-4 text-[#E8DCC8]" />
          </button>
        </div>
      </div>

      {/* MOBILE FLOATING CART BAR */}
      <div className="lg:hidden p-3 bg-white border-t border-[#E4DDD2] flex items-center justify-between shadow-lg">
        <div>
          <span className="text-[10px] text-[#756E65] uppercase font-bold">Total:</span>
          <p className="text-lg font-bold text-[#2F2A25] leading-none">
            {formatCurrency(grandTotal, settings.simboloMoneda)}
          </p>
        </div>
        <button
          type="button"
          disabled={(cartItems || []).length === 0}
          onClick={() => setPaymentModalOpen(true)}
          className="py-2.5 px-6 rounded-xl font-bold text-xs text-[#FAF8F4] bg-[#2F2A25] disabled:bg-zinc-300 flex items-center gap-2"
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Cobrar ({(cartItems || []).reduce((acc, i) => acc + i.cantidad, 0)})</span>
        </button>
      </div>

      {/* Modals */}
      {selectedProductForVariant && (
        <VariantSelectorModal
          product={selectedProductForVariant}
          onClose={() => setSelectedProductForVariant(null)}
          onAddToCart={handleAddToCart}
        />
      )}

      {paymentModalOpen && (
        <PaymentModal
          items={cartItems}
          subtotal={rawSubtotal}
          descuentoTotal={totalDiscount}
          impuestoTotal={totalTax}
          total={grandTotal}
          applyTax={applyTax}
          selectedCustomer={selectedCustomer}
          onClose={() => setPaymentModalOpen(false)}
          onSuccess={(sale) => {
            setPaymentModalOpen(false);
            setCartItems([]);
            setOverallDiscountValue(0);
            // La venta ya fue confirmada por el backend real -- recién
            // aquí se limpia el estado de trabajo persistido (PARTE 8: el
            // carrito nunca se limpia antes del éxito).
            storageService.clearPosWorkingState();
            setCompletedSale(sale);
            // CORREGIR AUDITORÍA (§4 "Venta y stock"): la venta ya fue
            // confirmada por el backend -- recién AHORA se invalida el
            // DataStore para que el stock descontado se refleje de
            // inmediato en Catálogo/Inventario/Compras, sin logout/login
            // ni F5. No se actualiza el stock "a mano" restando cantidades
            // localmente: se vuelve a pedir el catálogo real completo, así
            // que lo mostrado siempre coincide exactamente con lo que el
            // backend confirmó.
            refreshProducts({ force: true });
            refreshSales({ force: true });
            if (sale.esCredito && sale.montoFinanciado && sale.montoFinanciado > 0) {
              // La nueva cuenta por cobrar afecta también el saldo/crédito
              // disponible del cliente (customers.list lo recalcula
              // server-side desde Creditos real) -- CustomersView y una
              // próxima venta a crédito del mismo cliente ven la cifra
              // correcta sin logout/login ni F5.
              refreshCredits({ force: true });
              refreshCustomers({ force: true });
            }
            // FASE 7: si la venta consumió un Crédito a Favor/Nota de
            // Crédito real, su saldo disponible ya cambió en el backend --
            // se invalida el dominio creditNotes del DataStore para que
            // CreditNotesView y una próxima venta al mismo cliente vean el
            // saldo restante correcto de inmediato.
            if (sale.creditoFavorAplicado) {
              refreshCreditNotes({ force: true });
            }
          }}
        />
      )}

      {completedSale && (
        <ReceiptModal sale={completedSale} onClose={() => setCompletedSale(null)} />
      )}

      {/* New Customer Modal */}
      {newCustomerModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Nuevo Cliente Rápido</h3>
              <button
                type="button"
                onClick={() => setNewCustomerModalOpen(false)}
                className="text-[#756E65] p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateQuickCustomer} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Nombre:</label>
                <input
                  type="text"
                  required
                  value={newCustNombre}
                  onChange={(e) => setNewCustNombre(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  placeholder="Ej. Ana"
                />
              </div>
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Apellido:</label>
                <input
                  type="text"
                  value={newCustApellido}
                  onChange={(e) => setNewCustApellido(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  placeholder="Ej. Marte"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Cédula / RNC:</label>
                  <input
                    type="text"
                    value={newCustDoc}
                    onChange={(e) => setNewCustDoc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                    placeholder="402-0000000-0"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Teléfono / Celular:</label>
                  <input
                    type="text"
                    value={newCustTel}
                    onChange={(e) => setNewCustTel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                    placeholder="809-555-0000"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Límite de Crédito (RD$):</label>
                <input
                  type="number"
                  value={newCustLimite}
                  onChange={(e) => setNewCustLimite(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewCustomerModalOpen(false)}
                  disabled={creatingQuickCustomer}
                  className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-[#756E65] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingQuickCustomer}
                  className="flex-1 py-2 rounded-xl bg-[#2F2A25] text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {creatingQuickCustomer ? 'Guardando...' : 'Guardar & Seleccionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
