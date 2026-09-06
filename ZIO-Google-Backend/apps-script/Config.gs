/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: Config.gs
 * Description: Global configuration, environment properties, and constants.
 */

const CONFIG = {
  APP_NAME: 'ZIO CLOTHES API',
  VERSION: '2.0.0-PROD',
  TIMEZONE: 'America/Santo_Domingo',
  SESSION_TTL_HOURS: 12,
  LOCK_TIMEOUT_MS: 15000,
  // FASE B (RESTAURACIÓN REAL): una restauración puede escribir miles de
  // filas en varias hojas -- 15 segundos (el timeout normal de negocio)
  // es insuficiente para esperar a ADQUIRIR el lock si otra operación
  // crítica está en curso. Esto NO es cuánto tiempo puede DURAR la
  // restauración una vez adquirido el lock (eso lo limita Apps Script
  // mismo, ver RestoreController.gs) -- es solo cuánto espera antes de
  // rendirse si el lock ya está tomado.
  RESTORE_LOCK_TIMEOUT_MS: 30000,
  DEFAULT_CURRENCY: 'RD$',
  DEFAULT_TAX_RATE: 18,
};

/**
 * Returns the active or configured Google Spreadsheet instance.
 * Priority:
 * 1. Script Properties 'SPREADSHEET_ID'
 * 2. Active bound Spreadsheet (if deployed inside a Sheet)
 */
function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SPREADSHEET_ID');

  if (sheetId && sheetId.trim() !== '') {
    try {
      return SpreadsheetApp.openById(sheetId.trim());
    } catch (e) {
      throw new Error(`[Config] No se pudo abrir el Spreadsheet con ID '${sheetId}': ${e.message}`);
    }
  }

  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {
    // Not a container-bound script
  }

  throw new Error(
    '[Config] SPREADSHEET_ID no está configurado. Ejecute setSpreadsheetId("ID_DE_TU_HOJA") en el editor de Apps Script o defínalo en Script Properties.'
  );
}

/**
 * Helper to set SPREADSHEET_ID in Script Properties from Apps Script editor.
 * @param {string} id - The Google Spreadsheet ID
 */
function setSpreadsheetId(id) {
  if (!id || typeof id !== 'string') {
    throw new Error('Debe proporcionar un ID de Spreadsheet válido.');
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id.trim());
  Logger.log(`[Config] SPREADSHEET_ID configurado exitosamente: ${id.trim()}`);
  return { success: true, message: `SPREADSHEET_ID configurado exitosamente: ${id.trim()}` };
}

/**
 * Returns current formatted date/time string in America/Santo_Domingo timezone.
 * Format: YYYY-MM-DD HH:mm:ss
 */
function getNowFormatted() {
  const now = new Date();
  return Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * FASE 3.6 (corrección de bloqueante): regla financiera única de
 * redondeo monetario, reutilizada por cualquier controlador que calcule
 * dinero (SalesController, CreditsController, CashController, etc.) para
 * no duplicar reglas de redondeo distintas en cada archivo. No existía
 * ninguna función de este tipo en el backend antes de este cambio
 * (verificado buscando "round"/"toFixed" en todos los .gs).
 *
 * Redondea a 2 decimales usando el método estándar (mitad hacia arriba),
 * evitando errores de coma flotante del tipo 0.1 + 0.2 !== 0.3.
 * @param {number} n
 * @returns {number}
 */
function roundMoney(n) {
  const value = Number(n) || 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
