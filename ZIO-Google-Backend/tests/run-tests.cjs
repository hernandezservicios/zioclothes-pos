'use strict';

/*
 * FASE 3.6 (corrección de bloqueantes) — Suite de regresión mínima para
 * ZIO-Google-Backend.
 *
 * NO existía ningún test runner en este proyecto antes de este archivo
 * (se buscó exhaustivamente: no hay carpeta tests/, ningún .cjs/.js de
 * test, ninguna referencia a "43 PASSED" en ningún archivo del repo, y
 * package.json no tiene script "test"). Este archivo se crea desde cero,
 * como pidió explícitamente la Parte 10 de la corrección de bloqueantes,
 * cubriendo como mínimo: autenticación, sesión, permisos, secuencias,
 * redondeo, venta, precio manipulado, stock insuficiente, crédito
 * insuficiente, rollback, auditoría y caja.
 *
 * Simula, con la fidelidad necesaria, las APIs de Apps Script que usa
 * este backend: SpreadsheetApp, PropertiesService, Utilities, LockService,
 * CacheService, ContentService y Logger. NO es el entorno real de Google
 * Sheets / Apps Script.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const APPS_SCRIPT_DIR = path.join(__dirname, '..', 'apps-script');

/* ------------------------------------------------------------
   MOCK: hoja de cálculo en memoria (mismo patrón verificado que el
   harness del backend legado -- MockSheet/MockRange/MockSpreadsheet)
   ------------------------------------------------------------ */

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
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
  getValue() {
    return this.getValues()[0][0];
  }
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
  setValue(value) {
    return this.setValues([[value]]);
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  getMaxRows() { return this.data.length; }
  insertRows() { if (this.data.length === 0) this.data.push([]); }
  getLastColumn() {
    let max = 0;
    for (const row of this.data) if (row && row.length > max) max = row.length;
    return max;
  }
  getLastRow() { return this.data.length; }
  getRange(row, col, numRows, numCols) {
    return new MockRange(this, row, col, numRows || 1, numCols || 1);
  }
  getDataRange() {
    return new MockRange(this, 1, 1, this.data.length, this.getLastColumn());
  }
  appendRow(rowArr) { this.data.push(rowArr.slice()); }
  deleteRow(rowIndex) { this.data.splice(rowIndex - 1, 1); }
  setFrozenRows() { return this; }
  autoResizeColumns() { return this; }
  getSheetName() { return this.name; }
}

class MockSpreadsheet {
  constructor() { this.sheetsByName = {}; }
  getSheetByName(name) { return this.sheetsByName[name] || null; }
  insertSheet(name) {
    const s = new MockSheet(name);
    this.sheetsByName[name] = s;
    return s;
  }
  getName() { return 'ZIO CLOTHES -- SPREADSHEET DE PRUEBA (harness)'; }
}

/* ------------------------------------------------------------
   MOCK: PropertiesService / Utilities / LockService / CacheService /
   ContentService / Logger
   ------------------------------------------------------------ */

function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(date, tz, fmt) {
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  if (fmt === 'yyyyMMdd-HHmmss') return `${yyyy}${MM}${dd}-${HH}${mm}${ss}`;
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}

const logLines = [];
const mockSpreadsheet = new MockSpreadsheet();
const scriptProperties = { SPREADSHEET_ID: 'MOCK-SPREADSHEET-ID' };
const cacheStore = new Map();

/* ------------------------------------------------------------
   MOCK: DriveApp (mínimo necesario para
   ProductsController.getOrCreateProductImagesFolder /
   initializeProductImageStorage, invocadas ahora por seedInitialData() en
   el paso de seed compartido de abajo). NO simula subida real de blobs
   (createFile/setSharing) porque ningún test invoca handleUploadImage
   directamente -- solo la resolución/creación de la carpeta.
   ------------------------------------------------------------ */
let mockDriveIdCounter = 0;
const driveFoldersById = new Map();
const driveFoldersByName = new Map();
// FASE 2 (reemplazo seguro y limpieza de imágenes en Drive): archivos
// mockeados, necesarios para probar
// isFileInManagedFolder_/isFileStillReferencedByAnotherProduct_/
// trashManagedImageIfSafe_ sin tocar Drive real -- ProductsController.gs
// llama DriveApp.getFileById(fileId).getParents()/.setTrashed(true).
const driveFilesById = new Map();

class MockDriveFolder {
  constructor(id, name) { this._id = id; this._name = name; }
  getId() { return this._id; }
  getName() { return this._name; }
  getUrl() { return `https://drive.google.com/drive/folders/${this._id}`; }
  // FASE 3 (logo de empresa): necesario para ejercitar de extremo a
  // extremo ProductsController.uploadImageToManagedFolder_ (handleUploadImage
  // / SettingsController.handleUploadLogo) en los tests, no solo la
  // resolución/creación de la carpeta.
  createFile(blob) {
    const id = `MOCK-FILE-${++mockDriveIdCounter}`;
    const file = new MockDriveFile(id, [this._id]);
    driveFilesById.set(id, file);
    return file;
  }
}

class MockDriveFile {
  constructor(id, parentFolderIds) {
    this._id = id;
    this._parentFolderIds = parentFolderIds || [];
    this._trashed = false;
  }
  getId() { return this._id; }
  isTrashed() { return this._trashed; }
  setTrashed(value) { this._trashed = !!value; return this; }
  setSharing() { return this; }
  getParents() {
    const folders = this._parentFolderIds.map(pid => driveFoldersById.get(pid)).filter(Boolean);
    return mockDriveFolderIterator(folders);
  }
}

function mockDriveFolderIterator(list) {
  let idx = 0;
  return { hasNext() { return idx < list.length; }, next() { return list[idx++]; } };
}

const sandbox = {
  console,
  JSON, Object, Array, String, Number, Math, Date, isNaN, parseInt, parseFloat, RegExp, Error, Map, Set,
  Boolean,

  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) { return scriptProperties[key] !== undefined ? scriptProperties[key] : null; },
        setProperty(key, value) { scriptProperties[key] = value; }
      };
    }
  },

  SpreadsheetApp: {
    openById(id) {
      if (id !== scriptProperties.SPREADSHEET_ID) {
        throw new Error(`Mock: no existe un Spreadsheet con ID '${id}'`);
      }
      return mockSpreadsheet;
    },
    getActiveSpreadsheet() { return mockSpreadsheet; }
  },

  Utilities: {
    formatDate,
    computeDigest(algorithm, input) {
      const hash = crypto.createHash('sha256').update(String(input), 'utf8').digest();
      return Array.from(hash).map(b => (b > 127 ? b - 256 : b));
    },
    getUuid() { return crypto.randomUUID(); },
    // FASE 3 (logo de empresa): necesarios para ejercitar de extremo a
    // extremo ProductsController.uploadImageToManagedFolder_ en los tests
    // (decodificar el Base64 real y envolverlo en un "Blob" simulado).
    base64Decode(base64String) {
      const buf = Buffer.from(base64String, 'base64');
      const arr = [];
      for (let i = 0; i < buf.length; i++) {
        arr.push(buf[i] > 127 ? buf[i] - 256 : buf[i]);
      }
      return arr;
    },
    newBlob(bytes, contentType, name) {
      return {
        getBytes() { return bytes; },
        getContentType() { return contentType; },
        getName() { return name; }
      };
    },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' }
  },

  LockService: {
    getScriptLock() {
      return { tryLock() { return true; }, releaseLock() {} };
    }
  },

  DriveApp: {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    getFoldersByName(name) {
      return mockDriveFolderIterator(driveFoldersByName.get(name) || []);
    },
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
    },
    getFileById(id) {
      const file = driveFilesById.get(id);
      if (!file) throw new Error(`Mock: no existe un archivo de Drive con ID '${id}'`);
      return file;
    }
  },

  // FASE 2: utilidad SOLO de este arnés de pruebas (no existe en ningún
  // .gs real) para sembrar archivos de Drive falsos con un fileId y una
  // carpeta padre conocidos, sin pasar por handleUploadImage/createFile
  // real -- así los tests pueden construir exactamente el escenario que
  // necesitan (archivo dentro de la carpeta administrada, fuera de ella,
  // o un fileId que directamente no existe).
  __mockDrive: {
    createFile(fileId, parentFolderId) {
      const file = new MockDriveFile(fileId, parentFolderId ? [parentFolderId] : []);
      driveFilesById.set(fileId, file);
      return file;
    },
    isTrashed(fileId) {
      const file = driveFilesById.get(fileId);
      return !!file && file.isTrashed();
    }
  },

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
  },

  Logger: { log(...args) { logLines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); } }
};

const context = vm.createContext(sandbox);

/* ------------------------------------------------------------
   CARGAR TODOS LOS .gs EN EL MISMO SCOPE GLOBAL, en el orden en que
   Apps Script cargaría archivos de un mismo proyecto (Config primero,
   por dependencia de CONFIG/getSpreadsheet/roundMoney en el resto).
   ------------------------------------------------------------ */

const loadOrder = [
  'Config.gs', 'DbHelper.gs', 'LockServiceHelper.gs', 'Sequences.gs', 'Security.gs',
  'AuditController.gs', 'AuthController.gs', 'ProductsController.gs', 'CustomersController.gs',
  'SalesController.gs', 'InventoryController.gs', 'CreditsController.gs', 'CashController.gs',
  'ExpensesController.gs', 'PurchasesController.gs', 'ReturnsController.gs', 'SettingsController.gs',
  // FASE 6: CreditNotesController.gs se referencia desde ReturnsController.gs
  // (issueFromReturnWithinTx_) y SalesController.gs (applyToSaleWithinTx_) --
  // debe cargarse antes de que corran esas dos referencias en runtime, lo
  // cual ya se cumple con cualquier posición (todos los .gs comparten un
  // único scope global concatenado); se coloca aquí por cercanía temática.
  'CreditNotesController.gs',
  'SeedSetup.gs', 'Main.gs'
];

const combined = loadOrder
  .map(f => fs.readFileSync(path.join(APPS_SCRIPT_DIR, f), 'utf8'))
  .join('\n\n');

new vm.Script(combined, { filename: 'combined.gs' }).runInContext(context);

/* ------------------------------------------------------------
   SEED: usa el propio aprovisionador real del backend
   (setupDatabase + seedInitialData), no una copia paralela del schema.
   ------------------------------------------------------------ */

new vm.Script('setupDatabase(); seedInitialData();', { filename: 'seed.gs' }).runInContext(context);

/* ------------------------------------------------------------
   HELPERS DE TEST
   ------------------------------------------------------------ */

function runInContext(code) {
  return new vm.Script(code, { filename: 'run.gs' }).runInContext(context);
}

function doPostRaw(action, data, sessionToken) {
  const event = { postData: { contents: JSON.stringify({ action, sessionToken, data: data || {} }) } };
  context.__event = event;
  const raw = runInContext('doPost(__event).getContent()');
  return JSON.parse(raw);
}

function login(username, password) {
  return doPostRaw('auth.login', { username, password });
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, outcome: 'PASSED' });
  } catch (err) {
    results.push({ name, outcome: 'FAILED', error: err && err.message ? err.message : String(err) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || 'assertEqual failed') + ` (esperado=${JSON.stringify(b)}, obtenido=${JSON.stringify(a)})`);
}

/* ------------------------------------------------------------
   FIXTURES COMPARTIDOS
   ------------------------------------------------------------ */

const adminLogin = login('admin', 'admin123');
if (!adminLogin.success) {
  console.error('FATAL: no se pudo iniciar sesión como admin semilla. Abortando suite.', adminLogin);
  process.exit(1);
}
const adminToken = adminLogin.sessionToken;

// Categoría, producto y variante reales para las pruebas de venta.
runInContext(`
  DbHelper.insertRow('Categorias', { id: 'CAT-T01', nombre: 'Categoria Test', descripcion: '', estado: 'ACTIVO' });
  DbHelper.insertRow('Productos', {
    id: 'PRD-T01', sku: 'SKU-T01', codigo_barras: '7460000000001', nombre: 'Producto Test',
    descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
    proveedor_id: '', costo: 500, precio: 1000, precio_especial: '', impuesto: 18,
    descuento_maximo: 10, stock_minimo: 2, estado: 'ACTIVO', imagen_url: '', creado_en: getNowFormatted()
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T01', producto_id: 'PRD-T01', sku: 'SKU-T01-U', codigo_barras: '7460000000002',
    color: 'Negro', talla: 'M', costo: 500, precio: 1000, stock: 5, estado: 'ACTIVO'
  });
  DbHelper.insertRow('Clientes', {
    id: 'CLI-T01', nombre: 'Cliente', apellido: 'Test', documento: '000-0000000-0', telefono: '000',
    correo: '', direccion: '', ciudad: '', limite_credito: 500, dias_credito_por_defecto: 15,
    notas: '', estado: 'ACTIVO', creado_en: getNowFormatted()
  });
  // Segundo producto/variante de precio bajo, específico para probar
  // crédito DENTRO del límite (CLI-T01 tiene limite_credito=500) sin
  // necesitar ningún descuento -- evita mezclar dos reglas en un mismo test.
  DbHelper.insertRow('Productos', {
    id: 'PRD-T02', sku: 'SKU-T02', codigo_barras: '7460000000003', nombre: 'Producto Barato Test',
    descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
    proveedor_id: '', costo: 100, precio: 300, precio_especial: '', impuesto: 18,
    descuento_maximo: 10, stock_minimo: 2, estado: 'ACTIVO', imagen_url: '', creado_en: getNowFormatted()
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T02', producto_id: 'PRD-T02', sku: 'SKU-T02-U', codigo_barras: '7460000000004',
    color: 'Blanco', talla: 'S', costo: 100, precio: 300, stock: 5, estado: 'ACTIVO'
  });
  // Segundo cliente, exclusivo del test de caja+crédito, para no depender
  // del estado acumulado de crédito que dejan otros tests sobre CLI-T01.
  DbHelper.insertRow('Clientes', {
    id: 'CLI-T02', nombre: 'Cliente', apellido: 'Caja', documento: '000-0000000-1', telefono: '000',
    correo: '', direccion: '', ciudad: '', limite_credito: 1000, dias_credito_por_defecto: 15,
    notas: '', estado: 'ACTIVO', creado_en: getNowFormatted()
  });
`);

function buildValidSaleData(overrides) {
  // precio real = 1000, cantidad 1, sin descuento, con impuesto 18% -> total 1180
  const base = {
    clienteId: '', clienteNombre: 'Consumidor Final', cajaSesionId: '',
    subtotal: 1000, descuentoTotal: 0, impuestoTotal: 180, total: 1180, costoTotal: 500,
    metodoPago: 'EFECTIVO', pagos: [{ metodo: 'EFECTIVO', monto: 1180 }],
    esCredito: false, aplicarImpuesto: true,
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 1, costoUnitario: 500, precioUnitario: 1000,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 1000, impuestoMonto: 180, total: 1180
    }]
  };
  return Object.assign({}, base, overrides || {});
}

function resetVarT01Stock(stock) {
  runInContext(`DbHelper.updateRowById('Variantes', 'VAR-T01', { stock: ${stock} });`);
}

/* ==================================================================
   1. AUTENTICACIÓN
   ================================================================== */

test('AUTH_LOGIN_SUCCESS_RETURNS_SESSION_TOKEN_AND_PERMISSIONS', () => {
  const res = login('admin', 'admin123');
  assert(res.success === true, 'login admin debe tener éxito');
  assert(typeof res.sessionToken === 'string' && res.sessionToken.startsWith('ZIO-SESS-'), 'debe devolver sessionToken con formato esperado');
  assert(Array.isArray(res.permissions), 'debe devolver permissions');
  assert(res.user && res.user.password_hash === undefined && res.user.password_salt === undefined, 'el usuario devuelto NUNCA debe incluir password_hash/password_salt');
});

test('AUTH_LOGIN_WRONG_PASSWORD_REJECTED', () => {
  const res = login('admin', 'password-incorrecta');
  assert(res.success === false, 'password incorrecta debe fallar');
  assert(String(res.error || '').indexOf('AUTH_FAILED') === 0, 'debe fallar con AUTH_FAILED');
});

test('AUTH_LOGIN_GERENTE_SEED_USER_WORKS', () => {
  // FASE 3.6 (Parte 8): antes no existía usuario semilla para el botón
  // "Encargado"/"Gerente" del frontend -- se agregó a SeedSetup.gs.
  const res = login('gerente', 'gerente123');
  assert(res.success === true, 'el usuario semilla gerente/gerente123 debe poder iniciar sesión: ' + JSON.stringify(res));
  assertEqual(res.user.rol, 'GERENTE');
});

test('AUTH_LOGIN_NONEXISTENT_USER_REJECTED', () => {
  const res = login('no-existe-usuario', 'cualquiera');
  assert(res.success === false, 'usuario inexistente debe fallar');
  assert(String(res.error || '').indexOf('AUTH_FAILED') === 0, 'debe fallar con AUTH_FAILED (mismo código que password incorrecta)');
});

/* ==================================================================
   2. SESIÓN
   ================================================================== */

test('SESSION_VALIDATE_REAL_TOKEN_SUCCEEDS', () => {
  const res = doPostRaw('auth.validateSession', {}, adminToken);
  assert(res.success === true, 'validar el token real de admin debe tener éxito');
  assertEqual(res.user.usuario, 'admin');
});

test('SESSION_VALIDATE_FAKE_TOKEN_REJECTED', () => {
  const res = doPostRaw('auth.validateSession', {}, 'ZIO-SESS-token-inventado');
  assert(res.success === false, 'un token inventado debe ser rechazado');
});

test('SESSION_REQUIRED_FOR_PROTECTED_ACTION', () => {
  const res = doPostRaw('sales.create', buildValidSaleData(), undefined);
  assert(res.success === false, 'sales.create sin sessionToken debe fallar');
  assert(String(res.error || '').indexOf('AUTH_REQUIRED') === 0, 'debe fallar exactamente con AUTH_REQUIRED');
});

test('SESSION_LOGOUT_DESTROYS_TOKEN', () => {
  const session = login('admin', 'admin123');
  const token = session.sessionToken;
  const before = doPostRaw('auth.validateSession', {}, token);
  assert(before.success === true, 'el token recién creado debe ser válido');
  doPostRaw('auth.logout', {}, token);
  const after = doPostRaw('auth.validateSession', {}, token);
  assert(after.success === false, 'el token debe quedar inválido después de logout');
});

/* ==================================================================
   3. PERMISOS
   ================================================================== */

test('PERMISSION_CAJERO_CANNOT_MANAGE_USERS', () => {
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('auth.listUsers', {}, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder listar usuarios (admin.usuarios)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe fallar con FORBIDDEN');
});

test('PERMISSION_ADMIN_CAN_MANAGE_USERS', () => {
  const res = doPostRaw('auth.listUsers', {}, adminToken);
  assert(res.success === true, 'ADMIN sí debe poder listar usuarios');
});

test('PERMISSION_CAJERO_CAN_CREATE_SALE', () => {
  resetVarT01Stock(5);
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('sales.create', buildValidSaleData(), cajeroSession.sessionToken);
  assert(res.success === true, 'CAJERO sí tiene permiso ventas.crear (seed real)');
});

/* ==================================================================
   4. SECUENCIAS
   ================================================================== */

test('SEQUENCES_ARE_ATOMIC_AND_INCREMENTING', () => {
  const a = runInContext("Sequences.getNext('TESTSEQ')");
  const b = runInContext("Sequences.getNext('TESTSEQ')");
  const c = runInContext("Sequences.getNext('TESTSEQ')");
  assert(a !== b && b !== c, 'cada llamada debe devolver un valor distinto');
  const numA = parseInt(a.split('-')[1], 10);
  const numB = parseInt(b.split('-')[1], 10);
  assertEqual(numB, numA + 1, 'debe incrementar en 1');
});

/* ==================================================================
   5. REDONDEO
   ================================================================== */

test('ROUND_MONEY_HANDLES_FLOATING_POINT_ERRORS', () => {
  const r1 = runInContext('roundMoney(0.1 + 0.2)');
  assertEqual(r1, 0.3, '0.1 + 0.2 debe redondear exactamente a 0.3');
  const r2 = runInContext('roundMoney(19.995)');
  assert(r2 === 19.99 || r2 === 20, 'debe redondear a 2 decimales sin lanzar error');
});

/* ==================================================================
   6. VENTA — CAMINO FELIZ
   ================================================================== */

test('SALE_HAPPY_PATH_CREATES_SALE_DEDUCTS_STOCK_AND_KARDEX', () => {
  resetVarT01Stock(5);
  const res = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(res.success === true, 'la venta válida debe tener éxito: ' + JSON.stringify(res));
  assert(!!res.saleId && !!res.numeroVenta, 'debe devolver saleId y numeroVenta');

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 4, 'el stock debe descontarse en exactamente 1');

  const kardex = runInContext("DbHelper.findRows('Inventario_Kardex', r => r.variante_id === 'VAR-T01' && r.tipo === 'VENTA')");
  assert(kardex.length >= 1, 'debe existir al menos un movimiento de Kardex tipo VENTA');
});

/* ==================================================================
   7. PRECIO MANIPULADO (BLOQUEANTE CRÍTICO)
   ================================================================== */

test('SALE_MANIPULATED_TOTAL_REJECTED', () => {
  resetVarT01Stock(5);
  // Producto real: RD$1000 x 1 + 18% ITBIS = RD$1180. Cliente intenta
  // declarar un total artificial de RD$20.
  const data = buildValidSaleData({ subtotal: 20, impuestoTotal: 0, total: 20, pagos: [{ metodo: 'EFECTIVO', monto: 20 }] });
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === false, 'un total manipulado (RD$20 en vez de RD$1180) debe ser rechazado');
  assert(String(res.error || '').indexOf('PRICE_MISMATCH') === 0, 'debe rechazar exactamente con PRICE_MISMATCH: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 5, 'el stock NO debe descontarse si la venta fue rechazada');
});

test('SALE_MANIPULATED_ITEM_PRICE_IGNORED_SERVER_USES_REAL_PRICE', () => {
  resetVarT01Stock(5);
  // El cliente manda precioUnitario/subtotal manipulados por ítem, pero
  // total/subtotal/impuestoTotal de la venta SÍ coinciden con el precio
  // real -- confirma que el servidor usa el precio real de la variante
  // para poblar Venta_Items, no lo que mandó el cliente en el renglón.
  const data = buildValidSaleData();
  data.items[0].precioUnitario = 1; // manipulado, debe ser ignorado
  data.items[0].subtotal = 1;
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === true, 'la venta debe procesar (total de la venta sí es el real)');

  const items = runInContext(`DbHelper.findRows('Venta_Items', r => r.venta_id === '${res.saleId}')`);
  assertEqual(Number(items[0].precio_unitario), 1000, 'el precio guardado debe ser el REAL de la variante (1000), no el manipulado (1)');
});

test('SALE_DISCOUNT_EXCEEDING_PRODUCT_MAXIMUM_REJECTED', () => {
  resetVarT01Stock(5);
  // descuento_maximo del producto es 10%. Se solicita 50%.
  const data = buildValidSaleData({
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 1, costoUnitario: 500, precioUnitario: 1000,
      descuentoPorcentaje: 50, descuentoMonto: 500, subtotal: 1000, impuestoMonto: 90, total: 590
    }],
    descuentoTotal: 500, impuestoTotal: 90, total: 590, pagos: [{ metodo: 'EFECTIVO', monto: 590 }]
  });
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === false, 'un descuento de línea del 50% (máximo real 10%) debe ser rechazado');
  assert(String(res.error || '').indexOf('DISCOUNT_EXCEEDS_MAXIMUM') === 0, 'debe rechazar exactamente con DISCOUNT_EXCEEDS_MAXIMUM: ' + res.error);
});

test('SALE_PAYMENTS_SUM_MISMATCH_REJECTED', () => {
  resetVarT01Stock(5);
  // Total correcto (1180) pero el desglose de pagos solo declara 20.
  const data = buildValidSaleData({ pagos: [{ metodo: 'EFECTIVO', monto: 20 }] });
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === false, 'un desglose de pagos que no cubre el total debe ser rechazado');
  assert(String(res.error || '').indexOf('PRICE_MISMATCH') === 0, 'debe rechazar con PRICE_MISMATCH: ' + res.error);
});

/* ==================================================================
   8. STOCK INSUFICIENTE
   ================================================================== */

test('SALE_INSUFFICIENT_STOCK_REJECTED_AND_CART_STATE_UNCHANGED', () => {
  resetVarT01Stock(1);
  const data = buildValidSaleData({
    items: [Object.assign({}, buildValidSaleData().items[0], { cantidad: 2 })],
    subtotal: 2000, impuestoTotal: 360, total: 2360, pagos: [{ metodo: 'EFECTIVO', monto: 2360 }]
  });
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === false, 'vender 2 unidades con stock=1 debe rechazarse');
  assert(String(res.error || '').indexOf('STOCK_INSUFICIENTE') === 0, 'debe rechazar con STOCK_INSUFICIENTE: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 1, 'el stock no debe quedar negativo ni modificado');
  resetVarT01Stock(5);
});

/* ==================================================================
   9. CRÉDITO INSUFICIENTE
   ================================================================== */

test('SALE_CREDIT_LIMIT_EXCEEDED_REJECTED', () => {
  resetVarT01Stock(5);
  // CLI-T01 tiene limite_credito = 500. Se intenta financiar 1180.
  const data = buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test', esCredito: true, montoFinanciado: 1180,
    metodoPago: 'CREDITO', pagos: [{ metodo: 'CREDITO', monto: 1180 }]
  });
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === false, 'financiar por encima del límite de crédito debe rechazarse');
  assert(String(res.error || '').indexOf('LIMITE_CREDITO_EXCEDIDO') === 0, 'debe rechazar con LIMITE_CREDITO_EXCEDIDO: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 5, 'el stock no debe descontarse si el crédito fue rechazado');
});

test('SALE_CREDIT_WITHIN_LIMIT_SUCCEEDS_AND_CREATES_CREDITO_ROW', () => {
  // VAR-T02: precio real 300, sin descuento, 18% ITBIS -> total 354.
  // CLI-T01 tiene limite_credito=500 -> 354 cabe holgadamente.
  const data = {
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test', cajaSesionId: '',
    subtotal: 300, descuentoTotal: 0, impuestoTotal: 54, total: 354, costoTotal: 100,
    metodoPago: 'CREDITO', pagos: [{ metodo: 'CREDITO', monto: 354 }],
    esCredito: true, montoFinanciado: 354, aplicarImpuesto: true,
    items: [{
      productoId: 'PRD-T02', varianteId: 'VAR-T02', nombreProducto: 'Producto Barato Test', sku: 'SKU-T02-U',
      talla: 'S', color: 'Blanco', cantidad: 1, costoUnitario: 100, precioUnitario: 300,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 300, impuestoMonto: 54, total: 354
    }]
  };
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === true, 'un crédito dentro del límite (354 de 500 disponibles) debe aceptarse: ' + JSON.stringify(res));
  assert(!!res.cuentaCobrarId, 'debe devolver un cuentaCobrarId real');

  const credito = runInContext(`DbHelper.findById('Creditos', '${res.cuentaCobrarId}')`);
  assertEqual(Number(credito.monto_original), 354, 'el crédito debe registrarse por el total autoritativo (354)');
  assertEqual(credito.estado, 'PENDIENTE');
});

/* ==================================================================
   10. ROLLBACK
   ================================================================== */

