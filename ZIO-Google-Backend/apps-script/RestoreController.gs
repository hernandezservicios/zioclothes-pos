/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: RestoreController.gs
 * Description: FASE B — Restauración real de un backup JSON (formato zio-pos-backup,
 * ver SettingsView.tsx/FASE A) hacia Google Sheets. READ-ONLY hasta la fase de
 * escritura; nunca confía en la validación ya hecha por el frontend.
 *
 * ============================================================
 * AUDITORÍA PREVIA (antes de escribir una sola línea de este archivo)
 * ============================================================
 * Se leyó completo: DbHelper.gs, LockServiceHelper.gs, Sequences.gs,
 * Security.gs, AuditController.gs, Main.gs, y los controladores de cada
 * entidad restaurable. Hallazgo CRÍTICO que determina todo el diseño de
 * abajo:
 *
 *   El motor de compensación de DbHelper (beginTx/recordInsert/
 *   recordUpdate/rollback) SOLO sabe deshacer un INSERT (borrando la fila)
 *   o un UPDATE (restaurando los valores previos) -- NO EXISTE ninguna
 *   acción de compensación para un DELETE. "Restaurar" exige por
 *   definición reemplazar el estado actual (eliminar lo que no pertenece
 *   al backup), así que un rollback real de un DELETE sería
 *   indispensable si se borrara fila por fila -- y esa pieza
 *   sencillamente no existe hoy en DbHelper.
 *
 * En vez de inventar una segunda infraestructura transaccional a nivel de
 * FILA (lo que el enunciado de esta fase prohíbe explícitamente), se
 * diseñó una estrategia a nivel de HOJA que nunca necesita compensar un
 * DELETE de datos reales:
 *
 *   1. STAGING: para cada entidad, se crea una hoja nueva y vacía
 *      (ej. "Ventas__STAGE_<txId>") y se escriben ahí TODAS las filas
 *      restauradas con DbHelper.insertRows (inserción por lotes, rápida).
 *      Mientras este paso no termine para TODAS las entidades, ninguna
 *      hoja real fue tocada -- un fallo aquí se soluciona borrando las
 *      hojas de staging ya creadas, sin ningún riesgo para los datos
 *      reales.
 *   2. BACKUP PREVENTIVO: para cada entidad, se duplica la hoja real
 *      actual con Sheet.copyTo() (característica nativa de Apps Script)
 *      y se renombra a "Ventas__PRERESTORE_<txId>". Esto ES el backup
 *      preventivo exigido por esta fase -- vive dentro del mismo
 *      Spreadsheet (nunca en PropertiesService: su límite real es de
 *      unos 9KB por propiedad / ~500KB en total, muy por debajo de lo
 *      que ocupa cualquier backup real de este sistema -- ver sección
 *      "LÍMITES REALES" más abajo), y NUNCA se sube a otro sitio ni a
 *      localStorage.
 *   3. SWAP: recién aquí se toca la hoja real -- se borra (ya existe su
 *      copia de seguridad del paso 2) y se renombra la hoja de staging al
 *      nombre real. Es la ÚNICA fase genuinamente destructiva, y es
 *      deliberadamente la más simple y rápida (operaciones de metadatos,
 *      nunca reescritura de datos) -- si algo falla a mitad de este paso,
 *      el rollback es acotado: renombrar de vuelta las copias de
 *      seguridad de las entidades ya intercambiadas, y borrar las hojas
 *      de staging de las que no llegaron a intercambiarse.
 *
 * Las hojas "__PRERESTORE_" NO se borran automáticamente tras un éxito --
 * quedan como red de seguridad manual (ver Parte 5 del reporte).
 *
 * ============================================================
 * LÍMITES REALES DE APPS SCRIPT (auditados, no asumidos)
 * ============================================================
 *  - PropertiesService: ~9KB por propiedad, ~500KB en total -- INVIABLE
 *    para el JSON de un backup real (por eso el backup preventivo es una
 *    hoja copiada, nunca una Property).
 *  - Ejecución de un Web App (doPost): tope de tiempo de ejecución de
 *    Apps Script (del orden de varios minutos, variable según cuota) --
 *    una restauración con un volumen de datos extremadamente grande
 *    podría excederlo. El diseño de arriba minimiza este riesgo
 *    colocando todo el trabajo LENTO (miles de filas) en la fase seguro
 *    (staging, antes de tocar nada real) y dejando la fase RÁPIDA
 *    (renombrar/borrar metadatos de hoja) como la única destructiva. Aun
 *    así, un volumen extremo puede fallar por tiempo -- se documenta como
 *    límite real, no se inventa streaming/progreso que Apps Script no
 *    soporta.
 *  - No hay progreso real dentro de una sola invocación síncrona de
 *    doPost -- el frontend solo puede mostrar estados discretos antes/
 *    después de la llamada, nunca un progreso continuo real.
 */

