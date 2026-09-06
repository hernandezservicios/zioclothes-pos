import React, { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { AppNotification } from '../types';
import { useDataStore } from './DataStoreContext';
import { useAuth } from './AuthContext';
import { storageService } from '../services/storageService';
import { formatCurrency, toBusinessDateStr } from '../utils/formatters';

/**
 * FASE — SISTEMA GLOBAL DE ALERTAS Y NOTIFICACIONES.
 *
 * Fuente CENTRAL única de notificaciones de negocio (campanita del
 * Navbar) -- ninguna vista (DashboardView, SalesView, CustomersView,
 * CreditsView, etc.) calcula esto por su cuenta. Las notificaciones se
 * DERIVAN en vivo de los datos ya reales de DataStoreContext (Créditos,
 * Productos) -- nunca se inventa un campo, nunca se hace una llamada de
 * red nueva, nunca se persiste el contenido de la notificación en
 * ningún lado (Google Sheets incluido): solo el estado de lectura se
 * persiste localmente, ver storageService.getReadNotificationIds.
 *
 * Hallazgo de auditoría relevante (Parte 7 de esta fase): ni
 * CreditsController.gs ni ningún otro archivo del backend escriben jamás
 * `estado: 'VENCIDA'` en Creditos (grep exhaustivo, cero resultados) --
 * el valor solo existe como posibilidad en el tipo TypeScript
 * `CreditAccountStatus` y en el filtro ya existente pero nunca-verdadero
 * de CreditsView.tsx/DashboardView.tsx (`c.estado === 'VENCIDA'`). Por
 * eso este archivo NUNCA confía en `estado === 'VENCIDA'` -- calcula el
 * vencimiento real comparando `fechaVencimiento` contra la fecha
 * comercial de hoy (America/Santo_Domingo, mismo `toBusinessDateStr` ya
 * usado y auditado por Reportes/Dashboard), exactamente como pide la
 * Parte 7. No se corrige el filtro preexistente de CreditsView/
 * DashboardView en esta fase (fuera de alcance: "no cambiar lógica de
 * negocio existente" salvo lo estrictamente necesario para integrar
 * notificaciones) -- se documenta aquí y en el reporte final.
 */

// Recalcula el reloj (nunca hace red) cada 60s -- necesario porque un
// crédito puede "volverse vencido" solo por el paso del tiempo, sin que
// ningún dato de DataStore cambie mientras el usuario permanece en la
// misma pantalla.
const RECHECK_INTERVAL_MS = 60_000;

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Prioridad fija pedida por la Parte 16 de la fase: Créditos vencidos >
// Ventas pendientes > Stock bajo > Información general.
const TYPE_PRIORITY: Record<AppNotification['tipo'], number> = {
  CREDITO_VENCIDO: 0,
  VENTA_PENDIENTE: 1,
  STOCK_BAJO: 2,
  SISTEMA: 3,
};

function pluralDias(n: number): string {
  return n === 1 ? 'día' : 'días';
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { credits, products } = useDataStore();
  const { hasPermission, isAuthenticated } = useAuth();

  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(storageService.getReadNotificationIds()));
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // ÚNICO cálculo derivado -- nunca dispara una petición HTTP, nunca lee
  // directamente localStorage aquí (eso ya se hizo una sola vez arriba,
  // al inicializar `readIds`). Recalcula solo cuando cambian los datos
  // reales, los permisos, el reloj de 60s, o el estado de lectura.
  const notifications = useMemo<AppNotification[]>(() => {
    if (!isAuthenticated) return [];

    const list: AppNotification[] = [];
    const now = new Date(nowTick);
    const todayStr = toBusinessDateStr(now);

    // ---- Créditos vencidos / Ventas pendientes (misma fuente real:
    // AccountReceivable -- Parte 8 y 10: nunca se generan ambas
    // notificaciones para la misma cuenta, son mutuamente excluyentes
    // según si su fecha de vencimiento ya pasó). ----
    const canViewOverdue = hasPermission('creditos.ver_vencidas');
    const canViewDebts = hasPermission('creditos.ver_deudas');
    if (canViewOverdue || canViewDebts) {
      (credits || []).forEach((c) => {
        if (!c) return;
        // Regla exacta de la Parte 7: saldo > 0, fecha de vencimiento
        // válida, no anulada/saldada.
        if (c.estado === 'PAGADA' || c.estado === 'ANULADA') return;
        const saldo = Number(c.saldoPendiente) || 0;
        if (saldo <= 0) return;
        if (!c.fechaVencimiento) return;
        const dueDate = new Date(String(c.fechaVencimiento).replace(' ', 'T'));
        if (isNaN(dueDate.getTime())) return;
        const dueDateStr = toBusinessDateStr(dueDate);

        if (dueDateStr < todayStr) {
          if (!canViewOverdue) return;
          const diffDays = Math.round(
            (new Date(todayStr).getTime() - new Date(dueDateStr).getTime()) / 86400000
          );
          const id = `CREDITO_VENCIDO:${c.id}`;
          list.push({
            id,
            tipo: 'CREDITO_VENCIDO',
            titulo: 'Crédito vencido',
            mensaje:
              `${c.clienteNombre || 'Cliente'} tiene ${formatCurrency(saldo)} pendientes vencidos` +
              (diffDays > 0 ? ` (vencido hace ${diffDays} ${pluralDias(diffDays)}).` : '.'),
            severidad: 'error',
            createdAt: c.fechaVencimiento,
            read: readIds.has(id),
            entityType: 'AccountReceivable',
            entityId: c.id,
            targetView: 'credits',
            navigationFilter: 'VENCIDA',
          });
        } else {
          if (!canViewDebts) return;
          const id = `VENTA_PENDIENTE:${c.id}`;
          list.push({
            id,
            tipo: 'VENTA_PENDIENTE',
            titulo: 'Venta pendiente',
            mensaje: `Venta ${c.numeroVenta || c.numeroCredito} tiene ${formatCurrency(saldo)} pendientes de pago.`,
            severidad: 'advertencia',
            createdAt: c.fechaCreacion || c.fechaEmision || now.toISOString(),
            read: readIds.has(id),
            entityType: 'AccountReceivable',
            entityId: c.id,
            targetView: 'credits',
            navigationFilter: c.estado === 'PARCIAL' ? 'PARCIAL' : 'PENDIENTE',
          });
        }
      });
    }

    // ---- Stock bajo (Productos.stock_minimo / Variantes.stock reales) ----
    if (hasPermission('inventario.ver')) {
      (products || []).forEach((p) => {
        if (!p || p.estado !== 'ACTIVO') return;
        const stockMinimo = Number(p.stockMinimo) || 0;
        (p.variantes || []).forEach((v) => {
          if (!v || v.estado !== 'ACTIVO') return; // Parte 9: nunca variantes INACTIVAS
          const stock = Number(v.stock) || 0;
          if (stock > stockMinimo) return;
          const isSimple = (v.talla === 'U' || !v.talla) && (v.color === 'Único' || !v.color);
          const variantLabel = isSimple ? '' : ` — ${v.talla}/${v.color}`;
          const id = `STOCK_BAJO:${v.id}`;
          list.push({
            id,
            tipo: 'STOCK_BAJO',
            titulo: 'Stock bajo',
            mensaje: `${p.nombre}${variantLabel} tiene ${stock} unidad(es) disponibles.`,
            severidad: 'advertencia',
            createdAt: now.toISOString(),
            read: readIds.has(id),
            entityType: 'ProductVariant',
            entityId: v.id,
            targetView: 'inventory',
            navigationFilter: 'STOCK_BAJO',
          });
        });
      });
    }

    list.sort((a, b) => {
      const rankDiff = TYPE_PRIORITY[a.tipo] - TYPE_PRIORITY[b.tipo];
      if (rankDiff !== 0) return rankDiff;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });

    return list;
  }, [credits, products, isAuthenticated, hasPermission, readIds, nowTick]);

  // Poda el conjunto de leídos a solo los ids todavía vigentes en esta
  // lista -- evita que localStorage crezca sin límite con entidades ya
  // resueltas (crédito pagado, stock repuesto). Solo escribe a
  // localStorage, nunca dispara un nuevo render de `readIds` (no hay
  // ciclo posible).
  useEffect(() => {
    const currentIds = new Set(notifications.map((n) => n.id));
    setReadIds((prev) => {
      const pruned = Array.from<string>(prev).filter((id) => currentIds.has(id));
      if (pruned.length === prev.size) return prev;
      storageService.saveReadNotificationIds(pruned);
      return new Set(pruned);
    });
  }, [notifications]);

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set<string>(prev);
      next.add(id);
      storageService.saveReadNotificationIds(Array.from<string>(next));
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set<string>(prev);
      notifications.forEach((n) => next.add(n.id));
      storageService.saveReadNotificationIds(Array.from<string>(next));
      return next;
    });
  }, [notifications]);

  const unreadCount = useMemo(() => notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0), [notifications]);

  const value: NotificationContextType = { notifications, unreadCount, markAsRead, markAllAsRead };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    return { notifications: [], unreadCount: 0, markAsRead: () => {}, markAllAsRead: () => {} };
  }
  return context;
};
