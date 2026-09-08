import React, { useState, useRef, useEffect } from 'react';
import { Product, ProductVariant, Category, Size, Color } from '../../types';
import { useToast } from '../../context/ToastContext';
import { productsApi } from '../../services/productsApi';
import { formatCurrency } from '../../utils/formatters';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import {
  X,
  Camera,
  Image as ImageIcon,
  Upload,
  Trash2,
  Edit2,
  Plus,
  Check,
  Sparkles,
  AlertCircle,
  ShoppingBag,
  Layers,
  Settings2,
  Sliders,
  Barcode,
} from 'lucide-react';

/**
 * FASE 9 (causa raíz de "s.trim is not a function" al generar la matriz de
 * variantes): el origen real ya se corrigió en productsApi.ts
 * (mapSize/mapColor) y en DataStoreContext.hydrateFromBootstrap -- Tallas/
 * Colores del backend real siempre deberían llegar aquí como string ya
 * limpio. Esta función es la última capa de defensa de toda la cadena
 * (nunca se asume que `selectedSizes`/`selectedColors` ya son 100%
 * seguros solo porque el tipo declarado es `string[]`): strings se
 * recortan, números se convierten a texto, y `null`/`undefined`/una
 * estructura inesperada (ej. un objeto) se descartan como cadena vacía --
 * NUNCA se convierten silenciosamente a "[object Object]".
 */
function normalizeVariantOptionName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).trim();
  return '';
}

/**
 * FASE (corrección definitiva de variantes -- guardado individual, Parte
 * 5): clave normalizada y estable de una combinación talla/color,
 * reutilizada en TODO el flujo de variantes de este componente (matriz,
 * alta individual, validación previa al guardado) en vez de comparar
 * `v.talla === x && v.color === y` sueltos en cada sitio -- esa
 * comparación directa (usada antes solo en handleGenerateMatrix) es
 * sensible a mayúsculas/espacios y fue la causa real de que una variante
 * ya existente ("Negro") no se reconociera como la misma combinación que
 * una recién tecleada ("negro"), generando un duplicado. Reutiliza
 * `normalizeVariantOptionName` (FASE 9) para el trim/number->string, y
 * añade sobre eso la normalización de mayúsculas -- nunca duplica esa
 * lógica de forma distinta.
 */
function getVariantKey(talla: unknown, color: unknown): string {
  const t = normalizeVariantOptionName(talla).toUpperCase();
  const c = normalizeVariantOptionName(color).toUpperCase();
  return `${t}|${c}`;
}

/** Real backend variant ids always look like VAR-000123 (Sequences.gs).
 * Los ids temporales que este componente genera al agregar una variante
 * (individual o por matriz) mientras el usuario no ha guardado todavía
 * usan VAR-<timestamp>-<random> -- nunca calzan este patrón. Mismo
 * criterio ya usado por ProductsView.tsx al armar el payload de
 * products.save; se reutiliza aquí (no se inventa un segundo criterio)
 * para decidir si una variante ya existe en Sheets o es nueva en esta
 * sesión del formulario. */
