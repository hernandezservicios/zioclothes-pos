import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../utils/formatters';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import { NotificationBell } from './NotificationBell';
import {
  ShoppingBag,
  Wallet,
  Menu,
  FileSpreadsheet,
  LogOut,
  User as UserIcon,
  Shield,
} from 'lucide-react';

interface NavbarProps {
  onToggleSidebar: () => void;
  activeView: string;
  onNavigate: (view: any) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onToggleSidebar,
  activeView,
  onNavigate,
}) => {
  // FASE 3.6D (Parte 4): la caja activa viene exclusivamente de
  // AuthContext (respaldada por cash.getActiveSession real) -- ya no de
  // storageService.getActiveCashSession(), que desde que CashView migró a
  // cashApi nunca vuelve a escribirse localmente y siempre mostraría
  // "cerrada" aunque hubiera una caja real abierta.
  const { currentUser, logout, settings, canView, activeCashSession } = useAuth();
  const activeCash = activeCashSession;

  // AUDITORÍA (FASE -- regresión de imágenes/logo): antes, si
  // `settings.logoUrl` tenía un valor pero la imagen fallaba al cargar
  // (Drive, red, permiso revocado -- cualquier causa real, no de este
  // código), el `<img>` se quedaba ahí mostrando el ícono roto del
  // navegador para siempre, porque la condición `settings.logoUrl ?
  // <img> : <fallback>` nunca vuelve a evaluarse tras un fallo de red --
  // solo reacciona a que el VALOR de la URL exista o no. `onError`
  // (requisito 6 de la tarea: fallback visual para una imagen individual
  // que realmente no cargue, sin inventar ni ocultar nada) cambia a el
  // MISMO emblema "Z" que ya existía como fallback -- nunca se toca la
  // URL real ni `settings.logoUrl` en sí.
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  // Si el admin sube un logo nuevo (o corrige el existente) en la misma
  // sesión, se vuelve a intentar cargarlo en vez de quedar atascado en
  // el fallback de una URL vieja que ya falló.
  useEffect(() => {
    setLogoLoadFailed(false);
  }, [settings.logoUrl]);

  return (
    <header id="navbar" className="no-print sticky top-0 z-30 bg-[#FAF8F4]/90 backdrop-blur-md border-b border-[#E4DDD2] px-4 sm:px-6 py-3 flex items-center justify-between">
      {/* Left: Hamburger & Brand */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition focus:outline-none"
          title="Menú de Navegación"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* AUDITORÍA (FASE -- responsive completo): `min-w-0` en este
            ítem flex + `truncate` en los dos textos de abajo -- sin
            esto, un nombre de negocio largo configurado en Configuración
            (ahora dinámico, ver Sidebar.tsx) no tenía forma de encogerse
            y podía empujar el resto del header (POS/notificaciones/
            usuario) fuera de su lugar en pantallas angostas. Con el
            nombre real y corto de la instalación actual esto no se
            notaba, pero es la misma clase de bug (ítem flex sin
            min-w-0) que el resto de esta auditoría -- se corrige aquí
            de forma preventiva, sin tocar tamaño, posición ni logo. */}
        <div
          onClick={() => onNavigate('dashboard')}
          className="cursor-pointer flex items-center gap-2.5 min-w-0"
        >
          {/* FASE 3 (logo de empresa): si hay logo personalizado configurado
              (settings.logoUrl, hoja Configuracion vía system.getSettings),
              se muestra en vez del emblema "Z" del sistema -- fallback
              automático al emblema si no hay logo. */}
          {settings.logoUrl && !logoLoadFailed ? (
            <img
              src={toDisplayableImageUrl(settings.logoUrl)}
              alt={settings.nombreNegocio}
              onError={() => setLogoLoadFailed(true)}
              className="w-9 h-9 rounded-2xl object-cover shadow-xs"
            />
          ) : (
            <div className="w-9 h-9 rounded-2xl bg-[#2F2A25] flex items-center justify-center shadow-xs">
              <span className="font-serif font-bold text-lg text-[#E8DCC8] tracking-tighter">Z</span>
            </div>
          )}
          <div className="min-w-0">
            <span className="font-serif font-bold text-base tracking-tight text-[#2F2A25] block leading-none truncate">
              {settings.nombreNegocio}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[#756E65] font-semibold truncate block">
              Boutique POS
            </span>
          </div>
        </div>
      </div>

      {/* Right: Active Cash, POS Button, User Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Active Cash Status Indicator */}
        <button
          type="button"
          onClick={() => onNavigate('cash')}
          className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
            activeCash
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100/70'
              : 'bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100/70'
          }`}
          title="Ver estado de caja"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              activeCash ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
            }`}
          />
          <span className="text-[11px]">
            {activeCash
              ? `Caja Abierta: ${formatCurrency(activeCash.efectivoEsperado, settings.simboloMoneda)}`
              : 'Caja Cerrada'}
          </span>
        </button>

        {/* Quick Launch POS Button.
            TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL: antes usaba
            'pos.acceso', un código que nunca existió en ningún rol real
            del backend -- este botón quedaba invisible para TODOS los
            roles reales (incluido CAJERO) en una sesión real. */}
        {canView('pos') && (
          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${
              activeView === 'pos'
                ? 'bg-[#2F2A25] text-white ring-2 ring-[#2F2A25]/20'
                : 'bg-[#2F2A25] text-white hover:bg-[#403932]'
            }`}
          >
            <ShoppingBag className="w-4 h-4 text-[#E8DCC8]" />
            <span className="hidden sm:inline">Punto de Venta</span>
            <span className="sm:hidden">POS</span>
          </button>
        )}

        {/* Notificaciones */}
        <NotificationBell onNavigate={onNavigate} />

        {/* User Badge & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-[#E4DDD2]">
          <div className="text-right hidden md:block">
            <p className="text-xs font-bold text-[#2F2A25] leading-tight">
              {currentUser?.nombre} {currentUser?.apellido}
            </p>
            <span className="text-[10px] font-semibold text-[#756E65] uppercase">
              {currentUser?.rol}
            </span>
          </div>

          <button
            type="button"
            onClick={logout}
            className="p-2 rounded-xl text-[#756E65] hover:text-rose-700 hover:bg-rose-50 transition"
            title="Cerrar Sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