test('SALE_ROLLBACK_ON_FAILURE_LEAVES_NO_PARTIAL_DATA', () => {
  resetVarT01Stock(5);
  const ventasAntes = runInContext("DbHelper.getAllRows('Ventas').length");
  const itemsAntes = runInContext("DbHelper.getAllRows('Venta_Items').length");
  const kardexAntes = runInContext("DbHelper.getAllRows('Inventario_Kardex').length");

  // Fuerza un fallo DESPUÉS de insertar Venta/Venta_Items/Kardex/stock:
  // pagos declarados no cubren el total ya recalculado -- pero esta
  // validación ahora corre ANTES de escribir nada, así que se prueba el
  // rollback forzando el fallo de crédito, que sí ocurre antes de insertar
  // la venta. Para probar el motor de compensación en sí (después de
  // haber insertado), se usa un fallo de caja: caja_sesion_id apuntando
  // a una sesión que exista pero se fuerza una excepción sintética
  // llamando directamente al motor de rollback sobre una transacción real.
  const tx = runInContext('DbHelper.beginTx()');
  runInContext(`
    var tx = DbHelper.beginTx();
    var before = DbHelper.findById('Variantes', 'VAR-T01').stock;
    DbHelper.recordUpdate(tx, 'Variantes', 'VAR-T01', { stock: before });
    DbHelper.updateRowById('Variantes', 'VAR-T01', { stock: Number(before) - 1 });
    DbHelper.insertRow('Ventas', { id: 'VEN-ROLLBACK-TEST', numero_venta: 'VEN-ROLLBACK-TEST', estado: 'COMPLETADA' });
    DbHelper.recordInsert(tx, 'Ventas', 'VEN-ROLLBACK-TEST');
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 5, 'el stock debe restaurarse exactamente al valor previo tras el rollback');

  const ventaRollback = runInContext("DbHelper.findById('Ventas', 'VEN-ROLLBACK-TEST')");
  assert(ventaRollback === null, 'la fila de Ventas insertada debe haberse eliminado por el rollback');

  const ventasDespues = runInContext("DbHelper.getAllRows('Ventas').length");
  assertEqual(ventasDespues, ventasAntes, 'no debe quedar ninguna venta huérfana tras el rollback');
});

/* ==================================================================
   11. AUDITORÍA
   ================================================================== */

test('AUDIT_SALE_CREATED_IS_LOGGED', () => {
  resetVarT01Stock(5);
  const res = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(res.success === true, 'venta de fixture debe tener éxito');
  const logs = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${res.saleId}' && r.accion === 'SALE_CREATED')`);
  assert(logs.length === 1, 'debe existir exactamente un registro de auditoría SALE_CREATED para esta venta');
  assert(logs[0].usuario_id === 'USR-001', 'debe registrar el usuario real que hizo la venta');
});

test('AUDIT_LOGIN_FAILED_IS_LOGGED', () => {
  login('admin', 'password-mala-para-auditoria');
  const logs = runInContext("DbHelper.findRows('Auditoria', r => r.accion === 'LOGIN_FAILED')");
  assert(logs.length >= 1, 'debe quedar registrado al menos un intento fallido de login');
});

/* ==================================================================
   12. CAJA
   ================================================================== */

test('CASH_SALE_WITH_REAL_OPEN_SESSION_UPDATES_CAJA_AND_MOVEMENT', () => {
  resetVarT01Stock(5);
  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, 'apertura de caja debe tener éxito: ' + JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({ cajaSesionId: cajaId }), adminToken);
  assert(saleRes.success === true, 'venta con caja abierta debe tener éxito');

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.ventas_efectivo), 1180, 'ventas_efectivo de la caja debe reflejar la venta en efectivo');

  const movimientos = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.caja_sesion_id === '${cajaId}' && r.tipo === 'VENTA_EFECTIVO')`);
  assert(movimientos.length === 1, 'debe existir un movimiento VENTA_EFECTIVO asociado a esa caja');

  doPostRaw('cash.close', { efectivoRealContado: 2180 }, adminToken);
});

test('CASH_CREDIT_SALE_DOES_NOT_CREATE_CASH_MOVEMENT', () => {
  const openRes = doPostRaw('cash.open', { montoInicial: 500 }, adminToken);
  assert(openRes.success === true, 'apertura de caja debe tener éxito: ' + JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  // VAR-T02 (precio real 300), 100% a crédito para CLI-T02 (límite 1000,
  // sin deuda previa) -- sin ITBIS para mantener el total simple (300).
  const data = {
    clienteId: 'CLI-T02', clienteNombre: 'Cliente Caja', cajaSesionId: cajaId,
    subtotal: 300, descuentoTotal: 0, impuestoTotal: 0, total: 300, costoTotal: 100,
    metodoPago: 'CREDITO', pagos: [{ metodo: 'CREDITO', monto: 300 }],
    esCredito: true, montoFinanciado: 300, aplicarImpuesto: false,
    items: [{
      productoId: 'PRD-T02', varianteId: 'VAR-T02', nombreProducto: 'Producto Barato Test', sku: 'SKU-T02-U',
      talla: 'S', color: 'Blanco', cantidad: 1, costoUnitario: 100, precioUnitario: 300,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 300, impuestoMonto: 0, total: 300
    }]
  };
  const res = doPostRaw('sales.create', data, adminToken);
  assert(res.success === true, 'venta 100% a crédito debe procesar: ' + JSON.stringify(res));

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.ventas_efectivo), 0, 'una venta 100% a crédito NO debe afectar ventas_efectivo de la caja');

  const movimientos = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.caja_sesion_id === '${cajaId}')`);
  assertEqual(movimientos.length, 0, 'una venta 100% a crédito NO debe crear ningún Caja_Movimiento (ni VENTA_EFECTIVO artificial)');

  doPostRaw('cash.close', { efectivoRealContado: 500 }, adminToken);
});

test('CASH_OPEN_ALREADY_OPEN_REJECTED', () => {
  const first = doPostRaw('cash.open', { montoInicial: 100 }, adminToken);
  assert(first.success === true, 'primera apertura debe tener éxito');
  const second = doPostRaw('cash.open', { montoInicial: 100 }, adminToken);
  assert(second.success === false, 'no debe permitirse abrir una segunda caja mientras hay una abierta');
  assert(String(second.error || '').indexOf('CASH_ALREADY_OPEN') === 0, second.error);
  doPostRaw('cash.close', { efectivoRealContado: 100 }, adminToken);
});

/* ==================================================================
   13. DEVOLUCIONES (RETURNS) — FASE 3.6D, corrección de bloqueante P0
   ================================================================== */

test('RETURN_MANIPULATED_TOTAL_IGNORED_SERVER_USES_REAL_SALE_AMOUNT', () => {
  // Venta real: VAR-T01, precio 1000, cantidad 1, ITBIS 18% -> total 1180.
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, 'venta de fixture debe tener éxito: ' + JSON.stringify(saleRes));

  const stockTrasVenta = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stockTrasVenta, 4, 'la venta debe descontar 1 unidad');

  // El cliente intenta declarar un reembolso de RD$1 en vez del real 1180.
  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId,
    motivo: 'Prueba de manipulación de total',
    tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1, total: 1, subtotal: 1, descuentoMonto: 0, impuestoMonto: 0 }]
  }, adminToken);

  assert(returnRes.success === true, 'la devolución debe procesar (la manipulación se ignora, no se rechaza): ' + JSON.stringify(returnRes));
  assertEqual(returnRes.montoDevuelto, 1180, 'el monto devuelto debe ser el REAL de la venta (1180), no el manipulado (1)');

  const devolucion = runInContext(`DbHelper.findById('Devoluciones', '${returnRes.devolucionId}')`);
  assertEqual(Number(devolucion.monto_devuelto), 1180, 'la fila de Devoluciones debe registrar el monto real, no el manipulado');

  const stockTrasDevolucion = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stockTrasDevolucion, 5, 'el stock debe restaurarse a su valor original tras la devolución');
});

test('RETURN_EXCEEDING_SOLD_QUANTITY_REJECTED', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken); // vende 1 unidad
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId,
    motivo: 'Intento de devolver más de lo vendido',
    tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 2 }] // se vendió solo 1
  }, adminToken);

  assert(returnRes.success === false, 'devolver más unidades de las vendidas debe rechazarse');
  assert(String(returnRes.error || '').indexOf('DEVOLUCION_EXCEDE_CANTIDAD') === 0, returnRes.error);

  const stock = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stock, 4, 'el stock no debe modificarse si la devolución fue rechazada (sigue en 4, tras la venta de 1)');

  const devolucionesTrasRechazo = runInContext(`DbHelper.findRows('Devoluciones', r => r.venta_id === '${saleRes.saleId}')`);
  assertEqual(devolucionesTrasRechazo.length, 0, 'no debe quedar ninguna fila de Devoluciones si fue rechazada');
});

test('RETURN_CANNOT_DOUBLE_RETURN_BEYOND_AVAILABLE', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken); // vende 1 unidad
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const firstReturn = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Primera devolución', tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(firstReturn.success === true, 'primera devolución (dentro de lo vendido) debe aceptarse: ' + JSON.stringify(firstReturn));

  // Intentar devolver de nuevo la misma unidad ya devuelta.
  const secondReturn = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Segunda devolución (duplicada)', tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);

  assert(secondReturn.success === false, 'no debe permitirse devolver la misma mercancía dos veces');
  assert(String(secondReturn.error || '').indexOf('DEVOLUCION_EXCEDE_CANTIDAD') === 0, secondReturn.error);
});

test('RETURN_VALID_UPDATES_INVENTORY_CASH_AND_AUDIT', () => {
  resetVarT01Stock(5);
  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({ cajaSesionId: cajaId }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Prenda con defecto', tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));

  const stock = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stock, 5, 'inventario: el stock debe restaurarse');

  const kardex = runInContext(`DbHelper.findRows('Inventario_Kardex', r => r.referencia === '${returnRes.devolucionId}' && r.tipo === 'DEVOLUCION')`);
  assert(kardex.length === 1, 'debe existir exactamente un movimiento de Kardex tipo DEVOLUCION');

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.devoluciones_efectivo), 1180, 'caja: devoluciones_efectivo debe reflejar el reembolso real');

  const cashMov = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.referencia === '${returnRes.devolucionId}' && r.tipo === 'DEVOLUCION_EFECTIVO')`);
  assert(cashMov.length === 1, 'debe existir exactamente un movimiento de caja DEVOLUCION_EFECTIVO');

  const audit = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${returnRes.devolucionId}' && r.accion === 'RETURN_PROCESSED')`);
  assert(audit.length === 1, 'debe existir exactamente un registro de auditoría RETURN_PROCESSED');

  const venta = runInContext(`DbHelper.findById('Ventas', '${saleRes.saleId}')`);
  assertEqual(venta.estado, 'DEVUELTA_TOTAL', 'la venta debe marcarse DEVUELTA_TOTAL cuando se devuelve el 100%');

  doPostRaw('cash.close', { efectivoRealContado: 1000 }, adminToken);
});

test('RETURN_ROLLBACK_ON_FAILURE_LEAVES_NO_PARTIAL_DATA', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const devolucionesAntes = runInContext("DbHelper.getAllRows('Devoluciones').length");

  // Mismo patrón que SALE_ROLLBACK_ON_FAILURE_LEAVES_NO_PARTIAL_DATA:
  // se ejercita directamente el motor de compensación de DbHelper sobre
  // una transacción real de devolución (stock + fila de Devoluciones),
  // forzando un fallo sintético después de escribir.
  runInContext(`
    var tx = DbHelper.beginTx();
    var before = DbHelper.findById('Variantes', 'VAR-T01').stock;
    DbHelper.recordUpdate(tx, 'Variantes', 'VAR-T01', { stock: before });
    DbHelper.updateRowById('Variantes', 'VAR-T01', { stock: Number(before) + 1 });
    DbHelper.insertRow('Devoluciones', { id: 'DEV-ROLLBACK-TEST', numero_devolucion: 'DEV-ROLLBACK-TEST', venta_id: '${saleRes.saleId}', monto_devuelto: 1180 });
    DbHelper.recordInsert(tx, 'Devoluciones', 'DEV-ROLLBACK-TEST');
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const stock = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stock, 4, 'el stock debe restaurarse exactamente al valor previo (4, tras la venta) tras el rollback');

  const devolucionRollback = runInContext("DbHelper.findById('Devoluciones', 'DEV-ROLLBACK-TEST')");
  assert(devolucionRollback === null, 'la fila de Devoluciones insertada debe haberse eliminado por el rollback');

  const devolucionesDespues = runInContext("DbHelper.getAllRows('Devoluciones').length");
  assertEqual(devolucionesDespues, devolucionesAntes, 'no debe quedar ninguna devolución huérfana tras el rollback');
});

/* ==================================================================
   9. VENTAS — LISTADO Y ANULACIÓN (FASE 3.7A)
   ================================================================== */

test('SALES_LIST_RETURNS_REAL_SALES_WITH_ITEMS', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const listRes = doPostRaw('sales.list', {}, adminToken);
  assert(listRes.success === true, 'sales.list debe responder success:true: ' + JSON.stringify(listRes));
  assert(Array.isArray(listRes.sales), 'debe devolver un arreglo "sales"');

  const found = listRes.sales.find(s => s.id === saleRes.saleId);
  assert(!!found, 'la venta recién creada debe aparecer en sales.list');
  assertEqual(found.numeroVenta, saleRes.numeroVenta, 'numeroVenta debe coincidir con el real');
  assertEqual(Number(found.total), 1180, 'el total listado debe ser el autoritativo del backend, no uno inventado');
  assert(Array.isArray(found.items) && found.items.length === 1, 'debe incluir el detalle real de items de la venta');
  assertEqual(found.items[0].varianteId, 'VAR-T01', 'el item listado debe corresponder a la variante real vendida');
});

test('SALES_LIST_IGNORES_UNSUPPORTED_FILTERS_RETURNS_ALL', () => {
  // handleListSales(data) no lee ningún campo de `data` -- confirma que no
  // existe un filtro server-side parcialmente implementado que pudiera dar
  // una falsa sensación de "filtrado real". SalesView filtra en el
  // frontend sobre el resultado completo real (documentado en el reporte
  // de FASE 3.7A, sección de filtros).
  const withoutFilter = doPostRaw('sales.list', {}, adminToken);
  const withFakeFilter = doPostRaw('sales.list', { estado: 'NO_EXISTE_ESTE_ESTADO', fechaDesde: '1900-01-01' }, adminToken);
  assert(withoutFilter.success === true && withFakeFilter.success === true, 'ambas llamadas deben responder success:true');
  assertEqual(withFakeFilter.sales.length, withoutFilter.sales.length, 'un filtro no soportado no debe alterar ni recortar el resultado real');
});

test('PERMISSION_CAJERO_CANNOT_VOID_SALE_REJECTED', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const cajeroSession = login('cajero', 'cajero123');
  const voidRes = doPostRaw('sales.void', { saleId: saleRes.saleId, motivo: 'Intento sin permiso' }, cajeroSession.sessionToken);
  assert(voidRes.success === false, 'CAJERO no debe poder anular ventas (no tiene ventas.anular en el seed real)');
  assert(String(voidRes.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar exactamente con FORBIDDEN: ' + voidRes.error);

  const venta = runInContext(`DbHelper.findById('Ventas', '${saleRes.saleId}')`);
  assertEqual(venta.estado, 'COMPLETADA', 'la venta debe permanecer intacta tras el intento rechazado');
  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 4, 'el stock NO debe restaurarse si la anulación fue rechazada por permisos');
});

test('VOID_SALE_AUTHORIZED_RESTORES_STOCK_MARKS_ANULADA_AND_LOGS_AUDIT', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const gerenteSession = login('gerente', 'gerente123');
  assert(gerenteSession.success === true, 'el seed de gerente debe existir para esta prueba');

  const voidRes = doPostRaw('sales.void', { saleId: saleRes.saleId, motivo: 'Cliente se arrepintió' }, gerenteSession.sessionToken);
  assert(voidRes.success === true, 'GERENTE sí tiene ventas.anular (seed real): ' + JSON.stringify(voidRes));

  const venta = runInContext(`DbHelper.findById('Ventas', '${saleRes.saleId}')`);
  assertEqual(venta.estado, 'ANULADA', 'la venta debe quedar marcada ANULADA, nunca borrada físicamente');
  assertEqual(venta.motivo_anulacion, 'Cliente se arrepintió', 'debe registrar el motivo real recibido');

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 5, 'el stock debe reintegrarse completamente tras la anulación');

  const kardex = runInContext(`DbHelper.findRows('Inventario_Kardex', r => r.referencia === '${saleRes.numeroVenta}' && r.tipo === 'DEVOLUCION')`);
  assert(kardex.length === 1, 'debe existir exactamente un movimiento de Kardex tipo DEVOLUCION por la anulación');

  const audit = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${saleRes.saleId}' && r.accion === 'SALE_VOIDED')`);
  assert(audit.length === 1, 'debe existir exactamente un registro de auditoría SALE_VOIDED');

  // Confirma también que sales.list refleja el nuevo estado real.
  const listRes = doPostRaw('sales.list', {}, adminToken);
  const found = listRes.sales.find(s => s.id === saleRes.saleId);
  assertEqual(found.estado, 'ANULADA', 'sales.list debe reflejar el estado real ya anulado');
});

test('VOID_SALE_ALREADY_VOIDED_REJECTED', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  const firstVoid = doPostRaw('sales.void', { saleId: saleRes.saleId, motivo: 'Primera anulación' }, adminToken);
  assert(firstVoid.success === true, JSON.stringify(firstVoid));

  const secondVoid = doPostRaw('sales.void', { saleId: saleRes.saleId, motivo: 'Segundo intento' }, adminToken);
  assert(secondVoid.success === false, 'no debe poder anularse dos veces la misma venta');
  assert(String(secondVoid.error || '').indexOf('INVALID_STATE') === 0, 'debe rechazar con INVALID_STATE: ' + secondVoid.error);
});

test('VOID_SALE_ROLLBACK_ON_FAILURE_LEAVES_NO_PARTIAL_DATA', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  // Mismo patrón que SALE_ROLLBACK_.../RETURN_ROLLBACK_...: ejercita
  // directamente el motor de compensación de DbHelper sobre operaciones
  // de la misma forma que handleVoidSale ahora realiza (restaurar stock +
  // marcar la venta), forzando un fallo sintético después de escribir.
  runInContext(`
    var tx = DbHelper.beginTx();
    var venta = DbHelper.findById('Ventas', '${saleRes.saleId}');
    var variant = DbHelper.findById('Variantes', 'VAR-T01');
    DbHelper.recordUpdate(tx, 'Variantes', 'VAR-T01', { stock: variant.stock });
    DbHelper.updateRowById('Variantes', 'VAR-T01', { stock: Number(variant.stock) + 1 });
    DbHelper.recordUpdate(tx, 'Ventas', '${saleRes.saleId}', { estado: venta.estado });
    DbHelper.updateRowById('Ventas', '${saleRes.saleId}', { estado: 'ANULADA' });
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 4, 'el stock debe quedar restaurado al valor previo al intento fallido');

  const venta = runInContext(`DbHelper.findById('Ventas', '${saleRes.saleId}')`);
  assertEqual(venta.estado, 'COMPLETADA', 'la venta debe quedar restaurada a su estado previo (COMPLETADA), sin quedar ANULADA parcialmente');
});

/* ==================================================================
   10. CRÉDITOS Y ABONOS (FASE 3.7B)
   ================================================================== */

// Fixture dedicado: cliente con límite amplio (5000, para no interferir
// entre pruebas que dejan crédito sin saldar) y un producto/variante de
// bajo precio y stock alto (50), independientes de PRD-T01/T02 usados por
// las pruebas de venta/devolución de arriba.
runInContext(`
  DbHelper.insertRow('Clientes', {
    id: 'CLI-T03', nombre: 'Cliente', apellido: 'Credito', documento: '000-0000000-2', telefono: '000',
    correo: '', direccion: '', ciudad: '', limite_credito: 5000, dias_credito_por_defecto: 15,
    notas: '', estado: 'ACTIVO', creado_en: getNowFormatted()
  });
  DbHelper.insertRow('Productos', {
    id: 'PRD-T03', sku: 'SKU-T03', codigo_barras: '7460000000005', nombre: 'Producto Credito Test',
    descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
    proveedor_id: '', costo: 100, precio: 200, precio_especial: '', impuesto: 18,
    descuento_maximo: 10, stock_minimo: 2, estado: 'ACTIVO', imagen_url: '', creado_en: getNowFormatted()
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T03', producto_id: 'PRD-T03', sku: 'SKU-T03-U', codigo_barras: '7460000000006',
    color: 'Azul', talla: 'M', costo: 100, precio: 200, stock: 50, estado: 'ACTIVO'
  });
`);

function createTestCreditSale(overrides) {
  // Precio real 200 x 1 + 18% ITBIS = 236, 100% financiado a crédito.
  const base = {
    clienteId: 'CLI-T03', clienteNombre: 'Cliente Credito', cajaSesionId: '',
    subtotal: 200, descuentoTotal: 0, impuestoTotal: 36, total: 236, costoTotal: 100,
    metodoPago: 'CREDITO', pagos: [{ metodo: 'CREDITO', monto: 236 }],
    esCredito: true, montoFinanciado: 236, aplicarImpuesto: true,
    items: [{
      productoId: 'PRD-T03', varianteId: 'VAR-T03', nombreProducto: 'Producto Credito Test', sku: 'SKU-T03-U',
      talla: 'M', color: 'Azul', cantidad: 1, costoUnitario: 100, precioUnitario: 200,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 200, impuestoMonto: 36, total: 236
    }]
  };
  const data = Object.assign({}, base, overrides || {});
  const res = doPostRaw('sales.create', data, adminToken);
  if (!res.success) throw new Error('No se pudo crear la venta a crédito de prueba: ' + JSON.stringify(res));
  return res;
}

test('CREDITS_LIST_RETURNS_REAL_CREDITS', () => {
  const saleRes = createTestCreditSale();
  const listRes = doPostRaw('credits.list', {}, adminToken);
  assert(listRes.success === true, 'credits.list debe responder success:true: ' + JSON.stringify(listRes));
  assert(Array.isArray(listRes.credits), 'debe devolver un arreglo "credits"');

  const found = listRes.credits.find(c => c.id === saleRes.cuentaCobrarId);
  assert(!!found, 'la cuenta por cobrar recién creada debe aparecer en credits.list');
  assertEqual(Number(found.montoOriginal), 236, 'montoOriginal debe ser el total autoritativo de la venta');
  assertEqual(found.estado, 'PENDIENTE');
  assert(Array.isArray(found.abonos), 'debe incluir un arreglo de abonos embebido (aunque esté vacío)');
});

test('REGISTER_ABONO_VALID_UPDATES_BALANCE', () => {
  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', { cuentaCobrarId: saleRes.cuentaCobrarId, monto: 100, metodoPago: 'EFECTIVO' }, adminToken);
  assert(abonoRes.success === true, JSON.stringify(abonoRes));
  assertEqual(Number(abonoRes.saldoRestante), 136, 'saldo restante debe ser 236 - 100 = 136');
  assertEqual(abonoRes.estadoCuenta, 'PARCIAL');

  const credito = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assertEqual(Number(credito.saldo_pendiente), 136);
  assertEqual(Number(credito.monto_pagado), 100);
  assertEqual(credito.estado, 'PARCIAL');

  const abono = runInContext(`DbHelper.findById('Abonos', '${abonoRes.reciboId}')`);
  assert(!!abono, 'debe existir la fila real del abono en Abonos');
  assertEqual(Number(abono.monto_abonado), 100);
});

test('REGISTER_ABONO_CANNOT_EXCEED_BALANCE', () => {
  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', { cuentaCobrarId: saleRes.cuentaCobrarId, monto: 500, metodoPago: 'EFECTIVO' }, adminToken);
  assert(abonoRes.success === false, 'un abono mayor al saldo (500 > 236) debe rechazarse');
  assert(String(abonoRes.error || '').indexOf('ABONO_EXCEDE_SALDO') === 0, 'debe rechazar con ABONO_EXCEDE_SALDO: ' + abonoRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assertEqual(Number(credito.saldo_pendiente), 236, 'el saldo no debe cambiar tras el rechazo');
});

test('REGISTER_ABONO_INVALID_CREDIT_REJECTED', () => {
  const res = doPostRaw('credits.registerAbono', { cuentaCobrarId: 'CRED-NO-EXISTE-999', monto: 50 }, adminToken);
  assert(res.success === false, 'una cuenta por cobrar inexistente debe rechazarse');
  assert(String(res.error || '').indexOf('NOT_FOUND') === 0, 'debe rechazar con NOT_FOUND: ' + res.error);
});

test('REGISTER_ABONO_UNAUTHORIZED_REJECTED', () => {
  // Ningún rol realmente sembrado carece hoy de abonos.crear (CAJERO,
  // GERENTE y ADMIN lo tienen todos) -- no existe una combinación real de
  // usuario+rol para probar este caso de punta a punta vía sales.list/
  // login. Para no dejar el requisito de esta fase sin cubrir, se crea un
  // rol sintético sin ese permiso y se invoca el controlador directamente
  // (mismo mecanismo real de Security.requirePermission), confirmando que
  // el RBAC real bloquea la operación aunque el rol no exista en el seed
  // de producción.
  const saleRes = createTestCreditSale();
  runInContext(`
    DbHelper.insertRow('Roles_Permisos', {
      rol: 'ROL_SIN_ABONOS_TEST', nombre: 'Rol Sin Abonos (Test)', descripcion: '',
      permisos_json: JSON.stringify(['creditos.ver'])
    });
  `);
  const fakeUser = { id: 'USR-SYNTHETIC-TEST', nombre: 'Synthetic', apellido: 'User', rol: 'ROL_SIN_ABONOS_TEST' };
  const result = runInContext(`
    (function() {
      try {
        CreditsController.handleRegisterAbono(${JSON.stringify({ cuentaCobrarId: saleRes.cuentaCobrarId, monto: 10 })}, ${JSON.stringify(fakeUser)});
        return { threw: false };
      } catch (e) {
        return { threw: true, message: e.message };
      }
    })()
  `);
  assert(result.threw === true, 'debe lanzar un error si el rol no tiene abonos.crear');
  assert(String(result.message || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + result.message);

  const credito = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assertEqual(Number(credito.saldo_pendiente), 236, 'el saldo no debe cambiar tras el intento rechazado');
});

test('VOID_ABONO_UNAUTHORIZED_REJECTED', () => {
  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', { cuentaCobrarId: saleRes.cuentaCobrarId, monto: 50, metodoPago: 'EFECTIVO' }, adminToken);
  assert(abonoRes.success === true, JSON.stringify(abonoRes));

  const cajeroSession = login('cajero', 'cajero123');
  const voidRes = doPostRaw('credits.voidAbono', { abonoId: abonoRes.reciboId, motivo: 'Intento sin permiso' }, cajeroSession.sessionToken);
  assert(voidRes.success === false, 'CAJERO no debe poder anular abonos (no tiene creditos.anular_abonos en el seed real)');
  assert(String(voidRes.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + voidRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assertEqual(Number(credito.saldo_pendiente), 186, 'el saldo debe permanecer intacto (236 - 50) tras el intento rechazado');
});

test('VOID_ABONO_AUTHORIZED_REVERSES_CORRECTLY', () => {
  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', { cuentaCobrarId: saleRes.cuentaCobrarId, monto: 236, metodoPago: 'EFECTIVO' }, adminToken);
  assert(abonoRes.success === true, JSON.stringify(abonoRes));
  assertEqual(abonoRes.estadoCuenta, 'PAGADA');

  const gerenteSession = login('gerente', 'gerente123');
  const voidRes = doPostRaw('credits.voidAbono', { abonoId: abonoRes.reciboId, motivo: 'Registrado por error' }, gerenteSession.sessionToken);
  assert(voidRes.success === true, 'GERENTE sí tiene creditos.anular_abonos (seed real): ' + JSON.stringify(voidRes));

  const credito = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assertEqual(Number(credito.saldo_pendiente), 236, 'el saldo debe restaurarse completamente');
  assertEqual(Number(credito.monto_pagado), 0, 'el monto pagado debe volver a 0');

  const abono = runInContext(`DbHelper.findById('Abonos', '${abonoRes.reciboId}')`);
  assertEqual(abono.estado, 'ANULADO');
  assertEqual(abono.motivo_anulacion, 'Registrado por error');
});

test('AUDIT_ABONO_CREATED_IS_LOGGED', () => {
  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', { cuentaCobrarId: saleRes.cuentaCobrarId, monto: 50, metodoPago: 'EFECTIVO' }, adminToken);
  assert(abonoRes.success === true, JSON.stringify(abonoRes));
  const audit = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${abonoRes.reciboId}' && r.accion === 'ABONO_CREATED')`);
  assert(audit.length === 1, 'debe existir exactamente un registro de auditoría ABONO_CREATED');
});