// snake_case -> camelCase, exactamente la convención ya usada en TODOS
// los controladores de este backend (verificado leyendo cada handleListX
// antes de escribir esto -- nunca una excepción encontrada).
function restoreSnakeToCamel_(s) {
  return String(s).replace(/_([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
}

// Columnas realmente numéricas por hoja (auditado contra SCHEMAS de
// SeedSetup.gs y cada handleListX) -- se fuerza Number(...) al escribir
// para que un valor que llegó como string desde el JSON (el mismo riesgo
// de Google Sheets ya documentado en el resto del proyecto) nunca quede
// guardado como texto, evitando reintroducir la clase de bug de
// concatenación numérica ya corregida en el Dashboard.
const RESTORE_NUMERIC_COLUMNS = {
  Productos: ['costo', 'precio', 'precio_especial', 'impuesto', 'descuento_maximo', 'stock_minimo'],
  Variantes: ['costo', 'precio', 'stock'],
  Clientes: ['limite_credito', 'dias_credito_por_defecto'],
  Ventas: ['subtotal', 'descuento_total', 'impuesto_total', 'total', 'costo_total', 'efectivo_recibido', 'cambio_entregado', 'monto_financiado'],
  Venta_Items: ['cantidad', 'costo_unitario', 'precio_unitario', 'descuento_porcentaje', 'descuento_monto', 'subtotal', 'impuesto_monto', 'total'],
  Creditos: ['monto_original', 'monto_pagado', 'saldo_pendiente', 'dias_plazo'],
  Abonos: ['saldo_anterior', 'monto_abonado', 'saldo_restante'],
  Cajas: ['monto_inicial', 'ventas_efectivo', 'abonos_efectivo', 'ingresos_manuales', 'retiros_manuales', 'gastos', 'devoluciones_efectivo', 'efectivo_esperado', 'efectivo_real_contado', 'diferencia'],
  Caja_Movimientos: ['monto'],
  Gastos: ['monto'],
  Compras: ['total'],
  Devoluciones: ['monto_devuelto'],
  Creditos_Favor: ['monto_original', 'monto_aplicado', 'saldo_disponible'],
  Creditos_Favor_Aplicaciones: ['monto'],
  Inventario_Kardex: ['cantidad', 'stock_anterior', 'stock_nuevo']
};

/**
 * Convierte un arreglo de objetos camelCase (tal como vienen en
 * backup.data.<entidad>) al formato de filas snake_case que espera la
 * hoja real, usando SOLO las columnas que la hoja realmente tiene
 * (DbHelper.getHeaders) -- cualquier campo calculado que no sea una
 * columna real (ej. Cliente.saldoPendiente/creditoDisponible) se ignora
 * automáticamente porque nunca se busca esa columna.
 * @param {string} sheetName
 * @param {Array<Object>} camelArray
 * @param {Object} [overrides] - { columnaSnake: function(obj){return valor;} }
 */
function restoreMapGeneric_(sheetName, camelArray, overrides) {
  const headers = DbHelper.getHeaders(sheetName);
  const numericCols = RESTORE_NUMERIC_COLUMNS[sheetName] || [];
  const list = Array.isArray(camelArray) ? camelArray : [];
  return list.map(function (obj) {
    const row = {};
    headers.forEach(function (col) {
      let val;
      if (overrides && overrides[col]) {
        val = overrides[col](obj);
      } else {
        val = obj[restoreSnakeToCamel_(col)];
      }
      if (numericCols.indexOf(col) !== -1) {
        val = Number(val) || 0;
      }
      row[col] = val;
    });
    return row;
  });
}

/**
 * Aplana un campo hijo anidado (ej. Product.variantes, Sale.items,
 * Credit.abonos, CreditNote.aplicaciones) en filas para su propia hoja.
 */
function restoreFlattenChildren_(parentArray, childKey, childSheetName) {
  const headers = DbHelper.getHeaders(childSheetName);
  const numericCols = RESTORE_NUMERIC_COLUMNS[childSheetName] || [];
  const out = [];
  (Array.isArray(parentArray) ? parentArray : []).forEach(function (parent) {
    const children = Array.isArray(parent[childKey]) ? parent[childKey] : [];
    children.forEach(function (child) {
      const row = {};
      headers.forEach(function (col) {
        let val = child[restoreSnakeToCamel_(col)];
        if (numericCols.indexOf(col) !== -1) val = Number(val) || 0;
        row[col] = val;
      });
      out.push(row);
    });
  });
  return out;
}

/** Configuracion es clave/valor -- estructura distinta a todas las demás hojas. */
function restoreSettingsToRows_(settingsObj) {
  const now = getNowFormatted();
  const obj = settingsObj && typeof settingsObj === 'object' ? settingsObj : {};
  return Object.keys(obj).map(function (key) {
    const v = obj[key];
    return { clave: key, valor: (v === null || v === undefined) ? '' : v, descripcion: '', actualizado_en: now };
  });
}

/**
 * Orden de restauración (Segunda Parte de la fase): topológico según las
 * relaciones REALES verificadas en los controladores, no la lista
 * conceptual del enunciado copiada ciegamente. Cajas se adelanta porque
 * Ventas/Abonos/Gastos/Caja_Movimientos pueden referenciarla; Compras no
 * depende de nada de este conjunto (Proveedores no se restaura, ver
 * Fase A).
 */
function buildRestorePlan_(data) {
  return [
    { key: 'settings', sheetName: 'Configuracion', critical: true, label: 'Configuración', rows: restoreSettingsToRows_(data.settings) },
    { key: 'categories', sheetName: 'Categorias', critical: true, label: 'Categorías', rows: restoreMapGeneric_('Categorias', data.categories) },
    { key: 'sizes', sheetName: 'Tallas', critical: true, label: 'Tallas', rows: restoreMapGeneric_('Tallas', data.sizes) },
    { key: 'colors', sheetName: 'Colores', critical: true, label: 'Colores', rows: restoreMapGeneric_('Colores', data.colors) },
    { key: 'products', sheetName: 'Productos', critical: true, label: 'Productos', rows: restoreMapGeneric_('Productos', data.products) },
    { key: 'products.variantes', sheetName: 'Variantes', critical: true, label: 'Variantes', rows: restoreFlattenChildren_(data.products, 'variantes', 'Variantes') },
    { key: 'customers', sheetName: 'Clientes', critical: true, label: 'Clientes', rows: restoreMapGeneric_('Clientes', data.customers) },
    { key: 'cashSessions', sheetName: 'Cajas', critical: true, label: 'Sesiones de Caja', rows: restoreMapGeneric_('Cajas', data.cashSessions) },
    { key: 'purchases', sheetName: 'Compras', critical: true, label: 'Compras', rows: restoreMapGeneric_('Compras', data.purchases, { items_json: function (r) { return r.items; } }) },
    { key: 'sales', sheetName: 'Ventas', critical: true, label: 'Ventas', rows: restoreMapGeneric_('Ventas', data.sales, { pagos_json: function (r) { return r.pagos; } }) },
    { key: 'sales.items', sheetName: 'Venta_Items', critical: true, label: 'Venta_Items', rows: restoreFlattenChildren_(data.sales, 'items', 'Venta_Items') },
    { key: 'credits', sheetName: 'Creditos', critical: true, label: 'Cuentas por Cobrar', rows: restoreMapGeneric_('Creditos', data.credits) },
    { key: 'credits.abonos', sheetName: 'Abonos', critical: true, label: 'Abonos', rows: restoreFlattenChildren_(data.credits, 'abonos', 'Abonos') },
    { key: 'returns', sheetName: 'Devoluciones', critical: true, label: 'Devoluciones', rows: restoreMapGeneric_('Devoluciones', data.returns, { items_json: function (r) { return r.items; } }) },
    { key: 'creditNotes', sheetName: 'Creditos_Favor', critical: true, label: 'Créditos a Favor / Notas de Crédito', rows: restoreMapGeneric_('Creditos_Favor', data.creditNotes) },
    { key: 'creditNotes.aplicaciones', sheetName: 'Creditos_Favor_Aplicaciones', critical: true, label: 'Aplicaciones de Créditos', rows: restoreFlattenChildren_(data.creditNotes, 'aplicaciones', 'Creditos_Favor_Aplicaciones') },
    { key: 'expenses', sheetName: 'Gastos', critical: true, label: 'Gastos', rows: restoreMapGeneric_('Gastos', data.expenses) },
    { key: 'cashMovements', sheetName: 'Caja_Movimientos', critical: true, label: 'Movimientos de Caja', rows: restoreMapGeneric_('Caja_Movimientos', data.cashMovements) },
    { key: 'kardex', sheetName: 'Inventario_Kardex', critical: true, label: 'Kardex', rows: restoreMapGeneric_('Inventario_Kardex', data.kardex) }
  ];
}

// Prefijos reales de Sequences.getNext(...) verificados leyendo CADA
// controlador (grep exhaustivo) -- 'USR' se excluye deliberadamente
// (Usuarios nunca se restaura).
const RESTORE_SEQUENCE_PREFIXES = ['PRD', 'VAR', 'CLI', 'VEN', 'ITM', 'CRED', 'ABO', 'CAJA', 'CMOV', 'GAS', 'COM', 'DEV', 'VALE', 'NC', 'CFAPP', 'MOV'];

function restoreParseIdNumber_(id) {
  const m = /^[A-Z]+-(\d+)$/.exec(String(id || '').trim());
  return m ? Number(m[1]) : null;
}

/**
 * Después de restaurar todas las hojas, recalcula Secuencias a partir de
 * los IDs REALMENTE restaurados -- nunca copia la hoja Secuencias del
 * backup tal cual (Sexta Parte / SEQUENCES de la auditoría).
 */
function restoreRecalculateSequences_(plan) {
  const maxByPrefix = {};
  RESTORE_SEQUENCE_PREFIXES.forEach(function (p) { maxByPrefix[p] = 0; });

  plan.forEach(function (job) {
    job.rows.forEach(function (row) {
      const n = restoreParseIdNumber_(row.id);
      if (n === null) return;
      const prefix = String(row.id).split('-')[0].toUpperCase();
      if (maxByPrefix[prefix] !== undefined && n > maxByPrefix[prefix]) {
        maxByPrefix[prefix] = n;
      }
    });
  });

  const results = [];
  RESTORE_SEQUENCE_PREFIXES.forEach(function (prefix) {
    results.push(Sequences.ensureMinimumNext(prefix, maxByPrefix[prefix]));
  });
  return results;
}

// =========================================================================
// VALIDACIÓN (nunca confía en el frontend -- Main.gs entrega `data` crudo)
// =========================================================================

function restoreIsNormalizableNumber_(v) {
  return v === undefined || v === null || v === '' || Number.isFinite(Number(v));
}
function restoreIsParseableDate_(v) {
  if (v === undefined || v === null || v === '') return true;
  const t = new Date(String(v).replace(' ', 'T')).getTime();
  return !Number.isNaN(t);
}
function restoreNonEmptyId_(v) {
  return typeof v === 'string' && v.trim() !== '';
}

const RESTORE_CRITICAL_KEYS = [
  'products', 'categories', 'sizes', 'colors', 'customers', 'sales', 'credits',
  'creditNotes', 'returns', 'purchases', 'expenses', 'cashSessions', 'cashMovements', 'kardex'
];

/**
 * Validación ESTRUCTURAL completa (independiente de validateBackupFile
 * del frontend -- el backend re-verifica todo desde cero porque el JSON
 * recibido se trata como NO CONFIABLE).
 */
function restoreValidateStructure_(body) {
  const errors = [];
  const warnings = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['El backup no es un objeto JSON válido.'], warnings, data: null };
  }
  if (body.format !== 'zio-pos-backup') {
    errors.push(`format incompatible: se esperaba "zio-pos-backup", se recibió "${body.format}".`);
  }
  if (typeof body.backupVersion !== 'number') {
    errors.push('backupVersion ausente o inválido.');
  } else if (body.backupVersion !== 2) {
    errors.push(`backupVersion incompatible: esta versión del backend solo restaura backupVersion 2 (recibido: ${body.backupVersion}).`);
  }
  if (body.complete !== true) {
    errors.push('El backup no está marcado como completo (complete !== true) -- no se restaura un backup incompleto.');
  }
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    errors.push('El backup no tiene un objeto "data" válido.');
    return { errors, warnings, data: null };
  }

  const data = body.data;

  RESTORE_CRITICAL_KEYS.forEach(function (key) {
    if (key === 'settings') return;
    if (!Array.isArray(data[key])) {
      errors.push(`Falta la entidad crítica "${key}" (debe ser una lista).`);
    }
  });
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    errors.push('Falta la entidad crítica "settings" (debe ser un objeto).');
  }

  if (errors.length > 0) return { errors, warnings, data: null };

  // Validación de registros: ids no vacíos, tipos numéricos/fecha
  // razonables. Se recolectan TODOS los errores encontrados (no solo el
  // primero) para que el preview sea útil.
  function checkArray(key, requireId) {
    (data[key] || []).forEach(function (rec, idx) {
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
        errors.push(`${key}[${idx}] no es un registro válido.`);
        return;
      }
      if (requireId && !restoreNonEmptyId_(rec.id)) {
        errors.push(`${key}[${idx}] tiene un id vacío o inválido.`);
      }
    });
  }
  ['products', 'categories', 'sizes', 'colors', 'customers', 'sales', 'credits', 'creditNotes', 'returns', 'purchases', 'expenses', 'cashSessions', 'cashMovements', 'kardex'].forEach(function (k) {
    checkArray(k, true);
  });

  (data.products || []).forEach(function (p, idx) {
    if (!restoreIsNormalizableNumber_(p.precio) || !restoreIsNormalizableNumber_(p.costo)) {
      errors.push(`products[${idx}] (${p.id}) tiene precio/costo no numérico.`);
    }
    (p.variantes || []).forEach(function (v, vIdx) {
      if (!restoreNonEmptyId_(v.id)) errors.push(`products[${idx}].variantes[${vIdx}] tiene un id vacío.`);
      if (!restoreIsNormalizableNumber_(v.stock)) errors.push(`products[${idx}].variantes[${vIdx}] tiene stock no numérico.`);
    });
  });
  (data.sales || []).forEach(function (s, idx) {
    if (!restoreIsNormalizableNumber_(s.total)) errors.push(`sales[${idx}] (${s.id}) tiene total no numérico.`);
    if (!restoreIsParseableDate_(s.fecha)) errors.push(`sales[${idx}] (${s.id}) tiene fecha no interpretable.`);
    (s.pagos || []).forEach(function (pago, pIdx) {
      if (!pago || typeof pago.metodo !== 'string' || !pago.metodo.trim()) {
        errors.push(`sales[${idx}].pagos[${pIdx}] no tiene método válido.`);
      }
      if (!restoreIsNormalizableNumber_(pago && pago.monto)) {
        errors.push(`sales[${idx}].pagos[${pIdx}] tiene monto no numérico.`);
      }
    });
  });
  (data.cashMovements || []).forEach(function (m, idx) {
    if (!restoreIsNormalizableNumber_(m.monto)) errors.push(`cashMovements[${idx}] (${m.id}) tiene monto no numérico.`);
  });

  return { errors: errors, warnings: warnings, data: data };
}

