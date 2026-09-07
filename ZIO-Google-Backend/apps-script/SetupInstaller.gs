/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: SetupInstaller.gs
 * Description: Instalador de NUEVAS instalaciones -- convierte el proyecto
 * Apps Script MASTER en una plantilla comercial clonable por cliente,
 * completamente LIMPIA (sin datos de demostración, sin usuarios
 * predeterminados) hasta que el propio cliente crea su primer ADMIN.
 *
 * AUDITORÍA (TAREA — INSTALACIÓN LIMPIA + CONFIGURACIÓN SEGURA DEL PRIMER
 * ADMIN), hallazgos que determinan el diseño de este archivo:
 *
 *  - Única fuente de verdad del Spreadsheet ID: Script Properties, clave
 *    'SPREADSHEET_ID' (Config.gs) -- sin cambios respecto a la fase
 *    anterior, reutilizada tal cual vía `setSpreadsheetId()`.
 *  - `seedInitialData()` (SeedSetup.gs) mezclaba estructura real
 *    (secuencias, roles/permisos) con datos de DEMOSTRACIÓN (usuarios
 *    admin/cajero/gerente con contraseñas conocidas, catálogo de ejemplo,
 *    configuración de negocio ficticia "ZIO CLOTHES"). Se refactorizó en
 *    SeedSetup.gs (ver ese archivo) en 4 funciones separadas --
 *    `seedSequences_`/`seedRolesAndPermissions_`/
 *    `seedSystemConfiguration_` (estructura, sin datos ficticios) y
 *    `seedDemoData_` (SOLO datos de demostración). `seedInitialData()`
 *    se preservó IDÉNTICA (sigue llamando a las 4, mismo comportamiento
 *    de siempre, para no romper `seedAllTestData()`/`system.
 *    seedInitialData` autenticado). Esta instalación comercial usa en su
 *    lugar `seedInitialDataStructural_()` (también en SeedSetup.gs),
 *    idéntica salvo que NUNCA llama `seedDemoData_()`.
 *  - Nueva Script Property: 'INITIAL_ADMIN_CONFIGURED' ('true'/'false' en
 *    texto -- PropertiesService solo guarda strings). No colisiona con
 *    ninguna clave existente ('SPREADSHEET_ID', 'PRODUCT_IMAGES_FOLDER_ID',
 *    ni las de INSTALLATION_* agregadas en la fase anterior).
 *  - `system.installationStatus`/`system.setupInitialAdmin` son PÚBLICAS
 *    a propósito (como `auth.login`) -- no puede exigirse sesión para
 *    crear la PRIMERA sesión posible. Se protegen con su propia lógica
 *    interna (nunca revelan nada sensible; `setupInitialAdmin` se niega
 *    en cuanto ya existe un ADMIN real, cubierto por LockService).
 *  - Hashing de contraseña: EXACTAMENTE `Security.generateSalt(16)` +
 *    `Security.hashPassword()` -- el mismo mecanismo que ya usa
 *    `AuthController.handleSaveUser`/`seedDemoData_()`. Ningún algoritmo
 *    nuevo.
 *  - ID de usuario: `Sequences.getNext('USR')`, mismo mecanismo que
 *    `AuthController.handleSaveUser`.
 *
 * Diseño de idempotencia (sin cambios respecto a la fase anterior):
 * `setSpreadsheetId(spreadsheetId)` se llama INMEDIATAMENTE después de
 * `SpreadsheetApp.create(...)`, ANTES de ejecutar cualquier otro paso.
 * `verificarYRepararInstalacion()` sigue siendo la función separada de
 * reparación/verificación. Este instalador JAMÁS borra hojas, filas ni
 * Script Properties.
 */

const INSTALLER_VERSION = '1.1.0';
const DEFAULT_INSTALLATION_NAME = 'POS CRM - NUEVA INSTALACION';

// TAREA -- INSTALACIÓN LIMPIA: entidades comerciales que una instalación
// recién creada (o reparada) DEBE tener en 0 registros -- lista tomada
// directamente de la Fase 21 de la tarea, verificada contra SCHEMAS (cada
// nombre es una hoja real, ninguno inventado). 'Auditoria' se excluye a
// propósito (puede tener registros TÉCNICOS de la propia instalación --
// ver AuditController.log en runInstallationSteps_ -- nunca de
// ventas/clientes/productos inexistentes, que es la garantía real que
// pide la tarea).
const COMMERCIAL_ENTITIES_MUST_BE_EMPTY = [
  'Productos', 'Variantes', 'Clientes', 'Ventas', 'Venta_Items', 'Compras', 'Gastos',
  'Devoluciones', 'Abonos', 'Creditos', 'Creditos_Favor', 'Creditos_Favor_Aplicaciones',
  'Inventario_Kardex', 'Cajas', 'Caja_Movimientos', 'Proveedores', 'Categorias', 'Tallas',
  'Colores', 'Usuarios'
];

