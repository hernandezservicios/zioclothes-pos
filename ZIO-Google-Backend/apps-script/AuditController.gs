/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: AuditController.gs
 * Description: Immutable audit logging and traceability of sensitive system operations.
 */

const AuditController = {
  /**
   * Records an audit log entry in the 'Auditoria' sheet.
   * Safe to call without throwing fatal errors that interrupt business flow.
   *
   * @param {Object} user - Current user object
   * @param {string} accion - e.g. 'LOGIN', 'SALE_CREATED', 'SALE_VOIDED', 'STOCK_ADJUSTED'
   * @param {string} modulo - e.g. 'AUTH', 'VENTAS', 'INVENTARIO', 'CAJA', 'CREDITOS'
   * @param {string} entidad - e.g. 'Sale', 'ProductVariant', 'CashSession'
   * @param {string} entidadId - ID of affected entity
   * @param {string} descripcion - Human-readable description
   * @param {string} [detalle] - Optional detailed technical payload or diff
   * @param {string} [resultado='EXITO'] - 'EXITO' | 'FALLO'
   */
  log(user, accion, modulo, entidad, entidadId, descripcion, detalle = '', resultado = 'EXITO') {
    try {
      const entry = {
        id: 'AUD-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900),
        fecha: getNowFormatted(),
        usuario_id: user ? (user.id || user.userId || 'SISTEMA') : 'SISTEMA',
        usuario_nombre: user ? (`${user.nombre || ''} ${user.apellido || ''}`).trim() || user.usuario || 'Sistema' : 'Sistema',
        usuario_rol: user ? (user.rol || 'SYSTEM') : 'SYSTEM',
        accion: accion,
        modulo: modulo,
        entidad: entidad,
        entidad_id: entidadId || '',
        descripcion: descripcion || '',
        detalle: typeof detalle === 'object' ? JSON.stringify(detalle) : String(detalle || ''),
        resultado: resultado
      };

      DbHelper.insertRow('Auditoria', entry);
    } catch (e) {
      Logger.log('[Audit ERROR] No se pudo escribir en Auditoria: ' + e.message);
    }
  },

  /**
   * Action handler: list audit logs.
   * @param {Object} data - { limit, modulo, usuarioId }
   * @param {Object} user
   * @returns {Object} { logs: Array }
   */
  handleList(data, user) {
    Security.requirePermission(user, 'auditoria.ver');
    const limit = (data && data.limit) ? Number(data.limit) : 200;
    const all = DbHelper.getAllRows('Auditoria');

    // Sort descending by fecha
    all.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    const paged = all.slice(0, limit);

    return {
      success: true,
      logs: paged
    };
  }
};
