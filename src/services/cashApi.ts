/**
 * FASE 3.6 (corrección de bloqueante — Parte 4) — Integración real de Caja.
 *
 * Antes de este archivo, CashView.tsx llamaba a apiService.openCashSession/
 * closeCashSession/addCashMovement, que operaban 100% sobre localStorage:
 * una venta podía completarse sin que existiera ninguna sesión de caja real
 * en el Spreadsheet, y sales.create simplemente no encontraba el
 * cajaSesionId enviado y omitía el paso de caja en silencio.
 *
 * Este archivo llama directamente a las acciones reales de CashController.gs
 * (cash.getActiveSession, cash.open, cash.close, cash.addMovement),
 * verificadas leyendo el código del backend -- no se inventa ningún campo.
 */
import { CashSession, CashMovement } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

/**
 * El backend devuelve `movimientos` como filas crudas de Caja_Movimientos
 * (snake_case, tipos INGRESO/RETIRO/GASTO/VENTA_EFECTIVO/ABONO_EFECTIVO/
 * DEVOLUCION_EFECTIVO). La tabla "Movimientos Manuales" de CashView solo
 * muestra movimientos manuales (ENTRADA/SALIDA) -- se filtran y mapean
 * aquí, sin tocar CashView.tsx.
 */
function mapMovimientos(raw: any[]): CashMovement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m.tipo === 'INGRESO' || m.tipo === 'RETIRO')
    .map((m) => ({
      id: m.id,
      cajaSesionId: m.caja_sesion_id,
      tipo: (m.tipo === 'INGRESO' ? 'ENTRADA' : 'SALIDA') as any,
      monto: Number(m.monto) || 0,
      motivo: m.motivo || '',
      usuarioId: m.usuario_id,
      usuarioNombre: m.usuario_nombre,
      fecha: m.fecha,
      estado: (m.estado || 'ACTIVO') as any,
    }));
}

/**
 * Mapea la sesión real del backend (camelCase, ver CashController.gs) al
 * tipo CashSession del frontend. Los campos que el backend real NO rastrea
 * todavía (ventasTarjeta/ventasTransferencia/ventasCredito por sesión) se
 * devuelven en 0 -- dato honesto, no inventado -- en vez de omitirse.
 * `entradasEfectivo`/`salidasEfectivo` son los alias de compatibilidad que
 * ya existían en el tipo CashSession, poblados con los mismos valores que
 * ingresosManuales/retirosManuales para que CashView.tsx siga funcionando
 * sin cambios.
 */
function mapCashSession(raw: any): CashSession {
  return {
    id: raw.id,
    codigoCaja: raw.codigoCaja,
    cajaNombre: raw.cajaNombre,
    cajeroId: raw.cajeroId,
    cajeroNombre: raw.cajeroNombre,
    usuarioAperturaNombre: raw.usuarioAperturaNombre,
    montoInicial: Number(raw.montoInicial) || 0,
    fechaApertura: raw.fechaApertura,
    observacionApertura: raw.observacionApertura || '',
    estado: raw.estado,
    ventasEfectivo: Number(raw.ventasEfectivo) || 0,
    abonosEfectivo: Number(raw.abonosEfectivo) || 0,
    ingresosManuales: Number(raw.ingresosManuales) || 0,
    entradasEfectivo: Number(raw.ingresosManuales) || 0,
    retirosManuales: Number(raw.retirosManuales) || 0,
    salidasEfectivo: Number(raw.retirosManuales) || 0,
    gastos: Number(raw.gastos) || 0,
    devolucionesEfectivo: Number(raw.devolucionesEfectivo) || 0,
    ventasTarjeta: 0,
    ventasTransferencia: 0,
    ventasCredito: 0,
    movimientos: mapMovimientos(raw.movimientos),
    efectivoEsperado: Number(raw.efectivoEsperado) || 0,
    efectivoRealContado: raw.efectivoRealContado !== undefined ? Number(raw.efectivoRealContado) : undefined,
    montoCierreReal: raw.efectivoRealContado !== undefined ? Number(raw.efectivoRealContado) : undefined,
    diferencia: raw.diferencia !== undefined ? Number(raw.diferencia) : undefined,
    fechaCierre: raw.fechaCierre || undefined,
    observacionCierre: raw.observacionCierre || undefined,
  };
}

