/**
 * FASE 3.6B (corrección de fuente de datos) — Productos/Variantes/
 * Categorías/Tallas/Colores/Proveedores vienen EXCLUSIVAMENTE del
 * backend real (`products.list`, `products.listAuxiliaries`,
 * `products.save`, `products.delete`, verificados contra
 * ProductsController.gs). Este archivo nunca inventa datos ni cae a un
 * catálogo local si el backend devuelve vacío o falla -- eso lo decide
 * quien llama (ProductsView), mostrando vacío o error explícitamente.
 */
import { Product, ProductVariant, Category, Size, Color, Supplier } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

/**
 * FIX P0 (buscador POS / pantalla en blanco): Google Sheets puede devolver
 * un campo declarado como `string` en los tipos (sku, código de barras,
 * talla, color, nombre, marca) como un `number` real si esa celda se
 * guardó/tecleó como numérica -- el tipo TypeScript nunca lo garantiza en
 * runtime. Sin esto, POSView.tsx llamaba `.toLowerCase()` sobre un
 * `number`, lanzaba TypeError durante el render y, al no existir
 * ErrorBoundary, React desmontaba toda la aplicación. `null`/`undefined`
 * se normalizan a cadena vacía, igual que el `|| ''` que ya usaban varios
 * de estos campos.
 */
function toText(value: any): string {
  return value === null || value === undefined ? '' : String(value);
}

export function mapVariant(raw: any): ProductVariant {
  return {
    id: raw.id,
    productoId: raw.productoId,
    sku: toText(raw.sku),
    codigoBarras: toText(raw.codigoBarras),
    color: toText(raw.color),
    talla: toText(raw.talla),
    costo: Number(raw.costo) || 0,
    precio: Number(raw.precio) || 0,
    stock: Number(raw.stock) || 0,
    estado: raw.estado || 'ACTIVO',
  };
}

/**
 * FASE 9 (causa raíz de "s.trim is not a function" en ProductFormModal --
 * generación de matriz de variantes): el mismo problema que ya documenta
 * `toText()` arriba (Google Sheets puede devolver una celda que "parece
 * número" -- ej. una talla "38" -- como `number` real, no como el `string`
 * que declara el tipo) también afecta a `Tallas.nombre`/`Colores.nombre`,
 * el catálogo de opciones que alimenta `ProductFormModal` vía
 * `products.listAuxiliaries`. El FIX P0 original solo se aplicó a
 * `mapProduct`/`mapVariant` (usados por `products.list`) -- nunca se
 * extendió a este endpoint, que hasta ahora devolvía `raw.sizes`/
 * `raw.colors` sin pasar por ningún mapeo. Se reutiliza exactamente el
 * mismo `toText()` ya establecido, sin inventar una normalización nueva.
 */
export function mapSize(raw: any): Size {
  return {
    id: raw.id,
    nombre: toText(raw.nombre),
    orden: Number(raw.orden) || 0,
  };
}

export function mapColor(raw: any): Color {
  return {
    id: raw.id,
    nombre: toText(raw.nombre),
    hex: toText(raw.hex),
  };
}