test('AUDIT_ABONO_VOIDED_IS_LOGGED', () => {
  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', { cuentaCobrarId: saleRes.cuentaCobrarId, monto: 50, metodoPago: 'EFECTIVO' }, adminToken);
  assert(abonoRes.success === true, JSON.stringify(abonoRes));
  const voidRes = doPostRaw('credits.voidAbono', { abonoId: abonoRes.reciboId, motivo: 'Prueba de auditoría' }, adminToken);
  assert(voidRes.success === true, JSON.stringify(voidRes));
  const audit = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${abonoRes.reciboId}' && r.accion === 'ABONO_VOIDED')`);
  assert(audit.length === 1, 'debe existir exactamente un registro de auditoría ABONO_VOIDED');
});

test('CASH_ABONO_EFECTIVO_UPDATES_CAJA_AND_VOID_REVERSES_IT', () => {
  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const saleRes = createTestCreditSale();
  const abonoRes = doPostRaw('credits.registerAbono', {
    cuentaCobrarId: saleRes.cuentaCobrarId, monto: 80, metodoPago: 'EFECTIVO', cajaSesionId: cajaId
  }, adminToken);
  assert(abonoRes.success === true, JSON.stringify(abonoRes));

  let caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.abonos_efectivo), 80, 'caja: abonos_efectivo debe reflejar el abono real');
  const cashMovBefore = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.referencia === '${abonoRes.numeroRecibo}' && r.tipo === 'ABONO_EFECTIVO')`);
  assert(cashMovBefore.length === 1, 'debe existir exactamente un movimiento de caja ABONO_EFECTIVO');

  const voidRes = doPostRaw('credits.voidAbono', { abonoId: abonoRes.reciboId, motivo: 'Reversión de prueba' }, adminToken);
  assert(voidRes.success === true, JSON.stringify(voidRes));

  caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.abonos_efectivo), 0, 'caja: abonos_efectivo debe revertirse tras anular el abono en efectivo');
  const cashMovAfter = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.referencia === '${abonoRes.numeroRecibo}' && r.tipo === 'REVERSION_ABONO')`);
  assert(cashMovAfter.length === 1, 'debe existir exactamente un movimiento de caja REVERSION_ABONO');

  doPostRaw('cash.close', { efectivoRealContado: 1000 }, adminToken);
});

test('REGISTER_ABONO_ROLLBACK_ON_FAILURE', () => {
  const saleRes = createTestCreditSale();
  const abonosAntes = runInContext("DbHelper.getAllRows('Abonos').length");

  // Mismo patrón que SALE_ROLLBACK_.../RETURN_ROLLBACK_.../VOID_SALE_ROLLBACK_...:
  // ejercita directamente el motor de compensación de DbHelper sobre
  // operaciones de la misma forma que handleRegisterAbono realiza (insertar
  // Abono + actualizar Creditos), forzando un fallo sintético después de
  // escribir.
  runInContext(`
    var tx = DbHelper.beginTx();
    var credit = DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}');
    DbHelper.insertRow('Abonos', {
      id: 'ABO-ROLLBACK-TEST', numero_recibo: 'ABO-ROLLBACK-TEST', cuenta_cobrar_id: '${saleRes.cuentaCobrarId}',
      monto_abonado: 50, saldo_anterior: credit.saldo_pendiente,
      saldo_restante: Number(credit.saldo_pendiente) - 50, estado: 'ACTIVO'
    });
    DbHelper.recordInsert(tx, 'Abonos', 'ABO-ROLLBACK-TEST');
    DbHelper.recordUpdate(tx, 'Creditos', '${saleRes.cuentaCobrarId}', {
      saldo_pendiente: credit.saldo_pendiente, monto_pagado: credit.monto_pagado, estado: credit.estado
    });
    DbHelper.updateRowById('Creditos', '${saleRes.cuentaCobrarId}', {
      saldo_pendiente: Number(credit.saldo_pendiente) - 50, monto_pagado: Number(credit.monto_pagado) + 50, estado: 'PARCIAL'
    });
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const credito = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assertEqual(Number(credito.saldo_pendiente), 236, 'el saldo debe quedar restaurado al valor previo al intento fallido');
  assertEqual(credito.estado, 'PENDIENTE');

  const abonoRollback = runInContext("DbHelper.findById('Abonos', 'ABO-ROLLBACK-TEST')");
  assert(abonoRollback === null, 'la fila de Abonos insertada debe haberse eliminado por el rollback');

  const abonosDespues = runInContext("DbHelper.getAllRows('Abonos').length");
  assertEqual(abonosDespues, abonosAntes, 'no debe quedar ningún abono huérfano tras el rollback');
});

/* ==================================================================
   11. INVENTARIO, KARDEX Y AJUSTES MANUALES (FASE 3.7C)
   ================================================================== */

// Fixture dedicado: variante con stock alto (20) para no interferir con
// los fixtures de venta/devolución/crédito de arriba, más una variante
// INACTIVA para probar el rechazo correspondiente.
runInContext(`
  DbHelper.insertRow('Productos', {
    id: 'PRD-T04', sku: 'SKU-T04', codigo_barras: '7460000000007', nombre: 'Producto Inventario Test',
    descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
    proveedor_id: '', costo: 50, precio: 150, precio_especial: '', impuesto: 18,
    descuento_maximo: 10, stock_minimo: 2, estado: 'ACTIVO', imagen_url: '', creado_en: getNowFormatted()
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T04', producto_id: 'PRD-T04', sku: 'SKU-T04-U', codigo_barras: '7460000000008',
    color: 'Verde', talla: 'L', costo: 50, precio: 150, stock: 20, estado: 'ACTIVO'
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T04-INACTIVA', producto_id: 'PRD-T04', sku: 'SKU-T04-INACTIVA', codigo_barras: '7460000000009',
    color: 'Gris', talla: 'XL', costo: 50, precio: 150, stock: 10, estado: 'INACTIVO'
  });
`);
function resetVarT04Stock(stock) {
  runInContext(`DbHelper.updateRowById('Variantes', 'VAR-T04', { stock: ${stock} });`);
}

test('INVENTORY_KARDEX_LIST_RETURNS_REAL_MOVEMENTS', () => {
  // Para esta altura de la suite ya existen movimientos reales de VENTA/
  // DEVOLUCION generados por pruebas anteriores -- confirma que
  // inventory.kardex los expone tal cual, sin inventar ni filtrar nada.
  const res = doPostRaw('inventory.kardex', {}, adminToken);
  assert(res.success === true, 'inventory.kardex debe responder success:true: ' + JSON.stringify(res));
  assert(Array.isArray(res.movements), 'debe devolver un arreglo "movements"');
  assert(res.movements.length > 0, 'ya deben existir movimientos reales de pruebas anteriores (VENTA/DEVOLUCION)');
  const sample = res.movements[0];
  assert('stockAnterior' in sample && 'stockNuevo' in sample && 'usuarioNombre' in sample, 'cada movimiento debe traer el detalle real completo');
});

test('INVENTORY_ADJUST_VALID_UPDATES_STOCK', () => {
  resetVarT04Stock(20);
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04', cantidadAjuste: 5, tipo: 'ENTRADA', motivo: 'Reabastecimiento de prueba'
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assertEqual(Number(res.stockAnterior), 20);
  assertEqual(Number(res.nuevoStock), 25, 'el backend debe calcular 20 + 5 = 25, nunca confiar en un stock absoluto del cliente');

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04')");
  assertEqual(Number(variant.stock), 25);
});

test('INVENTORY_ADJUST_NEGATIVE_STOCK_REJECTED', () => {
  resetVarT04Stock(20);
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04', cantidadAjuste: -25, tipo: 'SALIDA', motivo: 'Merma excesiva de prueba'
  }, adminToken);
  assert(res.success === false, 'un ajuste que dejaría el stock en negativo (20 - 25) debe rechazarse');
  assert(String(res.error || '').indexOf('STOCK_INSUFICIENTE') === 0, 'debe rechazar con STOCK_INSUFICIENTE: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04')");
  assertEqual(Number(variant.stock), 20, 'el stock no debe cambiar tras el rechazo');
});

test('INVENTORY_ADJUST_UNAUTHORIZED_REJECTED', () => {
  resetVarT04Stock(20);
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04', cantidadAjuste: 5, tipo: 'ENTRADA', motivo: 'Intento sin permiso'
  }, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder ajustar inventario (no tiene inventario.ajustar en el seed real)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04')");
  assertEqual(Number(variant.stock), 20, 'el stock no debe cambiar tras el rechazo por permisos');
});

test('INVENTORY_ADJUST_INACTIVE_VARIANT_REJECTED', () => {
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04-INACTIVA', cantidadAjuste: 5, tipo: 'ENTRADA', motivo: 'Intento sobre variante inactiva'
  }, adminToken);
  assert(res.success === false, 'no debe poder ajustarse el stock de una variante inactiva');
  assert(String(res.error || '').indexOf('VALIDATION_ERROR') === 0, 'debe rechazar con VALIDATION_ERROR: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04-INACTIVA')");
  assertEqual(Number(variant.stock), 10, 'el stock de la variante inactiva no debe cambiar');
});

test('INVENTORY_ADJUST_CREATES_KARDEX', () => {
  resetVarT04Stock(20);
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04', cantidadAjuste: -4, tipo: 'SALIDA', motivo: 'Merma de prueba para Kardex', referencia: 'REF-TEST-01'
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const kardex = runInContext("DbHelper.findRows('Inventario_Kardex', r => r.variante_id === 'VAR-T04' && r.referencia === 'REF-TEST-01')");
  assert(kardex.length === 1, 'debe existir exactamente un movimiento de Kardex para esta referencia');
  assertEqual(kardex[0].tipo, 'SALIDA', 'el tipo del Kardex debe ser exactamente el elegido por el usuario (SALIDA), no siempre AJUSTE');
  assertEqual(Number(kardex[0].cantidad), -4);
  assertEqual(Number(kardex[0].stock_anterior), 20);
  assertEqual(Number(kardex[0].stock_nuevo), 16);
});

test('INVENTORY_ADJUST_AUDIT_IS_LOGGED', () => {
  resetVarT04Stock(20);
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04', cantidadAjuste: 2, tipo: 'AJUSTE', motivo: 'Corrección de conteo de prueba'
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  const audit = runInContext("DbHelper.findRows('Auditoria', r => r.entidad_id === 'VAR-T04' && r.accion === 'STOCK_ADJUSTED')");
  assert(audit.length >= 1, 'debe existir al menos un registro de auditoría STOCK_ADJUSTED para esta variante');
});

test('INVENTORY_ADJUST_CLIENT_MANIPULATION_CANNOT_SET_ARBITRARY_STATE', () => {
  // El contrato anterior aceptaba {varianteId, nuevoStock} -- un stock
  // ABSOLUTO decidido por el cliente. Si un cliente desactualizado (o
  // deliberadamente manipulado) todavía envía ese campo junto al delta
  // real, el backend debe ignorarlo por completo: solo cantidadAjuste
  // decide el resultado.
  resetVarT04Stock(20);
  const res = doPostRaw('inventory.adjust', {
    varianteId: 'VAR-T04', cantidadAjuste: 3, tipo: 'ENTRADA', motivo: 'Intento de manipulación de prueba',
    nuevoStock: 999999 // campo legado/manipulado -- debe ser completamente ignorado
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assertEqual(Number(res.nuevoStock), 23, 'el backend debe calcular 20 + 3 = 23 e ignorar por completo nuevoStock=999999 enviado por el cliente');

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04')");
  assertEqual(Number(variant.stock), 23, 'el stock real debe ser 23, nunca 999999');
});

test('INVENTORY_ADJUST_SEQUENTIAL_DELTAS_COMPOSE_CORRECTLY', () => {
  // NOTA DE ALCANCE: el mock runner de este harness ejecuta cada
  // doPostRaw de forma completamente síncrona (Node de un solo hilo,
  // LockService.getScriptLock().tryLock() es un stub que siempre
  // devuelve true al instante) -- no existe manera de simular dos
  // requests HTTP verdaderamente simultáneos aquí. Esta prueba valida en
  // cambio la propiedad que hace segura la corrección de esta fase: bajo
  // el contrato anterior (stock absoluto), dos ajustes basados en la
  // misma lectura stock=10 (+5 y -3) se pisaban entre sí (7 o 15, nunca
  // 12). Con el contrato delta-based, aplicar +5 y luego -3 en cualquier
  // orden siempre compone correctamente: 10 + 5 - 3 = 12. La protección
  // real contra ejecución concurrente verdadera depende de LockService de
  // Apps Script en producción, no verificable en este entorno (ver
  // reporte, sección M).
  resetVarT04Stock(10);
  const r1 = doPostRaw('inventory.adjust', { varianteId: 'VAR-T04', cantidadAjuste: 5, tipo: 'ENTRADA', motivo: 'Delta 1 de prueba' }, adminToken);
  assert(r1.success === true, JSON.stringify(r1));
  const r2 = doPostRaw('inventory.adjust', { varianteId: 'VAR-T04', cantidadAjuste: -3, tipo: 'SALIDA', motivo: 'Delta 2 de prueba' }, adminToken);
  assert(r2.success === true, JSON.stringify(r2));

  assertEqual(Number(r2.nuevoStock), 12, '10 + 5 - 3 debe dar exactamente 12, sin importar el orden de aplicación');
  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04')");
  assertEqual(Number(variant.stock), 12);
});

test('INVENTORY_ADJUST_ROLLBACK_ON_FAILURE', () => {
  resetVarT04Stock(20);
  const kardexAntes = runInContext("DbHelper.getAllRows('Inventario_Kardex').length");

  // Mismo patrón que las demás pruebas *_ROLLBACK_*: ejercita directamente
  // el motor de compensación de DbHelper sobre operaciones de la misma
  // forma que handleAdjustStock realiza (actualizar stock + insertar
  // Kardex), forzando un fallo sintético después de escribir.
  runInContext(`
    var tx = DbHelper.beginTx();
    var variant = DbHelper.findById('Variantes', 'VAR-T04');
    DbHelper.recordUpdate(tx, 'Variantes', 'VAR-T04', { stock: variant.stock });
    DbHelper.updateRowById('Variantes', 'VAR-T04', { stock: Number(variant.stock) + 7 });
    DbHelper.insertRow('Inventario_Kardex', {
      id: 'MOV-ROLLBACK-TEST', variante_id: 'VAR-T04', producto_id: 'PRD-T04', cantidad: 7,
      tipo: 'ENTRADA', stock_anterior: variant.stock, stock_nuevo: Number(variant.stock) + 7,
      motivo: 'Rollback test', fecha: getNowFormatted()
    });
    DbHelper.recordInsert(tx, 'Inventario_Kardex', 'MOV-ROLLBACK-TEST');
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T04')");
  assertEqual(Number(variant.stock), 20, 'el stock debe quedar restaurado al valor previo al intento fallido');

  const movRollback = runInContext("DbHelper.findById('Inventario_Kardex', 'MOV-ROLLBACK-TEST')");
  assert(movRollback === null, 'la fila de Kardex insertada debe haberse eliminado por el rollback');

  const kardexDespues = runInContext("DbHelper.getAllRows('Inventario_Kardex').length");
  assertEqual(kardexDespues, kardexAntes, 'no debe quedar ningún movimiento de Kardex huérfano tras el rollback');
});

/* ==================================================================
   12. COMPRAS Y RECEPCIÓN DE INVENTARIO (FASE 3.7D)
   ================================================================== */

// Fixture dedicado: variante con stock conocido (10, costo 80) para no
// interferir con los fixtures de venta/devolución/crédito/inventario de
// arriba, más una variante INACTIVA para probar el rechazo correspondiente.
runInContext(`
  DbHelper.insertRow('Productos', {
    id: 'PRD-T05', sku: 'SKU-T05', codigo_barras: '7460000000010', nombre: 'Producto Compras Test',
    descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
    proveedor_id: '', costo: 80, precio: 200, precio_especial: '', impuesto: 18,
    descuento_maximo: 10, stock_minimo: 2, estado: 'ACTIVO', imagen_url: '', creado_en: getNowFormatted()
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T05', producto_id: 'PRD-T05', sku: 'SKU-T05-U', codigo_barras: '7460000000011',
    color: 'Negro', talla: 'M', costo: 80, precio: 200, stock: 10, estado: 'ACTIVO'
  });
  DbHelper.insertRow('Variantes', {
    id: 'VAR-T05-INACTIVA', producto_id: 'PRD-T05', sku: 'SKU-T05-INACTIVA', codigo_barras: '7460000000012',
    color: 'Blanco', talla: 'S', costo: 80, precio: 200, stock: 5, estado: 'INACTIVO'
  });
`);
function resetVarT05Stock(stock) {
  runInContext(`DbHelper.updateRowById('Variantes', 'VAR-T05', { stock: ${stock} });`);
}
function buildValidPurchaseData(overrides) {
  // costo real 80 x 5 unidades = 400.
  const base = {
    proveedor: 'Confecciones Test SRL',
    items: [{ varianteId: 'VAR-T05', cantidad: 5, costoUnitario: 80, nombreProducto: 'Producto Compras Test' }],
    total: 400,
    formaPago: 'TRANSFERENCIA'
  };
  return Object.assign({}, base, overrides || {});
}

test('PURCHASE_LIST_RETURNS_REAL_PURCHASES', () => {
  resetVarT05Stock(10);
  const createRes = doPostRaw('purchases.create', buildValidPurchaseData(), adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const listRes = doPostRaw('purchases.list', {}, adminToken);
  assert(listRes.success === true, 'purchases.list debe responder success:true: ' + JSON.stringify(listRes));
  assert(Array.isArray(listRes.purchases), 'debe devolver un arreglo "purchases"');

  const found = listRes.purchases.find(p => p.id === createRes.compraId);
  assert(!!found, 'la compra recién creada debe aparecer en purchases.list');
  assertEqual(Number(found.total), 400, 'el total listado debe ser el autoritativo calculado por el backend');
  assertEqual(found.proveedor, 'Confecciones Test SRL');
  assert(Array.isArray(found.items) && found.items.length === 1, 'debe incluir el detalle real de items de la compra');
});

test('PURCHASE_CREATE_VALID_UPDATES_STOCK', () => {
  resetVarT05Stock(10);
  const res = doPostRaw('purchases.create', buildValidPurchaseData(), adminToken);
  assert(res.success === true, JSON.stringify(res));
  assertEqual(Number(res.total), 400, 'el backend debe calcular 5 x 80 = 400');

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 15, 'el stock debe incrementarse en exactamente 5 (10 + 5)');
});

test('PURCHASE_CREATE_CREATES_KARDEX', () => {
  resetVarT05Stock(10);
  const res = doPostRaw('purchases.create', buildValidPurchaseData(), adminToken);
  assert(res.success === true, JSON.stringify(res));

  const kardex = runInContext(`DbHelper.findRows('Inventario_Kardex', r => r.referencia === '${res.compraId}' && r.tipo === 'COMPRA')`);
  assert(kardex.length === 1, 'debe existir exactamente un movimiento de Kardex tipo COMPRA para esta compra');
  assertEqual(Number(kardex[0].cantidad), 5);
  assertEqual(Number(kardex[0].stock_anterior), 10);
  assertEqual(Number(kardex[0].stock_nuevo), 15);
  assertEqual(kardex[0].variante_id, 'VAR-T05');
});

test('PURCHASE_CREATE_UNAUTHORIZED_REJECTED', () => {
  resetVarT05Stock(10);
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('purchases.create', buildValidPurchaseData(), cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder registrar compras (no tiene compras.crear en el seed real)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 10, 'el stock no debe cambiar tras el rechazo por permisos');
});

test('PURCHASE_CREATE_INACTIVE_VARIANT_REJECTED', () => {
  const res = doPostRaw('purchases.create', buildValidPurchaseData({
    items: [{ varianteId: 'VAR-T05-INACTIVA', cantidad: 3, costoUnitario: 80, nombreProducto: 'Producto Compras Test' }],
    total: 240
  }), adminToken);
  assert(res.success === false, 'no debe poder recibirse mercancía sobre una variante inactiva');
  assert(String(res.error || '').indexOf('VALIDATION_ERROR') === 0, 'debe rechazar con VALIDATION_ERROR: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05-INACTIVA')");
  assertEqual(Number(variant.stock), 5, 'el stock de la variante inactiva no debe cambiar');
});

test('PURCHASE_CREATE_INVALID_QUANTITY_REJECTED', () => {
  resetVarT05Stock(10);
  const res = doPostRaw('purchases.create', buildValidPurchaseData({
    items: [{ varianteId: 'VAR-T05', cantidad: 0, costoUnitario: 80, nombreProducto: 'Producto Compras Test' }],
    total: 0
  }), adminToken);
  assert(res.success === false, 'una cantidad de 0 debe rechazarse');
  assert(String(res.error || '').indexOf('VALIDATION_ERROR') === 0, 'debe rechazar con VALIDATION_ERROR: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 10, 'el stock no debe cambiar tras el rechazo');
});

test('PURCHASE_CREATE_INVALID_COST_REJECTED', () => {
  resetVarT05Stock(10);
  const res = doPostRaw('purchases.create', buildValidPurchaseData({
    items: [{ varianteId: 'VAR-T05', cantidad: 5, costoUnitario: 0, nombreProducto: 'Producto Compras Test' }],
    total: 0
  }), adminToken);
  assert(res.success === false, 'un costo unitario de 0 debe rechazarse');
  assert(String(res.error || '').indexOf('VALIDATION_ERROR') === 0, 'debe rechazar con VALIDATION_ERROR: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 10, 'el stock no debe cambiar tras el rechazo');
});

test('PURCHASE_CLIENT_MANIPULATION_CANNOT_SET_ARBITRARY_TOTAL', () => {
  resetVarT05Stock(10);
  // Real: 5 x 80 = 400. El cliente declara un total manipulado de 10.
  const res = doPostRaw('purchases.create', buildValidPurchaseData({ total: 10 }), adminToken);
  assert(res.success === false, 'un total manipulado (10 en vez de 400) debe ser rechazado');
  assert(String(res.error || '').indexOf('PURCHASE_TOTAL_MISMATCH') === 0, 'debe rechazar exactamente con PURCHASE_TOTAL_MISMATCH: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 10, 'el stock NO debe incrementarse si la compra fue rechazada (sin escritura parcial)');
});

test('PURCHASE_CLIENT_MANIPULATION_CANNOT_SET_ARBITRARY_STOCK', () => {
  // El contrato real nunca lee un stock absoluto del payload -- confirma
  // que enviar campos como nuevoStock/stockNuevo junto a los datos reales
  // no tiene ningún efecto: el backend siempre calcula
  // stockNuevo = stockActual + cantidad dentro del lock.
  resetVarT05Stock(10);
  const res = doPostRaw('purchases.create', buildValidPurchaseData({
    nuevoStock: 999999,
    items: [{ varianteId: 'VAR-T05', cantidad: 5, costoUnitario: 80, nombreProducto: 'Producto Compras Test', stockNuevo: 999999 }]
  }), adminToken);
  assert(res.success === true, JSON.stringify(res));

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 15, 'el stock real debe ser 10 + 5 = 15, nunca 999999');
});

test('PURCHASE_CREATE_DOES_NOT_MODIFY_VARIANT_COST', () => {
  // FASE 3.7D (Sección 3/8 del encargo): se auditó el sistema completo y
  // se confirmó que NO existe una regla de costo promedio ponderado
  // definida en ninguna parte (ni backend, ni frontend, ni documentación)
  // -- Variantes.costo es un valor simple que SalesController toma tal
  // cual al momento de la venta. Implementar una fórmula aquí sería
  // inventar una regla financiera no autorizada. Esta prueba fija como
  // comportamiento esperado y verificado que una compra NO modifica
  // Variantes.costo, para detectar cualquier regresión futura que intente
  // tocarlo sin una decisión de negocio explícita.
  resetVarT05Stock(10);
  runInContext(`DbHelper.updateRowById('Variantes', 'VAR-T05', { costo: 80 });`);
  const res = doPostRaw('purchases.create', buildValidPurchaseData({
    items: [{ varianteId: 'VAR-T05', cantidad: 5, costoUnitario: 999, nombreProducto: 'Producto Compras Test' }],
    total: 4995
  }), adminToken);
  assert(res.success === true, JSON.stringify(res));

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.costo), 80, 'Variantes.costo debe permanecer sin cambios aunque la compra use un costoUnitario distinto (999) -- no existe regla de actualización definida');
});

test('PURCHASE_CREATE_AUDIT_IS_LOGGED', () => {
  resetVarT05Stock(10);
  const res = doPostRaw('purchases.create', buildValidPurchaseData(), adminToken);
  assert(res.success === true, JSON.stringify(res));
  const audit = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${res.compraId}' && r.accion === 'PURCHASE_CREATED')`);
  assert(audit.length === 1, 'debe existir exactamente un registro de auditoría PURCHASE_CREATED');
});

test('PURCHASE_CREATE_CONCURRENT_DELTAS_COMPOSE_CORRECTLY', () => {
  // NOTA DE ALCANCE (igual que INVENTORY_ADJUST_SEQUENTIAL_DELTAS_
  // COMPOSE_CORRECTLY de FASE 3.7C): este harness ejecuta cada doPostRaw
  // de forma síncrona y el LockService mock siempre concede el lock al
  // instante -- no existe forma de simular dos compras HTTP realmente
  // simultáneas aquí. Esta prueba valida que dos recepciones aplicadas en
  // secuencia sobre la misma variante componen correctamente
  // (10 + 5 + 3 = 18), la propiedad que el contrato delta-based garantiza
  // sin importar el orden. La protección real contra ejecución
  // concurrente depende de LockService de Apps Script en producción (ver
  // reporte, sección O).
  resetVarT05Stock(10);
  const r1 = doPostRaw('purchases.create', buildValidPurchaseData({
    items: [{ varianteId: 'VAR-T05', cantidad: 5, costoUnitario: 80, nombreProducto: 'Producto Compras Test' }], total: 400
  }), adminToken);
  assert(r1.success === true, JSON.stringify(r1));
  const r2 = doPostRaw('purchases.create', buildValidPurchaseData({
    items: [{ varianteId: 'VAR-T05', cantidad: 3, costoUnitario: 80, nombreProducto: 'Producto Compras Test' }], total: 240
  }), adminToken);
  assert(r2.success === true, JSON.stringify(r2));

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 18, '10 + 5 + 3 debe dar exactamente 18, sin importar el orden de aplicación');
});