// Subconjunto mostrado en el reporte final (Fase 20, mismas 10 líneas del
// formato solicitado) -- la verificación real (COMMERCIAL_ENTITIES_MUST_BE_EMPTY)
// cubre las 19, esto es solo lo que se IMPRIME.
const COMMERCIAL_ENTITIES_REPORT_LABELS = [
  { sheet: 'Productos', label: 'Productos' },
  { sheet: 'Clientes', label: 'Clientes' },
  { sheet: 'Ventas', label: 'Ventas' },
  { sheet: 'Compras', label: 'Compras' },
  { sheet: 'Gastos', label: 'Gastos' },
  { sheet: 'Devoluciones', label: 'Devoluciones' },
  { sheet: 'Creditos', label: 'Créditos' },
  { sheet: 'Abonos', label: 'Abonos' },
  { sheet: 'Inventario_Kardex', label: 'Kardex' },
  { sheet: 'Usuarios', label: 'Usuarios' }
];

/**
 * FUNCIÓN PRINCIPAL — seleccionar y ejecutar manualmente desde el editor
 * de Apps Script en una copia RECIÉN CREADA del proyecto MASTER (sin
 * 'SPREADSHEET_ID' configurado todavía).
 *
 * CASO A (instalación nueva real): crea el Google Spreadsheet, guarda su
 * ID, crea toda la estructura, roles/permisos/secuencias, deja
 * INITIAL_ADMIN_CONFIGURED=false, verifica que la BD comercial quede
 * completamente vacía, y produce un reporte en Logger.
 *
 * CASO B (ejecutada por accidente una segunda vez sobre la MISMA copia):
 * detecta 'SPREADSHEET_ID' ya configurado y se detiene sin crear nada.
 *
 * @param {string} [nombreInstalacion] - Nombre del archivo de Google
 *   Sheets a crear (Fase 3, configurable). Nunca es el nombre comercial
 *   real del cliente -- eso se configura después, desde Configuración,
 *   por el propio cliente ya autenticado.
 * @returns {Object} Resultado de la instalación.
 */
function setupNuevaInstalacion(nombreInstalacion) {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('SPREADSHEET_ID');

  if (existingId && existingId.trim() !== '') {
    const message =
      'INSTALACIÓN YA CONFIGURADA.\n' +
      `Spreadsheet existente: ${existingId}\n` +
      'No se creó una nueva base de datos.';
    Logger.log(
      '========================================\n' +
      ' INSTALACIÓN YA CONFIGURADA\n' +
      '========================================\n\n' +
      `Esta copia del proyecto Apps Script ya tiene una instalación real\n` +
      `configurada (Script Properties -> SPREADSHEET_ID = ${existingId}).\n\n` +
      'No se creó una nueva base de datos -- setupNuevaInstalacion() nunca\n' +
      'se ejecuta dos veces sobre la misma copia para evitar crear un\n' +
      'segundo Google Sheet huérfano.\n\n' +
      '¿Qué hacer ahora?\n' +
      '  - Si esta instalación necesita revisarse, completarse o recibir\n' +
      '    migraciones nuevas: ejecute verificarYRepararInstalacion().\n' +
      '  - Si de verdad necesita una instalación NUEVA para otro cliente:\n' +
      '    copie de nuevo el proyecto Apps Script MASTER (una copia limpia,\n' +
      '    sin SPREADSHEET_ID configurado) y ejecute setupNuevaInstalacion()\n' +
      '    ahí.\n' +
      '========================================'
    );
    return { success: false, alreadyConfigured: true, spreadsheetId: existingId, message: message };
  }

  const installationName = (nombreInstalacion && String(nombreInstalacion).trim()) || DEFAULT_INSTALLATION_NAME;
  Logger.log(`[SetupInstaller] Creando Google Spreadsheet nuevo: "${installationName}"...`);

  let spreadsheet;
  try {
    // Fase 3: API nativa de Apps Script, sin pedir ningún ID manual.
    spreadsheet = SpreadsheetApp.create(installationName);
  } catch (e) {
    const message = `ERROR: no se pudo crear el Google Spreadsheet: ${e.message}`;
    Logger.log(`[SetupInstaller] ${message}`);
    return { success: false, message: message };
  }

  const spreadsheetId = spreadsheet.getId();

  // CRÍTICO (idempotencia -- ver comentario de cabecera): se persiste el
  // ID INMEDIATAMENTE, con el ÚNICO mecanismo existente, antes de
  // ejecutar cualquier otro paso que pudiera fallar.
  setSpreadsheetId(spreadsheetId);

  const installationId = Utilities.getUuid();
  const installedAt = getNowFormatted();
  props.setProperties({
    INSTALLATION_ID: installationId,
    INSTALLATION_NAME: installationName,
    INSTALLATION_DATE: installedAt,
    INSTALLER_VERSION: INSTALLER_VERSION,
    BACKEND_VERSION: CONFIG.VERSION,
    // TAREA -- INSTALACIÓN LIMPIA (Fase 6): explícito desde el primer
    // instante -- ningún ADMIN existe todavía, nadie puede iniciar sesión
    // hasta que se cree uno real mediante system.setupInitialAdmin.
    INITIAL_ADMIN_CONFIGURED: 'false'
  });

  return runInstallationSteps_(spreadsheet, {
    installationId: installationId,
    installationName: installationName,
    installedAt: installedAt,
    isNewInstall: true
  });
}

