import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Product, Category, Size, Color, Supplier, Sale, AccountReceivable, Expense, CreditNote } from '../types';
import { storageService } from '../services/storageService';
import { productsApi, mapProduct } from '../services/productsApi';
import { customersApi, CustomerWithCredit, mapCustomer } from '../services/customersApi';
import { salesApi } from '../services/salesApi';
import { creditsApi } from '../services/creditsApi';
import { creditNotesApi } from '../services/creditNotesApi';
import { expensesApi } from '../services/expensesApi';

/**
 * CORREGIR AUDITORÍA (fase de arquitectura de datos) — DataStore central.
 *
 * Antes de este archivo, cada vista (ProductsView, InventoryView,
 * PurchasesView, SalesView, ReturnsView, CreditsView, InstallmentsView,
 * DashboardView, ReportsView) mantenía su PROPIO useState y su PROPIA
 * llamada a la API para exactamente los mismos datos (ver informe de
 * auditoría: products.list se pedía desde 3 archivos distintos, sales.list
 * desde 4, credits.list desde 4), y el POS leía una tercera fuente más
 * (storageService/localStorage) completamente desconectada de las
 * anteriores. Este Context reemplaza esas copias por UNA sola fuente de
 * verdad en memoria para los dominios que de verdad se comparten entre
 * vistas: productos+auxiliares, clientes, ventas, créditos y gastos.
 *
 * Reglas de diseño (derivadas directamente de la orden "CORREGIR
 * AUDITORÍA"):
 *  - El backend (Google Sheets vía Apps Script) sigue siendo la única
 *    fuente de verdad real. Este Context es un CACHÉ en memoria de lo que
 *    el backend confirmó por última vez, nunca una autoridad paralela.
 *  - `storageService`/localStorage sigue existiendo para persistencia
 *    entre sesiones e hidratación inicial (F5) -- pero deja de ser lo que
 *    las vistas leen en vivo. Aquí solo se usa para el primer render
 *    (antes de la primera confirmación de red) y se mantiene actualizado
 *    en paralelo para que esa hidratación siga siendo correcta la próxima
 *    vez.
 *  - TTL simple por dominio: si el dominio ya se refrescó hace menos de
 *    su TTL y no se pide `force`, `refreshX()` no dispara ninguna llamada
 *    de red -- solo confirma que los datos en memoria siguen vigentes.
 *  - Deduplicación de peticiones simultáneas idénticas ya la resuelve
 *    apiService.ts (por acción+datos+token). Aquí, además, un contador de
 *    generación por dominio evita que una respuesta vieja que resuelve
 *    tarde (fuera de orden) sobrescriba una más nueva.
 *  - Después de una mutación exitosa (crear/editar/eliminar producto,
 *    venta, abono, etc.), el componente que ejecutó la mutación es quien
 *    decide qué dominio(s) invalidar, llamando a refreshX({force:true}) --
 *    este Context no intercepta llamadas de mutación por su cuenta.
 */

const PRODUCTS_TTL_MS = 45_000;
const CUSTOMERS_TTL_MS = 60_000;
const SALES_TTL_MS = 20_000;
const CREDITS_TTL_MS = 20_000;
const CREDIT_NOTES_TTL_MS = 20_000;
const EXPENSES_TTL_MS = 30_000;

export interface BootstrapBundle {
  products?: any[];
  customers?: any[];
  categories?: any[];
  sizes?: any[];
  colors?: any[];
  suppliers?: any[];
}

export interface RefreshOptions {
  /** Ignora el TTL y fuerza una llamada de red real. */
  force?: boolean;
}

interface DataStoreContextType {
  products: Product[];
  categories: Category[];
  sizes: Size[];
  colors: Color[];
  suppliers: Supplier[];
  productsLoading: boolean;
  productsError: string | null;
  /** true si los `products` mostrados son de una carga anterior a un intento fallido más reciente. */
  productsStale: boolean;

  customers: CustomerWithCredit[];
  customersLoading: boolean;
  customersError: string | null;
  customersStale: boolean;

  sales: Sale[];
  salesLoading: boolean;
  salesError: string | null;
  salesStale: boolean;

