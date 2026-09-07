import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';

/**
 * FASE — COPIA DE SEGURIDAD: pruebas de la UI (Requerimientos 21.1, 21.2,
 * 21.3, 21.4, 21.8, 21.9, 21.19 de la lista de tests obligatorios).
 *
 * SettingsView.tsx real, sin reescribir -- solo se sustituyen sus
 * contextos/servicios reales por dobles de prueba controlados
 * (useAuth/useToast/settingsApi/authApi), igual que en POSView.test.tsx.
 *
 * Los ítems 10-17, 20 y 22 de la lista de 24 tests (restauración
 * exitosa, atomicidad, relaciones, auditoría, colisión de secuencias)
 * dependen del backend de restauración -- explícitamente NO construido
 * en esta fase (ver comentario de alcance al inicio de SettingsView.tsx)
 * -- no se prueban aquí porque no existe código real que ejercitar; ver
 * el reporte de la fase para el detalle de qué queda pendiente.
 */

let hasPermissionMock: (perm: string) => boolean;
const logoutMock = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    settings: { simboloMoneda: 'RD$', nombreNegocio: 'ZIO CLOTHES' },
    updateSettings: vi.fn(),
    currentUser: { id: 'USR-001', nombre: 'Admin' },
    hasPermission: (perm: string) => hasPermissionMock(perm),
    refreshCatalog: vi.fn(),
    // FASE (configuración inicial del backend antes del login): "Cambiar
    // Servidor" reutiliza logout() TAL CUAL -- se mockea aquí (no forma
    // parte del alcance de esta pantalla) para verificar solo que SE
    // LLAMA, sin ejercitar AuthContext real de nuevo.
    logout: logoutMock,
  }),
}));

// FASE (configuración inicial del backend antes del login): "Probar
// Conexión" usa apiService.checkBackendConnection (doGet real) --
// mockeado aquí porque ya se prueba a fondo en apiService.test.ts; esta
// suite solo verifica que SettingsView lo llame y refleje su resultado.
vi.mock('../../services/apiService', async () => {
  const actual = await vi.importActual<typeof import('../../services/apiService')>('../../services/apiService');
  return {
    ...actual,
    apiService: { checkBackendConnection: vi.fn() },
  };
});

const showToastMock = vi.fn();
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock('../../services/settingsApi', () => ({
  settingsApi: {
    get: vi.fn().mockResolvedValue({ success: true, data: { simboloMoneda: 'RD$' } }),
    uploadLogo: vi.fn(),
  },
}));

vi.mock('../../services/authApi', () => ({
  authApi: {
    listUsers: vi.fn().mockResolvedValue({ success: true, data: [] }),
    saveUser: vi.fn(),
  },
}));

// TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL -- "Roles y Permisos".
// Por defecto, 4 roles editables con solo `vista.pos` marcado (fixture
// mínima real, nunca vacía) -- cada test que necesite otra combinación
// sobreescribe el mock puntualmente.
const rolesListMock = vi.fn().mockResolvedValue({
  success: true,
  data: [
    { rol: 'GERENTE', nombre: 'Gerente de Tienda', descripcion: '', permisos: ['ventas.ver', 'vista.pos'] },
    { rol: 'SUPERVISOR', nombre: 'Supervisor de Turno', descripcion: '', permisos: ['ventas.ver', 'vista.pos'] },
    { rol: 'CAJERO', nombre: 'Cajero / POS', descripcion: '', permisos: ['ventas.ver', 'vista.pos'] },
    { rol: 'VENDEDOR', nombre: 'Asesor de Ventas', descripcion: '', permisos: ['ventas.ver', 'vista.pos'] },
  ],
});
const rolesUpdateViewPermissionsMock = vi.fn().mockResolvedValue({ success: true, message: 'OK', data: { permisos: [] } });
const rolesApplyViewDefaultsMock = vi.fn().mockResolvedValue({ success: true, data: { rolesUpdated: [], rolesUnchanged: [] } });
vi.mock('../../services/rolesApi', () => ({
  rolesApi: {
    list: (...args: unknown[]) => rolesListMock(...args),
    updateViewPermissions: (...args: unknown[]) => rolesUpdateViewPermissionsMock(...args),
    applyViewPermissionDefaults: (...args: unknown[]) => rolesApplyViewDefaultsMock(...args),
  },
}));

