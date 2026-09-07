'use strict';

/*
 * TAREA — CREAR INSTALADOR AUTOMÁTICO DE NUEVAS INSTALACIONES / NUEVAS BD.
 *
 * Arnés AISLADO, separado de run-tests.cjs a propósito: ese arnés
 * comparte UN solo Spreadsheet mock con SPREADSHEET_ID YA configurado
 * desde su primera línea (`setupDatabase(); seedInitialData();` corridas
 * antes de cualquier test) -- el escenario exacto de "esta copia de Apps
 * Script ya tiene una instalación configurada" (CASO B de
 * setupNuevaInstalacion(), ya probado allí). No hay forma de simular ahí
 * "SPREADSHEET_ID todavía no existe / SpreadsheetApp.create() real" sin
 * romper las otras 300+ pruebas que dependen de ese estado compartido.
 *
 * Este arnés en cambio arranca cada prueba con Script Properties
 * COMPLETAMENTE VACÍO (ninguna instalación configurada todavía) y un
 * SpreadsheetApp.create(nombre) real (mock) que crea un Spreadsheet
 * NUEVO e independiente cada vez que se llama -- exactamente la
 * precondición real de una copia recién hecha del proyecto MASTER.
 *
 * Reutiliza los mismos.gs REALES del backend (Config/DbHelper/
 * LockServiceHelper/Sequences/Security/AuditController/ProductsController/
 * RolesController/SeedSetup/SetupInstaller/Main -- el mismo loadOrder que
 * run-tests.cjs) -- ninguna lógica de instalación se reimplementa aquí,
 * solo el sandbox de APIs de Apps Script cambia.
 *
 * LÍMITE EXPLÍCITO (Fase 14 de la tarea): esto sigue siendo un mock de
 * Node, no Google Apps Script real. NO verifica: cuotas reales de Drive/
 * Sheets, límites de tiempo de ejecución reales, permisos/alcances OAuth
 * reales de una cuenta de Google, ni que `SpreadsheetApp.create()` real
 * efectivamente cree un archivo visible en Drive. Esas partes requieren
 * ejecutar `setupNuevaInstalacion()` manualmente en el editor de Apps
 * Script contra un proyecto y una cuenta reales -- documentado también en
 * el reporte final de esta fase.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const APPS_SCRIPT_DIR = path.join(__dirname, '..', 'apps-script');

/* ------------------------------------------------------------
   MOCK: hoja de cálculo en memoria -- MISMA implementación verificada
   que run-tests.cjs (MockRange/MockSheet), copiada aquí porque este
   arnés necesita su PROPIA instancia de PropertiesService/SpreadsheetApp
   (estado aislado por prueba), no puede importar el módulo del otro
   arnés (que ejecuta su propio seed real al cargarse).
   ------------------------------------------------------------ */
class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
  }
  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      const actualRow = this.row + r - 1;
      const rowData = this.sheet.data[actualRow] || [];
      for (let c = 0; c < this.numCols; c++) {
        const actualCol = this.col + c - 1;
        const v = rowData[actualCol];
        rowArr.push(v === undefined ? '' : v);
      }
      result.push(rowArr);
    }
    return result;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const actualRow = this.row + r - 1;
      if (!this.sheet.data[actualRow]) this.sheet.data[actualRow] = [];
      for (let c = 0; c < values[r].length; c++) {
        const actualCol = this.col + c - 1;
        this.sheet.data[actualRow][actualCol] = values[r][c];
      }
    }
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class MockSheet {
  constructor(name) { this.name = name; this.data = []; }
  getMaxRows() { return this.data.length; }
  insertRows() { if (this.data.length === 0) this.data.push([]); }
  getLastColumn() {
    let max = 0;
    for (const row of this.data) if (row && row.length > max) max = row.length;
    return max;
  }
  getLastRow() { return this.data.length; }
  getRange(row, col, numRows, numCols) { return new MockRange(this, row, col, numRows || 1, numCols || 1); }
  getDataRange() { return new MockRange(this, 1, 1, this.data.length, this.getLastColumn()); }
  appendRow(rowArr) { this.data.push(rowArr.slice()); }
  deleteRow(rowIndex) { this.data.splice(rowIndex - 1, 1); }
  setFrozenRows() { return this; }
  autoResizeColumns() { return this; }
  getSheetName() { return this.name; }
}

class MockSpreadsheet {
  constructor(id, name) { this.sheetsByName = {}; this._id = id; this._name = name; }
  getSheetByName(name) { return this.sheetsByName[name] || null; }
  insertSheet(name) {
    const s = new MockSheet(name);
    s._owner = this;
    this.sheetsByName[name] = s;
    return s;
  }
  getName() { return this._name; }
  getId() { return this._id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this._id}/edit`; }
  deleteSheet(sheet) { if (this.sheetsByName[sheet.name] === sheet) delete this.sheetsByName[sheet.name]; }
  getSheets() { return Object.values(this.sheetsByName); }
}

/* ------------------------------------------------------------
   MOCK: DriveApp mínimo (getOrCreateProductImagesFolder)
   ------------------------------------------------------------ */
let mockDriveIdCounter = 0;
const driveFoldersById = new Map();
const driveFoldersByName = new Map();
class MockDriveFolder {
  constructor(id, name) { this._id = id; this._name = name; }
  getId() { return this._id; }
  getName() { return this._name; }
  getUrl() { return `https://drive.google.com/drive/folders/${this._id}`; }
}
function mockDriveFolderIterator(list) {
  let idx = 0;
  return { hasNext() { return idx < list.length; }, next() { return list[idx++]; } };
}