function isRealVariantId(id: string | undefined | null): boolean {
  return !!id && /^VAR-\d+$/.test(String(id));
}

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingProduct: Product | null;
  categories: Category[];
  // FASE 3.6B: tallas/colores REALES traídos del backend
  // (products.listAuxiliaries -> Tallas/Colores en Sheets), ya no hay
  // ningún catálogo hardcodeado de respaldo. Si el backend no tiene
  // ninguna talla/color sembrada, estas listas llegan vacías -- el
  // usuario puede seguir escribiendo una talla/color nueva a mano para
  // ESTA prenda (ver nota en el catálogo de gestión más abajo), pero ya
  // no se rellena silenciosamente con una lista inventada.
  initialSizes: Size[];
  initialColors: Color[];
  currencySymbol?: string;
  saving?: boolean;
  onSave: (productData: {
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
    variantes: ProductVariant[];
    // FASE (corrección definitiva de variantes -- guardado individual,
    // Parte 6): ids reales (VAR-000123) de variantes que el usuario
    // eliminó explícitamente en esta sesión del formulario (botón de
    // basurero sobre una variante YA guardada). Nunca incluye ids
    // temporales de variantes nuevas todavía no guardadas -- esas
    // simplemente se quitan de `variantes` sin necesidad de avisar al
    // backend, porque nunca llegaron a existir en Sheets.
    deletedVariantIds?: string[];
  }) => void;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  isOpen,
  onClose,
  editingProduct,
  categories,
  initialSizes,
  initialColors,
  currencySymbol = 'RD$',
  saving = false,
  onSave,
}) => {
  const { showToast } = useToast();

  // Basic Form States
  // AUDITORÍA (FASE -- modales de cliente/producto/variantes, causa raíz
  // del Objetivo 2): `marca`, `costo`, `precio` y `stockMinimo`
  // arrancaban con un VALOR real ('ZIO', 1200, 2500, 5 -- literalmente
  // los mismos ejemplos citados en la auditoría) en vez de vacío. Los
  // inputs de costo/precio/stockMinimo YA estaban preparados para
  // mostrar un placeholder de ejemplo cuando el valor es '' (ver
  // `value={costo === '' ? '' : costo}` más abajo en el JSX, con
  // placeholder="0.00"/"5") -- el bug era exclusivamente el valor
  // inicial/de reseteo, nunca el propio input. `codigoBarras`/
  // `categoriaId` ya arrancaban correctamente vacíos aquí -- el bug de
  // esos dos vivía solo en la rama "producto nuevo" del useEffect de
  // abajo (auto-generaba un código y auto-seleccionaba la primera
  // categoría al abrir).
  const [nombre, setNombre] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [marca, setMarca] = useState('');
  const [costo, setCosto] = useState<number | string>(''); // Costo FIRST
  const [precio, setPrecio] = useState<number | string>(''); // Precio SECOND
  const [stockMinimo, setStockMinimo] = useState<number | string>('');
  const [imagenUrl, setImagenUrl] = useState('');
  const [variantes, setVariantes] = useState<ProductVariant[]>([]);
  // FASE (corrección definitiva de variantes -- guardado individual,
  // Parte 6/11): ids reales de variantes YA guardadas que el usuario
  // eliminó en esta sesión del formulario -- se envían al backend junto
  // con `variantes` para que products.save las marque INACTIVO (nunca
  // borrado físico, ver ProductsController.gs). Se reinicia cada vez que
  // el modal se abre (ver useEffect de abajo).
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  // Estado del formulario inline "+ Agregar variante" (Parte 3/12): alta
  // de UNA sola combinación sin generar ninguna otra -- independiente de
  // "Generar Combinaciones".
  const [isAddingSingleVariant, setIsAddingSingleVariant] = useState(false);
  const [newVariantTalla, setNewVariantTalla] = useState('');
  const [newVariantColor, setNewVariantColor] = useState('');
  const [newVariantCodigo, setNewVariantCodigo] = useState('');
  const [newVariantStock, setNewVariantStock] = useState<number | string>(0);

  // FASE (normalización comercial -- variantes opcionales): por defecto
  // OFF para productos nuevos (Parte 6 de la fase). `stockSimple` solo
  // aplica cuando `tieneVariantes` es false -- es el stock del producto
  // simple, enviado como la única variante implícita al guardar (ver
  // handleSubmit). Arranca vacío (no en 0), siguiendo el mismo patrón ya
  // establecido para los demás campos numéricos de este formulario.
  const [tieneVariantes, setTieneVariantes] = useState(false);
  const [stockSimple, setStockSimple] = useState<number | string>('');

  // Variant Individual Barcodes Checkbox State
  const [enableVariantBarcodes, setEnableVariantBarcodes] = useState(false);

  // Image Upload States
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  // FIX (fotos de productos -- auditoría aprobada): `imagenUrl` sigue
  // siendo el estado de PREVISUALIZACIÓN (Base64 mientras se está
  // editando, o la URL real ya guardada al abrir para editar) -- eso no
  // cambia. `selectedImageFile` es la pieza nueva: solo se pone en
  // no-null cuando el usuario elige/cambia un archivo EN ESTA sesión del
  // formulario. Al guardar, es lo único que decide si hace falta subir
  // una imagen nueva a Drive antes de products.save, o si se reutiliza
  // la URL que ya existía sin volver a subir nada.
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // FASE 3.6B: tallas/colores disponibles = los reales del backend
  // (initialSizes/initialColors, prop). El add/edit/delete de este panel
  // sigue existiendo como conveniencia para armar LA MATRIZ DE ESTA
  // PRENDA (los nombres viajan dentro de cada variante al guardar el
  // producto), pero ya NO se persiste a storageService como si fuera un
  // catálogo compartido real -- no existe ningún endpoint de backend para
  // eso (ProductsController.gs no tiene sizes.save/colors.save), así que
  // persistir localmente sería aparentar una fuente de verdad que no es.
  const [availableSizes, setAvailableSizes] = useState<Size[]>(initialSizes);
  const [availableColors, setAvailableColors] = useState<Color[]>(initialColors);

  // Selected for matrix generator
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);

  // Catalog Management View Mode (Toggles settings panel to edit/delete colors & sizes without jittering)
  const [showCatalogManager, setShowCatalogManager] = useState(false);

  // Custom Size Inline Creation / Edit
  const [isAddingSize, setIsAddingSize] = useState(false);
  const [newSizeName, setNewSizeName] = useState('');
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [editingSizeName, setEditingSizeName] = useState('');

  // Custom Color Inline Creation / Edit
  const [isAddingColor, setIsAddingColor] = useState(false);
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#C2410C');
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [editingColorName, setEditingColorName] = useState('');
  const [editingColorHex, setEditingColorHex] = useState('');

  // Quick bulk stock state
  const [bulkStockVal, setBulkStockVal] = useState<number | string>(6);

  // Initialize or reset form on open
  useEffect(() => {
    if (!isOpen) return;

    // Refresca desde las props (backend real) cada vez que se abre --
    // ya no hay fallback local ni persistencia a storageService.
    setAvailableSizes(initialSizes);
    setAvailableColors(initialColors);

    setImageError(null);
    setIsAddingSize(false);
    setIsAddingColor(false);
    setEditingSizeId(null);
    setEditingColorId(null);
    setShowCatalogManager(false);
    // FIX (fotos de productos): abrir el formulario (crear o editar)
    // nunca significa "el usuario acaba de elegir un archivo nuevo" --
    // se resetea explícitamente para que un guardado sin tocar la foto
    // nunca dispare una subida a Drive innecesaria.
    setSelectedImageFile(null);

    // FASE (corrección definitiva de variantes -- guardado individual):
    // ninguna eliminación ni formulario de alta individual pendiente
    // sobrevive a cerrar/reabrir el modal -- se reinicia siempre, tanto
    // para "editar" como para "nuevo producto".
    setDeletedVariantIds([]);
    setIsAddingSingleVariant(false);
    setNewVariantTalla('');
    setNewVariantColor('');
    setNewVariantCodigo('');
    setNewVariantStock(0);

    if (editingProduct) {
      // AUDITORÍA (FASE -- modales de cliente/producto/variantes,
      // Objetivo 5 -- "Editar Producto debe cargar ÚNICAMENTE los datos
      // persistidos de ESE producto"): `marca || 'ZIO'` y
      // `stockMinimo || 5` usaban `||`, que trata CUALQUIER valor falsy
      // -- incluido un `stockMinimo` real guardado como `0`, o una
      // `marca` real guardada como cadena vacía -- como "no hay dato" y
      // lo reemplazaba por el mismo valor de ejemplo hardcodeado del
      // Objetivo 2. Un producto editado que de verdad tenía
      // `stockMinimo: 0` (alerta desactivada a propósito) aparecía en
      // este formulario mostrando "5", y si se guardaba sin tocar ese
      // campo, el `0` real se perdía silenciosamente. `stockMinimo`
      // usa `??` (nullish coalescing) en vez de `||` -- solo cae al
      // valor de respaldo si el dato es real `null`/`undefined`, nunca
      // si es un `0` legítimo. `marca` cae a `''` (vacío, con su propio
      // placeholder) en vez de a un nombre de marca inventado.
      setNombre(editingProduct.nombre || '');
      setCodigoBarras(editingProduct.codigoBarras || '');
      setDescripcion(editingProduct.descripcion || '');
      setCategoriaId(editingProduct.categoriaId || categories[0]?.id || '');
      setMarca(editingProduct.marca || '');
      setCosto(editingProduct.costo || 0);
      setPrecio(editingProduct.precio || 0);
      setStockMinimo(editingProduct.stockMinimo ?? 5);
      setImagenUrl(editingProduct.imagenUrl || '');

      const prodVariants = editingProduct.variantes || [];
      setVariantes([...prodVariants]);

      // FASE (normalización comercial -- compatibilidad con productos
      // existentes, Parte 12): si el producto ya trae `tieneVariantes`
      // explícito (columna nueva, guardado por esta misma fase), se usa
      // tal cual. Si NO (producto guardado antes de esta fase, columna
      // ausente/backend antiguo), se infiere: un producto se considera
      // "simple" si tiene como máximo 1 variante Y esa variante usa
      // exactamente los valores centinela que ProductsController.gs ya
      // asignaba por defecto cuando no se especificaba talla/color
      // (color || 'Único', talla || 'U') -- nunca se sobreescribe el dato
      // real, es solo la inferencia del estado inicial del checkbox.
      const looksLikeSimpleProduct =
        prodVariants.length === 0 ||
        (prodVariants.length === 1 && prodVariants[0].talla === 'U' && prodVariants[0].color === 'Único');
      const inferredTieneVariantes =
        editingProduct.tieneVariantes !== undefined ? editingProduct.tieneVariantes : !looksLikeSimpleProduct;
      setTieneVariantes(inferredTieneVariantes);
      setStockSimple(prodVariants.length === 1 ? prodVariants[0].stock : '');

      // Check if any variant has a distinctive barcode set
      const hasDistinctVariantCodes = prodVariants.some(
        (v) => v.codigoBarras && v.codigoBarras.trim() !== '' && v.codigoBarras !== editingProduct.codigoBarras
      );
      setEnableVariantBarcodes(hasDistinctVariantCodes);

      // Extract existing sizes and colors directly from saved product variants
      const existingSizes = Array.from(new Set(prodVariants.map((v) => v.talla).filter(Boolean)));
      const existingColors = Array.from(new Set(prodVariants.map((v) => v.color).filter(Boolean)));
      setSelectedSizes(existingSizes);
      setSelectedColors(existingColors);
    } else {
      // New product: Start clean without forced predefined variants
      //
      // AUDITORÍA (FASE -- modales de cliente/producto/variantes, causa
      // raíz del Objetivo 2): esta rama ("producto nuevo") era la que de
      // verdad rellenaba el formulario con valores falsos cada vez que
      // se abría "Nuevo Producto" -- generaba un código de barras real
      // (`codigoBarras`, aunque el botón "Generar Código" del formulario
      // ya deja hacer esto manualmente, y `handleSubmit` YA genera uno
      // automáticamente al guardar si queda vacío -- línea
      // `finalMainBarcode = codigoBarras.trim() || ...` -- así que
      // prellenarlo aquí era puramente redundante y ocultaba el
      // placeholder), auto-seleccionaba la PRIMERA categoría del
      // catálogo (el `<select>` de Categoría no tenía ninguna opción
      // vacía que representara "sin seleccionar"), y fijaba
      // marca/costo/precio/stockMinimo a los mismos valores de ejemplo
      // citados en la auditoría (ZIO/1200/2500/5). Ninguno de estos 6
      // campos necesita un valor real para abrir el formulario -- todos
      // ya tienen su propio placeholder de ejemplo.
      setNombre('');
      setCodigoBarras('');
      setEnableVariantBarcodes(false);
      setDescripcion('');
      setCategoriaId('');
      setMarca('');
      setCosto('');
      setPrecio('');
      setStockMinimo('');
      setImagenUrl('');

      // FASE (normalización comercial -- Parte 6): por defecto,
      // "Este producto tiene variantes" queda DESACTIVADO para un
      // producto nuevo -- ya no se pre-generan combinaciones S/M/L ×
      // Negro/Beige automáticamente (eso era exclusivamente de ropa). El
      // usuario activa el checkbox solo si de verdad necesita variantes.
      setTieneVariantes(false);
      setStockSimple('');
      setSelectedSizes([]);
      setSelectedColors([]);
      setVariantes([]);
    }
  }, [isOpen, editingProduct?.id]);

  if (!isOpen) return null;

  // ==========================================
  // IMAGE HANDLING & VALIDATION
  // ==========================================
  const handleFileSelection = (file: File) => {
    setImageError(null);

    // Validate MIME type
    if (!file.type.startsWith('image/')) {
      const msg = 'El archivo seleccionado no es una imagen válida (formatos soportados: JPG, PNG, WEBP, etc.).';
      setImageError(msg);
      showToast('Formato Inválido', msg, 'error');
      return;
    }

    // Validate Max Size (10MB)
    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE_BYTES) {
      const msg = `La imagen supera el tamaño máximo permitido de 10MB (${(file.size / (1024 * 1024)).toFixed(1)}MB).`;
      setImageError(msg);
      showToast('Archivo Demasiado Grande', msg, 'error');
      return;
    }

    // Read and create preview data URL -- sin cambios en este mecanismo,
    // la previsualización sigue funcionando exactamente igual que antes.
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const resultStr = event.target.result as string;
        setImagenUrl(resultStr);
        // FIX (fotos de productos): marca que HAY un archivo nuevo
        // pendiente de subir -- esto es lo único nuevo aquí. Se guarda
        // junto con el Base64 (no en vez de él) porque handleSubmit sigue
        // necesitando ese Base64 para subirlo a Drive.
        setSelectedImageFile(file);
        showToast('Imagen Cargada', 'Previsualización lista para el producto.', 'exito');
      }
    };
    reader.onerror = () => {
      setImageError('Error al procesar el archivo de imagen.');
      showToast('Error de Carga', 'No se pudo leer la imagen seleccionada.', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
  };

  const handleRemoveImage = () => {
    setImagenUrl('');
    // FIX (fotos de productos): al eliminar explícitamente, también se
    // limpia el archivo pendiente -- al guardar, esto envía imagenUrl
    // vacío directamente a products.save, sin intentar subir nada
    // (satisface FASE 5: "Eliminar imagen" -> imagenUrl vacío).
    setSelectedImageFile(null);
    setImageError(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    showToast('Imagen Removida', 'Se eliminó la imagen del producto.', 'informacion');
  };

  // ==========================================
  // SELECTION TOGGLES (STABLE, NO LAYOUT SHIFT)
  // ==========================================
  const toggleSizeSelection = (sizeName: string) => {
    setSelectedSizes((prev) => {
      if (prev.includes(sizeName)) {
        return prev.filter((s) => s !== sizeName);
      } else {
        return [...prev, sizeName];
      }
    });
  };

  const toggleColorSelection = (colorName: string) => {
    setSelectedColors((prev) => {
      if (prev.includes(colorName)) {
        return prev.filter((c) => c !== colorName);
      } else {
        return [...prev, colorName];
      }
    });
  };

  const selectAllSizes = () => {
    setSelectedSizes(availableSizes.map((s) => s.nombre));
  };

  const clearAllSizes = () => {
    setSelectedSizes([]);
  };

  const selectAllColors = () => {
    setSelectedColors(availableColors.map((c) => c.nombre));
  };

  const clearAllColors = () => {
    setSelectedColors([]);
  };

  // ==========================================
  // SIZES CATALOG MANAGEMENT (ADD / EDIT / DELETE)
  // ==========================================
  const handleAddCustomSize = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = newSizeName.trim();
    if (!cleanName) {
      showToast('Nombre Requerido', 'Escriba el nombre de la talla (ej. 38 o XL).', 'error');
      return;
    }

    const isDuplicate = availableSizes.some(
      (s) => s.nombre.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (isDuplicate) {
      showToast('Talla Duplicada', `La talla "${cleanName}" ya existe en el catálogo.`, 'advertencia');
      return;
    }

    const newSizeItem: Size = {
      id: `SIZ-${Date.now()}`,
      nombre: cleanName,
      orden: availableSizes.length + 1,
    };

    const updated = [...availableSizes, newSizeItem];
    setAvailableSizes(updated);
    // FASE 3.6B: ya no se persiste a storageService (no hay endpoint real
    // de backend para un catálogo de tallas escribible) -- solo estado
    // local de esta sesión del formulario.

    // Auto-select the newly created size
    if (!selectedSizes.includes(cleanName)) {
      setSelectedSizes((prev) => [...prev, cleanName]);
    }

    setNewSizeName('');
    setIsAddingSize(false);
    showToast('Talla Agregada', `Talla "${cleanName}" añadida y seleccionada.`, 'exito');
  };

  const handleStartEditSize = (sz: Size, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSizeId(sz.id);
    setEditingSizeName(sz.nombre);
  };

  const handleSaveEditSize = (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = editingSizeName.trim();
    if (!cleanName) return;

    const isDuplicate = availableSizes.some(
      (s) => s.id !== id && s.nombre.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (isDuplicate) {
      showToast('Talla Duplicada', `Ya existe otra talla con el nombre "${cleanName}".`, 'advertencia');
      return;
    }

    const oldSize = availableSizes.find((s) => s.id === id);
    const oldName = oldSize ? oldSize.nombre : '';

    const updated = availableSizes.map((s) => (s.id === id ? { ...s, nombre: cleanName } : s));
    setAvailableSizes(updated);
    // FASE 3.6B: ya no se persiste a storageService (no hay endpoint real
    // de backend para un catálogo de tallas escribible) -- solo estado
    // local de esta sesión del formulario.

    // Update in selected sizes
    if (oldName && selectedSizes.includes(oldName)) {
      setSelectedSizes((prev) => prev.map((s) => (s === oldName ? cleanName : s)));
    }

    // Update generated variants in this modal if any
    if (oldName) {
      setVariantes((prev) =>
        prev.map((v) =>
          v.talla === oldName
            ? { ...v, talla: cleanName, sku: `ZIO-${cleanName.replace(/\s+/g, '')}-${v.color.substring(0, 3).toUpperCase()}` }
            : v
        )
      );
    }

    setEditingSizeId(null);
    setEditingSizeName('');
    showToast('Talla Modificada', `Se actualizó a "${cleanName}".`, 'exito');
  };

  const handleDeleteSize = (id: string, sizeName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (availableSizes.length <= 1) {
      showToast('Acción Inválida', 'Debe existir al menos 1 talla en el catálogo.', 'advertencia');
      return;
    }

    const updated = availableSizes.filter((s) => s.id !== id);
    setAvailableSizes(updated);
    // FASE 3.6B: ya no se persiste a storageService (no hay endpoint real
    // de backend para un catálogo de tallas escribible) -- solo estado
    // local de esta sesión del formulario.

    // Remove from current selection
    setSelectedSizes((prev) => prev.filter((s) => s !== sizeName));

    showToast('Talla Eliminada', `Talla "${sizeName}" retirada del catálogo.`, 'informacion');
  };

  // ==========================================
  // COLORS CATALOG MANAGEMENT (ADD / EDIT / DELETE)
  // ==========================================
  const handleAddCustomColor = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = newColorName.trim();
    if (!cleanName) {
      showToast('Nombre Requerido', 'Escriba el nombre del color.', 'error');
      return;
    }

    const isDuplicate = availableColors.some(
      (c) => c.nombre.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (isDuplicate) {
      showToast('Color Duplicado', `El color "${cleanName}" ya existe en el catálogo.`, 'advertencia');
      return;
    }

    const newColorItem: Color = {
      id: `COL-${Date.now()}`,
      nombre: cleanName,
      hex: newColorHex || '#C2410C',
    };

    const updated = [...availableColors, newColorItem];
    setAvailableColors(updated);
    // FASE 3.6B: ídem -- solo estado local de esta sesión del formulario.

    // Auto select the new color
    if (!selectedColors.includes(cleanName)) {
      setSelectedColors((prev) => [...prev, cleanName]);
    }

    setNewColorName('');
    setIsAddingColor(false);
    showToast('Color Agregado', `Color "${cleanName}" añadido y seleccionado.`, 'exito');
  };

  const handleStartEditColor = (col: Color, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingColorId(col.id);
    setEditingColorName(col.nombre);
    setEditingColorHex(col.hex);
  };

  const handleSaveEditColor = (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = editingColorName.trim();
    if (!cleanName) return;

    const isDuplicate = availableColors.some(
      (c) => c.id !== id && c.nombre.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (isDuplicate) {
      showToast('Color Duplicado', `Ya existe otro color con el nombre "${cleanName}".`, 'advertencia');
      return;
    }

    const oldColor = availableColors.find((c) => c.id === id);
    const oldName = oldColor ? oldColor.nombre : '';

    const updated = availableColors.map((c) =>
      c.id === id ? { ...c, nombre: cleanName, hex: editingColorHex } : c
    );
    setAvailableColors(updated);
    // FASE 3.6B: ídem -- solo estado local de esta sesión del formulario.

    // Update selected colors list
    if (oldName && selectedColors.includes(oldName)) {
      setSelectedColors((prev) => prev.map((c) => (c === oldName ? cleanName : c)));
    }

    // Update generated variants in this modal if any
    if (oldName) {
      setVariantes((prev) =>
        prev.map((v) =>
          v.color === oldName
            ? { ...v, color: cleanName, sku: `ZIO-${v.talla.replace(/\s+/g, '')}-${cleanName.substring(0, 3).toUpperCase()}` }
            : v
        )
      );
    }

    setEditingColorId(null);
    setEditingColorName('');
    showToast('Color Modificado', `Se actualizó a "${cleanName}".`, 'exito');
  };

  const handleDeleteColor = (id: string, colorName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (availableColors.length <= 1) {
      showToast('Acción Inválida', 'Debe existir al menos 1 color en el catálogo.', 'advertencia');
      return;
    }

    const updated = availableColors.filter((c) => c.id !== id);
    setAvailableColors(updated);
    // FASE 3.6B: ídem -- solo estado local de esta sesión del formulario.

    // Remove from current selection
    setSelectedColors((prev) => prev.filter((c) => c !== colorName));

    showToast('Color Eliminado', `Color "${colorName}" retirado del catálogo.`, 'informacion');
  };

  // ==========================================
  // MATRIX COMBINATION GENERATOR (TALLA × COLOR)
  // ==========================================
  // FASE (corrección definitiva de variantes -- guardado individual, Parte
  // 4/13): "Generar Combinaciones" es una herramienta EXPLÍCITAMENTE
  // OPCIONAL y ahora es puramente ADITIVA -- nunca reemplaza el arreglo
  // completo de variantes (`setVariantes(newVars)` como antes), porque eso
  // borraba silenciosamente cualquier variante agregada individualmente
  // (Parte 3) o generada en una tanda anterior con otra selección de
  // tallas/colores si no formaba parte del cruce actual. Ahora:
  //   1. Cualquier variante YA presente (sin importar cómo se creó) cuya
  //      combinación talla/color no está en el cruce seleccionado se deja
  //      exactamente igual.
  //   2. Cualquier combinación del cruce que YA existe (comparada con
  //      `getVariantKey`, robusta a mayúsculas/espacios -- FASE 9 +
  //      normalización de esta fase) se deja intacta: nunca se duplica, y
  //      nunca se le resetea el stock ni el código (Parte 9/13).
  //   3. Solo las combinaciones del cruce que NO existen todavía se crean.
  const handleGenerateMatrix = () => {
    const cleanSizes: string[] = Array.from(
      new Set(selectedSizes.map((s) => normalizeVariantOptionName(s)).filter((s): s is string => s !== ''))
    );
    const cleanColors: string[] = Array.from(
      new Set(selectedColors.map((c) => normalizeVariantOptionName(c)).filter((c): c is string => c !== ''))
    );

    if (cleanSizes.length === 0) {
      showToast('Tallas Requeridas', 'Agrega al menos una opción de talla para generar las variantes.', 'error');
      return;
    }
    if (cleanColors.length === 0) {
      showToast('Colores Requeridos', 'Agrega al menos una opción de color para generar las variantes.', 'error');
      return;
    }

    const numCosto = typeof costo === 'number' ? costo : parseFloat(costo) || 0;
    const numPrecio = typeof precio === 'number' ? precio : parseFloat(precio) || 0;
    const numBulkStock = typeof bulkStockVal === 'number' ? bulkStockVal : parseInt(bulkStockVal, 10);
    const initialStock = Number.isFinite(numBulkStock) && numBulkStock >= 0 ? numBulkStock : 6;

    const existingByKey = new Map<string, ProductVariant>();
    (variantes || []).forEach((v) => existingByKey.set(getVariantKey(v.talla, v.color), v));

    const merged: ProductVariant[] = [...(variantes || [])];
    let createdCount = 0;
    let keptCount = 0;

    cleanSizes.forEach((cleanSize) => {
      cleanColors.forEach((cleanColor) => {
        const key = getVariantKey(cleanSize, cleanColor);
        const existing = existingByKey.get(key);

        if (existing) {
          // Ya existe (individual o de una generación previa): se
          // conserva tal cual -- nunca se toca su stock/código (Parte 9/10).
          keptCount++;
          return;
        }

        const cleanSizeCode = cleanSize.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'SZ';
        const cleanColorCode = cleanColor.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'COL';
        const variantBarcode = enableVariantBarcodes
          ? `746${Math.floor(100000000 + Math.random() * 900000000)}`
          : codigoBarras.trim() || `746${Math.floor(100000000 + Math.random() * 900000000)}`;

        const created: ProductVariant = {
          id: `VAR-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          productoId: editingProduct?.id || '',
          talla: cleanSize,
          color: cleanColor,
          sku: `ZIO-${cleanSizeCode}-${cleanColorCode}`,
          codigoBarras: variantBarcode,
          stock: initialStock,
          precio: numPrecio,
          costo: numCosto,
          estado: 'ACTIVO',
        };
        merged.push(created);
        existingByKey.set(key, created); // evita crear un segundo duplicado si el cruce repite la combinación
        createdCount++;
      });
    });

    setVariantes(merged);
    if (createdCount === 0) {
      showToast(
        'Sin Combinaciones Nuevas',
        `Las ${keptCount} combinaciones seleccionadas ya existían -- no se creó ninguna variante duplicada.`,
        'informacion'
      );
    } else {
      showToast(
        'Combinaciones Generadas',
        `Se crearon ${createdCount} variante(s) nueva(s)${keptCount > 0 ? ` (${keptCount} ya existían y se conservaron sin cambios)` : ''}.`,
        'exito'
      );
    }
  };

  const handleApplyBulkStock = () => {
    const val = typeof bulkStockVal === 'number' ? bulkStockVal : parseInt(bulkStockVal, 10);
    if (!Number.isFinite(val) || val < 0) {
      showToast('Stock Inválido', 'Ingrese una cantidad válida mayor o igual a 0.', 'error');
      return;
    }
    setVariantes((prev) => prev.map((v) => ({ ...v, stock: val })));
    showToast('Stock Aplicado', `Se fijaron ${val} unidades a todas las variantes`, 'informacion');
  };

  const handleClearAllVariants = () => {
    // FASE (corrección definitiva de variantes -- guardado individual,
    // Parte 6/11): "Vaciar Todas" no solo debe limpiar la tabla en
    // pantalla -- cualquier variante que YA existía en Sheets (id real)
    // debe marcarse para eliminación (soft-delete) igual que si el
    // usuario hubiera pulsado el basurero de cada una; de lo contrario
    // el backend nunca se entera y esas filas quedan ACTIVAS para
    // siempre, aunque hayan desaparecido de este formulario.
    setDeletedVariantIds((prev) => {
      const realIds = variantes.filter((v) => isRealVariantId(v.id)).map((v) => v.id);
      return Array.from(new Set([...prev, ...realIds]));
    });
    setVariantes([]);
    setSelectedSizes([]);
    setSelectedColors([]);
    showToast('Variantes Vaciadas', 'Se eliminaron todas las combinaciones generadas de este producto.', 'informacion');
  };

  // ==========================================
  // ALTA INDIVIDUAL DE UNA VARIANTE ("+ Agregar variante", Parte 3/12)
  // ==========================================
  // Independiente de "Generar Combinaciones": agrega EXACTAMENTE una
  // combinación talla/color sin generar ninguna otra. Esta es la
  // funcionalidad central pedida por la fase -- un producto con S+Negro y
  // M+Negro debe poder recibir L+Blanco sin que se fuerce la matriz
  // completa S+Negro/S+Blanco/M+Negro/M+Blanco/L+Negro/L+Blanco.
  const handleAddSingleVariant = () => {
    const cleanTalla = normalizeVariantOptionName(newVariantTalla);
    const cleanColor = normalizeVariantOptionName(newVariantColor);

    if (!cleanTalla) {
      showToast('Talla Requerida', 'Seleccione o escriba la talla de la nueva variante.', 'error');
      return;
    }
    if (!cleanColor) {
      showToast('Color Requerido', 'Seleccione o escriba el color de la nueva variante.', 'error');
      return;
    }

    // Parte 5: nunca debe llegar a existir una combinación duplicada --
    // se valida contra TODAS las variantes actuales (existentes + nuevas
    // agregadas en esta misma sesión), usando la misma clave normalizada
    // que el resto del flujo.
    const key = getVariantKey(cleanTalla, cleanColor);
    const collision = (variantes || []).find((v) => getVariantKey(v.talla, v.color) === key);
    if (collision) {
      // Identifica la combinación con la grafía YA guardada (la de
      // `collision`), no con lo que el usuario acaba de teclear -- así el
      // mensaje siempre coincide con lo que se ve en la tabla, sin
      // importar mayúsculas/espacios distintos que haya tecleado esta vez.
      showToast('Variante Duplicada', `Ya existe la variante ${collision.talla} / ${collision.color}.`, 'error');
      return;
    }

    const numCosto = typeof costo === 'number' ? costo : parseFloat(costo) || 0;
    const numPrecio = typeof precio === 'number' ? precio : parseFloat(precio) || 0;
    const numStock = typeof newVariantStock === 'number' ? newVariantStock : parseInt(String(newVariantStock), 10);
    const initialStock = Number.isFinite(numStock) && numStock >= 0 ? numStock : 0;

    const cleanSizeCode = cleanTalla.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'SZ';
    const cleanColorCode = cleanColor.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'COL';
    const manualCode = newVariantCodigo.trim();
    const variantBarcode =
      manualCode ||
      (enableVariantBarcodes
        ? `746${Math.floor(100000000 + Math.random() * 900000000)}`
        : codigoBarras.trim() || `746${Math.floor(100000000 + Math.random() * 900000000)}`);

    const created: ProductVariant = {
      id: `VAR-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      productoId: editingProduct?.id || '',
      talla: cleanTalla,
      color: cleanColor,
      sku: `ZIO-${cleanSizeCode}-${cleanColorCode}`,
      codigoBarras: variantBarcode,
      stock: initialStock,
      precio: numPrecio,
      costo: numCosto,
      estado: 'ACTIVO',
    };

    setVariantes((prev) => [...prev, created]);
    setNewVariantTalla('');
    setNewVariantColor('');
    setNewVariantCodigo('');
    setNewVariantStock(0);
    setIsAddingSingleVariant(false);
    showToast('Variante Agregada', `Se agregó ${cleanTalla} / ${cleanColor} sin afectar las demás combinaciones.`, 'exito');
  };

  // FASE (corrección definitiva de variantes -- guardado individual,
  // Parte 11): eliminar una variante desde este formulario ya NO es un
  // simple `filter` sobre el estado local -- si la variante tiene un id
  // real (ya existe en Sheets), su id se agrega a `deletedVariantIds`
  // para que products.save la marque INACTIVO (soft-delete, preserva
  // Kardex/Ventas/Devoluciones que la referencian). Si es una variante
  // nueva de esta misma sesión (id temporal, nunca llegó a Sheets),
  // simplemente se quita del estado local -- no hay nada que avisarle al
  // backend.
  const handleRemoveVariant = (idx: number) => {
    const target = variantes[idx];
    if (target && isRealVariantId(target.id)) {
      setDeletedVariantIds((prev) => (prev.includes(target.id) ? prev : [...prev, target.id]));
    }
    setVariantes((prev) => prev.filter((_, i) => i !== idx));
  };

  // ==========================================
  // FORM SUBMISSION
  // ==========================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nombre.trim()) {
      showToast('Nombre Requerido', 'Ingrese el nombre del producto.', 'error');
      return;
    }

    const numCosto = typeof costo === 'number' ? costo : parseFloat(costo);
    const numPrecio = typeof precio === 'number' ? precio : parseFloat(precio);
    const numStockMin = typeof stockMinimo === 'number' ? stockMinimo : parseInt(stockMinimo, 10);

    if (!Number.isFinite(numCosto) || numCosto < 0) {
      showToast('Costo Inválido', 'El costo de adquisición debe ser un monto válido mayor o igual a RD$ 0.00.', 'error');
      return;
    }

    if (!Number.isFinite(numPrecio) || numPrecio < 0) {
      showToast('Precio Inválido', 'El precio de venta debe ser un monto válido mayor o igual a RD$ 0.00.', 'error');
      return;
    }

    // FASE (normalización comercial -- variantes opcionales): la
    // exigencia de "al menos 1 combinación" solo aplica cuando el usuario
    // activó "Este producto tiene variantes". Un producto simple valida
    // en cambio su propio campo de stock (más abajo, junto con la
    // construcción de la variante implícita).
    if (tieneVariantes && (variantes || []).length === 0) {
      showToast('Variantes Requeridas', 'Debe generar al menos 1 combinación de talla y color pulsando "+ Generar Combinaciones".', 'error');
      return;
    }

    // FASE (corrección definitiva de variantes -- guardado individual,
    // Parte 5): antes de guardar, NINGUNA combinación talla/color puede
    // repetirse -- se valida aquí con la misma clave normalizada que usan
    // la matriz y el alta individual, y se identifica exactamente cuál
    // combinación está duplicada en el mensaje (nunca un error genérico).
    // El backend vuelve a validar esto por su cuenta (Parte 14) -- esta
    // validación del frontend es solo para dar una respuesta inmediata
    // sin gastar una llamada de red.
    if (tieneVariantes) {
      const seenKeys = new Map<string, string>();
      for (const v of variantes) {
        const key = getVariantKey(v.talla, v.color);
        if (seenKeys.has(key)) {
          const [t, c] = key.split('|');
          showToast(
            'Variante Duplicada',
            `Ya existe la variante ${normalizeVariantOptionName(v.talla) || t} / ${normalizeVariantOptionName(v.color) || c}.`,
            'error'
          );
          return;
        }
        seenKeys.set(key, v.id);
      }
    }

    let numStockSimple = 0;
    if (!tieneVariantes) {
      numStockSimple = typeof stockSimple === 'number' ? stockSimple : parseInt(String(stockSimple), 10);
      if (!Number.isFinite(numStockSimple) || numStockSimple < 0) {
        showToast('Stock Inválido', 'Ingrese una cantidad de stock válida mayor o igual a 0.', 'error');
        return;
      }
    }

    // FIX (fotos de productos -- auditoría aprobada): si el usuario NO
    // seleccionó/cambió ninguna foto en esta sesión del formulario,
    // `imagenUrl` ya contiene lo correcto tal cual (la URL real existente
    // al editar, o '' si nunca hubo/se eliminó) -- se envía directamente,
    // sin ninguna llamada de red adicional. Solo si `selectedImageFile`
    // está presente (foto nueva o reemplazada) se sube primero a Drive y
    // se sustituye el Base64 temporal por la URL real ANTES de guardar el
    // producto. Nunca se envía Base64 a products.save.
    let finalImagenUrl = imagenUrl.trim();

    if (selectedImageFile) {
      setUploadingImage(true);
      const uploadRes = await productsApi.uploadImage(finalImagenUrl);
      setUploadingImage(false);

      if (!uploadRes.success || !uploadRes.data) {
        showToast(
          'Error al Subir Imagen',
          uploadRes.message || 'No se pudo subir la fotografía a Google Drive.',
          'error'
        );
        return; // El formulario permanece abierto para reintentar -- el producto NO se guarda con Base64 ni con una URL inventada.
      }

      finalImagenUrl = uploadRes.data.imageUrl;
    }

    const finalMainBarcode = codigoBarras.trim() || `746${Math.floor(100000000 + Math.random() * 900000000)}`;

    // FASE (normalización comercial -- variantes opcionales, Parte 6/7):
    // un producto SIMPLE (tieneVariantes=false) se sigue guardando con el
    // mismo mecanismo de siempre (`products.save` recibe un arreglo
    // `variantes`) -- se envía una única variante implícita que reutiliza
    // el código de barras principal del producto y el stock capturado
    // arriba. No se envía talla/color: ProductsController.gs ya asigna
    // sus propios valores centinela ('U'/'Único') cuando llegan vacíos,
    // exactamente el mismo comportamiento que ya existía para cualquier
    // variante sin talla/color explícitos -- no se inventa nada nuevo en
    // el backend. Se preserva el `id` de la variante existente si el
    // producto YA tenía una (edición de un producto simple), para no
    // romper el historial de Kardex/Ventas ya vinculado a esa fila.
    const existingSimpleVariantId =
      editingProduct && editingProduct.variantes && editingProduct.variantes.length === 1
        ? editingProduct.variantes[0].id
        : undefined;

    const finalVariantes: ProductVariant[] = tieneVariantes
      ? variantes.map((v) => ({
          ...v,
          codigoBarras: v.codigoBarras?.trim() || finalMainBarcode,
          costo: numCosto,
          precio: numPrecio,
        }))
      : [
          {
            id: existingSimpleVariantId as string,
            productoId: editingProduct?.id || '',
            talla: '',
            color: '',
            sku: '',
            codigoBarras: finalMainBarcode,
            costo: numCosto,
            precio: numPrecio,
            stock: numStockSimple,
            estado: 'ACTIVO',
          },
        ];

    onSave({
      nombre: nombre.trim(),
      codigoBarras: finalMainBarcode,
      // FASE (corrección definitiva de variantes -- guardado individual,
      // Parte 6/11): variantes con id real que el usuario eliminó en esta
      // sesión -- ver handleRemoveVariant/handleClearAllVariants. Siempre
      // se envía (incluso vacío) para que ProductsView/productsApi tengan
      // un contrato estable.
      deletedVariantIds,
      descripcion: descripcion.trim(),
      categoriaId: categoriaId || categories[0]?.id || '',
      marca: marca.trim() || 'ZIO',
      costo: numCosto,
      precio: numPrecio,
      imagenUrl: finalImagenUrl,
      stockMinimo: Number.isFinite(numStockMin) && numStockMin >= 0 ? numStockMin : 5,
      tieneVariantes,
      variantes: finalVariantes,
    });
  };

  // Calculated Margins
  const numP = (typeof precio === 'number' ? precio : parseFloat(precio)) || 0;
  const numC = (typeof costo === 'number' ? costo : parseFloat(costo)) || 0;
  const profit = numP - numC;
  const marginPercent = numC > 0 ? ((profit / numC) * 100).toFixed(0) : '100';
  const totalVariantsStock = variantes.reduce((acc, v) => acc + (v.stock || 0), 0);
  const potentialCombinationsCount = selectedSizes.length * selectedColors.length;

  return (
    <div
      id="product-form-modal-overlay"
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      {/* Hidden File Inputs for Camera and File Picker */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileInputChange}
        className="hidden"
        id="product-camera-input"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/jpg"
        onChange={handleFileInputChange}
        className="hidden"
        id="product-gallery-input"
      />

      <div
        id="product-form-modal-card"
        className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-3xl w-full flex flex-col shadow-2xl overflow-hidden my-auto max-h-[92vh]"
      >
        {/* Sticky Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#E4DDD2] bg-[#FAF8F4] shrink-0">
          <div>
            <span className="text-[10px] uppercase tracking-widest text-[#756E65] font-bold">
              Catálogo de Productos
            </span>
            <h3 className="text-base sm:text-lg font-serif font-bold text-[#2F2A25]">
              {editingProduct ? 'Editar Producto' : 'Registrar Nuevo Producto'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[#756E65] hover:text-[#2F2A25] hover:bg-[#EAE4DA] transition cursor-pointer"
            title="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} noValidate className="overflow-y-auto p-4 sm:p-6 space-y-5 text-xs">
          {/* SECTION 1: DATOS PRINCIPALES DEL PRODUCTO */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Nombre del Producto (Full width) */}
              <div className="sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">
                  Nombre del Producto <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Camisa Oxford, Laptop Dell Inspiron, Smart TV 55..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-medium text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                />
              </div>

              {/* Código de Barras / Serial / IMEI Principal (JUSTO DESPUÉS DE NOMBRE DEL PRODUCTO) */}
              <div className="sm:col-span-2">
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-[#2F2A25] text-xs flex items-center gap-1.5">
                    <Barcode className="w-3.5 h-3.5 text-[#C2410C]" />
                    <span>Código de Barras / Serial / IMEI:</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const gen = `746${Math.floor(100000000 + Math.random() * 900000000)}`;
                      setCodigoBarras(gen);
                      showToast('Código Generado', `Se asignó el código: ${gen}`, 'informacion');
                    }}
                    className="text-[10px] text-[#C2410C] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Generar Código</span>
                  </button>
                </div>
                <div className="relative">
                  <Barcode className="w-4 h-4 text-[#756E65] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={codigoBarras}
                    onChange={(e) => setCodigoBarras(e.target.value)}
                    placeholder="Ej. 746123456789 o IMEI / Serial único..."
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-mono font-bold text-xs text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs"
                  />
                </div>
              </div>

              {/* Categoría */}
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">Categoría:</label>
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-semibold text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                >
                  {/* AUDITORÍA (FASE -- modales de cliente/producto/
                      variantes): antes no existía ninguna opción vacía --
                      un <select> nativo sin ninguna opción con
                      value="" que calce el estado inicial ('') termina
                      mostrando la PRIMERA categoría real como
                      seleccionada visualmente, aunque `categoriaId` en
                      React siga en '' -- el usuario nunca se entera de
                      que en realidad no ha elegido nada. Esta opción
                      vacía y deshabilitada es el placeholder real de un
                      <select>, y hace que "Nuevo Producto" se vea
                      genuinamente sin categoría hasta que el usuario
                      elija una. */}
                  <option value="" disabled>
                    Seleccionar categoría...
                  </option>
                  {(categories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Marca / Línea */}
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">Marca / Línea:</label>
                <input
                  type="text"
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                  placeholder="Ej. Genérica, Samsung, Línea Premium..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-medium text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                />
              </div>

              {/* Costo de Adquisición (PRIMERO) */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-[#2F2A25] text-xs">
                    1. Costo de Adquisición ({currencySymbol}) <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[10px] text-[#756E65]">Precio de compra</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[#756E65]">
                    {currencySymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={costo === '' ? '' : costo}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setCosto('');
                      else {
                        const num = parseFloat(val);
                        setCosto(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                  />
                </div>
              </div>

              {/* Precio de Venta (SEGUNDO) */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-[#2F2A25] text-xs">
                    2. Precio de Venta ({currencySymbol}) <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[10px] text-emerald-800 font-bold">
                    Margen: +{profit >= 0 ? profit.toFixed(0) : 0} {currencySymbol} ({marginPercent}%)
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-emerald-800">
                    {currencySymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={precio === '' ? '' : precio}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setPrecio('');
                      else {
                        const num = parseFloat(val);
                        setPrecio(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-emerald-800 focus:border-emerald-700 focus:outline-none shadow-2xs text-xs"
                  />
                </div>
              </div>

              {/* Stock Mínimo Alerta */}
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">
                  Alerta Stock Mínimo:
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="5"
                  value={stockMinimo === '' ? '' : stockMinimo}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setStockMinimo('');
                    else {
                      const num = parseInt(val, 10);
                      setStockMinimo(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-semibold text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                />
              </div>

              {/* Descripción breve */}
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">
                  Descripción o Detalles:
                </label>
                <input
                  type="text"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Ej. Tejido 100% lino orgánico, corte recto."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-medium text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: IMAGEN DEL PRODUCTO */}
          <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-[#E4DDD2] pb-2">
              <span className="font-bold text-[#2F2A25] uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-[#756E65]" />
                Imagen del Producto
              </span>
              <span className="text-[10px] text-[#756E65]">
                Captura desde cámara o fototeca
              </span>
            </div>

            {imageError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{imageError}</span>
              </div>
            )}

            {imagenUrl ? (
              <div className="space-y-3">
                <div className="relative w-full h-44 sm:h-52 rounded-2xl overflow-hidden border border-[#E4DDD2] bg-[#FAF8F4] group flex items-center justify-center">
                  <img
                    src={toDisplayableImageUrl(imagenUrl)}
                    alt="Previsualización del Producto"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-4">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="px-3 py-2 rounded-xl bg-white text-[#2F2A25] font-bold text-xs shadow-md hover:bg-[#FAF8F4] flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#C2410C]" />
                      <span>Tomar otra</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="px-3 py-2 rounded-xl bg-white text-[#2F2A25] font-bold text-xs shadow-md hover:bg-[#FAF8F4] flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#756E65]" />
                      <span>Cambiar</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="px-3 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs shadow-md hover:bg-rose-700 flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Quitar</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-emerald-800 font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Imagen lista para el catálogo
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] hover:bg-[#F0EAE1] text-[#2F2A25] font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#756E65]" />
                      <span>Tomar otra foto</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] hover:bg-[#F0EAE1] text-[#2F2A25] font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#756E65]" />
                      <span>Fototeca / Galería</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Dropzone & Picker Trigger */
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`p-5 rounded-2xl border-2 border-dashed transition text-center flex flex-col items-center justify-center gap-3 ${
                  isDragging
                    ? 'border-[#2F2A25] bg-[#F6F1E8]'
                    : 'border-[#E4DDD2] bg-[#FAF8F4] hover:border-[#2F2A25]/60'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-white border border-[#E4DDD2] flex items-center justify-center text-[#756E65] shadow-2xs">
                  <Camera className="w-6 h-6 text-[#2F2A25]" />
                </div>

                <div className="space-y-0.5">
                  <p className="font-bold text-xs text-[#2F2A25]">
                    Cargar imagen del producto
                  </p>
                  <p className="text-[11px] text-[#756E65]">
                    Tome una foto en directo o elija una desde su galería / archivos
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {/* Camera Button */}
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-[#2F2A25] text-white font-bold text-xs hover:bg-[#403932] transition shadow-xs flex items-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-[#E8DCC8]" />
                    <span>Tomar Foto (Cámara)</span>
                  </button>

                  {/* Gallery / PC Files Button */}
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-white border border-[#E4DDD2] text-[#2F2A25] font-bold text-xs hover:bg-[#F6F1E8] transition shadow-2xs flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-[#756E65]" />
                    <span>Fototeca / Galería / PC</span>
                  </button>
                </div>

                <span className="text-[10px] text-[#756E65]">
                  Formatos soportados: JPG, PNG, WEBP (Hasta 10MB)
                </span>
              </div>
            )}
          </div>

          {/* FASE (normalización comercial -- variantes opcionales): control
              que decide si se muestra la sección de variantes existente.
              Por defecto OFF para productos nuevos (ver useEffect de
              apertura) -- el producto se registra como producto simple
              (una única variante implícita creada al guardar, ver
              handleSubmit) salvo que el usuario active esta opción. */}
          <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-2xs">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={tieneVariantes}
                onChange={(e) => setTieneVariantes(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-[#E4DDD2] text-[#2F2A25] focus:ring-[#2F2A25] cursor-pointer"
              />
              <span>
                <span className="block font-bold text-[#2F2A25] text-xs">Este producto tiene variantes</span>
                <span className="block text-[10px] text-[#756E65] mt-0.5">
                  Activa esta opción cuando el producto tenga diferentes opciones, presentaciones, modelos, tallas, colores u otros atributos.
                </span>
              </span>
            </label>

            {!tieneVariantes && (
              <div className="mt-3 pt-3 border-t border-[#E4DDD2]">
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">
                  Stock Disponible <span className="text-rose-600">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={stockSimple === '' ? '' : stockSimple}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setStockSimple('');
                    else {
                      const num = parseInt(val, 10);
                      setStockSimple(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-semibold text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                />
                <span className="text-[10px] text-[#756E65]">Cantidad de unidades disponibles de este producto (sin variantes).</span>
              </div>
            )}
          </div>

          {/* SECTION 3: CONFIGURACIÓN DE VARIANTES -- visible únicamente
              cuando "Este producto tiene variantes" está activado. La
              sección en sí (matriz de tallas/colores, generación de
              combinaciones, códigos por variante, etc.) NO se modificó --
              solo se le agregó esta condición de visibilidad. */}
          {tieneVariantes && (
          <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] space-y-4 shadow-2xs">
            {/* Section Header & Main Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E4DDD2] pb-3">
              <div>
                <span className="font-bold text-[#2F2A25] uppercase text-[11px] tracking-wider block">
                  Configuración de Variantes
                </span>
                <span className="text-[10px] text-[#756E65]">
                  Haga clic en las tallas y colores que aplican a este producto para activarlos
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCatalogManager(!showCatalogManager)}
                  className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    showCatalogManager
                      ? 'bg-[#2F2A25] text-white border-[#2F2A25]'
                      : 'bg-[#FAF8F4] text-[#756E65] border-[#E4DDD2] hover:bg-[#EAE4DA] hover:text-[#2F2A25]'
                  }`}
                  title="Administrar o agregar tallas y colores al catálogo general"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>{showCatalogManager ? 'Ocultar Edición' : 'Editar Catálogo'}</span>
                </button>

                {/* Parte 3/12: alta individual -- SIEMPRE visible e
                    independiente de "Generar Combinaciones". Nunca exige
                    seleccionar tallas/colores primero. */}
                <button
                  type="button"
                  onClick={() => setIsAddingSingleVariant((prev) => !prev)}
                  className={`px-3.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    isAddingSingleVariant
                      ? 'bg-[#2F2A25] text-white border-[#2F2A25]'
                      : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F0EAE1]'
                  }`}
                  title="Agregar una única combinación de talla y color, sin generar ninguna otra"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Agregar Variante</span>
                </button>

                <button
                  type="button"
                  onClick={handleGenerateMatrix}
                  className="px-3.5 py-1.5 rounded-xl bg-[#C2410C] hover:bg-[#9A3412] text-white font-bold text-[11px] shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                  title="Herramienta opcional: genera todas las combinaciones talla × color que aún no existan"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generar Combinaciones ({potentialCombinationsCount})</span>
                </button>
              </div>
            </div>

            {/* Parte 3/12: formulario inline de alta individual -- Talla /
                Color / Código (opcional) / Stock inicial. No depende de
                `selectedSizes`/`selectedColors` ni de la matriz. */}
            {isAddingSingleVariant && (
              <div className="p-3 bg-[#FAF8F4] rounded-xl border border-[#D5CCC0] space-y-2.5">
                <span className="font-bold text-[11px] text-[#2F2A25] uppercase tracking-wide flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-[#C2410C]" />
                  Agregar Una Variante Individual
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-[#756E65] mb-1 uppercase">Talla</label>
                    <input
                      type="text"
                      list="product-form-single-variant-sizes"
                      value={newVariantTalla}
                      onChange={(e) => setNewVariantTalla(e.target.value)}
                      placeholder="Ej. S, 38..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#E4DDD2] bg-white text-xs font-semibold"
                    />
                    <datalist id="product-form-single-variant-sizes">
                      {availableSizes.map((sz) => (
                        <option key={sz.id} value={sz.nombre} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#756E65] mb-1 uppercase">Color</label>
                    <input
                      type="text"
                      list="product-form-single-variant-colors"
                      value={newVariantColor}
                      onChange={(e) => setNewVariantColor(e.target.value)}
                      placeholder="Ej. Negro..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#E4DDD2] bg-white text-xs font-semibold"
                    />
                    <datalist id="product-form-single-variant-colors">
                      {availableColors.map((col) => (
                        <option key={col.id} value={col.nombre} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#756E65] mb-1 uppercase">Código (opcional)</label>
                    <input
                      type="text"
                      value={newVariantCodigo}
                      onChange={(e) => setNewVariantCodigo(e.target.value)}
                      placeholder="Se genera si se deja vacío"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#E4DDD2] bg-white text-xs font-mono font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#756E65] mb-1 uppercase">Stock Inicial</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={newVariantStock === '' ? '' : newVariantStock}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') setNewVariantStock('');
                        else {
                          const num = parseInt(val, 10);
                          setNewVariantStock(isNaN(num) ? '' : val);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#E4DDD2] bg-white text-xs font-bold text-center"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setIsAddingSingleVariant(false)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#756E65] hover:text-[#2F2A25] cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSingleVariant}
                    className="px-3.5 py-1.5 rounded-lg bg-[#2F2A25] text-white font-bold text-[11px] hover:bg-[#403932] transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Agregar Esta Variante</span>
                  </button>
                </div>
              </div>
            )}

            {/* SELECCIÓN DE TALLAS (ESTABLE, SIN JITTER) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-[#2F2A25] uppercase tracking-wide">
                    Tallas Seleccionadas ({selectedSizes.length}):
                  </label>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={selectAllSizes}
                    className="text-[#756E65] hover:text-[#2F2A25] font-semibold underline cursor-pointer"
                  >
                    Todas
                  </button>
                  <span className="text-[#E4DDD2]">|</span>
                  <button
                    type="button"
                    onClick={clearAllSizes}
                    className="text-[#756E65] hover:text-[#2F2A25] font-semibold underline cursor-pointer"
                  >
                    Ninguna
                  </button>
                </div>
              </div>

              {/* Botones de Tallas con Ancho Estable y Clic Inmediato */}
              <div className="flex flex-wrap gap-1.5">
                {availableSizes.map((sz) => {
                  const isSelected = selectedSizes.includes(sz.nombre);
                  return (
                    <button
                      key={sz.id}
                      type="button"
                      onClick={() => toggleSizeSelection(sz.nombre)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 cursor-pointer select-none ${
                        isSelected
                          ? 'bg-[#2F2A25] text-white border-[#2F2A25] shadow-xs'
                          : 'bg-[#FAF8F4] text-[#554E45] border-[#E4DDD2] hover:bg-[#F0EAE1] hover:border-[#2F2A25]/40'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-[#E8DCC8]" />}
                      <span>{sz.nombre}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SELECCIÓN DE COLORES (ESTABLE, SIN JITTER NI DESPLAZAMIENTOS) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-[#2F2A25] uppercase tracking-wide">
                    Colores Seleccionados ({selectedColors.length}):
                  </label>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={selectAllColors}
                    className="text-[#756E65] hover:text-[#2F2A25] font-semibold underline cursor-pointer"
                  >
                    Todos
                  </button>
                  <span className="text-[#E4DDD2]">|</span>
                  <button
                    type="button"
                    onClick={clearAllColors}
                    className="text-[#756E65] hover:text-[#2F2A25] font-semibold underline cursor-pointer"
                  >
                    Ninguno
                  </button>
                </div>
              </div>

              {/* Botones de Colores con Muestra Visual y Clic Inmediato */}
              <div className="flex flex-wrap gap-1.5">
                {availableColors.map((col) => {
                  const isSelected = selectedColors.includes(col.nombre);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColorSelection(col.nombre)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 cursor-pointer select-none ${
                        isSelected
                          ? 'bg-[#2F2A25] text-white border-[#2F2A25] shadow-xs'
                          : 'bg-[#FAF8F4] text-[#554E45] border-[#E4DDD2] hover:bg-[#F0EAE1] hover:border-[#2F2A25]/40'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-black/20 shrink-0"
                        style={{ backgroundColor: col.hex }}
                      />
                      <span>{col.nombre}</span>
                      {isSelected && <Check className="w-3 h-3 text-[#E8DCC8]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CATALOG MANAGER PANEL (SECCIÓN DEDICADA PARA EDITAR Y AGREGAR SIN AFECTAR LA SELECCIÓN) */}
            {showCatalogManager && (
              <div className="p-3.5 bg-[#FAF8F4] rounded-2xl border border-[#D5CCC0] space-y-4">
                <div className="flex items-center justify-between border-b border-[#E4DDD2] pb-2">
                  <div className="flex items-center gap-1.5 font-bold text-[#2F2A25] text-xs">
                    <Settings2 className="w-4 h-4 text-[#C2410C]" />
                    <span>Administración del Catálogo de Tallas y Colores</span>
                  </div>
                  <span className="text-[10px] text-[#756E65]">
                    Los cambios se guardan automáticamente
                  </span>
                </div>

                {/* GESTIÓN DE TALLAS */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[11px] text-[#2F2A25]">Catálogo de Tallas:</span>
                    {!isAddingSize && (
                      <button
                        type="button"
                        onClick={() => setIsAddingSize(true)}
                        className="text-[11px] font-bold text-[#C2410C] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>+ Nueva Talla</span>
                      </button>
                    )}
                  </div>

                  {isAddingSize && (
                    <div className="p-2 bg-white rounded-xl border border-[#E4DDD2] flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        placeholder="Nombre de talla (ej. 40, 42, XXL, 0)..."
                        value={newSizeName}
                        onChange={(e) => setNewSizeName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomSize();
                          }
                        }}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#E4DDD2] text-xs font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddCustomSize()}
                        className="px-3 py-1.5 rounded-lg bg-[#2F2A25] text-white font-bold text-xs hover:bg-[#403932] cursor-pointer"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingSize(false);
                          setNewSizeName('');
                        }}
                        className="p-1.5 text-[#756E65] hover:text-[#2F2A25] cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {availableSizes.map((sz) => {
                      const isEditing = editingSizeId === sz.id;
                      if (isEditing) {
                        return (
                          <div
                            key={sz.id}
                            className="flex items-center gap-1 bg-white border border-[#2F2A25] px-2 py-1 rounded-xl shadow-2xs"
                          >
                            <input
                              type="text"
                              autoFocus
                              value={editingSizeName}
                              onChange={(e) => setEditingSizeName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveEditSize(sz.id);
                                }
                              }}
                              className="w-14 px-1.5 py-0.5 border border-[#E4DDD2] rounded text-xs font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveEditSize(sz.id)}
                              className="p-1 text-emerald-800 hover:text-emerald-950 cursor-pointer"
                              title="Guardar"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSizeId(null)}
                              className="p-1 text-[#756E65] hover:text-black cursor-pointer"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={sz.id}
                          className="bg-white border border-[#E4DDD2] px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                        >
                          <span className="text-[#2F2A25]">{sz.nombre}</span>
                          <button
                            type="button"
                            onClick={(e) => handleStartEditSize(sz, e)}
                            className="p-0.5 text-[#756E65] hover:text-[#2F2A25] cursor-pointer"
                            title="Editar nombre"
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSize(sz.id, sz.nombre, e)}
                            className="p-0.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                            title="Eliminar de catálogo"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* GESTIÓN DE COLORES */}
                <div className="space-y-2 pt-2 border-t border-[#E4DDD2]">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[11px] text-[#2F2A25]">Catálogo de Colores:</span>
                    {!isAddingColor && (
                      <button
                        type="button"
                        onClick={() => setIsAddingColor(true)}
                        className="text-[11px] font-bold text-[#C2410C] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>+ Nuevo Color</span>
                      </button>
                    )}
                  </div>

                  {isAddingColor && (
                    <div className="p-2 bg-white rounded-xl border border-[#E4DDD2] flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 bg-[#FAF8F4] px-2 py-1 rounded-lg border border-[#E4DDD2]">
                        <input
                          type="color"
                          value={newColorHex}
                          onChange={(e) => setNewColorHex(e.target.value)}
                          className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                        />
                        <span className="font-mono text-[10px] text-[#756E65]">{newColorHex}</span>
                      </div>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Nombre del color (ej. Vino, Lavanda, Coral)..."
                        value={newColorName}
                        onChange={(e) => setNewColorName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomColor();
                          }
                        }}
                        className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-[#E4DDD2] text-xs font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddCustomColor()}
                        className="px-3 py-1.5 rounded-lg bg-[#2F2A25] text-white font-bold text-xs hover:bg-[#403932] cursor-pointer"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingColor(false);
                          setNewColorName('');
                        }}
                        className="p-1.5 text-[#756E65] hover:text-[#2F2A25] cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    {availableColors.map((col) => {
                      const isEditing = editingColorId === col.id;
                      if (isEditing) {
                        return (
                          <div
                            key={col.id}
                            className="flex items-center gap-1.5 bg-white border border-[#2F2A25] px-2 py-1 rounded-xl shadow-2xs"
                          >
                            <input
                              type="color"
                              value={editingColorHex}
                              onChange={(e) => setEditingColorHex(e.target.value)}
                              className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                            />
                            <input
                              type="text"
                              autoFocus
                              value={editingColorName}
                              onChange={(e) => setEditingColorName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveEditColor(col.id);
                                }
                              }}
                              className="w-20 px-1.5 py-0.5 border border-[#E4DDD2] rounded text-xs font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveEditColor(col.id)}
                              className="p-1 text-emerald-800 hover:text-emerald-950 cursor-pointer"
                              title="Guardar"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingColorId(null)}
                              className="p-1 text-[#756E65] hover:text-black cursor-pointer"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={col.id}
                          className="bg-white border border-[#E4DDD2] px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-2"
                        >
                          <span
                            className="w-3 h-3 rounded-full border border-black/20 shrink-0"
                            style={{ backgroundColor: col.hex }}
                          />
                          <span className="text-[#2F2A25]">{col.nombre}</span>
                          <button
                            type="button"
                            onClick={(e) => handleStartEditColor(col, e)}
                            className="p-0.5 text-[#756E65] hover:text-[#2F2A25] cursor-pointer"
                            title="Editar"
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteColor(col.id, col.nombre, e)}
                            className="p-0.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* CHECKBOX: Códigos de barras / seriales individuales por variante */}
            <div className="bg-[#FAF8F4] p-3 rounded-2xl border border-[#E4DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enableVariantBarcodes}
                  onChange={(e) => {
                    const isChecked = e.target.checked;
                    setEnableVariantBarcodes(isChecked);
                    if (isChecked) {
                      setVariantes((prev) =>
                        prev.map((v) => ({
                          ...v,
                          codigoBarras:
                            v.codigoBarras && v.codigoBarras.trim() !== ''
                              ? v.codigoBarras
                              : `746${Math.floor(100000000 + Math.random() * 900000000)}`,
                        }))
                      );
                      showToast(
                        'Códigos por Variante Habilitados',
                        'Se activó la columna de códigos de barras / seriales individuales.',
                        'informacion'
                      );
                    }
                  }}
                  className="w-4 h-4 text-[#C2410C] rounded border-[#E4DDD2] focus:ring-[#C2410C] cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-[#2F2A25] flex items-center gap-1.5">
                    <Barcode className="w-3.5 h-3.5 text-[#C2410C]" />
                    <span>Habilitar códigos de barras / seriales / IMEI individuales por variante</span>
                  </span>
                  <p className="text-[10px] text-[#756E65]">
                    Asigna o escanea un código único para cada combinación específica de talla y color.
                  </p>
                </div>
              </label>

              {enableVariantBarcodes && variantes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    // FASE (corrección definitiva de variantes -- guardado
                    // individual, Parte 10): "Generar para todas" solo debe
                    // completar el código de las variantes que TODAVÍA no
                    // tienen uno -- antes sobrescribía incondicionalmente
                    // el código de TODAS las variantes, incluidas las que
                    // ya tenían uno real guardado (destruía códigos
                    // existentes cada vez que se pulsaba). Mismo criterio
                    // ya usado al activar el checkbox de arriba.
                    let filled = 0;
                    setVariantes((prev) =>
                      prev.map((v) => {
                        if (v.codigoBarras && v.codigoBarras.trim() !== '') return v;
                        filled++;
                        return { ...v, codigoBarras: `746${Math.floor(100000000 + Math.random() * 900000000)}` };
                      })
                    );
                    if (filled === 0) {
                      showToast('Nada Que Generar', 'Todas las combinaciones ya tienen un código asignado.', 'informacion');
                    } else {
                      showToast('Códigos Generados', `Se asignó código a ${filled} combinación(es) que no tenían uno. Los códigos existentes no se modificaron.`, 'exito');
                    }
                  }}
                  className="px-2.5 py-1 rounded-xl bg-white border border-[#E4DDD2] text-[10px] font-bold text-[#C2410C] hover:bg-[#F6F1E8] transition cursor-pointer flex items-center gap-1 self-start sm:self-auto shadow-2xs"
                  title="Genera un código solo para las combinaciones que aún no tienen uno -- nunca reemplaza códigos ya existentes"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Generar para todas</span>
                </button>
              )}
            </div>

            {/* TABLA DE COMBINACIONES GENERADAS */}
            <div className="space-y-2.5 pt-2 border-t border-[#E4DDD2]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#2F2A25] text-xs">
                    Combinaciones Generadas ({variantes.length})
                  </span>
                  <span className="text-[10px] text-[#756E65] bg-[#FAF8F4] px-2 py-0.5 rounded-md border border-[#E4DDD2] font-semibold">
                    Stock Total: {totalVariantsStock} uds
                  </span>
                </div>

                {/* Bulk Controls */}
                {variantes.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[#756E65] font-semibold">Stock para todas:</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        placeholder="6"
                        value={bulkStockVal === '' ? '' : bulkStockVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') setBulkStockVal('');
                          else {
                            const num = parseInt(val, 10);
                            setBulkStockVal(isNaN(num) ? '' : val);
                          }
                        }}
                        className="w-12 px-1.5 py-0.5 rounded-lg border border-[#E4DDD2] bg-white text-xs font-bold text-center"
                      />
                      <button
                        type="button"
                        onClick={handleApplyBulkStock}
                        className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[10px] font-bold text-[#2F2A25] hover:bg-[#EAE4DA] transition cursor-pointer"
                      >
                        Aplicar
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearAllVariants}
                      className="px-2 py-0.5 rounded-lg bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer flex items-center gap-1"
                      title="Eliminar todas las combinaciones generadas"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Vaciar Todas</span>
                    </button>
                  </div>
                )}
              </div>

              {variantes.length > 0 ? (
                <div className="max-h-56 overflow-y-auto border border-[#E4DDD2] rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF8F4] text-[#756E65] border-b border-[#E4DDD2] sticky top-0 text-[10px] uppercase font-bold tracking-wider z-10">
                      <tr>
                        <th className="py-2 px-3">Talla</th>
                        <th className="py-2 px-3">Color</th>
                        <th className="py-2 px-3">SKU Generado</th>
                        {enableVariantBarcodes && <th className="py-2 px-3">Código / Serial / IMEI</th>}
                        <th className="py-2 px-3 text-center">Stock Inicial</th>
                        <th className="py-2 px-3 text-center">Estado</th>
                        <th className="py-2 px-3 text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4DDD2]/60 bg-white">
                      {variantes.map((v, idx) => {
                        const colObj = availableColors.find((c) => c.nombre.toLowerCase() === v.color.toLowerCase());
                        return (
                          <tr key={idx} className="hover:bg-[#FAF8F4]/80 transition">
                            <td className="py-2 px-3 font-bold text-[#2F2A25]">{v.talla}</td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-3 h-3 rounded-full border border-black/20 shrink-0"
                                  style={{ backgroundColor: colObj?.hex || '#666' }}
                                />
                                <span className="font-semibold text-[#2F2A25]">{v.color}</span>
                              </div>
                            </td>
                            <td className="py-2 px-3 font-mono text-[10px] text-[#756E65]">{v.sku}</td>
                            
                            {enableVariantBarcodes && (
                              <td className="py-2 px-3">
                                <div className="relative min-w-[140px]">
                                  <input
                                    type="text"
                                    placeholder="Código o Serial..."
                                    value={v.codigoBarras || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setVariantes((prev) => {
                                        const updated = [...prev];
                                        updated[idx] = { ...updated[idx], codigoBarras: val };
                                        return updated;
                                      });
                                    }}
                                    className="w-full pl-2 pr-7 py-1 border border-[#E4DDD2] rounded-lg bg-[#FAF8F4] font-mono text-[11px] font-bold text-[#2F2A25] focus:bg-white focus:outline-none focus:border-[#2F2A25]"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVariantes((prev) => {
                                        const updated = [...prev];
                                        updated[idx] = {
                                          ...updated[idx],
                                          codigoBarras: `746${Math.floor(100000000 + Math.random() * 900000000)}`,
                                        };
                                        return updated;
                                      });
                                    }}
                                    title="Generar código para esta variante"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#756E65] hover:text-[#C2410C] cursor-pointer"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            )}

                            <td className="py-2 px-3 text-center">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={v.stock}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const newStock = val === '' ? 0 : parseInt(val, 10);
                                  setVariantes((prev) => {
                                    const updated = [...prev];
                                    updated[idx] = { ...updated[idx], stock: isNaN(newStock) ? 0 : newStock };
                                    return updated;
                                  });
                                }}
                                className="w-16 px-2 py-1 border border-[#E4DDD2] rounded-lg bg-[#FAF8F4] font-bold text-[#2F2A25] text-center focus:bg-white focus:outline-none"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              {/* Parte 12: distingue visualmente una
                                  variante ya guardada en Sheets de una
                                  nueva de esta sesión -- mismo criterio
                                  (isRealVariantId) que decide cómo se
                                  procesa al guardar. */}
                              {isRealVariantId(v.id) ? (
                                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  Guardada
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                  Nueva
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveVariant(idx)}
                                className="text-rose-600 hover:text-rose-800 font-semibold text-[11px] p-1 rounded hover:bg-rose-50 transition cursor-pointer"
                                title="Eliminar combinación"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-6 text-center text-[#756E65] bg-[#FAF8F4] rounded-xl border border-[#E4DDD2] space-y-2">
                  <Layers className="w-6 h-6 opacity-40 mx-auto" />
                  <p className="font-semibold text-xs text-[#2F2A25]">
                    No hay combinaciones generadas
                  </p>
                  <p className="text-[10px] max-w-sm mx-auto">
                    Use <strong>"+ Agregar Variante"</strong> para dar de alta una sola combinación, o seleccione tallas y colores arriba y pulse el botón naranja <strong>"Generar Combinaciones"</strong> para crear varias a la vez.
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateMatrix}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C2410C] text-white font-bold text-xs shadow-2xs hover:bg-[#9A3412] transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generar ahora ({potentialCombinationsCount} variantes)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          )}

          {/* Sticky Bottom Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-3 border-t border-[#E4DDD2]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || uploadingImage}
              className="py-3 px-4 rounded-xl bg-white border border-[#E4DDD2] text-xs font-bold text-[#756E65] hover:bg-[#F6F1E8] hover:text-[#2F2A25] transition cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || uploadingImage}
              className="flex-1 py-3 px-4 rounded-xl bg-[#2F2A25] text-xs font-bold text-[#FAF8F4] shadow-md hover:bg-[#403932] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 text-[#E8DCC8]" />
              <span>
                {uploadingImage
                  ? 'Subiendo imagen...'
                  : saving
                  ? 'Guardando producto...'
                  : editingProduct
                  ? 'Guardar Cambios del Producto'
                  : 'Guardar Producto en Catálogo'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