// FASE A -- BACKUP PROFESIONAL: mocks para poder ejercitar el botón real
// "Descargar Backup JSON" (handleExportBackup -> buildBackupPayload)
// desde la UI, además del flujo de restauración ya cubierto arriba.
vi.mock('../../services/productsApi', () => ({
  productsApi: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    listAuxiliaries: vi.fn().mockResolvedValue({ success: true, data: { categories: [], sizes: [], colors: [] } }),
  },
}));
vi.mock('../../services/customersApi', () => ({ customersApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/salesApi', () => ({ salesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/creditsApi', () => ({ creditsApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/creditNotesApi', () => ({ creditNotesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/returnsApi', () => ({ returnsApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/expensesApi', () => ({ expensesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/purchasesApi', () => ({ purchasesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));
vi.mock('../../services/inventoryApi', () => ({ inventoryApi: { listKardex: vi.fn().mockResolvedValue({ success: true, data: [] }) } }));

const cashListSessionsMock = vi.fn().mockResolvedValue({ success: true, data: [] });
const cashListMovementsMock = vi.fn().mockResolvedValue({ success: true, data: [] });
vi.mock('../../services/cashApi', () => ({
  cashApi: { listSessions: (...args: unknown[]) => cashListSessionsMock(...args), listMovements: (...args: unknown[]) => cashListMovementsMock(...args) },
}));

// FASE B -- el DataStore central se invalida/refresca tras una
// restauración exitosa (nunca se deja el estado React viejo en
// pantalla).
const clearDataStoreMock = vi.fn();
const refreshProductsMock = vi.fn().mockResolvedValue(true);
const refreshCustomersMock = vi.fn().mockResolvedValue(true);
const refreshSalesMock = vi.fn().mockResolvedValue(true);
const refreshCreditsMock = vi.fn().mockResolvedValue(true);
const refreshCreditNotesMock = vi.fn().mockResolvedValue(true);
const refreshExpensesMock = vi.fn().mockResolvedValue(true);
const refreshReturnsMock = vi.fn().mockResolvedValue(true);
vi.mock('../../context/DataStoreContext', () => ({
  useDataStore: () => ({
    clear: clearDataStoreMock,
    refreshProducts: refreshProductsMock,
    refreshCustomers: refreshCustomersMock,
    refreshSales: refreshSalesMock,
    refreshCredits: refreshCreditsMock,
    refreshCreditNotes: refreshCreditNotesMock,
    refreshExpenses: refreshExpensesMock,
    refreshReturns: refreshReturnsMock,
  }),
}));

// FASE B -- system.previewRestoreBackup/system.restoreBackup reales.
// Por defecto "válido"/"éxito" para no bloquear las pruebas de UI que no
// están probando específicamente el resultado del backend; cada test que
// necesite el caso contrario sobreescribe el mock puntualmente.
const restorePreviewMock = vi.fn().mockResolvedValue({ success: true, data: { valid: true, totalRecords: 2, entities: [], warnings: [], errors: [] } });
const restoreExecuteMock = vi.fn().mockResolvedValue({ success: true, data: { totalRecords: 2, entities: [], sequencesRecalculated: [] } });
// AUDITORÍA (Objetivo B) -- por defecto "sin registro previo" (data: null)
// para no bloquear las pruebas que no ejercitan específicamente el flujo
// de verificación post-timeout; esas pruebas sobreescriben el mock.
const getLastBackupAuditEntryMock = vi.fn().mockResolvedValue({ success: true, message: 'OK', data: null });
vi.mock('../../services/restoreApi', () => ({
  restoreApi: {
    preview: (...args: unknown[]) => restorePreviewMock(...args),
    restore: (...args: unknown[]) => restoreExecuteMock(...args),
    getLastBackupAuditEntry: (...args: unknown[]) => getLastBackupAuditEntryMock(...args),
  },
}));

// Formato v2 COMPLETO real (el único que el motor de restauración actual
// acepta -- ver restoreIsRestorableFormat en SettingsView.tsx) con las 14
// entidades críticas presentes (vacías es válido, solo deben EXISTIR).
function validBackupJson(): string {
  const emptyCritical = ['sales', 'credits', 'creditNotes', 'returns', 'purchases', 'expenses', 'cashSessions', 'cashMovements', 'kardex', 'sizes', 'colors'];
  const data: Record<string, unknown> = {
    products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 500, costo: 300 }],
    categories: [{ id: 'CAT-000001', nombre: 'Ropa' }],
    customers: [{ id: 'CLI-000001', nombre: 'Ana' }],
  };
  emptyCritical.forEach((k) => { data[k] = []; });
  return JSON.stringify({
    backupVersion: 2,
    format: 'zio-pos-backup',
    createdAt: '2026-09-06T10:00:00.000Z',
    timezone: 'America/Santo_Domingo',
    appVersion: '2.0.0-PROD',
    source: 'live-backend',
    complete: true,
    entities: [],
    totalRecords: 2,
    data,
    omitted: [],
    warnings: [],
  });
}

function jsonFile(content: string, name = 'backup.json'): File {
  return new File([content], name, { type: 'application/json' });
}

async function renderOnBackupTab() {
  render(<SettingsView />);
  fireEvent.click(screen.getByText('Copia de Seguridad'));
  return screen.getByLabelText('Seleccionar archivo JSON de backup') as HTMLInputElement;
}

describe('SettingsView -- Copia de Seguridad', () => {
  beforeEach(() => {
    hasPermissionMock = () => true; // admin por defecto en la mayoría de las pruebas
    showToastMock.mockClear();
    restorePreviewMock.mockClear();
    restoreExecuteMock.mockClear();
    getLastBackupAuditEntryMock.mockClear();
    clearDataStoreMock.mockClear();
    [refreshProductsMock, refreshCustomersMock, refreshSalesMock, refreshCreditsMock, refreshCreditNotesMock, refreshExpensesMock, refreshReturnsMock].forEach((m) => m.mockClear());
  });
  afterEach(() => cleanup());

  // Requerimiento 21.1
  it('1) el bloque "Limpiar Caché Local" ya NO aparece', async () => {
    await renderOnBackupTab();
    expect(screen.queryByText('Limpiar Caché Local')).not.toBeInTheDocument();
    expect(screen.queryByText('Restablecer Datos')).not.toBeInTheDocument();
  });

  // Requerimiento 21.2
  it('2) aparece "Restaurar Backup JSON"', async () => {
    await renderOnBackupTab();
    expect(screen.getByText('Restaurar Backup JSON')).toBeInTheDocument();
  });

  // Requerimiento 21.3
  it('3) el selector de archivo acepta únicamente JSON', async () => {
    const input = await renderOnBackupTab();
    expect(input).toHaveAttribute('type', 'file');
    expect(input.accept).toContain('json');
  });

  // Requerimiento 21.4
  it('4) el botón Restaurar permanece deshabilitado sin archivo seleccionado', async () => {
    await renderOnBackupTab();
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
  });

  // Requerimiento 21.8 y 21.9
  it('8) la confirmación aparece ANTES de restaurar, y 9) cancelar no dispara ninguna restauración', async () => {
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });

    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());

    const restoreButton = screen.getByText('Restaurar Backup').closest('button')!;
    expect(restoreButton).not.toBeDisabled();

    // Seleccionar el archivo, por sí solo, NUNCA debe abrir el modal de
    // confirmación ni disparar ningún toast.
    expect(screen.queryByText('Restaurar Copia de Seguridad')).not.toBeInTheDocument();
    expect(showToastMock).not.toHaveBeenCalled();
    expect(restorePreviewMock).not.toHaveBeenCalled();

    // El click dispara system.previewRestoreBackup (async) -- el modal
    // solo se abre si el BACKEND confirma que es válido.
    fireEvent.click(restoreButton);
    await waitFor(() => expect(restorePreviewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Restaurar Copia de Seguridad')).toBeInTheDocument());
    expect(screen.getByText('backup.json')).toBeInTheDocument();
    expect(screen.getByText('Productos y Variantes')).toBeInTheDocument(); // entidades incluidas
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    // Ningún dato fue tocado solo por abrir el modal.
    expect(restoreExecuteMock).not.toHaveBeenCalled();

    // Cancelar cierra el modal sin ejecutar ninguna restauración ni tocar
    // ningún dato -- restoreApi.restore() nunca se llamó.
    fireEvent.click(screen.getByText('Cancelar'));
    expect(screen.queryByText('Restaurar Copia de Seguridad')).not.toBeInTheDocument();
    expect(restoreExecuteMock).not.toHaveBeenCalled();
  });

  // Requerimiento 5 (JSON inválido) -- complementa las pruebas puras de
  // SettingsView.backup.test.ts con la ruta real de selección de archivo.
  it('5) un archivo JSON inválido se rechaza con un mensaje claro y el botón sigue deshabilitado', async () => {
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile('{ esto no es json ')] } });

    await waitFor(() => expect(screen.getByText(/no es un JSON válido/i)).toBeInTheDocument());
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
  });

  // Requerimiento 21.19
  it('19) el permiso administrativo se respeta: sin admin.configuracion, el botón Restaurar sigue deshabilitado aunque el archivo sea válido', async () => {
    hasPermissionMock = (perm) => perm !== 'admin.configuracion';
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });

    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());
    // El archivo es válido, pero sin el permiso el botón NO se habilita.
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
  });

  // FASE A -- botón real "Descargar Backup JSON": estado de carga,
  // resumen de éxito, y el caso "NO SE GENERÓ EL BACKUP".
  it('exportar muestra "Preparando copia de seguridad..." y luego el resumen de éxito con el total de registros', async () => {
    await renderOnBackupTab();
    const exportButton = screen.getByText('Descargar Backup JSON').closest('button')!;

    fireEvent.click(exportButton);
    expect(await screen.findByText('Preparando copia de seguridad...')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Backup generado correctamente')).toBeInTheDocument());
    expect(screen.getByText(/Total de registros: 0/)).toBeInTheDocument();
    expect(screen.queryByText('NO SE GENERÓ EL BACKUP')).not.toBeInTheDocument();
  });

  it('si falla una entidad crítica, muestra "NO SE GENERÓ EL BACKUP" y nunca el resumen de éxito', async () => {
    cashListMovementsMock.mockResolvedValueOnce({ success: false, message: 'PERMISSION_DENIED' });
    await renderOnBackupTab();
    const exportButton = screen.getByText('Descargar Backup JSON').closest('button')!;

    fireEvent.click(exportButton);

    await waitFor(() => expect(screen.getByText('NO SE GENERÓ EL BACKUP')).toBeInTheDocument());
    expect(screen.getByText(/Movimientos de Caja/)).toBeInTheDocument();
    expect(screen.queryByText('Backup generado correctamente')).not.toBeInTheDocument();
  });

  // FASE B -- flujo real de restauración: preview del backend, modal solo
  // si el backend lo aprueba, ejecución real, e invalidación del DataStore.
  it('si el backend rechaza el preview, el modal NUNCA se abre y se muestra el motivo', async () => {
    restorePreviewMock.mockResolvedValueOnce({ success: true, data: { valid: false, warnings: [], errors: ['Venta VEN-1 referencia un cliente inexistente'] } });
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });
    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Restaurar Backup').closest('button')!);

    await waitFor(() => expect(screen.getByText(/El backend rechazó este backup/)).toBeInTheDocument());
    expect(screen.getByText(/cliente inexistente/)).toBeInTheDocument();
    expect(screen.queryByText('Restaurar Copia de Seguridad')).not.toBeInTheDocument();
    expect(restoreExecuteMock).not.toHaveBeenCalled();
  });

  it('un backup de formato anterior (legacy) nunca habilita el botón de restaurar -- el backend siempre lo rechazaría', async () => {
    const legacyBackup = JSON.stringify({
      settings: { simboloMoneda: 'RD$' },
      products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 500, costo: 300 }],
      customers: [],
      sales: [],
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(legacyBackup)] } });

    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());
    expect(screen.getByText(/formato anterior y no puede restaurarse/)).toBeInTheDocument();
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
    expect(restorePreviewMock).not.toHaveBeenCalled();
  });

  it('restauración exitosa: invalida y refresca TODO el DataStore, y muestra la confirmación con el total restaurado', async () => {
    restoreExecuteMock.mockResolvedValueOnce({
      success: true,
      data: { totalRecords: 42, entities: [{ key: 'products', label: 'Productos', critical: true, count: 42 }], sequencesRecalculated: [] },
    });
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });
    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Restaurar Backup').closest('button')!);
    await waitFor(() => expect(screen.getByText('Restaurar Copia de Seguridad')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Confirmar Restauración'));

    await waitFor(() => expect(restoreExecuteMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clearDataStoreMock).toHaveBeenCalledTimes(1));
    expect(refreshProductsMock).toHaveBeenCalledWith({ force: true });
    expect(refreshSalesMock).toHaveBeenCalledWith({ force: true });
    expect(refreshCreditsMock).toHaveBeenCalledWith({ force: true });
    expect(refreshCreditNotesMock).toHaveBeenCalledWith({ force: true });
    expect(refreshExpensesMock).toHaveBeenCalledWith({ force: true });
    expect(refreshReturnsMock).toHaveBeenCalledWith({ force: true });

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Backup Restaurado Correctamente', expect.stringContaining('42'), 'exito'));
    await waitFor(() => expect(screen.queryByText('Restaurar Copia de Seguridad')).not.toBeInTheDocument());
  });

  it('restauración fallida por entidad crítica (rollback aplicado): muestra el error y NUNCA invalida el DataStore', async () => {
    restoreExecuteMock.mockResolvedValueOnce({ success: false, message: 'RESTORE_FAILED: fallo forzado. Se aplicó rollback -- ningún dato quedó modificado.' });
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });
    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Restaurar Backup').closest('button')!);
    await waitFor(() => expect(screen.getByText('Restaurar Copia de Seguridad')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Confirmar Restauración'));

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Restauración Fallida', expect.stringContaining('rollback'), 'error'));
    expect(clearDataStoreMock).not.toHaveBeenCalled();
    expect(refreshProductsMock).not.toHaveBeenCalled();
  });

  it('error crítico (rollback también falló): usa el título distintivo de intervención manual', async () => {
    restoreExecuteMock.mockResolvedValueOnce({ success: false, message: 'ERROR CRÍTICO: la restauración y su rollback requieren intervención manual.' });
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });
    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('Restaurar Backup').closest('button')!);
    await waitFor(() => expect(screen.getByText('Restaurar Copia de Seguridad')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Confirmar Restauración'));

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('ERROR CRÍTICO — Requiere Intervención Manual', expect.stringContaining('intervención manual'), 'error'));
    expect(clearDataStoreMock).not.toHaveBeenCalled();
  });

  /**
   * AUDITORÍA (Objetivo A/B/C) — un TIMEOUT_ERROR/NETWORK_ERROR del
   * transporte durante `system.restoreBackup` NUNCA debe mostrarse como
   * "Restauración Fallida" confirmada: Apps Script pudo seguir
   * ejecutándose después de que el navegador dejó de esperar. Estas
   * pruebas ejercitan SettingsView.tsx TAL COMO ES contra las mismas
   * formas de respuesta reales de `apiService`/`restoreApi` (`success:
   * false`, `errorCode: 'TIMEOUT_ERROR'|'NETWORK_ERROR'`).
   */
  async function openConfirmModalAndClickConfirm() {
    const input = await renderOnBackupTab();
    fireEvent.change(input, { target: { files: [jsonFile(validBackupJson())] } });
    await waitFor(() => expect(screen.getByText(/Backup reconocido/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Restaurar Backup').closest('button')!);
    await waitFor(() => expect(screen.getByText('Restaurar Copia de Seguridad')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Confirmar Restauración'));
  }

  it('TIMEOUT_ERROR durante restore: NUNCA dice "Restauración Fallida" -- muestra "Tiempo de Espera Agotado" y bloquea un nuevo intento', async () => {
    restoreExecuteMock.mockResolvedValueOnce({
      success: false,
      message: 'El servidor tardó demasiado en responder. Intente de nuevo en unos segundos.',
      errorCode: 'TIMEOUT_ERROR',
    });
    await openConfirmModalAndClickConfirm();

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        'Tiempo de Espera Agotado',
        expect.stringContaining('No vuelva a ejecutar la restauración todavía'),
        'error'
      )
    );
    expect(showToastMock).not.toHaveBeenCalledWith('Restauración Fallida', expect.anything(), expect.anything());
    expect(clearDataStoreMock).not.toHaveBeenCalled();

    // Objetivo C: bloquea un nuevo intento hasta verificar.
    expect(screen.getByText('Verificar Estado Real')).toBeInTheDocument();
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
  });

  it('NETWORK_ERROR durante restore: se trata como resultado potencialmente desconocido, nunca como fallo confirmado', async () => {
    restoreExecuteMock.mockResolvedValueOnce({
      success: false,
      message: 'No se pudo conectar con el servidor. Verifique su conexión a internet e intente de nuevo.',
      errorCode: 'NETWORK_ERROR',
    });
    await openConfirmModalAndClickConfirm();

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(
        'Conexión Perdida — Resultado Desconocido',
        expect.stringContaining('No vuelva a ejecutar la restauración todavía'),
        'error'
      )
    );
    expect(showToastMock).not.toHaveBeenCalledWith('Restauración Fallida', expect.anything(), expect.anything());
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
  });

  it('no hay reintento automático de restore tras TIMEOUT_ERROR/NETWORK_ERROR (restoreApi.restore se llama exactamente una vez)', async () => {
    restoreExecuteMock.mockResolvedValueOnce({ success: false, message: 'timeout', errorCode: 'TIMEOUT_ERROR' });
    await openConfirmModalAndClickConfirm();
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Tiempo de Espera Agotado', expect.anything(), 'error'));
    expect(restoreExecuteMock).toHaveBeenCalledTimes(1);
  });

  it('"Verificar Estado Real": si el backend aún no registró nada nuevo, informa honestamente que sigue sin confirmarse y mantiene el bloqueo', async () => {
    getLastBackupAuditEntryMock.mockResolvedValueOnce({ success: true, message: 'OK', data: { id: 'AUD-BASELINE', fecha: '2026-09-06 10:00:00', accion: 'CUSTOMER_UPDATED', resultado: 'EXITO', descripcion: '' } });
    restoreExecuteMock.mockResolvedValueOnce({ success: false, message: 'timeout', errorCode: 'TIMEOUT_ERROR' });
    await openConfirmModalAndClickConfirm();
    await waitFor(() => expect(screen.getByText('Verificar Estado Real')).toBeInTheDocument());

    // El backend todavía devuelve el MISMO registro (ningún registro nuevo de tipo Backup).
    getLastBackupAuditEntryMock.mockResolvedValueOnce({ success: true, message: 'OK', data: { id: 'AUD-BASELINE', fecha: '2026-09-06 10:00:00', accion: 'CUSTOMER_UPDATED', resultado: 'EXITO', descripcion: '' } });
    fireEvent.click(screen.getByText('Verificar Estado Real'));

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Aún Sin Confirmación', expect.stringContaining('Puede seguir procesándose'), 'error'));
    expect(screen.getByText('Verificar Estado Real')).toBeInTheDocument(); // el bloqueo se mantiene
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled();
    expect(clearDataStoreMock).not.toHaveBeenCalled();
  });

  it('"Verificar Estado Real": un registro NUEVO con resultado EXITO confirma la restauración, refresca el DataStore y desbloquea', async () => {
    getLastBackupAuditEntryMock.mockResolvedValueOnce({ success: true, message: 'OK', data: { id: 'AUD-BASELINE', fecha: '2026-09-06 10:00:00', accion: 'CUSTOMER_UPDATED', resultado: 'EXITO', descripcion: '' } });
    restoreExecuteMock.mockResolvedValueOnce({ success: false, message: 'timeout', errorCode: 'TIMEOUT_ERROR' });
    await openConfirmModalAndClickConfirm();
    await waitFor(() => expect(screen.getByText('Verificar Estado Real')).toBeInTheDocument());

    getLastBackupAuditEntryMock.mockResolvedValueOnce({
      success: true,
      message: 'OK',
      data: { id: 'AUD-NUEVO-EXITO', fecha: '2026-09-06 10:05:00', accion: 'RESTORE_BACKUP', resultado: 'EXITO', descripcion: 'Backup restaurado exitosamente (2 registros en 1 entidades).' },
    });
    fireEvent.click(screen.getByText('Verificar Estado Real'));

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Restauración Confirmada', expect.stringContaining('Backup restaurado exitosamente'), 'exito'));
    await waitFor(() => expect(clearDataStoreMock).toHaveBeenCalledTimes(1));
    expect(refreshProductsMock).toHaveBeenCalledWith({ force: true });
    expect(screen.queryByText('Verificar Estado Real')).not.toBeInTheDocument();
    expect(screen.getByText('Restaurar Backup').closest('button')).toBeDisabled(); // deshabilitado ahora por falta de archivo, no por el bloqueo
  });

  it('"Verificar Estado Real": un registro NUEVO con resultado FALLO confirma el fallo real y desbloquea para reintentar', async () => {
    getLastBackupAuditEntryMock.mockResolvedValueOnce({ success: true, message: 'OK', data: null });
    restoreExecuteMock.mockResolvedValueOnce({ success: false, message: 'timeout', errorCode: 'TIMEOUT_ERROR' });
    await openConfirmModalAndClickConfirm();
    await waitFor(() => expect(screen.getByText('Verificar Estado Real')).toBeInTheDocument());

    getLastBackupAuditEntryMock.mockResolvedValueOnce({
      success: true,
      message: 'OK',
      data: { id: 'AUD-NUEVO-FALLO', fecha: '2026-09-06 10:05:00', accion: 'RESTORE_BACKUP_FAILED', resultado: 'FALLO', descripcion: 'Restauración falló durante la escritura -- rollback completo aplicado.' },
    });
    fireEvent.click(screen.getByText('Verificar Estado Real'));

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith('Restauración Fallida (Confirmado por Auditoría)', expect.stringContaining('rollback completo aplicado'), 'error')
    );
    expect(clearDataStoreMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Verificar Estado Real')).not.toBeInTheDocument();
  });
});

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 *
 * "Conexión del Sistema" (pestaña "Google Sheets Sync"): la misma URL de
 * `storageService` (real aquí, sin mockear -- mismo criterio ya
 * establecido en este archivo), "Probar Conexión" (apiService mockeado
 * arriba) y "Cambiar Servidor".
 */
