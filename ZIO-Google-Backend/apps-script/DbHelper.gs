/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: DbHelper.gs
 * Description: High-performance spreadsheet data access layer, dynamic column-name object mapping,
 * batch operations, and compensation-based Transaction Rollback Engine.
 */

const DbHelper = {
  _sheetCache: {},

  /**
   * Retrieves a sheet by name with in-memory caching for the request lifecycle.
   * @param {string} sheetName
   * @returns {GoogleAppsScript.Spreadsheet.Sheet}
   */
  getSheet(sheetName) {
    if (this._sheetCache[sheetName]) {
      return this._sheetCache[sheetName];
    }
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`[DbHelper] La hoja '${sheetName}' no existe en el Google Spreadsheet.`);
    }
    this._sheetCache[sheetName] = sheet;
    return sheet;
  },

  /**
   * FASE B (RESTAURACIÓN REAL): invalida la caché de hoja para un nombre
   * específico (o toda la caché si no se pasa `sheetName`). Indispensable
   * cuando algo distinto de DbHelper renombra/borra/reemplaza una hoja en
   * medio de la misma ejecución (ver RestoreController.gs -- la
   * estrategia de staging/swap por hojas renombra y borra hojas reales) --
   * sin esto, una llamada posterior a `getSheet(sheetName)` devolvería la
   * referencia vieja cacheada en vez de la hoja real que ahora ocupa ese
   * nombre, un bug silencioso y grave. Nunca se llama durante el flujo
   * normal de negocio (crear venta, ajustar stock, etc.), que jamás
   * renombra ni borra hojas.
   */
  invalidateSheetCache(sheetName) {
    if (sheetName) {
      delete this._sheetCache[sheetName];
    } else {
      this._sheetCache = {};
    }
  },

  /**
   * Reads all data rows from a sheet and maps them to an array of objects based on row 1 headers.
   * Uses a single getValues() call for optimal performance.
   * @param {string} sheetName
   * @returns {Array<Object>}
   */
  getAllRows(sheetName) {
    const sheet = this.getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // Only headers or empty

    const headers = data[0].map(h => String(h).trim());
    const rows = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Skip completely empty rows
      if (row.every(cell => cell === '' || cell === null || cell === undefined)) {
        continue;
      }
      const obj = { _rowNumber: i + 1 };
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (header) {
          obj[header] = row[j];
        }
      }
      rows.push(obj);
    }
    return rows;
  },

  /**
   * Finds rows that match a predicate function.
   * @param {string} sheetName
   * @param {Function} predicate
   * @returns {Array<Object>}
   */
  findRows(sheetName, predicate) {
    const rows = this.getAllRows(sheetName);
    return rows.filter(predicate);
  },

  /**
   * Finds a single row by its 'id' column value.
   * @param {string} sheetName
   * @param {string} id
   * @returns {Object|null}
   */
  findById(sheetName, id) {
    if (!id) return null;
    const cleanId = String(id).trim();
    const rows = this.getAllRows(sheetName);
    return rows.find(r => String(r.id || '').trim() === cleanId) || null;
  },

  /**
   * Returns the header array from row 1 of a sheet.
   * @param {string} sheetName
   * @returns {Array<string>}
   */
  getHeaders(sheetName) {
    const sheet = this.getSheet(sheetName);
    const range = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1);
    const headers = range.getValues()[0];
    return headers.map(h => String(h).trim());
  },

  /**
   * Inserts a single row object into a sheet.
   * Automatically orders values according to the sheet's header columns.
   * @param {string} sheetName
   * @param {Object} rowObj
   * @returns {Object} the inserted rowObj
   */
  insertRow(sheetName, rowObj) {
    const sheet = this.getSheet(sheetName);
    const headers = this.getHeaders(sheetName);
    const rowValues = headers.map(header => {
      const val = rowObj[header];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    });

    sheet.appendRow(rowValues);
    return rowObj;
  },

  /**
   * Bulk inserts an array of row objects into a sheet in a single batch setValues() call.
   * Significantly faster than multiple appendRow calls.
   * @param {string} sheetName
   * @param {Array<Object>} rowObjs
   * @returns {Array<Object>}
   */
  insertRows(sheetName, rowObjs) {
    if (!rowObjs || rowObjs.length === 0) return [];
    const sheet = this.getSheet(sheetName);
    const headers = this.getHeaders(sheetName);

    const matrix = rowObjs.map(obj => {
      return headers.map(header => {
        const val = obj[header];
        if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return val;
      });
    });

    const startRow = sheet.getLastRow() + 1;
    const targetRange = sheet.getRange(startRow, 1, matrix.length, headers.length);
    targetRange.setValues(matrix);

    return rowObjs;
  },

  /**
   * Updates a row by ID with specific updated fields.
   * @param {string} sheetName
   * @param {string} id
   * @param {Object} updatesObj
   * @returns {Object} updated row
   */
  updateRowById(sheetName, id, updatesObj) {
    return this.updateRowByKey(sheetName, 'id', id, updatesObj);
  },

  /**
   * AUDITORÍA (permisos de vista -- Fase 2/5): generalización de
   * `updateRowById` para hojas cuya clave natural NO es una columna `id`
   * -- caso real confirmado de `Roles_Permisos`, que se identifica por
   * `rol` (una fila por rol, sin columna `id` en absoluto). Antes de
   * agregar esto, la única alternativa habría sido duplicar esta misma
   * lógica de lectura/escritura fuera de DbHelper (como ya se hizo una
   * vez, documentado en `migrateCreditosFavorPermissions`); en vez de
   * repetir ese patrón una segunda vez, se generaliza aquí una sola vez.
   * `updateRowById` ahora es un caso particular de este método
   * (`keyColumn: 'id'`) -- mismo comportamiento exacto que antes, ninguna
   * hoja existente cambia de comportamiento.
   * @param {string} sheetName
   * @param {string} keyColumn - Nombre de la columna clave (ej. 'id', 'rol').
   * @param {string} keyValue
   * @param {Object} updatesObj
   * @returns {Object} updated row
   */
  updateRowByKey(sheetName, keyColumn, keyValue, updatesObj) {
    const sheet = this.getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) throw new Error(`[DbHelper] No se encontró el registro con ${keyColumn}='${keyValue}' en '${sheetName}'.`);

    const headers = data[0].map(h => String(h).trim());
    const keyColIndex = headers.indexOf(keyColumn);
    if (keyColIndex === -1) throw new Error(`[DbHelper] La hoja '${sheetName}' no tiene columna '${keyColumn}'.`);

    const cleanKey = String(keyValue).trim();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][keyColIndex]).trim() === cleanKey) {
        rowIndex = i + 1; // 1-based index in Sheet
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error(`[DbHelper] No se encontró el registro con ${keyColumn}='${keyValue}' en '${sheetName}'.`);
    }

    const currentRow = data[rowIndex - 1];
    const updatedValues = headers.map((header, j) => {
      if (updatesObj[header] !== undefined) {
        const val = updatesObj[header];
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        return val;
      }
      return currentRow[j];
    });

    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedValues]);

    const result = {};
    headers.forEach((h, idx) => {
      result[h] = updatedValues[idx];
    });
    return result;
  },

  /**
   * Deletes a row by ID.
   * @param {string} sheetName
   * @param {string} id
   * @returns {boolean}
   */
  deleteRowById(sheetName, id) {
    const sheet = this.getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const idColIndex = headers.indexOf('id');
    const cleanId = String(id).trim();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idColIndex]).trim() === cleanId) {
        sheet.deleteRow(i + 1);
        return true;
      }
    }
    return false;
  },

  // =========================================================================
  // TRANSACTION ROLLBACK & COMPENSATION ENGINE
  // =========================================================================

  /**
   * Initializes a new transaction tracking context for compensation.
   * @returns {Object} tx
   */
  beginTx() {
    return {
      id: Utilities.getUuid(),
      createdAt: Date.now(),
      undoLog: [] // List of compensation actions in order
    };
  },

  /**
   * Records an inserted row in the transaction context.
   * If rollback occurs, this row will be deleted.
   * @param {Object} tx
   * @param {string} sheetName
   * @param {string} rowId
   */
  recordInsert(tx, sheetName, rowId) {
    if (!tx || !tx.undoLog) return;
    tx.undoLog.push({
      action: 'DELETE_INSERTED_ROW',
      sheetName: sheetName,
      rowId: rowId
    });
  },

  /**
   * Records a modified row before update.
   * If rollback occurs, the row will be restored to previous values.
   * @param {Object} tx
   * @param {string} sheetName
   * @param {string} rowId
   * @param {Object} previousValues
   */
  recordUpdate(tx, sheetName, rowId, previousValues) {
    if (!tx || !tx.undoLog) return;
    tx.undoLog.push({
      action: 'RESTORE_UPDATED_ROW',
      sheetName: sheetName,
      rowId: rowId,
      previousValues: Object.assign({}, previousValues)
    });
  },

  /**
   * Executes compensation rollback in reverse order if a critical transaction fails.
   * Guarantees zero partially inserted data across sheets.
   * @param {Object} tx
   * @param {Error} error
   */
  rollback(tx, error) {
    if (!tx || !tx.undoLog || tx.undoLog.length === 0) return;
    Logger.log(`[Tx Rollback] Iniciando compensación de ${tx.undoLog.length} operaciones para Tx ${tx.id}. Causa: ${error ? error.message : 'Desconocida'}`);

    // Process compensation in reverse order
    for (let i = tx.undoLog.length - 1; i >= 0; i--) {
      const item = tx.undoLog[i];
      try {
        if (item.action === 'DELETE_INSERTED_ROW') {
          DbHelper.deleteRowById(item.sheetName, item.rowId);
          Logger.log(`[Tx Rollback] Fila eliminada: ${item.sheetName} (ID: ${item.rowId})`);
        } else if (item.action === 'RESTORE_UPDATED_ROW') {
          DbHelper.updateRowById(item.sheetName, item.rowId, item.previousValues);
          Logger.log(`[Tx Rollback] Fila restaurada: ${item.sheetName} (ID: ${item.rowId})`);
        }
      } catch (compensationError) {
        Logger.log(`[Tx Rollback ERROR] Falló compensación en ${item.sheetName} para ID ${item.rowId}: ${compensationError.message}`);
      }
    }
  }
};
