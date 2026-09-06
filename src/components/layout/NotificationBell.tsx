import React, { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../../context/NotificationContext';
import { AppNotification } from '../../types';
import { Bell, CheckCheck, CheckCircle2, AlertTriangle, XCircle, Info, PartyPopper } from 'lucide-react';

/**
 * FASE — SISTEMA GLOBAL DE ALERTAS Y NOTIFICACIONES.
 *
 * Campanita + panel del Navbar. Puramente de PRESENTACIÓN -- todo el
 * cálculo (qué notificaciones existen, deduplicación, permisos,
 * prioridad) vive en NotificationContext.tsx (useNotifications()); este
 * componente solo lee esa lista y expone las 2 acciones (marcar
 * individual / marcar todas) y la navegación al hacer clic.
 *
 * `onNavigate` es EXACTAMENTE el mismo `handleNavigate(view, filter)` que
 * ya usa Navbar/Sidebar/DashboardView -- no se inventa un segundo canal
 * de navegación.
 */

interface NotificationBellProps {
  onNavigate: (view: string, filter?: string) => void;
}

function SeverityIcon({ severidad }: { severidad: AppNotification['severidad'] }) {
  switch (severidad) {
    case 'error':
      return <XCircle className="w-4 h-4 text-rose-600 shrink-0" />;
    case 'advertencia':
      return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />;
    case 'informacion':
      return <Info className="w-4 h-4 text-blue-600 shrink-0" />;
    default:
      return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  }
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigate }) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera -- patrón estándar de dropdown, sin backdrop
  // de pantalla completa (esto es un panel flotante del Navbar, no un modal).
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleNotificationClick = (n: AppNotification) => {
    markAsRead(n.id);
    setIsOpen(false);
    if (n.targetView) {
      onNavigate(n.targetView, n.navigationFilter);
    }
  };

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition focus:outline-none"
        title="Notificaciones"
        aria-label={unreadCount > 0 ? `Notificaciones, ${unreadCount} sin leer` : 'Notificaciones'}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center leading-none"
            data-testid="notification-badge"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-[#E4DDD2] rounded-2xl shadow-xl overflow-hidden z-40"
          role="dialog"
          aria-label="Panel de notificaciones"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4DDD2] bg-[#FAF8F4]">
            <h3 className="text-sm font-bold text-[#2F2A25]">Notificaciones</h3>
            {notifications.length > 0 && unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-[10px] font-bold text-[#C2410C] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck className="w-3 h-3" />
                <span>Marcar todas</span>
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-[#E4DDD2]/70">
            {notifications.length === 0 ? (
              <div className="py-8 px-4 text-center space-y-2">
                <PartyPopper className="w-6 h-6 text-emerald-600 mx-auto opacity-80" />
                <p className="text-xs font-bold text-[#2F2A25]">Todo está al día</p>
                <p className="text-[11px] text-[#756E65]">No tienes notificaciones pendientes.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleNotificationClick(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleNotificationClick(n);
                  }}
                  className={`w-full text-left px-4 py-3 flex items-start gap-2.5 cursor-pointer transition hover:bg-[#FAF8F4] ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <SeverityIcon severidad={n.severidad} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#2F2A25] leading-tight">{n.titulo}</p>
                    <p className="text-[11px] text-[#756E65] mt-0.5 leading-snug">{n.mensaje}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(n.id);
                      }}
                      title="Marcar como leída"
                      aria-label={`Marcar como leída: ${n.titulo}`}
                      className="w-2.5 h-2.5 rounded-full bg-[#C2410C] mt-1 shrink-0 cursor-pointer hover:scale-125 transition-transform"
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