class CashApi {
  private requireToken(): string | null {
    return storageService.getSessionToken();
  }

  public async getActiveSession(): Promise<ApiResponse<CashSession | null>> {
    const token = this.requireToken();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('cash.getActiveSession', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && res.data.activeSession;
    return { success: true, message: 'OK', data: raw ? mapCashSession(raw) : null };
  }

  /**
   * FASE — COPIA DE SEGURIDAD (auditoría "Restaurar Backup JSON"):
   * historial real de sesiones de caja (`cash.listSessions`, ver
   * CashController.handleListSessions -- verificado línea por línea, no
   * inventado). A diferencia de `getActiveSession`, el backend NO incluye
   * aquí el detalle línea por línea de `Caja_Movimientos` de cada sesión
   * (solo los totales ya agregados por sesión: ventasEfectivo,
   * ingresosManuales, retirosManuales, gastos, efectivoEsperado, etc.) --
   * no existe hoy un endpoint de backend para listar Caja_Movimientos en
   * bloque para sesiones cerradas. `mapCashSession` ya maneja con
   * seguridad la ausencia de `movimientos` (ver `mapMovimientos`).
   */
  public async listSessions(): Promise<ApiResponse<CashSession[]>> {
    const token = this.requireToken();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('cash.listSessions', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.sessions) ? res.data.sessions : [];
    return { success: true, message: 'OK', data: raw.map(mapCashSession) };
  }

  /**
   * FASE A — BACKUP PROFESIONAL: historial COMPLETO de Caja_Movimientos
   * (`cash.listMovements`, endpoint nuevo de esta fase -- ver
   * CashController.handleListMovements). Deliberadamente NO reutiliza
   * `mapMovimientos` de arriba -- esa función filtra solo INGRESO/RETIRO
   * y los remapea a ENTRADA/SALIDA para la tabla de "Movimientos
   * Manuales" de CashView. Un backup necesita TODOS los tipos de
   * movimiento tal cual los guarda el backend (incluye VENTA_EFECTIVO,
   * ABONO_EFECTIVO, DEVOLUCION_EFECTIVO, REVERSION_ABONO), sin filtrar ni
   * renombrar nada.
   */
  public async listMovements(): Promise<ApiResponse<CashMovement[]>> {
    const token = this.requireToken();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('cash.listMovements', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.movements) ? res.data.movements : [];
    return {
      success: true,
      message: 'OK',
      data: raw.map((m: any) => ({
        id: m.id,
        cajaSesionId: m.cajaSesionId,
        tipo: m.tipo,
        monto: Number(m.monto) || 0,
        motivo: m.motivo || '',
        categoriaGasto: m.categoriaGasto || undefined,
        referencia: m.referencia || undefined,
        usuarioId: m.usuarioId,
        usuarioNombre: m.usuarioNombre,
        fecha: m.fecha,
        estado: m.estado || 'ACTIVO',
      })),
    };
  }

  public async openSession(data: { montoInicial: number; cajaNombre?: string; observacionApertura?: string }): Promise<ApiResponse<CashSession>> {
    const token = this.requireToken();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('cash.open', data, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.data.message, data: mapCashSession(res.data.session) };
  }

  public async closeSession(data: { efectivoRealContado: number; observacionCierre?: string }): Promise<ApiResponse<{ efectivoEsperado: number; efectivoRealContado: number; diferencia: number }>> {
    const token = this.requireToken();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('cash.close', data, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return {
      success: true,
      message: res.data.message,
      data: {
        efectivoEsperado: Number(res.data.efectivoEsperado) || 0,
        efectivoRealContado: Number(res.data.efectivoRealContado) || 0,
        diferencia: Number(res.data.diferencia) || 0,
      },
    };
  }

  public async addMovement(data: { tipo: 'INGRESO' | 'RETIRO'; monto: number; motivo: string; referencia?: string }): Promise<ApiResponse> {
    const token = this.requireToken();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('cash.addMovement', data, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.data.message };
  }
}

export const cashApi = new CashApi();
