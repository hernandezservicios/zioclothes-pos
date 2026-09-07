import React, { createContext, useContext, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from './App';
import { storageService } from './services/storageService';

/**
 * FASE -- CORREGIR REDIRECCIÓN POST-LOGIN AL DASHBOARD.
 *
 * Ejercita App.tsx (MainAppContent) TAL COMO ES -- Navbar, Sidebar y
 * LoginView se renderizan REALES (son simples, no dependen de datos de
 * catálogo) para reproducir el flujo completo real: navegar a una vista,
 * cerrar sesión (botón real de Navbar), volver a iniciar sesión
 * (formulario real de LoginView) y verificar a qué vista se llega. Las
 * 16 pantallas de contenido (Dashboard, Productos, Clientes, etc.) se
 * sustituyen por marcadores triviales -- no son el objeto de esta prueba
 * y requerirían todo el DataStore/red real para renderizar de verdad.
 *
 * AuthContext se sustituye por una implementación de prueba que usa
 * React Context real (no un objeto plano) para que la propagación de
 * `isAuthenticated` a Navbar/Sidebar/LoginView/MainAppContent sea
 * idéntica a la real -- así la prueba ejercita genuinamente la
 * transición `false -> true` que dispara el fix, no un mock artificial.
 */

vi.mock('./services/storageService', () => ({
  storageService: {
    getCurrentView: vi.fn(() => null),
    saveCurrentView: vi.fn(),
    // FASE (sistema global de alertas y notificaciones): App.tsx ahora
    // también monta NotificationProvider (real, no mockeado aquí -- solo
    // sus datos de origen, DataStoreContext/AuthContext, están
    // mockeados), que llama a estos dos métodos.
    getReadNotificationIds: vi.fn(() => []),
    saveReadNotificationIds: vi.fn(),
    // FASE (configuración inicial del backend antes del login): por
    // defecto YA hay una URL configurada -- así las pruebas de esta
    // suite (login/logout/redirección), que no son sobre esta fase,
    // siguen llegando directo a LoginView sin cambios. Los tests nuevos
    // de "sin URL configurada" la sobrescriben explícitamente.
    getGoogleAppsScriptUrl: vi.fn(() => 'https://script.google.com/macros/s/TEST/exec'),
    setGoogleAppsScriptUrl: vi.fn(),
  },
}));

// FASE (configuración inicial del backend antes del login): App.tsx ahora
// también puede montar InitialSetupView (cuando no hay URL configurada),
// que llama a esto para su "Probar conexión" real -- se mockea aquí para
// no depender de una red real (ya probado a fondo en apiService.test.ts).
vi.mock('./services/apiService', () => ({
  apiService: {
    checkBackendConnection: vi.fn(),
  },
}));

vi.mock('./context/DataStoreContext', () => ({
  DataStoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDataStore: () => ({}),
}));

vi.mock('./context/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('./context/AuthContext', () => {
  // Estado inicial controlable por prueba vía __setInitialAuth -- vive en
  // el cierre de este factory (el módulo mockeado se evalúa una sola
  // vez), simula "esta pestaña ya tenía sesión válida" (F5) vs "recién
  // se muestra el login" (app recién cargada / sesión cerrada).
  let initialAuthenticated = false;
  let initialUser: any = null;
  // TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL: `null` = "todo
  // permitido" (comportamiento EXACTO de antes de esta tarea -- ninguna
  // de las pruebas de login/redirección ya existentes debía verse
  // afectada). Un Set concreto activa un CAJERO/rol restringido real
  // para las pruebas nuevas de esta fase, vía __setGrantedViews o al
  // autenticar con las credenciales de prueba 'cajero'/'vendedor' de abajo.
  let grantedViews: Set<string> | null = null;

  // Matrices reales (idénticas a VIEW_PERMISSIONS_BY_ROLE en
  // SeedSetup.gs/DEFAULT_VIEW_PERMISSIONS en permissionsCatalog.ts) --
  // usadas solo por las credenciales de prueba 'cajero'/'vendedor' de
  // abajo, para reproducir un login real de esos roles sin mockear el
  // sistema de permisos en sí.
  const CAJERO_VIEWS = ['pos', 'sales', 'returns', 'products', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers'];
  const VENDEDOR_VIEWS = ['pos', 'sales', 'products', 'creditNotes', 'storeCredits', 'customers'];

  const MockAuthContext = createContext<any>(null);

  function MockAuthProviderImpl({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(initialAuthenticated);
    const [currentUser, setCurrentUser] = useState<any>(initialUser);

    const login = async (username: string, password: string): Promise<boolean> => {
      // Credenciales fijas de prueba -- nunca tocan un backend real.
      if (username === 'admin' && password === 'admin123') {
        grantedViews = null;
        setCurrentUser({ id: 'USR-T01', nombre: 'Test', apellido: 'User', rol: 'ADMIN' });
        setIsAuthenticated(true);
        return true;
      }
      if (username === 'cajero' && password === 'cajero123') {
        grantedViews = new Set(CAJERO_VIEWS);
        setCurrentUser({ id: 'USR-T02', nombre: 'Cajero', apellido: 'Test', rol: 'CAJERO' });
        setIsAuthenticated(true);
        return true;
      }
      if (username === 'vendedor' && password === 'vendedor123') {
        grantedViews = new Set(VENDEDOR_VIEWS);
        setCurrentUser({ id: 'USR-T03', nombre: 'Vendedor', apellido: 'Test', rol: 'VENDEDOR' });
        setIsAuthenticated(true);
        return true;
      }
      return false;
    };

    const logout = () => {
      setIsAuthenticated(false);
      setCurrentUser(null);
    };

    const hasPermission = (perm: string) => {
      if (grantedViews === null) return true;
      if (perm.indexOf('vista.') === 0) return grantedViews.has(perm.slice('vista.'.length));
      return true; // permisos funcionales -- no es el objeto de estas pruebas de vistas.
    };

    const value = {
      isAuthenticated,
      currentUser,
      login,
      logout,
      hasPermission,
      // TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL: mismo criterio que
      // hasPermission -- reutiliza la MISMA variable de cierre, nunca un
      // catálogo aparte (igual que el AuthContext.canView real, que
      // también delega en hasPermission).
      canView: (viewId: string) => hasPermission(`vista.${viewId}`),
      settings: { logoUrl: '', nombreNegocio: 'ZIO CLOTHES', simboloMoneda: 'RD$' },
      activeCashSession: null,
    };

    return <MockAuthContext.Provider value={value}>{children}</MockAuthContext.Provider>;
  }

  return {
    AuthProvider: MockAuthProviderImpl,
    useAuth: () => useContext(MockAuthContext),
    __setInitialAuth: (authenticated: boolean, user: any) => {
      initialAuthenticated = authenticated;
      initialUser = user;
    },
    __setGrantedViews: (views: string[] | null) => {
      grantedViews = views ? new Set(views) : null;
    },
  };
});

// Marcadores triviales para las 16 pantallas de contenido -- no son el
// objeto de esta prueba (cada una tiene o puede tener su propio test
// dedicado por separado).
vi.mock('./components/dashboard/DashboardView', () => ({ DashboardView: () => <div>MOCK_DASHBOARD_VIEW</div> }));
vi.mock('./components/pos/POSView', () => ({ POSView: () => <div>MOCK_POS_VIEW</div> }));
vi.mock('./components/sales/SalesView', () => ({ SalesView: () => <div>MOCK_SALES_VIEW</div> }));
vi.mock('./components/sales/ReturnsView', () => ({ ReturnsView: () => <div>MOCK_RETURNS_VIEW</div> }));
vi.mock('./components/products/ProductsView', () => ({ ProductsView: () => <div>MOCK_PRODUCTS_VIEW</div> }));
vi.mock('./components/inventory/InventoryView', () => ({ InventoryView: () => <div>MOCK_INVENTORY_VIEW</div> }));
vi.mock('./components/expenses/PurchasesView', () => ({ PurchasesView: () => <div>MOCK_PURCHASES_VIEW</div> }));
vi.mock('./components/credits/CreditsView', () => ({ CreditsView: () => <div>MOCK_CREDITS_VIEW</div> }));
vi.mock('./components/credits/InstallmentsView', () => ({ InstallmentsView: () => <div>MOCK_INSTALLMENTS_VIEW</div> }));
vi.mock('./components/credits/CreditNotesView', () => ({ CreditNotesView: () => <div>MOCK_CREDIT_NOTES_VIEW</div> }));
vi.mock('./components/cash/CashView', () => ({ CashView: () => <div>MOCK_CASH_VIEW</div> }));
vi.mock('./components/customers/CustomersView', () => ({ CustomersView: () => <div>MOCK_CUSTOMERS_VIEW</div> }));
vi.mock('./components/expenses/ExpensesView', () => ({ ExpensesView: () => <div>MOCK_EXPENSES_VIEW</div> }));
vi.mock('./components/reports/ReportsView', () => ({ ReportsView: () => <div>MOCK_REPORTS_VIEW</div> }));
vi.mock('./components/settings/SettingsView', () => ({ SettingsView: () => <div>MOCK_SETTINGS_VIEW</div> }));

// Navbar y Sidebar se dejan REALES (no mockeados) -- son simples,
// dependen únicamente de useAuth(), y dan acceso a un botón de logout
// real ("Cerrar Sesión") y a los ítems reales del menú ("Productos",
// "Clientes", etc.), necesarios para reproducir el flujo genuino de
// navegar -> cerrar sesión -> iniciar sesión.

const authContextMock = await import('./context/AuthContext');
const setInitialAuth = (authContextMock as any).__setInitialAuth as (authenticated: boolean, user: any) => void;
const setGrantedViews = (authContextMock as any).__setGrantedViews as (views: string[] | null) => void;
const mockedStorageService = storageService as unknown as {
  getCurrentView: ReturnType<typeof vi.fn>;
  saveCurrentView: ReturnType<typeof vi.fn>;
  getGoogleAppsScriptUrl: ReturnType<typeof vi.fn>;
  setGoogleAppsScriptUrl: ReturnType<typeof vi.fn>;
};
const CONFIGURED_URL = 'https://script.google.com/macros/s/TEST/exec';

async function loginAs(username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('ej. admin'), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /Acceder al Sistema/i }));
  await waitFor(() => {});
}

