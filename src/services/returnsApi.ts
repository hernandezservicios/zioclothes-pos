/**
 * FASE 3.7F — Integración real de Devoluciones.
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * ReturnsController.gs), verificada línea por línea antes de escribir
 * este archivo. Contrato confirmado (no inventado):
 *
 *   returns.list   -> handleListReturns(data): ignora `data` por
 *                      completo (sin filtros server-side, igual que
 *                      sales.list/credits.list/purchases.list/
 *                      expenses.list); devuelve
 *                      { success, returns: [...ReturnRecord] }.
 *   returns.create -> handleCreateReturn({ventaId, items:
 *                      [{varianteId, cantidad}], motivo,
 *                      tipoReembolso?}, user): valida permiso
 *                      'devoluciones.crear', bloquea con LockService,
 *                      recalcula AUTORITATIVAMENTE cada línea a partir de
 *                      Venta_Items real de la venta original (precio,
 *                      descuento e impuesto de lo que el cliente
 *                      realmente pagó, nunca lo que este payload
 *                      declare), valida que la cantidad a devolver no
 *                      exceda vendida-ya_devuelta (rechaza con
 *                      DEVOLUCION_EXCEDE_CANTIDAD), reintegra stock,
 *                      registra Kardex tipo DEVOLUCION, y -- YA
 *                      INTERNAMENTE, en la MISMA transacción -- si
 *                      tipoReembolso === 'EFECTIVO' actualiza la caja
 *                      ABIERTA actual (Cajas.devoluciones_efectivo +
 *                      Caja_Movimientos tipo DEVOLUCION_EFECTIVO), y si
 *                      la venta original tiene cuenta por cobrar
 *                      (cuenta_cobrar_id) reduce su saldo -- esto último
 *                      ocurre SIEMPRE que exista esa cuenta,
 *                      independientemente de tipoReembolso (ver
 *                      ReturnsController.gs líneas ~250-269; documentado
 *                      en el reporte de esta fase). Devuelve
 *                      { success, message, devolucionId, montoDevuelto }.
 *
 * NO existe `returns.void` en Main.gs/ReturnsController.gs -- no se
 * inventa. El frontend nunca debe llamar cashApi.addMovement() ni tocar
 * storageService.getCredits()/saveCredits() para una devolución: el
 * backend ya integra caja y crédito atómicamente.
 */
import { ReturnRecord } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface CreateReturnPayload {
  ventaId: string;
  items: Array<{ varianteId: string; cantidad: number }>;
  motivo: string;
  tipoReembolso?: string;
}

class ReturnsApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * Historial real de devoluciones (`returns.list`). No acepta filtros:
   * el backend no los soporta hoy (handleListReturns ignora `data`) --
   * los filtros de ReturnsView se aplican en el frontend sobre el
   * resultado real completo.
   */
  public async list(): Promise<ApiResponse<ReturnRecord[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('returns.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.returns) ? res.data.returns : [];
    return { success: true, message: 'OK', data: raw as ReturnRecord[] };
  }

  /**
   * Procesa una devolución real (`returns.create`). Solo se envía
   * ventaId/varianteId/cantidad/motivo/tipoReembolso -- nunca un total,
   * subtotal, descuento, impuesto, costo o stock resultante: el backend
   * recalcula todo eso desde la venta original real.
   */
  public async create(payload: CreateReturnPayload): Promise<ApiResponse<{ devolucionId: string; montoDevuelto: number }>> {
    const token = this.token();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de procesar la devolución.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('returns.create', payload, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    if (!raw.devolucionId || !Number.isFinite(Number(raw.montoDevuelto))) {
      return {
        success: false,
        message: 'El backend confirmó la devolución pero no devolvió un identificador/monto válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || `Devolución ${raw.devolucionId} procesada.`,
      data: { devolucionId: raw.devolucionId, montoDevuelto: Number(raw.montoDevuelto) },
    };
  }
}

export const returnsApi = new ReturnsApi();