test('PURCHASE_CREATE_ROLLBACK_ON_FAILURE', () => {
  resetVarT05Stock(10);
  const comprasAntes = runInContext("DbHelper.getAllRows('Compras').length");
  const kardexAntes = runInContext("DbHelper.getAllRows('Inventario_Kardex').length");

  // Mismo patrón que las demás pruebas *_ROLLBACK_*: ejercita directamente
  // el motor de compensación de DbHelper sobre operaciones de la misma
  // forma que handleCreatePurchase realiza (stock + Kardex + Compras),
  // forzando un fallo sintético después de escribir.
  runInContext(`
    var tx = DbHelper.beginTx();
    var variant = DbHelper.findById('Variantes', 'VAR-T05');
    DbHelper.recordUpdate(tx, 'Variantes', 'VAR-T05', { stock: variant.stock });
    DbHelper.updateRowById('Variantes', 'VAR-T05', { stock: Number(variant.stock) + 5 });
    DbHelper.insertRow('Inventario_Kardex', {
      id: 'MOV-PURCHASE-ROLLBACK-TEST', variante_id: 'VAR-T05', producto_id: 'PRD-T05', cantidad: 5,
      tipo: 'COMPRA', stock_anterior: variant.stock, stock_nuevo: Number(variant.stock) + 5,
      motivo: 'Rollback test', referencia: 'COM-ROLLBACK-TEST', fecha: getNowFormatted()
    });
    DbHelper.recordInsert(tx, 'Inventario_Kardex', 'MOV-PURCHASE-ROLLBACK-TEST');
    DbHelper.insertRow('Compras', {
      id: 'COM-ROLLBACK-TEST', numero_compra: 'COM-ROLLBACK-TEST', proveedor: 'Proveedor Rollback Test',
      items_json: '[]', total: 400, forma_pago: 'TRANSFERENCIA', estado: 'RECIBIDA', fecha: getNowFormatted()
    });
    DbHelper.recordInsert(tx, 'Compras', 'COM-ROLLBACK-TEST');
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T05')");
  assertEqual(Number(variant.stock), 10, 'el stock debe quedar restaurado al valor previo al intento fallido');

  const movRollback = runInContext("DbHelper.findById('Inventario_Kardex', 'MOV-PURCHASE-ROLLBACK-TEST')");
  assert(movRollback === null, 'la fila de Kardex insertada debe haberse eliminado por el rollback');

  const compraRollback = runInContext("DbHelper.findById('Compras', 'COM-ROLLBACK-TEST')");
  assert(compraRollback === null, 'la fila de Compras insertada debe haberse eliminado por el rollback');

  const comprasDespues = runInContext("DbHelper.getAllRows('Compras').length");
  const kardexDespues = runInContext("DbHelper.getAllRows('Inventario_Kardex').length");
  assertEqual(comprasDespues, comprasAntes, 'no debe quedar ninguna compra huérfana tras el rollback');
  assertEqual(kardexDespues, kardexAntes, 'no debe quedar ningún movimiento de Kardex huérfano tras el rollback');
});

/* ==================================================================
   13. GASTOS OPERATIVOS Y SU EFECTO EN CAJA (FASE 3.7E)
   ================================================================== */

// NOTA: ExpensesController.gs no tenía ninguna prueba antes de esta fase
// (0/72 cubrían expenses.list/expenses.create). No se modificó el
// controlador -- la auditoría confirmó que ya integra caja atómicamente
// dentro de LockService+beginTx/rollback (tipo 'GASTO' sobre un campo
// dedicado Cajas.gastos, no 'RETIRO'). Estas pruebas son confirmatorias:
// verifican por primera vez el contrato real del que ahora depende
// ExpensesView.

function buildValidExpenseData(overrides) {
  const base = {
    categoria: 'Servicios (Luz, Agua, Internet)',
    descripcion: 'Factura eléctrica de prueba',
    proveedor: 'EDEESTE Test',
    monto: 500,
    metodoPago: 'EFECTIVO'
  };
  return Object.assign({}, base, overrides || {});
}

test('EXPENSE_LIST_RETURNS_REAL_EXPENSES', () => {
  const createRes = doPostRaw('expenses.create', buildValidExpenseData(), adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const listRes = doPostRaw('expenses.list', {}, adminToken);
  assert(listRes.success === true, 'expenses.list debe responder success:true: ' + JSON.stringify(listRes));
  assert(Array.isArray(listRes.expenses), 'debe devolver un arreglo "expenses"');

  const found = listRes.expenses.find(e => e.id === createRes.gastoId);
  assert(!!found, 'el gasto recién creado debe aparecer en expenses.list');
  assertEqual(Number(found.monto), 500);
  assertEqual(found.categoria, 'Servicios (Luz, Agua, Internet)');
});

test('EXPENSE_CREATE_VALID', () => {
  const res = doPostRaw('expenses.create', buildValidExpenseData({ monto: 250, metodoPago: 'TRANSFERENCIA' }), adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(!!res.gastoId, 'debe devolver un gastoId real');

  const gasto = runInContext(`DbHelper.findById('Gastos', '${res.gastoId}')`);
  assert(!!gasto, 'debe existir la fila real del gasto en Gastos');
  assertEqual(Number(gasto.monto), 250);
});

test('EXPENSE_CREATE_UNAUTHORIZED_REJECTED', () => {
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('expenses.create', buildValidExpenseData(), cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder registrar gastos (no tiene gastos.crear en el seed real)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);
});

test('EXPENSE_CASH_EFECTIVO_WITH_OPEN_SESSION_CREATES_GASTO_MOVEMENT', () => {
  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const res = doPostRaw('expenses.create', buildValidExpenseData({ monto: 300, metodoPago: 'EFECTIVO' }), adminToken);
  assert(res.success === true, JSON.stringify(res));

  const gasto = runInContext(`DbHelper.findById('Gastos', '${res.gastoId}')`);
  assertEqual(gasto.caja_sesion_id, cajaId, 'el gasto debe quedar asociado a la caja real abierta');
  assertEqual(gasto.pagado_con_caja_activa, 'TRUE');

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.gastos), 300, 'caja: el campo gastos (ya restado en efectivoEsperado) debe reflejar el monto real');

  const cashMov = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.referencia === '${res.gastoId}' && r.tipo === 'GASTO')`);
  assert(cashMov.length === 1, 'debe existir exactamente un movimiento de caja tipo GASTO (no RETIRO) para este gasto');
  assertEqual(Number(cashMov[0].monto), 300);

  doPostRaw('cash.close', { efectivoRealContado: 700 }, adminToken);
});

test('EXPENSE_NON_CASH_DOES_NOT_CREATE_CASH_MOVEMENT', () => {
  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;
  const gastosAntes = Number(runInContext(`DbHelper.findById('Cajas', '${cajaId}')`).gastos) || 0;

  const res = doPostRaw('expenses.create', buildValidExpenseData({ monto: 150, metodoPago: 'TARJETA' }), adminToken);
  assert(res.success === true, JSON.stringify(res));

  const gasto = runInContext(`DbHelper.findById('Gastos', '${res.gastoId}')`);
  assertEqual(gasto.pagado_con_caja_activa, 'FALSE', 'un gasto con TARJETA no debe marcarse como pagado con caja activa');
  assertEqual(gasto.caja_sesion_id, '', 'un gasto con TARJETA no debe asociarse a ninguna caja');

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.gastos), gastosAntes, 'el campo gastos de la caja no debe cambiar para un gasto que no es en efectivo');

  const cashMov = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.referencia === '${res.gastoId}')`);
  assertEqual(cashMov.length, 0, 'no debe crearse ningún movimiento de caja para un gasto que no es en efectivo');

  doPostRaw('cash.close', { efectivoRealContado: 1000 }, adminToken);
});

test('EXPENSE_CASH_EFECTIVO_WITHOUT_OPEN_SESSION_STILL_SUCCEEDS_WITHOUT_CASH_EFFECT', () => {
  // Confirma el comportamiento real del backend (no inventado): un gasto
  // en efectivo SIN caja abierta no se bloquea -- simplemente se registra
  // sin efecto en caja. ExpensesView debe reflejar esto mismo, nunca
  // bloquear la operación por su cuenta.
  const res = doPostRaw('expenses.create', buildValidExpenseData({ monto: 80, metodoPago: 'EFECTIVO' }), adminToken);
  assert(res.success === true, 'un gasto en efectivo sin caja abierta debe registrarse igual: ' + JSON.stringify(res));

  const gasto = runInContext(`DbHelper.findById('Gastos', '${res.gastoId}')`);
  assertEqual(gasto.pagado_con_caja_activa, 'FALSE', 'sin caja abierta, no puede marcarse como pagado con caja activa');
  assertEqual(gasto.caja_sesion_id, '', 'sin caja abierta, no debe quedar asociado a ninguna caja');

  const cashMov = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.referencia === '${res.gastoId}')`);
  assertEqual(cashMov.length, 0, 'no debe crearse ningún movimiento de caja si no había ninguna abierta');
});

test('EXPENSE_CREATE_AUDIT_IS_LOGGED', () => {
  const res = doPostRaw('expenses.create', buildValidExpenseData(), adminToken);
  assert(res.success === true, JSON.stringify(res));
  const audit = runInContext(`DbHelper.findRows('Auditoria', r => r.entidad_id === '${res.gastoId}' && r.accion === 'EXPENSE_CREATED')`);
  assert(audit.length === 1, 'debe existir exactamente un registro de auditoría EXPENSE_CREATED');
});

test('EXPENSE_CREATE_ROLLBACK_ON_FAILURE', () => {
  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;
  const gastosDbAntes = runInContext("DbHelper.getAllRows('Gastos').length");
  const cashMovAntes = runInContext("DbHelper.getAllRows('Caja_Movimientos').length");

  // Mismo patrón que las demás pruebas *_ROLLBACK_*: ejercita directamente
  // el motor de compensación de DbHelper sobre operaciones de la misma
  // forma que handleCreateExpense realiza (Cajas.gastos + Caja_Movimientos
  // + Gastos), forzando un fallo sintético después de escribir. Esto
  // confirma el mecanismo YA existente en el backend real -- no se
  // modificó ExpensesController.gs en esta fase.
  runInContext(`
    var tx = DbHelper.beginTx();
    var caja = DbHelper.findById('Cajas', '${cajaId}');
    DbHelper.recordUpdate(tx, 'Cajas', '${cajaId}', { gastos: caja.gastos });
    DbHelper.updateRowById('Cajas', '${cajaId}', { gastos: Number(caja.gastos) + 999 });
    DbHelper.insertRow('Caja_Movimientos', {
      id: 'CMOV-EXPENSE-ROLLBACK-TEST', caja_sesion_id: '${cajaId}', tipo: 'GASTO', monto: 999,
      motivo: 'Rollback test', referencia: 'GAS-ROLLBACK-TEST', fecha: getNowFormatted(), estado: 'ACTIVO'
    });
    DbHelper.recordInsert(tx, 'Caja_Movimientos', 'CMOV-EXPENSE-ROLLBACK-TEST');
    DbHelper.insertRow('Gastos', {
      id: 'GAS-ROLLBACK-TEST', numero_gasto: 'GAS-ROLLBACK-TEST', categoria: 'OTROS', descripcion: 'Rollback test',
      monto: 999, metodo_pago: 'EFECTIVO', caja_sesion_id: '${cajaId}', fecha: getNowFormatted(), pagado_con_caja_activa: 'TRUE'
    });
    DbHelper.recordInsert(tx, 'Gastos', 'GAS-ROLLBACK-TEST');
    DbHelper.rollback(tx, new Error('fallo sintético forzado por el test'));
  `);

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.gastos), 0, 'el campo gastos de la caja debe quedar restaurado al valor previo al intento fallido');

  const gastoRollback = runInContext("DbHelper.findById('Gastos', 'GAS-ROLLBACK-TEST')");
  assert(gastoRollback === null, 'la fila de Gastos insertada debe haberse eliminado por el rollback');

  const cashMovRollback = runInContext("DbHelper.findById('Caja_Movimientos', 'CMOV-EXPENSE-ROLLBACK-TEST')");
  assert(cashMovRollback === null, 'la fila de Caja_Movimientos insertada debe haberse eliminado por el rollback');

  const gastosDbDespues = runInContext("DbHelper.getAllRows('Gastos').length");
  const cashMovDespues = runInContext("DbHelper.getAllRows('Caja_Movimientos').length");
  assertEqual(gastosDbDespues, gastosDbAntes, 'no debe quedar ningún gasto huérfano tras el rollback');
  assertEqual(cashMovDespues, cashMovAntes, 'no debe quedar ningún movimiento de caja huérfano tras el rollback');

  doPostRaw('cash.close', { efectivoRealContado: 1000 }, adminToken);
});

/* ==================================================================
   14. DEVOLUCIONES — CONTRATO REAL PARA CONSUMO FRONTEND (FASE 3.7F)
   ================================================================== */

// NOTA: ReturnsController.gs ya tenía cobertura completa de
// manipulación/exceso/doble devolución/rollback desde FASE 3.6D (ver
// sección 9 de este archivo) -- no se duplica esa cobertura aquí. Estas
// dos pruebas cubren específicamente lo que faltaba para conectar el
// frontend real (contrato de returns.list y RBAC de returns.create), tal
// como pide el encargo de esta fase. No se modificó ReturnsController.gs.

test('RETURNS_LIST_RETURNS_REAL_RETURNS', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Prueba de contrato returns.list', tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));

  const listRes = doPostRaw('returns.list', {}, adminToken);
  assert(listRes.success === true, 'returns.list debe responder success:true: ' + JSON.stringify(listRes));
  assert(Array.isArray(listRes.returns), 'debe devolver un arreglo "returns"');

  const found = listRes.returns.find(r => r.id === returnRes.devolucionId);
  assert(!!found, 'la devolución recién creada debe aparecer en returns.list');
  assertEqual(Number(found.montoDevuelto), returnRes.montoDevuelto, 'el monto listado debe ser el autoritativo calculado por el backend');
  assertEqual(found.ventaId, saleRes.saleId);
  assert(Array.isArray(found.items) && found.items.length === 1, 'debe incluir el detalle real de items de la devolución');
  assertEqual(found.items[0].varianteId, 'VAR-T01');
});

test('RETURN_CREATE_UNAUTHORIZED_REJECTED', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Intento sin permiso', tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder procesar devoluciones (no tiene devoluciones.crear en el seed real)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);

  const variant = runInContext("DbHelper.findById('Variantes', 'VAR-T01')");
  assertEqual(Number(variant.stock), 4, 'el stock no debe cambiar tras el rechazo por permisos (5 - 1 de la venta, sin devolución)');
});

/* ==================================================================
   15. ADMINISTRACIÓN DE USUARIOS / RBAC (FASE 3.7G)
   ================================================================== */

// NOTA: auth.listUsers ya tenía cobertura de permiso desde antes
// (PERMISSION_CAJERO_CANNOT_MANAGE_USERS / PERMISSION_ADMIN_CAN_MANAGE_USERS,
// sección 3) -- no se duplica. Estas pruebas cubren lo que faltaba:
// auth.saveUser (crear/editar/permiso/password/rol/auto-escalación). No
// se modificó AuthController.gs/Security.gs/SeedSetup.gs.

test('AUTH_SAVE_USER_UNAUTHORIZED_REJECTED', () => {
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('auth.saveUser', {
    usuario: 'intento.sin.permiso', nombre: 'Intento', rol: 'CAJERO', password: 'temporal123'
  }, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder crear/editar usuarios (no tiene admin.usuarios en el seed real)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);
});

test('AUTH_SAVE_USER_CREATES_VALID_USER_WITHOUT_EXPOSING_PASSWORD', () => {
  const res = doPostRaw('auth.saveUser', {
    usuario: 'empleado.prueba', nombre: 'Empleado', apellido: 'Prueba', rol: 'VENDEDOR', password: 'ClaveReal123'
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(!!res.userId, 'debe devolver un userId real');

  const listRes = doPostRaw('auth.listUsers', {}, adminToken);
  assert(listRes.success === true, JSON.stringify(listRes));
  const found = listRes.users.find(u => u.id === res.userId);
  assert(!!found, 'el usuario recién creado debe aparecer en auth.listUsers');
  assertEqual(found.usuario, 'empleado.prueba');
  assertEqual(found.rol, 'VENDEDOR');
  assert(!('password' in found) && !('password_hash' in found) && !('passwordHash' in found) && !('password_salt' in found),
    'auth.listUsers NUNCA debe exponer la contraseña ni su hash/sal, ni siquiera al propio administrador');

  // Confirma también contra la fila real de Sheets (no solo la respuesta HTTP).
  const rawRow = runInContext(`DbHelper.findById('Usuarios', '${res.userId}')`);
  assert(!!rawRow.password_hash && !!rawRow.password_salt, 'debe existir hash y sal reales en la fila');
  assert(rawRow.password_hash !== 'ClaveReal123', 'la contraseña jamás debe almacenarse en texto plano');
});

test('AUTH_SAVE_USER_UPDATES_EXISTING_USER_PRESERVES_PASSWORD_WHEN_BLANK', () => {
  const createRes = doPostRaw('auth.saveUser', {
    usuario: 'empleado.editar', nombre: 'Antes', rol: 'CAJERO', password: 'PasswordOriginal1'
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));
  const hashAntes = runInContext(`DbHelper.findById('Usuarios', '${createRes.userId}')`).password_hash;

  // Edición SIN enviar password -- el backend ya soporta explícitamente
  // "campo vacío/ausente = no cambiar contraseña" (ver AuthController.gs).
  const updateRes = doPostRaw('auth.saveUser', {
    id: createRes.userId, usuario: 'empleado.editar', nombre: 'Despues', rol: 'SUPERVISOR'
  }, adminToken);
  assert(updateRes.success === true, JSON.stringify(updateRes));

  const rowDespues = runInContext(`DbHelper.findById('Usuarios', '${createRes.userId}')`);
  assertEqual(rowDespues.nombre, 'Despues', 'el nombre sí debe actualizarse');
  assertEqual(rowDespues.rol, 'SUPERVISOR', 'el rol sí debe actualizarse');
  assertEqual(rowDespues.password_hash, hashAntes, 'la contraseña NO debe cambiar si no se envía en la edición');
});

test('AUTH_SAVE_USER_ACCEPTS_ANY_ROL_STRING_NO_WHITELIST', () => {
  // HALLAZGO DE AUDITORÍA (documentado en el reporte, no corregido en
  // esta fase por no ser una escalación de privilegios real ni una
  // vulnerabilidad crítica): handleSaveUser solo valida que `rol` venga
  // presente (truthy), NUNCA que sea uno de los 5 roles reales del seed.
  // Esta prueba confirma el comportamiento REAL actual (no lo que
  // "debería" ser) -- un rol inexistente simplemente no encuentra
  // coincidencia en Roles_Permisos y el usuario queda con cero permisos
  // efectivos (Security.hasPermission retorna [] si no hay roleConfig),
  // no con privilegios elevados.
  const res = doPostRaw('auth.saveUser', {
    usuario: 'empleado.rol.raro', nombre: 'Rol Raro', rol: 'ROL_QUE_NO_EXISTE', password: 'Temporal123'
  }, adminToken);
  assert(res.success === true, 'el backend real actualmente NO valida que rol sea uno de los 5 reales: ' + JSON.stringify(res));

  const rawRow = runInContext(`DbHelper.findById('Usuarios', '${res.userId}')`);
  assertEqual(rawRow.rol, 'ROL_QUE_NO_EXISTE');

  // Confirma que ese rol inexistente no otorga NINGÚN permiso real.
  const rolePermsResult = runInContext(`Security.hasPermission({ rol: 'ROL_QUE_NO_EXISTE' }, 'admin.usuarios')`);
  assertEqual(rolePermsResult, false, 'un rol sin fila real en Roles_Permisos no debe otorgar ningún permiso, ni siquiera por accidente');
});

test('AUTH_SAVE_USER_CANNOT_SELF_ESCALATE_WITHOUT_PERMISSION', () => {
  // Verifica específicamente el escenario de auto-escalación descrito en
  // el encargo: un CAJERO (sin admin.usuarios) intenta modificar SU
  // PROPIO registro para asignarse el rol ADMIN. El backend lo rechaza
  // con el mismo gate de permiso que protege todo el endpoint -- no
  // existe una ruta alterna. No se modificó AuthController.gs.
  const cajeroSession = login('cajero', 'cajero123');
  const cajeroId = cajeroSession.user.id;

  const res = doPostRaw('auth.saveUser', {
    id: cajeroId, usuario: 'cajero', nombre: 'Cajero', rol: 'ADMIN'
  }, cajeroSession.sessionToken);
  assert(res.success === false, 'un CAJERO nunca debe poder auto-promoverse a ADMIN');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);

  const rawRow = runInContext(`DbHelper.findById('Usuarios', '${cajeroId}')`);
  assertEqual(rawRow.rol, 'CAJERO', 'el rol real del cajero no debe haber cambiado');
});

/* ==================================================================
   16. CONFIGURACIÓN EMPRESARIAL / SETTINGS (FASE 3.7H)
   ================================================================== */

test('SETTINGS_READ_IS_PUBLIC_NO_SESSION_REQUIRED', () => {
  // Hallazgo de auditoría (no asumido): system.getSettings está en
  // publicActions de Main.gs -- no exige sessionToken. Se confirma el
  // comportamiento real en vez de asumir que debería rechazar sin sesión.
  const res = doPostRaw('system.getSettings', {}, undefined);
  assert(res.success === true, 'system.getSettings debe responder success:true incluso sin sessionToken: ' + JSON.stringify(res));
  assert(res.settings && typeof res.settings === 'object', 'debe devolver un objeto "settings"');
});

test('SETTINGS_SAVE_UNAUTHORIZED_REJECTED', () => {
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('system.updateSettings', { nombreNegocio: 'Intento Sin Permiso' }, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder actualizar configuración (no tiene admin.configuracion en el seed real)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);
});

test('SETTINGS_SAVE_INVALID_PAYLOAD_REJECTED', () => {
  const res = doPostRaw('system.updateSettings', 'esto no es un objeto', adminToken);
  assert(res.success === false, 'un payload que no sea un objeto debe rechazarse');
  assert(String(res.error || '').indexOf('VALIDATION_ERROR') === 0, 'debe rechazar con VALIDATION_ERROR: ' + res.error);
});

test('SETTINGS_SAVE_AUTHORIZED_PERSISTS_AND_SUBSEQUENT_READ_RETURNS_IT', () => {
  // Esta prueba cubre específicamente el hallazgo P0 de esta fase: antes
  // de la corrección, la SEGUNDA vez que se guardaba la MISMA clave
  // (es decir, actualizar en vez de insertar) lanzaba
  // "La hoja 'Configuracion' no tiene columna 'id'" porque
  // DbHelper.updateRowById() asume una columna 'id' que esa hoja no
  // tiene (su PK real es 'clave'). seedInitialData() ya siembra
  // 'nombreNegocio' desde el arranque, así que cualquier guardado real de
  // este campo ya ejercita la rama de actualización.
  const primerValor = `ZIO CLOTHES Test ${Date.now()}`;
  const res1 = doPostRaw('system.updateSettings', { nombreNegocio: primerValor }, adminToken);
  assert(res1.success === true, 'primer guardado (posible actualización sobre clave ya sembrada) debe tener éxito: ' + JSON.stringify(res1));

  const read1 = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read1.settings.nombreNegocio, primerValor, 'la lectura posterior debe devolver el valor recién guardado');

  // Segundo guardado de la MISMA clave -- ejercita la rama de
  // actualización una vez más, confirmando que no era un problema de
  // "primera vez únicamente".
  const segundoValor = `ZIO CLOTHES Test 2 ${Date.now()}`;
  const res2 = doPostRaw('system.updateSettings', { nombreNegocio: segundoValor }, adminToken);
  assert(res2.success === true, 'segundo guardado de la misma clave (actualización real) debe tener éxito: ' + JSON.stringify(res2));

  const read2 = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read2.settings.nombreNegocio, segundoValor, 'la lectura posterior debe devolver el valor actualizado, no el anterior');

  // Confirma también contra la fila real de Sheets -- debe existir
  // exactamente una fila para esta clave (no una insertada de más cada
  // vez que se "actualiza").
  const filasNombreNegocio = runInContext("DbHelper.getAllRows('Configuracion').filter(r => r.clave === 'nombreNegocio')");
  assertEqual(filasNombreNegocio.length, 1, 'debe existir exactamente una fila para la clave nombreNegocio, nunca una duplicada por cada guardado');
});

