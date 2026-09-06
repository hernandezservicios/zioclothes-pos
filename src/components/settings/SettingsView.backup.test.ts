import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateBackupFile,
  buildBackupPayload,
  BACKUP_VERSION,
  BACKUP_FORMAT,
  KARDEX_EXPORT_LIMIT,
  BackupApiDeps,
  BackupFile,
} from './SettingsView';

/**
 * FASE A — BACKUP PROFESIONAL: COMPLETAR Y ENDURECER EXPORT JSON.
 *
 * Pruebas de la lógica pura -- `buildBackupPayload`/`validateBackupFile`
 * son funciones exportadas, independientes de React; no se monta ningún
 * componente aquí. Todas las dependencias (`xApi`) son dobles de prueba
 * (`vi.fn()`) inyectados explícitamente vía `BackupApiDeps` -- ningún
 * test de este archivo llama jamás a un servicio real ni a Google Sheets
 * (Requerimiento 24 de la lista de tests obligatorios).
 */

function okResponse<T>(data: T) {
  return { success: true, message: 'OK', data };
}
function failResponse(message: string) {
  return { success: false, message };
}

function makeDeps(overrides: Partial<Record<keyof BackupApiDeps, unknown>> = {}): BackupApiDeps {
  const base: BackupApiDeps = {
    productsApi: {
      list: vi.fn().mockResolvedValue(okResponse([])),
      listAuxiliaries: vi.fn().mockResolvedValue(okResponse({ categories: [], sizes: [], colors: [] })),
    },
    customersApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    salesApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    creditsApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    creditNotesApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    returnsApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    expensesApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    purchasesApi: { list: vi.fn().mockResolvedValue(okResponse([])) },
    cashApi: {
      listSessions: vi.fn().mockResolvedValue(okResponse([])),
      listMovements: vi.fn().mockResolvedValue(okResponse([])),
    },
    inventoryApi: { listKardex: vi.fn().mockResolvedValue(okResponse([])) },
    settingsApi: { get: vi.fn().mockResolvedValue(okResponse({ simboloMoneda: 'RD$', nombreNegocio: 'ZIO CLOTHES' })) },
    authApi: { listUsers: vi.fn().mockResolvedValue(okResponse([])) },
  } as unknown as BackupApiDeps;
  return { ...base, ...(overrides as object) } as BackupApiDeps;
}

// Extrae el backup de un resultado exitoso, o lanza -- evita repetir el
// cast de narrowing en cada test (este proyecto no compila con
// `strict`/`strictNullChecks`, lo que impide que TS angoste
// `BuildBackupResult`/`BackupValidationResult` de forma fiable solo con
// `if (!result.ok)`).
async function buildOk(deps: BackupApiDeps): Promise<BackupFile> {
  const result = await buildBackupPayload(deps);
  if (!(result as { ok: boolean }).ok) {
    throw new Error('se esperaba un backup exitoso: ' + JSON.stringify((result as any).failures));
  }
  return (result as { ok: true; backup: BackupFile }).backup;
}