  credits: AccountReceivable[];
  creditsLoading: boolean;
  creditsError: string | null;
  creditsStale: boolean;

  /** FASE 6 -- Créditos a Favor / Vales y Notas de Crédito (Creditos_Favor real, distinguidos por `tipo`). */
  creditNotes: CreditNote[];
  creditNotesLoading: boolean;
  creditNotesError: string | null;
  creditNotesStale: boolean;

  expenses: Expense[];
  expensesLoading: boolean;
  expensesError: string | null;
  expensesStale: boolean;

  refreshProducts: (opts?: RefreshOptions) => Promise<boolean>;
  refreshCustomers: (opts?: RefreshOptions) => Promise<boolean>;
  refreshSales: (opts?: RefreshOptions) => Promise<boolean>;
  refreshCredits: (opts?: RefreshOptions) => Promise<boolean>;
  refreshCreditNotes: (opts?: RefreshOptions) => Promise<boolean>;
  refreshExpenses: (opts?: RefreshOptions) => Promise<boolean>;

  /**
   * Hidrata el DataStore con el MISMO viaje de red que ya hizo
   * system.getBootstrapData (login / "Sincronizar Ahora") -- nunca dispara
   * una llamada nueva. AuthContext es el único llamador esperado.
   */
  hydrateFromBootstrap: (bundle: BootstrapBundle) => void;

  /** Vacía el DataStore en memoria (logout) para no arrastrar datos de una sesión/usuario anterior. */
  clear: () => void;

  /**
   * Lectura imperativa del valor MÁS RECIENTE (no la copia capturada en el
   * closure del render actual) -- para el caso puntual de un handler
   * async que necesita el array recién actualizado justo después de
   * `await refreshX({force:true})`, sin esperar al siguiente render.
   */
  getProducts: () => Product[];
  getCustomers: () => CustomerWithCredit[];
}

const DataStoreContext = createContext<DataStoreContextType | undefined>(undefined);