/* ------------------------------------------------------------
   MOCK: PropertiesService / Utilities / LockService / Logger
   ------------------------------------------------------------ */
function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(date, tz, fmt) {
  if (fmt === 'yyyy-MM-dd') {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (type) => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  const yyyy = date.getFullYear(), MM = pad(date.getMonth() + 1), dd = pad(date.getDate());
  const HH = pad(date.getHours()), mm = pad(date.getMinutes()), ss = pad(date.getSeconds());
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}

/**
 * Construye un sandbox de ejecución COMPLETAMENTE NUEVO e independiente
 * -- Script Properties vacío (ninguna instalación configurada) y un
 * SpreadsheetApp.create() que registra cada Spreadsheet creado, para que
 * cada prueba pueda partir de cero sin contaminar a las demás.
 */
function buildFreshContext() {
  const logLines = [];
  const scriptProperties = {}; // VACÍO -- ninguna instalación configurada todavía.
  const createdSpreadsheets = []; // Para aserciones de "se creó exactamente 1".
  let spreadsheetIdCounter = 0;
  // LÍMITE EXPLÍCITO: este mock es de un solo hilo (Node), nunca puede
  // reproducir una condición de carrera REAL entre dos peticiones HTTP
  // simultáneas -- `tryLock()` aquí SIEMPRE "gana" inmediatamente. Lo
  // único verificable en este entorno es que el código de
  // setupInitialAdmin_ REALMENTE pasa por LockService (adquiere y libera
  // el lock exactamente una vez por llamada) -- no que la exclusión mutua
  // funcione bajo concurrencia real, que solo puede probarse contra Apps
  // Script real.
  const lockLog = [];
  const cacheStore = new Map(); // TAREA -- PRIMER ADMIN: necesario para CacheService (sesiones reales de auth.login/auth.saveUser, ejercitadas por los tests de doPostRaw).

  const sandbox = {
    console,
    JSON, Object, Array, String, Number, Math, Date, isNaN, parseInt, parseFloat, RegExp, Error, Map, Set, Boolean,

    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return scriptProperties[key] !== undefined ? scriptProperties[key] : null; },
          setProperty(key, value) { scriptProperties[key] = value; },
          setProperties(map) { Object.keys(map).forEach(k => { scriptProperties[k] = map[k]; }); }
        };
      }
    },

    SpreadsheetApp: {
      create(name) {
        const id = `MOCK-NEW-SPREADSHEET-${++spreadsheetIdCounter}`;
        const ss = new MockSpreadsheet(id, name);
        createdSpreadsheets.push(ss);
        return ss;
      },
      openById(id) {
        const found = createdSpreadsheets.find(s => s.getId() === id);
        if (!found) throw new Error(`Mock: no existe un Spreadsheet con ID '${id}'`);
        return found;
      },
      getActiveSpreadsheet() { return null; } // Script MASTER standalone -- nunca hay una hoja "activa".
    },

    Utilities: {
      formatDate,
      computeDigest(_algorithm, input) {
        const hash = crypto.createHash('sha256').update(String(input), 'utf8').digest();
        return Array.from(hash).map(b => (b > 127 ? b - 256 : b));
      },
      getUuid() { return crypto.randomUUID(); },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },

    LockService: {
      getScriptLock() {
        return {
          tryLock() { lockLog.push('tryLock'); return true; },
          releaseLock() { lockLog.push('releaseLock'); }
        };
      }
    },

    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      getFoldersByName(name) { return mockDriveFolderIterator(driveFoldersByName.get(name) || []); },
      getFolderById(id) {
        const folder = driveFoldersById.get(id);
        if (!folder) throw new Error(`Mock: no existe una carpeta de Drive con ID '${id}'`);
        return folder;
      },
      createFolder(name) {
        const folder = new MockDriveFolder(`MOCK-FOLDER-${++mockDriveIdCounter}`, name);
        driveFoldersById.set(folder.getId(), folder);
        const list = driveFoldersByName.get(name) || [];
        list.push(folder);
        driveFoldersByName.set(name, list);
        return folder;
      }
    },

    Logger: { log(...args) { logLines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); } },

    CacheService: {
      getScriptCache() {
        return {
          get(key) {
            const entry = cacheStore.get(key);
            if (!entry) return null;
            if (Date.now() > entry.expiresAt) { cacheStore.delete(key); return null; }
            return entry.value;
          },
          put(key, value, ttlSeconds) {
            cacheStore.set(key, { value: String(value), expiresAt: Date.now() + (ttlSeconds || 600) * 1000 });
          },
          remove(key) { cacheStore.delete(key); }
        };
      }
    },

    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(str) {
        return {
          _content: str,
          setMimeType() { return this; },
          getContent() { return this._content; }
        };
      }
    }
  };

  const context = vm.createContext(sandbox);
  return { context, logLines, scriptProperties, createdSpreadsheets, lockLog };
}

/* ------------------------------------------------------------
   CARGAR TODOS LOS .gs REALES, mismo loadOrder que run-tests.cjs.
   ------------------------------------------------------------ */