test('SETTINGS_SAVE_NEW_KEY_INSERTS_ROW', () => {
  const claveUnica = `campoPruebaFase37H_${Date.now()}`;
  const res = doPostRaw('system.updateSettings', { [claveUnica]: 'valor de prueba' }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const fila = runInContext(`DbHelper.getAllRows('Configuracion').find(r => r.clave === '${claveUnica}')`);
  assert(!!fila, 'debe insertarse una fila real para una clave nueva');
  assertEqual(fila.valor, 'valor de prueba');
});

test('SETTINGS_UPDATE_IS_AUDITED', () => {
  const res = doPostRaw('system.updateSettings', { nombreNegocio: 'ZIO CLOTHES Auditoria Test' }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  const audit = runInContext("DbHelper.findRows('Auditoria', r => r.accion === 'SETTINGS_UPDATED')");
  assert(audit.length >= 1, 'debe existir al menos un registro de auditoría SETTINGS_UPDATED');
});

/* ================================================================
   PRODUCTS -- FASE 2: reemplazo seguro y limpieza de imágenes de Drive
   (extractManagedDriveFileId_ / isFileInManagedFolder_ /
   isFileStillReferencedByAnotherProduct_ / trashManagedImageIfSafe_,
   integradas en handleSaveProduct). Usa __mockDrive (arriba, solo de
   este arnés) para sembrar archivos falsos sin tocar Drive real.
   ================================================================ */

const managedFolderId = runInContext("PropertiesService.getScriptProperties().getProperty('PRODUCT_IMAGES_FOLDER_ID')");
if (!managedFolderId) {
  console.error('FATAL: seedInitialData() debía haber configurado PRODUCT_IMAGES_FOLDER_ID. Abortando suite.');
  process.exit(1);
}

function driveUrlUc(fileId) { return `https://drive.google.com/uc?export=view&id=${fileId}`; }
function driveUrlThumb(fileId) { return `https://drive.google.com/thumbnail?id=${fileId}`; }

test('PRODUCT_IMAGE_EXTRACT_FILEID_FROM_UC_EXPORT_VIEW_URL', () => {
  const id = runInContext(`ProductsController.extractManagedDriveFileId_(${JSON.stringify(driveUrlUc('ABC123'))})`);
  assertEqual(id, 'ABC123');
});

test('PRODUCT_IMAGE_EXTRACT_FILEID_FROM_THUMBNAIL_URL', () => {
  const id = runInContext(`ProductsController.extractManagedDriveFileId_(${JSON.stringify(driveUrlThumb('ABC123'))})`);
  assertEqual(id, 'ABC123');
});

test('PRODUCT_IMAGE_EXTERNAL_URL_NEVER_RECOGNIZED_AS_MANAGED', () => {
  const id = runInContext(`ProductsController.extractManagedDriveFileId_(${JSON.stringify('https://images.unsplash.com/foto.jpg')})`);
  assert(id === null, 'una URL externa nunca debe reconocerse como archivo administrado');
});

test('PRODUCT_IMAGE_BASE64_NEVER_RECOGNIZED_AS_MANAGED', () => {
  const id = runInContext(`ProductsController.extractManagedDriveFileId_(${JSON.stringify('data:image/png;base64,AAAA')})`);
  assert(id === null, 'un Data URL Base64 histórico nunca debe reconocerse como archivo administrado');
});

test('PRODUCT_IMAGE_EMPTY_URL_NEVER_RECOGNIZED_AS_MANAGED', () => {
  const id = runInContext(`ProductsController.extractManagedDriveFileId_('')`);
  assert(id === null, 'una URL vacía (foto eliminada) nunca debe reconocerse como archivo administrado');
});

test('PRODUCT_IMAGE_NONEXISTENT_FILEID_IS_NOT_MANAGED_FOLDER', () => {
  const result = runInContext(`ProductsController.isFileInManagedFolder_('FILE-DOES-NOT-EXIST-01')`);
  assert(result === false, 'un fileId inexistente nunca debe considerarse dentro de la carpeta administrada');
});

test('PRODUCT_IMAGE_FILE_OUTSIDE_MANAGED_FOLDER_NOT_TRUSTED', () => {
  runInContext(`__mockDrive.createFile('FILE-OUTSIDE-01', 'SOME-OTHER-FOLDER-ID')`);
  const result = runInContext(`ProductsController.isFileInManagedFolder_('FILE-OUTSIDE-01')`);
  assert(result === false, 'un archivo que pertenece a otra carpeta de Drive nunca debe tratarse como administrado por nosotros');
});

test('PRODUCT_IMAGE_FILE_INSIDE_MANAGED_FOLDER_IS_TRUSTED', () => {
  runInContext(`__mockDrive.createFile('FILE-INSIDE-01', ${JSON.stringify(managedFolderId)})`);
  const result = runInContext(`ProductsController.isFileInManagedFolder_('FILE-INSIDE-01')`);
  assert(result === true, 'un archivo que sí pertenece a PRODUCT_IMAGES_FOLDER_ID debe reconocerse como administrado');
});

test('PRODUCT_IMAGE_STILL_REFERENCED_BY_ANOTHER_PRODUCT_IS_DETECTED', () => {
  runInContext(`__mockDrive.createFile('FILE-SHARED-01', ${JSON.stringify(managedFolderId)})`);
  runInContext(`
    DbHelper.insertRow('Productos', {
      id: 'PRD-IMG-SHARED', sku: 'SKU-IMG-SHARED', codigo_barras: '', nombre: 'Producto Imagen Compartida',
      descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
      proveedor_id: '', costo: 100, precio: 200, precio_especial: '', impuesto: 18,
      descuento_maximo: 0, stock_minimo: 2, estado: 'ACTIVO',
      imagen_url: ${JSON.stringify(driveUrlUc('FILE-SHARED-01'))}, creado_en: getNowFormatted()
    });
  `);

  const stillUsedByOther = runInContext(`ProductsController.isFileStillReferencedByAnotherProduct_('FILE-SHARED-01', 'ALGUN-OTRO-PRODUCTO-ID')`);
  assert(stillUsedByOther === true, 'debe detectar que otro producto sigue usando el mismo fileId');

  const notUsedIfSelfExcluded = runInContext(`ProductsController.isFileStillReferencedByAnotherProduct_('FILE-SHARED-01', 'PRD-IMG-SHARED')`);
  assert(notUsedIfSelfExcluded === false, 'el propio producto que se está actualizando nunca debe contar como "otro producto"');
});

test('PRODUCT_IMAGE_TRASH_SKIPPED_WHEN_STILL_REFERENCED_BY_ANOTHER_PRODUCT', () => {
  // Reutiliza FILE-SHARED-01 -- sigue referenciado por PRD-IMG-SHARED (test anterior).
  runInContext(`ProductsController.trashManagedImageIfSafe_(${JSON.stringify(driveUrlUc('FILE-SHARED-01'))}, '', null)`);
  const trashed = runInContext(`__mockDrive.isTrashed('FILE-SHARED-01')`);
  assert(trashed === false, 'no debe enviarse a la papelera una imagen que otro producto todavía utiliza');
});

test('PRODUCT_IMAGE_TRASH_NEVER_THROWS_FOR_EXTERNAL_URL', () => {
  const outcome = runInContext(`(function(){ try { ProductsController.trashManagedImageIfSafe_(${JSON.stringify('https://images.unsplash.com/foto.jpg')}, '', null); return 'no-throw'; } catch(e) { return 'threw:' + e.message; } })()`);
  assertEqual(outcome, 'no-throw', 'trashManagedImageIfSafe_ nunca debe lanzar un error, ni siquiera ante una URL no reconocida');
});

test('PRODUCT_IMAGE_TRASH_NEVER_THROWS_FOR_BASE64', () => {
  const outcome = runInContext(`(function(){ try { ProductsController.trashManagedImageIfSafe_(${JSON.stringify('data:image/png;base64,AAAA')}, '', null); return 'no-throw'; } catch(e) { return 'threw:' + e.message; } })()`);
  assertEqual(outcome, 'no-throw', 'trashManagedImageIfSafe_ nunca debe lanzar un error, ni siquiera ante un Base64 histórico');
});

test('PRODUCT_IMAGE_TRASH_SKIPPED_WHEN_SAME_AS_URL_TO_KEEP', () => {
  runInContext(`__mockDrive.createFile('FILE-SAMEKEEP-01', ${JSON.stringify(managedFolderId)})`);
  runInContext(`ProductsController.trashManagedImageIfSafe_(${JSON.stringify(driveUrlUc('FILE-SAMEKEEP-01'))}, ${JSON.stringify(driveUrlUc('FILE-SAMEKEEP-01'))}, null)`);
  const trashed = runInContext(`__mockDrive.isTrashed('FILE-SAMEKEEP-01')`);
  assert(trashed === false, 'si la URL a limpiar es idéntica a la que se conserva, no debe borrarse nada');
});

test('PRODUCT_SAVE_CREATE_WITH_IMAGE_NEVER_TRIGGERS_CLEANUP', () => {
  const fileId = 'FILE-CREATE-01';
  runInContext(`__mockDrive.createFile('${fileId}', ${JSON.stringify(managedFolderId)})`);

  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Recien Creado Con Foto', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(fileId),
    variantes: [{ color: 'Negro', talla: 'M', stock: 3, precio: 500, costo: 250 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  assert(runInContext(`__mockDrive.isTrashed('${fileId}')`) === false, 'crear un producto nunca debe disparar limpieza -- no existe imagen anterior');
});

test('PRODUCT_SAVE_REPLACING_MANAGED_IMAGE_TRASHES_OLD_ONE_AFTER_SUCCESSFUL_SAVE', () => {
  const oldFileId = 'FILE-REPLACE-OLD-01';
  const newFileId = 'FILE-REPLACE-NEW-01';
  runInContext(`__mockDrive.createFile('${oldFileId}', ${JSON.stringify(managedFolderId)})`);
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);

  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Reemplazo De Imagen', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(oldFileId),
    variantes: [{ color: 'Negro', talla: 'M', stock: 3, precio: 500, costo: 250 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));
  const productId = createRes.productId;

  const updateRes = doPostRaw('products.save', {
    id: productId, nombre: 'Producto Reemplazo De Imagen', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlThumb(newFileId), // formato de visualización (thumbnail) -- también debe reconocerse
    variantes: [{ color: 'Negro', talla: 'M', stock: 3, precio: 500, costo: 250 }],
  }, adminToken);
  assert(updateRes.success === true, JSON.stringify(updateRes));

  assert(runInContext(`__mockDrive.isTrashed('${oldFileId}')`) === true, 'la imagen anterior debe enviarse a la papelera tras un reemplazo exitoso');
  assert(runInContext(`__mockDrive.isTrashed('${newFileId}')`) === false, 'la imagen nueva/activa nunca debe tocarse');

  const productRow = runInContext(`DbHelper.findById('Productos', '${productId}')`);
  assertEqual(productRow.imagen_url, driveUrlThumb(newFileId));
});

test('PRODUCT_SAVE_WITHOUT_CHANGING_IMAGE_DOES_NOT_TRIGGER_CLEANUP', () => {
  const fileId = 'FILE-UNCHANGED-01';
  runInContext(`__mockDrive.createFile('${fileId}', ${JSON.stringify(managedFolderId)})`);

  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Sin Cambiar Foto', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(fileId),
    variantes: [{ color: 'Azul', talla: 'S', stock: 2, precio: 400, costo: 200 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const updateRes = doPostRaw('products.save', {
    id: createRes.productId, nombre: 'Producto Sin Cambiar Foto (editado)', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(fileId), // misma URL -- el usuario no tocó la foto, solo editó el nombre
    variantes: [{ color: 'Azul', talla: 'S', stock: 2, precio: 450, costo: 200 }],
  }, adminToken);
  assert(updateRes.success === true, JSON.stringify(updateRes));

  assert(runInContext(`__mockDrive.isTrashed('${fileId}')`) === false, 'editar otros campos sin cambiar la foto nunca debe limpiar la imagen activa');
});

test('PRODUCT_SAVE_REMOVING_IMAGE_TRASHES_OLD_MANAGED_FILE', () => {
  const fileId = 'FILE-REMOVED-01';
  runInContext(`__mockDrive.createFile('${fileId}', ${JSON.stringify(managedFolderId)})`);

  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Con Foto Eliminada Despues', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(fileId),
    variantes: [{ color: 'Verde', talla: 'L', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const updateRes = doPostRaw('products.save', {
    id: createRes.productId, nombre: 'Producto Con Foto Eliminada Despues', categoriaId: 'CAT-T01',
    imagenUrl: '', // el usuario eliminó explícitamente la foto
    variantes: [{ color: 'Verde', talla: 'L', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(updateRes.success === true, JSON.stringify(updateRes));

  assert(runInContext(`__mockDrive.isTrashed('${fileId}')`) === true, 'eliminar la foto de un producto debe limpiar el archivo administrado anterior si es seguro hacerlo');
});

test('PRODUCT_SAVE_REPLACING_EXTERNAL_URL_NEVER_THROWS_OR_TOUCHES_DRIVE', () => {
  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Con URL Externa', categoriaId: 'CAT-T01',
    imagenUrl: 'https://images.unsplash.com/foto-externa-01.jpg',
    variantes: [{ color: 'Blanco', talla: 'M', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const newFileId = 'FILE-REPLACING-EXTERNAL-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const updateRes = doPostRaw('products.save', {
    id: createRes.productId, nombre: 'Producto Con URL Externa', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(newFileId),
    variantes: [{ color: 'Blanco', talla: 'M', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  // El objetivo principal de este test: reemplazar una URL externa nunca
  // debe hacer explotar products.save intentando un DriveApp.getFileById
  // sobre algo que nunca fue un fileId real.
  assert(updateRes.success === true, JSON.stringify(updateRes));
  assert(runInContext(`__mockDrive.isTrashed('${newFileId}')`) === false, 'la imagen nueva activa nunca debe tocarse');
});

test('PRODUCT_SAVE_REPLACING_HISTORIC_BASE64_NEVER_THROWS_OR_TOUCHES_DRIVE', () => {
  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Con Base64 Historico', categoriaId: 'CAT-T01',
    imagenUrl: 'data:image/png;base64,AAAAB64HISTORICO==',
    variantes: [{ color: 'Gris', talla: 'S', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const newFileId = 'FILE-REPLACING-BASE64-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const updateRes = doPostRaw('products.save', {
    id: createRes.productId, nombre: 'Producto Con Base64 Historico', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlThumb(newFileId),
    variantes: [{ color: 'Gris', talla: 'S', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(updateRes.success === true, JSON.stringify(updateRes));
  assert(runInContext(`__mockDrive.isTrashed('${newFileId}')`) === false, 'la imagen nueva activa nunca debe tocarse');
});

test('PRODUCT_SAVE_FAILURE_TRASHES_NEWLY_UPLOADED_ORPHAN_IMAGE', () => {
  // CASO B (auditoría FASE 2): simula que handleUploadImage ya subió la
  // imagen nueva a Drive con éxito, pero products.save falla justo
  // después (aquí, forzado con un id de producto que no existe) -- la
  // imagen recién subida quedaría huérfana y debe limpiarse.
  const orphanFileId = 'FILE-ORPHAN-ON-SAVE-FAIL-01';
  runInContext(`__mockDrive.createFile('${orphanFileId}', ${JSON.stringify(managedFolderId)})`);

  const res = doPostRaw('products.save', {
    id: 'PRD-DOES-NOT-EXIST-XYZ',
    nombre: 'Producto Fantasma', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(orphanFileId),
    variantes: [{ color: 'Negro', talla: 'M', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);

  assert(res.success === false, 'el guardado debe fallar -- el producto referenciado no existe');
  assert(String(res.error || '').indexOf('No se encontró el registro') !== -1, 'debe propagarse el error real de DbHelper.updateRowById, sin ocultarlo: ' + res.error);
  assert(runInContext(`__mockDrive.isTrashed('${orphanFileId}')`) === true, 'la imagen recién subida debe limpiarse cuando el guardado del producto falla (CASO B)');
});

/* ================================================================
   COMPANY LOGO -- FASE 3: logo personalizado del negocio, reutilizando
   íntegramente la infraestructura de Drive de FASE 2 (misma carpeta
   administrada, mismo trashManagedImageIfSafe_, misma extracción de
   fileId). Reutiliza managedFolderId/driveUrlUc/driveUrlThumb/adminToken
   ya definidos arriba, en la sección PRODUCTS -- FASE 2.

   Nota de alcance (ver reporte): esta aplicación es de UN solo negocio,
   no multi-empresa -- los ítems del PASO 18 de la fase que asumen
   múltiples "empresas" (crear empresa con/sin logo, logo usado por OTRA
   empresa, empresas múltiples no interfieren) no tienen equivalente real
   en esta arquitectura y NO se simulan aquí con datos inventados. Sí se
   cubren todos los demás: fallback, upload, reemplazo, limpieza tras
   éxito, upload fallido, save fallido (CASO B), limpieza fallida sin
   afectar el guardado (CASO C), URL externa, Base64, archivo fuera de la
   carpeta administrada, archivo usado por un producto, y edición sin
   tocar el logo.
   ================================================================ */

test('SETTINGS_LOGO_DEFAULT_IS_EMPTY_STRING_FALLBACK_TO_SYSTEM_LOGO', () => {
  // Ítem 1 del PASO 18: empresa sin logo -> fallback al logo del sistema.
  // handleGetSettings() debe devolver siempre '' (nunca undefined) para
  // que el frontend pueda decidir el fallback sin casos especiales.
  const res = doPostRaw('system.getSettings', {}, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(res.settings.logoUrl === '' || typeof res.settings.logoUrl === 'string', 'logoUrl debe ser siempre un string (nunca undefined), aunque no se haya configurado ninguno');
});

test('SETTINGS_UPLOAD_LOGO_UNAUTHORIZED_REJECTED', () => {
  // PASO 20: la subida del logo debe exigir el mismo permiso real
  // ('admin.configuracion') que ya protege el resto de esta
  // configuración -- validado en backend, no solo en frontend.
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('settings.uploadLogo', { imageDataUrl: 'data:image/png;base64,AAAA' }, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder subir el logo de la empresa (no tiene admin.configuracion)');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);
});

test('SETTINGS_UPDATE_LOGO_UNAUTHORIZED_REJECTED', () => {
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlUc('FILE-LOGO-UNAUTH-01') }, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder cambiar el logo vía system.updateSettings');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, 'debe rechazar con FORBIDDEN: ' + res.error);
});

test('SETTINGS_UPLOAD_LOGO_SUCCESS_RETURNS_URL_AND_FILEID', () => {
  // Ítem 3 del PASO 18. Usa un Data URL Base64 real y mínimo (PNG 1x1
  // transparente) -- ejercita la decodificación/validación real, no un
  // mock de esa parte.
  const tinyPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const res = doPostRaw('settings.uploadLogo', { imageDataUrl: tinyPngBase64 }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(!!res.fileId, 'debe devolver un fileId real');
  assert(res.imageUrl === driveUrlUc(res.fileId), 'debe devolver la URL en el mismo formato uc?export=view usado por fotos de productos');

  // El archivo debe haberse creado dentro de la carpeta administrada.
  const inFolder = runInContext(`ProductsController.isFileInManagedFolder_(${JSON.stringify(res.fileId)})`);
  assert(inFolder === true, 'el logo subido debe quedar dentro de PRODUCT_IMAGES_FOLDER_ID, la misma carpeta que las fotos de productos');
});

test('SETTINGS_UPLOAD_LOGO_INVALID_BASE64_REJECTED_SETTINGS_UNCHANGED', () => {
  // Ítem 6 del PASO 18: upload falla -> logo anterior intacto. Como
  // uploadLogo nunca toca Configuracion (solo sube a Drive), basta con
  // confirmar que la subida inválida falla y que el logoUrl actual no
  // cambió como efecto secundario.
  const before = doPostRaw('system.getSettings', {}, adminToken).settings.logoUrl;
  const res = doPostRaw('settings.uploadLogo', { imageDataUrl: 'no-es-un-data-url' }, adminToken);
  assert(res.success === false, 'un Base64 inválido debe rechazarse');
  const after = doPostRaw('system.getSettings', {}, adminToken).settings.logoUrl;
  assertEqual(after, before, 'un upload fallido nunca debe modificar la configuración guardada');
});

test('SETTINGS_UPDATE_SETTING_LOGO_FOR_FIRST_TIME_USES_CUSTOM_LOGO', () => {
  // Ítem 2 del PASO 18: empresa con logo -> utiliza el logo personalizado.
  const fileId = 'FILE-LOGO-FIRST-TIME-01';
  runInContext(`__mockDrive.createFile('${fileId}', ${JSON.stringify(managedFolderId)})`);

  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(fileId) }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.logoUrl, driveUrlUc(fileId));
});

test('SETTINGS_UPDATE_REPLACING_LOGO_TRASHES_OLD_ONE_AFTER_SUCCESSFUL_SAVE', () => {
  // Ítems 4 y 5 del PASO 18: reemplazo de logo + limpieza tras save exitoso.
  const oldFileId = 'FILE-LOGO-REPLACE-OLD-01';
  const newFileId = 'FILE-LOGO-REPLACE-NEW-01';
  runInContext(`__mockDrive.createFile('${oldFileId}', ${JSON.stringify(managedFolderId)})`);
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);

  const setRes = doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(oldFileId) }, adminToken);
  assert(setRes.success === true, JSON.stringify(setRes));

  const replaceRes = doPostRaw('system.updateSettings', { logoUrl: driveUrlThumb(newFileId) }, adminToken);
  assert(replaceRes.success === true, JSON.stringify(replaceRes));

  assert(runInContext(`__mockDrive.isTrashed('${oldFileId}')`) === true, 'el logo anterior debe enviarse a la papelera tras un reemplazo exitoso');
  assert(runInContext(`__mockDrive.isTrashed('${newFileId}')`) === false, 'el logo nuevo/activo nunca debe tocarse');

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.logoUrl, driveUrlThumb(newFileId));
});

test('SETTINGS_UPDATE_WITHOUT_LOGO_KEY_NEVER_TOUCHES_LOGO_OR_DRIVE', () => {
  // Ítem 16 del PASO 18: editar otros campos sin tocar el logo -> no debe
  // subir, no debe crear, no debe limpiar nada. Se simula exactamente lo
  // que el frontend hace cuando selectedLogoFile es null: el payload de
  // system.updateSettings ni siquiera incluye la clave 'logoUrl'.
  const fileId = 'FILE-LOGO-UNCHANGED-01';
  runInContext(`__mockDrive.createFile('${fileId}', ${JSON.stringify(managedFolderId)})`);
  doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(fileId) }, adminToken);

  const res = doPostRaw('system.updateSettings', { nombreNegocio: 'ZIO CLOTHES (editado sin tocar logo)' }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  assert(runInContext(`__mockDrive.isTrashed('${fileId}')`) === false, 'editar otros campos sin incluir logoUrl nunca debe limpiar el logo activo');
  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.logoUrl, driveUrlUc(fileId), 'el logo activo debe permanecer intacto');
});

test('SETTINGS_UPDATE_REMOVING_LOGO_RETURNS_TO_SYSTEM_LOGO_AND_TRASHES_OLD_FILE', () => {
  // Ítem 17 del PASO 18: "usar logo del sistema" -- logoUrl vacío.
  const fileId = 'FILE-LOGO-REMOVED-01';
  runInContext(`__mockDrive.createFile('${fileId}', ${JSON.stringify(managedFolderId)})`);
  doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(fileId) }, adminToken);

  const res = doPostRaw('system.updateSettings', { logoUrl: '' }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  assert(runInContext(`__mockDrive.isTrashed('${fileId}')`) === true, 'volver al logo del sistema debe limpiar el archivo administrado anterior si es seguro hacerlo');
  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.logoUrl, '', 'logoUrl debe quedar vacío -- el frontend debe volver a mostrar el logo del sistema');
});

test('SETTINGS_UPDATE_REPLACING_EXTERNAL_LOGO_URL_NEVER_TOUCHES_DRIVE', () => {
  // Ítem 9 del PASO 18.
  doPostRaw('system.updateSettings', { logoUrl: 'https://images.unsplash.com/logo-externo-01.jpg' }, adminToken);

  const newFileId = 'FILE-LOGO-REPLACING-EXTERNAL-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(newFileId) }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(runInContext(`__mockDrive.isTrashed('${newFileId}')`) === false, 'el logo nuevo activo nunca debe tocarse');
});

test('SETTINGS_UPDATE_REPLACING_HISTORIC_BASE64_LOGO_NEVER_TOUCHES_DRIVE', () => {
  // Ítem 10 del PASO 18.
  doPostRaw('system.updateSettings', { logoUrl: 'data:image/png;base64,AAAAB64HISTORICOLOGO==' }, adminToken);

  const newFileId = 'FILE-LOGO-REPLACING-BASE64-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlThumb(newFileId) }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(runInContext(`__mockDrive.isTrashed('${newFileId}')`) === false, 'el logo nuevo activo nunca debe tocarse');
});

test('SETTINGS_UPDATE_REPLACING_LOGO_OUTSIDE_MANAGED_FOLDER_NEVER_TRASHED', () => {
  // Ítem 11 del PASO 18: archivo de Drive con formato reconocible, pero
  // que NO pertenece a PRODUCT_IMAGES_FOLDER_ID -- nunca debe borrarse.
  const outsideFileId = 'FILE-LOGO-OUTSIDE-FOLDER-01';
  runInContext(`__mockDrive.createFile('${outsideFileId}', 'SOME-UNRELATED-FOLDER-ID')`);
  doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(outsideFileId) }, adminToken);

  const newFileId = 'FILE-LOGO-REPLACING-OUTSIDE-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlThumb(newFileId) }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  assert(runInContext(`__mockDrive.isTrashed('${outsideFileId}')`) === false, 'un archivo fuera de la carpeta administrada nunca debe enviarse a la papelera, aunque el formato de URL sea reconocible');
});

test('SETTINGS_UPDATE_REPLACING_LOGO_STILL_USED_BY_A_PRODUCT_NEVER_TRASHED', () => {
  // Ítem 13 del PASO 18 (protección cruzada logo <-> productos, PASO 9):
  // si el logo anterior es el mismo archivo que un producto sigue usando
  // como su foto, reemplazar el logo NUNCA debe borrar ese archivo.
  const sharedFileId = 'FILE-LOGO-SHARED-WITH-PRODUCT-01';
  runInContext(`__mockDrive.createFile('${sharedFileId}', ${JSON.stringify(managedFolderId)})`);
  runInContext(`
    DbHelper.insertRow('Productos', {
      id: 'PRD-USES-LOGO-FILE', sku: 'SKU-USES-LOGO-FILE', codigo_barras: '', nombre: 'Producto Que Usa El Archivo Del Logo',
      descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
      proveedor_id: '', costo: 100, precio: 200, precio_especial: '', impuesto: 18,
      descuento_maximo: 0, stock_minimo: 2, estado: 'ACTIVO',
      imagen_url: ${JSON.stringify(driveUrlUc(sharedFileId))}, creado_en: getNowFormatted()
    });
  `);

  doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(sharedFileId) }, adminToken);

  const newFileId = 'FILE-LOGO-REPLACING-SHARED-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlThumb(newFileId) }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  assert(runInContext(`__mockDrive.isTrashed('${sharedFileId}')`) === false, 'un archivo todavía usado por un producto nunca debe borrarse al reemplazar el logo');
});

test('PRODUCT_SAVE_REPLACING_IMAGE_NEVER_TRASHES_FILE_CURRENTLY_USED_AS_COMPANY_LOGO', () => {
  // Protección simétrica (PASO 9, aplicada también en la otra dirección):
  // si la foto anterior de un producto es el mismo archivo que la empresa
  // usa hoy como logo, reemplazar la foto del producto NUNCA debe borrar
  // ese archivo.
  const sharedFileId = 'FILE-PRODUCT-SHARED-WITH-LOGO-01';
  runInContext(`__mockDrive.createFile('${sharedFileId}', ${JSON.stringify(managedFolderId)})`);
  doPostRaw('system.updateSettings', { logoUrl: driveUrlUc(sharedFileId) }, adminToken);

  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Que Comparte Archivo Con El Logo', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlUc(sharedFileId),
    variantes: [{ color: 'Negro', talla: 'M', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const newFileId = 'FILE-PRODUCT-REPLACING-SHARED-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const updateRes = doPostRaw('products.save', {
    id: createRes.productId, nombre: 'Producto Que Comparte Archivo Con El Logo', categoriaId: 'CAT-T01',
    imagenUrl: driveUrlThumb(newFileId),
    variantes: [{ color: 'Negro', talla: 'M', stock: 1, precio: 300, costo: 150 }],
  }, adminToken);
  assert(updateRes.success === true, JSON.stringify(updateRes));

  assert(runInContext(`__mockDrive.isTrashed('${sharedFileId}')`) === false, 'un archivo usado actualmente como logo de la empresa nunca debe borrarse al reemplazar la foto de un producto');
});

test('SETTINGS_UPDATE_FAILURE_TRASHES_NEWLY_UPLOADED_ORPHAN_LOGO_CASO_B', () => {
  // CASO B: el logo nuevo ya se subió a Drive con éxito, pero
  // system.updateSettings falla justo después -- forzado aquí
  // monkey-parcheando temporalmente updateSettingsTransaction_ (no existe
  // una forma natural de hacer fallar el upsert genérico de Configuracion
  // con un payload inválido, a diferencia de products.save con un id de
  // producto inexistente). Se restaura la función real al terminar.
  const orphanFileId = 'FILE-LOGO-ORPHAN-CASO-B-01';
  runInContext(`__mockDrive.createFile('${orphanFileId}', ${JSON.stringify(managedFolderId)})`);

  const outcome = runInContext(`
    (function() {
      const user = Security.validateSession(${JSON.stringify(adminToken)});
      const original = SettingsController.updateSettingsTransaction_;
      SettingsController.updateSettingsTransaction_ = function() {
        throw new Error('SIMULATED_TRANSACTION_FAILURE_FOR_TEST');
      };
      let result;
      try {
        SettingsController.handleUpdateSettings({ logoUrl: ${JSON.stringify(driveUrlUc(orphanFileId))} }, user);
        result = 'did-not-throw';
      } catch (e) {
        result = 'threw:' + e.message;
      } finally {
        SettingsController.updateSettingsTransaction_ = original;
      }
      return result;
    })()
  `);

  assert(outcome.indexOf('SIMULATED_TRANSACTION_FAILURE_FOR_TEST') !== -1, 'debe relanzar el error original sin ocultarlo: ' + outcome);
  assert(runInContext(`__mockDrive.isTrashed('${orphanFileId}')`) === true, 'el logo recién subido debe limpiarse si falla el guardado de la configuración (CASO B)');
});

test('SETTINGS_UPDATE_SUCCEEDS_EVEN_IF_OLD_LOGO_CLEANUP_CANNOT_VERIFY_FILE_CASO_C', () => {
  // CASO C: la limpieza del logo anterior no se puede verificar (el
  // fileId "anterior" ya no existe en Drive -- por ejemplo, alguien lo
  // borró manualmente por fuera del sistema) -- eso nunca debe impedir
  // que el guardado de la nueva configuración sea exitoso.
  const setupRes = doPostRaw('system.updateSettings', { logoUrl: driveUrlUc('FILE-LOGO-DOES-NOT-EXIST-CASO-C-01') }, adminToken);
  assert(setupRes.success === true, JSON.stringify(setupRes));

  const newFileId = 'FILE-LOGO-CASO-C-NEW-01';
  runInContext(`__mockDrive.createFile('${newFileId}', ${JSON.stringify(managedFolderId)})`);
  const res = doPostRaw('system.updateSettings', { logoUrl: driveUrlThumb(newFileId) }, adminToken);
  assert(res.success === true, 'el guardado debe ser exitoso aunque la limpieza del logo anterior no pueda verificarse: ' + JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.logoUrl, driveUrlThumb(newFileId));
});

/* ================================================================
   RECEIPT TEXTS -- FASE 4: textos del recibo (eslogan, mensajeFinalRecibo,
   pieTecnicoRecibo) como datos configurables en Configuracion, en vez de
   texto fijo dentro de ReceiptTicket.tsx. Reutiliza el mismo mecanismo
   genérico de handleUpdateSettings/handleGetSettings -- sin lógica nueva
   de backend más allá de los 3 valores por defecto agregados.

   Nota de alcance (ver reporte): el renderizado condicional real
   (`{settings.x && <div>...}`) vive en un componente React
   (ReceiptTicket.tsx) que este arnés de pruebas en Node no puede montar
   ni renderizar (no hay DOM/React aquí, solo el backend de Apps Script
   simulado) -- los ítems 1-8, 15 y 16 del PASO 19 (aparece/desaparece
   visualmente, espaciado, negrita) quedan como prueba manual pendiente,
   documentada en el reporte. Lo que SÍ se prueba aquí es la parte real de
   backend: que estos 3 valores tengan defaults no vacíos, que se puedan
   guardar y leer de vuelta (incluyendo dejarlos vacíos deliberadamente,
   que es la precondición para que la lógica `&&` ya existente en el
   frontend los oculte), y que sean independientes entre sí.
   ================================================================ */

test('SETTINGS_RECEIPT_TEXTS_HAVE_NON_EMPTY_DEFAULTS_MATCHING_PREVIOUS_HARDCODED_VALUES', () => {
  // PASO 4/15: una instalación que nunca guardó estas claves debe recibir
  // el mismo texto que antes estaba fijo en el componente -- nunca
  // undefined -- para no producir una regresión visual.
  const res = doPostRaw('system.getSettings', {}, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(typeof res.settings.eslogan === 'string' && res.settings.eslogan.length > 0, 'eslogan debe tener un default no vacío');
  assert(typeof res.settings.mensajeFinalRecibo === 'string' && res.settings.mensajeFinalRecibo.length > 0, 'mensajeFinalRecibo debe tener un default no vacío');
  assert(typeof res.settings.pieTecnicoRecibo === 'string' && res.settings.pieTecnicoRecibo.length > 0, 'pieTecnicoRecibo debe tener un default no vacío');
});

test('SETTINGS_UPDATE_RECEIPT_TEXTS_PERSISTS_AND_READS_BACK_CUSTOM_VALUES', () => {
  // Ítem 14 del PASO 19: modificar la configuración se refleja al leerla
  // de nuevo -- lo mismo que luego el recibo consumiría vía `settings`.
  const res = doPostRaw('system.updateSettings', {
    eslogan: 'Mi tienda de ropa',
    mensajeFinalRecibo: 'Gracias por su compra.',
    pieTecnicoRecibo: 'Comprobante autorizado',
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.eslogan, 'Mi tienda de ropa');
  assertEqual(read.settings.mensajeFinalRecibo, 'Gracias por su compra.');
  assertEqual(read.settings.pieTecnicoRecibo, 'Comprobante autorizado');
});

test('SETTINGS_UPDATE_RECEIPT_TEXTS_CAN_BE_CLEARED_TO_EMPTY_STRING', () => {
  // Precondición real de los ítems 2/4/6/8 del PASO 19 ("vacío -> no
  // aparece"): el backend debe permitir que estos campos queden
  // literalmente '' (nunca conservar el valor anterior ni caer a un
  // default) -- la lógica `&&` que ya existe en ReceiptTicket.tsx depende
  // de esto exactamente.
  doPostRaw('system.updateSettings', {
    eslogan: 'Valor temporal antes de vaciar',
    mensajeFinalRecibo: 'Valor temporal antes de vaciar',
    pieTecnicoRecibo: 'Valor temporal antes de vaciar',
  }, adminToken);

  const res = doPostRaw('system.updateSettings', {
    eslogan: '',
    mensajeFinalRecibo: '',
    pieTecnicoRecibo: '',
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.eslogan, '', 'eslogan debe poder quedar vacío -- así el recibo lo omite');
  assertEqual(read.settings.mensajeFinalRecibo, '', 'mensajeFinalRecibo debe poder quedar vacío -- así el recibo lo omite');
  assertEqual(read.settings.pieTecnicoRecibo, '', 'pieTecnicoRecibo debe poder quedar vacío -- así el recibo lo omite');
});

test('SETTINGS_UPDATE_ONE_RECEIPT_TEXT_DOES_NOT_AFFECT_THE_OTHERS', () => {
  doPostRaw('system.updateSettings', {
    eslogan: 'Eslogan Independiente Test',
    mensajeFinalRecibo: 'Mensaje Final Independiente Test',
    pieTecnicoRecibo: 'Pie Tecnico Independiente Test',
  }, adminToken);

  const res = doPostRaw('system.updateSettings', { eslogan: 'Solo Cambio El Eslogan' }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.eslogan, 'Solo Cambio El Eslogan');
  assertEqual(read.settings.mensajeFinalRecibo, 'Mensaje Final Independiente Test', 'actualizar el eslogan no debe afectar mensajeFinalRecibo');
  assertEqual(read.settings.pieTecnicoRecibo, 'Pie Tecnico Independiente Test', 'actualizar el eslogan no debe afectar pieTecnicoRecibo');
});

/* ================================================================
   ABONO RECEIPT TEXTS -- FASE 5: textos del recibo de PAGO/ABONO
   (mensajeFinalAbono, mensajeReciboPie, pieTecnicoAbono) como datos
   configurables, deliberadamente separados de los del recibo de VENTA
   (mensajeFinalRecibo/pieTecnicoRecibo, Fase 4) para que cambiar el texto
   de un recibo nunca afecte al otro. Reutiliza el mismo mecanismo
   genérico de handleUpdateSettings/handleGetSettings.

   Nota de alcance (igual que en Fase 4): el renderizado condicional real
   vive en InstallmentReceiptTicket.tsx (React), que este arnés no puede
   montar -- lo que sí se prueba aquí es la parte real de backend: defaults
   no vacíos, guardar/leer valores, vaciarlos, independencia entre ellos, e
   independencia respecto a los campos homólogos del recibo de venta.
   ================================================================ */

test('SETTINGS_ABONO_RECEIPT_TEXTS_HAVE_NON_EMPTY_DEFAULTS_MATCHING_PREVIOUS_HARDCODED_VALUES', () => {
  const res = doPostRaw('system.getSettings', {}, adminToken);
  assert(res.success === true, JSON.stringify(res));
  assert(typeof res.settings.mensajeReciboPie === 'string' && res.settings.mensajeReciboPie.length > 0, 'mensajeReciboPie debe tener un default no vacío');
  assert(typeof res.settings.mensajeFinalAbono === 'string' && res.settings.mensajeFinalAbono.length > 0, 'mensajeFinalAbono debe tener un default no vacío');
  assert(typeof res.settings.pieTecnicoAbono === 'string' && res.settings.pieTecnicoAbono.length > 0, 'pieTecnicoAbono debe tener un default no vacío');
});

test('SETTINGS_UPDATE_ABONO_RECEIPT_TEXTS_PERSISTS_AND_READS_BACK_CUSTOM_VALUES', () => {
  const res = doPostRaw('system.updateSettings', {
    mensajeFinalAbono: 'Gracias por su pago puntual.',
    mensajeReciboPie: 'Guarde este comprobante para cualquier reclamo.',
    pieTecnicoAbono: 'Comprobante autorizado',
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.mensajeFinalAbono, 'Gracias por su pago puntual.');
  assertEqual(read.settings.mensajeReciboPie, 'Guarde este comprobante para cualquier reclamo.');
  assertEqual(read.settings.pieTecnicoAbono, 'Comprobante autorizado');
});

test('SETTINGS_UPDATE_ABONO_RECEIPT_TEXTS_CAN_BE_CLEARED_TO_EMPTY_STRING', () => {
  doPostRaw('system.updateSettings', {
    mensajeFinalAbono: 'Valor temporal antes de vaciar',
    mensajeReciboPie: 'Valor temporal antes de vaciar',
    pieTecnicoAbono: 'Valor temporal antes de vaciar',
  }, adminToken);

  const res = doPostRaw('system.updateSettings', {
    mensajeFinalAbono: '',
    mensajeReciboPie: '',
    pieTecnicoAbono: '',
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.mensajeFinalAbono, '', 'mensajeFinalAbono debe poder quedar vacío -- así el recibo de abono lo omite');
  assertEqual(read.settings.mensajeReciboPie, '', 'mensajeReciboPie debe poder quedar vacío -- así el recibo de abono lo omite');
  assertEqual(read.settings.pieTecnicoAbono, '', 'pieTecnicoAbono debe poder quedar vacío -- así el recibo de abono solo muestra el nombre del negocio');
});

test('SETTINGS_UPDATE_ONE_ABONO_RECEIPT_TEXT_DOES_NOT_AFFECT_THE_OTHERS', () => {
  doPostRaw('system.updateSettings', {
    mensajeFinalAbono: 'Abono Independiente Test',
    mensajeReciboPie: 'Recibo Pie Independiente Test',
    pieTecnicoAbono: 'Pie Tecnico Abono Independiente Test',
  }, adminToken);

  const res = doPostRaw('system.updateSettings', { mensajeFinalAbono: 'Solo Cambio El Mensaje Final De Abono' }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.mensajeFinalAbono, 'Solo Cambio El Mensaje Final De Abono');
  assertEqual(read.settings.mensajeReciboPie, 'Recibo Pie Independiente Test', 'actualizar mensajeFinalAbono no debe afectar mensajeReciboPie');
  assertEqual(read.settings.pieTecnicoAbono, 'Pie Tecnico Abono Independiente Test', 'actualizar mensajeFinalAbono no debe afectar pieTecnicoAbono');
});

test('SETTINGS_UPDATE_ABONO_RECEIPT_TEXTS_NEVER_AFFECT_SALES_RECEIPT_TEXTS', () => {
  // Prueba de independencia crítica (motivo por el que se crearon campos
  // NUEVOS en vez de reutilizar mensajeFinalRecibo/pieTecnicoRecibo del
  // recibo de venta, Fase 4): cambiar los textos del recibo de ABONO
  // nunca debe alterar los del recibo de VENTA, y viceversa.
  doPostRaw('system.updateSettings', {
    mensajeFinalRecibo: 'Mensaje De Venta Original',
    pieTecnicoRecibo: 'Pie Tecnico De Venta Original',
  }, adminToken);

  const res = doPostRaw('system.updateSettings', {
    mensajeFinalAbono: 'Mensaje De Abono Nuevo',
    pieTecnicoAbono: 'Pie Tecnico De Abono Nuevo',
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const read = doPostRaw('system.getSettings', {}, adminToken);
  assertEqual(read.settings.mensajeFinalRecibo, 'Mensaje De Venta Original', 'cambiar los textos del recibo de abono no debe afectar el recibo de venta');
  assertEqual(read.settings.pieTecnicoRecibo, 'Pie Tecnico De Venta Original', 'cambiar los textos del recibo de abono no debe afectar el recibo de venta');
  assertEqual(read.settings.mensajeFinalAbono, 'Mensaje De Abono Nuevo');
  assertEqual(read.settings.pieTecnicoAbono, 'Pie Tecnico De Abono Nuevo');
});

/* ================================================================
   PRODUCTS -- NORMALIZACIÓN COMERCIAL: variantes opcionales por
   producto (tiene_variantes). El backend NO cambió su forma de guardar
   stock/variantes -- sigue siendo exclusivamente Variantes.stock, sin
   segunda fuente de verdad. Lo único nuevo es la columna informativa
   `tiene_variantes` en Productos y que un producto "simple" ahora se
   guarda con exactamente 1 variante implícita (talla/color vacíos ->
   ProductsController.gs ya los completaba con 'U'/'Único' desde antes de
   esta fase, comportamiento reutilizado tal cual).
   ================================================================ */

test('PRODUCT_SAVE_SIMPLE_NO_VARIANTS_CREATES_SINGLE_IMPLICIT_VARIANT', () => {
  // CASO 1 (variantes OFF, código OFF -- se autogenera).
  const res = doPostRaw('products.save', {
    nombre: 'Cargador USB-C 25W', categoriaId: 'CAT-T01',
    tieneVariantes: false,
    variantes: [{ talla: '', color: '', stock: 20, costo: 700, precio: 1200, estado: 'ACTIVO' }],
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === res.productId);
  assert(!!prod, 'el producto debe aparecer en products.list');
  assertEqual(prod.tieneVariantes, false, 'tieneVariantes debe persistir como false');
  assertEqual(prod.variantes.length, 1, 'un producto simple debe tener exactamente 1 variante implícita');
  assertEqual(prod.variantes[0].talla, 'U', 'sin talla especificada, debe usar el mismo centinela ya existente');
  assertEqual(prod.variantes[0].color, 'Único', 'sin color especificado, debe usar el mismo centinela ya existente');
  assertEqual(prod.variantes[0].stock, 20);
  assertEqual(prod.totalStock, 20);
});

test('PRODUCT_SAVE_SIMPLE_WITH_CODE_SHARES_CODE_WITH_PRODUCT', () => {
  // CASO 2 (variantes OFF, código ON) -- el código del producto y el de
  // su única variante deben coincidir, para que una búsqueda/escaneo por
  // ese código encuentre el producto sin importar por cuál campo se busque.
  const res = doPostRaw('products.save', {
    nombre: 'Cargador USB-C 25W (con código)', categoriaId: 'CAT-T01',
    codigoBarras: '746624958111',
    tieneVariantes: false,
    variantes: [{ talla: '', color: '', codigoBarras: '746624958111', stock: 20, costo: 700, precio: 1200, estado: 'ACTIVO' }],
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === res.productId);
  assertEqual(prod.codigoBarras, '746624958111');
  assertEqual(prod.variantes[0].codigoBarras, '746624958111', 'el código del producto y el de su variante implícita deben coincidir');
});

test('PRODUCT_SAVE_WITH_VARIANTS_TRUE_MULTIPLE_COMBINATIONS_UNAFFECTED', () => {
  // CASO 3 (variantes ON, códigos compartidos OFF) -- el mecanismo de
  // combinaciones existente sigue funcionando exactamente igual.
  const res = doPostRaw('products.save', {
    nombre: 'Camisa Oxford', categoriaId: 'CAT-T01',
    tieneVariantes: true,
    variantes: [
      { talla: 'S', color: 'Negro', stock: 5, costo: 400, precio: 900, estado: 'ACTIVO' },
      { talla: 'M', color: 'Negro', stock: 5, costo: 400, precio: 900, estado: 'ACTIVO' },
      { talla: 'M', color: 'Blanco', stock: 5, costo: 400, precio: 900, estado: 'ACTIVO' },
      { talla: 'L', color: 'Azul', stock: 5, costo: 400, precio: 900, estado: 'ACTIVO' },
    ],
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === res.productId);
  assertEqual(prod.tieneVariantes, true);
  assertEqual(prod.variantes.length, 4, 'las 4 combinaciones deben crearse tal cual, sin fusionarse ni perderse');
  assertEqual(prod.totalStock, 20);
});

test('PRODUCT_SAVE_WITH_VARIANTS_AND_INDIVIDUAL_CODES_PRESERVED', () => {
  // CASO 4 (variantes ON, códigos individuales ON).
  const res = doPostRaw('products.save', {
    nombre: 'Camisa Oxford (códigos individuales)', categoriaId: 'CAT-T01',
    tieneVariantes: true,
    variantes: [
      { talla: 'M', color: 'Negro', codigoBarras: '74672206634', stock: 3, costo: 400, precio: 900, estado: 'ACTIVO' },
      { talla: 'M', color: 'Beige', codigoBarras: '746729384102', stock: 3, costo: 400, precio: 900, estado: 'ACTIVO' },
    ],
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));

  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === res.productId);
  const codes = prod.variantes.map(v => v.codigoBarras).sort();
  assert(codes.indexOf('74672206634') !== -1 && codes.indexOf('746729384102') !== -1, 'cada variante debe conservar su propio código individual: ' + JSON.stringify(codes));
});

test('PRODUCT_INDEPENDENCE_VARIANTS_OFF_DOES_NOT_FORCE_CODE_OFF', () => {
  // PASO 11: activar/desactivar variantes nunca debe forzar el estado del
  // código -- ya probado arriba que variantes OFF + código ON funciona
  // (PRODUCT_SAVE_SIMPLE_WITH_CODE_SHARES_CODE_WITH_PRODUCT). Aquí se
  // confirma el inverso: variantes OFF + SIN código explícito (backend
  // autogenera uno) -- no revienta ni exige nada relacionado a variantes.
  const res = doPostRaw('products.save', {
    nombre: 'Producto Simple Sin Codigo Explicito', categoriaId: 'CAT-T01',
    tieneVariantes: false,
    variantes: [{ talla: '', color: '', stock: 10, costo: 100, precio: 200, estado: 'ACTIVO' }],
  }, adminToken);
  assert(res.success === true, JSON.stringify(res));
  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === res.productId);
  // El código a nivel de PRODUCTO solo se guarda si se envía explícitamente
  // (comportamiento preexistente, sin cambios) -- pero la variante implícita
  // sí recibe un código autogenerado, igual que cualquier variante sin
  // codigoBarras explícito desde antes de esta fase.
  assert(!!prod.variantes[0].codigoBarras, 'la variante implícita debe tener un código (autogenerado si no se envía uno), igual que cualquier variante');
});

test('PRODUCT_INDEPENDENCE_VARIANTS_ON_DOES_NOT_REQUIRE_CODES', () => {
  const res = doPostRaw('products.save', {
    nombre: 'Camisa Oxford Sin Codigos Individuales', categoriaId: 'CAT-T01',
    tieneVariantes: true,
    variantes: [
      { talla: 'S', color: 'Negro', stock: 5, costo: 400, precio: 900, estado: 'ACTIVO' },
      { talla: 'M', color: 'Negro', stock: 5, costo: 400, precio: 900, estado: 'ACTIVO' },
    ],
  }, adminToken);
  assert(res.success === true, 'variantes ON no debe exigir códigos individuales por variante: ' + JSON.stringify(res));
});

test('PRODUCT_EXISTING_WITHOUT_TIENE_VARIANTES_COLUMN_RETURNS_UNDEFINED_NOT_FALSE', () => {
  // Compatibilidad (Parte 12): simula un producto guardado ANTES de esta
  // fase -- fila insertada directamente sin pasar por products.save, sin
  // ningún valor en tiene_variantes (columna vacía, como quedaría en una
  // instalación real que todavía no corrió esta fase en su Sheet).
  runInContext(`
    DbHelper.insertRow('Productos', {
      id: 'PRD-LEGACY-01', sku: 'SKU-LEGACY-01', codigo_barras: '', nombre: 'Producto Legacy Pre-Fase',
      descripcion: '', categoria_id: 'CAT-T01', categoria_nombre: 'Categoria Test', marca: 'ZIO',
      proveedor_id: '', costo: 100, precio: 200, precio_especial: '', impuesto: 18,
      descuento_maximo: 0, stock_minimo: 2, estado: 'ACTIVO', imagen_url: '', creado_en: getNowFormatted()
    });
    DbHelper.insertRow('Variantes', {
      id: 'VAR-LEGACY-01', producto_id: 'PRD-LEGACY-01', sku: 'SKU-LEGACY-01-U', codigo_barras: '7460009999999',
      color: 'Único', talla: 'U', costo: 100, precio: 200, stock: 15, estado: 'ACTIVO'
    });
  `);

  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === 'PRD-LEGACY-01');
  assert(!!prod, 'el producto legacy debe seguir apareciendo en el catálogo');
  assertEqual(prod.tieneVariantes, undefined, 'sin la columna nueva, debe llegar undefined -- nunca false a ciegas');
  assertEqual(prod.variantes.length, 1);
  assertEqual(prod.variantes[0].stock, 15, 'el stock existente no debe alterarse');
});

test('PRODUCT_SIMPLE_SALE_DEDUCTS_STOCK_CORRECTLY', () => {
  // PASO 13/14/16: venta de un producto simple debe descontar stock
  // exactamente igual que cualquier venta -- misma SalesController.gs,
  // sin ninguna rama especial para "producto simple".
  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Simple Para Venta', categoriaId: 'CAT-T01', impuesto: 0,
    tieneVariantes: false,
    variantes: [{ talla: '', color: '', stock: 10, costo: 100, precio: 200, estado: 'ACTIVO' }],
  }, adminToken);
  assert(createRes.success === true, JSON.stringify(createRes));

  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === createRes.productId);
  const varianteId = prod.variantes[0].id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    items: [{
      productoId: prod.id, varianteId, nombreProducto: prod.nombre, sku: prod.variantes[0].sku,
      talla: 'U', color: 'Único', cantidad: 2, costoUnitario: 100, precioUnitario: 200,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 400, impuestoMonto: 0, total: 400
    }],
    subtotal: 400, descuentoTotal: 0, impuestoTotal: 0, total: 400, costoTotal: 200,
    pagos: [{ metodo: 'EFECTIVO', monto: 400 }],
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const variant = runInContext(`DbHelper.findById('Variantes', '${varianteId}')`);
  assertEqual(Number(variant.stock), 8, 'el stock de la variante implícita debe descontarse igual que cualquier venta');
});

test('PRODUCT_SIMPLE_RETURN_RESTOCKS_CORRECTLY', () => {
  // Devolución del mismo producto simple -- debe reingresar stock por el
  // mismo mecanismo ya existente (ReturnsController.gs), sin caso especial.
  const createRes = doPostRaw('products.save', {
    nombre: 'Producto Simple Para Devolucion', categoriaId: 'CAT-T01', impuesto: 0,
    tieneVariantes: false,
    variantes: [{ talla: '', color: '', stock: 10, costo: 100, precio: 200, estado: 'ACTIVO' }],
  }, adminToken);
  const list = doPostRaw('products.list', {}, adminToken);
  const prod = list.products.find(p => p.id === createRes.productId);
  const varianteId = prod.variantes[0].id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    items: [{
      productoId: prod.id, varianteId, nombreProducto: prod.nombre, sku: prod.variantes[0].sku,
      talla: 'U', color: 'Único', cantidad: 3, costoUnitario: 100, precioUnitario: 200,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 600, impuestoMonto: 0, total: 600
    }],
    subtotal: 600, descuentoTotal: 0, impuestoTotal: 0, total: 600, costoTotal: 300,
    pagos: [{ metodo: 'EFECTIVO', monto: 600 }],
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const afterSale = runInContext(`DbHelper.findById('Variantes', '${varianteId}')`);
  assertEqual(Number(afterSale.stock), 7);

  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId,
    items: [{ varianteId, cantidad: 1 }],
    motivo: 'Prueba de devolución de producto simple',
    tipoReembolso: 'EFECTIVO',
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));

  const afterReturn = runInContext(`DbHelper.findById('Variantes', '${varianteId}')`);
  assertEqual(Number(afterReturn.stock), 8, 'la devolución debe reingresar exactamente la cantidad devuelta');
});

/* ================================================================
   CREDIT NOTES -- FASE 6: Créditos a Favor / Vales y Notas de Crédito
   reales (emisión desde una devolución, aplicación en una venta con
   historial, anulación con bloqueo si ya se aplicó). Devolución parcial/
   doble devolución/bloqueo de exceso (Parte 27, ítems 1-3) YA estaban
   cubiertos por RETURN_EXCEEDING_SOLD_QUANTITY_REJECTED y
   RETURN_CANNOT_DOUBLE_RETURN_BEYOND_AVAILABLE (sin cambios de esta
   fase) -- no se duplican aquí. Producto simple/variante en devolución
   (ítems 4-5) ya cubiertos por PRODUCT_SIMPLE_RETURN_RESTOCKS_CORRECTLY
   y RETURN_VALID_UPDATES_INVENTORY_CASH_AND_AUDIT respectivamente.
   ================================================================ */

test('RETURN_WITH_VALE_TIENDA_ISSUES_REAL_CREDIT_NOTE', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId,
    motivo: 'Prueba emisión de vale',
    tipoReembolso: 'VALE_TIENDA',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));
  assert(!!returnRes.creditoFavorEmitido, 'debe devolver el crédito recién emitido');
  assertEqual(returnRes.creditoFavorEmitido.tipo, 'VALE_TIENDA');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${returnRes.creditoFavorEmitido.id}')`);
  assert(!!credito, 'debe existir una fila real en Creditos_Favor');
  assertEqual(credito.tipo, 'VALE_TIENDA');
  assertEqual(credito.cliente_id, 'CLI-T01');
  assertEqual(Number(credito.monto_original), 1180);
  assertEqual(Number(credito.saldo_disponible), 1180);
  assertEqual(credito.estado, 'EMITIDA');
  assertEqual(credito.devolucion_id, returnRes.devolucionId);
});

test('RETURN_WITH_NOTA_CREDITO_ISSUES_REAL_CREDIT_NOTE', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Prueba emisión de nota', tipoReembolso: 'NOTA_CREDITO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));
  assertEqual(returnRes.creditoFavorEmitido.tipo, 'NOTA_CREDITO');
  assert(returnRes.creditoFavorEmitido.id.indexOf('NC-') === 0, 'el id de una Nota de Crédito debe usar el prefijo NC: ' + returnRes.creditoFavorEmitido.id);
});

test('RETURN_WITH_LEGACY_CREDITO_CUENTA_VALUE_STILL_ISSUES_NOTA_CREDITO', () => {
  // Compatibilidad (Parte 17): el valor histórico CREDITO_CUENTA sigue
  // funcionando -- se trata como Nota de Crédito, sin exigir que el
  // frontend ya haya migrado al nuevo valor NOTA_CREDITO.
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Prueba valor histórico', tipoReembolso: 'CREDITO_CUENTA',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));
  assertEqual(returnRes.creditoFavorEmitido.tipo, 'NOTA_CREDITO', 'CREDITO_CUENTA (histórico) debe tratarse como NOTA_CREDITO');
});

test('RETURN_WITH_EFECTIVO_NEVER_ISSUES_CREDIT_NOTE', () => {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const before = runInContext("DbHelper.getAllRows('Creditos_Favor').length");
  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Reembolso efectivo normal', tipoReembolso: 'EFECTIVO',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  assert(returnRes.success === true, JSON.stringify(returnRes));
  assertEqual(returnRes.creditoFavorEmitido, undefined, 'un reembolso en efectivo nunca debe emitir un crédito a favor/nota');
  const after = runInContext("DbHelper.getAllRows('Creditos_Favor').length");
  assertEqual(after, before, 'no debe crearse ninguna fila nueva en Creditos_Favor');
});

test('RETURN_VALE_TIENDA_WITHOUT_REAL_CLIENT_REJECTED_AND_FULLY_ROLLED_BACK', () => {
  // Parte 12: "Consumidor Final" no puede recibir un crédito reutilizable
  // -- se rechaza, y (Parte 11 del reporte de compatibilidad con el motor
  // transaccional ya existente) NADA debe quedar escrito: ni la
  // devolución, ni el reingreso de stock, ni el crédito.
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData(), adminToken); // sin clienteId -> Consumidor Final
  const stockTrasVenta = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);

  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Intento de vale sin cliente', tipoReembolso: 'VALE_TIENDA',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);

  assert(returnRes.success === false, 'debe rechazarse sin cliente real');
  assert(String(returnRes.error || '').indexOf('CLIENTE_REQUERIDO') === 0, returnRes.error);

  const stockTrasRechazo = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stockTrasRechazo, stockTrasVenta, 'el stock NO debe reingresarse -- toda la operación debe revertirse (rollback completo)');

  const devoluciones = runInContext(`DbHelper.findRows('Devoluciones', r => r.venta_id === '${saleRes.saleId}')`);
  assertEqual(devoluciones.length, 0, 'no debe quedar ninguna fila de Devoluciones');
});

function issueCreditNoteForTest(monto, tipo) {
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const returnRes = doPostRaw('returns.create', {
    ventaId: saleRes.saleId, motivo: 'Fixture de crédito para test', tipoReembolso: tipo || 'VALE_TIENDA',
    items: [{ varianteId: 'VAR-T01', cantidad: 1 }]
  }, adminToken);
  return returnRes.creditoFavorEmitido; // { id, numero, tipo, montoOriginal } -- montoOriginal = 1180
}

test('CREDIT_NOTE_LIST_RETURNS_ISSUED_CREDIT_WITH_EMPTY_APPLICATIONS', () => {
  const emitido = issueCreditNoteForTest();
  const list = doPostRaw('creditNotes.list', {}, adminToken);
  assert(list.success === true, JSON.stringify(list));
  const found = list.creditNotes.find(c => c.id === emitido.id);
  assert(!!found, 'el crédito recién emitido debe aparecer en creditNotes.list');
  assertEqual(found.saldoDisponible, 1180);
  assertEqual(found.aplicaciones.length, 0);
});

test('CREDIT_NOTE_APPLY_PARTIAL_UPDATES_BALANCE_AND_STATE', () => {
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);

  const applyRes = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleRes.saleId, monto: 500 }, adminToken);
  assert(applyRes.success === true, JSON.stringify(applyRes));
  assertEqual(applyRes.saldoRestante, 680);
  assertEqual(applyRes.estado, 'PARCIALMENTE_APLICADA');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 680);
  assertEqual(Number(credito.monto_aplicado), 500);
  assertEqual(credito.estado, 'PARCIALMENTE_APLICADA');
});

