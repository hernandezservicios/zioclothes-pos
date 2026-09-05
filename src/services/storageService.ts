import {
  Product,
  Category,
  Size,
  Color,
  Customer,
  Supplier,
  Sale,
  AccountReceivable,
  PaymentInstallment,
  CashSession,
  CashMovement,
  Expense,
  Purchase,
  ReturnRecord,
  AuditLog,
  InventoryMovement,
  User,
  SystemSettings,
  RolePermissionConfig,
  UserRole,
  PermissionCode,
  PosWorkingState,
} from '../types';
// FASE 3.6B: solo INITIAL_SETTINGS sigue siendo un import real -- es
// configuración de UI legítima, no un catálogo/directorio de negocio. El
// resto de los INITIAL_* de seedData.ts ya no se usa en ningún getter ni
// en initialize() (ver comentario de initialize() más abajo).
import { INITIAL_SETTINGS } from './seedData';
import { DEFAULT_ROLE_PERMISSIONS } from './permissionsCatalog';

/**
 * FASE 3.6D (Parte 3): configuración de INFRAESTRUCTURA local -- separada
 * de `zio_settings` (que mezclaba la URL del Web App con configuración
 * comercial). Esta clave SOLO contiene datos técnicos para poder
 * reconectar el frontend al backend; nunca productos, clientes, ventas,
 * caja, créditos, gastos, compras, devoluciones, inventario, usuarios ni
 * configuración comercial. Una limpieza de caché de UX/negocio (ver
 * resetToInitialDemo/resetToFactory más abajo) NUNCA debe tocar esta
 * clave -- si la borra, el frontend pierde la forma de hablar con el
 * backend hasta que alguien vuelva a escribir la URL a mano.
 */
export interface InfrastructureConfig {
  googleAppsScriptUrl: string;
}

const INFRASTRUCTURE_CONFIG_KEY = 'zio_infrastructure_config';

const STORAGE_KEYS = {
  SETTINGS: 'zio_settings',
  CATEGORIES: 'zio_categories',
  SIZES: 'zio_sizes',
  COLORS: 'zio_colors',
  SUPPLIERS: 'zio_suppliers',
  PRODUCTS: 'zio_products',
  CUSTOMERS: 'zio_customers',
  USERS: 'zio_users',
  CURRENT_USER: 'zio_current_user',
  CASH_SESSIONS: 'zio_cash_sessions',
  CASH_MOVEMENTS: 'zio_cash_movements',
  CREDITS: 'zio_credits',
  INSTALLMENTS: 'zio_installments',
  SALES: 'zio_sales',
  EXPENSES: 'zio_expenses',
  PURCHASES: 'zio_purchases',
  RETURNS: 'zio_returns',
  AUDIT_LOGS: 'zio_audit_logs',
  MOVEMENTS: 'zio_inventory_movements',
  ROLE_PERMISSIONS: 'zio_role_permissions',
  SEQUENCES: 'zio_sequences',
  // FASE 3.6: sesión real contra ZIO-Google-Backend (sessionToken + permisos
  // devueltos por auth.login/auth.validateSession) y estado de trabajo del
  // POS para Hydration-First en F5. Ninguno de estos dos es fuente
  // autoritativa: el token se valida siempre contra el backend real, y el
  // estado del POS es solo conveniencia de UX (nunca stock/ventas/caja).
  SESSION_TOKEN: 'zio_session_token',
  SESSION_PERMISSIONS: 'zio_session_permissions',
  POS_WORKING_STATE: 'zio_pos_working_state',
  // FASE 3.6E (hallazgo de la prueba de F5 de esta fase): sin esto, un F5
  // estando en cualquier vista distinta de Dashboard (ej. POS a mitad de
  // una venta) siempre regresaba a Dashboard, porque `currentView` en
  // App.tsx nacía con un valor fijo ('dashboard') sin hidratarse de nada.
  // Es solo conveniencia de navegación/UX -- nunca autoriza ni reemplaza
  // ninguna verificación de permiso (App.tsx valida el permiso del usuario
  // real antes de restaurar la vista).
  CURRENT_VIEW: 'zio_current_view',
};

