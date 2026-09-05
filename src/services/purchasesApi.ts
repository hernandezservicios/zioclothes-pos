/**
 * FASE 3.7D — Integración real de Compras/Recepción de Inventario.
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * PurchasesController.gs), verificada línea por línea antes de escribir
 * este archivo. Contrato confirmado (no inventado):
 *
 *   purchases.list   -> handleListPurchases(data): ignora `data` por
 *                        completo (sin filtros server-side, igual que
 *                        sales.list/credits.list); devuelve
 *                        { success, purchases: [...Purchase] }.
 *   purchases.create -> handleCreatePurchase({proveedor, proveedorId?,
 *                        numeroFacturaProveedor?, items: [{varianteId,
 *                        cantidad, costoUnitario, nombreProducto?}],
 *                        total, formaPago?, notas?}, user): valida
 *                        permiso 'compras.crear', bloquea con
 *                        LockService, valida variante existente/activa,
 *                        cantidad y costoUnitario > 0, RECALCULA el total
 *                        server-side a partir de cantidad×costoUnitario
 *                        (rechaza con PURCHASE_TOTAL_MISMATCH si no
 *                        coincide), incrementa Variantes.stock, registra
 *                        Kardex tipo COMPRA. Devuelve
 *                        { success, message, compraId, total }.
 *
 * IMPORTANTE (ver reporte FASE 3.7D): el backend real NO actualiza
 * Variantes.costo al recibir una compra -- no existe una regla de costo
 * promedio ponderado definida en el sistema. Este archivo no inventa ese
 * comportamiento ni lo simula localmente.
 *
 * El backend es la única fuente de verdad para el total y el stock
 * resultante. Este archivo nunca sustituye/recalcula esos valores; solo
 * envía lo que el usuario capturó (incluido el costoUnitario negociado,
 * un dato base legítimo) y refleja exactamente lo que el backend
 * confirmó.
 */
import { Purchase, PurchaseItem } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface CreatePurchasePayload {
  proveedor: string;
  proveedorId?: string;
  numeroFacturaProveedor?: string;
  items: Array<{
    varianteId: string;
    cantidad: number;
    costoUnitario: number;
    nombreProducto?: string;
  }>;
  total: number;
  formaPago?: string;
  notas?: string;
}

class PurchasesApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * Historial real de compras (`purchases.list`). No acepta filtros: el
   * backend no los soporta hoy (handleListPurchases ignora `data`) -- los
   * filtros de PurchasesView se aplican en el frontend sobre el
   * resultado real completo.
   */
  public async list(): Promise<ApiResponse<Purchase[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('purchases.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.purchases) ? res.data.purchases : [];
    return { success: true, message: 'OK', data: raw as Purchase[] };
  }

  /**
   * Registra una compra real (`purchases.create`). El backend recalcula
   * el total a partir de cantidad×costoUnitario por línea y es quien
   * decide el stock resultante -- este método nunca calcula un total
   * "definitivo" propio ni asume que el backend aceptará el total que se
   * envía (se envía únicamente porque el backend lo usa como verificación
   * de manipulación/errores de cálculo, comparándolo contra el suyo).
   */
  public async create(payload: CreatePurchasePayload): Promise<ApiResponse<{ compraId: string; total: number }>> {
    const token = this.token();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de registrar la compra.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('purchases.create', payload, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    if (!raw.compraId || !Number.isFinite(Number(raw.total))) {
      return {
        success: false,
        message: 'El backend confirmó la compra pero no devolvió un identificador/total válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || `Compra ${raw.compraId} registrada.`,
      data: { compraId: raw.compraId, total: Number(raw.total) },
    };
  }
}

export const purchasesApi = new PurchasesApi();