test('CREDIT_NOTE_APPLY_FULL_MARKS_APLICADA', () => {
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);

  const applyRes = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleRes.saleId, monto: 1180 }, adminToken);
  assert(applyRes.success === true, JSON.stringify(applyRes));
  assertEqual(applyRes.saldoRestante, 0);
  assertEqual(applyRes.estado, 'APLICADA');
});

test('CREDIT_NOTE_APPLY_MORE_THAN_BALANCE_REJECTED', () => {
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);

  const applyRes = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleRes.saleId, monto: 5000 }, adminToken);
  assert(applyRes.success === false, 'no debe permitir aplicar más que el saldo disponible');
  assert(String(applyRes.error || '').indexOf('SALDO_INSUFICIENTE') === 0, applyRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el saldo no debe alterarse tras un intento rechazado');
});

test('CREDIT_NOTE_APPLICATION_HISTORY_TRACKS_EACH_APPLICATION', () => {
  const emitido = issueCreditNoteForTest();
  const sale1 = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const sale2 = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);

  doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: sale1.saleId, monto: 300 }, adminToken);
  doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: sale2.saleId, monto: 200 }, adminToken);

  const list = doPostRaw('creditNotes.list', {}, adminToken);
  const found = list.creditNotes.find(c => c.id === emitido.id);
  assertEqual(found.montoAplicado, 500);
  assertEqual(found.saldoDisponible, 680);
  assertEqual(found.aplicaciones.length, 2, 'debe existir una fila de historial por cada aplicación, nunca solo el saldo actualizado');
  const ventasAplicadas = found.aplicaciones.map(a => a.ventaId).sort();
  assertEqual(JSON.stringify(ventasAplicadas), JSON.stringify([sale1.saleId, sale2.saleId].sort()), 'el historial debe permitir reconstruir en qué ventas se usó');
});