/**
 * FUNCIÓN SEPARADA DE REPARACIÓN/VERIFICACIÓN -- exige que
 * 'SPREADSHEET_ID' YA esté configurado. Reutiliza los mismos pasos
 * idempotentes estructurales (nunca `seedDemoData_()`) para completar una
 * instalación que quedó a medias, o para volver a verificarla. Segura de
 * ejecutar incluso sobre una instalación real con datos reales: cada
 * sección de seedInitialDataStructural_() se salta si su hoja ya tiene
 * filas, y las migraciones solo agregan lo que falte.
 */
function verificarYRepararInstalacion() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('SPREADSHEET_ID');

  if (!existingId || existingId.trim() === '') {
    const message =
      'No hay ninguna instalación configurada todavía en esta copia del ' +
      'proyecto. Ejecute setupNuevaInstalacion() primero.';
    Logger.log(`[SetupInstaller] ${message}`);
    return { success: false, message: message };
  }

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(existingId.trim());
  } catch (e) {
    const message = `ERROR: SPREADSHEET_ID='${existingId}' está configurado pero no se pudo abrir: ${e.message}`;
    Logger.log(`[SetupInstaller] ${message}`);
    return { success: false, message: message };
  }

  // Completa metadata de instalación SOLO si falta (instalación real
  // anterior a este instalador) -- nunca sobreescribe un valor ya
  // presente, salvo las versiones, que reflejan honestamente con qué
  // versión se verificó/reparó por última vez.
  if (!props.getProperty('INSTALLATION_ID')) props.setProperty('INSTALLATION_ID', Utilities.getUuid());
  if (!props.getProperty('INSTALLATION_NAME')) props.setProperty('INSTALLATION_NAME', spreadsheet.getName());
  if (!props.getProperty('INSTALLATION_DATE')) props.setProperty('INSTALLATION_DATE', getNowFormatted());
  props.setProperty('INSTALLER_VERSION', INSTALLER_VERSION);
  props.setProperty('BACKEND_VERSION', CONFIG.VERSION);
  // INITIAL_ADMIN_CONFIGURED NUNCA se fuerza aquí a un valor fijo -- lo
  // recalcula migrateInitialAdminStatus() dentro de runInstallationSteps_
  // a partir del estado REAL de Usuarios (Fase 13), nunca a ciegas.

  return runInstallationSteps_(spreadsheet, {
    installationId: props.getProperty('INSTALLATION_ID'),
    installationName: props.getProperty('INSTALLATION_NAME'),
    installedAt: props.getProperty('INSTALLATION_DATE'),
    isNewInstall: false
  });
}

/**
 * Ejecuta, en orden, los pasos reutilizados de creación de estructura +
 * migraciones idempotentes, deteniéndose en el primer error real, y
 * siempre terminando con la verificación final + el reporte.
 */
