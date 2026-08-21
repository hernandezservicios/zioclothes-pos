import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { LoginView } from './components/auth/LoginView';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { POSView } from './components/pos/POSView';
import { DashboardView } from './components/dashboard/DashboardView';
import { SalesView } from './components/sales/SalesView';
import { ReturnsView } from './components/sales/ReturnsView';
import { ProductsView } from './components/products/ProductsView';
import { InventoryView } from './components/inventory/InventoryView';
import { PurchasesView } from './components/expenses/PurchasesView';
import { CreditsView } from './components/credits/CreditsView';
import { InstallmentsView } from './components/credits/InstallmentsView';
import { CashView } from './components/cash/CashView';
import { CustomersView } from './components/customers/CustomersView';
import { ExpensesView } from './components/expenses/ExpensesView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';

export type AppView =
  | 'dashboard'
  | 'pos'
  | 'sales'
  | 'returns'
  | 'products'
  | 'inventory'
  | 'purchases'
  | 'credits'
  | 'installments'
  | 'cash'
  | 'customers'
  | 'expenses'
  | 'reports'
  | 'settings';

const MainAppContent: React.FC = () => {
  const { isAuthenticated, currentUser, hasPermission } = useAuth();
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [navigationFilter, setNavigationFilter] = useState<string | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNavigate = (view: string, filter?: string) => {
    const viewMap: Record<string, AppView> = {
      dashboard: 'dashboard',
      pos: 'pos',
      sales: 'sales',
      ventas: 'sales',
      returns: 'returns',
      devoluciones: 'returns',
      products: 'products',
      productos: 'products',
      inventory: 'inventory',
      inventario: 'inventory',
      purchases: 'purchases',
      compras: 'purchases',
      credits: 'credits',
      creditos: 'credits',
      installments: 'installments',
      abonos: 'installments',
      cash: 'cash',
      caja: 'cash',
      customers: 'customers',
      clientes: 'customers',
      expenses: 'expenses',
      gastos: 'expenses',
      reports: 'reports',
      reportes: 'reports',
      settings: 'settings',
      configuracion: 'settings',
    };

    const target = viewMap[view.toLowerCase()] || (view as AppView);
    setNavigationFilter(filter);
    setCurrentView(target);
  };

  // Keyboard shortcut: F2 or Escape to quickly open POS
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handleNavigate('pos');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isAuthenticated) {
    return <LoginView />;
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView onNavigate={handleNavigate} />;
      case 'pos':
        return <POSView onComplete={() => {}} />;
      case 'sales':
        return <SalesView onNavigateToReturns={() => handleNavigate('returns')} />;
      case 'returns':
        return <ReturnsView />;
      case 'products':
        return <ProductsView />;
      case 'inventory':
        return (
          <InventoryView
            initialTab={
              navigationFilter === 'STOCK_BAJO' ||
              navigationFilter === 'KARDEX' ||
              navigationFilter === 'STOCK_ACTUAL'
                ? (navigationFilter as 'STOCK_BAJO' | 'KARDEX' | 'STOCK_ACTUAL')
                : undefined
            }
          />
        );
      case 'purchases':
        return <PurchasesView />;
      case 'credits':
        return (
          <CreditsView
            initialStatusFilter={
              navigationFilter === 'VENCIDA' ||
              navigationFilter === 'PENDIENTE' ||
              navigationFilter === 'PARCIAL' ||
              navigationFilter === 'PAGADA'
                ? (navigationFilter as 'VENCIDA' | 'PENDIENTE' | 'PARCIAL' | 'PAGADA')
                : undefined
            }
            onNavigateToInstallments={() => handleNavigate('installments')}
          />
        );
      case 'installments':
        return <InstallmentsView />;
      case 'cash':
        return <CashView />;
      case 'customers':
        return <CustomersView />;
      case 'expenses':
        return <ExpensesView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#2F2A25] flex flex-col font-sans selection:bg-[#2F2A25] selection:text-white">
      <Navbar
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        activeView={currentView}
        onNavigate={(view) => handleNavigate(view)}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeView={currentView}
          onNavigate={(view) => handleNavigate(view)}
        />

        <main className="flex-1 overflow-y-auto">{renderCurrentView()}</main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <MainAppContent />
      </AuthProvider>
    </ToastProvider>
  );
}
