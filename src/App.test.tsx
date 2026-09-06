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

  const MockAuthContext = createContext<any>(null);

  function MockAuthProviderImpl({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(initialAuthenticated);
    const [currentUser, setCurrentUser] = useState<any>(initialUser);

    const login = async (username: string, password: string): Promise<boolean> => {
      // Credencial fija de prueba -- nunca toca un backend real.
      if (username === 'admin' && password === 'admin123') {
        setCurrentUser({ id: 'USR-T01', nombre: 'Test', apellido: 'User', rol: 'ADMIN' });
        setIsAuthenticated(true);
        return true;
      }
      return false;
    };

    const logout = () => {
      setIsAuthenticated(false);
      setCurrentUser(null);
    };

    const value = {
      isAuthenticated,
      currentUser,
      login,
      logout,
      hasPermission: () => true,
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
const mockedStorageService = storageService as unknown as {
  getCurrentView: ReturnType<typeof vi.fn>;
  saveCurrentView: ReturnType<typeof vi.fn>;
};

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
  setInitialAuth(false, null);
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
