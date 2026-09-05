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
  }
};