/**
 * Validación RELACIONAL (Quinta Parte / "RELACIONES" de la auditoría):
 * toda referencia debe resolver DENTRO del propio backup (nunca contra
 * el estado actual, que está a punto de reemplazarse). Si algo no
 * resuelve: se acumula como error -- el llamador decide abortar.
 * Proveedores queda fuera deliberadamente: Fase A documentó que no
 * existe endpoint para esa entidad, así que proveedorId nunca puede
 * validarse contra el backup -- se preserva sin validar, no se abortsa
 * por su ausencia.
 */
function restoreValidateRelationships_(data) {
  const errors = [];

  const idSet = function (arr) {
    const s = {};
    (arr || []).forEach(function (r) { if (r && r.id) s[String(r.id)] = true; });
    return s;
  };
  const productIds = idSet(data.products);
  const variantIds = {};
  (data.products || []).forEach(function (p) {
    (p.variantes || []).forEach(function (v) { if (v && v.id) variantIds[String(v.id)] = true; });
  });
  const customerIds = idSet(data.customers);
  const saleIds = idSet(data.sales);
  const creditIds = idSet(data.credits);
  const returnIds = idSet(data.returns);
  const cashSessionIds = idSet(data.cashSessions);

  function requireRef(label, value, set, setName) {
    if (value === undefined || value === null || value === '') return; // FK opcional ausente: nada que validar
    if (!set[String(value)]) errors.push(`${label} referencia "${value}", que no existe en ${setName} del backup.`);
  }

  (data.products || []).forEach(function (p) {
    (p.variantes || []).forEach(function (v) {
      requireRef(`Variante ${v.id}`, v.productoId, productIds, 'products');
    });
  });

  (data.sales || []).forEach(function (s) {
    requireRef(`Venta ${s.id}`, s.clienteId, customerIds, 'customers');
    requireRef(`Venta ${s.id}`, s.cuentaCobrarId, creditIds, 'credits');
    (s.items || []).forEach(function (it) {
      requireRef(`Venta_Item de venta ${s.id}`, it.productoId, productIds, 'products');
      requireRef(`Venta_Item de venta ${s.id}`, it.varianteId, variantIds, 'variantes');
    });
  });

  (data.credits || []).forEach(function (c) {
    requireRef(`Crédito/CxC ${c.id}`, c.clienteId, customerIds, 'customers');
    requireRef(`Crédito/CxC ${c.id}`, c.ventaId, saleIds, 'sales');
  });

  (data.returns || []).forEach(function (r) {
    requireRef(`Devolución ${r.id}`, r.ventaId, saleIds, 'sales');
    requireRef(`Devolución ${r.id}`, r.clienteId, customerIds, 'customers');
  });

  (data.creditNotes || []).forEach(function (n) {
    requireRef(`Crédito a Favor/Nota ${n.id}`, n.clienteId, customerIds, 'customers');
    requireRef(`Crédito a Favor/Nota ${n.id}`, n.devolucionId, returnIds, 'returns');
    requireRef(`Crédito a Favor/Nota ${n.id}`, n.ventaOrigenId, saleIds, 'sales');
    (n.aplicaciones || []).forEach(function (a) {
      requireRef(`Aplicación ${a.id} (crédito ${n.id})`, a.ventaId, saleIds, 'sales');
    });
  });

  (data.expenses || []).forEach(function (g) {
    requireRef(`Gasto ${g.id}`, g.cajaSesionId, cashSessionIds, 'cashSessions');
  });

  (data.cashMovements || []).forEach(function (m) {
    // Requerido explícitamente ("movimientos de caja sin sesión" debe
    // rechazarse) -- a diferencia de las demás FK opcionales de arriba.
    if (!m.cajaSesionId) {
      errors.push(`Movimiento de caja ${m.id} no tiene cajaSesionId.`);
    } else {
      requireRef(`Movimiento de caja ${m.id}`, m.cajaSesionId, cashSessionIds, 'cashSessions');
    }
  });

  (data.kardex || []).forEach(function (k) {
    requireRef(`Kardex ${k.id}`, k.productoId, productIds, 'products');
    requireRef(`Kardex ${k.id}`, k.varianteId, variantIds, 'variantes');
  });

  return errors;
}

