/**
 * TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL.
 *
 * Capa dedicada contra el backend real (RolesController.gs, verificado
 * línea por línea antes de escribir este archivo -- mismo criterio que
 * authApi.ts/restoreApi.ts). Contrato confirmado (no inventado):
 *
 *   roles.list             -> handleListRoles(user): exige 'admin.roles'.
 *                              Devuelve { success, roles: [{ rol, nombre,
 *                              descripcion, permisos: string[] }] } --
 *                              `permisos` ya viene parseado (incluye TODO
 *                              el arreglo real, funcionales + vista.*).
 *   roles.updatePermissions -> handleUpdateRolePermissions(data, user):
 *                              exige 'admin.roles'. `data.vistas` es el
 *                              arreglo COMPLETO de códigos `vista.*`
 *                              deseados para ese rol -- el backend
 *                              reemplaza únicamente ese subconjunto
 *                              dentro de `permisos_json`, preservando
 *                              intactos todos los permisos funcionales.
 *                              Rechaza el rol 'ADMIN' (VALIDATION_ERROR)
 *                              y cualquier código que no empiece con
 *                              'vista.' (también VALIDATION_ERROR).
 *
 * Solo ADMIN tiene 'admin.roles' en el seed real (GERENTE lo excluye
 * explícitamente, igual que el resto de admin.*).
 */
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface RolePermissions {
  rol: string;
  nombre: string;
  descripcion: string;
  permisos: string[];
}

class RolesApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /** Lista real de roles con su arreglo de permisos completo ya parseado. */
  public async list(): Promise<ApiResponse<RolePermissions[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('roles.list', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.roles) ? res.data.roles : [];
    const roles: RolePermissions[] = raw.map((r: any) => ({
      rol: r.rol,
      nombre: r.nombre || r.rol,
      descripcion: r.descripcion || '',
      permisos: Array.isArray(r.permisos) ? r.permisos : [],
    }));
    return { success: true, message: 'OK', data: roles };
  }

  /**
   * Reemplaza el subconjunto `vista.*` de un rol por `vistas` (arreglo
   * COMPLETO de códigos `vista.<id>` deseados, no un delta) -- cualquier
   * `vista.*` ya presente que no venga en este arreglo se considera
   * desmarcado. Nunca toca permisos funcionales. Nunca acepta 'ADMIN'.
   */
  public async updateViewPermissions(rol: string, vistas: string[]): Promise<ApiResponse<{ permisos: string[] }>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('roles.updatePermissions', { rol, vistas }, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    return {
      success: true,
      message: res.message || 'Permisos de vista actualizados correctamente.',
      data: { permisos: Array.isArray(raw.permisos) ? raw.permisos : [] },
    };
  }

  /**
   * `system.migrateViewPermissions` -- backfill idempotente (Fase 14) de
   * los `vista.*` que le falten por completo a cada rol estándar, para
   * instalaciones que ya tenían `Roles_Permisos` sembrada ANTES de esta
   * tarea. Herramienta de UNA SOLA DIRECCIÓN: solo agrega lo que esté
   * totalmente ausente -- nunca quita ni repone un `vista.*` que un ADMIN
   * ya haya desmarcado deliberadamente después vía "Acceso a Vistas"
   * (ver comentario del mismo nombre en SeedSetup.gs). Exige 'admin.roles'.
   */
  public async applyViewPermissionDefaults(): Promise<
    ApiResponse<{ rolesUpdated: { rol: string; permisosAgregados: string[] }[]; rolesUnchanged: string[] }>
  > {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('system.migrateViewPermissions', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data || {};
    return {
      success: true,
      message: res.message || 'Migración completada.',
      data: {
        rolesUpdated: Array.isArray(raw.rolesUpdated) ? raw.rolesUpdated : [],
        rolesUnchanged: Array.isArray(raw.rolesUnchanged) ? raw.rolesUnchanged : [],
      },
    };
  }
}

export const rolesApi = new RolesApi();
