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
} from '../types';
import {
  INITIAL_SETTINGS,
  INITIAL_CATEGORIES,
  INITIAL_SIZES,
  INITIAL_COLORS,
  INITIAL_SUPPLIERS,
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_USERS,
  INITIAL_CASH_SESSIONS,
  INITIAL_CREDITS,
  INITIAL_INSTALLMENTS,
  INITIAL_SALES,
  INITIAL_EXPENSES,
  INITIAL_AUDIT_LOGS,
  INITIAL_MOVEMENTS,
} from './seedData';
import { DEFAULT_ROLE_PERMISSIONS } from './permissionsCatalog';

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

  public initialize(): void {
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      this.set(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.CATEGORIES)) {
      this.set(STORAGE_KEYS.CATEGORIES, INITIAL_CATEGORIES);
    }
    if (!localStorage.getItem(STORAGE_KEYS.SIZES)) {
      this.set(STORAGE_KEYS.SIZES, INITIAL_SIZES);
    }
    if (!localStorage.getItem(STORAGE_KEYS.COLORS)) {
      this.set(STORAGE_KEYS.COLORS, INITIAL_COLORS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.SUPPLIERS)) {
      this.set(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
      this.set(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCTS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.CUSTOMERS)) {
      this.set(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
      this.set(STORAGE_KEYS.USERS, INITIAL_USERS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.CURRENT_USER)) {
      this.set(STORAGE_KEYS.CURRENT_USER, INITIAL_USERS[0]); // Default to admin for instant test
    }
    if (!localStorage.getItem(STORAGE_KEYS.CASH_SESSIONS)) {
      this.set(STORAGE_KEYS.CASH_SESSIONS, INITIAL_CASH_SESSIONS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.CREDITS)) {
      this.set(STORAGE_KEYS.CREDITS, INITIAL_CREDITS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.INSTALLMENTS)) {
      this.set(STORAGE_KEYS.INSTALLMENTS, INITIAL_INSTALLMENTS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.SALES)) {
      this.set(STORAGE_KEYS.SALES, INITIAL_SALES);
    }
    if (!localStorage.getItem(STORAGE_KEYS.EXPENSES)) {
      this.set(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
    }
    if (!localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS)) {
      this.set(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.MOVEMENTS)) {
      this.set(STORAGE_KEYS.MOVEMENTS, INITIAL_MOVEMENTS);
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

  // Users & Auth
  public getUsers(): User[] {
    return this.get<User[]>(STORAGE_KEYS.USERS, INITIAL_USERS) || [];
  }

  public saveUsers(users: User[]): void {
    this.set(STORAGE_KEYS.USERS, users);
  }

  public getCurrentUser(): User {
    const user = this.get<User | null>(STORAGE_KEYS.CURRENT_USER, null);
    return user || INITIAL_USERS[0];
  }

  public setCurrentUser(user: User | null): void {
    this.set(STORAGE_KEYS.CURRENT_USER, user);
  }

  // Role Permissions
  public getRolePermissions(): Record<UserRole, PermissionCode[]> {
    return this.get<Record<UserRole, PermissionCode[]>>(STORAGE_KEYS.ROLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS) || DEFAULT_ROLE_PERMISSIONS;
  }

  public saveRolePermissions(config: Record<UserRole, PermissionCode[]>): void {
    this.set(STORAGE_KEYS.ROLE_PERMISSIONS, config);
  }

  // Categories, Sizes, Colors
  public getCategories(): Category[] {
    return this.get<Category[]>(STORAGE_KEYS.CATEGORIES, INITIAL_CATEGORIES) || [];
  }
  public saveCategories(data: Category[]): void {
    this.set(STORAGE_KEYS.CATEGORIES, data);
  }

  public getSizes(): Size[] {
    return this.get<Size[]>(STORAGE_KEYS.SIZES, INITIAL_SIZES) || [];
  }
  public saveSizes(data: Size[]): void {
    this.set(STORAGE_KEYS.SIZES, data);
  }

  public getColors(): Color[] {
    return this.get<Color[]>(STORAGE_KEYS.COLORS, INITIAL_COLORS) || [];
  }
  public saveColors(data: Color[]): void {
    this.set(STORAGE_KEYS.COLORS, data);
  }

  public getSuppliers(): Supplier[] {
    return this.get<Supplier[]>(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS) || [];
  }
  public saveSuppliers(data: Supplier[]): void {
    this.set(STORAGE_KEYS.SUPPLIERS, data);
  }

  // Products & Variants
  public getProducts(): Product[] {
    return this.get<Product[]>(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCTS) || [];
  }
  public saveProducts(data: Product[]): void {
    this.set(STORAGE_KEYS.PRODUCTS, data);
  }

  // Customers
  public getCustomers(): Customer[] {
    return this.get<Customer[]>(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS) || [];
  }
  public saveCustomers(data: Customer[]): void {
    this.set(STORAGE_KEYS.CUSTOMERS, data);
  }

  // Sales
  public getSales(): Sale[] {
    return this.get<Sale[]>(STORAGE_KEYS.SALES, INITIAL_SALES) || [];
  }
  public saveSales(data: Sale[]): void {
    this.set(STORAGE_KEYS.SALES, data);
  }

  // Credits / Accounts Receivable
  public getCredits(): AccountReceivable[] {
    const credits = this.get<AccountReceivable[]>(STORAGE_KEYS.CREDITS, INITIAL_CREDITS) || [];
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
    return this.get<PaymentInstallment[]>(STORAGE_KEYS.INSTALLMENTS, INITIAL_INSTALLMENTS) || [];
  }
  public saveInstallments(data: PaymentInstallment[]): void {
    this.set(STORAGE_KEYS.INSTALLMENTS, data);
  }

  // Cash Sessions
  public getCashSessions(): CashSession[] {
    return this.get<CashSession[]>(STORAGE_KEYS.CASH_SESSIONS, INITIAL_CASH_SESSIONS) || [];
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
    return this.get<Expense[]>(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES) || [];
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
    return this.get<InventoryMovement[]>(STORAGE_KEYS.MOVEMENTS, INITIAL_MOVEMENTS) || [];
  }
  public saveMovements(data: InventoryMovement[]): void {
    this.set(STORAGE_KEYS.MOVEMENTS, data);
  }

  // Audit Logs
  public getAuditLogs(): AuditLog[] {
    return this.get<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS) || [];
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

  // Reset to Demo Data
  public resetToInitialDemo(): void {
    localStorage.clear();
    this.initialize();
  }

  // Reset to Factory Seed
  public resetToFactory(): void {
    localStorage.clear();
    this.initialize();
  }
}

export const storageService = new StorageService();
// Run init immediately on load
storageService.initialize();
