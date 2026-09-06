import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { storageService } from '../../services/storageService';
import { restoreApi } from '../../services/restoreApi';
import { authApi } from '../../services/authApi';
import { settingsApi } from '../../services/settingsApi';
import { productsApi } from '../../services/productsApi';
import { customersApi } from '../../services/customersApi';
import { salesApi } from '../../services/salesApi';
import { creditsApi } from '../../services/creditsApi';
import { creditNotesApi } from '../../services/creditNotesApi';
import { returnsApi } from '../../services/returnsApi';
import { expensesApi } from '../../services/expensesApi';
import { purchasesApi } from '../../services/purchasesApi';
import { cashApi } from '../../services/cashApi';
import { inventoryApi } from '../../services/inventoryApi';
import { ApiResponse } from '../../services/apiService';
import { SystemSettings, UserRole, User } from '../../types';
import { formatDateTime, BUSINESS_TIMEZONE } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import {
  Settings as SettingsIcon,
  Store,
  Users,
  Shield,
  FileSpreadsheet,
  Database,
  History,
  Save,
  RefreshCw,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  ExternalLink,
  FileJson,
  FileWarning,
  ShieldAlert,
  X,
} from 'lucide-react';

/**
 * FASE — COPIA DE SEGURIDAD: ELIMINAR "LIMPIAR CACHÉ LOCAL" Y AGREGAR
 * "RESTAURAR BACKUP JSON" (fase anterior) + FASE A — BACKUP PROFESIONAL:
 * COMPLETAR Y ENDURECER EXPORT JSON (esta fase).
 *
 * ============================================================
 * AUDITORÍA COMPLETA DE ENTIDADES (FASE A -- las 24 hojas reales de
 * SeedSetup.gs, cruzadas contra cada controlador y cada Api service)
 * ============================================================
 * Ver la tabla completa en el reporte de esta fase. Resumen de hallazgos
 * que cambiaron el diseño:
 *   - `Proveedores`, `Secuencias`, `Roles_Permisos`: hojas reales sin
 *     NINGÚN endpoint de backend (list/get) -- verificado con grep
 *     exhaustivo sobre los 15 archivos .gs pedidos. No se inventó ningún
 *     endpoint nuevo para estas (fuera del alcance explícito de esta
 *     fase, que solo autorizó un endpoint nuevo para Caja_Movimientos).
 *     Quedan documentadas en `omitted` como opcionales/no disponibles.
 *   - `Caja_Movimientos`: sin endpoint de lectura en bloque (solo existía
 *     el detalle de la sesión ABIERTA, vía cash.getActiveSession). Se
 *     agregó `cash.listMovements` (CashController.gs, READ-ONLY, exige
 *     'caja.ver') exclusivamente para esto -- ver Parte 4 del reporte.
 *   - `Auditoria`/`Usuarios`: Auditoría se excluye a propósito (es un
 *     log, no datos para reconstruir el estado funcional del POS).
 *     Usuarios SÍ tiene endpoint (`auth.listUsers`) pero exige el
 *     permiso 'admin.usuarios', distinto del que gatea esta pantalla
 *     ('admin.configuracion') -- se intenta igual, pero se clasifica
 *     OPCIONAL (nunca bloquea `complete`) para no acoplar dos permisos
 *     distintos a la definición de "backup completo".
 *   - Todas las demás entidades de la lista crítica pedida SÍ tienen
 *     endpoint + wrapper reales, verificados línea por línea (no
 *     asumidos): products.list (incluye variantes anidadas),
 *     products.listAuxiliaries (categorías/tallas/colores),
 *     customers.list, sales.list (incluye pagos anidados, sin normalizar
 *     -- ver `normalizeSalesPagos` más abajo), credits.list (incluye
 *     abonos anidados), creditNotes.list (incluye aplicaciones
 *     anidadas), returns.list (decodifica items_json), purchases.list
 *     (decodifica items_json), expenses.list, cash.listSessions,
 *     inventory.kardex, system.getSettings.
 *
 * ============================================================
 * REGLA CRÍTICA: un backup incompleto NUNCA se descarga como si fuera
 * completo (FASE A)
 * ============================================================
 * A diferencia de la fase anterior (que sustituía una entidad fallida
 * por `[]` y seguía adelante), ahora las entidades se clasifican en
 * CRÍTICAS y OPCIONALES (`ENTITY_DEFS` más abajo). Si falla CUALQUIER
 * entidad crítica, `buildBackupPayload` devuelve `{ok:false, failures}`
 * y NO se genera ningún archivo -- nunca se sustituye silenciosamente
 * por `[]` una entidad crítica. Solo las entidades OPCIONALES pueden
 * faltar y aun así producir un backup (`complete:true`), quedando
 * documentadas en `omitted`.
 *
 * ============================================================
 * ALCANCE DECIDIDO (restauración = solo frontend, sin cambios en esta
 * fase)
 * ============================================================
 * Restaurar significa escribir de vuelta en Google Sheets. Salvo el
 * único endpoint READ-ONLY de Caja_Movimientos (autorizado explícitamente
 * para poder EXPORTAR esa entidad), no se tocó nada más del backend, no
 * se creó ningún endpoint de escritura/restauración, y el botón
 * "Confirmar Restauración" sigue informando honestamente que el backend
 * de restauración no existe todavía -- nunca modifica ningún dato.
 */

export const BACKUP_VERSION = 2;
export const BACKUP_FORMAT = 'zio-pos-backup';

/**
 * Registro único de entidades -- fuente de verdad compartida por
 * `buildBackupPayload` (qué pedir) y `validateBackupFile` (qué exigir).
 * `critical: true` == está en la lista mínima obligatoria de la
 * auditoría (Segunda Parte); `critical: false` == opcional, puede faltar
 * sin impedir `complete: true`.
 */
interface EntityDef {
  key: string;
  label: string;
  critical: boolean;
}

const ENTITY_DEFS: EntityDef[] = [
  { key: 'products', label: 'Productos y Variantes', critical: true },
  { key: 'categories', label: 'Categorías', critical: true },
  { key: 'sizes', label: 'Tallas', critical: true },
  { key: 'colors', label: 'Colores', critical: true },
  { key: 'customers', label: 'Clientes', critical: true },
  { key: 'sales', label: 'Ventas y Pagos', critical: true },
  { key: 'credits', label: 'Cuentas por Cobrar y Abonos', critical: true },
  { key: 'creditNotes', label: 'Créditos a Favor / Notas de Crédito y Aplicaciones', critical: true },
  { key: 'returns', label: 'Devoluciones', critical: true },
  { key: 'purchases', label: 'Compras', critical: true },
  { key: 'expenses', label: 'Gastos', critical: true },
  { key: 'cashSessions', label: 'Sesiones de Caja', critical: true },
  { key: 'cashMovements', label: 'Movimientos de Caja', critical: true },
  { key: 'kardex', label: 'Movimientos de Inventario (Kardex)', critical: true },
  { key: 'users', label: 'Usuarios', critical: false },
];

export interface BackupOmission {
  entity: string;
  reason: string;
  optional: boolean;
}

export interface BackupEntityMeta {
  key: string;
  label: string;
  critical: boolean;
  count: number;
}

export interface BackupFile {
  backupVersion: number;
  format: string;
  createdAt: string;
  timezone: string;
  appVersion?: string;
  source: string;
  complete: boolean;
  entities: BackupEntityMeta[];
  totalRecords: number;
  data: Record<string, unknown>;
  omitted: BackupOmission[];
  warnings: string[];
}

export interface BackupFailure {
  key: string;
  label: string;
  critical: boolean;
  reason: string;
}

export type BuildBackupResult = { ok: true; backup: BackupFile } | { ok: false; failures: BackupFailure[] };

/**
 * Dependencias inyectadas (en vez de importar los singletons directo
 * dentro de la función) para que `buildBackupPayload` se pueda probar
 * con dobles de prueba sin necesidad de `vi.mock` por módulo -- mismo
 * objeto `xApi` real se pasa en producción, un stub se pasa en pruebas.
 */
export interface BackupApiDeps {
  productsApi: { list: typeof productsApi.list; listAuxiliaries: typeof productsApi.listAuxiliaries };
  customersApi: { list: typeof customersApi.list };
  salesApi: { list: typeof salesApi.list };
  creditsApi: { list: typeof creditsApi.list };
  creditNotesApi: { list: typeof creditNotesApi.list };
  returnsApi: { list: typeof returnsApi.list };
  expensesApi: { list: typeof expensesApi.list };
  purchasesApi: { list: typeof purchasesApi.list };
  cashApi: { listSessions: typeof cashApi.listSessions; listMovements: typeof cashApi.listMovements };
  inventoryApi: { listKardex: typeof inventoryApi.listKardex };
  settingsApi: { get: typeof settingsApi.get };
  authApi: { listUsers: typeof authApi.listUsers };
}