const loadOrder = [
  'Config.gs', 'DbHelper.gs', 'LockServiceHelper.gs', 'Sequences.gs', 'Security.gs',
  'AuditController.gs', 'AuthController.gs', 'ProductsController.gs', 'CustomersController.gs',
  'SalesController.gs', 'InventoryController.gs', 'CreditsController.gs', 'CashController.gs',
  'ExpensesController.gs', 'PurchasesController.gs', 'ReturnsController.gs', 'SettingsController.gs',
  'CreditNotesController.gs', 'RestoreController.gs', 'RolesController.gs', 'SeedSetup.gs',
  'SetupInstaller.gs', 'Main.gs'
];
const combinedSource = loadOrder.map(f => fs.readFileSync(path.join(APPS_SCRIPT_DIR, f), 'utf8')).join('\n\n');

/* ------------------------------------------------------------
   TEST RUNNER
   ------------------------------------------------------------ */
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, outcome: 'PASSED' });
  } catch (e) {
    results.push({ name, outcome: 'FAILED', error: e.message });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || 'assertEqual failed') + ` (esperado=${JSON.stringify(b)}, obtenido=${JSON.stringify(a)})`);
}

/**
 * Cada prueba obtiene su PROPIO sandbox fresco (Script Properties vacío,
 * ningún Spreadsheet creado todavía) -- ninguna prueba puede contaminar
 * el estado de otra, a diferencia de run-tests.cjs (deliberado ahí,
 * inapropiado aquí).
 */
function withFreshInstall(fn) {
  const { context, logLines, scriptProperties, createdSpreadsheets, lockLog } = buildFreshContext();
  new vm.Script(combinedSource, { filename: 'combined.gs' }).runInContext(context);
  const runInContext = (code) => new vm.Script(code, { filename: 'run.gs' }).runInContext(context);
  // Mismo patrón que doPostRaw en run-tests.cjs -- ejercita el despacho
  // REAL de Main.gs (publicActions, permisos, dispatcher), no una
  // llamada directa a la función interna.
  const doPostRaw = (action, data, sessionToken) => {
    const event = { postData: { contents: JSON.stringify({ action, sessionToken, data: data || {} }) } };
    context.__event = event;
    const raw = runInContext('doPost(__event).getContent()');
    return JSON.parse(raw);
  };
  fn({ runInContext, doPostRaw, logLines, scriptProperties, createdSpreadsheets, lockLog, context });
}

/* ================================================================
   CASO A -- INSTALACIÓN COMPLETAMENTE NUEVA
   ================================================================ */

test('FRESH_INSTALL_DETECTS_NO_EXISTING_INSTALLATION', () => {
  withFreshInstall(({ scriptProperties }) => {
    assert(!scriptProperties.SPREADSHEET_ID, 'precondición: ningún SPREADSHEET_ID configurado todavía');
  });
});

test('FRESH_INSTALL_CREATES_SPREADSHEET_AND_SAVES_ID_VIA_EXISTING_MECHANISM', () => {
  withFreshInstall(({ runInContext, scriptProperties, createdSpreadsheets }) => {
    const res = runInContext(`setupNuevaInstalacion('Cliente Demo')`);
    assert(res.success === true, JSON.stringify(res));
    assertEqual(createdSpreadsheets.length, 1, 'debe crear exactamente UN Spreadsheet');
    assertEqual(createdSpreadsheets[0].getName(), 'Cliente Demo');
    // El mecanismo EXISTENTE (setSpreadsheetId/Config.gs) es el que
    // realmente guardó el ID -- se confirma leyendo Script Properties
    // directamente, no solo el valor devuelto por el instalador.
    assertEqual(scriptProperties.SPREADSHEET_ID, createdSpreadsheets[0].getId());
    assertEqual(res.spreadsheetId, createdSpreadsheets[0].getId());
  });
});

test('FRESH_INSTALL_USES_DEFAULT_NAME_WHEN_NONE_PROVIDED', () => {
  withFreshInstall(({ runInContext, createdSpreadsheets }) => {
    const res = runInContext(`setupNuevaInstalacion()`);
    assert(res.success === true, JSON.stringify(res));
    assertEqual(createdSpreadsheets[0].getName(), 'POS CRM - NUEVA INSTALACION');
  });
});

test('FRESH_INSTALL_GENERATES_UNIQUE_INSTALLATION_ID', () => {
  withFreshInstall(({ runInContext, scriptProperties }) => {
    const res = runInContext(`setupNuevaInstalacion()`);
    assert(res.success === true, JSON.stringify(res));
    assert(!!res.installationId, 'debe generar un INSTALLATION_ID');
    assertEqual(scriptProperties.INSTALLATION_ID, res.installationId);
    // Formato UUID real (36 caracteres, guiones en las posiciones correctas).
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(res.installationId), `no parece un UUID real: ${res.installationId}`);
  });
});

test('FRESH_INSTALL_SAVES_ALL_REQUIRED_METADATA', () => {
  withFreshInstall(({ runInContext, scriptProperties }) => {
    runInContext(`setupNuevaInstalacion('Boutique Prueba')`);
    assert(!!scriptProperties.SPREADSHEET_ID, 'falta SPREADSHEET_ID');
    assert(!!scriptProperties.INSTALLATION_ID, 'falta INSTALLATION_ID');
    assertEqual(scriptProperties.INSTALLATION_NAME, 'Boutique Prueba');
    assert(!!scriptProperties.INSTALLATION_DATE, 'falta INSTALLATION_DATE');
    assert(!!scriptProperties.INSTALLER_VERSION, 'falta INSTALLER_VERSION');
    assert(!!scriptProperties.BACKEND_VERSION, 'falta BACKEND_VERSION');
  });
});