function runInstallationSteps_(spreadsheet, meta) {
  const stepsLog = [];

  try {
    const dbResult = setupDatabase();
    stepsLog.push({ step: 'setupDatabase', ok: true, detail: dbResult.message });
  } catch (e) {
    return finalizeInstallationReport_(spreadsheet, meta, stepsLog, `ERROR en setupDatabase(): ${e.message}`);
  }

  try {
    // TAREA -- INSTALACIÓN LIMPIA: estructural únicamente -- NUNCA
    // seedInitialData() (que incluye seedDemoData_()).
    seedInitialDataStructural_();
    stepsLog.push({ step: 'seedInitialDataStructural_', ok: true, detail: 'Roles, permisos, secuencias y configuración técnica verificados/creados -- sin datos comerciales, sin usuarios.' });
  } catch (e) {
    return finalizeInstallationReport_(spreadsheet, meta, stepsLog, `ERROR en seedInitialDataStructural_(): ${e.message}`);
  }

  try {
    const cfResult = migrateCreditosFavorPermissions();
    stepsLog.push({ step: 'migrateCreditosFavorPermissions', ok: true, detail: `Roles actualizados: ${cfResult.rolesUpdated.length}, sin cambios: ${cfResult.rolesUnchanged.length}.` });
  } catch (e) {
    return finalizeInstallationReport_(spreadsheet, meta, stepsLog, `ERROR en migrateCreditosFavorPermissions(): ${e.message}`);
  }

  try {
    const vpResult = migrateViewPermissions();
    stepsLog.push({ step: 'migrateViewPermissions', ok: true, detail: `Roles actualizados: ${vpResult.rolesUpdated.length}, sin cambios: ${vpResult.rolesUnchanged.length}.` });
  } catch (e) {
    return finalizeInstallationReport_(spreadsheet, meta, stepsLog, `ERROR en migrateViewPermissions(): ${e.message}`);
  }

  try {
    const adminStatusResult = migrateInitialAdminStatus();
    stepsLog.push({ step: 'migrateInitialAdminStatus', ok: true, detail: `INITIAL_ADMIN_CONFIGURED=${adminStatusResult.initialAdminConfigured}.` });
  } catch (e) {
    return finalizeInstallationReport_(spreadsheet, meta, stepsLog, `ERROR en migrateInitialAdminStatus(): ${e.message}`);
  }

  return finalizeInstallationReport_(spreadsheet, meta, stepsLog, null);
}

/**
 * Verificación final -- solo LEE, nunca escribe. Cubre estructura (Fase
 * 10 de la fase anterior) + BD comercial vacía (Fase 21 de esta tarea).
 *
 * `requireEmptyCommercialData`: la BD vacía es un requisito de ÉXITO
 * SOLO para una instalación recién creada en esta misma ejecución
 * (setupNuevaInstalacion(), donde el Spreadsheet literalmente se acaba
 * de crear hace segundos -- cualquier dato comercial ahí sería un bug
 * real). `verificarYRepararInstalacion()` puede legítimamente ejecutarse
 * sobre una instalación real YA EN PRODUCCIÓN con ventas/clientes/
 * productos reales (su propio propósito documentado) -- en ese caso
 * SIEMPRE se informa el conteo real (nunca se oculta), pero NO se marca
 * la instalación como "FALLIDA" solo por tener datos reales legítimos.
 */