export const DataStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>(() => storageService.getProducts());
  const [categories, setCategories] = useState<Category[]>(() => storageService.getCategories());
  const [sizes, setSizes] = useState<Size[]>(() => storageService.getSizes());
  const [colors, setColors] = useState<Color[]>(() => storageService.getColors());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => storageService.getSuppliers());
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsStale, setProductsStale] = useState(false);
  const productsLastFetch = useRef(0);
  const productsGen = useRef(0);

  const [customers, setCustomers] = useState<CustomerWithCredit[]>(() => storageService.getCustomers() as CustomerWithCredit[]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [customersStale, setCustomersStale] = useState(false);
  const customersLastFetch = useRef(0);
  const customersGen = useRef(0);

  const [sales, setSales] = useState<Sale[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [salesStale, setSalesStale] = useState(false);
  const salesLastFetch = useRef(0);
  const salesGen = useRef(0);

  const [credits, setCredits] = useState<AccountReceivable[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [creditsError, setCreditsError] = useState<string | null>(null);
  const [creditsStale, setCreditsStale] = useState(false);
  const creditsLastFetch = useRef(0);
  const creditsGen = useRef(0);

  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [creditNotesLoading, setCreditNotesLoading] = useState(false);
  const [creditNotesError, setCreditNotesError] = useState<string | null>(null);
  const [creditNotesStale, setCreditNotesStale] = useState(false);
  const creditNotesLastFetch = useRef(0);
  const creditNotesGen = useRef(0);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [expensesStale, setExpensesStale] = useState(false);
  const expensesLastFetch = useRef(0);
  const expensesGen = useRef(0);

  // Espejo imperativo de products/customers -- ver getProducts()/getCustomers().
  const productsRef = useRef<Product[]>(products);
  const customersRef = useRef<CustomerWithCredit[]>(customers);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);
  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);
  const getProducts = useCallback(() => productsRef.current, []);
  const getCustomers = useCallback(() => customersRef.current, []);

  const refreshProducts = useCallback(async (opts?: RefreshOptions): Promise<boolean> => {
    const now = Date.now();
    if (!opts?.force && now - productsLastFetch.current < PRODUCTS_TTL_MS) {
      return true; // Datos ya vigentes dentro del TTL -- no se pide nada al backend.
    }
    const myGen = ++productsGen.current;
    setProductsLoading(true);

    const [productsRes, auxRes] = await Promise.all([productsApi.list(), productsApi.listAuxiliaries()]);
    if (myGen !== productsGen.current) return false; // Una petición más nueva ya está en curso/resuelta -- se descarta esta.

    if (!productsRes.success) {
      setProductsError(productsRes.message || 'No se pudo cargar el catálogo de productos.');
      setProductsStale((products || []).length > 0);
      setProductsLoading(false);
      return false;
    }

    const newProducts = productsRes.data || [];
    setProducts(newProducts);
    storageService.saveProducts(newProducts);
    setProductsError(null);
    setProductsStale(false);
    productsLastFetch.current = now;

    if (auxRes.success && auxRes.data) {
      setCategories(auxRes.data.categories);
      setSizes(auxRes.data.sizes);
      setColors(auxRes.data.colors);
      setSuppliers(auxRes.data.suppliers);
      storageService.saveCategories(auxRes.data.categories);
      storageService.saveSizes(auxRes.data.sizes);
      storageService.saveColors(auxRes.data.colors);
      storageService.saveSuppliers(auxRes.data.suppliers);
    }

    setProductsLoading(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCustomers = useCallback(async (opts?: RefreshOptions): Promise<boolean> => {
    const now = Date.now();
    if (!opts?.force && now - customersLastFetch.current < CUSTOMERS_TTL_MS) return true;
    const myGen = ++customersGen.current;
    setCustomersLoading(true);

    const res = await customersApi.list();
    if (myGen !== customersGen.current) return false;

    if (!res.success) {
      setCustomersError(res.message || 'No se pudo cargar la lista de clientes.');
      setCustomersStale((customers || []).length > 0);
      setCustomersLoading(false);
      return false;
    }

    const newCustomers = res.data || [];
    setCustomers(newCustomers);
    storageService.saveCustomers(newCustomers);
    setCustomersError(null);
    setCustomersStale(false);
    customersLastFetch.current = now;
    setCustomersLoading(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSales = useCallback(async (opts?: RefreshOptions): Promise<boolean> => {
    const now = Date.now();
    if (!opts?.force && now - salesLastFetch.current < SALES_TTL_MS) return true;
    const myGen = ++salesGen.current;
    setSalesLoading(true);

    const res = await salesApi.list();
    if (myGen !== salesGen.current) return false;

    if (!res.success) {
      setSalesError(res.message || 'No se pudo obtener el historial de ventas desde el backend.');
      setSalesStale((sales || []).length > 0);
      setSalesLoading(false);
      return false;
    }

    setSales(res.data || []);
    setSalesError(null);
    setSalesStale(false);
    salesLastFetch.current = now;
    setSalesLoading(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCredits = useCallback(async (opts?: RefreshOptions): Promise<boolean> => {
    const now = Date.now();
    if (!opts?.force && now - creditsLastFetch.current < CREDITS_TTL_MS) return true;
    const myGen = ++creditsGen.current;
    setCreditsLoading(true);

    const res = await creditsApi.list();
    if (myGen !== creditsGen.current) return false;

    if (!res.success) {
      setCreditsError(res.message || 'No se pudo obtener la cartera de créditos desde el backend.');
      setCreditsStale((credits || []).length > 0);
      setCreditsLoading(false);
      return false;
    }

    setCredits(res.data || []);
    setCreditsError(null);
    setCreditsStale(false);
    creditsLastFetch.current = now;
    setCreditsLoading(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCreditNotes = useCallback(async (opts?: RefreshOptions): Promise<boolean> => {
    const now = Date.now();
    if (!opts?.force && now - creditNotesLastFetch.current < CREDIT_NOTES_TTL_MS) return true;
    const myGen = ++creditNotesGen.current;
    setCreditNotesLoading(true);

    const res = await creditNotesApi.list();
    if (myGen !== creditNotesGen.current) return false;

    if (!res.success) {
      setCreditNotesError(res.message || 'No se pudo obtener los créditos a favor / notas de crédito desde el backend.');
      setCreditNotesStale((creditNotes || []).length > 0);
      setCreditNotesLoading(false);
      return false;
    }

    setCreditNotes(res.data || []);
    setCreditNotesError(null);
    setCreditNotesStale(false);
    creditNotesLastFetch.current = now;
    setCreditNotesLoading(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshExpenses = useCallback(async (opts?: RefreshOptions): Promise<boolean> => {
    const now = Date.now();
    if (!opts?.force && now - expensesLastFetch.current < EXPENSES_TTL_MS) return true;
    const myGen = ++expensesGen.current;
    setExpensesLoading(true);

    const res = await expensesApi.list();
    if (myGen !== expensesGen.current) return false;

    if (!res.success) {
      setExpensesError(res.message || 'No se pudo obtener el historial de gastos desde el backend.');
      setExpensesStale((expenses || []).length > 0);
      setExpensesLoading(false);
      return false;
    }

    setExpenses(res.data || []);
    setExpensesError(null);
    setExpensesStale(false);
    expensesLastFetch.current = now;
    setExpensesLoading(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateFromBootstrap = useCallback((bundle: BootstrapBundle) => {
    const now = Date.now();
    if (Array.isArray(bundle.products)) {
      const mapped = bundle.products.map(mapProduct);
      setProducts(mapped);
      storageService.saveProducts(mapped);
      setProductsError(null);
      setProductsStale(false);
      productsLastFetch.current = now;
    }
    if (Array.isArray(bundle.categories)) {
      setCategories(bundle.categories);
      storageService.saveCategories(bundle.categories);
    }
    if (Array.isArray(bundle.sizes)) {
      setSizes(bundle.sizes);
      storageService.saveSizes(bundle.sizes);
    }
    if (Array.isArray(bundle.colors)) {
      setColors(bundle.colors);
      storageService.saveColors(bundle.colors);
    }
    if (Array.isArray(bundle.suppliers)) {
      setSuppliers(bundle.suppliers);
      storageService.saveSuppliers(bundle.suppliers);
    }
    if (Array.isArray(bundle.customers)) {
      const mapped = bundle.customers.map(mapCustomer);
      setCustomers(mapped);
      storageService.saveCustomers(mapped);
      setCustomersError(null);
      setCustomersStale(false);
      customersLastFetch.current = now;
    }
  }, []);

  const clear = useCallback(() => {
    setProducts([]);
    setCategories([]);
    setSizes([]);
    setColors([]);
    setSuppliers([]);
    setProductsError(null);
    setProductsStale(false);
    productsLastFetch.current = 0;

    setCustomers([]);
    setCustomersError(null);
    setCustomersStale(false);
    customersLastFetch.current = 0;

    setSales([]);
    setSalesError(null);
    setSalesStale(false);
    salesLastFetch.current = 0;

    setCredits([]);
    setCreditsError(null);
    setCreditsStale(false);
    creditsLastFetch.current = 0;

    setCreditNotes([]);
    setCreditNotesError(null);
    setCreditNotesStale(false);
    creditNotesLastFetch.current = 0;

    setExpenses([]);
    setExpensesError(null);
    setExpensesStale(false);
    expensesLastFetch.current = 0;
  }, []);

  return (
    <DataStoreContext.Provider
      value={{
        products,
        categories,
        sizes,
        colors,
        suppliers,
        productsLoading,
        productsError,
        productsStale,
        customers,
        customersLoading,
        customersError,
        customersStale,
        sales,
        salesLoading,
        salesError,
        salesStale,
        credits,
        creditsLoading,
        creditsError,
        creditsStale,
        creditNotes,
        creditNotesLoading,
        creditNotesError,
        creditNotesStale,
        expenses,
        expensesLoading,
        expensesError,
        expensesStale,
        refreshProducts,
        refreshCustomers,
        refreshSales,
        refreshCredits,
        refreshCreditNotes,
        refreshExpenses,
        hydrateFromBootstrap,
        clear,
        getProducts,
        getCustomers,
      }}
    >
      {children}
    </DataStoreContext.Provider>
  );
};

export const useDataStore = (): DataStoreContextType => {
  const context = useContext(DataStoreContext);
  if (!context) {
    throw new Error('useDataStore must be used within a DataStoreProvider');
  }
  return context;
};