test('CREDIT_NOTE_SEQUENTIAL_APPLICATIONS_CANNOT_EXCEED_BALANCE_EVEN_ACROSS_CALLS', () => {
  // Aproximación a la Parte 11 (concurrencia) verificable en un arnés
  // síncrono de Node: cada aplicación relee el saldo REAL desde
  // Creditos_Favor en el momento de aplicar (nunca un valor cacheado) --
  // esto es lo que, bajo LockService real en producción, impide que dos
  // solicitudes simultáneas aprueben ambas un monto que juntas excederían
  // el saldo. Aquí se prueba secuencialmente: la primera aplicación de
  // RD$800 sobre un saldo de RD$1,180 debe dejar RD$380 -- una segunda
  // aplicación de RD$700 (que hubiera cabido en el saldo ORIGINAL) debe
  // ser rechazada contra el saldo YA reducido.
  const emitido = issueCreditNoteForTest();
  const sale1 = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const sale2 = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);

  const apply1 = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: sale1.saleId, monto: 800 }, adminToken);
  assert(apply1.success === true, JSON.stringify(apply1));

  const apply2 = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: sale2.saleId, monto: 700 }, adminToken);
  assert(apply2.success === false, 'la segunda aplicación NO debe aprobarse -- el saldo real ya solo tiene RD$380');
  assert(String(apply2.error || '').indexOf('SALDO_INSUFICIENTE') === 0, apply2.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 380, 'el saldo final debe ser consistente -- nunca negativo ni sobregirado');
});

test('CREDIT_NOTE_VOID_SUCCEEDS_WHEN_NEVER_APPLIED', () => {
  const emitido = issueCreditNoteForTest();
  const voidRes = doPostRaw('creditNotes.void', { creditoFavorId: emitido.id, motivo: 'Prueba de anulación limpia' }, adminToken);
  assert(voidRes.success === true, JSON.stringify(voidRes));

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(credito.estado, 'ANULADA');
  assertEqual(Number(credito.saldo_disponible), 0);
  assertEqual(credito.motivo_anulacion, 'Prueba de anulación limpia');
});

test('CREDIT_NOTE_VOID_BLOCKED_WHEN_ALREADY_APPLIED', () => {
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleRes.saleId, monto: 100 }, adminToken);

  const voidRes = doPostRaw('creditNotes.void', { creditoFavorId: emitido.id, motivo: 'Intento inválido' }, adminToken);
  assert(voidRes.success === false, 'no debe poder anularse directamente un crédito que ya fue aplicado');
  assert(String(voidRes.error || '').indexOf('NO_ANULABLE') === 0, voidRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assert(credito.estado !== 'ANULADA', 'el estado no debe cambiar tras un intento de anulación rechazado');
});

test('CREDIT_NOTE_VOID_ALREADY_VOIDED_REJECTED', () => {
  const emitido = issueCreditNoteForTest();
  doPostRaw('creditNotes.void', { creditoFavorId: emitido.id, motivo: 'Primera anulación' }, adminToken);
  const secondVoid = doPostRaw('creditNotes.void', { creditoFavorId: emitido.id, motivo: 'Segunda anulación' }, adminToken);
  assert(secondVoid.success === false, 'no debe poder anularse dos veces');
  assert(String(secondVoid.error || '').indexOf('INVALID_STATE') === 0, secondVoid.error);
});

test('CREDIT_NOTE_VOID_UNAUTHORIZED_REJECTED', () => {
  // SUPERVISOR/CAJERO/VENDEDOR tienen creditos_favor.aplicar pero NO
  // creditos_favor.anular (mismo criterio restrictivo que
  // creditos.anular_abonos, solo ADMIN/GERENTE).
  const emitido = issueCreditNoteForTest();
  const cajeroSession = login('cajero', 'cajero123'); // CAJERO tiene .aplicar pero NO .anular (GERENTE/ADMIN sí tienen ambos)
  const voidRes = doPostRaw('creditNotes.void', { creditoFavorId: emitido.id, motivo: 'Intento sin permiso' }, cajeroSession.sessionToken);
  assert(voidRes.success === false, 'CAJERO no debe poder anular créditos/notas');
  assert(String(voidRes.error || '').indexOf('FORBIDDEN') === 0, voidRes.error);
});

test('SALE_APPLIES_CREDIT_NOTE_PARTIALLY_REST_PAID_CASH_NO_FAKE_CASH_ENTRY', () => {
  // Integración completa POS + crédito (Parte 13/24/31): se emite un
  // crédito de RD$1,180 (fixture VAR-T01) y se aplica en su totalidad a
  // una venta nueva del mismo importe -- confirma que la venta acepta un
  // pago cuyo método es 'CREDITO_FAVOR' (no EFECTIVO), que el saldo del
  // crédito se reduce como parte de la MISMA transacción, y que NO se
  // genera ningún movimiento de caja por ese monto (Parte 24).
  const emitido = issueCreditNoteForTest();

  const cajaAntes = runInContext("DbHelper.getAllRows('Caja_Movimientos').length");

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));
  assert(!!saleRes.creditoFavorAplicado, 'debe confirmar la aplicación del crédito en la respuesta de la venta');
  assertEqual(saleRes.creditoFavorAplicado.saldoRestante, 0);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 0, 'el saldo del crédito debe reducirse como parte de la misma venta');
  assertEqual(credito.estado, 'APLICADA');

  const aplicaciones = runInContext(`DbHelper.findRows('Creditos_Favor_Aplicaciones', a => a.venta_id === '${saleRes.saleId}')`);
  assertEqual(aplicaciones.length, 1, 'debe quedar registrada la aplicación vinculada a esta venta específica');

  const cajaDespues = runInContext("DbHelper.getAllRows('Caja_Movimientos').length");
  assertEqual(cajaDespues, cajaAntes, 'aplicar un crédito a favor NUNCA debe generar un movimiento de caja -- no hay entrada de efectivo real');

  const ventaGuardada = runInContext(`DbHelper.findById('Ventas', '${saleRes.saleId}')`);
  const pagosGuardados = JSON.parse(ventaGuardada.pagos_json);
  assert(pagosGuardados.some(p => p.metodo === 'CREDITO_FAVOR' && Number(p.monto) === 1180), 'la venta debe conservar la trazabilidad de que se pagó con crédito a favor');
});

test('SALE_CREDIT_NOTE_APPLICATION_FAILURE_ROLLS_BACK_ENTIRE_SALE', () => {
  // Atomicidad (Parte 11): si el crédito referenciado no tiene saldo
  // suficiente, la VENTA COMPLETA debe revertirse -- ni stock deducido,
  // ni fila de Ventas, ni Venta_Items, ni Kardex.
  const emitido = issueCreditNoteForTest(); // saldo real: 1180
  resetVarT01Stock(5);
  const stockAntes = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  const ventasAntes = runInContext("DbHelper.getAllRows('Ventas').length");

  // FASE 7: `pagos`/`creditoFavorAplicado.monto` deben coincidir ENTRE SÍ
  // y con el total real de la venta (nueva validación cruzada, ver
  // SALE_REJECTS_CREDITO_FAVOR_PAGOS_MISMATCH) -- por eso esta venta usa 2
  // unidades (total real 2,360, ver recalculateSaleAuthoritatively) en vez
  // del total por defecto de 1,180: así el monto declarado (2,360) pasa
  // esa validación de consistencia, y el rechazo real ocurre donde este
  // test lo espera: más adentro, al releer el saldo REAL del crédito
  // (1,180) dentro de applyToSaleWithinTx_ y encontrarlo insuficiente.
  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    subtotal: 2000, impuestoTotal: 360, total: 2360, costoTotal: 1000,
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 2, costoUnitario: 500, precioUnitario: 1000,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 2000, impuestoMonto: 360, total: 2360
    }],
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 2360 }],
    creditoFavorAplicado: { id: emitido.id, monto: 2360 } // excede el saldo real (1180) -> debe fallar
  }), adminToken);

  assert(saleRes.success === false, 'la venta debe rechazarse si el crédito aplicado excede su saldo');
  assert(String(saleRes.error || '').indexOf('SALDO_INSUFICIENTE') === 0, saleRes.error);

  const stockDespues = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stockDespues, stockAntes, 'el stock no debe descontarse si la venta se revierte por completo');

  const ventasDespues = runInContext("DbHelper.getAllRows('Ventas').length");
  assertEqual(ventasDespues, ventasAntes, 'no debe quedar ninguna fila nueva de Ventas tras el rollback');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito no debe verse afectado por una venta que se revirtió por completo');
});

test('LEGACY_DEVOLUCION_WITH_CREDITO_CUENTA_HISTORICAL_VALUE_STILL_READS_CORRECTLY', () => {
  // Parte 16/33 (compatibilidad con históricos): una fila de Devoluciones
  // guardada ANTES de esta fase, con el valor histórico CREDITO_CUENTA,
  // debe seguir apareciendo intacta en returns.list -- sin migración
  // automática, sin romperse.
  runInContext(`
    DbHelper.insertRow('Devoluciones', {
      id: 'DEV-LEGACY-01', numero_devolucion: 'DEV-LEGACY-01', venta_id: 'PRD-T01', numero_venta: 'VEN-LEGACY-01',
      cliente_id: '', cliente_nombre: 'Consumidor Final', items_json: '[]', monto_devuelto: 250,
      tipo_reembolso: 'CREDITO_CUENTA', motivo: 'Devolución histórica pre-Fase 6',
      usuario_id: 'USR-001', usuario_nombre: 'Carlos Mendoza', fecha: getNowFormatted()
    });
  `);
  const list = doPostRaw('returns.list', {}, adminToken);
  const found = list.returns.find(r => r.id === 'DEV-LEGACY-01');
  assert(!!found, 'la devolución histórica debe seguir apareciendo');
  assertEqual(found.tipoReembolso, 'CREDITO_CUENTA', 'el valor histórico se conserva tal cual, sin migrarse automáticamente');
});

test('LEGACY_DEVOLUCION_WITH_VALE_TIENDA_HISTORICAL_VALUE_STILL_READS_CORRECTLY', () => {
  runInContext(`
    DbHelper.insertRow('Devoluciones', {
      id: 'DEV-LEGACY-02', numero_devolucion: 'DEV-LEGACY-02', venta_id: 'PRD-T01', numero_venta: 'VEN-LEGACY-02',
      cliente_id: '', cliente_nombre: 'Consumidor Final', items_json: '[]', monto_devuelto: 150,
      tipo_reembolso: 'VALE_TIENDA', motivo: 'Devolución histórica pre-Fase 6',
      usuario_id: 'USR-001', usuario_nombre: 'Carlos Mendoza', fecha: getNowFormatted()
    });
  `);
  const list = doPostRaw('returns.list', {}, adminToken);
  const found = list.returns.find(r => r.id === 'DEV-LEGACY-02');
  assert(!!found, 'la devolución histórica debe seguir apareciendo');
  assertEqual(found.tipoReembolso, 'VALE_TIENDA');
  // Importante: esta fila histórica NUNCA tuvo un Creditos_Favor real
  // asociado (se guardó antes de que existiera esta fase) -- confirmar
  // que no se intenta vincular/crear uno retroactivamente.
  const creditoAsociado = runInContext("DbHelper.findRows('Creditos_Favor', c => c.devolucion_id === 'DEV-LEGACY-02')");
  assertEqual(creditoAsociado.length, 0, 'no debe inventarse un crédito retroactivo para una devolución histórica');
});

/* ================================================================
   FASE 7 -- INTEGRACIÓN OPERATIVA DE CRÉDITOS EN POS
   Cobertura nueva: pertenencia del crédito al cliente correcto (hallazgo
   de auditoría corregido en esta misma fase, Parte 3/15), Consumidor
   Final nunca puede usar crédito a favor (Parte 14), consistencia
   pagos/creditoFavorAplicado (Parte 3/17/31), pagos mixtos reales
   crédito+efectivo/tarjeta/transferencia/cuenta por cobrar sin generar
   dinero falso en caja (Partes 10-13/24), aplicación parcial que deja
   saldo disponible en el documento (Parte 13), anulación/estado inválido
   adicionales, rollback ante stock insuficiente, y concurrencia a través
   del flujo COMPLETO de sales.create (no solo la acción independiente
   creditNotes.apply, ya cubierta en la sección FASE 6 de arriba).
   ================================================================ */

test('CREDIT_NOTE_LIST_NEVER_LEAKS_ANOTHER_CLIENTS_CREDIT', () => {
  // Parte 2/20: el filtro clienteId de creditNotes.list nunca debe
  // devolver créditos de otro cliente.
  const emitido = issueCreditNoteForTest(); // pertenece a CLI-T01
  const list = doPostRaw('creditNotes.list', { clienteId: 'CLI-T02' }, adminToken);
  assert(list.success === true, JSON.stringify(list));
  const found = list.creditNotes.find(c => c.id === emitido.id);
  assert(!found, 'un crédito de CLI-T01 nunca debe aparecer al filtrar por CLI-T02');
});

test('SALE_REJECTS_CREDIT_NOTE_FROM_DIFFERENT_CLIENT', () => {
  // Parte 3/15 (hallazgo de auditoría corregido ANTES de construir la UI
  // del POS, como exige esta fase): applyToSaleWithinTx_ antes NO
  // verificaba a quién pertenece el crédito -- cualquier creditoFavorId
  // válido podía aplicarse a la venta de CUALQUIER cliente.
  const emitido = issueCreditNoteForTest(); // pertenece a CLI-T01, saldo 1180
  resetVarT01Stock(5);
  const stockAntes = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T02', clienteNombre: 'Cliente Caja', // OTRO cliente
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);

  assert(saleRes.success === false, 'un crédito de CLI-T01 nunca debe poder aplicarse a una venta de CLI-T02');
  assert(String(saleRes.error || '').indexOf('CREDITO_NO_PERTENECE_AL_CLIENTE') === 0, saleRes.error);

  const stockDespues = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stockDespues, stockAntes, 'la venta completa debe revertirse, incluyendo el stock');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito de CLI-T01 no debe verse afectado');
});

test('APPLY_CREDIT_NOTE_REJECTS_DIFFERENT_CLIENT', () => {
  // Mismo hallazgo que la prueba anterior, pero por la acción
  // independiente creditNotes.apply (handleApplyCreditNote), que también
  // pasa por applyToSaleWithinTx_.
  const emitido = issueCreditNoteForTest(); // pertenece a CLI-T01
  const saleCli02 = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T02', clienteNombre: 'Cliente Caja' }), adminToken);
  assert(saleCli02.success === true, JSON.stringify(saleCli02));

  const applyRes = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleCli02.saleId, monto: 100 }, adminToken);
  assert(applyRes.success === false, 'no debe poder aplicarse un crédito de CLI-T01 a una venta de CLI-T02');
  assert(String(applyRes.error || '').indexOf('CREDITO_NO_PERTENECE_AL_CLIENTE') === 0, applyRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el saldo no debe alterarse tras un intento rechazado');
});

test('SALE_REJECTS_CREDITO_FAVOR_FOR_CONSUMIDOR_FINAL', () => {
  // Parte 14: "Consumidor Final" nunca puede utilizar un saldo a favor,
  // ni siquiera si el frontend enviara manualmente un creditoFavorId real.
  const emitido = issueCreditNoteForTest(); // pertenece a CLI-T01, saldo 1180
  resetVarT01Stock(5);

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    // Sin clienteId -- Consumidor Final.
    metodoPago: 'CREDITO_FAVOR',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);

  assert(saleRes.success === false, 'Consumidor Final nunca debe poder aplicar un crédito a favor');
  assert(String(saleRes.error || '').indexOf('CLIENTE_REQUERIDO') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito no debe verse afectado');
});

test('SALE_REJECTS_CREDITO_FAVOR_PAGOS_MISMATCH', () => {
  // Parte 3/17/31 (nunca confiar en lo declarado por el frontend): el
  // monto de la línea `pagos` con metodo CREDITO_FAVOR debe coincidir
  // EXACTAMENTE con creditoFavorAplicado.monto -- de lo contrario, se
  // podría declarar un pago "cuadrado" en pagos sin que el backend
  // realmente descuente ese saldo (o viceversa).
  const emitido = issueCreditNoteForTest();
  resetVarT01Stock(5);

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 500 } // no coincide con la línea de pagos (1180)
  }), adminToken);

  assert(saleRes.success === false, 'debe rechazarse si pagos y creditoFavorAplicado no coinciden');
  assert(String(saleRes.error || '').indexOf('PRICE_MISMATCH') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito no debe tocarse si la venta se rechaza');
});

test('SALE_REJECTS_CREDITO_FAVOR_PAGOS_LINE_WITHOUT_APLICADO_FIELD', () => {
  // Complemento del test anterior: una línea de pagos con metodo
  // CREDITO_FAVOR sin el campo creditoFavorAplicado correspondiente NUNCA
  // debe aceptarse -- de lo contrario, sumaPagos cuadraría con el total
  // sin que ningún saldo real se haya descontado (fuga de mercancía).
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }]
    // Sin creditoFavorAplicado.
  }), adminToken);

  assert(saleRes.success === false, 'debe rechazarse una línea CREDITO_FAVOR sin creditoFavorAplicado');
  assert(String(saleRes.error || '').indexOf('VALIDATION_ERROR') === 0, saleRes.error);
});

test('SALE_CREDITO_FAVOR_PLUS_EFECTIVO_CASH_REGISTERS_ONLY_REMAINDER', () => {
  // Parte 10 (venta mixta obligatoria) + Parte 24 (no inventar dinero
  // físico): venta de RD$2,360 (2 unidades VAR-T01), RD$1,180 cubiertos
  // con crédito a favor y RD$1,180 en efectivo -- la caja SOLO debe
  // reflejar el efectivo real, nunca el total completo de la venta.
  const emitido = issueCreditNoteForTest(); // saldo 1180
  resetVarT01Stock(5);

  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test', cajaSesionId: cajaId,
    subtotal: 2000, impuestoTotal: 360, total: 2360, costoTotal: 1000,
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 2, costoUnitario: 500, precioUnitario: 1000,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 2000, impuestoMonto: 360, total: 2360
    }],
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }, { metodo: 'EFECTIVO', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.ventas_efectivo), 1180, 'ventas_efectivo debe reflejar SOLO el efectivo real, nunca el total de la venta (2360)');

  const movimientos = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.caja_sesion_id === '${cajaId}')`);
  assertEqual(movimientos.length, 1, 'debe existir exactamente un movimiento de caja');
  assertEqual(Number(movimientos[0].monto), 1180, 'el movimiento de caja debe ser por el monto real en efectivo');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 0);
  assertEqual(credito.estado, 'APLICADA');

  doPostRaw('cash.close', { efectivoRealContado: 2180 }, adminToken);
});

test('SALE_CREDITO_FAVOR_PLUS_TRANSFERENCIA_NO_CASH_MOVEMENT', () => {
  // Parte 11: crédito a favor + transferencia -- no debe generarse NINGÚN
  // movimiento de efectivo, con o sin caja abierta.
  const emitido = issueCreditNoteForTest();
  resetVarT01Stock(5);

  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test', cajaSesionId: cajaId,
    subtotal: 2000, impuestoTotal: 360, total: 2360, costoTotal: 1000,
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 2, costoUnitario: 500, precioUnitario: 1000,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 2000, impuestoMonto: 360, total: 2360
    }],
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }, { metodo: 'TRANSFERENCIA', monto: 1180, referencia: 'TRF-TEST-01' }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.ventas_efectivo), 0, 'ni el crédito a favor ni la transferencia deben afectar ventas_efectivo');

  const movimientos = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.caja_sesion_id === '${cajaId}')`);
  assertEqual(movimientos.length, 0, 'crédito a favor + transferencia NUNCA debe generar un movimiento de caja');

  doPostRaw('cash.close', { efectivoRealContado: 1000 }, adminToken);
});

test('SALE_CREDITO_FAVOR_PLUS_TARJETA_NO_CASH_MOVEMENT', () => {
  // Parte 12: crédito a favor + tarjeta -- misma garantía que transferencia.
  const emitido = issueCreditNoteForTest();
  resetVarT01Stock(5);

  const openRes = doPostRaw('cash.open', { montoInicial: 1000 }, adminToken);
  assert(openRes.success === true, JSON.stringify(openRes));
  const cajaId = openRes.session.id;

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test', cajaSesionId: cajaId,
    subtotal: 2000, impuestoTotal: 360, total: 2360, costoTotal: 1000,
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 2, costoUnitario: 500, precioUnitario: 1000,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 2000, impuestoMonto: 360, total: 2360
    }],
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }, { metodo: 'TARJETA', monto: 1180, referencia: 'APR-TEST-01' }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const caja = runInContext(`DbHelper.findById('Cajas', '${cajaId}')`);
  assertEqual(Number(caja.ventas_efectivo), 0, 'ni el crédito a favor ni la tarjeta deben afectar ventas_efectivo');

  const movimientos = runInContext(`DbHelper.findRows('Caja_Movimientos', r => r.caja_sesion_id === '${cajaId}')`);
  assertEqual(movimientos.length, 0, 'crédito a favor + tarjeta NUNCA debe generar un movimiento de caja');

  doPostRaw('cash.close', { efectivoRealContado: 1000 }, adminToken);
});

