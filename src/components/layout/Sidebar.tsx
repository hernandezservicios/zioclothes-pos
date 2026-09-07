import React, { useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import { useScrollEdgeIndicators } from '../../hooks/useScrollEdgeIndicators';
import { ScrollEdgeArrows } from './ScrollEdgeArrows';
import {
  LayoutDashboard,
  ShoppingBag,
  Receipt,
  RotateCcw,
  Shirt,
  Boxes,
  Truck,
  CreditCard,
  Coins,
  Wallet,
  Users,
  DollarSign,
  BarChart3,
  Settings,
  X,
  FileSpreadsheet,
  FileText,
  Gift,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeView: string;
  onNavigate: (view: any) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeView,
  onNavigate,
}) => {
  // TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL: `canView(item.id)`
  // reemplaza los permisos funcionales reutilizados que este Sidebar
  // aplicaba antes item por item (varios de ellos -- 'pos.acceso',
  // 'dashboard.ver' -- nunca existieron en ningún rol real del backend).
  // `item.id` YA ES el mismo id real de `AppView`/`vista.<id>` -- no hace
  // falta guardar un campo `permission` aparte por ítem: una sola llamada
  // centralizada decide, sin ninguna regla por rol hardcodeada aquí.
  const { canView, settings } = useAuth();

  // AJUSTE VISUAL -- scrollbar nativo oculto + flechas discretas ↑/↓ (ver
  // useScrollEdgeIndicators.ts / ScrollEdgeArrows.tsx / .no-native-scrollbar
  // en index.css). `navRef` apunta al MISMO <nav> que ya tenía
  // `overflow-y-auto` -- no se crea un segundo contenedor de scroll.
  const navRef = useRef<HTMLElement>(null);
  const { canScrollUp, canScrollDown, scrollStep } = useScrollEdgeIndicators(navRef);

  const sections: { title: string; items: MenuItem[] }[] = [
    {
      title: 'Principal',
      items: [
        { id: 'dashboard', label: 'Panel Principal', icon: LayoutDashboard },
        { id: 'pos', label: 'Caja & Mostrador POS', icon: ShoppingBag },
      ],
    },
    {
      title: 'Ventas & Clientes',
      items: [
        { id: 'sales', label: 'Historial de Ventas', icon: Receipt },
        // FASE (normalización comercial): "Devoluciones de Prendas" ->
        // "Devoluciones" -- se conserva el `id` interno ('returns') para
        // no romper la navegación/permisos, solo cambia la etiqueta visible.
        { id: 'returns', label: 'Devoluciones', icon: RotateCcw },
        // FASE 6: ahora sí existe una pantalla real detrás de esta
        // etiqueta (CreditNotesView, filtrada a tipo NOTA_CREDITO) --
        // búsqueda por número/cliente/venta, detalle con historial de
        // aplicaciones, e impresión/reimpresión.
        { id: 'creditNotes', label: 'Notas de Crédito', icon: FileText },
        { id: 'customers', label: 'Clientes', icon: Users },
      ],
    },
    {
      title: 'Catálogo & Inventario',
      items: [
        { id: 'products', label: 'Productos', icon: Shirt },
        { id: 'inventory', label: 'Inventario / Kardex', icon: Boxes },
        { id: 'purchases', label: 'Órdenes de Compra', icon: Truck },
      ],
    },
    {
      title: 'Créditos & Caja',
      items: [
        { id: 'credits', label: 'Cuentas por Cobrar', icon: CreditCard },
        { id: 'installments', label: 'Abonos Recibidos', icon: Coins },
        // FASE 6: misma pantalla que "Notas de Crédito" (CreditNotesView),
        // filtrada a tipo VALE_TIENDA -- saldo reutilizable a favor del
        // cliente, no debe confundirse con "Cuentas por Cobrar" de arriba
        // (naturaleza opuesta: ahí el cliente le debe al negocio).
        { id: 'storeCredits', label: 'Créditos a Favor / Vales', icon: Gift },
        { id: 'cash', label: 'Caja & Cuadres de Turno', icon: Wallet },
      ],
    },
    {
      title: 'Finanzas & Sistema',
      items: [
        { id: 'expenses', label: 'Gastos Operativos', icon: DollarSign },
        { id: 'reports', label: 'Reportes & Margen', icon: BarChart3 },
        // FASE (normalización comercial): "Configuración & Sheets" ->
        // "Configuración" -- la integración técnica con Google Sheets
        // sigue existiendo DENTRO de la pantalla de Configuración (pestaña
        // "Google Sheets Sync", uso administrativo explícito), solo deja
        // de aparecer en la navegación principal.
        { id: 'settings', label: 'Configuración', icon: Settings },
      ],
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      {/* Drawer.
          CORRECCIÓN DE LAYOUT: en `lg:` (donde pasa a `lg:static`, ya
          dentro del flujo normal de la fila Sidebar+main de App.tsx) se
          agrega `lg:h-full` -- ahora que esa fila tiene una altura real y
          acotada (ver App.tsx), esto expresa explícitamente que el Sidebar
          ocupa toda la altura disponible bajo el Navbar, sin depender
          únicamente del stretch por defecto de flexbox -- y `lg:shrink-0`
          para que su ancho (w-72) nunca se comprima si el contenido de la
          derecha se desborda horizontalmente. En mobile (`fixed`), el
          propio `top-0 bottom-0` ya lo fija a la altura completa del
          viewport, independiente de este cambio. */}
      <aside
        id="sidebar"
        className={`no-print fixed top-0 bottom-0 left-0 z-50 w-72 bg-[#FAF8F4] border-r border-[#E4DDD2] flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:static lg:z-0 lg:h-full lg:shrink-0 shadow-xl lg:shadow-none`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[#E4DDD2] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* FASE 3 (logo de empresa): fallback automático al emblema "Z"
                del sistema si la empresa no configuró un logo propio. El
                texto "ZIO CLOTHES" de abajo permanece igual -- no se tocó
                (no forma parte del alcance de esta fase). */}
            {settings.logoUrl ? (
              <img
                src={toDisplayableImageUrl(settings.logoUrl)}
                alt={settings.nombreNegocio}
                className="w-8 h-8 rounded-xl object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-[#2F2A25] flex items-center justify-center">
                <span className="font-serif font-bold text-sm text-[#E8DCC8]">Z</span>
              </div>
            )}
            <div>
              <p className="font-serif font-bold text-sm text-[#2F2A25]">ZIO CLOTHES</p>
              <p className="text-[10px] text-[#756E65] font-semibold">Moda & Confección</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Navigation Scrollable.
            AJUSTE VISUAL: el <nav> real (mismo overflow-y-auto, mismo
            padding/espaciado, mismo comportamiento de scroll de siempre)
            se envuelve en un div `relative` que absorbe el `flex-1` que
            antes tenía el propio <nav> -- así las flechas de
            ScrollEdgeArrows, posicionadas `absolute` dentro de ese div,
            quedan ancladas al panel (no se desplazan con el contenido ni
            restan espacio) sin alterar el tamaño real de la zona
            scrolleable. `.no-native-scrollbar` (index.css) solo oculta la
            representación visual nativa del scrollbar -- el scroll real
            (rueda, trackpad, touch, teclado) sigue intacto. */}
        <div className="relative flex-1 min-h-0">
          <nav ref={navRef} className="h-full overflow-y-auto p-3 space-y-5 no-native-scrollbar">
          {sections.map((section, sIdx) => {
            const visibleItems = section.items.filter((item) => canView(item.id));

            if (visibleItems.length === 0) return null;

            return (
              <div key={sIdx} className="space-y-1">
                <span className="px-3 text-[10px] uppercase tracking-wider font-bold text-[#756E65]">
                  {section.title}
                </span>
                <div className="space-y-0.5 mt-1">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeView === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onNavigate(item.id);
                          if (window.innerWidth < 1024) onClose();
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition text-left ${
                          isActive
                            ? 'bg-[#2F2A25] text-white shadow-xs font-bold'
                            : 'text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8]'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 ${
                            isActive ? 'text-[#E8DCC8]' : 'text-[#756E65]'
                          }`}
                        />
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <span className="px-1.5 py-0.5 rounded-md bg-[#FAF8F4] text-[9px] font-bold text-[#2F2A25]">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </nav>
          <ScrollEdgeArrows
            canScrollUp={canScrollUp}
            canScrollDown={canScrollDown}
            onScrollUp={() => scrollStep('up')}
            onScrollDown={() => scrollStep('down')}
            labelUp="Ver secciones anteriores del menú"
            labelDown="Ver más secciones del menú"
          />
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-[#E4DDD2] bg-[#F6F1E8]/50">
          <div className="p-3 rounded-2xl bg-white border border-[#E4DDD2] flex items-center gap-2 text-xs">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-[#2F2A25] text-[11px] truncate">Google Sheets Sync</p>
              <p className="text-[9px] text-[#756E65]">Sincronización activa</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
