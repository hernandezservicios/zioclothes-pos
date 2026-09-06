export function formatCurrency(amount: number | undefined | null, symbol = 'RD$'): string {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return `${symbol} 0.00`;
  }
  return `${symbol} ${Number(amount).toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '-';
  try {
    const d = new Date(dateString.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('es-DO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (e) {
    return dateString;
  }
}

export function formatDateTime(dateString: string | undefined | null): string {
  if (!dateString) return '-';
  try {
    const d = new Date(dateString.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleString('es-DO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch (e) {
    return dateString;
  }
}

// FASE 10.1 (cierre de auditoría E2E -- "no usar UTC de forma que cambie
// el día comercial"): el negocio opera en America/Santo_Domingo (UTC-4,
// sin horario de verano). `toISOString()`/`Date.getFullYear()` locales
// dependen de la zona horaria del NAVEGADOR/sistema operativo, no de la
// del negocio -- si alguien revisa Reportes desde un equipo configurado
// en otra zona horaria (ej. de viaje), "Hoy"/"Este Mes" quedarían mal
// calculados igual que el bug original de Fase 10. Se usa
// Intl.DateTimeFormat con `timeZone` explícito (API nativa del
// navegador, sin dependencias nuevas) para que el día/mes comercial sea
// SIEMPRE el de Santo Domingo, sin importar dónde esté físicamente el
// equipo que consulta el reporte.
export const BUSINESS_TIMEZONE = 'America/Santo_Domingo';

export function getBusinessDateParts(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Fecha comercial (America/Santo_Domingo) en formato "YYYY-MM-DD". */
export function toBusinessDateStr(d: Date): string {
  const { year, month, day } = getBusinessDateParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Mes comercial (America/Santo_Domingo) en formato "YYYY-MM". */
export function toBusinessMonthStr(d: Date): string {
  const { year, month } = getBusinessDateParts(d);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export type ReportPeriod = 'HOY' | 'SEMANA' | 'MES' | 'TODO';

/**
 * Determina si una fecha real del backend (ej. Venta.fecha,
 * ReturnRecord.fecha, "YYYY-MM-DD HH:mm:ss") cae dentro del período
 * seleccionado -- usa SIEMPRE el día/mes comercial de Santo Domingo,
 * nunca UTC ni la hora del navegador. Reutilizada tanto por
 * DashboardView (períodos fijos "Hoy"/"Mes actual") como por ReportsView
 * (selector HOY/SEMANA/MES/TODO) para que ambas pantallas apliquen
 * EXACTAMENTE la misma regla de fecha -- nunca dos fórmulas distintas
 * para el mismo concepto de período.
 *
 *  - HOY: mismo día comercial que `now`.
 *  - SEMANA: últimos 7 días comerciales, incluyendo hoy (ventana móvil,
 *    no "semana calendario" -- mismo criterio ya usado por el selector
 *    de tendencia de DashboardView, período '7d').
 *  - MES: mismo mes comercial que `now`.
 *  - TODO: siempre verdadero (todo el histórico, sin filtrar).
 */
export function matchesReportPeriod(
  fechaStr: string | undefined | null,
  period: ReportPeriod,
  now: Date = new Date()
): boolean {
  if (period === 'TODO') return true;
  if (!fechaStr) return false;

  const recordDate = new Date(fechaStr.replace(' ', 'T'));
  if (isNaN(recordDate.getTime())) return false;

  if (period === 'HOY') {
    return toBusinessDateStr(recordDate) === toBusinessDateStr(now);
  }
  if (period === 'MES') {
    return toBusinessMonthStr(recordDate) === toBusinessMonthStr(now);
  }

  // SEMANA: diferencia en días de calendario comercial (0 a 6 = últimos 7 días, hoy inclusive).
  const todayStr = toBusinessDateStr(now);
  const recordStr = toBusinessDateStr(recordDate);
  if (recordStr > todayStr) return false; // fecha futura -- no cuenta como parte de la ventana
  const diffDays = Math.round((new Date(todayStr).getTime() - new Date(recordStr).getTime()) / 86400000);
  return diffDays >= 0 && diffDays < 7;
}

export function getDaysDiff(futureDateStr: string): number {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(futureDateStr.replace(' ', 'T'));
    target.setHours(0, 0, 0, 0);
    const diffMs = target.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  } catch (e) {
    return 0;
  }
}