test('FRESH_INSTALL_CREATES_ALL_REQUIRED_SHEETS_WITH_CORRECT_HEADERS', () => {
  withFreshInstall(({ runInContext }) => {
    const res = runInContext(`setupNuevaInstalacion()`);
    assert(res.success === true, JSON.stringify(res.verification));
    const schemaNames = runInContext('Object.keys(SCHEMAS)');
    assert(schemaNames.length > 0, 'SCHEMAS debe tener entidades reales');
    schemaNames.forEach(name => {
      const info = res.verification.sheets[name];
      assert(!!info && info.exists && info.headersOk, `hoja '${name}' inválida: ${JSON.stringify(info)}`);
    });
  });
});

test('FRESH_INSTALL_INITIALIZES_ROLES_ADMIN_GERENTE_SUPERVISOR_CAJERO_VENDEDOR', () => {
  withFreshInstall(({ runInContext }) => {
    runInContext(`setupNuevaInstalacion()`);
    const roles = runInContext(`DbHelper.getAllRows('Roles_Permisos').map(r => r.rol)`);
    ['ADMIN', 'GERENTE', 'SUPERVISOR', 'CAJERO', 'VENDEDOR'].forEach(r => assert(roles.includes(r), `falta el rol ${r}`));
    assertEqual(roles.length, 5, 'no debe haber roles extra ni duplicados en una instalación nueva');
  });
});

test('FRESH_INSTALL_ROLES_INCLUDE_VIEW_AND_CREDITOS_FAVOR_PERMISSIONS', () => {
  withFreshInstall(({ runInContext }) => {
    runInContext(`setupNuevaInstalacion()`);
    const cajero = runInContext(`JSON.parse(DbHelper.getAllRows('Roles_Permisos').find(r => r.rol === 'CAJERO').permisos_json)`);
    assert(cajero.includes('vista.pos'), 'CAJERO debe tener vista.pos desde el primer sembrado');
    assert(cajero.includes('creditos_favor.ver'), 'CAJERO debe tener creditos_favor.ver desde el primer sembrado');
    assert(!cajero.includes('vista.dashboard'), 'CAJERO nunca debe tener vista.dashboard por defecto');
  });
});

test('FRESH_INSTALL_INITIALIZES_ALL_REAL_SEQUENCE_PREFIXES', () => {
  withFreshInstall(({ runInContext }) => {
    const res = runInContext(`setupNuevaInstalacion()`);
    assertEqual(res.verification.sequencesOk, true, `faltan secuencias: ${JSON.stringify(res.verification.sequencesMissing)}`);
    const prefixes = runInContext(`DbHelper.getAllRows('Secuencias').map(r => r.prefijo)`);
    assertEqual(prefixes.length, new Set(prefixes).size, 'no debe haber prefijos de secuencia duplicados');
  });
});

// TAREA -- INSTALACIÓN LIMPIA: reemplaza la expectativa anterior (esta
// misma prueba, en la fase previa, exigía que existieran admin/cajero/
// gerente). Ahora es exactamente lo contrario -- Fase 22, ítems 9-13.
test('FRESH_INSTALL_HAS_ZERO_USERS_NO_SEED_CREDENTIALS_WHATSOEVER', () => {
  withFreshInstall(({ runInContext }) => {
    const res = runInContext(`setupNuevaInstalacion()`);
    assert(res.success === true, JSON.stringify(res.verification));
    const usuarios = runInContext(`DbHelper.getAllRows('Usuarios')`);
    assertEqual(usuarios.length, 0, 'una instalación nueva NUNCA debe tener usuarios predeterminados');
    ['admin', 'cajero', 'gerente'].forEach(u => {
      assert(!usuarios.some(row => row.usuario === u), `no debe existir el usuario semilla '${u}'`);
    });
    assertEqual(res.verification.commercialCounts.Usuarios, 0);
  });
});

test('FRESH_INSTALL_HAS_ZERO_ROWS_IN_EVERY_COMMERCIAL_ENTITY', () => {
  withFreshInstall(({ runInContext }) => {
    const res = runInContext(`setupNuevaInstalacion()`);
    assert(res.success === true, JSON.stringify(res.verification));
    assertEqual(res.verification.commercialDataEmpty, true, JSON.stringify(res.verification.nonEmptyCommercialEntities));
    const entities = runInContext(`
      ['Productos','Variantes','Clientes','Ventas','Venta_Items','Compras','Gastos','Devoluciones',
       'Abonos','Creditos','Creditos_Favor','Creditos_Favor_Aplicaciones','Inventario_Kardex',
       'Cajas','Caja_Movimientos','Proveedores','Categorias','Tallas','Colores','Usuarios']
        .reduce((acc, name) => { acc[name] = DbHelper.getAllRows(name).length; return acc; }, {})
    `);
    Object.keys(entities).forEach(name => assertEqual(entities[name], 0, `${name} debe tener 0 registros, tiene ${entities[name]}`));
  });
});