// El backend NO pagina Kardex -- handleGetKardex siempre lee la hoja
// COMPLETA en memoria y solo recorta la RESPUESTA con `slice(0, limit)`
// (verificado leyendo InventoryController.gs). Pedir un límite muy por
// encima de cualquier Kardex real equivale en la práctica a "sin
// límite". Si la respuesta llega a tocar EXACTAMENTE este techo, se
// trata como señal de posible truncamiento -- la única detectable sin un
// endpoint de conteo dedicado, que no existe hoy.
export const KARDEX_EXPORT_LIMIT = 5_000_000;

/**
 * Arma el backup pidiendo cada entidad EN VIVO al backend real (nunca al
 * mirror de localStorage). REGLA CRÍTICA (Fase A): si falla CUALQUIER
 * entidad marcada `critical` en `ENTITY_DEFS`, se aborta -- devuelve
 * `{ok:false, failures}` y NUNCA arma un `BackupFile` parcial. Solo las
 * entidades opcionales pueden faltar y aun así producir
 * `{ok:true, backup:{complete:true, ...}}`, documentadas en `omitted`.
 */
export async function buildBackupPayload(deps: BackupApiDeps): Promise<BuildBackupResult> {
  const data: Record<string, unknown> = {};
  const entities: BackupEntityMeta[] = [];
  const omitted: BackupOmission[] = [];
  const failures: BackupFailure[] = [];
  const warnings: string[] = [];

  // --- Configuración (objeto único, crítico) ---
  const settingsRes = await deps.settingsApi.get();
  if (settingsRes.success && settingsRes.data) {
    data.settings = settingsRes.data;
  } else {
    failures.push({ key: 'settings', label: 'Configuración', critical: true, reason: settingsRes.message || 'El backend no devolvió la configuración.' });
  }

  // --- Categorías/Tallas/Colores (un solo endpoint, los 3 críticos) ---
  const auxRes = await deps.productsApi.listAuxiliaries();
  if (auxRes.success && auxRes.data) {
    const categories = auxRes.data.categories ?? [];
    const sizes = auxRes.data.sizes ?? [];
    const colors = auxRes.data.colors ?? [];
    data.categories = categories;
    data.sizes = sizes;
    data.colors = colors;
    entities.push({ key: 'categories', label: 'Categorías', critical: true, count: categories.length });
    entities.push({ key: 'sizes', label: 'Tallas', critical: true, count: sizes.length });
    entities.push({ key: 'colors', label: 'Colores', critical: true, count: colors.length });
  } else {
    const reason = auxRes.message || 'El backend no devolvió los catálogos auxiliares.';
    failures.push({ key: 'categories', label: 'Categorías', critical: true, reason });
    failures.push({ key: 'sizes', label: 'Tallas', critical: true, reason });
    failures.push({ key: 'colors', label: 'Colores', critical: true, reason });
  }

  // --- Entidades de arreglo simple (una llamada cada una) ---
  const simpleFetchers: { key: string; label: string; critical: boolean; fn: () => Promise<ApiResponse<unknown[]>> }[] = [
    { key: 'products', label: 'Productos y Variantes', critical: true, fn: () => deps.productsApi.list() },
    { key: 'customers', label: 'Clientes', critical: true, fn: () => deps.customersApi.list() },
    { key: 'sales', label: 'Ventas y Pagos', critical: true, fn: () => deps.salesApi.list() },
    { key: 'credits', label: 'Cuentas por Cobrar y Abonos', critical: true, fn: () => deps.creditsApi.list() },
    { key: 'creditNotes', label: 'Créditos a Favor / Notas de Crédito y Aplicaciones', critical: true, fn: () => deps.creditNotesApi.list() },
    { key: 'returns', label: 'Devoluciones', critical: true, fn: () => deps.returnsApi.list() },
    { key: 'purchases', label: 'Compras', critical: true, fn: () => deps.purchasesApi.list() },
    { key: 'expenses', label: 'Gastos', critical: true, fn: () => deps.expensesApi.list() },
    { key: 'cashSessions', label: 'Sesiones de Caja', critical: true, fn: () => deps.cashApi.listSessions() },
    { key: 'cashMovements', label: 'Movimientos de Caja', critical: true, fn: () => deps.cashApi.listMovements() },
    { key: 'users', label: 'Usuarios', critical: false, fn: () => deps.authApi.listUsers() },
  ];

  const results = await Promise.allSettled(simpleFetchers.map((f) => f.fn()));
  results.forEach((res, i) => {
    const { key, label, critical } = simpleFetchers[i];
    if (res.status === 'fulfilled' && res.value.success) {
      const arr = Array.isArray(res.value.data) ? res.value.data : [];
      data[key] = arr;
      entities.push({ key, label, critical, count: arr.length });
    } else {
      const reason =
        res.status === 'fulfilled' ? res.value.message || 'El backend no devolvió esta entidad.' : 'Fallo de red o error inesperado al pedir esta entidad.';
      if (critical) {
        failures.push({ key, label, critical, reason });
      } else {
        data[key] = [];
        omitted.push({ entity: label, reason, optional: true });
      }
    }
  });

  // --- Kardex (crítico; límite defensivo + detección de posible truncamiento) ---
  const kardexRes = await deps.inventoryApi.listKardex(KARDEX_EXPORT_LIMIT);
  if (kardexRes.success) {
    const arr = Array.isArray(kardexRes.data) ? kardexRes.data : [];
    if (arr.length >= KARDEX_EXPORT_LIMIT) {
      failures.push({
        key: 'kardex',
        label: 'Movimientos de Inventario (Kardex)',
        critical: true,
        reason: `Se alcanzó el límite defensivo de ${KARDEX_EXPORT_LIMIT.toLocaleString()} registros -- posible truncamiento. El backend no soporta paginación real (handleGetKardex siempre lee toda la hoja y solo recorta la respuesta); no se genera un backup que podría estar incompleto.`,
      });
    } else {
      data.kardex = arr;
      entities.push({ key: 'kardex', label: 'Movimientos de Inventario (Kardex)', critical: true, count: arr.length });
    }
  } else {
    failures.push({ key: 'kardex', label: 'Movimientos de Inventario (Kardex)', critical: true, reason: kardexRes.message || 'El backend no devolvió el Kardex.' });
  }

  // Entidades deliberadamente NO intentadas -- hojas reales sin ningún
  // endpoint de backend (verificado con grep exhaustivo), o fuera de
  // alcance por diseño. Nunca se "fingen" como incluidas.
  omitted.push({
    entity: 'Proveedores',
    reason: 'No existe ningún endpoint de backend (list/get) para Proveedores hoy. Los IDs de proveedor dentro de products/purchases se preservan intactos.',
    optional: true,
  });
  omitted.push({
    entity: 'Secuencias (Sequences)',
    reason: 'No existe ningún endpoint de backend para leer Secuencias hoy. Es un prerequisito de FASE B (evitar colisión de IDs al restaurar), no necesario para el estado funcional actual del POS.',
    optional: true,
  });
  omitted.push({
    entity: 'Roles y Permisos personalizados',
    reason: 'No existe ningún endpoint de backend para leer Roles_Permisos hoy. El frontend usa un catálogo de permisos por defecto como respaldo si esto falta.',
    optional: true,
  });
  omitted.push({
    entity: 'Auditoría (histórico de acciones)',
    reason: 'Excluida deliberadamente: es un registro/log de lo ocurrido, no datos necesarios para reconstruir el estado funcional del POS.',
    optional: true,
  });

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  // --- Normalización defensiva de pagos (sección "PAGOS" de la auditoría) ---
  // NUNCA se descarta un valor: si `monto` no es number pero SÍ normaliza
  // a un número finito, se corrige el tipo (se documenta en `warnings`);
  // si no normaliza a nada válido, se conserva el valor ORIGINAL intacto
  // -- jamás se sustituye por 0 ni se elimina el campo.
  const salesArr = Array.isArray(data.sales) ? (data.sales as Record<string, unknown>[]) : [];
  let normalizedPagos = 0;
  salesArr.forEach((sale) => {
    const pagos = Array.isArray(sale.pagos) ? (sale.pagos as Record<string, unknown>[]) : [];
    pagos.forEach((p) => {
      if (p && typeof p.monto !== 'number') {
        const n = Number(p.monto);
        if (Number.isFinite(n)) {
          p.monto = n;
          normalizedPagos++;
        }
      }
    });
  });
  if (normalizedPagos > 0) {
    warnings.push(
      `Se normalizó el tipo de ${normalizedPagos} valor(es) de pagos.monto que llegaron del backend como texto en vez de número -- el valor numérico se conservó intacto, solo se corrigió el tipo (mismo riesgo de Google Sheets ya documentado en otras partes del sistema).`
    );
  }

  const totalRecords = entities.reduce((acc, e) => acc + e.count, 0);

  return {
    ok: true,
    backup: {
      backupVersion: BACKUP_VERSION,
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      timezone: BUSINESS_TIMEZONE,
      appVersion: '2.0.0-PROD',
      source: 'live-backend',
      complete: true,
      entities,
      totalRecords,
      data,
      omitted,
      warnings,
    },
  };
}

export interface BackupEntitySummary {
  key: string;
  label: string;
  critical: boolean;
  count: number;
}

