/**
 * FASE 3.7C — Integración real de Inventario/Kardex/Ajustes manuales.
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * InventoryController.gs), verificada línea por línea antes de escribir
 * este archivo. Contrato confirmado (no inventado):
 *
 *   inventory.kardex -> handleGetKardex(data): acepta un `limit` opcional
 *                        (default 500 en el backend); devuelve
 *                        { success, movements: [...InventoryMovement] }
 *                        ordenados por fecha descendente.
 *   inventory.adjust -> handleAdjustStock({varianteId, cantidadAjuste,
 *                        tipo: 'ENTRADA'|'SALIDA'|'AJUSTE', motivo,
 *                        referencia?}, user): valida permiso
 *                        'inventario.ajustar', variante existente y
 *                        activa, bloquea con LockService, calcula
 *                        nuevoStock = stockActual + cantidadAjuste
 *                        SIEMPRE a partir del stock real (nunca confía en
 *                        un stock absoluto del cliente), rechaza con
 *                        STOCK_INSUFICIENTE si resultaría negativo,
 *                        devuelve { success, message, varianteId,
 *                        stockAnterior, nuevoStock }.
 *
 * El backend es la única fuente de verdad para el stock resultante y el
 * registro de Kardex. Este archivo nunca resta/suma stock localmente ni
 * guarda movimientos como autoridad -- solo envía el delta que el usuario
 * pidió y refleja exactamente lo que el backend confirmó.
 */
import { InventoryMovement } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface AdjustStockPayload {
  varianteId: string;
  cantidadAjuste: number;
  tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
  motivo: string;
  referencia?: string;
}

export interface AdjustStockResult {
  varianteId: string;
  stockAnterior: number;
  nuevoStock: number;
}

class InventoryApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * Historial real de movimientos de Kardex (`inventory.kardex`). No
   * expone más filtros que `limit` porque el backend no soporta ninguno
   * más hoy (handleGetKardex solo lee ese campo de `data`) -- los filtros
   * de InventoryView (tipo, búsqueda) se aplican en el frontend sobre el
   * resultado real ya recibido.
   */
  public async listKardex(limit?: number): Promise<ApiResponse<InventoryMovement[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('inventory.kardex', limit ? { limit } : {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.movements) ? res.data.movements : [];
    return { success: true, message: 'OK', data: raw as InventoryMovement[] };
  }

  /**
   * Ajuste real de stock (`inventory.adjust`). Envía un DELTA
   * (cantidadAjuste), nunca un stock absoluto -- el backend es quien lee
   * el stock actual bajo lock y calcula el resultado. Si el backend
   * rechaza (permiso, variante inactiva, stock insuficiente, etc.), se
   * devuelve el error real y no se asume ningún cambio.
   */
  public async adjust(payload: AdjustStockPayload): Promise<ApiResponse<AdjustStockResult>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('inventory.adjust', payload, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    if (!raw.varianteId || !Number.isFinite(Number(raw.nuevoStock))) {
      return {
        success: false,
        message: 'El backend confirmó el ajuste pero no devolvió un stock resultante válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || 'Stock ajustado exitosamente.',
      data: {
        varianteId: raw.varianteId,
        stockAnterior: Number(raw.stockAnterior),
        nuevoStock: Number(raw.nuevoStock),
      },
    };
  }
}

export const inventoryApi = new InventoryApi();