function restoreValidateFull_(body) {
  const structural = restoreValidateStructure_(body);
  if (structural.errors.length > 0 || !structural.data) {
    return { valid: false, errors: structural.errors, warnings: structural.warnings, data: null };
  }
  const relErrors = restoreValidateRelationships_(structural.data);
  const errors = structural.errors.concat(relErrors);
  return { valid: errors.length === 0, errors: errors, warnings: structural.warnings, data: structural.data };
}

function restoreCountRecords_(data) {
  let total = 0;
  const entities = [];
  RESTORE_CRITICAL_KEYS.forEach(function (key) {
    if (key === 'settings') return;
    const arr = data[key] || [];
    entities.push({ key: key, count: arr.length });
    total += arr.length;
  });
  return { total: total, entities: entities };
}

const RestoreController = {
  /**
   * PREVIEW: valida por completo (estructura + relaciones) SIN escribir
   * absolutamente nada. Requiere el mismo permiso que la restauración
   * real -- ver una vista previa detallada de todo el negocio ya es
   * información sensible.
   */
  handlePreviewRestoreBackup(data, user) {
    Security.requirePermission(user, 'admin.configuracion');

    if (!data || !data.backup) {
      throw new Error('VALIDATION_ERROR: Debe enviarse el backup completo en data.backup.');
    }

    const result = restoreValidateFull_(data.backup);
    if (!result.valid) {
      return { success: true, valid: false, errors: result.errors, warnings: result.warnings };
    }
    const counts = restoreCountRecords_(result.data);
    return {
      success: true,
      valid: true,
      backupVersion: data.backup.backupVersion,
      createdAt: data.backup.createdAt,
      totalRecords: counts.total,
      entities: counts.entities,
      warnings: result.warnings,
      errors: []
    };
  },

  /**
   * RESTAURACIÓN REAL. Flujo (ver comentario de arriba para el porqué de
   * cada paso):
   *  1. Permiso admin.configuracion (ADMIN bypassa vía Security.hasPermission).
   *  2. Lock único -- bloquea CUALQUIER otra escritura (ventas, compras,
   *     abonos, devoluciones, movimientos de caja, ajustes de inventario)
   *     mientras dura la restauración.
   *  3. Re-validación COMPLETA (nunca confía en que el preview siga
   *     siendo válido -- el JSON pudo cambiar entre ambas llamadas).
   *  4. Construir el plan (filas ya mapeadas a snake_case por hoja).
   *  5. STAGING: escribir cada hoja de staging. Fallo aquí => limpiar
   *     staging, NINGÚN dato real tocado.
   *  6. BACKUP PREVENTIVO: copiar cada hoja real actual. Fallo aquí =>
   *     limpiar staging + copias ya hechas, NINGÚN dato real tocado.
   *  7. SWAP: borrar cada hoja real y renombrar su staging al nombre
   *     real. Fallo a mitad => rollback acotado (ver
   *     restoreRollbackSwap_).
   *  8. Recalcular Sequences a partir de los IDs realmente restaurados.
   *  9. Auditoría (RESTORE_BACKUP / RESTORE_BACKUP_FAILED).
   */
  handleRestoreBackup(data, user) {
    Security.requirePermission(user, 'admin.configuracion');

    if (!data || !data.backup) {
      throw new Error('VALIDATION_ERROR: Debe enviarse el backup completo en data.backup.');
    }

    return LockServiceHelper.runWithLock(CONFIG.RESTORE_LOCK_TIMEOUT_MS, () => {
      const txId = Utilities.getUuid().slice(0, 8);
      const validation = restoreValidateFull_(data.backup);

      if (!validation.valid) {
        AuditController.log(user, 'RESTORE_BACKUP_FAILED', 'SISTEMA', 'Backup', data.backup.createdAt || '',
          'Restauración rechazada en validación -- ningún dato fue modificado.',
          { errorCount: validation.errors.length, firstErrors: validation.errors.slice(0, 5) }, 'FALLO');
        // El "message" lleva el detalle completo (no solo "errors") porque
        // la capa genérica del frontend (apiService.syncWithGoogleAppsScript)
        // descarta cualquier campo que no sea success/message/errorCode
        // en una respuesta de fallo -- así ninguna razón se pierde en el
        // camino, aunque algo distinto de RestoreController llegue a
        // consumir esta respuesta en el futuro.
        return {
          success: false,
          message: `VALIDATION_ERROR: El backup no pasó la validación (${validation.errors.length} problema(s)). Ningún dato fue modificado. Detalle: ${validation.errors.join(' | ')}`,
          errors: validation.errors
        };
      }

      const plan = buildRestorePlan_(validation.data);
      const ss = getSpreadsheet();
      const swapLog = []; // { sheetName, backupSheetName, stageSheetName, liveDeleted, staged }

      const cleanupOnAbort = () => {
        // Ningún swap se ejecutó todavía (fallo en staging o en el
        // backup preventivo) -- las hojas reales NUNCA se tocaron. Solo
        // hay que limpiar los andamios (staging + copias de seguridad ya
        // creadas) para no dejar basura.
        swapLog.forEach((entry) => {
          try { if (entry.stageSheet) ss.deleteSheet(entry.stageSheet); } catch (e) {}
          try { if (entry.backupSheet) ss.deleteSheet(entry.backupSheet); } catch (e) {}
        });
      };

      try {
        // --- FASE 1: STAGING (segura -- nada real tocado todavía) ---
        // Reutiliza DbHelper.insertRows (inserción por lotes ya
        // existente) en vez de reescribir su lógica de serialización --
        // la hoja de staging es nueva, así que DbHelper.getSheet la
        // encuentra y cachea sin colisionar con la hoja real.
        plan.forEach((job) => {
          const stageName = `${job.sheetName}__STAGE_${txId}`;
          const stageSheet = ss.insertSheet(stageName);
          const headers = DbHelper.getHeaders(job.sheetName);
          stageSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          if (job.rows.length > 0) {
            DbHelper.insertRows(stageName, job.rows);
          }
          swapLog.push({ sheetName: job.sheetName, stageSheet: stageSheet, backupSheet: null, liveDeleted: false, staged: false });
        });

        // --- FASE 2: BACKUP PREVENTIVO (todavía segura) ---
        swapLog.forEach((entry) => {
          const liveSheet = DbHelper.getSheet(entry.sheetName);
          const backupSheet = liveSheet.copyTo(ss);
          backupSheet.setName(`${entry.sheetName}__PRERESTORE_${txId}`);
          entry.backupSheet = backupSheet;
        });

        // --- FASE 3: SWAP (única fase destructiva -- rápida, acotada) ---
        swapLog.forEach((entry) => {
          const liveSheet = DbHelper.getSheet(entry.sheetName);
          ss.deleteSheet(liveSheet);
          DbHelper.invalidateSheetCache(entry.sheetName);
          entry.liveDeleted = true;
          entry.stageSheet.setName(entry.sheetName);
          DbHelper.invalidateSheetCache(entry.sheetName);
          entry.staged = true;
        });
      } catch (err) {
        // Rollback: revertir los swaps ya aplicados; limpiar lo que no
        // llegó a intercambiarse.
        const rollbackOk = restoreRollbackSwap_(ss, swapLog);
        if (!rollbackOk) {
          AuditController.log(user, 'RESTORE_BACKUP_FAILED', 'SISTEMA', 'Backup', data.backup.createdAt || '',
            'ERROR CRÍTICO: la restauración falló y el rollback automático NO pudo completarse. Requiere intervención manual inmediata.',
            { error: err.message }, 'FALLO');
          return {
            success: false,
            message: 'ERROR CRÍTICO: la restauración y su rollback requieren intervención manual. Revise las hojas __PRERESTORE_/__STAGE_ en el Spreadsheet antes de continuar.',
            critical: true
          };
        }
        AuditController.log(user, 'RESTORE_BACKUP_FAILED', 'SISTEMA', 'Backup', data.backup.createdAt || '',
          'Restauración falló durante la escritura -- rollback completo aplicado, el sistema volvió a su estado anterior.',
          { error: err.message }, 'FALLO');
        return { success: false, message: `RESTORE_FAILED: ${err.message}. Se aplicó rollback -- ningún dato quedó modificado.`, rolledBack: true };
      }

      // --- FASE 4: recalcular Sequences a partir de lo restaurado ---
      let sequenceResults = [];
      try {
        sequenceResults = restoreRecalculateSequences_(plan);
      } catch (seqErr) {
        // Las hojas reales ya están correctas (swap exitoso) -- un fallo
        // aquí no amerita deshacer el swap; se documenta como advertencia
        // y sigue siendo responsabilidad de un administrador revisar
        // Secuencias manualmente antes del siguiente documento nuevo.
        AuditController.log(user, 'RESTORE_BACKUP', 'SISTEMA', 'Backup', data.backup.createdAt || '',
          'Restauración completada, pero la recalculación de Secuencias falló -- revisar manualmente antes de crear nuevos documentos.',
          { error: seqErr.message }, 'EXITO');
      }

      const counts = restoreCountRecords_(validation.data);
      AuditController.log(user, 'RESTORE_BACKUP', 'SISTEMA', 'Backup', data.backup.createdAt || '',
        `Backup restaurado exitosamente (${counts.total} registros en ${counts.entities.length} entidades).`,
        { backupVersion: data.backup.backupVersion, totalRecords: counts.total, txId: txId }, 'EXITO');

      return {
        success: true,
        message: 'Backup restaurado correctamente.',
        totalRecords: counts.total,
        entities: counts.entities,
        sequencesRecalculated: sequenceResults
      };
    });
  }
};

