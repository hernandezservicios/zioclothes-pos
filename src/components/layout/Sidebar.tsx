import React from 'react';
import { useAuth } from '../../context/AuthContext';
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
  permission?: string;
  badge?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  activeView,
  onNavigate,
}) => {
  const { hasPermission } = useAuth();

  const sections: { title: string; items: MenuItem[] }[] = [
    {
      title: 'Principal',
      items: [
        { id: 'dashboard', label: 'Panel Principal', icon: LayoutDashboard, permission: 'dashboard.ver' },
        { id: 'pos', label: 'Caja & Mostrador POS', icon: ShoppingBag, permission: 'pos.acceso' },
      ],
    },
    {
      title: 'Ventas & Clientes',
      items: [
        { id: 'sales', label: 'Historial de Ventas', icon: Receipt, permission: 'ventas.ver' },
        { id: 'returns', label: 'Devoluciones de Prendas', icon: RotateCcw, permission: 'devoluciones.ver' },
        { id: 'customers', label: 'Directorio de Clientes', icon: Users, permission: 'clientes.ver' },
      ],
    },
    {
      title: 'Catálogo & Inventario',
      items: [
        { id: 'products', label: 'Prendas, Tallas & Colores', icon: Shirt, permission: 'productos.ver' },
        { id: 'inventory', label: 'Kardex & Ajuste Stock', icon: Boxes, permission: 'inventario.ver' },
        { id: 'purchases', label: 'Órdenes de Compra', icon: Truck, permission: 'inventario.ver' },
      ],
    },
    {
      title: 'Créditos & Caja',
      items: [
        { id: 'credits', label: 'Cuentas por Cobrar', icon: CreditCard, permission: 'creditos.ver' },
        { id: 'installments', label: 'Abonos Recibidos', icon: Coins, permission: 'abonos.ver' },
        { id: 'cash', label: 'Caja & Cuadres de Turno', icon: Wallet, permission: 'caja.ver' },
      ],
    },
    {
      title: 'Finanzas & Sistema',
      items: [
        { id: 'expenses', label: 'Gastos Operativos', icon: DollarSign, permission: 'gastos.ver' },
        { id: 'reports', label: 'Reportes & Margen', icon: BarChart3, permission: 'reportes.ver' },
        { id: 'settings', label: 'Configuración & Sheets', icon: Settings, permission: 'configuracion.ver' },
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

      {/* Drawer */}
      <aside
        id="sidebar"
        className={`no-print fixed top-0 bottom-0 left-0 z-50 w-72 bg-[#FAF8F4] border-r border-[#E4DDD2] flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:static lg:z-0 shadow-xl lg:shadow-none`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[#E4DDD2] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#2F2A25] flex items-center justify-center">
              <span className="font-serif font-bold text-sm text-[#E8DCC8]">Z</span>
            </div>
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

        {/* Menu Navigation Scrollable */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-5">
          {sections.map((section, sIdx) => {
            const visibleItems = section.items.filter(
              (item) => !item.permission || hasPermission(item.permission as any)
            );

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
