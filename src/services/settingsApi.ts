/**
 * FASE 3.7H — Integración real de Configuración Empresarial (Settings).
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * SettingsController.gs), verificada línea por línea antes de escribir
 * este archivo. Contrato confirmado (no inventado):
 *
 *   system.getSettings    -> handleGetSettings(): acción PÚBLICA (no
 *                             exige sessionToken, ver Main.gs
 *                             `publicActions`). Devuelve
 *                             { success, settings: {...} } leyendo la
 *                             hoja `Configuracion` (clave/valor) y
 *                             completando con defaults razonables para
 *                             cualquier clave todavía no guardada.
 *   system.updateSettings -> handleUpdateSettings(data, user): exige
 *                             sesión + permiso real 'admin.configuracion'.
 *                             Crea o actualiza una fila de `Configuracion`
 *                             por cada clave del objeto `data` recibido
 *                             (upsert genérico por clave=valor). Devuelve
 *                             { success, message }.
 *
 * IMPORTANTE -- nombres de campo reales del backend, verificados en
 * SettingsController.gs/SeedSetup.gs (NO inventados): `nombreNegocio`,
 * `rnc`, `telefono`, `direccion`, `impuestoPorcentaje` coinciden por
 * nombre con los mismos campos ya establecidos en el tipo `SystemSettings`
 * del frontend. Dos campos usan un nombre DISTINTO a cada lado, aunque
 * representan el mismo concepto:
 *   backend `moneda`      <-> frontend `simboloMoneda` (símbolo monetario)
 *   backend `pieTicket`   <-> frontend `mensajeTicketPie` (mensaje al pie)
 * Este archivo traduce explícitamente entre ambos nombres en las dos
 * direcciones, para no duplicar la configuración bajo dos claves
 * distintas en la misma hoja de Sheets. El resto de los campos que
 * backend/frontend puedan tener (`politicaDevolucion`,
 * `permitirVentaSinStock`, `modoConexion`, etc.) no se tocan ni se
 * inventan aquí.
 *
 * FASE 4 (textos del recibo -- auditoría): `eslogan` ya existía en
 * `SystemSettings` y ya se usaba correctamente en ReceiptTicket.tsx/
 * InstallmentReceiptTicket.tsx (`{settings.eslogan && ...}`), pero nunca
 * viajaba hacia/desde el backend -- en la práctica se comportaba como una
 * constante fija del frontend. Se agrega aquí con el MISMO nombre a ambos
 * lados (no requería traducción, igual que `logoUrl`). `mensajeFinalRecibo`
 * y `pieTecnicoRecibo` son campos nuevos (antes texto fijo dentro del
 * propio componente del recibo) -- mismo nombre a ambos lados también.
 */
import { SystemSettings } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface BusinessSettingsFields {
  nombreNegocio?: string;
  rnc?: string;
  telefono?: string;
  direccion?: string;
  simboloMoneda?: string;
  impuestoPorcentaje?: number;
  mensajeTicketPie?: string;
  // FASE 3 (logo de empresa): mismo nombre a ambos lados (backend y
  // frontend) -- a diferencia de moneda/pieTicket, no necesita traducción.
  logoUrl?: string;
  // FASE 4 (textos del recibo): mismo nombre a ambos lados, sin traducción.
  eslogan?: string;
  mensajeFinalRecibo?: string;
  pieTecnicoRecibo?: string;
}

/**
 * Traduce el objeto `settings` real devuelto por system.getSettings/
 * system.getBootstrapData (mismos nombres de campo, misma función backend
 * handleGetSettings) a los nombres ya usados por SystemSettings en el
 * frontend. Se usa tanto en settingsApi.get() como en el merge de
 * bootstrap de AuthContext, para no tener dos mapeos divergentes.
 */
export function mapBackendSettingsToFrontend(raw: any): BusinessSettingsFields {
  if (!raw || typeof raw !== 'object') return {};
  const mapped: BusinessSettingsFields = {};
  if (raw.nombreNegocio !== undefined) mapped.nombreNegocio = raw.nombreNegocio;
  if (raw.rnc !== undefined) mapped.rnc = raw.rnc;
  if (raw.telefono !== undefined) mapped.telefono = raw.telefono;
  if (raw.direccion !== undefined) mapped.direccion = raw.direccion;
  if (raw.moneda !== undefined) mapped.simboloMoneda = raw.moneda;
  if (raw.impuestoPorcentaje !== undefined) mapped.impuestoPorcentaje = Number(raw.impuestoPorcentaje);
  if (raw.pieTicket !== undefined) mapped.mensajeTicketPie = raw.pieTicket;
  if (raw.logoUrl !== undefined) mapped.logoUrl = raw.logoUrl;
  if (raw.eslogan !== undefined) mapped.eslogan = raw.eslogan;
  if (raw.mensajeFinalRecibo !== undefined) mapped.mensajeFinalRecibo = raw.mensajeFinalRecibo;
  if (raw.pieTecnicoRecibo !== undefined) mapped.pieTecnicoRecibo = raw.pieTecnicoRecibo;
  return mapped;
}

