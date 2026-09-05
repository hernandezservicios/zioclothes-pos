/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: Main.gs
 * Description: Universal HTTP Web App Router (doGet/doPost), CORS handler, request dispatcher,
 * and unified error envelope.
 *
 * BACKEND PORTABLE Y REUTILIZABLE:
 * Consumible simultáneamente por AI Studio Frontend, Antigravity Frontend o cualquier cliente HTTP.
 */

/**
 * Handles HTTP GET requests (Health check, ping, and status).
 */
function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action ? e.parameter.action : 'ping';

    if (action === 'ping') {
      let sheetConnected = false;
      let sheetName = '';
      try {
        const ss = getSpreadsheet();
        sheetConnected = true;
        sheetName = ss.getName();
      } catch (err) {
        // Spreadsheet not yet configured
      }

      return createJsonResponse({
        success: true,
        service: CONFIG.APP_NAME,
        version: CONFIG.VERSION,
        status: 'ONLINE',
        timezone: CONFIG.TIMEZONE,
        currentTime: getNowFormatted(),
        spreadsheetConnected: sheetConnected,
        spreadsheetName: sheetName
      });
    }

    if (action === 'bootstrap') {
      const res = SettingsController.handleGetBootstrapData();
      return createJsonResponse(res);
    }

    return createJsonResponse({
      success: true,
      message: 'ZIO CLOTHES API está en línea. Utilice peticiones POST para interactuar con los servicios transaccionales.'
    });

  } catch (error) {
    return createJsonResponse({
      success: false,
      error: error.message || 'Error en petición GET'
    }, 500);
  }
}

/**
 * Handles HTTP POST requests (Main API Router).
 * Accepts raw text/plain or application/json payloads with format:
 * {
 *   "action": "MODULE.ACTION",
 *   "sessionToken": "ZIO-SESS-...",
 *   "data": { ... }
 * }
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseError) {
        throw new Error('INVALID_JSON: El cuerpo de la solicitud no es un JSON válido.');
      }
    } else {
      throw new Error('EMPTY_PAYLOAD: No se recibió contenido en la petición POST.');
    }

    const action = payload.action;
    const sessionToken = payload.sessionToken;
    const data = payload.data || {};

    if (!action || typeof action !== 'string') {
      throw new Error('MISSING_ACTION: Debe especificar una propiedad "action" válida.');
    }

    // Public actions that do not require an active session
    const publicActions = [
      'auth.login',
      'system.ping',
      'system.setupDatabase',
      'system.seedInitialData',
      'system.getSettings'
    ];

    let currentUser = null;
    if (!publicActions.includes(action)) {
      if (!sessionToken) {
        throw new Error('AUTH_REQUIRED: Esta acción requiere un sessionToken válido.');
      }
      currentUser = Security.validateSession(sessionToken);
    }

    // =========================================================================
    // ACTION DISPATCHER
    // =========================================================================
    let result = null;

    switch (action) {
      // --- AUTHENTICATION ---
      case 'auth.login':
        result = AuthController.handleLogin(data);
        break;
      case 'auth.validateSession':
        result = AuthController.handleValidateSession(sessionToken);
        break;
      case 'auth.logout':
        result = AuthController.handleLogout(sessionToken, currentUser);
        break;
      case 'auth.listUsers':
        result = AuthController.handleListUsers(data, currentUser);
        break;
      case 'auth.saveUser':
        result = AuthController.handleSaveUser(data, currentUser);
        break;

      // --- SYSTEM & BOOTSTRAP ---
      case 'system.ping':
        result = { success: true, status: 'ONLINE', time: getNowFormatted() };
        break;
      case 'system.setupDatabase':
        result = setupDatabase();
        break;
      case 'system.seedInitialData':
        result = seedInitialData();
        break;
      case 'system.getBootstrapData':
        result = SettingsController.handleGetBootstrapData();
        break;
      case 'system.getSettings':
        result = SettingsController.handleGetSettings();
        break;
      case 'system.updateSettings':
        result = SettingsController.handleUpdateSettings(data, currentUser);
        break;

      // --- PRODUCTS & CATALOG ---
      case 'products.list':
        result = ProductsController.handleListProducts(data);
        break;
      case 'products.save':
        result = ProductsController.handleSaveProduct(data, currentUser);
        break;
      case 'products.delete':
        result = ProductsController.handleDeleteProduct(data.id, currentUser);
        break;
      case 'products.listAuxiliaries':
        result = ProductsController.handleListAuxiliaries();
        break;

      // --- CUSTOMERS ---
      case 'customers.list':
        result = CustomersController.handleListCustomers();
        break;
      case 'customers.save':
        result = CustomersController.handleSaveCustomer(data, currentUser);
        break;

      // --- SALES (POS) ---
      case 'sales.list':
        result = SalesController.handleListSales(data);
        break;
      case 'sales.create':
        result = SalesController.handleCreateSale(data, currentUser);
        break;
      case 'sales.void':
        result = SalesController.handleVoidSale(data, currentUser);
        break;

      // --- INVENTORY & KARDEX ---
      case 'inventory.adjust':
        result = InventoryController.handleAdjustStock(data, currentUser);
        break;
      case 'inventory.kardex':
        result = InventoryController.handleGetKardex(data);
        break;

      // --- CREDITS & ABONOS ---
      case 'credits.list':
        result = CreditsController.handleListCredits(data);
        break;
      case 'credits.registerAbono':
        result = CreditsController.handleRegisterAbono(data, currentUser);
        break;
      case 'credits.voidAbono':
        result = CreditsController.handleVoidAbono(data, currentUser);
        break;

      // --- CASH REGISTER ---
      case 'cash.getActiveSession':
        result = CashController.handleGetActiveSession();
        break;
      case 'cash.listSessions':
        result = CashController.handleListSessions();
        break;
      case 'cash.open':
        result = CashController.handleOpenSession(data, currentUser);
        break;
      case 'cash.close':
        result = CashController.handleCloseSession(data, currentUser);
        break;
      case 'cash.addMovement':
        result = CashController.handleAddMovement(data, currentUser);
        break;

      // --- EXPENSES ---
      case 'expenses.list':
        result = ExpensesController.handleListExpenses(data);
        break;
      case 'expenses.create':
        result = ExpensesController.handleCreateExpense(data, currentUser);
        break;

      // --- PURCHASES ---
      case 'purchases.list':
        result = PurchasesController.handleListPurchases(data);
        break;
      case 'purchases.create':
        result = PurchasesController.handleCreatePurchase(data, currentUser);
        break;

      // --- RETURNS ---
      case 'returns.list':
        result = ReturnsController.handleListReturns(data);
        break;
      case 'returns.create':
        result = ReturnsController.handleCreateReturn(data, currentUser);
        break;

      // --- AUDIT ---
      case 'audit.list':
        result = AuditController.handleList(data, currentUser);
        break;

      default:
        throw new Error(`UNKNOWN_ACTION: La acción '${action}' no está reconocida por el backend.`);
    }

    return createJsonResponse(result);

  } catch (error) {
    Logger.log(`[API Error] ${error.message}`);
    return createJsonResponse({
      success: false,
      error: error.message || 'Error interno del servidor en Google Apps Script',
      timestamp: getNowFormatted()
    });
  }
}

/**
 * Creates a JSON response with proper CORS headers.
 * Uses text/plain MIME type in output so client fetch does not trigger CORS preflight blocks.
 */
function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