export interface BackupSummary {
  format: 'v2' | 'legacy';
  backupVersion?: number;
  createdAt?: string;
  appVersion?: string;
  source?: string;
  complete?: boolean;
  entities: BackupEntitySummary[];
  totalRecords: number;
  omitted?: BackupOmission[];
  warnings?: string[];
}

export type BackupValidationResult =
  | { valid: true; summary: BackupSummary; data: Record<string, unknown> }
  | { valid: false; error: string };

function isNormalizableNumber(value: unknown): boolean {
  return value === undefined || value === null || value === '' || Number.isFinite(Number(value));
}

function isParseableDate(value: unknown): boolean {
  return value === undefined || value === null || value === '' || !Number.isNaN(new Date(String(value)).getTime());
}

/**
 * Validación real del archivo ANTES de intentar restaurar nada (Quinta
 * Parte de la auditoría original + endurecimiento de FASE A). Nunca
 * modifica ningún dato -- solo lee e inspecciona el texto recibido.
 *
 * Reconoce DOS familias de formato:
 *  - 'v2' (BACKUP_FORMAT === 'zio-pos-backup', `backupVersion` numérico,
 *    `complete` booleano, `data` objeto): el formato endurecido de esta
 *    fase, con garantía real de completitud cuando `complete === true`.
 *  - 'legacy': CUALQUIER backup anterior reconocible -- tanto el v1 de la
 *    fase pasada (`{backupVersion:1, data:{...}}`, sin `complete`) como
 *    el formato original sin versión (`{...entidades planas...,
 *    timestamp}`). Ninguno de los dos tiene garantía de completitud
 *    verificable, así que SIEMPRE se identifican como 'legacy' -- nunca
 *    se presentan como si fueran un backup completo nuevo.
 */