describe('buildBackupPayload -- export completo (Tests obligatorios 1-5, 18)', () => {
  it('1) exporta exitosamente cuando todas las entidades críticas responden', async () => {
    const result = await buildBackupPayload(makeDeps());
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it('2) todos los campos/entidades principales están presentes en "data"', async () => {
    const backup = await buildOk(makeDeps());
    [
      'settings', 'products', 'categories', 'sizes', 'colors', 'customers', 'sales',
      'credits', 'creditNotes', 'returns', 'purchases', 'expenses',
      'cashSessions', 'cashMovements', 'kardex',
    ].forEach((key) => expect(backup.data).toHaveProperty(key));
  });

  it('3) la metadata es correcta: backupVersion, format, createdAt, timezone, appVersion', async () => {
    const backup = await buildOk(makeDeps());
    expect(backup.backupVersion).toBe(BACKUP_VERSION);
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.format).toBe('zio-pos-backup');
    expect(typeof backup.createdAt).toBe('string');
    expect(Number.isNaN(new Date(backup.createdAt).getTime())).toBe(false);
    expect(backup.timezone).toBe('America/Santo_Domingo');
    expect(typeof backup.appVersion).toBe('string');
  });

  it('4) source = "live-backend"', async () => {
    const backup = await buildOk(makeDeps());
    expect(backup.source).toBe('live-backend');
  });

  it('5) complete = true solo cuando el backup se generó (todas las críticas presentes)', async () => {
    const backup = await buildOk(makeDeps());
    expect(backup.complete).toBe(true);
    // Toda entidad marcada crítica en el registro apareció con datos.
    const criticalKeys = backup.entities.filter((e) => e.critical).map((e) => e.key);
    expect(criticalKeys).toEqual(expect.arrayContaining(['products', 'categories', 'sizes', 'colors', 'customers', 'sales', 'credits', 'creditNotes', 'returns', 'purchases', 'expenses', 'cashSessions', 'cashMovements', 'kardex']));
  });

  it('18) la configuración (settings) se incluye, pedida en vivo vía settingsApi.get()', async () => {
    const getMock = vi.fn().mockResolvedValue(okResponse({ simboloMoneda: 'RD$', nombreNegocio: 'Mi Tienda' }));
    const backup = await buildOk(makeDeps({ settingsApi: { get: getMock } }));
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(backup.data.settings).toEqual({ simboloMoneda: 'RD$', nombreNegocio: 'Mi Tienda' });
  });
});

describe('buildBackupPayload -- REGLA CRÍTICA: entidad crítica fallida aborta el export (Test obligatorio 6)', () => {
  it('6) si falla una entidad crítica (ej. Ventas), el export falla completo y no arma ningún backup', async () => {
    const result = await buildBackupPayload(makeDeps({ salesApi: { list: vi.fn().mockResolvedValue(failResponse('PERMISSION_DENIED')) } }));
    expect((result as { ok: boolean }).ok).toBe(false);
    const failures = (result as { ok: false; failures: { key: string; label: string; critical: boolean }[] }).failures;
    expect(failures.some((f) => f.key === 'sales' && f.critical)).toBe(true);
  });

  it('6b) settings (crítico) fallido también aborta el export', async () => {
    const result = await buildBackupPayload(makeDeps({ settingsApi: { get: vi.fn().mockResolvedValue(failResponse('TIMEOUT')) } }));
    expect((result as { ok: boolean }).ok).toBe(false);
  });

  it('6c) categorías/tallas/colores (un solo endpoint) fallido marca las 3 como críticas fallidas', async () => {
    const result = await buildBackupPayload(
      makeDeps({ productsApi: { list: vi.fn().mockResolvedValue(okResponse([])), listAuxiliaries: vi.fn().mockResolvedValue(failResponse('ERROR')) } })
    );
    expect((result as { ok: boolean }).ok).toBe(false);
    const failures = (result as { ok: false; failures: { key: string }[] }).failures.map((f) => f.key);
    expect(failures).toEqual(expect.arrayContaining(['categories', 'sizes', 'colors']));
  });
});

describe('buildBackupPayload -- entidades OPCIONALES (Test obligatorio 7)', () => {
  it('7) si falla una entidad opcional (Usuarios), el export continúa, queda en "omitted", y complete sigue true', async () => {
    const backup = await buildOk(makeDeps({ authApi: { listUsers: vi.fn().mockResolvedValue(failResponse('FORBIDDEN')) } }));
    expect(backup.complete).toBe(true);
    expect(backup.omitted.some((o) => o.entity === 'Usuarios' && o.optional)).toBe(true);
    expect(backup.entities.some((e) => e.key === 'users')).toBe(false);
  });

  it('documenta siempre Proveedores/Secuencias/Roles_Permisos/Auditoría como omitidas por diseño (sin endpoint o fuera de alcance)', async () => {
    const backup = await buildOk(makeDeps());
    const entities = backup.omitted.map((o) => o.entity);
    expect(entities).toEqual(expect.arrayContaining(['Proveedores', 'Secuencias (Sequences)', 'Roles y Permisos personalizados', 'Auditoría (histórico de acciones)']));
    expect(backup.omitted.every((o) => o.optional)).toBe(true);
  });
});

describe('buildBackupPayload -- Caja: sessions y movements son entidades DISTINTAS (Test obligatorio 8, 16)', () => {
  it('8/16) cashMovements se incluye COMPLETO junto a cashSessions -- nunca se confunden ni se sustituyen entre sí', async () => {
    const sessions = [{ id: 'CAJA-000001', montoInicial: 1000 }];
    const movements = [
      { id: 'CMOV-000001', cajaSesionId: 'CAJA-000001', tipo: 'INGRESO', monto: 100 },
      { id: 'CMOV-000002', cajaSesionId: 'CAJA-000001', tipo: 'RETIRO', monto: 50 },
    ];
    const backup = await buildOk(
      makeDeps({
        cashApi: {
          listSessions: vi.fn().mockResolvedValue(okResponse(sessions)),
          listMovements: vi.fn().mockResolvedValue(okResponse(movements)),
        },
      })
    );
    expect(backup.data.cashSessions).toEqual(sessions);
    expect(backup.data.cashMovements).toEqual(movements);
    expect(backup.data.cashSessions).not.toEqual(backup.data.cashMovements);
  });
});

describe('buildBackupPayload -- Kardex: límite y detección de truncamiento (Test obligatorio 9, 17)', () => {
  it('17) Kardex se incluye con su conteo real', async () => {
    const kardex = [{ id: 'MOV-000001' }, { id: 'MOV-000002' }];
    const backup = await buildOk(makeDeps({ inventoryApi: { listKardex: vi.fn().mockResolvedValue(okResponse(kardex)) } }));
    expect(backup.data.kardex).toEqual(kardex);
    expect(backup.entities.find((e) => e.key === 'kardex')?.count).toBe(2);
  });

  it('9) si el Kardex devuelve exactamente el límite defensivo, se trata como POSIBLE TRUNCAMIENTO y el export falla en vez de arriesgar un backup incompleto', async () => {
    const hugeKardex = new Array(KARDEX_EXPORT_LIMIT).fill(0).map((_, i) => ({ id: `MOV-${i}` }));
    const listKardex = vi.fn().mockResolvedValue(okResponse(hugeKardex));
    const result = await buildBackupPayload(makeDeps({ inventoryApi: { listKardex } }));
    expect(listKardex).toHaveBeenCalledWith(KARDEX_EXPORT_LIMIT);
    expect((result as { ok: boolean }).ok).toBe(false);
    const failures = (result as { ok: false; failures: { key: string; reason: string }[] }).failures;
    expect(failures.some((f) => f.key === 'kardex' && /truncamiento/i.test(f.reason))).toBe(true);
  });
});

describe('buildBackupPayload -- entidades de negocio con relaciones (Test obligatorio 10-15, 19)', () => {
  it('10) ventas con múltiples pagos se preservan íntegramente (método, monto, referencia)', async () => {
    const venta = {
      id: 'VEN-000001',
      clienteId: 'CLI-000001',
      total: 150,
      fecha: '2026-01-01 10:00:00',
      pagos: [
        { metodo: 'EFECTIVO', monto: 100, referencia: undefined },
        { metodo: 'TARJETA', monto: 50, referencia: 'AUTH-123' },
      ],
    };
    const backup = await buildOk(makeDeps({ salesApi: { list: vi.fn().mockResolvedValue(okResponse([venta])) } }));
    const savedSale = (backup.data.sales as any[])[0];
    expect(savedSale.pagos).toHaveLength(2);
    expect(savedSale.pagos[0].metodo).toBe('EFECTIVO');
    expect(savedSale.pagos[1].referencia).toBe('AUTH-123');
  });

  it('11) créditos a favor/notas de crédito conservan sus aplicaciones anidadas', async () => {
    const nota = { id: 'CF-000001', tipo: 'NOTA_CREDITO', montoOriginal: 500, aplicaciones: [{ id: 'CFAPP-000001', ventaId: 'VEN-000005', monto: 200 }] };
    const backup = await buildOk(makeDeps({ creditNotesApi: { list: vi.fn().mockResolvedValue(okResponse([nota])) } }));
    expect((backup.data.creditNotes as any[])[0].aplicaciones).toEqual(nota.aplicaciones);
  });

  it('12) cuentas por cobrar conservan sus abonos anidados', async () => {
    const credito = { id: 'CRED-000001', clienteId: 'CLI-000001', montoOriginal: 1000, abonos: [{ id: 'ABO-000001', montoAbonado: 300 }] };
    const backup = await buildOk(makeDeps({ creditsApi: { list: vi.fn().mockResolvedValue(okResponse([credito])) } }));
    expect((backup.data.credits as any[])[0].abonos).toEqual(credito.abonos);
  });

  it('13) devoluciones se incluyen', async () => {
    const devolucion = { id: 'DEV-000001', ventaId: 'VEN-000001', montoDevuelto: 100 };
    const backup = await buildOk(makeDeps({ returnsApi: { list: vi.fn().mockResolvedValue(okResponse([devolucion])) } }));
    expect(backup.data.returns).toEqual([devolucion]);
  });

  it('14) compras se incluyen', async () => {
    const compra = { id: 'COMP-000001', proveedorId: 'PROV-1', total: 5000 };
    const backup = await buildOk(makeDeps({ purchasesApi: { list: vi.fn().mockResolvedValue(okResponse([compra])) } }));
    expect(backup.data.purchases).toEqual([compra]);
  });

  it('15) gastos se incluyen', async () => {
    const gasto = { id: 'GAS-000001', monto: 250, categoria: 'SERVICIOS' };
    const backup = await buildOk(makeDeps({ expensesApi: { list: vi.fn().mockResolvedValue(okResponse([gasto])) } }));
    expect(backup.data.expenses).toEqual([gasto]);
  });

  it('19) los IDs/foreign keys se conservan intactos -- nunca se convierten a nombres únicamente', async () => {
    const producto = { id: 'PROD-000001', categoriaId: 'CAT-000001', proveedorId: 'PROV-000001', variantes: [{ id: 'VAR-000001', productoId: 'PROD-000001' }] };
    const venta = { id: 'VEN-000001', clienteId: 'CLI-000001', cuentaCobrarId: 'CRED-000001' };
    const backup = await buildOk(
      makeDeps({
        productsApi: { list: vi.fn().mockResolvedValue(okResponse([producto])), listAuxiliaries: vi.fn().mockResolvedValue(okResponse({ categories: [], sizes: [], colors: [] })) },
        salesApi: { list: vi.fn().mockResolvedValue(okResponse([venta])) },
      })
    );
    const savedProduct = (backup.data.products as any[])[0];
    expect(savedProduct.categoriaId).toBe('CAT-000001');
    expect(savedProduct.proveedorId).toBe('PROV-000001');
    expect(savedProduct.variantes[0].productoId).toBe('PROD-000001');
    expect((backup.data.sales as any[])[0].clienteId).toBe('CLI-000001');
    expect((backup.data.sales as any[])[0].cuentaCobrarId).toBe('CRED-000001');
  });
});

describe('buildBackupPayload -- pagos: normalización defensiva sin destruir información (sección PAGOS)', () => {
  it('normaliza un monto de pago que llega como string, preservando el valor numérico exacto', async () => {
    const venta = { id: 'VEN-000001', pagos: [{ metodo: 'EFECTIVO', monto: '250' as unknown as number }] };
    const backup = await buildOk(makeDeps({ salesApi: { list: vi.fn().mockResolvedValue(okResponse([venta])) } }));
    const savedPago = (backup.data.sales as any[])[0].pagos[0];
    expect(savedPago.monto).toBe(250);
    expect(typeof savedPago.monto).toBe('number');
    expect(backup.warnings.some((w) => /normal/i.test(w))).toBe(true);
  });

  it('NUNCA destruye un monto de pago que no se puede normalizar -- conserva el valor original', async () => {
    const venta = { id: 'VEN-000001', pagos: [{ metodo: 'EFECTIVO', monto: 'no-es-un-numero' as unknown as number }] };
    const backup = await buildOk(makeDeps({ salesApi: { list: vi.fn().mockResolvedValue(okResponse([venta])) } }));
    const savedPago = (backup.data.sales as any[])[0].pagos[0];
    expect(savedPago.monto).toBe('no-es-un-numero'); // conservado, no reemplazado por 0
  });
});

describe('buildBackupPayload -- seguridad y aislamiento (Test obligatorio 20, 24, 25)', () => {
  it('20) el backup nunca incluye secretos/tokens/API keys/contraseñas', async () => {
    const backup = await buildOk(makeDeps());
    const json = JSON.stringify(backup).toLowerCase();
    ['password', 'contraseña', 'token', 'apikey', 'api_key', 'secret', 'private_key'].forEach((needle) => {
      expect(json).not.toContain(needle);
    });
  });

  it('24) ningún test de este archivo llama a un servicio real -- todas las dependencias son vi.fn() inyectadas', async () => {
    const deps = makeDeps();
    await buildOk(deps);
    expect(vi.isMockFunction(deps.productsApi.list)).toBe(true);
    expect(vi.isMockFunction(deps.salesApi.list)).toBe(true);
    expect(vi.isMockFunction(deps.settingsApi.get)).toBe(true);
  });

  it('25) buildBackupPayload nunca lee ni escribe localStorage', async () => {
    localStorage.clear();
    const before = JSON.stringify(Object.keys(localStorage));
    await buildOk(makeDeps());
    const after = JSON.stringify(Object.keys(localStorage));
    expect(after).toBe(before);
    expect(localStorage.length).toBe(0);
  });
});

describe('validateBackupFile -- formato nuevo v2, legacy, y endurecimiento de completitud', () => {
  beforeEach(() => localStorage.clear());

  it('rechaza JSON inválido sin modificar nada', () => {
    const result = validateBackupFile('{ esto no es json ');
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/JSON válido/i);
  });

  it('rechaza un archivo que no tiene ninguna forma reconocible de backup', () => {
    const result = validateBackupFile(JSON.stringify({ foo: 'bar', unrelated: 123 }));
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/no es un backup válido/i);
  });

  it('21) un backup recién producido por buildBackupPayload SIEMPRE pasa validateBackupFile (round-trip export/restore)', async () => {
    const backup = await buildOk(makeDeps());
    const result = validateBackupFile(JSON.stringify(backup));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.summary.format).toBe('v2');
      expect(result.summary.complete).toBe(true);
    }
  });

  it('reconoce el formato v2 nuevo y arma un resumen correcto, incluyendo complete/warnings', () => {
    const raw = JSON.stringify({
      backupVersion: 2,
      format: 'zio-pos-backup',
      createdAt: '2026-09-06T10:00:00.000Z',
      timezone: 'America/Santo_Domingo',
      appVersion: '2.0.0-PROD',
      source: 'live-backend',
      complete: true,
      entities: [],
      data: {
        settings: { simboloMoneda: 'RD$' },
        products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 500, costo: 300, variantes: [{ stock: 10 }] }],
        categories: [], sizes: [], colors: [], customers: [{ id: 'CLI-000001' }], sales: [], credits: [], creditNotes: [],
        returns: [], purchases: [], expenses: [], cashSessions: [], cashMovements: [], kardex: [],
      },
      omitted: [],
      warnings: [],
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.summary.format).toBe('v2');
      expect(result.summary.complete).toBe(true);
      expect(result.summary.backupVersion).toBe(2);
    }
  });

  it('22) un backup que se declara complete:true pero le falta una entidad crítica se RECHAZA (nunca se presenta como completo)', () => {
    const raw = JSON.stringify({
      backupVersion: 2,
      format: 'zio-pos-backup',
      createdAt: '2026-01-01T00:00:00.000Z',
      complete: true,
      data: {
        // Falta "sales", "credits", etc. -- críticas ausentes.
        products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 1, costo: 1 }],
      },
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/completo.*falta|falta.*crítica/i);
  });

  it('23) reconoce el formato v1 de la fase anterior y el formato legacy original -- SIEMPRE como "legacy", nunca como completo nuevo', () => {
    const v1Raw = JSON.stringify({
      backupVersion: 1,
      createdAt: '2026-06-01T00:00:00.000Z',
      appVersion: '2.0.0-PROD',
      source: 'ZIO CLOTHES POS - Web App',
      data: { products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 500, costo: 300 }] },
      omitted: [],
    });
    const v1Result = validateBackupFile(v1Raw);
    expect(v1Result.valid).toBe(true);
    if (v1Result.valid) {
      expect(v1Result.summary.format).toBe('legacy');
      expect(v1Result.summary.complete).toBeFalsy();
    }

    // Forma EXACTA que producía storageService.exportFullDatabaseJSON()
    // en la fase original -- debe seguir reconociéndose.
    const flatRaw = JSON.stringify({
      settings: { simboloMoneda: 'RD$' },
      products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 500, costo: 300 }],
      customers: [],
      sales: [],
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    const flatResult = validateBackupFile(flatRaw);
    expect(flatResult.valid).toBe(true);
    if (flatResult.valid) {
      expect(flatResult.summary.format).toBe('legacy');
      expect(flatResult.summary.complete).toBeFalsy();
      expect(flatResult.summary.createdAt).toBe('2025-01-01T00:00:00.000Z');
    }
  });

  it('rechaza un backup incompatible donde una entidad esperada NO es un arreglo', () => {
    const raw = JSON.stringify({ backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z', data: { products: { esto: 'debería ser un arreglo' } } });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/products/);
  });

  it('rechaza un registro con id vacío/inválido', () => {
    const raw = JSON.stringify({ backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z', data: { customers: [{ id: '', nombre: 'Sin ID' }] } });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(false);
  });

  it('rechaza un producto con precio/costo no numérico', () => {
    const raw = JSON.stringify({
      backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z',
      data: { products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 'no-es-un-numero', costo: 300 }] },
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/precio\/costo/);
  });

  it('rechaza una venta con fecha no interpretable', () => {
    const raw = JSON.stringify({
      backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z',
      data: { sales: [{ id: 'VEN-000001', total: 100, fecha: 'no-es-una-fecha-real-xyz' }] },
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toMatch(/fecha/);
  });

  it('rechaza una venta con un pago sin método válido', () => {
    const raw = JSON.stringify({
      backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z',
      data: { sales: [{ id: 'VEN-000001', total: 100, fecha: '2026-01-01', pagos: [{ metodo: '', monto: 100 }] }] },
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(false);
  });

  it('acepta valores numéricos que llegan como string (mismo riesgo de Google Sheets ya documentado en el resto del proyecto)', () => {
    const raw = JSON.stringify({
      backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z',
      data: { products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: '500', costo: '300' }] },
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(true);
  });

  it('no falla ante claves desconocidas fuera del schema -- las ignora sin restaurarlas', () => {
    const raw = JSON.stringify({
      backupVersion: 2, format: 'zio-pos-backup', createdAt: '2026-01-01T00:00:00.000Z',
      data: { products: [{ id: 'PROD-000001', nombre: 'Camisa', precio: 1, costo: 1 }], claveArbitrariaNoReconocida: { hackear: true } },
    });
    const result = validateBackupFile(raw);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.summary.entities.find((e) => e.key === 'claveArbitrariaNoReconocida')).toBeUndefined();
    }
  });
});
