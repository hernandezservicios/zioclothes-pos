import React, { useState, useRef, useEffect } from 'react';
import { Product, ProductVariant, Category, Size, Color } from '../../types';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/formatters';
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
    variantes: ProductVariant[];
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
  const [nombre, setNombre] = useState('');
  const [codigoBarras, setCodigoBarras] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [marca, setMarca] = useState('ZIO');
  const [costo, setCosto] = useState<number | string>(1200); // Costo FIRST
  const [precio, setPrecio] = useState<number | string>(2500); // Precio SECOND
  const [stockMinimo, setStockMinimo] = useState<number | string>(5);
  const [imagenUrl, setImagenUrl] = useState('');
  const [variantes, setVariantes] = useState<ProductVariant[]>([]);

  // Variant Individual Barcodes Checkbox State
  const [enableVariantBarcodes, setEnableVariantBarcodes] = useState(false);

  // Image Upload States
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

    if (editingProduct) {
      setNombre(editingProduct.nombre || '');
      setCodigoBarras(editingProduct.codigoBarras || '');
      setDescripcion(editingProduct.descripcion || '');
      setCategoriaId(editingProduct.categoriaId || categories[0]?.id || '');
      setMarca(editingProduct.marca || 'ZIO');
      setCosto(editingProduct.costo || 0);
      setPrecio(editingProduct.precio || 0);
      setStockMinimo(editingProduct.stockMinimo || 5);
      setImagenUrl(editingProduct.imagenUrl || '');
      
      const prodVariants = editingProduct.variantes || [];
      setVariantes([...prodVariants]);

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
      setNombre('');
      setCodigoBarras(`746${Math.floor(100000000 + Math.random() * 900000000)}`);
      setEnableVariantBarcodes(false);
      setDescripcion('');
      setCategoriaId(categories[0]?.id || '');
      setMarca('ZIO');
      setCosto(1200);
      setPrecio(2500);
      setStockMinimo(5);
      setImagenUrl('');

      // Pre-select popular starting tags but do not force unwanted combinations
      const initialSizes = ['S', 'M', 'L'];
      const initialColors = ['Negro', 'Beige'];
      setSelectedSizes(initialSizes);
      setSelectedColors(initialColors);

      // Generate initial variants corresponding to initial selection
      const initialVars: ProductVariant[] = [];
      initialSizes.forEach((s) => {
        initialColors.forEach((c) => {
          const sCode = s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'SZ';
          const cCode = c.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'COL';
          initialVars.push({
            id: `VAR-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productoId: '',
            talla: s,
            color: c,
            sku: `ZIO-${sCode}-${cCode}`,
            codigoBarras: `746${Math.floor(100000000 + Math.random() * 900000000)}`,
            stock: 6,
            precio: 2500,
            costo: 1200,
            estado: 'ACTIVO',
          });
        });
      });
      setVariantes(initialVars);
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

    // Read and create preview data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const resultStr = event.target.result as string;
        setImagenUrl(resultStr);
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
  const handleGenerateMatrix = () => {
    if (selectedSizes.length === 0) {
      showToast('Tallas Requeridas', 'Seleccione al menos 1 talla activa haciendo clic en las opciones.', 'error');
      return;
    }
    if (selectedColors.length === 0) {
      showToast('Colores Requeridos', 'Seleccione al menos 1 color activo haciendo clic en las opciones.', 'error');
      return;
    }

    const numCosto = typeof costo === 'number' ? costo : parseFloat(costo) || 0;
    const numPrecio = typeof precio === 'number' ? precio : parseFloat(precio) || 0;
    const numBulkStock = typeof bulkStockVal === 'number' ? bulkStockVal : parseInt(bulkStockVal, 10);
    const initialStock = Number.isFinite(numBulkStock) && numBulkStock >= 0 ? numBulkStock : 6;

    const newVars: ProductVariant[] = [];
    selectedSizes.forEach((s) => {
      selectedColors.forEach((c) => {
        const cleanSize = s.trim();
        const cleanColor = c.trim();
        const cleanSizeCode = cleanSize.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'SZ';
        const cleanColorCode = cleanColor.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'COL';
        
        // Preserve stock and barcodes if this combination already existed
        const existing = (variantes || []).find((v) => v.talla === cleanSize && v.color === cleanColor);

        if (existing) {
          newVars.push({
            ...existing,
            codigoBarras:
              existing.codigoBarras ||
              (enableVariantBarcodes
                ? `746${Math.floor(100000000 + Math.random() * 900000000)}`
                : codigoBarras.trim() || `746${Math.floor(100000000 + Math.random() * 900000000)}`),
            costo: numCosto || existing.costo,
            precio: numPrecio || existing.precio,
          });
        } else {
          const variantBarcode = enableVariantBarcodes
            ? `746${Math.floor(100000000 + Math.random() * 900000000)}`
            : codigoBarras.trim() || `746${Math.floor(100000000 + Math.random() * 900000000)}`;

          newVars.push({
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
          });
        }
      });
    });

    setVariantes(newVars);
    showToast('Combinaciones Generadas', `Se generaron ${newVars.length} variantes (${selectedSizes.length} tallas × ${selectedColors.length} colores)`, 'exito');
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
    setVariantes([]);
    setSelectedSizes([]);
    setSelectedColors([]);
    showToast('Variantes Vaciadas', 'Se eliminaron todas las combinaciones generadas de esta prenda.', 'informacion');
  };

  // ==========================================
  // FORM SUBMISSION
  // ==========================================
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!nombre.trim()) {
      showToast('Nombre Requerido', 'Ingrese el nombre de la prenda.', 'error');
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

    if ((variantes || []).length === 0) {
      showToast('Variantes Requeridas', 'Debe generar al menos 1 combinación de talla y color pulsando "+ Generar Combinaciones".', 'error');
      return;
    }

    const finalMainBarcode = codigoBarras.trim() || `746${Math.floor(100000000 + Math.random() * 900000000)}`;

    onSave({
      nombre: nombre.trim(),
      codigoBarras: finalMainBarcode,
      descripcion: descripcion.trim(),
      categoriaId: categoriaId || categories[0]?.id || '',
      marca: marca.trim() || 'ZIO',
      costo: numCosto,
      precio: numPrecio,
      imagenUrl: imagenUrl.trim(),
      stockMinimo: Number.isFinite(numStockMin) && numStockMin >= 0 ? numStockMin : 5,
      variantes: variantes.map((v) => ({
        ...v,
        codigoBarras: v.codigoBarras?.trim() || finalMainBarcode,
        costo: numCosto,
        precio: numPrecio,
      })),
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
              Catálogo ZIO Clothes
            </span>
            <h3 className="text-base sm:text-lg font-serif font-bold text-[#2F2A25]">
              {editingProduct ? 'Editar Prenda de Vestir' : 'Registrar Nueva Prenda'}
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
          {/* SECTION 1: DATOS PRINCIPALES DE LA PRENDA */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Nombre de la Prenda (Full width) */}
              <div className="sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">
                  Nombre de la Prenda <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Vestido Midi Plisado en Lino, Camisa Guayabera Lino..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-medium text-[#2F2A25] focus:border-[#2F2A25] focus:outline-none shadow-2xs text-xs"
                />
              </div>

              {/* Código de Barras / Serial / IMEI Principal (JUSTO DESPUÉS DE NOMBRE DE LA PRENDA) */}
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
                  {(categories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Marca / Colección */}
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1 text-xs">Marca / Colección:</label>
                <input
                  type="text"
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                  placeholder="Ej. ZIO Atelier, Colección Verano..."
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

          {/* SECTION 2: FOTOGRAFÍA / IMAGEN DE LA PRENDA */}
          <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] space-y-3 shadow-2xs">
            <div className="flex items-center justify-between border-b border-[#E4DDD2] pb-2">
              <span className="font-bold text-[#2F2A25] uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-[#756E65]" />
                Fotografía de la Prenda
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
                    src={imagenUrl}
                    alt="Previsualización de Prenda"
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
                    Cargar foto de la prenda
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

          {/* SECTION 3: CONFIGURACIÓN DE VARIANTES (TALLAS & COLORES) */}
          <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] space-y-4 shadow-2xs">
            {/* Section Header & Main Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E4DDD2] pb-3">
              <div>
                <span className="font-bold text-[#2F2A25] uppercase text-[11px] tracking-wider block">
                  Configuración de Variantes (Tallas & Colores)
                </span>
                <span className="text-[10px] text-[#756E65]">
                  Haga clic en las tallas y colores que aplican a esta prenda para activarlos
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

                <button
                  type="button"
                  onClick={handleGenerateMatrix}
                  className="px-3.5 py-1.5 rounded-xl bg-[#C2410C] hover:bg-[#9A3412] text-white font-bold text-[11px] shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>+ Generar Combinaciones ({potentialCombinationsCount})</span>
                </button>
              </div>
            </div>

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
                    setVariantes((prev) =>
                      prev.map((v) => ({
                        ...v,
                        codigoBarras: `746${Math.floor(100000000 + Math.random() * 900000000)}`,
                      }))
                    );
                    showToast('Códigos Únicos Generados', 'Se asignó un código único a cada combinación.', 'exito');
                  }}
                  className="px-2.5 py-1 rounded-xl bg-white border border-[#E4DDD2] text-[10px] font-bold text-[#C2410C] hover:bg-[#F6F1E8] transition cursor-pointer flex items-center gap-1 self-start sm:self-auto shadow-2xs"
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
                              <button
                                type="button"
                                onClick={() => setVariantes((prev) => prev.filter((_, i) => i !== idx))}
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
                    Seleccione las tallas y colores arriba y pulse el botón naranja <strong>"+ Generar Combinaciones"</strong> para poblar la matriz de stock.
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

          {/* Sticky Bottom Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-3 border-t border-[#E4DDD2]">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="py-3 px-4 rounded-xl bg-white border border-[#E4DDD2] text-xs font-bold text-[#756E65] hover:bg-[#F6F1E8] hover:text-[#2F2A25] transition cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 px-4 rounded-xl bg-[#2F2A25] text-xs font-bold text-[#FAF8F4] shadow-md hover:bg-[#403932] transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4 text-[#E8DCC8]" />
              <span>
                {saving
                  ? 'Guardando en Google Sheets...'
                  : editingProduct
                  ? 'Guardar Cambios de la Prenda'
                  : 'Guardar Prenda en Catálogo'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