test('FRESH_INSTALL_CONFIGURACION_HAS_TECHNICAL_DEFAULTS_BUT_EMPTY_BUSINESS_IDENTITY', () => {
  withFreshInstall(({ runInContext }) => {
    runInContext(`setupNuevaInstalacion()`);
    const config = runInContext(`
      DbHelper.getAllRows('Configuracion').reduce((acc, r) => { acc[r.clave] = r.valor; return acc; }, {})
    `);
    // Campos de identidad comercial: vacíos, NUNCA "ZIO CLOTHES" ni ningún otro valor ficticio.
    ['nombreNegocio', 'rnc', 'telefono', 'correo', 'direccion', 'pieTicket', 'politicaDevolucion'].forEach(key => {
      assertEqual(config[key], '', `${key} debe quedar vacío en una instalación nueva, no un valor de demostración`);
    });
    // Campos técnicos: SÍ deben tener un default real y seguro.
    assertEqual(config.moneda, 'RD$');
    assertEqual(config.impuestoPorcentaje, '18');
    assertEqual(config.permitirVentaSinStock, 'false');
  });
});

test('FRESH_INSTALL_NEVER_LOGS_SEED_PASSWORDS', () => {
  withFreshInstall(({ runInContext, logLines }) => {
    runInContext(`setupNuevaInstalacion()`);
    const fullText = logLines.join('\n');
    ['admin123', 'cajero123', 'gerente123'].forEach(pw => {
      assert(fullText.indexOf(pw) === -1, `el instalador nunca debe imprimir contraseñas en Logger -- se encontró "${pw}"`);
    });
  });
});

test('FRESH_INSTALL_FINAL_VERIFICATION_REPORTS_SUCCESS', () => {
  withFreshInstall(({ runInContext }) => {
    const res = runInContext(`setupNuevaInstalacion('Cliente Verificación')`);
    assert(res.success === true, JSON.stringify(res.verification));
    assert(res.report.indexOf('INSTALACIÓN POS CRM COMPLETADA') !== -1);
    assert(res.report.indexOf('Estado: EXITOSA') !== -1);
    assert(res.report.indexOf('✓ BD VACÍA') !== -1, 'el reporte debe confirmar explícitamente que la BD comercial quedó vacía');
    assert(res.report.indexOf('⚠ PENDIENTE DE CONFIGURACIÓN') !== -1, 'el reporte debe indicar que el administrador todavía no se ha creado');
    assert(res.verification.initialAdminConfigured === false);
  });
});

test('FRESH_INSTALL_SETS_INITIAL_ADMIN_CONFIGURED_FALSE', () => {
  withFreshInstall(({ runInContext, scriptProperties }) => {
    runInContext(`setupNuevaInstalacion()`);
    assertEqual(scriptProperties.INITIAL_ADMIN_CONFIGURED, 'false');
  });
});

/* ================================================================
   IDEMPOTENCIA / SEGURIDAD (Fase 8) -- ejecutar dos veces
   ================================================================ */

test('RUNNING_TWICE_NEVER_CREATES_A_SECOND_SPREADSHEET', () => {
  withFreshInstall(({ runInContext, createdSpreadsheets }) => {
    const first = runInContext(`setupNuevaInstalacion('Instalación Única')`);
    assert(first.success === true, JSON.stringify(first));
    assertEqual(createdSpreadsheets.length, 1);

    const second = runInContext(`setupNuevaInstalacion('Instalación Única')`);
    assert(second.success === false, 'la segunda ejecución debe rechazarse, nunca crear otra base de datos');
    assert(second.alreadyConfigured === true);
    assertEqual(createdSpreadsheets.length, 1, 'NUNCA debe existir un segundo Spreadsheet tras ejecutar dos veces');
    assertEqual(second.spreadsheetId, first.spreadsheetId);
  });
});

test('RUNNING_TWICE_NEVER_DELETES_OR_ALTERS_DATA_FROM_THE_FIRST_RUN', () => {
  withFreshInstall(({ runInContext }) => {
    runInContext(`setupNuevaInstalacion()`);
    // Simula actividad real del cliente entre la instalación y el
    // segundo intento accidental: un cliente y una categoría reales.
    runInContext(`DbHelper.insertRow('Clientes', { id: 'CLI-REAL-001', nombre: 'Cliente Real del Negocio', apellido: '', documento: '', telefono: '809-000-0000', correo: '', direccion: '', ciudad: '', limite_credito: 0, dias_credito_por_defecto: 15, notas: '', estado: 'ACTIVO', creado_en: getNowFormatted() })`);
    const customersBefore = runInContext(`DbHelper.getAllRows('Clientes').length`);
    const usersBefore = runInContext(`DbHelper.getAllRows('Usuarios').length`);

    const second = runInContext(`setupNuevaInstalacion()`);
    assert(second.success === false);

    const customersAfter = runInContext(`DbHelper.getAllRows('Clientes').length`);
    const usersAfter = runInContext(`DbHelper.getAllRows('Usuarios').length`);
    assertEqual(customersAfter, customersBefore, 'el segundo intento rechazado nunca debe tocar datos reales ya escritos');
    assertEqual(usersAfter, usersBefore);
  });
});