/** Traduce en sentido inverso, solo para las claves realmente presentes. */
function mapFrontendFieldsToBackend(fields: BusinessSettingsFields): Record<string, any> {
  const payload: Record<string, any> = {};
  if (fields.nombreNegocio !== undefined) payload.nombreNegocio = fields.nombreNegocio;
  if (fields.rnc !== undefined) payload.rnc = fields.rnc;
  if (fields.telefono !== undefined) payload.telefono = fields.telefono;
  if (fields.direccion !== undefined) payload.direccion = fields.direccion;
  if (fields.simboloMoneda !== undefined) payload.moneda = fields.simboloMoneda;
  if (fields.impuestoPorcentaje !== undefined) payload.impuestoPorcentaje = fields.impuestoPorcentaje;
  if (fields.mensajeTicketPie !== undefined) payload.pieTicket = fields.mensajeTicketPie;
  if (fields.logoUrl !== undefined) payload.logoUrl = fields.logoUrl;
  if (fields.eslogan !== undefined) payload.eslogan = fields.eslogan;
  if (fields.mensajeFinalRecibo !== undefined) payload.mensajeFinalRecibo = fields.mensajeFinalRecibo;
  if (fields.pieTecnicoRecibo !== undefined) payload.pieTecnicoRecibo = fields.pieTecnicoRecibo;
  return payload;
}

class SettingsApi {
  /**
   * Configuración empresarial real (`system.getSettings`). Es una acción
   * pública en el backend (no exige sesión) -- se envía el token si
   * existe, sin bloquear la petición si no lo hay.
   */
  public async get(): Promise<ApiResponse<BusinessSettingsFields>> {
    const token = storageService.getSessionToken() || undefined;
    const res = await apiService.syncWithGoogleAppsScript('system.getSettings', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && res.data.settings ? res.data.settings : {};
    return { success: true, message: 'OK', data: mapBackendSettingsToFrontend(raw) };
  }

  /**
   * Guarda configuración empresarial real (`system.updateSettings`).
   * Exige sesión real; el backend valida el permiso 'admin.configuracion'.
   * Solo se envían los campos realmente provistos (traducidos a los
   * nombres reales del backend) -- nunca el objeto SystemSettings
   * completo con campos que el backend no conoce.
   */
  public async save(fields: BusinessSettingsFields): Promise<ApiResponse<{ message: string }>> {
    const token = storageService.getSessionToken();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de guardar la configuración.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const payload = mapFrontendFieldsToBackend(fields);
    const res = await apiService.syncWithGoogleAppsScript('system.updateSettings', payload, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    return { success: true, message: res.message || 'Configuración actualizada exitosamente.', data: { message: res.message } };
  }

  /**
   * FASE 3 (logo de empresa -- reutiliza infraestructura de Drive de
   * productos): sube el logo real a Google Drive (`settings.uploadLogo`,
   * ver SettingsController.handleUploadLogo) y devuelve la URL resultante.
   * `imageDataUrl` es el Data URL Base64 completo tal como lo produce
   * `FileReader.readAsDataURL()` -- viaja únicamente en el body de esta
   * petición, nunca se guarda en Sheets. Mismo contrato que
   * `productsApi.uploadImage()`; quien llama decide cuándo invocar esto
   * (solo si el usuario seleccionó/cambió un logo) y cuándo llamar
   * después a `save({ logoUrl })` con la URL resultante.
   */
  public async uploadLogo(imageDataUrl: string): Promise<ApiResponse<{ imageUrl: string }>> {
    const token = storageService.getSessionToken();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de subir el logo.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('settings.uploadLogo', { imageDataUrl }, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    if (!raw.imageUrl) {
      return {
        success: false,
        message: 'El backend confirmó la subida pero no devolvió una URL de logo válida.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || 'Logo subido exitosamente.',
      data: { imageUrl: raw.imageUrl },
    };
  }
}

export const settingsApi = new SettingsApi();
