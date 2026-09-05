/**
 * FASE 3.7E — Integración real de Gastos Operativos + su efecto en Caja.
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * ExpensesController.gs), verificada línea por línea antes de escribir
 * este archivo. Contrato confirmado (no inventado):
 *
 *   expenses.list   -> handleListExpenses(data): ignora `data` por
 *                       completo (sin filtros server-side, igual que
 *                       sales.list/credits.list/purchases.list); devuelve
 *                       { success, expenses: [...Expense] }.
 *   expenses.create -> handleCreateExpense({categoria, descripcion,
 *                       proveedor?, monto, metodoPago, comprobante?,
 *                       pagadoConCajaActiva?}, user): valida permiso
 *                       'gastos.crear', bloquea con LockService, valida
 *                       monto > 0, y -- HALLAZGO CLAVE de esta fase --
 *                       YA INTEGRA CAJA INTERNAMENTE dentro de la MISMA
 *                       transacción (beginTx/rollback): si
 *                       metodoPago === 'EFECTIVO' (o pagadoConCajaActiva
 *                       === true), busca la caja ABIERTA actual, le
 *                       incrementa el campo `gastos` (ya restado en la
 *                       fórmula de efectivoEsperado de CashController) y
 *                       registra un Caja_Movimientos con tipo 'GASTO'
 *                       (NO 'RETIRO'). Si no hay caja abierta, registra el
 *                       gasto igual, simplemente sin efecto en caja
 *                       (nunca rechaza la operación por eso). Devuelve
 *                       { success, message, gastoId }.
 *
 * IMPORTANTE: como el backend ya integra caja atómicamente, este archivo
 * NUNCA debe complementarse con una llamada separada a
 * cashApi.addMovement() -- eso duplicaría el efecto en caja (doble
 * descuento). Ver ExpensesView.tsx para la explicación completa de este
 * hallazgo.
 */
import { Expense } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface CreateExpensePayload {
  categoria: string;
  descripcion: string;
  proveedor?: string;
  monto: number;
  metodoPago: string;
  comprobante?: string;
}

function mapExpense(raw: any): Expense {
  return {
    id: raw.id,
    numeroGasto: raw.numeroGasto,
    categoria: raw.categoria,
    categoriaNombre: raw.categoria,
    descripcion: raw.descripcion,
    proveedor: raw.proveedor || undefined,
    monto: Number(raw.monto) || 0,
    metodoPago: raw.metodoPago,
    comprobante: raw.comprobante || undefined,
    cajaSesionId: raw.cajaSesionId || undefined,
    usuarioId: raw.usuarioId,
    usuarioNombre: raw.usuarioNombre,
    fecha: raw.fecha,
    pagadoConCajaActiva: !!raw.pagadoConCajaActiva,
  };
}

class ExpensesApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * Historial real de gastos operativos (`expenses.list`). No acepta
   * filtros: el backend no los soporta hoy (handleListExpenses ignora
   * `data`) -- los filtros de ExpensesView se aplican en el frontend
   * sobre el resultado real completo.
   */
  public async list(): Promise<ApiResponse<Expense[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('expenses.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.expenses) ? res.data.expenses : [];
    return { success: true, message: 'OK', data: raw.map(mapExpense) };
  }

  /**
   * Registra un gasto real (`expenses.create`). El backend decide por sí
   * mismo si afecta la caja activa (según metodoPago === 'EFECTIVO') y lo
   * hace en la misma transacción -- este método nunca llama
   * cashApi.addMovement() por separado.
   */
  public async create(payload: CreateExpensePayload): Promise<ApiResponse<{ gastoId: string }>> {
    const token = this.token();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de registrar el gasto.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('expenses.create', payload, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    if (!raw.gastoId) {
      return {
        success: false,
        message: 'El backend confirmó el gasto pero no devolvió un identificador válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || `Gasto ${raw.gastoId} registrado.`,
      data: { gastoId: raw.gastoId },
    };
  }
}

export const expensesApi = new ExpensesApi();
