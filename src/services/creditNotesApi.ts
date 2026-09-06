/**
 * FASE 6 — Créditos a Favor / Vales y Notas de Crédito.
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * CreditNotesController.gs), siguiendo el mismo patrón ya usado por
 * creditsApi.ts/returnsApi.ts. Contrato confirmado (no inventado):
 *
 *   creditNotes.list  -> handleListCreditNotes(data): filtros opcionales
 *                         { clienteId?, tipo? }, devuelve
 *                         { success, creditNotes: [...CreditNote] } con
 *                         `aplicaciones` ya embebidas por crédito.
 *   creditNotes.apply -> handleApplyCreditNote({creditoFavorId, ventaId,
 *                         monto}, user): exige 'creditos_favor.aplicar',
 *                         LockService, relee el saldo real antes de
 *                         aplicar (nunca confía en un saldo cacheado).
 *                         Devuelve { success, message, creditoFavorId,
 *                         numero, montoAplicado, saldoRestante, estado }.
 *   creditNotes.void  -> handleVoidCreditNote({creditoFavorId, motivo},
 *                         user): exige 'creditos_favor.anular'. Bloquea
 *                         con NO_ANULABLE si el crédito ya tiene algún
 *                         monto aplicado -- nunca revierte ventas
 *                         automáticamente. Nunca borra la fila, solo
 *                         cambia estado a ANULADA.
 *
 * Un Crédito a Favor/Vale (tipo VALE_TIENDA) y una Nota de Crédito (tipo
 * NOTA_CREDITO) son la MISMA entidad de backend (Creditos_Favor),
 * distinguida por `tipo` -- ver decisión documentada en el reporte de
 * Fase 6. Este servicio, y la pantalla que lo consume, tratan ambos
 * como una sola fuente de datos filtrable por tipo.
 */
import { CreditNote } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

class CreditNotesApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  public async list(filters?: { clienteId?: string; tipo?: 'VALE_TIENDA' | 'NOTA_CREDITO' }): Promise<ApiResponse<CreditNote[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('creditNotes.list', filters || {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.creditNotes) ? res.data.creditNotes : [];
    return { success: true, message: 'OK', data: raw as CreditNote[] };
  }

  public async apply(payload: { creditoFavorId: string; ventaId: string; monto: number }): Promise<ApiResponse<{
    creditoFavorId: string;
    numero: string;
    montoAplicado: number;
    saldoRestante: number;
    estado: string;
  }>> {
    const token = this.token();
    if (!token) {
      return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };
    }

    const res = await apiService.syncWithGoogleAppsScript('creditNotes.apply', payload, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    return {
      success: true,
      message: res.message || 'Crédito aplicado exitosamente.',
      data: {
        creditoFavorId: raw.creditoFavorId,
        numero: raw.numero,
        montoAplicado: Number(raw.montoAplicado) || 0,
        saldoRestante: Number(raw.saldoRestante) || 0,
        estado: raw.estado,
      },
    };
  }

  public async void(creditoFavorId: string, motivo: string): Promise<ApiResponse> {
    const token = this.token();
    if (!token) {
      return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };
    }

    const res = await apiService.syncWithGoogleAppsScript('creditNotes.void', { creditoFavorId, motivo }, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.message || 'Anulado exitosamente.' };
  }
}

export const creditNotesApi = new CreditNotesApi();
