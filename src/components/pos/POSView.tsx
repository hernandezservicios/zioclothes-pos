import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Product, ProductVariant, Customer, SaleItem, Sale, PosProductViewMode } from '../../types';
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
  LayoutGrid,
  List,
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

  // AUDITORÍA (FASE -- regresión de imágenes/logo): `productoId`s cuya
  // foto real falló al cargar (Drive, red, permiso -- cualquier causa
  // real, nunca decidido por este código) -- se les muestra el MISMO
  // ícono de fallback que ya existía para "sin foto", en vez del ícono
  // de imagen rota del navegador. Nunca oculta una falla GLOBAL: si
  // TODAS las fotos fallan, este Set simplemente termina con TODOS los
  // IDs -- eso es una señal a investigar (ver reporte), no algo que este
  // fallback deba disimular quitando el requisito de imagen real.
  const [imageLoadFailedIds, setImageLoadFailedIds] = useState<Set<string>>(new Set());
  const markImageFailed = (id: string) =>
    setImageLoadFailedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // Unified Search & Barcode Scanner State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODOS');

  // FASE UX POS (Requerimiento 1 -- autofocus del buscador): referencia
  // controlada (useRef + focus()) al input de búsqueda, nunca el
  // atributo `autoFocus` de React -- así el mismo `focusSearchInput()` se
  // puede reutilizar también para devolver el foco al catálogo cuando
  // corresponda (cerrar un modal), no solo al montar la pantalla.
  const searchInputRef = useRef<HTMLInputElement>(null);

  const focusSearchInput = () => {
    // requestAnimationFrame: espera a que el DOM del modal que se está
    // cerrando termine de desmontarse antes de mover el foco, para no
    // competir con el propio manejo de foco del navegador al remover un
    // elemento enfocado (evita "robar" el foco a mitad de una transición).
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
  };

  // Foco automático al montar la pantalla del POS -- cubre tanto la
  // primera entrada como un F5 (recarga completa), ya que un F5 vuelve a
  // montar POSView desde cero y este efecto corre una sola vez, después
  // del primer render (deps []). Abrir/cerrar un modal NO desmonta
  // POSView, así que este efecto nunca vuelve a dispararse por eso -- no
  // compite por el foco con un modal legítimamente abierto (Requerimiento
  // 1.8) y no genera loops de foco (Requerimiento 1.6).
  useEffect(() => {
    focusSearchInput();
  }, []);

  // FASE UX POS (Requerimiento 2/3/4 -- vista Cuadrícula/Lista): decide
  // ÚNICAMENTE cómo se dibuja `filteredProducts` más abajo. Ambos modos
  // leen el mismo arreglo y usan exactamente la misma función de agregar
  // al carrito (handleAddToCart vía VariantSelectorModal) -- nunca una
  // segunda fuente de datos, carrito o lógica de variantes. La
  // preferencia se hidrata sincrónicamente desde storageService
  // (arquitectura de preferencias de UI ya existente, ver
  // getCurrentView/saveCurrentView) para que el primer render ya respete
  // la última elección del usuario, sin parpadeo.
  const [viewMode, setViewMode] = useState<PosProductViewMode>(() => storageService.getPosProductView());

  const handleSetViewMode = (mode: PosProductViewMode) => {
    setViewMode(mode);
    storageService.savePosProductView(mode);
  };

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

  // Requerimiento 1.9: cerrar este modal (cancelar o tras crear el
  // cliente con éxito) regresa al catálogo POS -- el buscador recupera
  // el foco. Un único helper para los tres puntos de cierre (botón X,
  // botón Cancelar, y el cierre automático tras guardar con éxito).
  const closeNewCustomerModal = () => {
    setNewCustomerModalOpen(false);
    focusSearchInput();
  };

  // New Customer Form State
  // AUDITORÍA (FASE -- modales de cliente/producto/variantes): igual que
  // CustomersView.tsx -- `newCustLimite` arrancaba en `25000` como VALOR
  // real del input (`useState(25000)`), no como placeholder. El
  // formulario "Registrar Nuevo Cliente Rápido" del POS aparecía con
  // "Límite de Crédito" ya prellenado con RD$ 25,000.00 sin que la
  // cajera escribiera nada.
  const [newCustNombre, setNewCustNombre] = useState('');
  const [newCustApellido, setNewCustApellido] = useState('');
  const [newCustDoc, setNewCustDoc] = useState('');
  const [newCustTel, setNewCustTel] = useState('');
  const [newCustLimite, setNewCustLimite] = useState<number | string>('');
  const [creatingQuickCustomer, setCreatingQuickCustomer] = useState(false);

  // AUDITORÍA (FASE -- modales de cliente/producto/variantes, Objetivo 1 /
  // TEST 2): antes, cerrar este modal SIN guardar (botón "Cancelar" o la
  // X, ambos llaman a `closeNewCustomerModal`) no reiniciaba ningún campo
  // -- si la cajera escribía datos y cancelaba, la PRÓXIMA vez que abría
  // "Nuevo Cliente" (incluso para un cliente totalmente distinto) seguía
  // viendo lo que había tecleado antes. `handleCreateQuickCustomer` sí
  // limpiaba nombre/apellido/documento/teléfono tras un guardado EXITOSO,
  // pero no en el camino de cancelar, y tampoco limpiaba
  // `newCustLimite`. Mismo patrón "reset al ABRIR" ya usado en
  // ProductFormModal.tsx (nunca "reset al cerrar", para no interferir con
  // la animación de salida) -- se ejecuta cada vez que el modal pasa a
  // estar abierto, sin importar cómo se cerró la vez anterior.
  useEffect(() => {
    if (!newCustomerModalOpen) return;
    setNewCustNombre('');
    setNewCustApellido('');
    setNewCustDoc('');
    setNewCustTel('');
    setNewCustLimite('');
  }, [newCustomerModalOpen]);

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
      // FASE (corrección definitiva de variantes -- guardado individual,
      // Parte 11): una variante eliminada se marca INACTIVO en el backend
      // -- sin este filtro, escanear su código de barras/SKU antiguo la
      // seguía agregando directo al carrito como si nunca se hubiera
      // eliminado.
      const prodVariants = (prod.variantes || []).filter((v) => v.estado === 'ACTIVO');

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
      // Parte 11: idem arriba -- nunca ofrecer para la venta una variante
      // ya eliminada (INACTIVO) desde ProductFormModal.
      const prodVariants = (singleProd.variantes || []).filter((v) => v.estado === 'ACTIVO');
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

    closeNewCustomerModal();
    setNewCustNombre('');
    setNewCustApellido('');
    setNewCustDoc('');
    setNewCustTel('');
    showToast('Cliente Creado', `Se registró y seleccionó a ${newCustNombre.trim()} en Google Sheets.`, 'exito');
  };

  // AUDITORÍA (FASE -- responsive roto tras la corrección de scroll):
  // este contenedor usaba `h-[calc(100vh-4.5rem)]` -- una altura
  // adivinada de forma INDEPENDIENTE del layout real (viewport completo
  // menos un Navbar que se ASUME de 4.5rem), completamente desconectada
  // de la altura real que su padre (<main>, en src/App.tsx) le entrega.
  // Antes de la corrección de scroll esto no se notaba: el root no tenía
  // `overflow-hidden`, así que cualquier desajuste (Navbar con una altura
  // real distinta a 4.5rem, o -- en móvil -- `100vh` calculado sobre el
  // viewport GRANDE mientras la barra de direcciones seguía visible)
  // simplemente hacía que la PÁGINA completa scrolleara un poco de más,
  // sin que se notara. Ahora que <main> (y toda la cadena hasta la raíz)
  // tiene una altura real, acotada y con `overflow-hidden`, ese mismo
  // desajuste ya no se "absorbe" con scroll de página -- se recorta sin
  // forma de alcanzarlo, cortando exactamente lo que queda más abajo:
  // la barra flotante de carrito/cobro en móvil.
  //
  // `h-full` reemplaza esa altura adivinada por la altura REAL que ya
  // provee `<main>` (100% de un ancestro con altura definida gracias a
  // `h-dvh` en la raíz -- ver App.tsx), sin ningún número mágico. Ningún
  // otro aspecto de POS (grid, cards, carrito, lógica) se tocó -- es
  // exclusivamente este contenedor heredando su altura real en vez de
  // recalcularla de forma aislada e imprecisa.

  // AUDITORÍA (FASE -- responsive completo): `mobileCartOpen` (declarado
  // arriba) existía como estado pero nunca se usaba en ningún lado -- en
  // móvil el carrito (columna derecha completa: cliente, líneas con
  // cantidad/descuento por producto, descuento global, ITBIS, botón
  // "COBRAR ORDEN") era literalmente inalcanzable, porque esa columna
  // tiene `hidden lg:flex` y lo único visible en `lg:hidden` era la barra
  // flotante de Total + Cobrar -- sin forma de ver ni editar qué había
  // dentro. `renderCartPanel()` extrae ese contenido (idéntico, mismo
  // JSX, mismos handlers -- ninguna lógica nueva ni duplicada) para
  // reutilizarlo tal cual en dos lugares: la columna derecha de
  // escritorio (como ya estaba) y un nuevo drawer inferior móvil que se
  // abre al tocar el área de "Total" de la barra flotante, cierra con la
  // X o el fondo, y dentro del cual el mismo botón "COBRAR ORDEN" de
  // siempre sigue abriendo el mismo PaymentModal de siempre.
  const renderCartPanel = () => (
    <>
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
          aria-label="Cliente"
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
                  aria-label={`Eliminar ${item.nombreProducto} del carrito`}
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
                    aria-label={`Disminuir cantidad de ${item.nombreProducto}`}
                    className="p-1 hover:bg-[#F6F1E8] text-[#2F2A25] cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="px-2 text-xs font-bold text-[#2F2A25]">{item.cantidad}</span>
                  <button
                    type="button"
                    onClick={() => handleUpdateQuantity(item.varianteId, 1)}
                    aria-label={`Aumentar cantidad de ${item.nombreProducto}`}
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

            {/* Discount Mode Switcher (% o RD$) */}
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
          onClick={() => {
            // AUDITORÍA (responsive): cierra el drawer móvil (si estaba
            // abierto) al pasar a PaymentModal -- que ya usa su propio
            // z-50 por encima -- para no dejar dos overlays apilados
            // innecesariamente detrás de un pago ya completado/cancelado.
            setMobileCartOpen(false);
            setPaymentModalOpen(true);
          }}
          className="w-full py-3 px-4 rounded-2xl font-bold text-sm text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] disabled:bg-zinc-300 disabled:cursor-not-allowed transition shadow-md flex items-center justify-center gap-2"
        >
          <span>COBRAR ORDEN</span>
          <ArrowRight className="w-4 h-4 text-[#E8DCC8]" />
        </button>
      </div>
    </>
  );

  return (
    <div id="pos-module-container" className="flex flex-col lg:flex-row h-full bg-[#FAF8F4] overflow-hidden">
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

            {/* AUDITORÍA (FASE -- responsive real, confirmada visualmente en
                Chrome real a 375px): `<input>` es un ítem flex de este
                `<form className="flex">` -- los controles de formulario
                (input/select/textarea) tienen, además del "mínimo de
                contenido" normal, un tamaño mínimo automático propio del
                navegador (basado en su ancho intrínseco por defecto, ~20
                caracteres) que NO desaparece solo con `w-full`. Sin
                `min-w-0`, ese mínimo empujaba TODO el formulario (y con
                él, esta columna) más ancho que el viewport en móvil --
                exactamente el overflow horizontal global que se veía en
                la captura real. */}
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar por nombre, color, SKU o escanear código de barras / Serial / IMEI (Enter para agregar)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-w-0 pl-16 pr-24 sm:pr-28 py-2.5 rounded-2xl bg-white border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] placeholder-[#756E65]/75 focus:outline-none focus:border-[#2F2A25] focus:ring-1 focus:ring-[#2F2A25] shadow-2xs transition"
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

        {/* Category Pills Bar + View Mode Toggle */}
        <div className="px-4 py-2.5 bg-[#FAF8F4] border-b border-[#E4DDD2] flex items-center gap-2">
          <div className="flex-1 min-w-0 overflow-x-auto flex gap-2 no-scrollbar">
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

          {/* FASE UX POS (Requerimiento 2/3/7): selector Cuadrícula/Lista.
              Solo cambia la presentación de `filteredProducts` más abajo --
              mismos datos, mismo `handleAddToCart` en ambos modos. */}
          <div className="shrink-0 flex bg-white border border-[#E4DDD2] p-1 rounded-xl">
            <button
              type="button"
              onClick={() => handleSetViewMode('grid')}
              aria-label="Ver catálogo en cuadrícula"
              aria-pressed={viewMode === 'grid'}
              title="Vista Cuadrícula"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'grid' ? 'bg-[#2F2A25] text-[#FAF8F4]' : 'text-[#756E65] hover:text-[#2F2A25]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('list')}
              aria-label="Ver catálogo en lista"
              aria-pressed={viewMode === 'list'}
              title="Vista Lista"
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'list' ? 'bg-[#2F2A25] text-[#FAF8F4]' : 'text-[#756E65] hover:text-[#2F2A25]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Product Cards Grid / List (Requerimiento 2: misma fuente de
            datos `filteredProducts` y mismo `handleAddToCart` en ambos
            modos, solo cambia la presentación) */}
        <div className="flex-1 overflow-y-auto p-4">
          {viewMode === 'grid' ? (
            // AUDITORÍA (FASE -- responsive completo, causa raíz #1 del
            // POS de escritorio): `sm:`/`xl:` son media queries sobre el
            // VIEWPORT COMPLETO, no sobre el ancho real de ESTA columna.
            // En escritorio (`lg:`+, ver #pos-module-container arriba)
            // esta columna comparte fila con el Sidebar (w-72=288px) y el
            // carrito (w-96/xl:w-105=384/420px) -- ambos de ancho FIJO,
            // sin colapsar por debajo de `lg:` -- así que su ancho real
            // disponible es "viewport - ~672/708px", nunca el viewport
            // completo. La regla anterior (`sm:grid-cols-3
            // xl:grid-cols-4`) exigía 3-4 columnas en cuanto el VIEWPORT
            // llegaba a 640/1280px sin importar que, en escritorio, ya
            // había ~700px consumidos por Sidebar+carrito -- por eso al
            // reducir la ventana con DevTools (ej. 1366x768 con el panel
            // abierto) las cards se apretaban sin reducir columnas: el
            // viewport seguía "pareciendo" ancho aunque esta columna ya
            // no lo fuera.
            //
            // Con la cascada mobile-first de Tailwind (`sm` < `lg` < `xl`
            // < `2xl` en ese orden en el CSS generado, cada una pisa a la
            // anterior), `lg:grid-cols-2` vuelve a bajar a 2 columnas
            // justo cuando Sidebar+carrito aparecen (1024px), y
            // `xl:`/`2xl:` vuelven a subir a 3/4 solo cuando el viewport
            // ya es lo bastante ancho para compensar esos ~700px fijos:
            //   <1024 (mobile/tablet, carrito oculto -- esta columna SÍ
            //     usa el viewport completo): 2 -> sm(640): 3.
            //   >=1024 (desktop, Sidebar+carrito visibles): 2 de nuevo
            //     -> xl(1280, columna real ~572px): 3
            //     -> 2xl(1536, columna real ~828px): 4.
            // Nunca se tocó el contenido/diseño de cada card -- solo
            // cuántas caben por fila según el espacio real disponible.
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
              {(filteredProducts || []).map((prod) => {
                // Parte 11 (corrección definitiva de variantes): una
                // variante eliminada (INACTIVO) ya no debe contarse como
                // stock disponible ni como una combinación vendible en el
                // catálogo del POS.
                const activeVariants = (prod.variantes || []).filter((v) => v.estado === 'ACTIVO');
                const totalStock = activeVariants.reduce((sum, v) => sum + v.stock, 0);
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
                        {prod.imagenUrl && !imageLoadFailedIds.has(prod.id) ? (
                          <img
                            src={toDisplayableImageUrl(prod.imagenUrl)}
                            alt={prod.nombre}
                            onError={() => markImageFailed(prod.id)}
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
                        {activeVariants.length} tallas/colores
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {(filteredProducts || []).map((prod) => {
                // Parte 11: idem vista de cuadrícula -- excluye variantes
                // eliminadas (INACTIVO) del stock mostrado.
                const totalStock = (prod.variantes || [])
                  .filter((v) => v.estado === 'ACTIVO')
                  .reduce((sum, v) => sum + v.stock, 0);
                const isAvailable = totalStock > 0;
                const isLow = totalStock > 0 && totalStock <= (prod.stockMinimo || 6);
                const category = categories.find((c) => c.id === prod.categoriaId);

                return (
                  <div
                    key={prod.id}
                    onClick={() => setSelectedProductForVariant(prod)}
                    className="group cursor-pointer bg-white border border-[#E4DDD2] hover:border-[#2F2A25] rounded-xl overflow-hidden flex items-center gap-3 p-2.5 transition-all hover:shadow-xs"
                  >
                    {/* Imagen pequeña */}
                    <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-[#F6F1E8] border border-[#E4DDD2]/60">
                      {prod.imagenUrl && !imageLoadFailedIds.has(prod.id) ? (
                        <img
                          src={toDisplayableImageUrl(prod.imagenUrl)}
                          alt={prod.nombre}
                          onError={() => markImageFailed(prod.id)}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#756E65]">
                          <ShoppingBag className="w-4 h-4 opacity-40" />
                        </div>
                      )}
                    </div>

                    {/* Nombre + Código + Categoría (si existe) */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-[#2F2A25] truncate group-hover:text-[#C2410C] transition">
                        {prod.nombre}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[10px] text-[#756E65]">
                        <span className="font-mono truncate">{prod.sku}</span>
                        {/* Categoría es lo primero que se oculta en pantallas
                            angostas (Requerimiento 6: prioridad es imagen,
                            nombre, precio, stock, acción). */}
                        {category && (
                          <span className="hidden sm:inline uppercase tracking-wider font-semibold truncate">
                            • {category.nombre}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Precio */}
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold text-[#2F2A25] whitespace-nowrap">
                        {formatCurrency(prod.precio, settings.simboloMoneda)}
                      </span>
                    </div>

                    {/* Stock */}
                    <span
                      className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-2xs whitespace-nowrap ${
                        !isAvailable
                          ? 'bg-rose-100 text-rose-800 border-rose-200'
                          : isLow
                          ? 'bg-amber-100 text-amber-900 border-amber-200'
                          : 'bg-emerald-100 text-emerald-900 border-emerald-200'
                      }`}
                    >
                      {!isAvailable ? 'Agotado' : totalStock}
                    </span>

                    {/* Acción: misma función que la vista Cuadrícula --
                        abre el mismo VariantSelectorModal, que llama al
                        mismo handleAddToCart. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProductForVariant(prod);
                      }}
                      aria-label={`Agregar ${prod.nombre} al carrito`}
                      title="Agregar al carrito"
                      className="shrink-0 p-1.5 rounded-lg bg-[#F6F1E8] text-[#2F2A25] group-hover:bg-[#2F2A25] group-hover:text-[#FAF8F4] transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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

      {/* RIGHT COLUMN: POS Cart & Checkout Dashboard (Desktop).
          AUDITORÍA (FASE -- causa raíz real, ver también App.tsx): esta
          columna no tenía `shrink-0` -- sin él, su ancho fijo (w-96/
          xl:w-105) era solo un `flex-basis` de partida; al no haber
          suficiente espacio en la fila (`#pos-module-container`), el
          `flex-shrink` por defecto del navegador (1) la comprimía por
          debajo de esos 384/420px, apretando sus propios botones/textos
          en vez de dejar que fuera la columna de PRODUCTOS (que sí tiene
          `min-w-0`, ver arriba) la que absorbiera todo el encogimiento.
          `shrink-0` la fija exactamente a su ancho -- el mismo patrón ya
          usado en el Sidebar real de la app. */}
      <div className="hidden lg:flex w-96 xl:w-105 shrink-0 bg-white flex-col justify-between h-full border-l border-[#E4DDD2]">
        {renderCartPanel()}
      </div>

      {/* MOBILE FLOATING CART BAR */}
      <div className="lg:hidden p-3 bg-white border-t border-[#E4DDD2] flex items-center justify-between shadow-lg">
        {/* AUDITORÍA (FASE -- corregir carrito móvil): esta barra y sus
            dos botones YA EXISTÍAN y ya funcionaban -- lo único que
            cambió aquí es a dónde apunta "Cobrar". Antes llamaba
            directo a `setPaymentModalOpen(true)`, saltándose el drawer
            del carrito por completo -- un usuario que tocaba "Cobrar"
            nunca veía la lista de productos/cantidades/eliminar, solo el
            botón "Total" (menos obvio) abría ese panel. Ahora "Cobrar"
            abre el MISMO drawer que "Total" (mismo `renderCartPanel()`,
            mismo estado `mobileCartOpen`, ninguna lógica nueva ni
            duplicada) -- el cobro real sigue ocurriendo exactamente
            igual que siempre, solo que ahora pasa por el botón "COBRAR
            ORDEN" DENTRO del panel (línea ~943, ya existente, ya cierra
            el drawer y abre PaymentModal) en vez de saltárselo. */}
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          aria-label="Ver carrito de compra"
          className="text-left"
        >
          <span className="text-[10px] text-[#756E65] uppercase font-bold">Total:</span>
          <p className="text-lg font-bold text-[#2F2A25] leading-none">
            {formatCurrency(grandTotal, settings.simboloMoneda)}
          </p>
        </button>
        <button
          type="button"
          disabled={(cartItems || []).length === 0}
          onClick={() => setMobileCartOpen(true)}
          aria-label="Ver carrito de compra y continuar al cobro"
          className="py-2.5 px-6 rounded-xl font-bold text-xs text-[#FAF8F4] bg-[#2F2A25] disabled:bg-zinc-300 flex items-center gap-2"
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Cobrar ({(cartItems || []).reduce((acc, i) => acc + i.cantidad, 0)})</span>
        </button>
      </div>

      {/* MOBILE CART DRAWER -- reutiliza exactamente renderCartPanel(),
          nunca una segunda implementación del carrito. Bottom-sheet
          acotado a `max-h-[85vh]` con su propio `flex flex-col`, así que
          el `flex-1 overflow-y-auto` de la lista de productos (dentro de
          renderCartPanel) scrollea de forma independiente entre el
          header (cliente) y el footer (totales/COBRAR), igual que en la
          columna de escritorio -- mismo patrón ya usado en los modales
          de Detalle de Venta/Confirmación de esta misma app. */}
      {mobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end justify-center">
          <div
            onClick={() => setMobileCartOpen(false)}
            data-testid="mobile-cart-backdrop"
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
          />
          <div className="relative w-full max-h-[85vh] bg-white rounded-t-3xl shadow-2xl flex flex-col">
            <div className="p-4 border-b border-[#E4DDD2] flex items-center justify-between shrink-0">
              <span className="text-sm font-bold text-[#2F2A25]">Carrito de Compra</span>
              <button
                type="button"
                onClick={() => setMobileCartOpen(false)}
                aria-label="Cerrar carrito"
                className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderCartPanel()}
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedProductForVariant && (
        <VariantSelectorModal
          product={selectedProductForVariant}
          onClose={() => {
            // Requerimiento 1.9: cerrar este modal (cancelar o tras
            // agregar al carrito) regresa al catálogo POS -- el buscador
            // recupera el foco.
            setSelectedProductForVariant(null);
            focusSearchInput();
          }}
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
          onClose={() => {
            setPaymentModalOpen(false);
            focusSearchInput();
          }}
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
        <ReceiptModal
          sale={completedSale}
          onClose={() => {
            // Requerimiento 1.9: cierre del recibo -- último paso del
            // flujo de venta antes de volver al catálogo POS.
            setCompletedSale(null);
            focusSearchInput();
          }}
        />
      )}

      {/* New Customer Modal.
          AUDITORÍA (FASE -- responsive completo): 5 campos + header +
          botones, sin ningún tope de altura ni scroll -- en una pantalla
          baja (móvil en horizontal, o con el teclado táctil abierto,
          escenario real y frecuente al llenar un formulario) el botón
          final "Guardar & Seleccionar" podía quedar fuera de la zona
          visible sin forma de alcanzarlo. Mismo patrón ya usado en
          PaymentModal/ReceiptModal/ProductFormModal de este mismo módulo:
          el propio overlay (`overflow-y-auto`) se vuelve desplazable en
          vez de reestructurar la tarjeta -- ningún campo, validación ni
          lógica de creación de cliente se tocó. */}
      {newCustomerModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl my-8">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Nuevo Cliente Rápido</h3>
              <button
                type="button"
                onClick={closeNewCustomerModal}
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
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={newCustLimite === '' ? '' : newCustLimite}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setNewCustLimite('');
                    else {
                      const num = parseFloat(val);
                      setNewCustLimite(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeNewCustomerModal}
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
