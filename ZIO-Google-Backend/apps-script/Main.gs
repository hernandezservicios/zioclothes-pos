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

    // Public actions that do not require an active session.
    //
    // TAREA -- INSTALACIÓN LIMPIA + PRIMER ADMIN (Fase 14, auditoría):
    // 'system.setupDatabase'/'system.seedInitialData' SALIERON de aquí --
    // eran públicas sin ningún motivo real (nada en el frontend las
    // llama) y, con una instalación NUEVA ahora deliberadamente vacía de
    // usuarios hasta que el cliente crea su propio ADMIN, dejarlas
    // públicas habría permitido a cualquier anónimo sembrar
    // admin/admin123 en una instalación real todavía sin proteger. Siguen
    // existiendo como acciones autenticadas (ver más abajo, gateadas por
    // 'admin.roles') -- setupNuevaInstalacion() nunca pasa por aquí, las
    // llama directamente como funciones de Apps Script, así que no se ve
    // afectada.
    //
    // 'system.installationStatus'/'system.setupInitialAdmin' SÍ deben ser
    // públicas -- se consultan/usan ANTES de que exista cualquier sesión
    // posible (la primera vez que alguien abre el frontend de una
    // instalación recién creada). Se protegen con su propia lógica
    // interna (ver SetupInstaller.gs), nunca con sessionToken.
    const publicActions = [
      'auth.login',
      'system.ping',
      'system.getSettings',
      'system.installationStatus',
      'system.setupInitialAdmin'
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
      // TAREA -- INSTALACIÓN LIMPIA (Fase 14): ya no son públicas (ver
      // publicActions arriba) -- ahora exigen sesión real + 'admin.roles',
      // el mismo permiso que ya protege las migraciones de abajo.
      // Comportamiento interno SIN CAMBIOS (siguen llamando exactamente a
      // las mismas funciones de siempre) -- setupNuevaInstalacion() nunca
      // pasa por aquí, no se ve afectada.
      case 'system.setupDatabase':
        Security.requirePermission(currentUser, 'admin.roles');
        result = setupDatabase();
        break;
      case 'system.seedInitialData':
        Security.requirePermission(currentUser, 'admin.roles');
        result = seedInitialData();
        break;
      // TAREA -- INSTALACIÓN LIMPIA + PRIMER ADMIN.
      case 'system.installationStatus':
        result = handleInstallationStatus_();
        break;
      case 'system.setupInitialAdmin':
        result = handleSetupInitialAdmin_(data);
        break;
      case 'system.migrateInitialAdminStatus':
        Security.requirePermission(currentUser, 'admin.roles');
        result = migrateInitialAdminStatus();
        break;
      // FASE 8 (Parte 2): migración idempotente de permisos
      // creditos_favor.* para instalaciones YA EXISTENTES -- a diferencia
      // de setupDatabase/seedInitialData (bootstrap de una instalación
      // nueva, sin usuarios todavía), esta acción opera sobre una
      // instalación real ya en uso, así que SÍ exige una sesión válida y
      // el mismo permiso administrativo que ya protege la gestión de
      // roles (admin.roles) -- nunca se agrega a `publicActions`.
      case 'system.migrateCreditosFavorPermissions':
        Security.requirePermission(currentUser, 'admin.roles');
        result = migrateCreditosFavorPermissions();
        break;
      // TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL: mismo patrón y
      // mismo permiso ('admin.roles') que la migración de arriba --
      // backfill idempotente de los códigos 'vista.*' para instalaciones
      // YA EXISTENTES (una instalación nueva ya los recibe sembrados
      // directamente en seedInitialData()).
      case 'system.migrateViewPermissions':
        Security.requirePermission(currentUser, 'admin.roles');
        result = migrateViewPermissions();
        break;

      // --- ROLES Y PERMISOS DE VISTA (TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL) ---
      case 'roles.list':
        result = RolesController.handleListRoles(currentUser);
        break;
      case 'roles.updatePermissions':
        result = RolesController.handleUpdateRolePermissions(data, currentUser);
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
      case 'settings.uploadLogo':
        result = SettingsController.handleUploadLogo(data, currentUser);
        break;

      // --- BACKUP RESTORE (FASE B) ---
      case 'system.previewRestoreBackup':
        result = RestoreController.handlePreviewRestoreBackup(data, currentUser);
        break;
      case 'system.restoreBackup':
        result = RestoreController.handleRestoreBackup(data, currentUser);
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
      case 'products.uploadImage':
        result = ProductsController.handleUploadImage(data, currentUser);
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

      // --- CREDIT NOTES / STORE CREDIT (Créditos a Favor / Vales / Notas
      // de Crédito -- FASE 6) ---
      case 'creditNotes.list':
        result = CreditNotesController.handleListCreditNotes(data);
        break;
      case 'creditNotes.apply':
        result = CreditNotesController.handleApplyCreditNote(data, currentUser);
        break;
      case 'creditNotes.void':
        result = CreditNotesController.handleVoidCreditNote(data, currentUser);
        break;

      // --- CASH REGISTER ---
      case 'cash.getActiveSession':
        result = CashController.handleGetActiveSession();
        break;
      case 'cash.listSessions':
        result = CashController.handleListSessions();
        break;
      case 'cash.listMovements':
        result = CashController.handleListMovements(data, currentUser);
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