function logout() {
  fireEvent.click(screen.getByTitle('Cerrar Sesión'));
}

const TEST_USER = { id: 'USR-T01', nombre: 'Test', apellido: 'User', rol: 'ADMIN' };

beforeEach(() => {
  vi.clearAllMocks();
  mockedStorageService.getCurrentView.mockReturnValue(null);
  // Por defecto, instalación YA configurada -- las pruebas de login/
  // redirección de esta suite (no relacionadas con esta fase) siguen
  // viendo exactamente el mismo comportamiento de antes. Los tests de
  // "sin URL" la sobrescriben explícitamente a ''.
  mockedStorageService.getGoogleAppsScriptUrl.mockReturnValue(CONFIGURED_URL);
  setInitialAuth(false, null);
  setGrantedViews(null);
});
afterEach(() => {
  cleanup();
});

describe('App -- LOGIN exitoso siempre lleva al Dashboard, sin importar la última vista', () => {
  it('TEST 1: última vista = Productos -> logout -> login -> Dashboard', async () => {
    setInitialAuth(true, TEST_USER);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Productos' }));
    expect(screen.getByText('MOCK_PRODUCTS_VIEW')).toBeInTheDocument();

    logout();
    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();

    await loginAs('admin', 'admin123');

    expect(screen.getByText('MOCK_DASHBOARD_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_PRODUCTS_VIEW')).not.toBeInTheDocument();
  });

  it('TEST 2: última vista = Clientes -> logout -> login -> Dashboard', async () => {
    setInitialAuth(true, TEST_USER);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Clientes' }));
    expect(screen.getByText('MOCK_CUSTOMERS_VIEW')).toBeInTheDocument();

    logout();
    await loginAs('admin', 'admin123');

    expect(screen.getByText('MOCK_DASHBOARD_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_CUSTOMERS_VIEW')).not.toBeInTheDocument();
  });

  it('TEST 3: última vista = Ventas -> logout -> login -> Dashboard', async () => {
    setInitialAuth(true, TEST_USER);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Historial de Ventas' }));
    expect(screen.getByText('MOCK_SALES_VIEW')).toBeInTheDocument();

    logout();
    await loginAs('admin', 'admin123');

    expect(screen.getByText('MOCK_DASHBOARD_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_SALES_VIEW')).not.toBeInTheDocument();
  });

  it('TEST 4: última vista = Configuración -> logout -> login -> Dashboard', async () => {
    setInitialAuth(true, TEST_USER);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    expect(screen.getByText('MOCK_SETTINGS_VIEW')).toBeInTheDocument();

    logout();
    await loginAs('admin', 'admin123');

    expect(screen.getByText('MOCK_DASHBOARD_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_SETTINGS_VIEW')).not.toBeInTheDocument();
  });

  it('TEST 5: sin última vista almacenada -> login -> Dashboard', async () => {
    mockedStorageService.getCurrentView.mockReturnValue(null);
    setInitialAuth(false, null);
    render(<App />);

    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();
    await loginAs('admin', 'admin123');

    expect(screen.getByText('MOCK_DASHBOARD_VIEW')).toBeInTheDocument();
  });

  it('TEST 6: valor de última vista en localStorage ("settings") -> login exitoso -> Dashboard', async () => {
    // Simula una pestaña/sesión anterior que dejó "settings" persistido
    // (ej. el navegador se cerró estando en Configuración) y ahora se
    // abre la app sin sesión activa -- el login recién ocurrido nunca
    // debe usar ese valor guardado como destino.
    mockedStorageService.getCurrentView.mockReturnValue('settings');
    setInitialAuth(false, null);
    render(<App />);

    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();
    await loginAs('admin', 'admin123');

    expect(screen.getByText('MOCK_DASHBOARD_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_SETTINGS_VIEW')).not.toBeInTheDocument();
  });

  it('TEST 7: login incorrecto -> NO redirige, permanece en Login, muestra error', async () => {
    setInitialAuth(false, null);
    render(<App />);

    await loginAs('admin', 'contraseña-incorrecta');

    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();
    expect(screen.getByText('Usuario o contraseña incorrectos')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_DASHBOARD_VIEW')).not.toBeInTheDocument();
  });

  it('TEST 8: refresh con sesión ya existente -> respeta la última vista restaurada (no rompe la restauración normal)', () => {
    // Simula un F5: la sesión YA es válida en el primer render de este
    // montaje (no hay una transición false->true dentro de esta prueba),
    // exactamente como ocurre en la app real cuando AuthContext ya
    // resolvió una sesión existente antes de que MainAppContent monte.
    mockedStorageService.getCurrentView.mockReturnValue('customers');
    setInitialAuth(true, TEST_USER);
    render(<App />);

    expect(screen.getByText('MOCK_CUSTOMERS_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('MOCK_DASHBOARD_VIEW')).not.toBeInTheDocument();
  });
});

describe('App -- configuración inicial del backend antes del Login', () => {
  it('sin URL configurada (instalación/navegador nuevo): muestra InitialSetupView, nunca LoginView', () => {
    mockedStorageService.getGoogleAppsScriptUrl.mockReturnValue('');
    setInitialAuth(false, null);
    render(<App />);

    expect(screen.getByText('Configuración Inicial')).toBeInTheDocument();
    expect(screen.queryByText('Iniciar Sesión')).not.toBeInTheDocument();
  });

  it('con URL ya configurada (instalación existente): NO muestra InitialSetupView, muestra Login directo', () => {
    mockedStorageService.getGoogleAppsScriptUrl.mockReturnValue(CONFIGURED_URL);
    setInitialAuth(false, null);
    render(<App />);

    expect(screen.queryByText('Configuración Inicial')).not.toBeInTheDocument();
    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();
  });

  it('al completar la configuración inicial con éxito, pasa a mostrar el Login (no exige la URL de nuevo)', async () => {
    const { apiService } = await import('./services/apiService');
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: true,
      message: 'Conexión establecida correctamente.',
      data: { status: 'ONLINE', spreadsheetConnected: true },
    });

    mockedStorageService.getGoogleAppsScriptUrl.mockReturnValue('');
    setInitialAuth(false, null);
    render(<App />);

    expect(screen.getByText('Configuración Inicial')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/https:\/\/script\.google\.com/i), {
      target: { value: CONFIGURED_URL },
    });
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));
    await screen.findByRole('button', { name: /Continuar/i });
    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    expect(mockedStorageService.setGoogleAppsScriptUrl).toHaveBeenCalledWith(CONFIGURED_URL);
    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();
    expect(screen.queryByText('Configuración Inicial')).not.toBeInTheDocument();
  });
});

