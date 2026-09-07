import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataStoreProvider } from './context/DataStoreContext';
import { ToastProvider } from './context/ToastContext';
import { NotificationProvider } from './context/NotificationContext';
import { storageService } from './services/storageService';
import { InitialSetupView } from './components/setup/InitialSetupView';
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
import { CreditNotesView } from './components/credits/CreditNotesView';
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
  // FASE 6: 'creditNotes' y 'storeCredits' apuntan a la MISMA pantalla
  // (CreditNotesView) -- son la misma entidad de backend (Creditos_Favor)
  // distinguida por `tipo`, pero cada una es una entrada de Sidebar
  // separada (Notas de Crédito bajo Ventas & Clientes, Créditos a Favor /
  // Vales bajo Créditos & Caja) porque representan conceptos de negocio
  // distintos para quien navega el menú.
  | 'creditNotes'
  | 'storeCredits'
  | 'cash'
  | 'customers'
  | 'expenses'
  | 'reports'
  | 'settings';

// FASE 3.6E (hallazgo de la prueba de F5): mismos códigos de permiso que
// Sidebar.tsx usa para decidir qué mostrar en el menú -- se duplican aquí
// (en vez de importar la config interna de Sidebar) solo para poder
// validar, antes de restaurar una vista persistida, que el usuario
// realmente autenticado todavía tiene permiso sobre ella. 'dashboard' no
// tiene guardia porque todo usuario autenticado puede verla.
const VIEW_PERMISSIONS: Partial<Record<AppView, string>> = {
  pos: 'pos.acceso',
  sales: 'ventas.ver',
  returns: 'devoluciones.ver',
  customers: 'clientes.ver',
  products: 'productos.ver',
  inventory: 'inventario.ver',
  // FASE 3.7D-FIX: Compras es un dominio de permisos propio y real
  // (compras.ver/compras.crear, ver SeedSetup.gs), separado de Inventario
  // -- antes reutilizaba inventario.ver por error, lo que habría dejado
  // fuera a cualquier rol futuro con compras.ver pero sin inventario.ver.
  purchases: 'compras.ver',
  credits: 'creditos.ver',
  installments: 'abonos.ver',
  // FASE 6: mismo permiso real para ambas entradas -- ver `creditNotes`/
  // `storeCredits` en el tipo AppView de arriba.
  creditNotes: 'creditos_favor.ver',
  storeCredits: 'creditos_favor.ver',
  cash: 'caja.ver',
  expenses: 'gastos.ver',
  reports: 'reportes.ver',
  // FASE 3.7G-FIX: 'configuracion.ver' nunca existió en el backend real
  // (ver SeedSetup.gs) -- el permiso real que gatea Configuración es
  // 'admin.configuracion' (usado por SettingsController.gs). Antes de
  // este fix, la vista era técnicamente inalcanzable para cualquier rol
  // no-ADMIN (invisible en la práctica solo porque AuthContext.
  // hasPermission da bypass total a ADMIN).
  settings: 'admin.configuracion',
};

const VALID_VIEWS: AppView[] = [
  'dashboard',
  'pos',
  'sales',
  'returns',
  'products',
  'inventory',
  'purchases',
  'credits',
  'installments',
  'creditNotes',
  'storeCredits',
  'cash',
  'customers',
  'expenses',
  'reports',
  'settings',
];