const CONFIGURED_URL = 'https://script.google.com/macros/s/SETTINGS_TEST/exec';

function renderOnSheetsTab() {
  render(<SettingsView />);
  fireEvent.click(screen.getByText('Google Sheets Sync'));
}

const reloadMock = vi.fn();
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...window.location, reload: reloadMock },
});

describe('SettingsView -- Conexión del Sistema', () => {
  beforeEach(() => {
    hasPermissionMock = () => true;
    logoutMock.mockClear();
    reloadMock.mockClear();
    (apiService.checkBackendConnection as any).mockReset();
    storageService.setGoogleAppsScriptUrl(CONFIGURED_URL);
  });
  afterEach(() => {
    cleanup();
    storageService.clearBusinessData();
    storageService.clearGoogleAppsScriptUrl();
    vi.restoreAllMocks();
  });

  it('muestra la URL actualmente configurada -- la misma que usa apiService/Login/DataStore', () => {
    renderOnSheetsTab();
    expect(screen.getByText(CONFIGURED_URL)).toBeInTheDocument();
  });

  it('"Probar Conexión" real: éxito muestra el estado conectado', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: true,
      message: 'Conexión establecida correctamente.',
      data: { service: 'ZIO CLOTHES POS', version: '1.0', status: 'ONLINE', timezone: 'America/Santo_Domingo', spreadsheetConnected: true },
    });
    renderOnSheetsTab();
    fireEvent.click(screen.getByRole('button', { name: /Probar Conexión/i }));

    await waitFor(() => expect(screen.getByText('Conexión establecida correctamente.')).toBeInTheDocument());
    expect(apiService.checkBackendConnection).toHaveBeenCalledWith(CONFIGURED_URL);
  });

  it('"Probar Conexión" real: fallo muestra el mensaje de error real, nunca "conectado"', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: false,
      message: 'El servidor está en línea, pero no tiene conexión con su hoja de cálculo (Spreadsheet).',
      errorCode: 'SPREADSHEET_DISCONNECTED',
    });
    renderOnSheetsTab();
    fireEvent.click(screen.getByRole('button', { name: /Probar Conexión/i }));

    await waitFor(() => expect(screen.getByText(/no tiene conexión con su hoja de cálculo/i)).toBeInTheDocument());
  });

  it('"Cambiar Servidor" muestra la confirmación antes de hacer nada', () => {
    renderOnSheetsTab();
    fireEvent.click(screen.getByRole('button', { name: /Cambiar Servidor/i }));

    expect(screen.getByText(/se cerrará la sesión y se cargará la información del nuevo negocio/i)).toBeInTheDocument();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it('"Cancelar" en la confirmación no cierra sesión ni borra nada', () => {
    renderOnSheetsTab();
    fireEvent.click(screen.getByRole('button', { name: /Cambiar Servidor/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));

    expect(screen.queryByText(/se cerrará la sesión/i)).not.toBeInTheDocument();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(storageService.getGoogleAppsScriptUrl()).toBe(CONFIGURED_URL);
  });

  it('"Continuar" en la confirmación: cierra sesión, purga datos de negocio, elimina la URL y recarga', () => {
    storageService.saveProducts([{ id: 'P1' } as any]);
    renderOnSheetsTab();
    fireEvent.click(screen.getByRole('button', { name: /Cambiar Servidor/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(storageService.getProducts()).toEqual([]);
    expect(storageService.getGoogleAppsScriptUrl()).toBe('');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('sin permiso admin.configuracion: no se ofrece "Cambiar Servidor" (misma pantalla ya protegida)', () => {
    hasPermissionMock = (perm) => perm !== 'admin.configuracion';
    renderOnSheetsTab();
    expect(screen.queryByRole('button', { name: /Cambiar Servidor/i })).not.toBeInTheDocument();
  });
});

/**
 * TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL -- pestaña "Roles y
 * Permisos" / "Acceso a Vistas". Ejercita SettingsView.tsx TAL COMO ES
 * contra rolesApi mockeado (mismo criterio que authApi/restoreApi
 * arriba) -- nunca contra Roles_Permisos real.
 */
describe('SettingsView -- Roles y Permisos (Acceso a Vistas)', () => {
  function renderOnRolesTab() {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Roles y Permisos' }));
  }

  beforeEach(() => {
    hasPermissionMock = () => true;
    rolesListMock.mockClear();
    rolesUpdateViewPermissionsMock.mockClear();
    rolesApplyViewDefaultsMock.mockClear();
    showToastMock.mockClear();
  });
  afterEach(() => cleanup());

  it('sin permiso admin.roles: la pestaña "Roles y Permisos" no aparece', () => {
    hasPermissionMock = (perm) => perm !== 'admin.roles';
    render(<SettingsView />);
    expect(screen.queryByRole('button', { name: 'Roles y Permisos' })).not.toBeInTheDocument();
  });

  it('lista los 4 roles editables reales, con ADMIN mostrado como no editable', async () => {
    renderOnRolesTab();
    await waitFor(() => expect(rolesListMock).toHaveBeenCalledTimes(1));

    ['GERENTE', 'SUPERVISOR', 'CAJERO', 'VENDEDOR'].forEach((rol) => expect(screen.getByText(rol)).toBeInTheDocument());
    // ADMIN nunca aparece como TARJETA editable (con su propio botón de
    // guardar) -- solo se menciona en el aviso informativo de solo lectura.
    // Exactamente 4 tarjetas editables (GERENTE/SUPERVISOR/CAJERO/VENDEDOR).
    expect(screen.getAllByRole('button', { name: /Sin Cambios|Guardar Cambios/i })).toHaveLength(4);
    // "ADMIN" vive en un <strong> separado del resto del texto del aviso
    // -- se busca solo la parte de texto plano que sí es un único nodo.
    expect(screen.getByText(/siempre tiene acceso completo/i)).toBeInTheDocument();
  });

  it('marcar/desmarcar un checkbox de vista habilita "Guardar Cambios"; guardarlo llama roles.updatePermissions con el arreglo completo deseado', async () => {
    renderOnRolesTab();
    await waitFor(() => expect(screen.getByText('CAJERO')).toBeInTheDocument());

    // Fixture: CAJERO empieza con solo 'vista.pos' marcado.
    const cajeroSection = screen.getByText('CAJERO').closest('div')!.parentElement!.parentElement!;
    const saveButtons = screen.getAllByRole('button', { name: /Sin Cambios|Guardar Cambios/i });
    expect(saveButtons.length).toBeGreaterThan(0);

    const customersCheckbox = within(cajeroSection).getByLabelText('Clientes') as HTMLInputElement;
    expect(customersCheckbox.checked).toBe(false);
    fireEvent.click(customersCheckbox);

    const saveButton = within(cajeroSection).getByRole('button', { name: 'Guardar Cambios' });
    fireEvent.click(saveButton);

    await waitFor(() => expect(rolesUpdateViewPermissionsMock).toHaveBeenCalledTimes(1));
    const [rolArg, vistasArg] = rolesUpdateViewPermissionsMock.mock.calls[0];
    assertArrayContainsSorted(rolArg, vistasArg);
  });

  function assertArrayContainsSorted(rolArg: string, vistasArg: string[]) {
    expect(rolArg).toBe('CAJERO');
    expect(vistasArg.sort()).toEqual(['vista.customers', 'vista.pos'].sort());
  }

  it('"Aplicar Valores Predeterminados" llama a la migración real y recarga la lista', async () => {
    renderOnRolesTab();
    await waitFor(() => expect(rolesListMock).toHaveBeenCalledTimes(1));

    rolesApplyViewDefaultsMock.mockResolvedValueOnce({
      success: true,
      data: { rolesUpdated: [{ rol: 'CAJERO', permisosAgregados: ['vista.cash'] }], rolesUnchanged: ['VENDEDOR'] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Aplicar Valores Predeterminados/i }));

    await waitFor(() => expect(rolesApplyViewDefaultsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rolesListMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Valores Predeterminados Aplicados', expect.stringContaining('1 rol'), 'exito'));
  });

  it('si el backend rechaza roles.list, muestra el error real y permite reintentar', async () => {
    rolesListMock.mockResolvedValueOnce({ success: false, message: 'FORBIDDEN: No tiene el permiso requerido admin.roles.' });
    renderOnRolesTab();

    await waitFor(() => expect(screen.getByText(/FORBIDDEN/)).toBeInTheDocument());
    rolesListMock.mockResolvedValueOnce({ success: true, data: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(rolesListMock).toHaveBeenCalledTimes(2));
  });
});