test('SALE_CREDITO_FAVOR_PLUS_CUENTA_POR_COBRAR_FINANCES_ONLY_REMAINDER', () => {
  // Parte 10 generalizada a un cuarto método existente ("A Crédito" /
  // cuenta por cobrar): el crédito a favor cubre una parte, y SOLO el
  // remanente se financia como nueva deuda -- nunca el total completo.
  // Se usa un cliente/crédito a favor dedicados (CLI-T03, límite 5000)
  // para no depender del historial de deuda acumulado por otras pruebas
  // sobre CLI-T01/CLI-T02 a lo largo de todo este archivo.
  runInContext(`
    DbHelper.insertRow('Creditos_Favor', {
      id: 'CFAV-T10', numero: 'CFAV-T10', tipo: 'VALE_TIENDA', cliente_id: 'CLI-T03',
      cliente_nombre: 'Cliente Credito', devolucion_id: '', venta_origen_id: '',
      monto_original: 300, monto_aplicado: 0, saldo_disponible: 300, estado: 'EMITIDA',
      motivo_anulacion: '', anulado_por: '', fecha_anulacion: '',
      usuario_id: 'USR-001', usuario_nombre: 'Sistema',
      fecha_creacion: getNowFormatted(), actualizado_en: getNowFormatted()
    });
  `);

  // VAR-T03: precio real 200 x 2 = 400 + 18% ITBIS = 472.
  const saleRes = doPostRaw('sales.create', {
    clienteId: 'CLI-T03', clienteNombre: 'Cliente Credito', cajaSesionId: '',
    subtotal: 400, descuentoTotal: 0, impuestoTotal: 72, total: 472, costoTotal: 200,
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 300 }, { metodo: 'CREDITO', monto: 172 }],
    esCredito: true, montoFinanciado: 172, aplicarImpuesto: true,
    creditoFavorAplicado: { id: 'CFAV-T10', monto: 300 },
    items: [{
      productoId: 'PRD-T03', varianteId: 'VAR-T03', nombreProducto: 'Producto Credito Test', sku: 'SKU-T03-U',
      talla: 'M', color: 'Azul', cantidad: 2, costoUnitario: 100, precioUnitario: 200,
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 400, impuestoMonto: 72, total: 472
    }]
  }, adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', 'CFAV-T10')`);
  assertEqual(Number(credito.saldo_disponible), 0);
  assertEqual(credito.estado, 'APLICADA');

  const cuentaPorCobrar = runInContext(`DbHelper.findById('Creditos', '${saleRes.cuentaCobrarId}')`);
  assert(!!cuentaPorCobrar, 'debe crearse una cuenta por cobrar real por el remanente');
  assertEqual(Number(cuentaPorCobrar.monto_original), 172, 'la deuda nueva debe ser SOLO el remanente (472 - 300), nunca el total completo');
});

test('SALE_CREDITO_FAVOR_PARTIAL_APPLICATION_LEAVES_REMAINING_BALANCE_ON_DOCUMENT', () => {
  // Parte 6/8/13: el crédito disponible (1180) es mayor que lo que se
  // decide aplicar (400) -- el resto (780) debe permanecer disponible en
  // el MISMO documento para una venta futura, nunca perderse ni aplicarse
  // de más automáticamente.
  const emitido = issueCreditNoteForTest();
  resetVarT01Stock(5);

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 400 }, { metodo: 'EFECTIVO', monto: 780 }],
    creditoFavorAplicado: { id: emitido.id, monto: 400 }
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));
  assertEqual(saleRes.creditoFavorAplicado.saldoRestante, 780);
  assertEqual(saleRes.creditoFavorAplicado.estado, 'PARCIALMENTE_APLICADA');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 780, 'el remanente debe seguir disponible en el mismo documento');
  assertEqual(credito.estado, 'PARCIALMENTE_APLICADA');
});

test('APPLY_CREDIT_NOTE_TO_ANULADA_SALE_REJECTED', () => {
  // Hallazgo de auditoría (Parte 3/31): aplicar un crédito a una venta ya
  // anulada no tiene sentido comercial -- esa venta ya no representa
  // ningún cobro pendiente real.
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));
  const voidRes = doPostRaw('sales.void', { saleId: saleRes.saleId, motivo: 'Prueba de venta anulada' }, adminToken);
  assert(voidRes.success === true, JSON.stringify(voidRes));

  const applyRes = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleRes.saleId, monto: 100 }, adminToken);
  assert(applyRes.success === false, 'no debe poder aplicarse un crédito a una venta anulada');
  assert(String(applyRes.error || '').indexOf('INVALID_STATE') === 0, applyRes.error);
});

test('APPLY_ALREADY_VOIDED_CREDIT_NOTE_REJECTED', () => {
  // Complementa CREDIT_NOTE_APPLY_MORE_THAN_BALANCE_REJECTED: un crédito
  // ANULADO debe rechazarse incluso si el monto solicitado sí cabría en
  // su saldo original.
  const emitido = issueCreditNoteForTest();
  doPostRaw('creditNotes.void', { creditoFavorId: emitido.id, motivo: 'Anulado antes de aplicar' }, adminToken);

  const saleRes = doPostRaw('sales.create', buildValidSaleData({ clienteId: 'CLI-T01', clienteNombre: 'Cliente Test' }), adminToken);
  const applyRes = doPostRaw('creditNotes.apply', { creditoFavorId: emitido.id, ventaId: saleRes.saleId, monto: 100 }, adminToken);
  assert(applyRes.success === false, 'no debe poder aplicarse un crédito ya anulado');
  assert(String(applyRes.error || '').indexOf('INVALID_STATE') === 0, applyRes.error);
});

test('SALE_INSUFFICIENT_STOCK_WITH_CREDIT_NOTE_NEVER_TOUCHES_CREDIT_BALANCE', () => {
  // Parte 17/25 (rollback/consistencia): si la venta falla por stock
  // insuficiente -- ANTES de siquiera abrir la transacción -- el crédito a
  // favor referenciado nunca debe tocarse.
  const emitido = issueCreditNoteForTest(); // saldo 1180
  resetVarT01Stock(1); // solo 1 unidad disponible

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    subtotal: 2000, impuestoTotal: 360, total: 2360, costoTotal: 1000,
    items: [{
      productoId: 'PRD-T01', varianteId: 'VAR-T01', nombreProducto: 'Producto Test', sku: 'SKU-T01-U',
      talla: 'M', color: 'Negro', cantidad: 2, costoUnitario: 500, precioUnitario: 1000, // pide 2, solo hay 1
      descuentoPorcentaje: 0, descuentoMonto: 0, subtotal: 2000, impuestoMonto: 360, total: 2360
    }],
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }, { metodo: 'EFECTIVO', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);

  assert(saleRes.success === false, 'la venta debe rechazarse por stock insuficiente');
  assert(String(saleRes.error || '').indexOf('STOCK_INSUFICIENTE') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito nunca debe tocarse si la venta falla antes de aplicar nada');
  resetVarT01Stock(5);
});

test('TWO_SEQUENTIAL_SALES_CANNOT_BOTH_CONSUME_SAME_CREDIT_BALANCE', () => {
  // Aproximación a la Parte 16 (concurrencia) a través del flujo COMPLETO
  // de sales.create (no solo la acción independiente creditNotes.apply,
  // ya cubierta arriba) -- confirma que el rollback de la SEGUNDA venta
  // (rechazada) también revierte su propio stock, no solo el saldo del
  // crédito.
  const emitido = issueCreditNoteForTest(); // saldo 1180
  resetVarT01Stock(5);

  const sale1 = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 800 }, { metodo: 'EFECTIVO', monto: 380 }],
    creditoFavorAplicado: { id: emitido.id, monto: 800 }
  }), adminToken);
  assert(sale1.success === true, JSON.stringify(sale1));
  assertEqual(sale1.creditoFavorAplicado.saldoRestante, 380);

  const stockAntesSale2 = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);

  // Terminal B intenta usar RD$700 -- hubiera cabido en el saldo ORIGINAL
  // (1180) pero no en el saldo YA reducido por la venta anterior (380).
  const sale2 = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 700 }, { metodo: 'EFECTIVO', monto: 480 }],
    creditoFavorAplicado: { id: emitido.id, monto: 700 }
  }), adminToken);
  assert(sale2.success === false, 'la segunda venta no debe aprobarse -- el saldo real ya solo tiene RD$380');
  assert(String(sale2.error || '').indexOf('SALDO_INSUFICIENTE') === 0, sale2.error);

  const stockDespuesSale2 = Number(runInContext("DbHelper.findById('Variantes', 'VAR-T01')").stock);
  assertEqual(stockDespuesSale2, stockAntesSale2, 'el stock de la segunda venta rechazada también debe revertirse por completo');

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 380, 'el saldo final debe reflejar solo la primera venta exitosa');
});

/* ================================================================
   FASE 8 (Parte 4) -- CASOS ADICIONALES DE HARDENING sobre la aplicación
   de Crédito a Favor/Nota de Crédito en ventas, no cubiertos todavía por
   los tests de Fase 6/7 de arriba.
   ================================================================ */

test('SALE_ACCEPTS_MINIMAL_PARTIAL_CREDIT_APPLICATION', () => {
  // Parte 4, ítem 6: una aplicación parcial mínima (RD$1 de un saldo de
  // RD$1,180) debe aceptarse -- no existe (ni debe inventarse) un piso
  // artificial de monto mínimo.
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    metodoPago: 'MIXTO',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1 }, { metodo: 'EFECTIVO', monto: 1179 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1 }
  }), adminToken);
  assert(saleRes.success === true, JSON.stringify(saleRes));
  assertEqual(saleRes.creditoFavorAplicado.saldoRestante, 1179);
  assertEqual(saleRes.creditoFavorAplicado.estado, 'PARCIALMENTE_APLICADA');
});

test('SALE_REJECTS_CREDITO_FAVOR_MONTO_ZERO', () => {
  // Parte 4, ítem 7: monto 0 debe rechazarse -- nunca se registra una
  // "aplicación" vacía en el historial.
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    creditoFavorAplicado: { id: emitido.id, monto: 0 }
  }), adminToken);
  assert(saleRes.success === false, 'un monto de crédito 0 debe rechazarse');
  assert(String(saleRes.error || '').indexOf('VALIDATION_ERROR') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito no debe tocarse');
  const aplicaciones = runInContext(`DbHelper.findRows('Creditos_Favor_Aplicaciones', a => a.credito_favor_id === '${emitido.id}')`);
  assertEqual(aplicaciones.length, 0, 'no debe registrarse ninguna aplicación con monto 0');
});

test('SALE_REJECTS_CREDITO_FAVOR_MONTO_NEGATIVE', () => {
  // Parte 4, ítem 8: monto negativo debe rechazarse.
  const emitido = issueCreditNoteForTest();
  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    creditoFavorAplicado: { id: emitido.id, monto: -100 }
  }), adminToken);
  assert(saleRes.success === false, 'un monto de crédito negativo debe rechazarse');
  assert(String(saleRes.error || '').indexOf('VALIDATION_ERROR') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito no debe tocarse');
});

test('SALE_REJECTS_CREDITO_FAVOR_MONTO_EXCEEDING_SALE_TOTAL', () => {
  // Parte 4, ítem 10: el monto de crédito declarado nunca puede superar el
  // total real de la venta -- queda estructuralmente imposible de colar
  // porque sumaPagos siempre debe cuadrar exactamente con el total
  // recalculado autoritativamente por el servidor.
  const emitido = issueCreditNoteForTest(); // saldo 1180, mayor al total de esta venta (1180 exacto)
  resetVarT01Stock(5);
  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    // La venta real (fixture) totaliza 1180 -- se declara un crédito de
    // 5000, muy por encima, intentando "sobre-cubrir" el total.
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 5000 }],
    creditoFavorAplicado: { id: emitido.id, monto: 5000 }
  }), adminToken);
  assert(saleRes.success === false, 'un crédito declarado por encima del total real de la venta debe rechazarse');
  assert(String(saleRes.error || '').indexOf('PRICE_MISMATCH') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', '${emitido.id}')`);
  assertEqual(Number(credito.saldo_disponible), 1180, 'el crédito no debe tocarse');
});

test('SALE_REJECTS_CREDITO_FAVOR_FOR_INACTIVE_CUSTOMER', () => {
  // Parte 4, ítem 13: un cliente marcado INACTIVO no debe poder aplicar un
  // crédito a favor, igual que ya no puede comprar a cuenta por cobrar.
  runInContext(`
    DbHelper.insertRow('Clientes', {
      id: 'CLI-T-INACTIVO', nombre: 'Cliente', apellido: 'Inactivo', documento: '000-0000000-9', telefono: '000',
      correo: '', direccion: '', ciudad: '', limite_credito: 500, dias_credito_por_defecto: 15,
      notas: '', estado: 'INACTIVO', creado_en: getNowFormatted()
    });
    DbHelper.insertRow('Creditos_Favor', {
      id: 'CFAV-INACTIVO', numero: 'CFAV-INACTIVO', tipo: 'VALE_TIENDA', cliente_id: 'CLI-T-INACTIVO',
      cliente_nombre: 'Cliente Inactivo', devolucion_id: '', venta_origen_id: '',
      monto_original: 500, monto_aplicado: 0, saldo_disponible: 500, estado: 'EMITIDA',
      motivo_anulacion: '', anulado_por: '', fecha_anulacion: '',
      usuario_id: 'USR-001', usuario_nombre: 'Sistema',
      fecha_creacion: getNowFormatted(), actualizado_en: getNowFormatted()
    });
  `);
  resetVarT01Stock(5);

  const saleRes = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T-INACTIVO', clienteNombre: 'Cliente Inactivo',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }],
    creditoFavorAplicado: { id: 'CFAV-INACTIVO', monto: 1180 }
  }), adminToken);
  assert(saleRes.success === false, 'un cliente inactivo no debe poder aplicar un crédito a favor');
  assert(String(saleRes.error || '').indexOf('CREDIT_ERROR') === 0, saleRes.error);

  const credito = runInContext(`DbHelper.findById('Creditos_Favor', 'CFAV-INACTIVO')`);
  assertEqual(Number(credito.saldo_disponible), 500, 'el crédito no debe tocarse');
});

test('SALE_REJECTS_REUSING_ALREADY_APLICADA_CREDIT_NOTE', () => {
  // Parte 4, ítem 15: reutilizar un documento ya en estado APLICADA (saldo
  // agotado por una aplicación TOTAL anterior, no solo parcial) debe
  // rechazarse igual que cualquier saldo insuficiente.
  const emitido = issueCreditNoteForTest(); // saldo 1180
  const primeraVenta = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1180 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1180 }
  }), adminToken);
  assert(primeraVenta.success === true, JSON.stringify(primeraVenta));
  assertEqual(primeraVenta.creditoFavorAplicado.estado, 'APLICADA');

  resetVarT01Stock(5);
  const segundaVenta = doPostRaw('sales.create', buildValidSaleData({
    clienteId: 'CLI-T01', clienteNombre: 'Cliente Test',
    pagos: [{ metodo: 'CREDITO_FAVOR', monto: 1 }, { metodo: 'EFECTIVO', monto: 1179 }],
    creditoFavorAplicado: { id: emitido.id, monto: 1 }
  }), adminToken);
  assert(segundaVenta.success === false, 'un documento ya APLICADA no debe poder reutilizarse ni por un monto mínimo');
  assert(String(segundaVenta.error || '').indexOf('SALDO_INSUFICIENTE') === 0, segundaVenta.error);
});

/* ================================================================
   FASE 8 -- MIGRACIÓN IDEMPOTENTE DE PERMISOS creditos_favor.*
   (Parte 2): instalación nueva ya los recibe vía seedInitialData()
   (probado directamente contra el estado real sembrado al inicio de esta
   suite); instalación existente los recibe al migrar; los permisos ya
   presentes (estándar o personalizados) se conservan intactos; ejecutar
   la migración más de una vez nunca duplica nada; roles desconocidos y
   filas con permisos_json inválido nunca se tocan.
   ================================================================ */

function setRolePermisosJsonForTest(rol, permisosArray) {
  const rawJson = JSON.stringify(permisosArray);
  runInContext(`
    (function() {
      const sheet = DbHelper.getSheet('Roles_Permisos');
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h).trim());
      const rolIdx = headers.indexOf('rol');
      const jsonIdx = headers.indexOf('permisos_json');
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][rolIdx]).trim() === ${JSON.stringify(rol)}) {
          sheet.getRange(i + 1, jsonIdx + 1).setValue(${JSON.stringify(rawJson)});
          break;
        }
      }
    })();
  `);
}

function getRolePermisosJsonForTest(rol) {
  const row = runInContext(`DbHelper.getAllRows('Roles_Permisos').find(r => r.rol === ${JSON.stringify(rol)})`);
  return JSON.parse(row.permisos_json || '[]');
}

// A diferencia de setRolePermisosJsonForTest (que siempre escribe un
// JSON.stringify válido de un arreglo real), esta variante escribe texto
// CRUDO en la celda -- necesaria para simular una celda ya corrupta.
function setRolePermisosRawCellForTest(rol, rawValue) {
  runInContext(`
    (function() {
      const sheet = DbHelper.getSheet('Roles_Permisos');
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h).trim());
      const rolIdx = headers.indexOf('rol');
      const jsonIdx = headers.indexOf('permisos_json');
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][rolIdx]).trim() === ${JSON.stringify(rol)}) {
          sheet.getRange(i + 1, jsonIdx + 1).setValue(${JSON.stringify(rawValue)});
          break;
        }
      }
    })();
  `);
}

test('PERMISSIONS_NEW_INSTALL_ALREADY_HAS_CREDITOS_FAVOR_VIA_SEED', () => {
  // "Instalación nueva recibe permisos": seedInitialData() ya corrió al
  // inicio de esta misma suite (setupDatabase(); seedInitialData();) --
  // se confirma directamente contra ese estado real, sin migrar nada.
  const admin = getRolePermisosJsonForTest('ADMIN');
  const gerente = getRolePermisosJsonForTest('GERENTE');
  const supervisor = getRolePermisosJsonForTest('SUPERVISOR');
  const cajero = getRolePermisosJsonForTest('CAJERO');
  const vendedor = getRolePermisosJsonForTest('VENDEDOR');

  ['creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar', 'creditos_favor.anular'].forEach(p => {
    assert(admin.includes(p), `ADMIN debe tener ${p} desde el seed de una instalación nueva`);
    assert(gerente.includes(p), `GERENTE debe tener ${p} desde el seed de una instalación nueva`);
  });
  ['creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar'].forEach(p => {
    assert(supervisor.includes(p), `SUPERVISOR debe tener ${p} desde el seed`);
  });
  assert(!supervisor.includes('creditos_favor.anular'), 'SUPERVISOR NUNCA debe tener creditos_favor.anular por defecto');
  ['creditos_favor.ver', 'creditos_favor.aplicar'].forEach(p => {
    assert(cajero.includes(p), `CAJERO debe tener ${p} desde el seed`);
    assert(vendedor.includes(p), `VENDEDOR debe tener ${p} desde el seed`);
  });
  assert(!cajero.includes('creditos_favor.crear') && !cajero.includes('creditos_favor.anular'), 'CAJERO NUNCA debe tener crear/anular por defecto');
});

test('PERMISSIONS_MIGRATION_ADDS_MISSING_PERMISSIONS_TO_EXISTING_INSTALL', () => {
  // Simula una instalación EXISTENTE (sembrada antes de la Fase 6): el rol
  // CAJERO tiene sus permisos normales pero SIN ninguno de
  // creditos_favor.*.
  setRolePermisosJsonForTest('CAJERO', ['ventas.crear', 'ventas.ver', 'caja.abrir', 'caja.ver', 'clientes.ver']);
  const before = getRolePermisosJsonForTest('CAJERO');
  assert(!before.includes('creditos_favor.ver'), 'fixture debe simular una instalación sin estos permisos todavía');

  const migRes = doPostRaw('system.migrateCreditosFavorPermissions', {}, adminToken);
  assert(migRes.success === true, JSON.stringify(migRes));
  const cajeroUpdated = migRes.rolesUpdated.find(r => r.rol === 'CAJERO');
  assert(!!cajeroUpdated, 'CAJERO debe reportarse como actualizado');
  assertEqual(JSON.stringify(cajeroUpdated.permisosAgregados.slice().sort()), JSON.stringify(['creditos_favor.aplicar', 'creditos_favor.ver'].sort()));

  const after = getRolePermisosJsonForTest('CAJERO');
  assert(after.includes('creditos_favor.ver') && after.includes('creditos_favor.aplicar'), 'CAJERO debe recibir los permisos faltantes');
  assert(!after.includes('creditos_favor.crear') && !after.includes('creditos_favor.anular'), 'CAJERO nunca debe recibir crear/anular (no le corresponden)');
});

test('PERMISSIONS_MIGRATION_PRESERVES_EXISTING_AND_CUSTOM_PERMISSIONS', () => {
  // "Permisos existentes se conservan": se incluye deliberadamente un
  // permiso personalizado inventado por el negocio (que nunca existió en
  // ningún catálogo de este sistema) para confirmar que la migración
  // JAMÁS lo toca ni lo reordena fuera de su lugar.
  setRolePermisosJsonForTest('VENDEDOR', ['ventas.crear', 'ventas.ver', 'reportes.experimental_del_negocio']);

  const migRes = doPostRaw('system.migrateCreditosFavorPermissions', {}, adminToken);
  assert(migRes.success === true, JSON.stringify(migRes));

  const after = getRolePermisosJsonForTest('VENDEDOR');
  assert(after.includes('ventas.crear'), 'un permiso estándar preexistente no debe perderse');
  assert(after.includes('ventas.ver'), 'un permiso estándar preexistente no debe perderse');
  assert(after.includes('reportes.experimental_del_negocio'), 'un permiso personalizado del negocio NUNCA debe eliminarse ni reemplazarse');
  assert(after.includes('creditos_favor.ver') && after.includes('creditos_favor.aplicar'), 'los permisos nuevos que le corresponden deben agregarse');
  assertEqual(after.length, 5, 'el resultado debe ser exactamente los 3 originales + los 2 nuevos que le corresponden a VENDEDOR, sin nada extra');
});

test('PERMISSIONS_MIGRATION_RUNNING_TWICE_NEVER_DUPLICATES', () => {
  setRolePermisosJsonForTest('SUPERVISOR', ['ventas.crear', 'caja.abrir']);

  const first = doPostRaw('system.migrateCreditosFavorPermissions', {}, adminToken);
  assert(first.success === true, JSON.stringify(first));
  const afterFirst = getRolePermisosJsonForTest('SUPERVISOR');

  const second = doPostRaw('system.migrateCreditosFavorPermissions', {}, adminToken);
  assert(second.success === true, JSON.stringify(second));
  const afterSecond = getRolePermisosJsonForTest('SUPERVISOR');

  assertEqual(JSON.stringify(afterFirst.slice().sort()), JSON.stringify(afterSecond.slice().sort()), 'ejecutar la migración dos veces debe producir exactamente el mismo resultado');
  const uniqueCount = new Set(afterSecond).size;
  assertEqual(uniqueCount, afterSecond.length, 'no debe haber ninguna cadena de permiso duplicada tras ejecutar la migración dos veces');

  const secondSupervisorEntry = second.rolesUpdated.find(r => r.rol === 'SUPERVISOR');
  assert(!secondSupervisorEntry, 'la segunda ejecución no debe reportar a SUPERVISOR como actualizado -- ya no le falta nada');
  assert(second.rolesUnchanged.includes('SUPERVISOR'), 'la segunda ejecución debe reportar a SUPERVISOR como sin cambios');
});

test('PERMISSIONS_MIGRATION_NEVER_TOUCHES_UNKNOWN_CUSTOM_ROLE', () => {
  // Un rol personalizado creado por el negocio (fuera de los 5 estándar)
  // -- la migración no tiene un conjunto "correcto" definido para él, así
  // que debe dejarlo completamente intacto.
  runInContext(`
    DbHelper.insertRow('Roles_Permisos', {
      rol: 'CONSULTOR_EXTERNO', nombre: 'Consultor Externo', descripcion: 'Rol personalizado del negocio',
      permisos_json: JSON.stringify(['reportes.ventas'])
    });
  `);

  const migRes = doPostRaw('system.migrateCreditosFavorPermissions', {}, adminToken);
  assert(migRes.success === true, JSON.stringify(migRes));
  assert(migRes.rolesSkippedUnknown.includes('CONSULTOR_EXTERNO'), 'el rol personalizado debe reportarse como no reconocido, nunca como actualizado');

  const after = getRolePermisosJsonForTest('CONSULTOR_EXTERNO');
  assertEqual(JSON.stringify(after), JSON.stringify(['reportes.ventas']), 'un rol personalizado desconocido nunca debe modificarse');
});

test('PERMISSIONS_MIGRATION_NEVER_OVERWRITES_INVALID_JSON_CELL', () => {
  // Defensa adicional: si por alguna razón permisos_json de un rol
  // ESTÁNDAR reconocido (no uno personalizado -- ese caso ya lo cubre
  // PERMISSIONS_MIGRATION_NEVER_TOUCHES_UNKNOWN_CUSTOM_ROLE) quedó
  // corrupto (no es JSON válido), la migración nunca debe sobreescribirlo
  // a ciegas -- se reporta para revisión manual en vez de arriesgar datos.
  setRolePermisosRawCellForTest('SUPERVISOR', 'esto no es JSON válido {{{');

  const migRes = doPostRaw('system.migrateCreditosFavorPermissions', {}, adminToken);
  assert(migRes.success === true, JSON.stringify(migRes));
  assert(migRes.rolesSkippedInvalidJson.includes('SUPERVISOR'), 'una fila con permisos_json inválido debe reportarse, nunca sobreescribirse a ciegas');
  assert(!migRes.rolesUpdated.some(r => r.rol === 'SUPERVISOR'), 'un rol con JSON corrupto nunca debe reportarse como actualizado');

  const rawAfter = runInContext(`DbHelper.getAllRows('Roles_Permisos').find(r => r.rol === 'SUPERVISOR').permisos_json`);
  assertEqual(rawAfter, 'esto no es JSON válido {{{', 'la celda corrupta debe permanecer exactamente igual, sin tocarse');

  // Restaurado a un estado válido para no dejar SUPERVISOR permanentemente
  // corrupto en el contexto compartido de esta suite.
  setRolePermisosJsonForTest('SUPERVISOR', ['ventas.crear', 'caja.abrir', 'creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar']);
});

test('PERMISSIONS_MIGRATION_REQUIRES_ADMIN_ROLES_PERMISSION', () => {
  // Nunca debe poder ejecutarse sin autorización -- requiere el mismo
  // permiso administrativo que ya protege la gestión de roles.
  const cajeroSession = login('cajero', 'cajero123');
  const res = doPostRaw('system.migrateCreditosFavorPermissions', {}, cajeroSession.sessionToken);
  assert(res.success === false, 'CAJERO no debe poder ejecutar la migración de permisos');
  assert(String(res.error || '').indexOf('FORBIDDEN') === 0, res.error);
});

/* ------------------------------------------------------------
   REPORTE
   ------------------------------------------------------------ */

console.log('\n================ RESULTADOS ================\n');
for (const r of results) {
  console.log(`${r.name}: ${r.outcome}${r.error ? ' -- ' + r.error : ''}`);
}

const passed = results.filter(r => r.outcome === 'PASSED').length;
const failed = results.filter(r => r.outcome === 'FAILED').length;

console.log('\n================ RESUMEN ================\n');
console.log(JSON.stringify({ passed, failed, total: results.length }, null, 2));

if (failed > 0) {
  process.exitCode = 1;
}
