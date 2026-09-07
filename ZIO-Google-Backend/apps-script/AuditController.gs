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
   *
   * AUDITORÍA (restauración -- Objetivo B): `entidad`/`modulo` son
   * filtros opcionales y aditivos -- si se omiten, el comportamiento es
   * IDÉNTICO al de antes (100% retrocompatible con cualquier llamador
   * existente). Se agregan para permitir consultar de forma barata y
   * segura (misma acción `audit.list`, sin endpoint nuevo) solo los
   * registros de un tipo concreto -- p.ej. `entidad: 'Backup'`, la única
   * entidad que RestoreController.gs usa al auditar restauraciones --
   * sin depender de que estén entre los últimos `limit` registros
   * globales de TODA la auditoría (ventas, clientes, etc. intercalados).
   * @param {Object} data - { limit, modulo, entidad, usuarioId }
   * @param {Object} user
   * @returns {Object} { logs: Array }
   */
  handleList(data, user) {
    Security.requirePermission(user, 'auditoria.ver');
    const limit = (data && data.limit) ? Number(data.limit) : 200;
    let all = DbHelper.getAllRows('Auditoria');

    if (data && data.entidad) {
      const entidadFilter = String(data.entidad).trim();
      all = all.filter(r => String(r.entidad || '').trim() === entidadFilter);
    }
    if (data && data.modulo) {
      const moduloFilter = String(data.modulo).trim();
      all = all.filter(r => String(r.modulo || '').trim() === moduloFilter);
    }

    // Orden descendente por fecha y, ante fechas idénticas (misma
    // resolución de segundo de `getNowFormatted()`, perfectamente posible
    // si dos acciones se auditan en el mismo segundo -- p.ej. una
    // restauración cuya recalculación de Secuencias falla registra dos
    // veces 'RESTORE_BACKUP' seguidas), por orden real de inserción en la
    // hoja (`Auditoria` siempre se escribe con `appendRow`/`insertRow`,
    // así que `_rowNumber` ya es cronológico). Sin este desempate, un
    // `Array.sort` estable con fechas iguales dejaría el registro MÁS
    // VIEJO primero en vez del más reciente -- justo el caso que
    // `restoreApi.getLastBackupAuditEntry()` necesita distinguir.
    all.sort((a, b) => {
      const byFecha = String(b.fecha || '').localeCompare(String(a.fecha || ''));
      if (byFecha !== 0) return byFecha;
      return (Number(b._rowNumber) || 0) - (Number(a._rowNumber) || 0);
    });
    const paged = all.slice(0, limit);

    return {
      success: true,
      logs: paged
    };
  }
};