function verifyInstallation_(spreadsheet, spreadsheetIdFromProps, requireEmptyCommercialData) {
  const result = {
    spreadsheetExists: false,
    spreadsheetIdValid: false,
    scriptPropertiesHasId: false,
    sheets: {},
    sheetsOkCount: 0,
    sheetsTotalCount: Object.keys(SCHEMAS).length,
    rolesOk: false,
    rolesOkCount: 0,
    permissionsOk: { vista: false, creditosFavor: false, roles: false },
    sequencesOk: false,
    sequencesMissing: [],
    configuracionOk: false,
    noDuplicateSheets: true,
    duplicateSheetNames: [],
    // TAREA -- INSTALACIÓN LIMPIA (Fase 21).
    commercialDataEmpty: false,
    commercialCounts: {}, // { sheetName: count }
    nonEmptyCommercialEntities: [], // [{ sheet, count }] -- exactamente cuáles fallaron
    initialAdminConfigured: false,
    errors: []
  };

  // Spreadsheet existe / ID válido / Script Properties contiene el ID.
  try {
    result.spreadsheetExists = !!spreadsheet && !!spreadsheet.getId();
    result.spreadsheetIdValid = result.spreadsheetExists && spreadsheet.getId() === spreadsheetIdFromProps;
  } catch (e) {
    result.errors.push(`No se pudo confirmar identidad del Spreadsheet: ${e.message}`);
  }
  result.scriptPropertiesHasId = !!spreadsheetIdFromProps && spreadsheetIdFromProps.trim() !== '';

  // Hojas requeridas + encabezados + sin duplicadas.
  const allSheetNames = spreadsheet.getSheets().map(s => s.getSheetName());
  const nameCounts = {};
  allSheetNames.forEach(n => { nameCounts[n] = (nameCounts[n] || 0) + 1; });
  Object.keys(nameCounts).forEach(n => {
    if (nameCounts[n] > 1) { result.noDuplicateSheets = false; result.duplicateSheetNames.push(n); }
  });

  Object.keys(SCHEMAS).forEach(sheetName => {
    const expectedHeaders = SCHEMAS[sheetName];
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      result.sheets[sheetName] = { exists: false, headersOk: false };
      return;
    }
    let headersOk = false;
    try {
      const actualHeaders = sheet.getRange(1, 1, 1, expectedHeaders.length).getValues()[0].map(h => String(h).trim());
      headersOk = actualHeaders.length === expectedHeaders.length && expectedHeaders.every((h, i) => actualHeaders[i] === h);
    } catch (e) {
      headersOk = false;
    }
    result.sheets[sheetName] = { exists: true, headersOk: headersOk };
    if (result.sheets[sheetName].exists && headersOk) result.sheetsOkCount++;
  });

  // Roles + permisos vista/créditos a favor.
  const expectedRoles = ['ADMIN', 'GERENTE', 'SUPERVISOR', 'CAJERO', 'VENDEDOR'];
  try {
    const roleRows = DbHelper.getAllRows('Roles_Permisos');
    let allRolesPresent = true;
    let allHaveVista = true;
    let allHaveCreditosFavor = true;
    expectedRoles.forEach(rol => {
      const row = roleRows.find(r => r.rol === rol);
      if (!row) { allRolesPresent = false; return; }
      result.rolesOkCount++;
      let permisos = [];
      try { permisos = JSON.parse(row.permisos_json || '[]'); } catch (e) { permisos = []; }
      const hasVista = Array.isArray(permisos) && permisos.some(p => String(p).indexOf('vista.') === 0);
      const hasCreditosFavor = Array.isArray(permisos) && permisos.includes('creditos_favor.ver');
      if (!hasVista) allHaveVista = false;
      if (!hasCreditosFavor) allHaveCreditosFavor = false;
    });
    result.rolesOk = allRolesPresent;
    result.permissionsOk.vista = allRolesPresent && allHaveVista;
    result.permissionsOk.creditosFavor = allRolesPresent && allHaveCreditosFavor;
    result.permissionsOk.roles = allRolesPresent;
  } catch (e) {
    result.errors.push(`No se pudieron verificar Roles_Permisos: ${e.message}`);
  }

  // Secuencias.
  const expectedPrefixes = ['VEN', 'CLI', 'PRD', 'VAR', 'CAJA', 'ABO', 'CRED', 'MOV', 'GAS', 'COM', 'DEV', 'AUD', 'USR', 'ITM', 'CAT', 'SIZ', 'COL', 'PRV', 'NC', 'VALE', 'CFAPP'];
  try {
    const seqRows = DbHelper.getAllRows('Secuencias');
    const presentPrefixes = seqRows.map(r => String(r.prefijo).trim().toUpperCase());
    result.sequencesMissing = expectedPrefixes.filter(p => presentPrefixes.indexOf(p) === -1);
    result.sequencesOk = result.sequencesMissing.length === 0;
  } catch (e) {
    result.errors.push(`No se pudieron verificar Secuencias: ${e.message}`);
  }

  // Configuración existe (fila estructural, aunque sus valores comerciales estén vacíos).
  try {
    const configRows = DbHelper.getAllRows('Configuracion');
    result.configuracionOk = configRows.length > 0;
  } catch (e) {
    result.errors.push(`No se pudo verificar Configuracion: ${e.message}`);
  }

  // TAREA -- INSTALACIÓN LIMPIA (Fase 21): BD comercial debe estar vacía.
  // Nunca basta con que la hoja EXISTA -- se cuenta cada fila real.
  try {
    COMMERCIAL_ENTITIES_MUST_BE_EMPTY.forEach(sheetName => {
      const count = DbHelper.getAllRows(sheetName).length;
      result.commercialCounts[sheetName] = count;
      if (count > 0) result.nonEmptyCommercialEntities.push({ sheet: sheetName, count: count });
    });
    result.commercialDataEmpty = result.nonEmptyCommercialEntities.length === 0;
  } catch (e) {
    result.errors.push(`No se pudo verificar que la BD comercial esté vacía: ${e.message}`);
  }

  // Estado del primer ADMIN (informativo -- NUNCA hace fallar la
  // instalación por sí solo: una instalación recién creada DEBE tener
  // initialAdminConfigured=false, eso es el resultado ESPERADO, no un error).
  try {
    result.initialAdminConfigured = PropertiesService.getScriptProperties().getProperty('INITIAL_ADMIN_CONFIGURED') === 'true';
  } catch (e) {
    result.errors.push(`No se pudo leer INITIAL_ADMIN_CONFIGURED: ${e.message}`);
  }

  const allSheetsOk = result.sheetsOkCount === result.sheetsTotalCount;

  result.ok =
    result.spreadsheetExists &&
    result.spreadsheetIdValid &&
    result.scriptPropertiesHasId &&
    allSheetsOk &&
    result.rolesOk &&
    result.permissionsOk.vista &&
    result.permissionsOk.creditosFavor &&
    result.sequencesOk &&
    result.configuracionOk &&
    result.noDuplicateSheets &&
    (!requireEmptyCommercialData || result.commercialDataEmpty) &&
    result.errors.length === 0;

  return result;
}

