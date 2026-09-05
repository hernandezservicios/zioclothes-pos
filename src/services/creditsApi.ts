/**
 * FASE 3.7B — Integración real de Créditos/Abonos.
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * CreditsController.gs), verificada línea por línea antes de escribir
 * este archivo. Contrato confirmado (no inventado):
 *
 *   credits.list         -> handleListCredits(data): ignora `data` por
 *                            completo (sin filtros server-side, igual que
 *                            sales.list); devuelve
 *                            { success, credits: [...AccountReceivable
 *                            con abonos: PaymentInstallment[] embebidos] }.
 *   credits.registerAbono -> handleRegisterAbono({cuentaCobrarId, monto,
 *                            metodoPago?, referencia?, observaciones?,
 *                            cajaSesionId?}, user): valida permiso
 *                            'abonos.crear', bloquea con LockService,
 *                            valida saldo/estado server-side, devuelve
 *                            { success, message, reciboId, numeroRecibo,
 *                            saldoRestante, estadoCuenta } -- NO devuelve
 *                            el objeto PaymentInstallment completo.
 *   credits.voidAbono     -> handleVoidAbono({abonoId, motivo}, user):
 *                            valida permiso 'creditos.anular_abonos',
 *                            revierte saldo y caja, devuelve
 *                            { success, message }.
 *
 * El backend es la única fuente de verdad para saldo pendiente, monto
 * máximo de abono, estado de la cuenta y efecto en caja. Este archivo
 * nunca recalcula ni decide esas cosas -- solo envía lo que el usuario
 * pidió y refleja exactamente lo que el backend confirmó.
 */
import { AccountReceivable, PaymentInstallment, PaymentMethodType } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface RegisterAbonoPayload {
  cuentaCobrarId: string;
  monto: number;
  metodoPago?: PaymentMethodType;
  referencia?: string;
  observaciones?: string;
  cajaSesionId?: string;
}

class CreditsApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * Historial real de cuentas por cobrar con sus abonos embebidos
   * (`credits.list`). No acepta filtros: el backend no los soporta hoy
   * (handleListCredits ignora `data`) -- inventar un parámetro de filtro
   * daría una falsa sensación de filtrado server-side. Los filtros de
   * CreditsView/InstallmentsView se aplican en el frontend sobre el
   * resultado real completo.
   */
  public async list(): Promise<ApiResponse<AccountReceivable[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('credits.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.credits) ? res.data.credits : [];
    return { success: true, message: 'OK', data: raw as AccountReceivable[] };
  }

  /**
   * Registra un abono real (`credits.registerAbono`). El backend valida
   * saldo/estado/permiso y es quien decide el saldo restante final -- este
   * método NUNCA resta el monto del saldo localmente. La respuesta del
   * backend no trae el recibo completo (solo identificadores + saldo
   * resultante), así que el objeto PaymentInstallment que se retorna aquí
   * para el comprobante se arma combinando esos identificadores
   * autoritativos con los datos que el propio formulario ya tenía --
   * nunca se inventa un monto o saldo distinto al que el backend aceptó.
   */
  public async registerAbono(
    payload: RegisterAbonoPayload,
    creditSnapshot: { clienteId: string; clienteNombre: string; ventaId?: string; numeroVenta?: string }
  ): Promise<ApiResponse<PaymentInstallment>> {
    const token = this.token();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de registrar el abono.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('credits.registerAbono', payload, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    const reciboId: string = raw.reciboId;
    const numeroRecibo: string = raw.numeroRecibo;
    const saldoRestante: number = Number(raw.saldoRestante);

    if (!reciboId || !numeroRecibo || !Number.isFinite(saldoRestante)) {
      return {
        success: false,
        message: 'El backend confirmó el abono pero no devolvió un identificador/saldo válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    const currentUser = storageService.getCurrentUser();
    // saldoAnterior no viene en la respuesta de credits.registerAbono; se
    // deriva matemáticamente de dos valores ya confirmados por el backend
    // (saldoRestante real + monto real aceptado), nunca inventado.
    const saldoAnterior = Math.round((saldoRestante + payload.monto) * 100) / 100;
    const installment: PaymentInstallment = {
      id: reciboId,
      numeroRecibo,
      cuentaCobrarId: payload.cuentaCobrarId,
      clienteId: creditSnapshot.clienteId,
      clienteNombre: creditSnapshot.clienteNombre,
      ventaId: creditSnapshot.ventaId,
      numeroVenta: creditSnapshot.numeroVenta,
      saldoAnterior,
      montoAbonado: payload.monto,
      saldoRestante,
      metodoPago: payload.metodoPago || 'EFECTIVO',
      referencia: payload.referencia,
      cajaSesionId: payload.cajaSesionId,
      usuarioId: currentUser?.id || '',
      usuarioNombre: currentUser ? `${currentUser.nombre} ${currentUser.apellido || ''}`.trim() : '',
      observaciones: payload.observaciones,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      estado: 'ACTIVO',
    };

    return {
      success: true,
      message: res.message || `Abono registrado con recibo ${numeroRecibo}.`,
      data: installment,
    };
  }

  /**
   * Anula un abono real (`credits.voidAbono`). El backend valida el
   * permiso 'creditos.anular_abonos', restaura el saldo de la cuenta y
   * revierte el efecto en caja si corresponde -- nunca se simula
   * localmente.
   */
  public async voidAbono(abonoId: string, motivo: string): Promise<ApiResponse<{ message: string }>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('credits.voidAbono', { abonoId, motivo }, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.data?.message || 'Abono anulado.', data: { message: res.data?.message } };
  }
}

export const creditsApi = new CreditsApi();
