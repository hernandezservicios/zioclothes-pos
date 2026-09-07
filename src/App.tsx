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

// TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL.
//
// Reemplaza el mapa anterior (que mezclaba, sin un criterio consistente,
// permisos funcionales reales reutilizados como si fueran "permiso de
// vista" -- ventas.ver, clientes.ver, etc. -- con códigos que JAMÁS
// existieron en ningún rol real del backend: 'pos.acceso', 'dashboard.ver'
// no tenía siquiera una entrada aquí, 'abonos.ver', 'reportes.ver'. Con
// permisos de SESIÓN reales, ese mapa dejaba a CAJERO/GERENTE/SUPERVISOR/
// VENDEDOR sin poder entrar ni a "Panel Principal" ni -- crítico -- a
// "Caja & Mostrador POS", el módulo operativo principal del negocio,
// porque ningún rol real tenía 'pos.acceso' en Roles_Permisos).
//
// Ahora cada vista real tiene su propio permiso `vista.<id>` dedicado
// (ver RolesController.gs/SeedSetup.gs -- backend, fuente de verdad),
// separado por completo de los permisos funcionales (que siguen
// gatekeeping acciones DENTRO de cada vista, sin ningún cambio: ver
// ReturnsView/CashView/etc.). `id` es exactamente el valor real de
// `AppView` -- ninguno inventado.
const VIEW_PERMISSIONS: Record<AppView, string> = {
  dashboard: 'vista.dashboard',
  pos: 'vista.pos',
  sales: 'vista.sales',
  returns: 'vista.returns',
  products: 'vista.products',
  inventory: 'vista.inventory',
  purchases: 'vista.purchases',
  credits: 'vista.credits',
  installments: 'vista.installments',
  creditNotes: 'vista.creditNotes',
  storeCredits: 'vista.storeCredits',
  cash: 'vista.cash',
  customers: 'vista.customers',
  expenses: 'vista.expenses',
  reports: 'vista.reports',
  settings: 'vista.settings',
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

/** ¿El usuario real autenticado puede ENTRAR a esta vista? */
function isViewAuthorized(view: AppView, hasPermission: (p: string) => boolean): boolean {
  return hasPermission(VIEW_PERMISSIONS[view]);
}

// AUDITORÍA (Fase 10/11) -- helper centralizado de navegación: "si la
// vista solicitada/restaurada no está autorizada, ¿a cuál se redirige?".
// Orden de preferencia: Dashboard (destino tradicional tras un login,
// FASE -- CORREGIR REDIRECCIÓN POST-LOGIN AL DASHBOARD), luego POS
// (vista operativa principal para roles sin Dashboard -- CAJERO/
// VENDEDOR, requisito explícito de esta tarea), luego el resto en su
// orden real de declaración. Devuelve `null` únicamente en el caso
// degenerado de un rol sin NINGUNA vista autorizada (imposible para
// ADMIN, que siempre tiene bypass total en AuthContext.hasPermission).
function pickFirstAuthorizedView(hasPermission: (p: string) => boolean): AppView | null {
  const order: AppView[] = ['dashboard', 'pos', ...VALID_VIEWS.filter((v) => v !== 'dashboard' && v !== 'pos')];
  for (const view of order) {
    if (isViewAuthorized(view, hasPermission)) return view;
  }
  return null;
}

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
  //
  // AUDITORÍA (Fase 10/12): la autorización se valida AQUÍ, dentro del
  // propio inicializador de estado -- que corre de forma síncrona en el
  // primer render, ANTES de la primera pintura -- y no en un useEffect
  // posterior (como antes). Esto evita que una vista no autorizada llegue
  // a renderizarse siquiera por un instante (y, con ella, que sus datos
  // sensibles lleguen a pedirse) tras un F5 con sesión ya válida.
  // `useAuth()` arriba ya deja `hasPermission` disponible en este mismo
  // render porque AuthProvider hidrata `currentUser` de forma igualmente
  // síncrona (mismo patrón, ver AuthContext.tsx).
  const [currentView, setCurrentView] = useState<AppView>(() => {
    const persisted = storageService.getCurrentView();
    if (persisted && (VALID_VIEWS as string[]).includes(persisted) && isViewAuthorized(persisted as AppView, hasPermission)) {
      return persisted as AppView;
    }
    return pickFirstAuthorizedView(hasPermission) || 'dashboard';
  });
  const [navigationFilter, setNavigationFilter] = useState<string | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Cubre el caso que el inicializador de arriba NO puede cubrir: un
  // cambio de usuario SIN desmontar MainAppContent (login -> logout ->
  // login de OTRO usuario en la misma pestaña, Fase 11 -- "se cambia de
  // usuario"/"otro usuario inicia sesión en el mismo navegador"). Si la
  // vista actual ya no está autorizada para el usuario (nuevo o
  // reautenticado) realmente activo, se redirige a la primera autorizada.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!isViewAuthorized(currentView, hasPermission)) {
      setCurrentView(pickFirstAuthorizedView(hasPermission) || 'dashboard');
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
  // AUDITORÍA (Fase 11): el destino preferido tras un login sigue siendo
  // Dashboard (nunca la última vista, ver comentario de arriba) -- pero
  // ahora solo si el usuario recién autenticado de verdad tiene
  // vista.dashboard. Un CAJERO/VENDEDOR sin Dashboard cae a POS (su vista
  // operativa principal, Fase 10), nunca a una vista prohibida.
  const wasAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    const wasAuthenticated = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;
    if (!wasAuthenticated && isAuthenticated) {
      setCurrentView(pickFirstAuthorizedView(hasPermission) || 'dashboard');
      setNavigationFilter(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // AUDITORÍA (Fase 10 -- protección centralizada de navegación):
    // "ocultar el botón no es suficiente". Este es el ÚNICO punto por el
    // que pasa toda navegación real (Sidebar, Navbar, atajo F2, accesos
    // directos de DashboardView/CreditsView/NotificationBell) -- si el
    // usuario autenticado no tiene vista.<target>, se ignora el destino
    // solicitado (así haya llegado por un clic real o por código que
    // manipule `currentView` indirectamente) y se redirige a la primera
    // vista que sí tiene autorizada, sin llegar nunca a renderizar la
    // prohibida.
    if (isAuthenticated && !isViewAuthorized(target, hasPermission)) {
      setNavigationFilter(undefined);
      setCurrentView(pickFirstAuthorizedView(hasPermission) || 'dashboard');
      return;
    }

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
    // AUDITORÍA (Fase 10, capa de defensa final): `currentView` solo
    // debería poder llegar aquí ya autorizado -- el inicializador de
    // estado y los tres puntos de cambio de arriba (efecto de cambio de
    // usuario, efecto de post-login, handleNavigate) ya lo garantizan --
    // pero se revalida explícitamente antes de renderizar CUALQUIER
    // componente, en vez de asumir que esa invariante nunca podría
    // romperse en el futuro. Si por algo llegara a fallar, se renderiza la
    // primera vista autorizada en su lugar (nunca la solicitada), sin
    // pedir sus datos ni montar el componente prohibido ni una sola vez.
    const effectiveView = isViewAuthorized(currentView, hasPermission)
      ? currentView
      : pickFirstAuthorizedView(hasPermission);

    if (!effectiveView) {
      return (
        <div className="flex-1 flex items-center justify-center p-10 text-center">
          <div className="max-w-sm space-y-2">
            <p className="font-serif font-bold text-lg text-[#2F2A25]">Sin acceso a ningún módulo</p>
            <p className="text-sm text-[#756E65]">
              Su usuario no tiene ninguna vista habilitada todavía. Contacte a un administrador para que le asigne acceso desde Configuración → Roles y Permisos.
            </p>
          </div>
        </div>
      );
    }

    switch (effectiveView) {
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