/**
 * Construye y registra en Logger el reporte final (Fase 20), y devuelve
 * el objeto de resultado completo. `stepError`, si se proporciona,
 * detiene el reporte en "FALLIDA" sin ejecutar la verificación completa.
 */
function finalizeInstallationReport_(spreadsheet, meta, stepsLog, stepError) {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetIdFromProps = props.getProperty('SPREADSHEET_ID');

  let verification = null;
  let success = false;
  if (!stepError) {
    // Estricto (exige BD comercial vacía) SOLO para una instalación
    // recién creada en esta misma corrida -- ver comentario de
    // verifyInstallation_(). verificarYRepararInstalacion() sobre una
    // instalación real ya en uso jamás debe reportarse "FALLIDA" solo
    // por tener ventas/clientes/productos reales.
    verification = verifyInstallation_(spreadsheet, spreadsheetIdFromProps, !!meta.isNewInstall);
    success = verification.ok;
  }

  const lines = [];
  lines.push('========================================');
  lines.push(' INSTALACIÓN POS CRM COMPLETADA');
  lines.push('========================================');
  lines.push('');
  lines.push(`Estado: ${success ? 'EXITOSA' : 'FALLIDA'}`);
  lines.push('');
  lines.push('Spreadsheet:');
  lines.push(spreadsheetIdFromProps || '(no configurado)');
  lines.push('');
  lines.push('Nombre:');
  lines.push(meta.installationName || '(desconocido)');
  lines.push('');
  lines.push('Installation ID:');
  lines.push(meta.installationId || '(no asignado -- falló antes de generarse)');
  lines.push('');
  lines.push('Fecha:');
  lines.push(meta.installedAt || getNowFormatted());
  lines.push('');
  lines.push('Backend:');
  lines.push(CONFIG.VERSION);
  lines.push('');
  lines.push(`Instalador: ${INSTALLER_VERSION}`);
  lines.push('');

  if (stepError) {
    lines.push('ERROR:');
    lines.push(stepError);
    lines.push('');
    lines.push('Pasos completados antes del error:');
    stepsLog.forEach(s => lines.push(`✓ ${s.step}`));
    lines.push('');
    lines.push('El Spreadsheet YA fue creado y su ID YA quedó configurado en');
    lines.push('Script Properties (SPREADSHEET_ID) -- esto es intencional, para que');
    lines.push('NUNCA se cree un segundo Spreadsheet. Para reintentar completar');
    lines.push('esta MISMA instalación, ejecute verificarYRepararInstalacion() --');
    lines.push('todos los pasos ya completados se saltan de forma segura y solo se');
    lines.push('reintentan los que faltan.');
  } else {
    lines.push('Hojas:');
    lines.push(`${verification.sheetsOkCount === verification.sheetsTotalCount ? '✓' : '✗'} ${verification.sheetsOkCount}/${verification.sheetsTotalCount}`);
    lines.push('');
    lines.push('Encabezados:');
    lines.push(verification.sheetsOkCount === verification.sheetsTotalCount ? '✓ OK' : '✗ INCOMPLETOS -- ver detalle de hojas arriba.');
    lines.push('');
    lines.push('Roles:');
    lines.push(`${verification.rolesOk ? '✓' : '✗'} ${verification.rolesOkCount}/5`);
    lines.push('');
    lines.push('Permisos:');
    lines.push((verification.permissionsOk.vista && verification.permissionsOk.creditosFavor) ? '✓ OK' : '✗ INCOMPLETOS');
    lines.push('');
    lines.push('Secuencias:');
    lines.push(verification.sequencesOk ? '✓ OK' : `✗ Faltan: ${verification.sequencesMissing.join(', ')}`);
    lines.push('');
    lines.push('Datos comerciales:');
    lines.push(verification.commercialDataEmpty ? '✓ BD VACÍA' : `✗ CONTIENE DATOS -- ${verification.nonEmptyCommercialEntities.map(e => `${e.sheet}=${e.count}`).join(', ')}`);
    lines.push('');
    COMMERCIAL_ENTITIES_REPORT_LABELS.forEach(({ sheet, label }) => {
      lines.push(`${label}:`);
      lines.push(String(verification.commercialCounts[sheet] !== undefined ? verification.commercialCounts[sheet] : '?'));
      lines.push('');
    });
    lines.push('Administrador inicial:');
    lines.push(verification.initialAdminConfigured ? '✓ CONFIGURADO' : '⚠ PENDIENTE DE CONFIGURACIÓN');
    lines.push('');
    if (!success && verification.errors.length > 0) {
      lines.push('Errores de verificación:');
      verification.errors.forEach(e => lines.push(`- ${e}`));
      lines.push('');
    }
    lines.push('Próximo paso:');
    lines.push(
      verification.initialAdminConfigured
        ? 'La instalación ya tiene un administrador configurado -- inicie sesión normalmente desde el frontend.'
        : 'Deploy Web App y abrir el frontend para crear el administrador.'
    );
  }
  lines.push('');
  lines.push('========================================');

  const report = lines.join('\n');
  Logger.log(report);

  return {
    success: success,
    installationId: meta.installationId,
    installationName: meta.installationName,
    spreadsheetId: spreadsheetIdFromProps,
    spreadsheetUrl: spreadsheet ? spreadsheet.getUrl() : undefined,
    isNewInstall: meta.isNewInstall,
    stepError: stepError || null,
    verification: verification,
    report: report
  };
}