const MainAppContent: React.FC = () => {
  const { isAuthenticated, currentUser, hasPermission } = useAuth();

  // FASE -- CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN:
  // `storageService.getGoogleAppsScriptUrl()` sigue siendo la ÚNICA
  // fuente de verdad de la URL (Requisito 1) -- este estado solo decide
  // qué pantalla mostrar, nunca introduce un segundo lugar donde vive la
  // configuración. Deliberadamente NO se vuelve a validar contra el
  // backend en cada arranque (Requisito 10 de la fase: "por ahora no
  // hagas un GET obligatorio cada vez que se abre la aplicación") -- solo
  // se comprueba que exista localmente. La validación real ya ocurrió
  // una vez en InitialSetupView antes de guardarla, y sigue disponible
  // bajo demanda vía "Probar conexión" en Configuración.
  const [backendConfigured, setBackendConfigured] = useState<boolean>(
    () => !!storageService.getGoogleAppsScriptUrl()
  );

  // FASE 3.6E (hallazgo de la prueba de F5 de esta fase): antes esta vista
  // siempre nacía en 'dashboard', así que recargar la página estando en
  // POS (u otra vista) a mitad de una operación regresaba al Dashboard --
  // contradice el requisito explícito de esta fase ("no vuelve a
  // Dashboard"). Se hidrata sincrónicamente (Hydration-First, mismo patrón
  // que el carrito del POS) desde la última vista guardada, pero solo si
  // el usuario real autenticado todavía tiene permiso sobre ella; nunca se
  // usa para otorgar acceso, solo para restaurar navegación.
  const [currentView, setCurrentView] = useState<AppView>(() => {
    const persisted = storageService.getCurrentView();
    if (persisted && (VALID_VIEWS as string[]).includes(persisted)) {
      return persisted as AppView;
    }
    return 'dashboard';
  });
  const [navigationFilter, setNavigationFilter] = useState<string | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Si la vista restaurada requiere un permiso que el usuario real
  // autenticado no tiene (ej. sesión distinta en el mismo navegador),
  // se cae a 'dashboard' en vez de mostrar una vista no autorizada.
  useEffect(() => {
    if (!isAuthenticated) return;
    const requiredPermission = VIEW_PERMISSIONS[currentView];
    if (requiredPermission && !hasPermission(requiredPermission as any)) {
      setCurrentView('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, currentUser?.id]);

  // FASE -- CORREGIR REDIRECCIÓN POST-LOGIN AL DASHBOARD:
  // `MainAppContent` NUNCA se desmonta entre un logout y el siguiente
  // login (login/logout son solo transiciones de `isAuthenticated` en
  // contexto, no hay recarga de página) -- por eso `currentView` (arriba)
  // conservaba en memoria la última vista (ej. "products") de la sesión
  // anterior, y un login exitoso simplemente volvía a mostrarla en vez
  // de llevar al Dashboard. La hidratación desde `storageService.
  // getCurrentView()` de la línea de arriba SIGUE siendo necesaria y
  // correcta para su propio propósito (F5 con una sesión YA válida debe
  // restaurar la última vista, FASE 3.6E) -- lo único que faltaba era
  // distinguir ESE caso de un login recién ocurrido.
  //
  // `wasAuthenticatedRef` guarda el valor de `isAuthenticated` del
  // render anterior. Si en el primer render ya llegamos autenticados
  // (sesión restaurada por F5), el ref nace en `true` y este efecto
  // nunca detecta una transición -- se respeta la vista hidratada. Si en
  // cambio detectamos una transición real de `false -> true` (el usuario
  // acaba de escribir sus credenciales y autenticarse, sin importar
  // cuántas veces se repita el ciclo logout/login dentro de la misma
  // pestaña), se fuerza el Dashboard como destino -- la última vista
  // jamás tiene prioridad sobre un login exitoso.
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    const wasAuthenticated = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;
    if (!wasAuthenticated && isAuthenticated) {
      setCurrentView('dashboard');
      setNavigationFilter(undefined);
    }
  }, [isAuthenticated]);

  // Persiste la vista activa en cada cambio, para que un F5 posterior la
  // recupere. Es solo conveniencia de navegación -- nunca decide permisos.
  useEffect(() => {
    storageService.saveCurrentView(currentView);
  }, [currentView]);

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
      creditNotes: 'creditNotes',
      notascredito: 'creditNotes',
      storeCredits: 'storeCredits',
      valestienda: 'storeCredits',
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

  if (!backendConfigured) {
    return <InitialSetupView onConfigured={() => setBackendConfigured(true)} />;
  }

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
      case 'creditNotes':
        return <CreditNotesView tipo="NOTA_CREDITO" />;
      case 'storeCredits':
        return <CreditNotesView tipo="VALE_TIENDA" />;
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
      {/* CORREGIR AUDITORÍA: DataStoreProvider envuelve a AuthProvider (y no
          al revés) para que AuthContext -- que corre login/logout/
          refreshCatalog -- pueda leer useDataStore() y mantener el
          DataStore central sincronizado en esos mismos puntos. */}
      <DataStoreProvider>
        <AuthProvider>
          {/* FASE (sistema global de alertas y notificaciones):
              NotificationProvider necesita useDataStore() (Créditos/
              Productos reales) y useAuth() (permisos) -- por eso vive
              DENTRO de ambos, envolviendo MainAppContent (donde vive
              Navbar, que renderiza la campanita). */}
          <NotificationProvider>
            <MainAppContent />
          </NotificationProvider>
        </AuthProvider>
      </DataStoreProvider>
    </ToastProvider>
  );
}