test('REPAIR_FUNCTION_COMPLETES_AN_INSTALLATION_LEFT_MID_WAY', () => {
  // Simula una instalación que quedó a medias: SPREADSHEET_ID configurado
  // (setSpreadsheetId ya corrió) pero setupDatabase/seedInitialData
  // TODAVÍA NO -- exactamente lo que setupNuevaInstalacion() deja atrás
  // si algo falla justo después de crear el Spreadsheet.
  withFreshInstall(({ runInContext, createdSpreadsheets }) => {
    const id = runInContext(`
      (function() {
        const ss = SpreadsheetApp.create('Instalación Interrumpida');
        setSpreadsheetId(ss.getId());
        return ss.getId();
      })();
    `);
    assertEqual(createdSpreadsheets.length, 1);
    const sheetsBefore = runInContext(`SpreadsheetApp.openById(${JSON.stringify(id)}).getSheets().length`);
    assertEqual(sheetsBefore, 0, 'precondición: el Spreadsheet está vacío, la instalación quedó a medias');

    const repaired = runInContext(`verificarYRepararInstalacion()`);
    assert(repaired.success === true, JSON.stringify(repaired.verification));
    assertEqual(createdSpreadsheets.length, 1, 'reparar una instalación a medias NUNCA debe crear un segundo Spreadsheet');
    assertEqual(repaired.spreadsheetId, id);

    const roles = runInContext(`DbHelper.getAllRows('Roles_Permisos').map(r => r.rol)`);
    assertEqual(roles.length, 5, 'la reparación debe completar los roles que faltaban');
  });
});

test('REPAIR_FUNCTION_REFUSES_WHEN_NOTHING_IS_INSTALLED_YET', () => {
  withFreshInstall(({ runInContext }) => {
    const res = runInContext(`verificarYRepararInstalacion()`);
    assert(res.success === false);
    assert(res.message.indexOf('setupNuevaInstalacion() primero') !== -1, res.message);
  });
});

test('SETUP_NEVER_DELETES_SHEETS_EVEN_ON_A_SECOND_ACCIDENTAL_RUN', () => {
  withFreshInstall(({ runInContext }) => {
    runInContext(`setupNuevaInstalacion()`);
    const sheetsBefore = runInContext(`Object.keys(SCHEMAS).length`);
    runInContext(`setupNuevaInstalacion()`); // segunda ejecución, debe rechazarse
    const sheetsAfter = runInContext(`SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')).getSheets().length`);
    assertEqual(sheetsAfter, sheetsBefore, 'ninguna hoja debe desaparecer tras un segundo intento rechazado');
  });
});

/* ================================================================
   TAREA -- CONFIGURACIÓN SEGURA DEL PRIMER ADMIN (Fase 22, ítems 15-27).

   Ejercita el despacho REAL de Main.gs (doPost/publicActions) contra una
   instalación recién creada por setupNuevaInstalacion() -- nunca llama
   handleSetupInitialAdmin_/handleInstallationStatus_ directamente.
   ================================================================ */

test('INSTALLATION_STATUS_REPORTS_FALSE_BEFORE_ANY_ADMIN_EXISTS', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    // Público -- sin sessionToken, como lo llamaría el frontend antes del login.
    const res = doPostRaw('system.installationStatus', {}, undefined);
    assert(res.success === true, JSON.stringify(res));
    assertEqual(res.installationConfigured, true);
    assertEqual(res.initialAdminConfigured, false);
    // Nunca debe filtrar nada más.
    assertEqual(Object.keys(res).sort().join(','), 'initialAdminConfigured,installationConfigured,success');
  });
});

test('INSTALLATION_STATUS_REPORTS_INSTALLATION_NOT_CONFIGURED_WHEN_NO_SPREADSHEET_ID', () => {
  withFreshInstall(({ doPostRaw }) => {
    // Nunca se ejecutó setupNuevaInstalacion() -- SPREADSHEET_ID no existe.
    const res = doPostRaw('system.installationStatus', {}, undefined);
    assert(res.success === true, JSON.stringify(res));
    assertEqual(res.installationConfigured, false);
    assertEqual(res.initialAdminConfigured, false);
  });
});

test('SETUP_INITIAL_ADMIN_CREATES_ADMIN_AND_UPDATES_INSTALLATION_STATUS', () => {
  withFreshInstall(({ runInContext, doPostRaw, scriptProperties }) => {
    runInContext(`setupNuevaInstalacion()`);
    const res = doPostRaw('system.setupInitialAdmin', { nombre: 'María Pérez', usuario: 'maria', password: 'ClaveSegura123' }, undefined);
    assert(res.success === true, JSON.stringify(res));
    assert(!!res.userId, 'debe devolver el ID real del usuario creado');

    const user = runInContext(`DbHelper.findById('Usuarios', ${JSON.stringify(res.userId)})`);
    assert(!!user, 'el usuario debe existir realmente en Usuarios');
    assertEqual(user.usuario, 'maria');
    assertEqual(user.nombre, 'María Pérez');
    assertEqual(user.rol, 'ADMIN', 'el rol SIEMPRE debe ser ADMIN, sin importar qué se envíe');
    assertEqual(user.estado, 'ACTIVO');

    assertEqual(scriptProperties.INITIAL_ADMIN_CONFIGURED, 'true');
    const statusAfter = doPostRaw('system.installationStatus', {}, undefined);
    assertEqual(statusAfter.initialAdminConfigured, true);
  });
});

test('SETUP_INITIAL_ADMIN_IGNORES_A_CLIENT_SUPPLIED_ROLE', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const res = doPostRaw('system.setupInitialAdmin', { nombre: 'Intento', usuario: 'intento1', password: 'ClaveSegura123', rol: 'CAJERO' }, undefined);
    assert(res.success === true, JSON.stringify(res));
    const user = runInContext(`DbHelper.findById('Usuarios', ${JSON.stringify(res.userId)})`);
    assertEqual(user.rol, 'ADMIN', 'un rol enviado por el cliente jamás debe respetarse -- siempre ADMIN');
  });
});

