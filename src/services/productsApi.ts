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

export function mapVariant(raw: any): ProductVariant {
  return {
    id: raw.id,
    productoId: raw.productoId,
    sku: raw.sku,
    codigoBarras: raw.codigoBarras || '',
    color: raw.color,
    talla: raw.talla,
    costo: Number(raw.costo) || 0,
    precio: Number(raw.precio) || 0,
    stock: Number(raw.stock) || 0,
    estado: raw.estado || 'ACTIVO',
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
    sku: raw.sku,
    codigoBarras: raw.codigoBarras || '',
    nombre: raw.nombre,
    descripcion: raw.descripcion || '',
    categoriaId: raw.categoriaId,
    categoriaNombre: raw.categoriaNombre || '',
    marca: raw.marca || '',
    proveedorId: raw.proveedorId || undefined,
    costo: Number(raw.costo) || 0,
    precio: Number(raw.precio) || 0,
    precioEspecial: raw.precioEspecial ? Number(raw.precioEspecial) : undefined,
    impuesto: Number(raw.impuesto) || 0,
    descuentoMaximo: raw.descuentoMaximo ? Number(raw.descuentoMaximo) : 0,
    stockMinimo: Number(raw.stockMinimo) || 0,
    estado: raw.estado || 'ACTIVO',
    imagenUrl: raw.imagenUrl || undefined,
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
        sizes: Array.isArray(raw.sizes) ? raw.sizes : [],
        colors: Array.isArray(raw.colors) ? raw.colors : [],
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
}

export const productsApi = new ProductsApi();
