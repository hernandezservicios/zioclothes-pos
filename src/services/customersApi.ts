/**
 * FASE 3.6B (corrección de fuente de datos) — Clientes vienen
 * EXCLUSIVAMENTE del backend real (`customers.list`, `customers.save`,
 * verificados contra CustomersController.gs). Nunca se inventa un
 * fallback local si el backend devuelve vacío o falla.
 *
 * `customers.list` ya devuelve `saldoPendiente`/`creditoDisponible`
 * calculados server-side desde `Creditos` real -- se exponen aquí como
 * campos adicionales (CustomerWithCredit) para que CustomersView los use
 * directamente, en vez de recalcular una deuda a partir de datos locales.
 */
import { Customer } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface CustomerWithCredit extends Customer {
  saldoPendiente: number;
  creditoDisponible: number;
}

// CORREGIR AUDITORÍA: exportado para que DataStoreContext.hydrateFromBootstrap
// aplique la misma transformación que customersApi.list(), en vez de
// guardar el bundle crudo de system.getBootstrapData sin mapear.
export function mapCustomer(raw: any): CustomerWithCredit {
  return {
    id: raw.id,
    nombre: raw.nombre,
    apellido: raw.apellido || '',
    documento: raw.documento || '',
    telefono: raw.telefono || '',
    correo: raw.correo || '',
    direccion: raw.direccion || '',
    ciudad: raw.ciudad || '',
    limiteCredito: Number(raw.limiteCredito) || 0,
    diasCreditoPorDefecto: Number(raw.diasCreditoPorDefecto) || 15,
    notas: raw.notas || undefined,
    estado: raw.estado || 'ACTIVO',
    fechaCreacion: raw.creadoEn || '',
    saldoPendiente: Number(raw.saldoPendiente) || 0,
    creditoDisponible: Number(raw.creditoDisponible) || 0,
  };
}

class CustomersApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  public async list(): Promise<ApiResponse<CustomerWithCredit[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('customers.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.customers) ? res.data.customers : [];
    return { success: true, message: 'OK', data: raw.map(mapCustomer) };
  }

  public async save(data: {
    id?: string;
    nombre: string;
    apellido?: string;
    documento?: string;
    telefono: string;
    correo?: string;
    direccion?: string;
    ciudad?: string;
    limiteCredito?: number;
    diasCreditoPorDefecto?: number;
    notas?: string;
    estado?: string;
  }): Promise<ApiResponse<{ customerId: string }>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('customers.save', data, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    return { success: true, message: res.data.message, data: { customerId: res.data.customerId } };
  }
}

export const customersApi = new CustomersApi();
