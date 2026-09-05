/**
 * FASE 3.7G — Integración real de administración de Usuarios (RBAC).
 *
 * Capa dedicada contra el backend real (ZIO-Google-Backend,
 * AuthController.gs), verificada línea por línea antes de escribir este
 * archivo. Contrato confirmado (no inventado):
 *
 *   auth.listUsers -> handleListUsers(data, user): exige el permiso real
 *                      'admin.usuarios' (Security.requirePermission).
 *                      Devuelve { success, users: [...] } SIN
 *                      password_hash/password_salt -- el backend nunca
 *                      expone contraseñas, ni siquiera hasheadas.
 *   auth.saveUser  -> handleSaveUser(data, currentUser): exige
 *                      'admin.usuarios'. Si `data.id` está presente,
 *                      ACTUALIZA ese usuario; si no, CREA uno nuevo
 *                      (Sequences.getNext('USR')). Campos reales:
 *                      usuario, nombre, apellido, correo, telefono, rol,
 *                      estado, password (opcional). En edición, un
 *                      password vacío/ausente NO cambia la contraseña
 *                      existente (semántica ya soportada explícitamente
 *                      por el backend: `if (data.password && ...)`). En
 *                      creación, si no se envía password, el backend usa
 *                      '123456' por defecto (comportamiento real
 *                      preexistente, no inventado aquí -- ver reporte de
 *                      esta fase). No existe una acción de eliminar
 *                      usuario: la "desactivación" es simplemente
 *                      cambiar `estado` a INACTIVO/BLOQUEADO vía este
 *                      mismo endpoint.
 *
 * Solo ADMIN tiene 'admin.usuarios' en el seed real (GERENTE lo excluye
 * explícitamente). No se inventa ningún control adicional de
 * auto-escalación aquí: el backend ya restringe el acceso completo a este
 * módulo a quien ya sea ADMIN.
 */
import { User } from '../types';
import { storageService } from './storageService';
import { apiService, ApiResponse } from './apiService';

export interface SaveUserPayload {
  id?: string;
  usuario: string;
  nombre: string;
  apellido?: string;
  correo?: string;
  telefono?: string;
  rol: string;
  estado?: string;
  password?: string;
}

function mapUser(raw: any): User {
  return {
    id: raw.id,
    usuario: raw.usuario,
    nombre: raw.nombre,
    apellido: raw.apellido || '',
    correo: raw.correo || '',
    telefono: raw.telefono || '',
    rol: raw.rol,
    estado: raw.estado || 'ACTIVO',
    ultimoAcceso: raw.ultimo_acceso || raw.ultimoAcceso || undefined,
    fechaCreacion: raw.creado_en || raw.fechaCreacion || '',
    avatar: raw.avatar || undefined,
  };
}

class AuthApi {
  private token(): string | null {
    return storageService.getSessionToken();
  }

  /**
   * Lista real de usuarios (`auth.listUsers`). Nunca incluye contraseñas
   * ni hashes -- el backend no los devuelve.
   */
  public async listUsers(): Promise<ApiResponse<User[]>> {
    const token = this.token();
    if (!token) return { success: false, message: 'No hay una sesión activa.', errorCode: 'AUTH_REQUIRED' };

    const res = await apiService.syncWithGoogleAppsScript('auth.listUsers', {}, token);
    if (!res.success) return { success: false, message: res.message, errorCode: res.errorCode };

    const raw = res.data && Array.isArray(res.data.users) ? res.data.users : [];
    return { success: true, message: 'OK', data: raw.map(mapUser) };
  }

  /**
   * Crea o actualiza un usuario real (`auth.saveUser`). Si `payload.id`
   * está presente, actualiza ese usuario; si no, crea uno nuevo. Un
   * `password` vacío/omitido en edición deja la contraseña existente sin
   * cambios -- este método nunca guarda ni cachea la contraseña en
   * ningún lugar del frontend.
   */
  public async saveUser(payload: SaveUserPayload): Promise<ApiResponse<{ userId: string }>> {
    const token = this.token();
    if (!token) {
      return {
        success: false,
        message: 'No hay una sesión activa. Inicie sesión nuevamente antes de guardar el usuario.',
        errorCode: 'AUTH_REQUIRED',
      };
    }

    const res = await apiService.syncWithGoogleAppsScript('auth.saveUser', payload, token);
    if (!res.success) {
      return { success: false, message: res.message, errorCode: res.errorCode };
    }

    const raw = res.data || {};
    if (!raw.userId) {
      return {
        success: false,
        message: 'El backend confirmó la operación pero no devolvió un identificador de usuario válido.',
        errorCode: 'INVALID_BACKEND_RESPONSE',
      };
    }

    return {
      success: true,
      message: res.message || 'Usuario guardado exitosamente.',
      data: { userId: raw.userId },
    };
  }
}

export const authApi = new AuthApi();