/**
 * TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL (Fase 18).
 *
 * Ejercita App.tsx/Sidebar.tsx/Navbar.tsx REALES contra `hasPermission`/
 * `canView` controlados vía `__setGrantedViews` (mismas matrices reales
 * de VIEW_PERMISSIONS_BY_ROLE en SeedSetup.gs) -- nunca compara contra
 * `currentUser.rol` en ningún punto del código bajo prueba.
 */
describe('TAREA -- permisos de vista por rol: Sidebar (Fase 18)', () => {
  const ALL_VIEW_LABELS = [
    'Panel Principal', 'Caja & Mostrador POS', 'Historial de Ventas', 'Devoluciones', 'Notas de Crédito',
    'Clientes', 'Productos', 'Inventario / Kardex', 'Órdenes de Compra', 'Cuentas por Cobrar',
    'Abonos Recibidos', 'Créditos a Favor / Vales', 'Caja & Cuadres de Turno', 'Gastos Operativos',
    'Reportes & Margen', 'Configuración',
  ];

  it('ADMIN -> todas las vistas permitidas (bypass total real de AuthContext.hasPermission)', () => {
    setGrantedViews(null);
    setInitialAuth(true, TEST_USER);
    render(<App />);
    ALL_VIEW_LABELS.forEach((label) => expect(screen.getByRole('button', { name: label })).toBeInTheDocument());
  });

  it('GERENTE -> coincide con su matriz real (todas las vistas, igual que ADMIN)', () => {
    setGrantedViews(['dashboard', 'pos', 'sales', 'returns', 'products', 'inventory', 'purchases', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers', 'expenses', 'reports', 'settings']);
    setInitialAuth(true, { id: 'USR-T04', nombre: 'Gerente', apellido: 'Test', rol: 'GERENTE' });
    render(<App />);
    ALL_VIEW_LABELS.forEach((label) => expect(screen.getByRole('button', { name: label })).toBeInTheDocument());
  });

  it('SUPERVISOR -> coincide con su matriz real (sin Dashboard ni Configuración; con Inventario/Compras/Gastos/Reportes)', () => {
    setGrantedViews(['pos', 'sales', 'returns', 'products', 'inventory', 'purchases', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers', 'expenses', 'reports']);
    setInitialAuth(true, { id: 'USR-T05', nombre: 'Supervisor', apellido: 'Test', rol: 'SUPERVISOR' });
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Panel Principal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configuración' })).not.toBeInTheDocument();
    ['Caja & Mostrador POS', 'Inventario / Kardex', 'Órdenes de Compra', 'Gastos Operativos', 'Reportes & Margen'].forEach((label) =>
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    );
  });

  it('CAJERO -> POS permitido; Dashboard/Reportes/Configuración bloqueados (Usuarios y Roles y Permisos viven dentro de Configuración, también bloqueados)', () => {
    setGrantedViews(['pos', 'sales', 'returns', 'products', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers']);
    setInitialAuth(true, { id: 'USR-T02', nombre: 'Cajero', apellido: 'Test', rol: 'CAJERO' });
    render(<App />);

    // Mínimo operativo explícito de la Fase 8.
    ['Caja & Mostrador POS', 'Clientes', 'Devoluciones', 'Caja & Cuadres de Turno'].forEach((label) =>
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    );
    // Bloqueado por defecto (Fase 8, explícito).
    expect(screen.queryByRole('button', { name: 'Panel Principal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reportes & Margen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configuración' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inventario / Kardex' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Órdenes de Compra' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gastos Operativos' })).not.toBeInTheDocument();
  });

  it('VENDEDOR -> POS permitido; vistas administrativas y operativas avanzadas bloqueadas', () => {
    setGrantedViews(['pos', 'sales', 'products', 'creditNotes', 'storeCredits', 'customers']);
    setInitialAuth(true, { id: 'USR-T03', nombre: 'Vendedor', apellido: 'Test', rol: 'VENDEDOR' });
    render(<App />);

    expect(screen.getByRole('button', { name: 'Caja & Mostrador POS' })).toBeInTheDocument();
    ['Panel Principal', 'Configuración', 'Cuentas por Cobrar', 'Caja & Cuadres de Turno', 'Inventario / Kardex', 'Reportes & Margen'].forEach((label) =>
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    );
  });
});

describe('TAREA -- protección centralizada de navegación (Fase 10/18)', () => {
  it('currentView=dashboard persistido + usuario CAJERO (sin vista.dashboard) -> nunca renderiza Dashboard, redirige a una vista autorizada', () => {
    mockedStorageService.getCurrentView.mockReturnValue('dashboard');
    setGrantedViews(['pos', 'sales', 'returns', 'products', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers']);
    setInitialAuth(true, { id: 'USR-T02', nombre: 'Cajero', apellido: 'Test', rol: 'CAJERO' });
    render(<App />);

    expect(screen.queryByText('MOCK_DASHBOARD_VIEW')).not.toBeInTheDocument();
    // POS es la primera vista autorizada según el orden de preferencia (Fase 10).
    expect(screen.getByText('MOCK_POS_VIEW')).toBeInTheDocument();
  });

  it('currentView=reports persistido + usuario CAJERO -> nunca renderiza Reportes, resultado = bloqueo/redirección', () => {
    mockedStorageService.getCurrentView.mockReturnValue('reports');
    setGrantedViews(['pos', 'sales', 'returns', 'products', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers']);
    setInitialAuth(true, { id: 'USR-T02', nombre: 'Cajero', apellido: 'Test', rol: 'CAJERO' });
    render(<App />);

    expect(screen.queryByText('MOCK_REPORTS_VIEW')).not.toBeInTheDocument();
    expect(screen.getByText('MOCK_POS_VIEW')).toBeInTheDocument();
  });

  it('un disparador de navegación que NO está gateado individualmente (logo de Navbar -> dashboard) igual queda bloqueado por el despachador central de handleNavigate', () => {
    // El logo/marca de Navbar dispara onNavigate('dashboard') sin ningún
    // hasPermission/canView propio (a diferencia del botón "Punto de
    // Venta", que sí tiene su propio canView('pos')) -- justo el caso que
    // Fase 10 pide cubrir: "ocultar el botón no es suficiente".
    setGrantedViews(['pos', 'sales', 'returns', 'products', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers']);
    setInitialAuth(true, { id: 'USR-T02', nombre: 'Cajero', apellido: 'Test', rol: 'CAJERO' });
    render(<App />);

    // "ZIO CLOTHES" aparece dos veces (marca de Navbar Y de Sidebar) --
    // la primera en el árbol es la de Navbar (el logo clicable real).
    fireEvent.click(screen.getAllByText('ZIO CLOTHES')[0]);
    expect(screen.queryByText('MOCK_DASHBOARD_VIEW')).not.toBeInTheDocument();
    expect(screen.getByText('MOCK_POS_VIEW')).toBeInTheDocument();
  });

  it('una navegación real a una vista SÍ autorizada sigue funcionando con normalidad (el guard no rompe la navegación legítima)', () => {
    setGrantedViews(['pos', 'sales', 'returns', 'products', 'credits', 'installments', 'creditNotes', 'storeCredits', 'cash', 'customers']);
    setInitialAuth(true, { id: 'USR-T02', nombre: 'Cajero', apellido: 'Test', rol: 'CAJERO' });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Clientes' }));
    expect(screen.getByText('MOCK_CUSTOMERS_VIEW')).toBeInTheDocument();
  });
});

describe('TAREA -- persistencia entre usuarios distintos en el mismo navegador (Fase 11/18)', () => {
  it('usuario A (ADMIN, en Configuración) hace logout; usuario B (CAJERO) inicia sesión -> currentView anterior no autorizado, resultado = primera vista autorizada', async () => {
    setInitialAuth(true, TEST_USER);
    setGrantedViews(null);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    expect(screen.getByText('MOCK_SETTINGS_VIEW')).toBeInTheDocument();

    logout();
    expect(screen.getByText('Iniciar Sesión')).toBeInTheDocument();

    await loginAs('cajero', 'cajero123');

    expect(screen.queryByText('MOCK_SETTINGS_VIEW')).not.toBeInTheDocument();
    expect(screen.getByText('MOCK_POS_VIEW')).toBeInTheDocument();
  });
});
