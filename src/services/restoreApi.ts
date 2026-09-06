/**
 * FASE B — Restauración real del backup JSON en Google Sheets.
 *
 * Capa dedicada contra las dos acciones nuevas de RestoreController.gs
 * (`system.previewRestoreBackup`, `system.restoreBackup`), verificadas
 * línea por línea antes de escribir este archivo -- no se inventa ningún
 * campo. El backend SIEMPRE re-valida el JSON recibido desde cero
 * (nunca confía en `validateBackupFile` del frontend, que solo existe
 * para dar una respuesta rápida en pantalla antes de gastar una llamada
 * de red).
 *
 * Nota sobre respuestas de fallo: `apiService.syncWithGoogleAppsScript`
 * descarta cualquier campo de la respuesta que no sea success/message/
 * errorCode cuando `success:false` -- por eso RestoreController.gs
 * siempre construye un `message` autodescriptivo y completo (nunca
 * depende de que `errors`/`rolledBack`/`critical` sobrevivan el viaje).
 * Este archivo detecta esos escenarios por el CONTENIDO del mensaje
 * (prefijos ya establecidos por el propio backend), no por campos que
 * pueden perderse en el camino.
 */
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';
import { BackupFile } from '../components/settings/SettingsView';

export interface RestorePreviewResult {
  valid: boolean;
  backupVersion?: number;
  createdAt?: string;
  totalRecords?: number;
  entities?: { key: string; count: number }[];
  warnings: string[];
  errors: string[];
}

export interface RestoreExecutionResult {
  totalRecords: number;
  entities: { key: string; label: string; critical: boolean; count: number }[];
  sequencesRecalculated: { prefix: string; before: number; after: number; changed: boolean }[];
}

class RestoreApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * `system.previewRestoreBackup` -- SOLO lectura/validación, nunca
   * escribe nada. Se usa para mostrar un resumen confiable (verificado
   * por el backend, no solo por el frontend) antes del modal de
   * confirmación.
   */
  public async preview(backup: BackupFile): Promise<ApiResponse<RestorePreviewResult>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('system.previewRestoreBackup', { backup }, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    return {
      success: true,
      message: 'OK',
      data: {
        valid: raw.valid === true,
        backupVersion: raw.backupVersion,
        createdAt: raw.createdAt,
        totalRecords: raw.totalRecords,
        entities: raw.entities,
        warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
        errors: Array.isArray(raw.errors) ? raw.errors : [],
      },
    };
  }

  /**
   * `system.restoreBackup` -- la operación REAL y destructiva. El
   * backend genera su propio backup preventivo, adquiere un lock único,
   * re-valida todo, ejecuta la restauración, recalcula Sequences y
   * audita -- este método solo envía el backup y refleja exactamente lo
   * que el backend confirmó, nunca asume éxito.
   */
  public async restore(backup: BackupFile): Promise<ApiResponse<RestoreExecutionResult>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('system.restoreBackup', { backup }, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    return {
      success: true,
      message: raw.message || 'Backup restaurado correctamente.',
      data: {
        totalRecords: Number(raw.totalRecords) || 0,
        entities: Array.isArray(raw.entities) ? raw.entities : [],
        sequencesRecalculated: Array.isArray(raw.sequencesRecalculated) ? raw.sequencesRecalculated : [],
      },
    };
  }
}

export const restoreApi = new RestoreApi();
