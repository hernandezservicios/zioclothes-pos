/**
 * FASE 3.6 — Integración real de ventas/POS.
 *
 * Capa dedicada de ventas contra el backend real (ZIO-Google-Backend,
 * acción `sales.create`). Reutiliza la capa API existente
 * (apiService.syncWithGoogleAppsScript) en vez de hacer fetch directo,
 * tal como pide la Parte 6.
 *
 * El backend es la única fuente de verdad para stock, numeración de venta
 * y validación de crédito (ver SalesController.gs -- LockService +
 * transacción con rollback de compensación). Este archivo NUNCA calcula ni
 * decide esas cosas: solo envía lo que el usuario armó en el carrito y
 * refleja exactamente lo que el backend confirmó.
 *
 * FASE 7 (integración operativa de Créditos a Favor / Notas de Crédito en
 * el POS): `creditoFavorAplicado` es opcional -- si el cajero aplicó un
 * saldo a favor del cliente como parte del pago, se envía junto con una
 * línea `{metodo:'CREDITO_FAVOR', monto}` dentro de `pagos` (con el MISMO
 * monto exacto, el backend lo exige). El backend relee/revalida el saldo,
 * la pertenencia al cliente y el estado del crédito dentro del mismo
 * candado/transacción de la venta -- nunca se confía en lo que declare
 * este payload para decidir el resultado, solo para intentarlo.
 */
import { Sale, SaleItem, SalePaymentSplit, PaymentMethodType } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface CreateSalePayload {
  clienteId?: string;
  clienteNombre: string;
  clienteDocumento?: string;
  vendedorId: string;
  vendedorNombre: string;
  cajaSesionId?: string;
  items: SaleItem[];
  subtotal: number;
  descuentoTotal: number;
  impuestoTotal: number;
  total: number;
  metodoPago: PaymentMethodType;
  pagos: SalePaymentSplit[];
  efectivoRecibido?: number | string;
  cambioEntregado?: number;
  esCredito: boolean;
  montoFinanciado?: number;
  // FIX (regresión "el plazo del cliente siempre se imponía"): plazo de
  // crédito elegido explícitamente para ESTA venta en el modal de Cobro
  // (7/15/30/45/60 días) -- el backend lo prioriza sobre el plazo
  // predeterminado del cliente (SalesController.handleCreateSale), que
  // solo se usa como respaldo si aquí no se envía nada.
  diasPlazo?: number;
  aplicarImpuesto: boolean;
  // FASE 7: si el POS aplicó un Crédito a Favor/Nota de Crédito a esta
  // venta, el backend exige que `monto` coincida EXACTAMENTE con la suma
  // de las líneas de `pagos` cuyo `metodo` sea 'CREDITO_FAVOR' (ver
  // SalesController.handleCreateSale) -- nunca se envía uno sin el otro.
  creditoFavorAplicado?: { id: string; monto: number };
}

class SalesApi {
  /**
   * Envía la venta al backend real (`sales.create`). Requiere una sesión
   * real activa (sessionToken de auth.login) -- si no existe, ni siquiera
   * se intenta la petición de red.
   *
   * IMPORTANTE: `sales.create` en el backend NO devuelve el objeto Sale
   * completo, solo { success, message, saleId, numeroVenta, cuentaCobrarId }
   * (ver SalesController.gs y API.md). El objeto Sale que se retorna aquí
   * para el recibo/ticket se construye combinando esos identificadores
   * server-autoritativos con los datos que el propio carrito ya tenía --
   * nunca se inventan montos: son exactamente los que el backend aceptó
   * (no los rechazó ni los recalculó a otro valor; si lo hubiera hecho,
   * habría devuelto success:false).
   */
  public async createSale(payload: CreateSalePayload): Promise<ApiResponse<Sale>> {
    const token = storageService.getSessionToken();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de cobrar.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('sales.create', payload, token);

    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    const saleId: string = raw.saleId;
    const numeroVenta: string = raw.numeroVenta;

    if (!saleId || !numeroVenta) {
      // El backend dijo success:true pero no devolvió los identificadores
      // esperados -- no hay forma segura de construir un recibo válido.
      return {
        success: false,
        message: 'El backend confirmó la venta pero no devolvió un identificador válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    const sale: Sale = {
      id: saleId,
      numeroVenta,
      clienteId: payload.clienteId,
      clienteNombre: payload.clienteNombre,
      clienteDocumento: payload.clienteDocumento,
      vendedorId: payload.vendedorId,
      vendedorNombre: payload.vendedorNombre,
      cajaSesionId: payload.cajaSesionId,
      items: payload.items,
      subtotal: payload.subtotal,
      descuentoTotal: payload.descuentoTotal,
      impuestoTotal: payload.impuestoTotal,
      total: payload.total,
      costoTotal: payload.items.reduce((acc, i) => acc + i.costoUnitario * i.cantidad, 0),
      metodoPago: payload.metodoPago,
      pagos: payload.pagos,
      efectivoRecibido:
        payload.efectivoRecibido !== undefined ? Number(payload.efectivoRecibido) : undefined,
      cambioEntregado: payload.cambioEntregado,
      esCredito: payload.esCredito,
      montoFinanciado: payload.montoFinanciado,
      cuentaCobrarId: raw.cuentaCobrarId || undefined,
      estado: 'COMPLETADA',
      // El backend no devuelve la fecha exacta de creación en sales.create;
      // se usa la hora local del cliente solo como aproximación de
      // visualización en el recibo, nunca como registro autoritativo.
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      creditoFavorAplicado: raw.creditoFavorAplicado || undefined,
    };

    return {
      success: true,
      message: res.message || `Venta ${numeroVenta} procesada exitosamente.`,
      data: sale,
    };
  }

  /**
   * FASE 3.7A — Historial real de ventas (`sales.list`, ver
   * SalesController.handleListSales). El backend devuelve TODAS las
   * ventas enriquecidas con sus items; hoy no acepta ningún filtro
   * server-side (handleListSales ignora por completo el segundo
   * parámetro `data`) -- por eso este método no expone parámetros de
   * filtro todavía: inventar un parámetro que el backend no usa daría una
   * falsa sensación de filtrado server-side. Los filtros de SalesView se
   * aplican en el frontend sobre el arreglo real ya recibido.
   */
  public async list(): Promise<ApiResponse<Sale[]>> {
    const token = storageService.getSessionToken();
    if (!token) {
      return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };
    }

    const res = await apiService.syncWithGoogleAppsScript('sales.list', {}, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data && Array.isArray(res.data.sales) ? res.data.sales : [];
    return { success: true, message: 'OK', data: raw as Sale[] };
  }

  /**
   * FASE 3.7A — Anulación real de venta (`sales.void`, ver
   * SalesController.handleVoidSale). El backend exige `saleId` y `motivo`,
   * valida el permiso `ventas.anular`, restaura stock, cancela el crédito
   * asociado si existe y marca la venta como ANULADA (nunca la borra
   * físicamente). Si el backend rechaza -- por permiso, estado inválido u
   * otra razón -- se devuelve el error real, nunca se asume éxito.
   */
  public async void(saleId: string, motivo: string): Promise<ApiResponse<{ message: string }>> {
    const token = storageService.getSessionToken();
    if (!token) {
      return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };
    }

    const res = await apiService.syncWithGoogleAppsScript('sales.void', { saleId, motivo }, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    return { success: true, message: res.data?.message || 'Venta anulada.', data: { message: res.data?.message } };
  }
}

export const salesApi = new SalesApi();
