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