/**
 * Revierte los swaps ya aplicados (en orden inverso) y limpia lo que no
 * llegó a intercambiarse. Devuelve `false` si algún paso de la reversión
 * en sí falla -- eso es el escenario CRÍTICO que exige intervención
 * manual (nunca se informa "restauración cancelada" como si nada hubiera
 * pasado).
 */
function restoreRollbackSwap_(ss, swapLog) {
  let ok = true;
  for (let i = swapLog.length - 1; i >= 0; i--) {
    const entry = swapLog[i];
    try {
      if (entry.staged) {
        // La hoja de staging ya ocupa el nombre real -- hay que
        // devolverle su nombre de staging y restaurar la copia de
        // seguridad al nombre real.
        const currentLive = ss.getSheetByName(entry.sheetName);
        if (currentLive) {
          currentLive.setName(`${entry.sheetName}__STAGE_ROLLBACK`);
          ss.deleteSheet(currentLive);
        }
        if (entry.backupSheet) {
          entry.backupSheet.setName(entry.sheetName);
          DbHelper.invalidateSheetCache(entry.sheetName);
        }
      } else if (entry.liveDeleted && entry.backupSheet) {
        // Se borró la hoja real pero el rename de staging no llegó a
        // aplicarse -- restaurar desde la copia de seguridad.
        entry.backupSheet.setName(entry.sheetName);
        DbHelper.invalidateSheetCache(entry.sheetName);
      } else {
        // Nunca se tocó la hoja real de esta entidad -- solo limpiar los
        // andamios.
        if (entry.stageSheet) ss.deleteSheet(entry.stageSheet);
        if (entry.backupSheet) ss.deleteSheet(entry.backupSheet);
      }
    } catch (compensationError) {
      Logger.log(`[Restore Rollback ERROR] Falló compensación para ${entry.sheetName}: ${compensationError.message}`);
      ok = false;
    }
  }
  return ok;
}