// CORREGIR AUDITORÍA: exportado para que DataStoreContext.hydrateFromBootstrap
// pueda aplicar exactamente la misma transformación de campos que ya usa
// productsApi.list(), en vez de duplicar la lógica o guardar el bundle
// crudo de system.getBootstrapData sin mapear (como hacía antes
// AuthContext.fetchAndApplyBootstrap).
export function mapProduct(raw: any): Product {
  return {
    id: raw.id,
    sku: toText(raw.sku),
    codigoBarras: toText(raw.codigoBarras),
    nombre: toText(raw.nombre),
    descripcion: raw.descripcion || '',
    categoriaId: raw.categoriaId,
    categoriaNombre: raw.categoriaNombre || '',
    marca: toText(raw.marca),
    proveedorId: raw.proveedorId || undefined,
    costo: Number(raw.costo) || 0,
    precio: Number(raw.precio) || 0,
    precioEspecial: raw.precioEspecial ? Number(raw.precioEspecial) : undefined,
    impuesto: Number(raw.impuesto) || 0,
    descuentoMaximo: raw.descuentoMaximo ? Number(raw.descuentoMaximo) : 0,
    stockMinimo: Number(raw.stockMinimo) || 0,
    estado: raw.estado || 'ACTIVO',
    imagenUrl: raw.imagenUrl || undefined,
    // FASE (normalización comercial -- variantes opcionales): pasa tal
    // cual (incluyendo `undefined` para productos guardados antes de esta
    // fase) -- ProductFormModal decide cómo inferir el estado del
    // checkbox cuando no viene definido, nunca se asume aquí.
    tieneVariantes: raw.tieneVariantes,
    variantes: Array.isArray(raw.variantes) ? raw.variantes.map(mapVariant) : [],
    fechaCreacion: raw.creadoEn || '',
  };
}

export interface ProductAuxiliaries {
  categories: Category[];
  sizes: Size[];
  colors: Color[];
  suppliers: Supplier[];
}

class ProductsApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  public async list(): Promise<ApiResponse<Product[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('products.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.products) ? res.data.products : [];
    return { success: true, message: 'OK', data: raw.map(mapProduct) };
  }

  public async listAuxiliaries(): Promise<ApiResponse<ProductAuxiliaries>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('products.listAuxiliaries', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    return {
      success: true,
      message: 'OK',
      data: {
        categories: Array.isArray(raw.categories) ? raw.categories : [],
        sizes: Array.isArray(raw.sizes) ? raw.sizes.map(mapSize) : [],
        colors: Array.isArray(raw.colors) ? raw.colors.map(mapColor) : [],
        suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : [],
      },
    };
  }

  public async save(data: {
    id?: string;
    nombre: string;
    categoriaId: string;
    descripcion?: string;
    marca?: string;
    codigoBarras?: string;
    precio?: number;
    costo?: number;
    imagenUrl?: string;
    stockMinimo?: number;
    // FASE (normalización comercial -- variantes opcionales): se envía
    // `data` tal cual a `products.save` -- el backend ya acepta cualquier
    // clave nueva sin romper nada (mismo mecanismo genérico de siempre).
    tieneVariantes?: boolean;
    variantes: Array<{
      id?: string;
      sku?: string;
      codigoBarras?: string;
      color?: string;
      talla?: string;
      costo?: number;
      precio?: number;
      stock?: number;
      estado?: string;
    }>;
  }): Promise<ApiResponse<{ productId: string }>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('products.save', data, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.data.message, data: { productId: res.data.productId } };
  }

  public async remove(productId: string): Promise<ApiResponse> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('products.delete', { id: productId }, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.data.message };
  }

  /**
   * FIX (fotos de productos -- auditoría aprobada): sube una imagen real a
   * Google Drive (`products.uploadImage`, ver ProductsController.gs) y
   * devuelve la URL resultante. `imageDataUrl` es el Data URL Base64
   * completo tal como lo produce `FileReader.readAsDataURL()` -- ese
   * Base64 viaja únicamente en el body de esta petición, nunca se guarda
   * en Google Sheets. `ProductFormModal` es quien decide cuándo llamar
   * esto (solo si el usuario seleccionó/cambió una foto), nunca en cada
   * guardado.
   */
  public async uploadImage(imageDataUrl: string): Promise<ApiResponse<{ imageUrl: string }>> {
    const token = this.token();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de subir la imagen.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('products.uploadImage', { imageDataUrl }, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    if (!raw.imageUrl) {
      return {
        success: false,
        message: 'El backend confirmó la subida pero no devolvió una URL de imagen válida.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || 'Imagen subida exitosamente.',
      data: { imageUrl: raw.imageUrl },
    };
  }
}

export const productsApi = new ProductsApi();
