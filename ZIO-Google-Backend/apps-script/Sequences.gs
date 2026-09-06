/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: Sequences.gs
 * Description: Atomic consecutive sequence generation for business vouchers and IDs.
 */

const Sequences = {
  /**
   * Generates the next atomic sequence number with the requested prefix.
   * e.g. 'VEN' -> 'VEN-000001'
   * Note: This method should always be invoked within a LockService block.
   *
   * @param {string} prefix - e.g. 'VEN', 'CLI', 'PRD', 'CAJA', 'ABO', 'CRED', etc.
   * @param {number} padding - zero padding width (default 6)
   * @returns {string} formatted code (e.g. 'VEN-000001')
   */
  getNext(prefix, padding = 6) {
    if (!prefix) throw new Error('[Sequences] Prefijo requerido.');
    const cleanPrefix = String(prefix).trim().toUpperCase();

    const sheet = DbHelper.getSheet('Secuencias');
    const data = sheet.getDataRange().getValues();
    let currentNumber = 1;
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === cleanPrefix) {
        currentNumber = Number(data[i][1]) || 1;
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      // Create new sequence row
      sheet.appendRow([cleanPrefix, 2, getNowFormatted()]);
      currentNumber = 1;
    } else {
      // Increment existing sequence row
      const nextNumber = currentNumber + 1;
      sheet.getRange(rowIndex, 2, 1, 2).setValues([[nextNumber, getNowFormatted()]]);
    }

    const paddedNum = String(currentNumber).padStart(padding, '0');
    return `${cleanPrefix}-${paddedNum}`;
  },

  /**
   * FASE B (RESTAURACIÓN REAL): garantiza que el próximo `getNext(prefix)`
   * sea ESTRICTAMENTE MAYOR que `maxRestoredNumber` -- nunca se copia la
   * hoja `Secuencias` del backup tal cual (el backup pudo generarse antes
   * de ventas/documentos posteriores a esa fecha, lo que causaría
   * colisión de IDs con datos ya restaurados). Nunca DISMINUYE una
   * secuencia existente: si el valor actual ya es suficiente, no hace
   * nada -- esto es intencional para no invalidar documentos ya emitidos
   * después del backup en el escenario (poco probable pero posible) de
   * que la restauración no sea la operación más reciente sobre el
   * sistema.
   * @param {string} prefix
   * @param {number} maxRestoredNumber - el número más alto encontrado
   *   entre los IDs restaurados con este prefijo (0 si no hubo ninguno).
   */
  ensureMinimumNext(prefix, maxRestoredNumber) {
    if (!prefix) throw new Error('[Sequences] Prefijo requerido.');
    const cleanPrefix = String(prefix).trim().toUpperCase();
    const requiredNext = (Number(maxRestoredNumber) || 0) + 1;

    const sheet = DbHelper.getSheet('Secuencias');
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    let currentNext = 1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toUpperCase() === cleanPrefix) {
        currentNext = Number(data[i][1]) || 1;
        rowIndex = i + 1;
        break;
      }
    }

    if (requiredNext <= currentNext) {
      return { prefix: cleanPrefix, before: currentNext, after: currentNext, changed: false };
    }

    if (rowIndex === -1) {
      sheet.appendRow([cleanPrefix, requiredNext, getNowFormatted()]);
    } else {
      sheet.getRange(rowIndex, 2, 1, 2).setValues([[requiredNext, getNowFormatted()]]);
    }
    return { prefix: cleanPrefix, before: currentNext, after: requiredNext, changed: true };
  }
};
