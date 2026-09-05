/**
 * ZIO CLOTHES — CleanTestData_v2.gs
 *
 * Ejecutar:
 *   cleanAllTestData()
 *   verifyNoTestData()
 *
 * Solo elimina registros cuyo ID (primera columna) empieza con TEST-.
 * Protege Configuracion, Usuarios, Roles_Permisos y Secuencias.
 */

const CLEAN_TEST_PREFIX = 'TEST-';

function cleanAllTestData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = getSpreadsheet();
    let deleted = 0;

    Object.keys(SCHEMAS).forEach(function(name) {
      if (name === 'Configuracion' || name === 'Usuarios' ||
          name === 'Roles_Permisos' || name === 'Secuencias') {
        Logger.log('PROTEGIDA: ' + name);
        return;
      }

      const sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return;

      const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
      const rows = [];
      ids.forEach(function(r,i) {
        if (String(r[0]).indexOf(CLEAN_TEST_PREFIX) === 0) rows.push(i+2);
      });

      for (let i=rows.length-1;i>=0;i--) {
        sh.deleteRow(rows[i]);
        deleted++;
      }

      if (rows.length) Logger.log(name + ': eliminadas=' + rows.length);
    });

    SpreadsheetApp.flush();
    Logger.log('LIMPIEZA COMPLETADA. Filas TEST eliminadas=' + deleted);
    Logger.log('Configuracion NO fue tocada.');
  } finally {
    lock.releaseLock();
  }
}

function verifyNoTestData() {
  const ss = getSpreadsheet();
  let remaining = 0;

  Object.keys(SCHEMAS).forEach(function(name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;

    const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    ids.forEach(function(r,i) {
      if (String(r[0]).indexOf(CLEAN_TEST_PREFIX) === 0) {
        Logger.log('RESTANTE: ' + name + ' fila ' + (i+2) + ' -> ' + r[0]);
        remaining++;
      }
    });
  });

  const cfg = ss.getSheetByName('Configuracion');
  Logger.log('Configuracion rows=' + (cfg ? cfg.getLastRow() : 'NO ENCONTRADA'));
  Logger.log('TEST rows restantes=' + remaining);
  Logger.log(remaining === 0 ? 'OK: no quedan registros TEST-*.' : 'ATENCION: quedan registros TEST-*.');
}