test('SETUP_INITIAL_ADMIN_PASSWORD_IS_HASHED_WITH_THE_REAL_EXISTING_MECHANISM', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const res = doPostRaw('system.setupInitialAdmin', { nombre: 'María Pérez', usuario: 'maria', password: 'ClaveSegura123' }, undefined);
    const user = runInContext(`DbHelper.findById('Usuarios', ${JSON.stringify(res.userId)})`);
    assert(!!user.password_salt, 'debe tener un salt real');
    assert(!!user.password_hash, 'debe tener un hash real');
    assert(user.password_hash !== 'ClaveSegura123', 'la contraseña nunca debe guardarse en texto plano');
    // Mismo algoritmo real que Security.hashPassword -- se recalcula aquí
    // con la MISMA función real (nunca una reimplementación paralela) y
    // debe coincidir exactamente.
    const recomputed = runInContext(`Security.hashPassword('ClaveSegura123', ${JSON.stringify(user.password_salt)})`);
    assertEqual(user.password_hash, recomputed, 'debe usar exactamente Security.hashPassword, ningún algoritmo nuevo');
  });
});

test('SETUP_INITIAL_ADMIN_NEVER_LOGS_OR_RETURNS_THE_PASSWORD', () => {
  withFreshInstall(({ runInContext, doPostRaw, logLines }) => {
    runInContext(`setupNuevaInstalacion()`);
    const before = logLines.length;
    const res = doPostRaw('system.setupInitialAdmin', { nombre: 'María Pérez', usuario: 'maria', password: 'ClaveMuySecreta999' }, undefined);
    assert(res.success === true, JSON.stringify(res));
    // Ítem 19 -- nunca en la respuesta de la API.
    const responseText = JSON.stringify(res);
    assert(responseText.indexOf('ClaveMuySecreta999') === -1, 'la contraseña nunca debe aparecer en la respuesta de la API');
    assert(!('password' in res) && !('password_hash' in res) && !('password_salt' in res), 'la respuesta nunca debe incluir ningún campo de contraseña');
    // Ítem 18 -- nunca en Logger.
    const newLogText = logLines.slice(before).join('\n');
    assert(newLogText.indexOf('ClaveMuySecreta999') === -1, 'la contraseña nunca debe aparecer en Logger');
  });
});

test('SETUP_INITIAL_ADMIN_REJECTS_A_SECOND_ADMIN', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const first = doPostRaw('system.setupInitialAdmin', { nombre: 'Primero', usuario: 'primero', password: 'ClaveSegura123' }, undefined);
    assert(first.success === true, JSON.stringify(first));

    const second = doPostRaw('system.setupInitialAdmin', { nombre: 'Segundo', usuario: 'segundo', password: 'OtraClaveSegura456' }, undefined);
    assert(second.success === false, 'un segundo administrador inicial debe rechazarse');
    assert(String(second.error || '').indexOf('INITIAL_ADMIN_ALREADY_CONFIGURED') === 0, second.error);

    const usersAfter = runInContext(`DbHelper.getAllRows('Usuarios')`);
    assertEqual(usersAfter.length, 1, 'nunca debe crearse un segundo usuario');
  });
});

test('SETUP_INITIAL_ADMIN_REJECTS_DUPLICATE_USERNAME', () => {
  // Un único administrador inicial es posible por diseño (el segundo
  // intento ya se rechaza por INITIAL_ADMIN_ALREADY_CONFIGURED, probado
  // arriba) -- así que "usuario duplicado" contra la MISMA hoja Usuarios
  // se prueba con auth.saveUser (mismo backend, mismo mecanismo de
  // duplicados) usando la sesión real del admin recién creado, dentro de
  // una instalación limpia real de esta tarea.
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const created = doPostRaw('system.setupInitialAdmin', { nombre: 'María Pérez', usuario: 'maria', password: 'ClaveSegura123' }, undefined);
    assert(created.success === true, JSON.stringify(created));

    const login = doPostRaw('auth.login', { username: 'maria', password: 'ClaveSegura123' }, undefined);
    assert(login.success === true, JSON.stringify(login));
    const token = login.sessionToken;

    const dup = doPostRaw('auth.saveUser', { usuario: 'maria', nombre: 'Otro', rol: 'CAJERO' }, token);
    assert(dup.success === false, 'un nombre de usuario ya usado por el ADMIN inicial debe rechazarse');
    assert(String(dup.error || '').indexOf('DUPLICATE_USER') === 0, dup.error);
  });
});

test('SETUP_INITIAL_ADMIN_VALIDATES_REQUIRED_FIELDS_AND_MINIMUM_PASSWORD_LENGTH', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const casosInvalidos = [
      { nombre: '', usuario: 'valido', password: 'ClaveSegura123' },
      { nombre: 'Valido', usuario: '', password: 'ClaveSegura123' },
      { nombre: 'Valido', usuario: 'valido', password: '' },
      { nombre: 'Valido', usuario: 'valido', password: 'corta1' }, // <8 caracteres
      { nombre: 'Valido', usuario: 'a', password: 'ClaveSegura123' } // usuario <3 caracteres
    ];
    casosInvalidos.forEach(payload => {
      const res = doPostRaw('system.setupInitialAdmin', payload, undefined);
      assert(res.success === false, `debía rechazarse: ${JSON.stringify(payload)}`);
      assert(String(res.error || '').indexOf('VALIDATION_ERROR') === 0, res.error);
    });
    const usersAfter = runInContext(`DbHelper.getAllRows('Usuarios').length`);
    assertEqual(usersAfter, 0, 'ningún intento inválido debe crear un usuario');
  });
});