/* ================================================================
   TAREA — INSTALACIÓN LIMPIA + CONFIGURACIÓN SEGURA DEL PRIMER ADMIN.

   Tres piezas nuevas, expuestas vía Main.gs:
     system.installationStatus  (pública, solo lectura, sin datos sensibles)
     system.setupInitialAdmin   (pública, protegida por su propia lógica +
                                  LockService, crea el ÚNICO primer ADMIN)
     migrateInitialAdminStatus  (idempotente, recalcula
                                  INITIAL_ADMIN_CONFIGURED desde el estado
                                  REAL de Usuarios -- para instalaciones
                                  existentes anteriores a esta tarea)
   ================================================================ */

/**
 * Fase 13 -- ¿ya existe al menos un ADMIN real (rol=ADMIN, con
 * password_hash real) en esta instalación? No mira `estado` (activo/
 * inactivo) a propósito: lo que importa aquí es si el paso de "crear el
 * primer administrador" ya se completó alguna vez, no si ese usuario
 * sigue activo hoy -- desactivar al admin más adelante nunca debe
 * reabrir la ventana de configuración inicial.
 */
function hasAnyRealAdmin_() {
  const users = DbHelper.getAllRows('Usuarios');
  return users.some(u => String(u.rol).trim() === 'ADMIN' && String(u.password_hash || '').trim() !== '');
}

/**
 * MIGRACIÓN IDEMPOTENTE (Fase 13) -- recalcula SIEMPRE
 * INITIAL_ADMIN_CONFIGURED a partir del estado real de Usuarios. Nunca
 * crea, borra ni modifica ningún usuario ni contraseña -- de solo
 * lectura sobre Usuarios, de escritura solo sobre esa una Script
 * Property. Segura de ejecutar en cualquier instalación, nueva o
 * existente, cuantas veces se quiera.
 */
function migrateInitialAdminStatus() {
  const props = PropertiesService.getScriptProperties();
  const hasAdmin = hasAnyRealAdmin_();
  props.setProperty('INITIAL_ADMIN_CONFIGURED', hasAdmin ? 'true' : 'false');
  Logger.log(`[SetupInstaller] migrateInitialAdminStatus -- INITIAL_ADMIN_CONFIGURED=${hasAdmin}.`);
  return { success: true, initialAdminConfigured: hasAdmin };
}

/**
 * `system.installationStatus` -- acción PÚBLICA (Fase 6), consultada por
 * el frontend justo después de validar la URL del backend, ANTES de
 * cualquier login. Nunca devuelve contraseñas, hashes, usuarios, ni
 * ningún dato comercial -- solo dos booleanos.
 */
function handleInstallationStatus_() {
  let installationConfigured = false;
  try {
    getSpreadsheet();
    installationConfigured = true;
  } catch (e) {
    installationConfigured = false;
  }

  if (!installationConfigured) {
    return { success: true, installationConfigured: false, initialAdminConfigured: false };
  }

  // Auto-sanación: si INITIAL_ADMIN_CONFIGURED nunca se fijó (instalación
  // real anterior a esta tarea, que nunca ejecutó
  // migrateInitialAdminStatus() a mano), se deriva en vivo desde Usuarios
  // -- nunca deja a una instalación real, ya en uso, mostrando por error
  // la pantalla de "crear administrador".
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('INITIAL_ADMIN_CONFIGURED');
  let initialAdminConfigured;
  if (raw === 'true') {
    initialAdminConfigured = true;
  } else if (raw === 'false') {
    initialAdminConfigured = false;
  } else {
    initialAdminConfigured = hasAnyRealAdmin_();
  }

  return { success: true, installationConfigured: true, initialAdminConfigured: initialAdminConfigured };
}

