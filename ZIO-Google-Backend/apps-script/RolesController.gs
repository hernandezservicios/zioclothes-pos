/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: RolesController.gs
 * Description: Administración de permisos de VISTA por rol (Roles_Permisos).
 *
 * AUDITORÍA (TAREA — SISTEMA DE PERMISOS DE VISTAS POR ROL) — hasta esta
 * fase no existía ningún endpoint para LEER o ESCRIBIR `Roles_Permisos`
 * desde el frontend (verificado: cero referencias a esta hoja en Main.gs
 * antes de este archivo) -- el catálogo de permisos vivía únicamente
 * sembrado por SeedSetup.gs y consultado de solo lectura por
 * Security.hasPermission/AuthController.handleLogin. Este controlador
 * agrega la primera superficie de administración real, exclusiva para
 * el permiso 'admin.roles' (ya existente, solo lo tiene ADMIN en el seed
 * real -- GERENTE lo excluye explícitamente).
 *
 * Diseño (separación VER vista vs. ACCIÓN funcional, requisito central de
 * esta fase): `Roles_Permisos.permisos_json` sigue siendo el ÚNICO
 * arreglo de permisos por rol -- NO se crea una segunda tabla/columna
 * paralela para "permisos de vista". Los nuevos códigos `vista.<id>` (uno
 * por cada `AppView` real de App.tsx) conviven en el MISMO arreglo que los
 * permisos funcionales ya existentes (ventas.ver, caja.abrir, etc.) --
 * Security.hasPermission/AuthContext.hasPermission ya funcionan sin
 * ningún cambio para estos códigos nuevos, porque ambos solo hacen
 * `permissions.includes(code)` sobre ese mismo arreglo.
 *
 * `handleUpdateRolePermissions` actualiza EXCLUSIVAMENTE las entradas que
 * empiezan con `vista.` dentro de `permisos_json`: reemplaza ese
 * subconjunto por el enviado, pero preserva intacto cualquier permiso
 * funcional existente (todo lo que no empieza con `vista.`). Esto hace
 * estructuralmente imposible que esta pantalla nueva borre por accidente
 * un permiso funcional -- nunca toca esas entradas.
 */

const RolesController = {
  /**
   * Lista los 5 roles reales (o los que existan en la hoja) con su
   * arreglo de permisos ya parseado. Uso: pantalla "Roles y Permisos" /
   * "Acceso a Vistas" en Configuración.
   */
  handleListRoles(user) {
    Security.requirePermission(user, 'admin.roles');
    const rows = DbHelper.getAllRows('Roles_Permisos');

    const roles = rows.map(r => {
      let permisos = [];
      try {
        const parsed = JSON.parse(r.permisos_json || '[]');
        if (Array.isArray(parsed)) permisos = parsed;
      } catch (e) {
        // permisos_json corrupto en esta fila -- se reporta vacío en vez
        // de lanzar, para no bloquear la lectura de los demás roles.
        permisos = [];
      }
      return {
        rol: r.rol,
        nombre: r.nombre || r.rol,
        descripcion: r.descripcion || '',
        permisos: permisos
      };
    });

    return { success: true, roles: roles };
  },

  /**
   * Actualiza SOLO los permisos `vista.*` de un rol. `data.rol` identifica
   * la fila (clave real de Roles_Permisos, no tiene columna `id`).
   * `data.vistas` es el arreglo COMPLETO de códigos `vista.*` deseados
   * para ese rol (lo que el checkbox de cada vista representa en la UI) --
   * cualquier `vista.*` que ya estuviera en `permisos_json` y no venga en
   * este arreglo se considera desmarcado y se retira; todo permiso que
   * NO empiece con `vista.` (funcional) permanece exactamente igual.
   *
   * Protección explícita (Fase 17): el rol ADMIN nunca se acepta aquí --
   * `Security.hasPermission`/`AuthContext.hasPermission` ya le dan bypass
   * total sin mirar `permisos_json`, así que editar su fila no tendría
   * ningún efecto real y solo podría confundir a quien la edite pensando
   * que restringió a un administrador.
   */
  handleUpdateRolePermissions(data, user) {
    Security.requirePermission(user, 'admin.roles');

    const rol = data && data.rol ? String(data.rol).trim() : '';
    if (!rol) {
      throw new Error('VALIDATION_ERROR: Debe especificar el rol a actualizar.');
    }
    if (rol === 'ADMIN') {
      throw new Error('VALIDATION_ERROR: El rol ADMIN siempre tiene acceso total y no se puede editar desde aquí.');
    }
    const vistasNuevas = Array.isArray(data.vistas) ? data.vistas.map(v => String(v)) : [];
    const invalida = vistasNuevas.find(v => v.indexOf('vista.') !== 0);
    if (invalida !== undefined) {
      throw new Error(`VALIDATION_ERROR: '${invalida}' no es un código de permiso de vista válido (debe empezar con 'vista.').`);
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const rows = DbHelper.getAllRows('Roles_Permisos');
      const roleRow = rows.find(r => String(r.rol).trim() === rol);
      if (!roleRow) {
        throw new Error(`VALIDATION_ERROR: El rol '${rol}' no existe en Roles_Permisos.`);
      }

      let current;
      try {
        current = JSON.parse(roleRow.permisos_json || '[]');
        if (!Array.isArray(current)) throw new Error('no es un arreglo');
      } catch (e) {
        throw new Error(`VALIDATION_ERROR: El permiso_json actual del rol '${rol}' está corrupto -- no se modifica para evitar perder datos. Requiere revisión manual.`);
      }

      // Preserva TODO lo que no es vista.* (permisos funcionales intactos)
      // y reemplaza únicamente el subconjunto vista.* por el nuevo.
      const funcionales = current.filter(p => String(p).indexOf('vista.') !== 0);
      const merged = funcionales.concat(vistasNuevas);

      DbHelper.updateRowByKey('Roles_Permisos', 'rol', rol, { permisos_json: JSON.stringify(merged) });

      AuditController.log(
        user,
        'ROLE_VIEW_PERMISSIONS_UPDATED',
        'ADMINISTRACION',
        'Rol',
        rol,
        `Permisos de vista actualizados para el rol ${rol}: ${vistasNuevas.join(', ') || '(ninguno)'}`
      );

      return {
        success: true,
        message: `Permisos de vista del rol ${rol} actualizados correctamente.`,
        rol: rol,
        permisos: merged
      };
    });
  }
};