export function validateBackupFile(rawText: string): BackupValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { valid: false, error: 'El archivo seleccionado no es un JSON válido.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema.' };
  }
  const obj = parsed as Record<string, unknown>;

  let format: 'v2' | 'legacy';
  let dataObj: Record<string, unknown>;
  let backupVersion: number | undefined;
  let createdAt: string | undefined;
  let appVersion: string | undefined;
  let source: string | undefined;
  let complete: boolean | undefined;
  let omitted: BackupOmission[] | undefined;
  let warnings: string[] | undefined;

  const hasV2Shape =
    obj.format === BACKUP_FORMAT && typeof obj.backupVersion === 'number' && obj.data !== null && typeof obj.data === 'object' && !Array.isArray(obj.data);
  const hasV1Shape = typeof obj.backupVersion === 'number' && obj.data !== null && typeof obj.data === 'object' && !Array.isArray(obj.data);
  const hasLegacyFlatShape =
    typeof obj.timestamp === 'string' &&
    (Array.isArray(obj.products) ||
      Array.isArray(obj.customers) ||
      Array.isArray(obj.sales) ||
      (obj.settings !== undefined && typeof obj.settings === 'object' && !Array.isArray(obj.settings)));

  if (hasV2Shape) {
    format = 'v2';
    backupVersion = obj.backupVersion as number;
    createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : undefined;
    appVersion = typeof obj.appVersion === 'string' ? obj.appVersion : undefined;
    source = typeof obj.source === 'string' ? obj.source : undefined;
    complete = typeof obj.complete === 'boolean' ? obj.complete : false;
    dataObj = obj.data as Record<string, unknown>;
    omitted = Array.isArray(obj.omitted) ? (obj.omitted as BackupOmission[]) : undefined;
    warnings = Array.isArray(obj.warnings) ? (obj.warnings as string[]) : undefined;
  } else if (hasV1Shape) {
    // v1 de la fase anterior -- reconocido, pero SIEMPRE como legacy: no
    // tenía forma de garantizar completitud.
    format = 'legacy';
    backupVersion = obj.backupVersion as number;
    createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : undefined;
    appVersion = typeof obj.appVersion === 'string' ? obj.appVersion : undefined;
    source = typeof obj.source === 'string' ? obj.source : undefined;
    dataObj = obj.data as Record<string, unknown>;
    omitted = Array.isArray(obj.omitted) ? (obj.omitted as BackupOmission[]) : undefined;
  } else if (hasLegacyFlatShape) {
    format = 'legacy';
    createdAt = obj.timestamp as string;
    dataObj = obj;
  } else {
    return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema.' };
  }

  if (dataObj.settings !== undefined && (typeof dataObj.settings !== 'object' || dataObj.settings === null || Array.isArray(dataObj.settings))) {
    return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: "settings" debe ser un objeto.' };
  }

  const entities: BackupEntitySummary[] = [];
  let totalRecords = 0;
  const presentKeys = new Set<string>();

  for (const { key, label, critical } of ENTITY_DEFS) {
    const value = dataObj[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      return { valid: false, error: `El archivo seleccionado no es un backup válido del sistema: "${key}" debería ser una lista.` };
    }

    for (const item of value) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        return {
          valid: false,
          error: `El archivo seleccionado no es un backup válido del sistema: un registro de "${key}" no es un objeto válido.`,
        };
      }
      const rec = item as Record<string, unknown>;
      if ('id' in rec && (typeof rec.id !== 'string' || rec.id.trim() === '')) {
        return {
          valid: false,
          error: `El archivo seleccionado no es un backup válido del sistema: un registro de "${key}" tiene un id inválido.`,
        };
      }

      // Chequeo representativo (no exhaustivo campo por campo) sobre los
      // datos financieros/fecha más críticos de cada entidad.
      if (key === 'products') {
        if (!isNormalizableNumber(rec.precio) || !isNormalizableNumber(rec.costo)) {
          return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: precio/costo de un producto no es numérico.' };
        }
        if (Array.isArray(rec.variantes)) {
          for (const v of rec.variantes) {
            if (!v || typeof v !== 'object' || !isNormalizableNumber((v as Record<string, unknown>).stock)) {
              return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: el stock de una variante no es numérico.' };
            }
          }
        }
      }
      if (key === 'sales') {
        if (!isNormalizableNumber(rec.total)) {
          return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: el total de una venta no es numérico.' };
        }
        if (!isParseableDate(rec.fecha)) {
          return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: la fecha de una venta no se puede interpretar.' };
        }
        if (Array.isArray(rec.pagos)) {
          for (const p of rec.pagos) {
            const pago = p as Record<string, unknown>;
            if (!pago || typeof pago.metodo !== 'string' || !pago.metodo.trim()) {
              return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: un pago no tiene método válido.' };
            }
            if (!isNormalizableNumber(pago.monto)) {
              return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: el monto de un pago no es numérico.' };
            }
          }
        }
      }
      if (key === 'cashSessions' || key === 'cashMovements') {
        if (!isNormalizableNumber(rec.monto ?? rec.montoInicial ?? undefined)) {
          return { valid: false, error: `El archivo seleccionado no es un backup válido del sistema: un registro de "${key}" tiene un monto no numérico.` };
        }
      }
    }

    presentKeys.add(key);
    entities.push({ key, label, critical, count: value.length });
    totalRecords += value.length;
  }

  if (entities.length === 0) {
    return { valid: false, error: 'El archivo seleccionado no es un backup válido del sistema: no contiene ninguna entidad reconocida.' };
  }

  // Un backup 'v2' que se declara `complete: true` debe traer TODAS las
  // entidades críticas -- si falta alguna, es estructuralmente
  // imposible que sea completo (dato corrupto/editado a mano) y se
  // rechaza en vez de mostrarlo como si lo fuera.
  if (format === 'v2' && complete) {
    const missingCritical = ENTITY_DEFS.filter((e) => e.critical && !presentKeys.has(e.key));
    if (missingCritical.length > 0) {
      return {
        valid: false,
        error: `El archivo dice ser un backup completo pero le falta la entidad crítica "${missingCritical[0].label}". No se puede confiar en este backup.`,
      };
    }
  }

  return {
    valid: true,
    data: dataObj,
    summary: { format, backupVersion, createdAt, appVersion, source, complete: format === 'v2' ? complete : false, entities, totalRecords, omitted, warnings },
  };
}

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, currentUser, hasPermission, refreshCatalog } = useAuth();
  const { showToast } = useToast();
  // FASE B (RESTAURACIÓN REAL): tras una restauración exitosa, el
  // frontend NUNCA debe seguir mostrando datos viejos en memoria --
  // `clear()` vacía el DataStore central y resetea sus TTL, y los
  // refreshX({force:true}) vuelven a pedir todo al backend real (la
  // MISMA arquitectura de caché que ya usan Dashboard/POS/Clientes/etc.,
  // sin inventar un mecanismo nuevo).
  const {
    clear: clearDataStore,
    refreshProducts,
    refreshCustomers,
    refreshSales,
    refreshCredits,
    refreshCreditNotes,
    refreshExpenses,
    refreshReturns,
  } = useDataStore();

  const [activeTab, setActiveTab] = useState<'GENERAL' | 'USUARIOS' | 'SHEETS' | 'BACKUP' | 'AUDITORIA'>('GENERAL');

  // FASE 3.7H: configuración empresarial real vía settingsApi.get()
  // (SettingsController.handleGetSettings -> hoja Configuracion real).
  // `settings` de AuthContext (poblado en login/bootstrap) se usa solo
  // como valor inicial para no mostrar campos vacíos mientras se confirma
  // la lectura fresca -- pero SIEMPRE se sobreescribe con la respuesta
  // real al abrir esta pantalla, tal como exige esta fase ("Al abrir
  // SettingsView: obtener configuración desde backend").
  const [formSettings, setFormSettings] = useState<SystemSettings>({ ...settings });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // FASE 3 (logo de empresa -- reutiliza Google Drive de productos): mismo
  // patrón que ProductFormModal con fotos de productos. `formSettings.logoUrl`
  // hace doble función -- Base64 de previsualización mientras se elige un
  // archivo nuevo, o la URL real ya guardada; `selectedLogoFile` solo se
  // activa cuando el usuario elige/cambia un logo EN ESTA sesión del
  // formulario, y es lo único que decide si hace falta subir un logo nuevo
  // a Drive antes de guardar la configuración.
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const fetchBusinessSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsLoadError(null);
    const res = await settingsApi.get();
    if (res.success) {
      setFormSettings((prev) => ({ ...prev, ...res.data }));
    } else {
      setSettingsLoadError(res.message || 'No se pudo obtener la configuración real desde el backend.');
    }
    setSettingsLoading(false);
  }, []);

  useEffect(() => {
    fetchBusinessSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FASE 3.6D (Parte 3): la URL del Web App ya NO vive en formSettings/
  // zio_settings -- vive en zio_infrastructure_config, separada de la
  // configuración comercial, para que limpiar el caché de negocio nunca
  // la destruya.
  const [googleAppsScriptUrl, setGoogleAppsScriptUrlState] = useState<string>(() =>
    storageService.getGoogleAppsScriptUrl()
  );

  // FASE 3.7G: usuarios administrativos reales vía auth.listUsers/
  // auth.saveUser (AuthController.gs). Antes storageService.getUsers()/
  // saveUsers() eran 100% locales -- un "usuario" creado aquí nunca podía
  // iniciar sesión de verdad (AuthContext ya validaba solo contra el
  // backend real desde antes de esta fase), y la lista mostrada no tenía
  // relación alguna con los usuarios reales de Sheets. El backend NUNCA
  // devuelve contraseñas ni hashes -- este estado tampoco los guarda
  // jamás.
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    const res = await authApi.listUsers();
    if (res.success) {
      setUsers(res.data || []);
    } else {
      setUsersError(res.message || 'No se pudo obtener la lista real de usuarios.');
    }
    setUsersLoading(false);
  }, []);

  useEffect(() => {
    if (hasPermission('admin.usuarios')) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNombre, setNewNombre] = useState('');
  const [newApellido, setNewApellido] = useState('');
  const [newCorreo, setNewCorreo] = useState('');
  const [newTelefono, setNewTelefono] = useState('');
  const [newRol, setNewRol] = useState<UserRole>('CAJERO');
  const [newEstado, setNewEstado] = useState<'ACTIVO' | 'INACTIVO' | 'BLOQUEADO'>('ACTIVO');
  const [savingUser, setSavingUser] = useState(false);

  // Únicamente los 5 roles reales definidos en SeedSetup.gs -- el
  // selector anterior ofrecía 'ENCARGADO', un rol que nunca existió en el
  // backend (asignado solo mediante un cast de TypeScript que ocultaba el
  // problema en tiempo de compilación).
  const REAL_ROLES: { value: UserRole; label: string }[] = [
    { value: 'CAJERO', label: 'Cajero / POS (Ventas, Clientes, Abonos)' },
    { value: 'VENDEDOR', label: 'Asesor de Ventas (Catálogo, Ventas)' },
    { value: 'SUPERVISOR', label: 'Supervisor de Turno (Caja, Inventario, Descuentos)' },
    { value: 'GERENTE', label: 'Gerente de Tienda (Reportes, Anulaciones)' },
    { value: 'ADMIN', label: 'Administrador General (Acceso Total)' },
  ];

  const handleOpenCreateUser = () => {
    setEditingUserId(null);
    setNewUsername('');
    setNewPassword('');
    setNewNombre('');
    setNewApellido('');
    setNewCorreo('');
    setNewTelefono('');
    setNewRol('CAJERO');
    setNewEstado('ACTIVO');
    setUserModalOpen(true);
  };

  const handleOpenEditUser = (u: User) => {
    setEditingUserId(u.id);
    setNewUsername(u.usuario);
    setNewPassword('');
    setNewNombre(u.nombre);
    setNewApellido(u.apellido || '');
    setNewCorreo(u.correo || '');
    setNewTelefono(u.telefono || '');
    setNewRol(u.rol);
    setNewEstado((u.estado as 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO') || 'ACTIVO');
    setUserModalOpen(true);
  };

  // Audit Logs
  const auditLogs = storageService.getAuditLogs() || [];

  // Syncing state
  const [syncing, setSyncing] = useState(false);

  // Save General Settings
  // FASE 3.7H: ahora async y real -- espera la confirmación del backend
  // (vía AuthContext.updateSettings -> settingsApi.save ->
  // system.updateSettings) antes de mostrar éxito. Sin actualización
  // optimista: si el backend rechaza, el toast de error ya lo muestra
  // updateSettings y esta función simplemente no hace nada más.
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSettings) return; // previene doble submit
    const tax = Number(formSettings.impuestoPorcentaje);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      showToast('Impuesto Inválido', 'El ITBIS debe ser un porcentaje válido entre 0% y 100%.', 'error');
      return;
    }

    setSavingSettings(true);

    // FASE 3 (logo de empresa -- reutiliza Drive de productos): si el
    // usuario seleccionó un logo nuevo en esta sesión del formulario, se
    // sube primero a Drive (mismo flujo que ProductFormModal con fotos de
    // productos) y se sustituye el Base64 temporal por la URL real ANTES
    // de guardar la configuración. Nunca se envía Base64 a
    // system.updateSettings. Si el usuario no tocó el logo,
    // `formSettings.logoUrl` ya contiene lo correcto tal cual (la URL real
    // existente, o '' si nunca hubo/se eliminó) y se envía directamente.
    let finalLogoUrl = (formSettings.logoUrl || '').trim();

    if (selectedLogoFile) {
      setUploadingLogo(true);
      const uploadRes = await settingsApi.uploadLogo(finalLogoUrl);
      setUploadingLogo(false);

      if (!uploadRes.success || !uploadRes.data) {
        showToast('Error al Subir Logo', uploadRes.message || 'No se pudo subir el logo a Google Drive.', 'error');
        setSavingSettings(false);
        return; // el formulario permanece abierto para reintentar -- no se guarda con Base64 ni con una URL inventada.
      }

      finalLogoUrl = uploadRes.data.imageUrl;
    }

    const success = await updateSettings({
      ...formSettings,
      impuestoPorcentaje: tax,
      logoUrl: finalLogoUrl,
    });

    if (success) {
      setSelectedLogoFile(null);
      setFormSettings((prev) => ({ ...prev, logoUrl: finalLogoUrl }));
    }
    setSavingSettings(false);
  };

  // FASE 3 (logo de empresa): mismo mecanismo de selección/previsualización
  // ya usado en ProductFormModal para fotos de productos.
  const handleLogoFileSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('Formato Inválido', 'El archivo seleccionado no es una imagen válida (formatos soportados: JPG, PNG, WEBP).', 'error');
      return;
    }

    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE_BYTES) {
      showToast('Archivo Demasiado Grande', `El logo supera el tamaño máximo permitido de 10MB (${(file.size / (1024 * 1024)).toFixed(1)}MB).`, 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setFormSettings((prev) => ({ ...prev, logoUrl: event.target!.result as string }));
        setSelectedLogoFile(file);
      }
    };
    reader.onerror = () => {
      showToast('Error de Carga', 'No se pudo leer la imagen seleccionada.', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleLogoFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLogoFileSelected(file);
    e.target.value = '';
  };

  // "Usar logo del sistema": deja el campo vacío -- se confirma recién al
  // pulsar "Guardar Cambios" (igual que el resto de este formulario), y es
  // entonces cuando el backend intenta limpiar el logo anterior en Drive.
  const handleRemoveLogo = () => {
    setFormSettings((prev) => ({ ...prev, logoUrl: '' }));
    setSelectedLogoFile(null);
    if (logoFileInputRef.current) logoFileInputRef.current.value = '';
  };

  // FASE 3.7G: crea/edita un usuario real vía auth.saveUser
  // (AuthController.handleSaveUser). Nunca se construye ni se guarda
  // localmente un usuario -- solo se refleja lo que el backend confirmó,
  // recargando la lista real. La contraseña nunca se persiste en
  // storageService/localStorage; solo vive en el estado del formulario
  // mientras el modal está abierto y se descarta al cerrarlo.
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingUser) return; // previene doble submit
    if (!newUsername.trim() || !newNombre.trim()) {
      showToast('Campos Requeridos', 'Usuario y nombre son obligatorios.', 'error');
      return;
    }
    // Contraseña obligatoria solo al crear -- al editar, un campo vacío
    // significa "no cambiar la contraseña actual" (semántica ya
    // soportada explícitamente por el backend real).
    if (!editingUserId && !newPassword.trim()) {
      showToast('Contraseña Requerida', 'Debe asignar una contraseña inicial para el nuevo usuario.', 'error');
      return;
    }

    setSavingUser(true);

    const res = await authApi.saveUser({
      id: editingUserId || undefined,
      usuario: newUsername.trim().toLowerCase(),
      nombre: newNombre.trim(),
      apellido: newApellido.trim() || undefined,
      correo: newCorreo.trim() || undefined,
      telefono: newTelefono.trim() || undefined,
      rol: newRol,
      estado: newEstado,
      password: newPassword.trim() || undefined,
    });

    setSavingUser(false);

    if (res.success) {
      showToast(editingUserId ? 'Usuario Actualizado' : 'Usuario Creado', res.message, 'exito');
      setUserModalOpen(false);
      await fetchUsers();
    } else {
      showToast('Error', res.message, 'error');
      // No se agrega ni modifica ningún usuario en la lista mostrada --
      // sigue siendo la última confirmada por el backend.
    }
  };

  // FASE 3.6 (corrección de bloqueante — Parte 9): "FULL_SYNC" no existe
  // como acción en Main.gs (verificado en el backend real) -- este botón
  // llamaba a un endpoint inventado que siempre fallaría. Se repunta al
  // mecanismo real de sincronización que ya existe (system.getBootstrapData,
  // vía refreshCatalog en AuthContext), en vez de inventar un endpoint.
  const handleTriggerSync = async () => {
    setSyncing(true);
    const ok = await refreshCatalog();
    setSyncing(false);

    if (ok) {
      showToast('Sincronización Exitosa', 'Catálogo (productos, clientes, configuración) actualizado desde Google Sheets.', 'exito');
    } else {
      showToast(
        'Aviso de Sincronización',
        'No se pudo sincronizar. Verifique la URL del Web App y que haya una sesión iniciada.',
        'advertencia'
      );
    }
  };

  // Export JSON Database -- FASE A (BACKUP PROFESIONAL): pide cada
  // entidad EN VIVO al backend real (buildBackupPayload), nunca al
  // mirror de localStorage. Si falla una entidad CRÍTICA, NO se descarga
  // ningún archivo -- se muestra el error real (Regla Crítica de esta
  // fase, ver comentario al inicio del archivo).
  const [exportingBackup, setExportingBackup] = useState(false);
  const [exportFailures, setExportFailures] = useState<BackupFailure[] | null>(null);
  const [lastExportSummary, setLastExportSummary] = useState<{
    createdAt: string;
    totalRecords: number;
    entities: BackupEntityMeta[];
    warnings: string[];
  } | null>(null);

  const handleExportBackup = async () => {
    setExportingBackup(true);
    setExportFailures(null);
    setLastExportSummary(null);
    try {
      const result = await buildBackupPayload({
        productsApi,
        customersApi,
        salesApi,
        creditsApi,
        creditNotesApi,
        returnsApi,
        expensesApi,
        purchasesApi,
        cashApi,
        inventoryApi,
        settingsApi,
        authApi,
      });

      if (!result.ok) {
        // REGLA CRÍTICA: ninguna entidad crítica fallida se descarga como
        // si el backup estuviera completo. No se genera ningún archivo.
        const failures = (result as { ok: false; failures: BackupFailure[] }).failures;
        setExportFailures(failures);
        showToast(
          'NO SE GENERÓ EL BACKUP',
          `Falló ${failures.length === 1 ? 'una entidad crítica' : `${failures.length} entidades críticas`} (${failures
            .map((f) => f.label)
            .join(', ')}). Ningún dato fue modificado -- corrija el problema antes de intentar de nuevo.`,
          'error'
        );
        return;
      }

      const { backup } = result;
      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ZIO_CLOTHES_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setLastExportSummary({ createdAt: backup.createdAt, totalRecords: backup.totalRecords, entities: backup.entities, warnings: backup.warnings });

      if (backup.omitted.length > 0 || backup.warnings.length > 0) {
        showToast(
          'Backup Generado Correctamente',
          `${backup.totalRecords} registro(s) en ${backup.entities.length} entidad(es). ${backup.omitted.length} entidad(es) opcional(es) no disponible(s) -- vea el campo "omitted" del archivo.`,
          'advertencia'
        );
      } else {
        showToast('Backup Generado Correctamente', `${backup.totalRecords} registro(s) en ${backup.entities.length} entidad(es), desde el backend real.`, 'exito');
      }
    } catch (e) {
      setExportFailures([{ key: 'unknown', label: 'Proceso de exportación', critical: true, reason: e instanceof Error ? e.message : 'Error inesperado.' }]);
      showToast('NO SE GENERÓ EL BACKUP', 'Ocurrió un error inesperado. Ningún dato fue modificado.', 'error');
    } finally {
      setExportingBackup(false);
    }
  };

  // ============================================================
  // RESTAURAR BACKUP JSON (FASE B — restauración real)
  // ============================================================
  // Flujo: seleccionar archivo -> parsear -> validateBackupFile()
  // (rápido, local, NUNCA sustituye la validación del backend) -> click
  // "Restaurar Backup" -> system.previewRestoreBackup (el backend trata
  // el JSON como NO CONFIABLE y re-valida todo, incluidas las
  // relaciones) -> si es válido, recién ahí se abre el modal de
  // confirmación -> "Confirmar Restauración" -> system.restoreBackup
  // (backup preventivo + lock + transacción real) -> éxito: se invalida
  // TODO el DataStore y se refresca desde el backend real.
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreParsedBackup, setRestoreParsedBackup] = useState<BackupFile | null>(null);
  const [restoreValidation, setRestoreValidation] = useState<BackupValidationResult | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [previewingRestore, setPreviewingRestore] = useState(false);
  const [serverPreviewErrors, setServerPreviewErrors] = useState<string[] | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string>('');
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const handleRestoreFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      setRestoreFile(null);
      setRestoreValidation(null);
      setRestoreParsedBackup(null);
      return;
    }

    setRestoreFile(file);
    setRestoreValidation(null);
    setRestoreParsedBackup(null);
    setServerPreviewErrors(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setRestoreValidation(validateBackupFile(text));
      try {
        setRestoreParsedBackup(JSON.parse(text));
      } catch {
        // validateBackupFile ya reporta "JSON inválido" -- no hay backup
        // parseable que guardar para un eventual envío al backend.
        setRestoreParsedBackup(null);
      }
    };
    reader.onerror = () => {
      setRestoreValidation({ valid: false, error: 'No se pudo leer el archivo seleccionado.' });
    };
    reader.readAsText(file);
  };

  const handleClearRestoreFile = () => {
    setRestoreFile(null);
    setRestoreValidation(null);
    setRestoreParsedBackup(null);
    setServerPreviewErrors(null);
    if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
  };

  // El backend real solo puede restaurar el formato endurecido de esta
  // fase (v2, complete:true) -- un backup 'legacy' SIEMPRE sería
  // rechazado por RestoreController.gs, así que se evita el viaje de red
  // y se explica el motivo de inmediato.
  const restoreIsRestorableFormat =
    !!restoreValidation && restoreValidation.valid && restoreValidation.summary.format === 'v2' && restoreValidation.summary.complete === true;

  // Requerimiento (FASE B, "CONFIRMACIÓN UI"): el resumen que ve el
  // usuario en el modal debe venir de la validación REAL del backend
  // (system.previewRestoreBackup), no solo de la validación local del
  // frontend -- "la validación del frontend NUNCA sustituye la del
  // backend".
  const handleClickRestoreButton = async () => {
    if (!restoreParsedBackup) return;
    setServerPreviewErrors(null);
    setPreviewingRestore(true);
    try {
      const res = await restoreApi.preview(restoreParsedBackup);
      if (!res.success || !res.data || !res.data.valid) {
        const errors = (res.data && res.data.errors) || (res.message ? [res.message] : ['El backend rechazó el backup.']);
        setServerPreviewErrors(errors);
        showToast('Backup Rechazado por el Backend', 'El servidor encontró problemas que el frontend no detectó. Ningún dato fue modificado.', 'error');
        return;
      }
      setRestoreConfirmOpen(true);
    } catch (e) {
      setServerPreviewErrors([e instanceof Error ? e.message : 'Error inesperado al validar contra el backend.']);
    } finally {
      setPreviewingRestore(false);
    }
  };

  // FASE B: restauración REAL. "Restaurando datos..." es el único estado
  // de progreso posible dentro de una sola llamada síncrona a doPost --
  // Apps Script no soporta streaming/progreso real, así que no se
  // inventa uno (ver auditoría al inicio del archivo). Protegido contra
  // doble ejecución con `restoring` (deshabilita el botón mientras dura).
  const handleConfirmRestore = async () => {
    if (!restoreParsedBackup || restoring) return;
    setRestoring(true);
    setRestoreProgress('Restaurando datos...');
    try {
      const res = await restoreApi.restore(restoreParsedBackup);

      if (!res.success || !res.data) {
        setRestoreConfirmOpen(false);
        const critical = /ERROR CRÍTICO/i.test(res.message || '');
        showToast(
          critical ? 'ERROR CRÍTICO — Requiere Intervención Manual' : 'Restauración Fallida',
          res.message || 'La restauración no pudo completarse.',
          'error'
        );
        return;
      }

      setRestoreProgress('Verificando integridad...');
      const { totalRecords, entities } = res.data;

      setRestoreProgress('Finalizando...');
      // Requerimiento (INVALIDACIÓN DATASTORE): nunca confiar en el
      // estado React viejo -- se limpia el DataStore central y se vuelve
      // a pedir TODO al backend real, la misma arquitectura que ya usan
      // Dashboard/POS/Clientes/Ventas.
      clearDataStore();
      await Promise.all([
        refreshProducts({ force: true }),
        refreshCustomers({ force: true }),
        refreshSales({ force: true }),
        refreshCredits({ force: true }),
        refreshCreditNotes({ force: true }),
        refreshExpenses({ force: true }),
        refreshReturns({ force: true }),
      ]);

      setRestoreProgress('Restauración completada.');
      setRestoreConfirmOpen(false);
      handleClearRestoreFile();
      showToast('Backup Restaurado Correctamente', `${totalRecords} registro(s) en ${entities.length} entidad(es). El Dashboard, POS y demás pantallas ya reflejan el estado restaurado.`, 'exito');
    } catch (e) {
      setRestoreConfirmOpen(false);
      showToast('Restauración Fallida', e instanceof Error ? e.message : 'Error inesperado durante la restauración.', 'error');
    } finally {
      setRestoring(false);
      setRestoreProgress('');
    }
  };

  return (
    <div id="settings-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Panel de Control & Mantenimiento
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Configuración del Sistema
          </h1>
        </div>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-white border border-[#E4DDD2] rounded-2xl">
        <button
          type="button"
          onClick={() => setActiveTab('GENERAL')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'GENERAL'
              ? 'bg-[#2F2A25] text-white shadow-xs'
              : 'text-[#756E65] hover:bg-[#FAF8F4]'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>Negocio & Ticket</span>
        </button>

        {/* FASE 3.7G: corregido -- el backend real exige 'admin.usuarios'
            (AuthController.handleListUsers/handleSaveUser vía
            Security.requirePermission), no 'usuarios.gestionar', que
            nunca existió en ningún rol real del seed (ver SeedSetup.gs).
            Antes de este fix, esta pestaña era inalcanzable para
            cualquier rol que no sea ADMIN (que ya tiene un bypass total
            en AuthContext.hasPermission independiente del código exacto
            del permiso). */}
        {hasPermission('admin.usuarios') && (
          <button
            type="button"
            onClick={() => setActiveTab('USUARIOS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'USUARIOS'
                ? 'bg-[#2F2A25] text-white shadow-xs'
                : 'text-[#756E65] hover:bg-[#FAF8F4]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Usuarios & Roles</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('SHEETS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'SHEETS'
              ? 'bg-[#2F2A25] text-white shadow-xs'
              : 'text-[#756E65] hover:bg-[#FAF8F4]'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          <span>Google Sheets Sync</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('BACKUP')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'BACKUP'
              ? 'bg-[#2F2A25] text-white shadow-xs'
              : 'text-[#756E65] hover:bg-[#FAF8F4]'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Copia de Seguridad</span>
        </button>

        {hasPermission('auditoria.ver') && (
          <button
            type="button"
            onClick={() => setActiveTab('AUDITORIA')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'AUDITORIA'
                ? 'bg-[#2F2A25] text-white shadow-xs'
                : 'text-[#756E65] hover:bg-[#FAF8F4]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Auditoría</span>
          </button>
        )}
      </div>

      {/* TAB 1: GENERAL SETTINGS */}
      {activeTab === 'GENERAL' && (
        <div className="space-y-4">
          {settingsLoadError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>No se pudo cargar la configuración real desde el backend: {settingsLoadError}</span>
              </div>
              <button type="button" onClick={() => fetchBusinessSettings()} className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0">
                Reintentar
              </button>
            </div>
          )}

          <form onSubmit={handleSaveGeneral} noValidate className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-serif font-bold text-base text-[#2F2A25]">Identidad de la Boutique & Facturación</h3>
                <p className="text-xs text-[#756E65]">Datos que se imprimen en recibos térmicos y estados de cuenta.</p>
              </div>
              <button
                type="button"
                onClick={() => fetchBusinessSettings()}
                disabled={settingsLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] disabled:opacity-50"
                title="Volver a consultar el backend real"
              >
                <RefreshCw className={`w-4 h-4 text-[#756E65] ${settingsLoading ? 'animate-spin' : ''}`} />
                <span>{settingsLoading ? 'Cargando...' : 'Actualizar'}</span>
              </button>
            </div>

            <fieldset disabled={settingsLoading || savingSettings} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs disabled:opacity-60">
              {/* FASE 3 (logo de empresa -- Google Drive, misma carpeta
                  administrada que las fotos de productos): reemplazo
                  seguro con limpieza automática del logo anterior tras un
                  guardado exitoso (ver SettingsController.handleUpdateSettings). */}
              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Logo de la Empresa:</label>
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg"
                  onChange={handleLogoFileInputChange}
                  className="hidden"
                  id="company-logo-input"
                />
                <div className="flex items-center gap-4 p-3 rounded-2xl border border-[#E4DDD2] bg-[#FAF8F4]">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden border border-[#E4DDD2] bg-white flex items-center justify-center shrink-0">
                    {formSettings.logoUrl ? (
                      <img
                        src={toDisplayableImageUrl(formSettings.logoUrl)}
                        alt="Logo actual de la empresa"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="font-serif font-bold text-xl text-[#2F2A25]">Z</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => logoFileInputRef.current?.click()}
                        disabled={uploadingLogo}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-[#2F2A25] font-bold text-[11px] hover:bg-[#F6F1E8] transition disabled:opacity-50"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#756E65]" />
                        <span>{formSettings.logoUrl ? 'Cambiar Logo' : 'Seleccionar Imagen'}</span>
                      </button>
                      {formSettings.logoUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          disabled={uploadingLogo}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-rose-200 text-rose-700 font-bold text-[11px] hover:bg-rose-50 transition disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Usar Logo del Sistema</span>
                        </button>
                      )}
                      {uploadingLogo && <span className="text-[11px] text-[#756E65] font-semibold">Subiendo logo a Drive...</span>}
                    </div>
                    <span className="text-[10px] text-[#756E65]">
                      JPG, PNG o WEBP (máx. 10MB). Si no se configura, se muestra el emblema predeterminado del sistema. Los cambios se aplican al pulsar "Guardar Cambios".
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Nombre Comercial:</label>
                <input
                  type="text"
                  value={formSettings.nombreNegocio}
                  onChange={(e) => setFormSettings({ ...formSettings, nombreNegocio: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">RNC / Cédula Fiscal:</label>
                <input
                  type="text"
                  value={formSettings.rnc}
                  onChange={(e) => setFormSettings({ ...formSettings, rnc: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Teléfono / WhatsApp:</label>
                <input
                  type="text"
                  value={formSettings.telefono}
                  onChange={(e) => setFormSettings({ ...formSettings, telefono: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Dirección del Local:</label>
                <input
                  type="text"
                  value={formSettings.direccion}
                  onChange={(e) => setFormSettings({ ...formSettings, direccion: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Símbolo de Moneda:</label>
                <input
                  type="text"
                  value={formSettings.simboloMoneda}
                  onChange={(e) => setFormSettings({ ...formSettings, simboloMoneda: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Tasa de Impuesto / ITBIS (%):</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  inputMode="decimal"
                  value={formSettings.impuestoPorcentaje === undefined ? '' : formSettings.impuestoPorcentaje}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setFormSettings({ ...formSettings, impuestoPorcentaje: 0 });
                    } else {
                      const num = parseFloat(val);
                      setFormSettings({ ...formSettings, impuestoPorcentaje: isNaN(num) ? 0 : num });
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                />
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Mensaje al Pie del Recibo:</label>
                {/* FASE 3.7H: corregido -- este campo leía/escribía
                    `formSettings.mensajePieFactura`, una clave que nunca
                    existió en SystemSettings ni en el backend (el campo
                    real ya declarado en el tipo es `mensajeTicketPie`,
                    mapeado a `pieTicket` en el backend). El input quedaba
                    permanentemente vacío sin importar lo que el backend
                    devolviera. */}
                <input
                  type="text"
                  value={formSettings.mensajeTicketPie || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, mensajeTicketPie: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              {/* FASE 4 (textos del recibo -- auditoría): estos 3 campos
                  reemplazan texto que antes estaba fijo dentro del propio
                  componente del recibo (ReceiptTicket.tsx). Un campo vacío
                  hace que el recibo omita esa línea por completo -- no
                  muestra "undefined"/"null" ni deja un espacio en blanco. */}
              <div className="col-span-1 sm:col-span-2 pt-2 border-t border-[#E4DDD2]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#756E65]">
                  Textos del Recibo / Comprobante
                </span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Eslogan del Negocio:</label>
                <input
                  type="text"
                  value={formSettings.eslogan || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, eslogan: e.target.value })}
                  placeholder="Ej. Elegancia, Vanguardia y Estilo Contemporáneo"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
                <span className="text-[10px] text-[#756E65]">Aparece bajo el nombre del negocio, en el encabezado del recibo. Vacío = no se muestra.</span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Mensaje Final del Recibo:</label>
                <input
                  type="text"
                  value={formSettings.mensajeFinalRecibo || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, mensajeFinalRecibo: e.target.value })}
                  placeholder="Ej. ¡Gracias por vestir ZIO CLOTHES!"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                />
                <span className="text-[10px] text-[#756E65]">Línea final de agradecimiento, en negrita, al pie del recibo. Vacío = no se muestra.</span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Pie Técnico del Recibo:</label>
                <input
                  type="text"
                  value={formSettings.pieTecnicoRecibo || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, pieTecnicoRecibo: e.target.value })}
                  placeholder="Ej. Sistema POS ZIO • Comprobante Digital / Físico"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
                <span className="text-[10px] text-[#756E65]">Última línea, más pequeña, al final del recibo. Vacío = no se muestra.</span>
              </div>

              {/* FASE 5 (textos del recibo de ABONO -- auditoría): campos
                  deliberadamente separados de los del recibo de venta de
                  arriba -- InstallmentReceiptTicket.tsx (recibo de abono) es
                  un componente distinto de ReceiptTicket.tsx (recibo de
                  venta); cambiar el texto de uno nunca debe afectar al otro. */}
              <div className="col-span-1 sm:col-span-2 pt-2 border-t border-[#E4DDD2]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#756E65]">
                  Recibo de Abono
                </span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Mensaje Principal de Abono:</label>
                <input
                  type="text"
                  value={formSettings.mensajeFinalAbono || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, mensajeFinalAbono: e.target.value })}
                  placeholder="Ej. ¡GRACIAS POR SU ABONO!"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                />
                <span className="text-[10px] text-[#756E65]">Línea principal en negrita al pie del recibo de abono (cuando queda saldo pendiente). Vacío = no se muestra.</span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Mensaje Adicional del Comprobante de Abono:</label>
                <input
                  type="text"
                  value={formSettings.mensajeReciboPie || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, mensajeReciboPie: e.target.value })}
                  placeholder="Ej. Comprobante válido de abono a su cuenta. Conserve este documento."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
                <span className="text-[10px] text-[#756E65]">Segunda línea del pie del recibo de abono. Vacío = no se muestra.</span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Pie Técnico del Recibo de Abono:</label>
                <input
                  type="text"
                  value={formSettings.pieTecnicoAbono || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, pieTecnicoAbono: e.target.value })}
                  placeholder="Ej. Sistema POS"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
                <span className="text-[10px] text-[#756E65]">Aparece después del nombre del negocio, en la última línea del recibo de abono (ej. "{formSettings.nombreNegocio || 'ZIO CLOTHES'} • {formSettings.pieTecnicoAbono || '...'}"). Vacío = solo se muestra el nombre del negocio.</span>
              </div>
            </fieldset>

            <div className="pt-4 border-t border-[#E4DDD2] flex justify-end">
              <button
                type="submit"
                disabled={settingsLoading || savingSettings}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs disabled:bg-zinc-300"
              >
                <Save className="w-4 h-4 text-[#E8DCC8]" />
                <span>{savingSettings ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: USERS & ROLES */}
      {activeTab === 'USUARIOS' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Cuentas de Usuarios & Roles</h3>
              <p className="text-xs text-[#756E65]">Control de acceso por cajero, supervisor y administrador.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchUsers()}
                disabled={usersLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] disabled:opacity-50"
                title="Volver a consultar el backend real"
              >
                <RefreshCw className={`w-4 h-4 text-[#756E65] ${usersLoading ? 'animate-spin' : ''}`} />
                <span>{usersLoading ? 'Actualizando...' : 'Actualizar'}</span>
              </button>
              <button
                type="button"
                onClick={handleOpenCreateUser}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932]"
              >
                <Plus className="w-4 h-4 text-[#E8DCC8]" />
                <span>Nuevo Usuario</span>
              </button>
            </div>
          </div>

          {usersError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>No se pudo cargar la lista real de usuarios: {usersError}</span>
              </div>
              <button type="button" onClick={() => fetchUsers()} className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0">
                Reintentar
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            {usersLoading && users.length === 0 ? (
              <div className="text-center py-10 text-[#756E65] text-xs">Consultando usuarios reales en el backend...</div>
            ) : !usersLoading && !usersError && users.length === 0 ? (
              <div className="text-center py-10 text-[#756E65] text-xs">Todavía no hay usuarios registrados en Google Sheets.</div>
            ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-4">Usuario</th>
                  <th className="py-2.5 px-4">Nombre Completo</th>
                  <th className="py-2.5 px-4">Rol Asignado</th>
                  <th className="py-2.5 px-4 text-center">Estado</th>
                  <th className="py-2.5 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(users || []).map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-mono font-bold text-[#2F2A25]">@{u.usuario}</td>
                    <td className="py-3 px-4">{u.nombre} {u.apellido}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[10px] font-bold text-[#2F2A25]">
                        {u.rol}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          u.estado === 'ACTIVO'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {u.estado}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleOpenEditUser(u)}
                        className="px-2.5 py-1 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[11px] font-bold text-[#2F2A25] hover:bg-[#F6F1E8]"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>

          {userModalOpen && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
              <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
                <h3 className="text-sm font-bold text-[#2F2A25] border-b border-[#E4DDD2] pb-2">
                  {editingUserId ? 'Editar Empleado / Usuario' : 'Crear Empleado / Usuario'}
                </h3>
                {editingUserId && editingUserId === currentUser?.id && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
                    ⚠ Estás editando tu propia cuenta. Si cambias tu rol o estado, el cambio no tendrá efecto en tu sesión actual hasta que vuelvas a iniciar sesión.
                  </div>
                )}
                <form onSubmit={handleSaveUser} noValidate className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Nombre de Usuario (@):</label>
                    <input
                      type="text"
                      required
                      placeholder="ej. maria.vendedor"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      disabled={savingUser}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Nombre:</label>
                      <input
                        type="text"
                        required
                        value={newNombre}
                        onChange={(e) => setNewNombre(e.target.value)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Apellido:</label>
                      <input
                        type="text"
                        value={newApellido}
                        onChange={(e) => setNewApellido(e.target.value)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Correo (opcional):</label>
                      <input
                        type="email"
                        value={newCorreo}
                        onChange={(e) => setNewCorreo(e.target.value)}
                        disabled={savingUser}
                        placeholder="usuario@zioclothes.com"
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Teléfono (opcional):</label>
                      <input
                        type="text"
                        value={newTelefono}
                        onChange={(e) => setNewTelefono(e.target.value)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Rol / Permisos:</label>
                      <select
                        value={newRol}
                        onChange={(e) => setNewRol(e.target.value as UserRole)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                      >
                        {REAL_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    {editingUserId && (
                      <div>
                        <label className="block font-bold text-[#2F2A25] mb-1">Estado:</label>
                        <select
                          value={newEstado}
                          onChange={(e) => setNewEstado(e.target.value as any)}
                          disabled={savingUser}
                          className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                        >
                          <option value="ACTIVO">Activo</option>
                          <option value="INACTIVO">Inactivo</option>
                          <option value="BLOQUEADO">Bloqueado</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">
                      Contraseña{editingUserId ? ' (dejar en blanco para no cambiarla):' : ':'}
                    </label>
                    <input
                      type="password"
                      required={!editingUserId}
                      autoComplete="new-password"
                      placeholder={editingUserId ? '••••••••' : ''}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={savingUser}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-mono"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setUserModalOpen(false)}
                      disabled={savingUser}
                      className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65] disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingUser}
                      className="flex-1 py-2 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md disabled:bg-zinc-300"
                    >
                      {savingUser ? 'Guardando...' : editingUserId ? 'Guardar Cambios' : 'Crear Usuario'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: GOOGLE SHEETS SYNC */}
      {activeTab === 'SHEETS' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Integración con Google Sheets</h3>
              <p className="text-xs text-[#756E65]">
                Sincronización en tiempo real de ventas, inventario, clientes y abonos a tu hoja de cálculo.
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#FAF8F4] rounded-2xl border border-[#E4DDD2] space-y-3 text-xs">
            <p className="text-[#2F2A25] leading-relaxed">
              El sistema ZIO CLOTHES está preparado para sincronizar automáticamente cada venta, entrada de inventario y abono a Google Sheets a través del Webhook de Google Apps Script.
            </p>
            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">URL de Webhook (Google Apps Script):</label>
              <input
                type="text"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={googleAppsScriptUrl}
                onChange={(e) => {
                  const url = e.target.value;
                  setGoogleAppsScriptUrlState(url);
                  storageService.setGoogleAppsScriptUrl(url);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
            <div>
              <span className="text-[11px] font-bold uppercase text-emerald-900">Estado de la Sincronización</span>
              <p className="text-xs text-emerald-800 mt-0.5">
                {googleAppsScriptUrl
                  ? 'Webhook configurado listo para enviar transacciones.'
                  : 'Listo para conectar con Google Sheets.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={syncing}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-bold hover:bg-emerald-900 transition shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: BACKUP & RESTORE */}
      {activeTab === 'BACKUP' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div>
            <h3 className="font-serif font-bold text-base text-[#2F2A25]">Copia de Seguridad & Restauración</h3>
            <p className="text-xs text-[#756E65]">Descargue toda la base de datos o restaure una copia de seguridad previa.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-[#E4DDD2] bg-[#FAF8F4] space-y-3">
              <h4 className="font-bold text-xs text-[#2F2A25]">Exportar Copia de Seguridad JSON</h4>
              <p className="text-xs text-[#756E65]">
                Consulta EN VIVO el backend real (nunca datos locales) y guarda un backup versionado con
                productos, variantes, categorías, tallas, colores, clientes, ventas, pagos, cuentas por
                cobrar, abonos, créditos a favor, notas de crédito, devoluciones, compras, gastos, caja
                (sesiones y movimientos), Kardex y configuración.
              </p>
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={exportingBackup}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Download className={`w-4 h-4 text-[#E8DCC8] ${exportingBackup ? 'animate-pulse' : ''}`} />
                <span>{exportingBackup ? 'Preparando copia de seguridad...' : 'Descargar Backup JSON'}</span>
              </button>

              {/* Éxito: backup completo, con resumen verificable. */}
              {lastExportSummary && !exportFailures && (
                <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1.5 text-emerald-900">
                  <p className="font-bold">Backup generado correctamente</p>
                  <p>Fecha: {formatDateTime(lastExportSummary.createdAt)}</p>
                  <p>Total de registros: {lastExportSummary.totalRecords}</p>
                  <p>Entidades incluidas: {lastExportSummary.entities.length}</p>
                  {lastExportSummary.warnings.length > 0 && (
                    <ul className="pt-1 border-t border-emerald-200/70 space-y-0.5 text-emerald-800">
                      {lastExportSummary.warnings.map((w, i) => (
                        <li key={i}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Falla: NUNCA se descarga un backup incompleto -- Regla Crítica. */}
              {exportFailures && (
                <div className="text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1.5 text-rose-900">
                  <p className="font-bold flex items-center gap-1.5">
                    <FileWarning className="w-3.5 h-3.5" />
                    NO SE GENERÓ EL BACKUP
                  </p>
                  <p>No se descargó ningún archivo -- ningún dato fue modificado. Corrija el problema antes de intentar de nuevo:</p>
                  <ul className="space-y-1 pt-1 border-t border-rose-200/70">
                    {exportFailures.map((f) => (
                      <li key={f.key}>
                        <span className="font-semibold">{f.label}:</span> {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* FASE COPIA DE SEGURIDAD: reemplaza "Limpiar Caché Local".
                Estilo de advertencia (Requerimiento 19) porque restaurar
                es una operación destructiva -- nunca se ejecuta al
                seleccionar el archivo, solo al confirmar en el modal. */}
            <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50 space-y-3">
              <div className="flex items-center gap-2">
                <FileJson className="w-4 h-4 text-amber-800" />
                <h4 className="font-bold text-xs text-amber-900">Restaurar Backup JSON</h4>
              </div>
              <p className="text-xs text-amber-800">
                Restaure los datos del sistema desde una copia de seguridad JSON previamente descargada.
              </p>

              <input
                ref={restoreFileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreFileSelected}
                className="hidden"
                aria-label="Seleccionar archivo JSON de backup"
              />
              <button
                type="button"
                disabled={previewingRestore || restoring}
                onClick={() => restoreFileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-bold hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4" />
                <span>Seleccionar archivo JSON</span>
              </button>

              {restoreFile && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-amber-900 bg-white/60 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="truncate">Archivo: {restoreFile.name}</span>
                  <button type="button" onClick={handleClearRestoreFile} className="text-amber-700 hover:text-amber-900 shrink-0" aria-label="Quitar archivo seleccionado">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {restoreValidation && !restoreValidation.valid && (
                <p className="text-xs font-semibold text-rose-800 bg-rose-100 border border-rose-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
                  <FileWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{restoreValidation.error}</span>
                </p>
              )}

              {restoreValidation && restoreValidation.valid && (
                <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  Backup reconocido (
                  {restoreValidation.summary.format === 'legacy'
                    ? 'formato anterior -- sin garantía de completitud'
                    : restoreValidation.summary.complete
                    ? `versión ${restoreValidation.summary.backupVersion}, completo`
                    : `versión ${restoreValidation.summary.backupVersion}, INCOMPLETO`}
                  ) -- {restoreValidation.summary.totalRecords} registro(s) en {restoreValidation.summary.entities.length} entidad(es).
                </p>
              )}

              {restoreValidation && restoreValidation.valid && !restoreIsRestorableFormat && (
                <p className="text-xs font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded-xl px-3 py-2">
                  Este backup es de un formato anterior y no puede restaurarse con el motor de restauración actual (requiere un backup versión 2, completo). Genere uno nuevo con "Descargar Backup JSON".
                </p>
              )}

              {serverPreviewErrors && (
                <div className="text-xs font-semibold text-rose-800 bg-rose-100 border border-rose-200 rounded-xl px-3 py-2 space-y-1">
                  <p className="flex items-center gap-1.5">
                    <FileWarning className="w-3.5 h-3.5" />
                    El backend rechazó este backup -- ningún dato fue modificado:
                  </p>
                  <ul className="list-disc list-inside">
                    {serverPreviewErrors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                disabled={!restoreIsRestorableFormat || previewingRestore || !hasPermission('admin.configuracion')}
                onClick={handleClickRestoreButton}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-rose-700"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>{previewingRestore ? 'Validando con el servidor...' : 'Restaurar Backup'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de restauración -- Requerimiento 4: NUNCA
          se restaura al seleccionar el archivo, siempre requiere esta
          confirmación explícita. Componente propio (no window.confirm)
          reutilizando el estilo visual ya establecido de los demás
          modales de esta aplicación (fondo oscuro + tarjeta redondeada). */}
      {restoreConfirmOpen && restoreValidation && restoreValidation.valid && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 border-b border-[#E4DDD2] pb-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#2F2A25] uppercase tracking-wide">Restaurar Copia de Seguridad</h3>
            </div>

            <p className="text-xs text-[#756E65]">
              Esta operación reemplazará el estado actual del sistema por el contenido de esta copia. Los
              cambios realizados después de la fecha del backup podrían perderse.
            </p>
            <p className="text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Se generará una copia de seguridad del estado actual antes de comenzar.
            </p>

            <div className="bg-white border border-[#E4DDD2] rounded-2xl p-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#756E65]">Archivo:</span>
                <span className="font-bold text-[#2F2A25] truncate max-w-[220px]">{restoreFile?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#756E65]">Fecha del backup:</span>
                <span className="font-bold text-[#2F2A25]">
                  {restoreValidation.summary.createdAt ? formatDateTime(restoreValidation.summary.createdAt) : 'No disponible'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#756E65]">Registros totales:</span>
                <span className="font-bold text-[#2F2A25]">{restoreValidation.summary.totalRecords}</span>
              </div>
              <div className="pt-1.5 border-t border-[#E4DDD2]/60">
                <span className="text-[#756E65] block mb-1">Entidades incluidas:</span>
                <ul className="space-y-0.5">
                  {restoreValidation.summary.entities.map((e) => (
                    <li key={e.key} className="flex justify-between">
                      <span className="text-[#2F2A25]">{e.label}</span>
                      <span className="font-semibold text-[#756E65]">{e.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {restoring && restoreProgress && (
              <p className="text-xs font-semibold text-[#2F2A25] bg-[#F6F1E8] border border-[#E4DDD2] rounded-xl px-3 py-2 text-center animate-pulse">
                {restoreProgress}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={restoring}
                onClick={() => setRestoreConfirmOpen(false)}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-[#756E65] bg-white border border-[#E4DDD2] hover:bg-zinc-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={restoring || !hasPermission('admin.configuracion')}
                onClick={handleConfirmRestore}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-rose-700"
              >
                {restoring ? 'Restaurando...' : 'Confirmar Restauración'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {activeTab === 'AUDITORIA' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Registro de Auditoría</h3>
              <p className="text-xs text-[#756E65]">Historial de todas las acciones sensibles realizadas en el sistema.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-4">Fecha y Hora</th>
                  <th className="py-2.5 px-4">Acción</th>
                  <th className="py-2.5 px-4">Módulo</th>
                  <th className="py-2.5 px-4">Detalle</th>
                  <th className="py-2.5 px-4">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(auditLogs || []).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 text-[#756E65]">{formatDateTime(log.fecha)}</td>
                    <td className="py-2.5 px-4 font-bold text-[#2F2A25]">{log.accion}</td>
                    <td className="py-2.5 px-4 font-semibold text-[#756E65]">{log.modulo}</td>
                    <td className="py-2.5 px-4 text-[#2F2A25]">{log.detalle || log.descripcion}</td>
                    <td className="py-2.5 px-4 font-medium text-[#756E65]">{log.usuarioNombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