/**
 * `system.setupInitialAdmin` -- acción PÚBLICA (Fase 7), crea el PRIMER y
 * ÚNICO administrador de una instalación recién configurada. Rol
 * SIEMPRE 'ADMIN' -- el cliente nunca puede elegir otro (Fase 7,
 * explícito: ni siquiera se lee `data.rol`). Password hasheada con el
 * MISMO mecanismo real de siempre (Security.generateSalt/hashPassword).
 * Concurrencia (Fase 9): todo el flujo (comprobación + validación +
 * creación + marcado de INITIAL_ADMIN_CONFIGURED) vive DENTRO de
 * LockServiceHelper.runWithLock -- dos requests simultáneos nunca pueden
 * crear dos administradores iniciales. Atomicidad (Fase 10):
 * INITIAL_ADMIN_CONFIGURED solo se marca 'true' DESPUÉS de que el usuario
 * ya fue insertado con éxito -- un error antes de ese punto dejar
 * reintentar sin quedar la instalación bloqueada.
 */
function handleSetupInitialAdmin_(data) {
  const nombre = data && data.nombre ? String(data.nombre).trim() : '';
  const usuario = data && data.usuario ? String(data.usuario).trim().toLowerCase() : '';
  const password = data && data.password ? String(data.password) : '';

  // Fase 8 -- validaciones (antes del lock: son solo de forma, no
  // dependen de estado compartido, no hace falta serializarlas).
  if (!nombre) throw new Error('VALIDATION_ERROR: El nombre es obligatorio.');
  if (!usuario) throw new Error('VALIDATION_ERROR: El usuario es obligatorio.');
  if (!/^[a-z0-9_.-]{3,40}$/.test(usuario)) {
    throw new Error('VALIDATION_ERROR: El usuario debe tener entre 3 y 40 caracteres (letras minúsculas, números, punto, guion o guion bajo).');
  }
  if (!password) throw new Error('VALIDATION_ERROR: La contraseña es obligatoria.');
  if (password.length < 8) throw new Error('VALIDATION_ERROR: La contraseña debe tener al menos 8 caracteres.');

  return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
    // Fase 8 -- primer ADMIN todavía no configurado (re-chequeo REAL
    // dentro del lock, nunca confía solo en la Script Property -- un
    // ADMIN real ya existente es motivo de rechazo aunque, por lo que
    // sea, la property no se hubiera marcado todavía).
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('INITIAL_ADMIN_CONFIGURED') === 'true' || hasAnyRealAdmin_()) {
      throw new Error('INITIAL_ADMIN_ALREADY_CONFIGURED: Esta instalación ya tiene un administrador configurado. Inicie sesión normalmente o contacte a su administrador.');
    }

    // Fase 8 -- usuario no duplicado.
    const existingUsers = DbHelper.getAllRows('Usuarios');
    const isDuplicate = existingUsers.some(u => String(u.usuario).trim().toLowerCase() === usuario);
    if (isDuplicate) {
      throw new Error('DUPLICATE_USER: Ese nombre de usuario ya está en uso.');
    }

    // Fase 7 -- MISMO mecanismo de hashing real que AuthController.
    // handleSaveUser/seedDemoData_(), ningún algoritmo nuevo.
    const newId = Sequences.getNext('USR');
    const salt = Security.generateSalt(16);
    const hash = Security.hashPassword(password, salt);
    const nowStr = getNowFormatted();

    const newRow = {
      id: newId,
      usuario: usuario,
      nombre: nombre,
      apellido: (data && data.apellido ? String(data.apellido).trim() : ''),
      correo: (data && data.correo ? String(data.correo).trim().toLowerCase() : ''),
      telefono: (data && data.telefono ? String(data.telefono).trim() : ''),
      rol: 'ADMIN', // Fase 7: SIEMPRE ADMIN -- data.rol nunca se lee.
      estado: 'ACTIVO',
      password_hash: hash,
      password_salt: salt,
      avatar: '',
      creado_en: nowStr,
      ultimo_acceso: ''
    };

    DbHelper.insertRow('Usuarios', newRow);

    // Fase 10 -- atomicidad: SOLO se marca configurado DESPUÉS de que la
    // fila ya se insertó con éxito arriba.
    props.setProperty('INITIAL_ADMIN_CONFIGURED', 'true');

    // Fase 15 -- auditoría: usuario/nombre/rol/fecha/instalación,
    // JAMÁS contraseña/hash/token/secreto (se confirma con una prueba
    // dedicada que escanea todo lo registrado en este flujo).
    AuditController.log(
      null,
      'INITIAL_ADMIN_CREATED',
      'AUTH',
      'User',
      newId,
      `Administrador inicial ${usuario} (${nombre}) creado para la instalación ${props.getProperty('INSTALLATION_ID') || ''}.`,
      { usuario: usuario, nombre: nombre, rol: 'ADMIN', instalacion: props.getProperty('INSTALLATION_ID') || '' },
      'EXITO'
    );

    return {
      success: true,
      message: 'Administrador creado exitosamente. Ya puede iniciar sesión.',
      userId: newId
    };
  });
}