class StorageService {
  private get<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(key);
      if (!data || data === 'undefined' || data === 'null') return defaultValue;
      const parsed = JSON.parse(data);
      if (parsed === null || parsed === undefined) return defaultValue;
      if (Array.isArray(defaultValue) && !Array.isArray(parsed)) return defaultValue;
      return parsed;
    } catch (e) {
      console.error(`Error reading ${key} from storage:`, e);
      return defaultValue;
    }
  }

  private set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error writing ${key} to storage:`, e);
    }
  }

  /**
   * FASE 3.6: el propio README de ZIO-Google-Backend documenta el diseño
   * pretendido: "Cero Dependencia de LocalStorage: el frontend solo
   * conserva el sessionToken en memoria volátil de sesión". sessionStorage
   * cumple exactamente eso -- sobrevive un F5 (mismo tab, tal como pide la
   * Parte 15/16), pero se borra al cerrar la pestaña/ventana y nunca se
   * comparte entre pestañas, a diferencia de localStorage.
   */
  private getSession<T>(key: string, defaultValue: T): T {
    try {
      const data = sessionStorage.getItem(key);
      if (!data || data === 'undefined' || data === 'null') return defaultValue;
      const parsed = JSON.parse(data);
      return parsed === null || parsed === undefined ? defaultValue : parsed;
    } catch (e) {
      console.error(`Error reading ${key} from sessionStorage:`, e);
      return defaultValue;
    }
  }
  private setSession<T>(key: string, value: T): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error writing ${key} to sessionStorage:`, e);
    }
  }

  /**
   * FASE 3.6B (corrección de fuente de datos): esta función ya NO siembra
   * ningún dato comercial de demostración (categorías, tallas, colores,
   * proveedores, productos, clientes, usuarios, sesiones de caja,
   * créditos, abonos, ventas, gastos, auditoría, movimientos). Antes,
   * cualquier navegador sin localStorage previo mostraba el catálogo/
   * directorio de seedData.ts como si fuera real, sin importar si el
   * login ya era real o si Google Sheets estaba vacío -- exactamente lo
   * que se pidió corregir. Solo se siembran valores de configuración/UI
   * legítimos (ajustes por defecto, catálogo local de permisos como
   * respaldo, contadores de secuencia locales para los módulos que aún
   * no están conectados al backend real).
   */
  public initialize(): void {
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      this.set(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.ROLE_PERMISSIONS)) {
      this.set(STORAGE_KEYS.ROLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.SEQUENCES)) {
      this.set(STORAGE_KEYS.SEQUENCES, {
        PROD: 7,
        VAR: 26,
        CLI: 6,
        VEN: 5,
        CRED: 4,
        ABO: 3,
        COMP: 1,
        CAJA: 2,
        GAS: 3,
        AUD: 4,
        MOV: 3,
        DEV: 1,
        USR: 4,
      });
    }
  }

  // Sequences
  public getNextSequence(prefix: string): string {
    const sequences = this.get<Record<string, number>>(STORAGE_KEYS.SEQUENCES, {});
    const current = sequences[prefix] || 1;
    sequences[prefix] = current + 1;
    this.set(STORAGE_KEYS.SEQUENCES, sequences);
    return `${prefix}-${String(current).padStart(6, '0')}`;
  }

  // Settings
  public getSettings(): SystemSettings {
    return this.get<SystemSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
  }

  public saveSettings(settings: SystemSettings): void {
    this.set(STORAGE_KEYS.SETTINGS, settings);
  }

  /**
   * FASE 3.6D (Parte 3): infraestructura local, separada de
   * `zio_settings`. Es la única fuente de la URL del Web App -- ni
   * `apiService.syncWithGoogleAppsScript` ni la pestaña de Configuración
   * deben volver a leer/escribir `googleAppsScriptUrl` desde
   * `zio_settings`. Nunca se toca en `resetToInitialDemo`/`resetToFactory`.
   */
  public getInfrastructureConfig(): InfrastructureConfig {
    return this.get<InfrastructureConfig>(INFRASTRUCTURE_CONFIG_KEY, { googleAppsScriptUrl: '' });
  }

  public saveInfrastructureConfig(config: InfrastructureConfig): void {
    this.set(INFRASTRUCTURE_CONFIG_KEY, config);
  }

  public getGoogleAppsScriptUrl(): string {
    return this.getInfrastructureConfig().googleAppsScriptUrl || '';
  }

  public setGoogleAppsScriptUrl(url: string): void {
    this.saveInfrastructureConfig({ ...this.getInfrastructureConfig(), googleAppsScriptUrl: url });
  }

  // Users & Auth
  // FASE 3.6B: default vacío, no INITIAL_USERS -- ese seed de empleados
  // demo no debe usarse como fuente incluso en memoria, sin localStorage
  // previo (la lista real de usuarios no está cableada al backend en
  // esta corrección; ver informe).
  public getUsers(): User[] {
    return this.get<User[]>(STORAGE_KEYS.USERS, []) || [];
  }

  public saveUsers(users: User[]): void {
    this.set(STORAGE_KEYS.USERS, users);
  }

  public getCurrentUser(): User | null {
    // FASE 3.6: ya no cae de vuelta a INITIAL_USERS[0]. null significa,
    // honestamente, "no hay sesión iniciada".
    return this.get<User | null>(STORAGE_KEYS.CURRENT_USER, null);
  }

  public setCurrentUser(user: User | null): void {
    this.set(STORAGE_KEYS.CURRENT_USER, user);
  }

  // FASE 3.6: sesión real (sessionToken de auth.login/ZIO-Google-Backend).
  // En sessionStorage, no localStorage (ver comentario de
  // getSession/setSession arriba).
  public getSessionToken(): string | null {
    return this.getSession<string | null>(STORAGE_KEYS.SESSION_TOKEN, null);
  }
  public setSessionToken(token: string | null): void {
    this.setSession(STORAGE_KEYS.SESSION_TOKEN, token);
  }
  public clearSessionToken(): void {
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
  }

  // FASE 3.6: permisos reales devueltos por el backend en auth.login /
  // auth.validateSession. Si está vacío, AuthContext.hasPermission cae de
  // vuelta al catálogo local de permisos por rol. También en sessionStorage
  // por la misma razón que el token.
  public getSessionPermissions(): string[] {
    return this.getSession<string[]>(STORAGE_KEYS.SESSION_PERMISSIONS, []) || [];
  }
  public setSessionPermissions(permissions: string[]): void {
    this.setSession(STORAGE_KEYS.SESSION_PERMISSIONS, permissions || []);
  }
  public clearSessionPermissions(): void {
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_PERMISSIONS);
  }

  // FASE 3.6 / PARTE 5 (Hydration-First): estado de trabajo del carrito del
  // POS. Es exclusivamente conveniencia de UX para sobrevivir un F5 -- NUNCA
  // se usa como fuente autoritativa de stock, precio o venta; la venta
  // siempre se valida/recalcula en el backend al hacer checkout.
  public getPosWorkingState(): PosWorkingState | null {
    return this.get<PosWorkingState | null>(STORAGE_KEYS.POS_WORKING_STATE, null);
  }
  public savePosWorkingState(state: PosWorkingState): void {
    this.set(STORAGE_KEYS.POS_WORKING_STATE, state);
  }
  public clearPosWorkingState(): void {
    localStorage.removeItem(STORAGE_KEYS.POS_WORKING_STATE);
  }

  // FASE 3.6E: última vista de navegación activa, solo para que un F5 no
  // regrese siempre a Dashboard. App.tsx es responsable de validar que el
  // usuario real todavía tenga permiso sobre la vista restaurada antes de
  // usarla -- esto nunca decide permisos por sí mismo.
  public getCurrentView(): string | null {
    return this.get<string | null>(STORAGE_KEYS.CURRENT_VIEW, null);
  }
  public saveCurrentView(view: string): void {
    this.set(STORAGE_KEYS.CURRENT_VIEW, view);
  }

  // Role Permissions
  public getRolePermissions(): Record<UserRole, PermissionCode[]> {
    return this.get<Record<UserRole, PermissionCode[]>>(STORAGE_KEYS.ROLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS) || DEFAULT_ROLE_PERMISSIONS;
  }

  public saveRolePermissions(config: Record<UserRole, PermissionCode[]>): void {
    this.set(STORAGE_KEYS.ROLE_PERMISSIONS, config);
  }

  // Categories, Sizes, Colors, Products, Customers, Sales
  // FASE 3.6B (corrección de fuente de datos): TODOS los defaults de
  // abajo son [] -- ninguno cae a INITIAL_* (seedData.ts) nunca, ni
  // siquiera en memoria sin localStorage previo. Estas colecciones son
  // negocio real: la única fuente de verdad es productsApi/customersApi
  // (backend), que sobrescriben aquí vía saveProducts/saveCustomers tras
  // login o al recargar el catálogo. Si el backend real está vacío, esto
  // se ve vacío -- no hay ningún catálogo/directorio de respaldo.
  public getCategories(): Category[] {
    return this.get<Category[]>(STORAGE_KEYS.CATEGORIES, []) || [];
  }
  public saveCategories(data: Category[]): void {
    this.set(STORAGE_KEYS.CATEGORIES, data);
  }

  public getSizes(): Size[] {
    return this.get<Size[]>(STORAGE_KEYS.SIZES, []) || [];
  }
  public saveSizes(data: Size[]): void {
    this.set(STORAGE_KEYS.SIZES, data);
  }

  public getColors(): Color[] {
    return this.get<Color[]>(STORAGE_KEYS.COLORS, []) || [];
  }
  public saveColors(data: Color[]): void {
    this.set(STORAGE_KEYS.COLORS, data);
  }

  public getSuppliers(): Supplier[] {
    return this.get<Supplier[]>(STORAGE_KEYS.SUPPLIERS, []) || [];
  }
  public saveSuppliers(data: Supplier[]): void {
    this.set(STORAGE_KEYS.SUPPLIERS, data);
  }

  // Products & Variants
  public getProducts(): Product[] {
    return this.get<Product[]>(STORAGE_KEYS.PRODUCTS, []) || [];
  }
  public saveProducts(data: Product[]): void {
    this.set(STORAGE_KEYS.PRODUCTS, data);
  }

  // Customers
  public getCustomers(): Customer[] {
    return this.get<Customer[]>(STORAGE_KEYS.CUSTOMERS, []) || [];
  }
  public saveCustomers(data: Customer[]): void {
    this.set(STORAGE_KEYS.CUSTOMERS, data);
  }

  // Sales
  public getSales(): Sale[] {
    return this.get<Sale[]>(STORAGE_KEYS.SALES, []) || [];
  }
  public saveSales(data: Sale[]): void {
    this.set(STORAGE_KEYS.SALES, data);
  }

  // Credits / Accounts Receivable
  public getCredits(): AccountReceivable[] {
    const credits = this.get<AccountReceivable[]>(STORAGE_KEYS.CREDITS, []) || [];
    // Dynamic recalculation of overdue status if date passed
    const now = new Date();
    return (credits || []).map((c) => {
      if (c && (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL')) {
        const dueDate = new Date(c.fechaVencimiento);
        if (dueDate < now && (c.saldoPendiente || 0) > 0) {
          return { ...c, estado: 'VENCIDA' };
        }
      }
      return c;
    });
  }
  public saveCredits(data: AccountReceivable[]): void {
    this.set(STORAGE_KEYS.CREDITS, data);
  }

  // Installments / Abonos
  public getInstallments(): PaymentInstallment[] {
    return this.get<PaymentInstallment[]>(STORAGE_KEYS.INSTALLMENTS, []) || [];
  }
  public saveInstallments(data: PaymentInstallment[]): void {
    this.set(STORAGE_KEYS.INSTALLMENTS, data);
  }

  // Cash Sessions
  public getCashSessions(): CashSession[] {
    return this.get<CashSession[]>(STORAGE_KEYS.CASH_SESSIONS, []) || [];
  }
  public saveCashSessions(data: CashSession[]): void {
    this.set(STORAGE_KEYS.CASH_SESSIONS, data);
  }

  public getActiveCashSession(): CashSession | undefined {
    const sessions = this.getCashSessions() || [];
    return sessions.find((s) => s && s.estado === 'ABIERTA');
  }

  // Expenses
  public getExpenses(): Expense[] {
    return this.get<Expense[]>(STORAGE_KEYS.EXPENSES, []) || [];
  }
  public saveExpenses(data: Expense[]): void {
    this.set(STORAGE_KEYS.EXPENSES, data);
  }

  // Purchases
  public getPurchases(): Purchase[] {
    return this.get<Purchase[]>(STORAGE_KEYS.PURCHASES, []) || [];
  }
  public savePurchases(data: Purchase[]): void {
    this.set(STORAGE_KEYS.PURCHASES, data);
  }

  // Returns
  public getReturns(): ReturnRecord[] {
    return this.get<ReturnRecord[]>(STORAGE_KEYS.RETURNS, []) || [];
  }
  public saveReturns(data: ReturnRecord[]): void {
    this.set(STORAGE_KEYS.RETURNS, data);
  }

  // Inventory Movements
  public getMovements(): InventoryMovement[] {
    return this.get<InventoryMovement[]>(STORAGE_KEYS.MOVEMENTS, []) || [];
  }
  public saveMovements(data: InventoryMovement[]): void {
    this.set(STORAGE_KEYS.MOVEMENTS, data);
  }

  // Audit Logs
  public getAuditLogs(): AuditLog[] {
    return this.get<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []) || [];
  }
  public saveAuditLogs(data: AuditLog[]): void {
    this.set(STORAGE_KEYS.AUDIT_LOGS, data);
  }

  public logAudit(log: Omit<AuditLog, 'id' | 'fecha'>): void {
    const logs = this.getAuditLogs();
    const id = this.getNextSequence('AUD');
    const newLog: AuditLog = {
      ...log,
      id,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
    logs.unshift(newLog);
    // Keep max 500 logs locally
    this.saveAuditLogs(logs.slice(0, 500));
  }

  // Expense Categories
  public getExpenseCategories(): { id: string; nombre: string }[] {
    return [
      { id: 'ALQUILER', nombre: 'Alquiler de Local Boutique' },
      { id: 'SERVICIOS', nombre: 'Servicios (Luz, Agua, Internet)' },
      { id: 'NOMINA', nombre: 'Nómina & Sueldos Empleados' },
      { id: 'ENVIOS', nombre: 'Envíos, Fletes & Deliveries' },
      { id: 'EMPAQUE', nombre: 'Empaques, Bolsas & Fundas' },
      { id: 'PUBLICIDAD', nombre: 'Publicidad & Redes Sociales' },
      { id: 'MANTENIMIENTO', nombre: 'Mantenimiento & Reparaciones' },
      { id: 'OTROS', nombre: 'Otros Gastos Generales' },
    ];
  }

  // Export Full JSON Database
  public exportFullDatabaseJSON(): string {
    const backup = {
      settings: this.getSettings(),
      products: this.getProducts(),
      categories: this.getCategories(),
      sizes: this.getSizes(),
      colors: this.getColors(),
      customers: this.getCustomers(),
      users: this.getUsers(),
      sales: this.getSales(),
      credits: this.getCredits(),
      installments: this.getInstallments(),
      cashSessions: this.getCashSessions(),
      expenses: this.getExpenses(),
      purchases: this.getPurchases(),
      returns: this.getReturns(),
      movements: this.getMovements(),
      auditLogs: this.getAuditLogs(),
      timestamp: new Date().toISOString(),
    };
    return JSON.stringify(backup, null, 2);
  }

  /**
   * FASE 3.6D (Parte 3): antes hacía `localStorage.clear()`, que borraba
   * TODA la instancia de localStorage indiscriminadamente -- incluyendo
   * `zio_infrastructure_config` si hubiera estado ahí. Ahora limpia
   * selectivamente solo las claves de `STORAGE_KEYS` (caché de UX y de
   * negocio local), nunca `INFRASTRUCTURE_CONFIG_KEY` (la URL del Web App
   * sobrevive intacta). También cierra la sesión (sessionStorage) para
   * que, tras el `window.location.reload()` que hace quien llama a esto,
   * el usuario vuelva a loguearse y el catálogo real se vuelva a
   * descargar del backend en ese login -- en vez de quedar "logueado"
   * con un caché de catálogo vacío que nada vuelve a poblar solo.
   */
  private clearLocalUxAndBusinessCache(): void {
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_PERMISSIONS);
  }

  // Reset to Demo Data
  public resetToInitialDemo(): void {
    this.clearLocalUxAndBusinessCache();
    this.initialize();
  }

  // Reset to Factory Seed
  public resetToFactory(): void {
    this.clearLocalUxAndBusinessCache();
    this.initialize();
  }
}

export const storageService = new StorageService();
// Run init immediately on load
storageService.initialize();