test('SETUP_INITIAL_ADMIN_GOES_THROUGH_LOCKSERVICE', () => {
  // LÍMITE EXPLÍCITO: este mock de LockService (un solo hilo) no puede
  // demostrar exclusión mutua bajo concurrencia REAL -- eso solo es
  // verificable contra Apps Script real. Lo que SÍ se confirma aquí es
  // que el código realmente pasa por tryLock()/releaseLock() (estructura
  // correcta, LockServiceHelper.runWithLock envolviendo todo el flujo).
  withFreshInstall(({ runInContext, doPostRaw, lockLog }) => {
    runInContext(`setupNuevaInstalacion()`);
    const before = lockLog.length;
    doPostRaw('system.setupInitialAdmin', { nombre: 'María', usuario: 'maria', password: 'ClaveSegura123' }, undefined);
    const newLockCalls = lockLog.slice(before);
    assert(newLockCalls.indexOf('tryLock') !== -1, 'debe adquirir el lock');
    assert(newLockCalls.indexOf('releaseLock') !== -1, 'debe liberar el lock (finally)');
    assertEqual(newLockCalls.filter(c => c === 'tryLock').length, 1, 'exactamente una adquisición por llamada');
    assertEqual(newLockCalls.filter(c => c === 'releaseLock').length, 1, 'exactamente una liberación por llamada');
  });
});

test('SETUP_INITIAL_ADMIN_IS_AUDITED_WITHOUT_LEAKING_SECRETS', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const res = doPostRaw('system.setupInitialAdmin', { nombre: 'María Pérez', usuario: 'maria', password: 'ClaveMuySecreta999' }, undefined);
    assert(res.success === true, JSON.stringify(res));

    const logs = runInContext(`DbHelper.findRows('Auditoria', a => a.accion === 'INITIAL_ADMIN_CREATED')`);
    assert(logs.length === 1, 'debe quedar exactamente un registro de auditoría');
    const entry = logs[0];
    assertEqual(entry.entidad_id, res.userId);
    assert(entry.descripcion.indexOf('maria') !== -1, 'debe registrar el usuario');
    assert(entry.detalle.indexOf('maria') !== -1, 'el detalle debe incluir el usuario');
    assert(entry.detalle.indexOf('ADMIN') !== -1, 'el detalle debe incluir el rol');
    // Ítem 27 (negativo) -- jamás contraseña/hash/token/secreto en ningún campo.
    const fullRow = JSON.stringify(entry);
    assert(fullRow.indexOf('ClaveMuySecreta999') === -1, 'la auditoría nunca debe incluir la contraseña');
    assert(fullRow.toLowerCase().indexOf('password_hash') === -1, 'la auditoría nunca debe incluir el hash');
    assert(fullRow.toLowerCase().indexOf('password_salt') === -1, 'la auditoría nunca debe incluir el salt');
  });
});

test('REPAIR_ON_A_FRESH_CLEAN_INSTALL_NEVER_CREATES_DEMO_DATA', () => {
  // Ítem 26 -- reparar una instalación limpia (aunque todavía no tenga
  // ningún ADMIN) nunca debe sembrar datos de demostración.
  withFreshInstall(({ runInContext }) => {
    runInContext(`setupNuevaInstalacion()`);
    const repaired = runInContext(`verificarYRepararInstalacion()`);
    assert(repaired.success === true, JSON.stringify(repaired.verification));
    assertEqual(repaired.verification.commercialDataEmpty, true, JSON.stringify(repaired.verification.nonEmptyCommercialEntities));
    const users = runInContext(`DbHelper.getAllRows('Usuarios')`);
    assertEqual(users.length, 0, 'reparar una instalación limpia nunca debe crear usuarios semilla');
  });
});

test('SYSTEM_SEEDINITIALDATA_IS_NO_LONGER_A_PUBLIC_ACTION', () => {
  // Fase 14/23 -- ya no debe ser invocable sin sesión.
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const res = doPostRaw('system.seedInitialData', {}, undefined);
    assert(res.success === false, 'system.seedInitialData nunca debe ser público');
    assert(String(res.error || '').indexOf('AUTH_REQUIRED') === 0, res.error);
  });
});

test('SYSTEM_SETUPDATABASE_IS_NO_LONGER_A_PUBLIC_ACTION', () => {
  withFreshInstall(({ runInContext, doPostRaw }) => {
    runInContext(`setupNuevaInstalacion()`);
    const res = doPostRaw('system.setupDatabase', {}, undefined);
    assert(res.success === false, 'system.setupDatabase nunca debe ser público');
    assert(String(res.error || '').indexOf('AUTH_REQUIRED') === 0, res.error);
  });
});

/* ================================================================
   REPORTE
   ================================================================ */
console.log('\n================ RESULTADOS (INSTALADOR) ================\n');
for (const r of results) {
  console.log(`${r.name}: ${r.outcome}${r.error ? ' -- ' + r.error : ''}`);
}
const passed = results.filter(r => r.outcome === 'PASSED').length;
const failed = results.filter(r => r.outcome === 'FAILED').length;
console.log('\n================ RESUMEN (INSTALADOR) ================\n');
console.log(JSON.stringify({ passed, failed, total: results.length }, null, 2));
if (failed > 0) process.exitCode = 1;
