export type UserRole = 'ADMIN' | 'CAJERO' | 'SUPERVISOR' | 'VENDEDOR' | 'GERENTE';

export type UserStatus = 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO';

export interface User {
  id: string;
  nombre: string;
  apellido: string;
  usuario: string;
  username?: string; // Compatibility alias
  correo: string;
  telefono: string;
  rol: UserRole;
  estado: UserStatus;
  activo?: boolean; // Compatibility alias
  ultimoAcceso?: string;
  fechaCreacion: string;
  fechaModificacion?: string;
  creadoPor?: string;
  password?: string;
  passwordHash?: string;
  avatar?: string;
}

export type PermissionCode =
  // Dashboard & POS
  | 'dashboard.ver'
  | 'pos.acceso'
  // Ventas
  | 'ventas.ver'
  | 'ventas.crear'
  | 'ventas.editar'
  | 'ventas.anular'
  | 'ventas.descuentos'
  | 'ventas.ver_costos'
  | 'ventas.ver_ganancias'
  // Productos
  | 'productos.ver'
  | 'productos.crear'
  | 'productos.editar'
  | 'productos.eliminar'
  | 'productos.cambiar_precios'
  | 'productos.ver_costos'
  // Inventario
  | 'inventario.ver'
  | 'inventario.crear'
  | 'inventario.ajustar'
  | 'inventario.movimientos'
  | 'inventario.transferencias'
  | 'inventario.ver_costos'
  // Clientes
  | 'clientes.ver'
  | 'clientes.crear'
  | 'clientes.editar'
  | 'clientes.eliminar'
  // Créditos & Abonos
  | 'creditos.ver'
  | 'creditos.crear'
  | 'creditos.abonos'
  | 'abonos.ver'
  | 'abonos.crear'
  | 'creditos.anular_abonos'
  | 'creditos.modificar'
  | 'creditos.ver_deudas'
  | 'creditos.ver_vencidas'
  // Caja
  | 'caja.abrir'
  | 'caja.cerrar'
  | 'caja.ver'
  | 'caja.movimientos'
  | 'caja.ingresos'
  | 'caja.retiros'
  | 'caja.gastos'
  | 'caja.anular_movimientos'
  // Compras & Gastos
  | 'compras.ver'
  | 'compras.crear'
  | 'compras.proveedores'
  | 'gastos.ver'
  | 'gastos.crear'
  | 'costos.ver'
  // Devoluciones
  | 'devoluciones.ver'
  | 'devoluciones.crear'
  // Reportes
  | 'reportes.ver'
  | 'reportes.dashboard'
  | 'reportes.ventas'
  | 'reportes.inventario'
  | 'reportes.compras'
  | 'reportes.caja'
  | 'reportes.creditos'
  | 'reportes.deudas'
  | 'reportes.ganancias'
  | 'reportes.auditoria'
  // Administración & Auditoría
  | 'admin.usuarios'
  | 'admin.roles'
  | 'admin.permisos'
  | 'admin.configuracion'
  | 'usuarios.gestionar'
  | 'auditoria.ver'
  | 'configuracion.ver';

export interface RolePermissionConfig {
  role: UserRole;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

export interface Category {
  id: string;
  nombre: string;
  descripcion?: string;
  estado: 'ACTIVO' | 'INACTIVO';
}

export interface Size {
  id: string;
  nombre: string; // e.g. "XS", "S", "M", "L", "XL", "XXL", "32", "34"
  orden: number;
}

export interface Color {
  id: string;
  nombre: string; // e.g. "Beige", "Negro", "Blanco", "Azul Marino", "Rosa Pastel"
  hex: string;
}

export interface ProductVariant {
  id: string;
  productoId: string;
  sku: string;
  codigoBarras: string;
  color: string;
  talla: string;
  costo: number;
  precio: number;
  stock: number;
  estado: 'ACTIVO' | 'INACTIVO';
}

export interface Product {
  id: string;
  sku: string;
  codigoBarras: string;
  nombre: string;
  descripcion: string;
  categoriaId: string;
  categoriaNombre?: string;
  marca: string;
  proveedorId?: string;
  costo: number;
  precio: number;
  precioEspecial?: number;
  impuesto: number; // Porcentaje e.g. 18
  descuentoMaximo?: number; // Porcentaje e.g. 15
  stockMinimo: number;
  estado: 'ACTIVO' | 'INACTIVO';
  imagenUrl?: string;
  variantes: ProductVariant[];
  fechaCreacion: string;
  fechaModificacion?: string;
}

export interface Customer {
  id: string;
  nombre: string;
  apellido: string;
  documento: string; // Cédula o RNC
  telefono: string;
  correo: string;
  direccion: string;
  ciudad: string;
  limiteCredito: number;
  diasCreditoPorDefecto: number;
  notas?: string;
  estado: 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO';
  fechaCreacion: string;
  // FASE 3.7B (Sección 11): customers.list / system.getBootstrapData
  // (CustomersController.handleListCustomers) SIEMPRE calculan y devuelven
  // estos dos campos para cada cliente real (deuda activa agregada desde
  // Creditos, y limiteCredito - deuda). Se declaran opcionales -- no
  // requeridos -- únicamente porque el seed de demostración no usado
  // (seedData.ts/INITIAL_CUSTOMERS) no los define; cualquier cliente que
  // realmente provenga del backend real siempre los trae. Antes solo
  // existían en CustomerWithCredit (customersApi.ts), obligando a un cast
  // manual en PaymentModal.tsx para leerlos desde un Customer normal.
  saldoPendiente?: number;
  creditoDisponible?: number;
}

export type PaymentMethodType = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CREDITO' | 'PAGO_MOVIL' | 'MIXTO';

export interface SalePaymentSplit {
  metodo: PaymentMethodType;
  monto: number;
  referencia?: string;
}

export interface SaleItem {
  id: string;
  productoId: string;
  varianteId: string;
  nombreProducto: string;
  sku: string;
  talla: string;
  color: string;
  categoria?: string;
  cantidad: number;
  costoUnitario: number;
  precioUnitario: number;
  descuentoPorcentaje: number;
  descuentoMonto: number;
  subtotal: number;
  impuestoMonto: number;
  total: number;
}

export type SaleStatus = 'COMPLETADA' | 'ANULADA' | 'DEVUELTA_PARCIAL' | 'DEVUELTA_TOTAL';

export interface Sale {
  id: string;
  numeroVenta: string; // e.g. VEN-000001
  clienteId?: string;
  clienteNombre: string;
  clienteDocumento?: string;
  vendedorId: string;
  vendedorNombre: string;
  cajaSesionId?: string;
  items: SaleItem[];
  subtotal: number;
  descuentoTotal: number;
  impuestoTotal: number;
  total: number;
  costoTotal: number;
  metodoPago: PaymentMethodType;
  pagos: SalePaymentSplit[];
  efectivoRecibido?: number;
  cambioEntregado?: number;
  esCredito: boolean;
  montoFinanciado?: number;
  cuentaCobrarId?: string;
  estado: SaleStatus;
  motivoAnulacion?: string;
  anuladaPor?: string;
  fechaAnulacion?: string;
  fecha: string;
}

export type CreditAccountStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADA' | 'VENCIDA' | 'ANULADA';

export interface AccountReceivable {
  id: string;
  numeroCredito: string; // e.g. CRED-000001
  numeroCuenta?: string; // Compatibility alias
  clienteId: string;
  clienteNombre: string;
  clienteDocumento?: string;
  clienteTelefono: string;
  ventaId: string;
  numeroVenta: string;
  montoOriginal: number;
  montoPagado: number;
  saldoPendiente: number;
  fechaCreacion: string;
  fechaEmision?: string; // Compatibility alias
  fechaVencimiento: string;
  diasPlazo: number;
  estado: CreditAccountStatus;
  observaciones?: string;
  creadoPor: string;
  abonos?: PaymentInstallment[];
}

export interface PaymentInstallment {
  id: string;
  numeroRecibo: string; // e.g. ABO-000001
  numeroAbono?: string; // Compatibility alias
  cuentaCobrarId: string;
  clienteId: string;
  clienteNombre: string;
  ventaId?: string;
  numeroVenta?: string;
  saldoAnterior: number;
  montoAbonado: number;
  saldoRestante: number;
  saldoNuevo?: number; // Compatibility alias
  metodoPago: PaymentMethodType;
  referencia?: string;
  referenciaPago?: string;
  cajaSesionId?: string;
  usuarioId: string;
  usuarioNombre: string;
  observaciones?: string;
  notas?: string;
  fecha: string;
  estado: 'ACTIVO' | 'ANULADO';
  motivoAnulacion?: string;
  anuladoPor?: string;
  fechaAnulacion?: string;
}

export type CreditAccount = AccountReceivable;
export type Installment = PaymentInstallment;
export type ExpenseRecord = Expense;
export type PurchaseOrder = Purchase;
export type ExpenseCategory = Category;

// FASE 3.7C: corregido para reflejar los valores que el backend real
// realmente escribe en Inventario_Kardex (SalesController -> 'VENTA',
// ReturnsController -> 'DEVOLUCION', PurchasesController -> 'COMPRA',
// InventoryController.handleAdjustStock -> 'ENTRADA'/'SALIDA'/'AJUSTE').
// Los valores anteriores (AJUSTE_POSITIVO, AJUSTE_NEGATIVO, MERMA_DANIO,
// CORRECCION, INICIAL) nunca fueron escritos por ningún controlador real
// -- solo existían en el método local ya desconectado apiService.
// adjustInventory y en este tipo, sin correspondencia con Sheets.
export type InventoryMovementType =
  | 'VENTA'
  | 'DEVOLUCION'
  | 'COMPRA'
  | 'ENTRADA'
  | 'SALIDA'
  | 'AJUSTE';

export interface InventoryMovement {
  id: string;
  productoId: string;
  productoNombre: string;
  varianteId: string;
  sku: string;
  talla: string;
  color: string;
  cantidad: number;
  tipo: InventoryMovementType;
  stockAnterior: number;
  stockNuevo: number;
  motivo: string;
  referencia?: string;
  usuarioId: string;
  usuarioNombre: string;
  fecha: string;
}

export interface CashMovement {
  id: string;
  cajaSesionId: string;
  // FASE 3.7B: agregado REVERSION_ABONO -- CreditsController.handleVoidAbono
  // ahora revierte el efecto en caja de un abono en efectivo anulado con
  // este tipo de movimiento (ver CreditsController.gs).
  tipo: 'INGRESO' | 'RETIRO' | 'GASTO' | 'VENTA_EFECTIVO' | 'ABONO_EFECTIVO' | 'DEVOLUCION_EFECTIVO' | 'REVERSION_ABONO';
  monto: number;
  motivo: string;
  categoriaGasto?: string;
  referencia?: string;
  usuarioId: string;
  usuarioNombre: string;
  fecha: string;
  estado: 'ACTIVO' | 'ANULADO';
}

export interface CashSession {
  id: string;
  codigoCaja: string; // e.g. CAJA-000001
  cajaNombre?: string;
  cajeroId: string;
  cajeroNombre: string;
  usuarioAperturaNombre?: string;
  montoInicial: number;
  fechaApertura: string;
  observacionApertura?: string;
  estado: 'ABIERTA' | 'CERRADA';
  ventasEfectivo: number;
  abonosEfectivo: number;
  ingresosManuales: number;
  entradasEfectivo?: number;
  retirosManuales: number;
  salidasEfectivo?: number;
  gastos: number;
  devolucionesEfectivo: number;
  ventasTarjeta?: number;
  ventasTransferencia?: number;
  ventasCredito?: number;
  movimientos?: any[];
  efectivoEsperado: number;
  efectivoRealContado?: number;
  montoCierreReal?: number;
  diferencia?: number; // Real - Esperado (Positivo: sobrante, Negativo: faltante)
  fechaCierre?: string;
  observacionCierre?: string;
}

export interface Supplier {
  id: string;
  nombre: string;
  contacto: string;
  telefono: string;
  correo: string;
  rnc: string;
  direccion: string;
  estado: 'ACTIVO' | 'INACTIVO';
}

export interface PurchaseItem {
  productoId: string;
  varianteId: string;
  nombreProducto: string;
  sku?: string;
  talla: string;
  color: string;
  cantidad: number;
  costoUnitario: number;
  total: number;
}

export interface Purchase {
  id: string;
  numeroCompra: string; // e.g. COMP-000001
  proveedorId?: string;
  proveedor: string;
  proveedorNombre?: string;
  numeroFacturaProveedor?: string;
  items: PurchaseItem[];
  total: number;
  formaPago?: string;
  estado: 'RECIBIDA' | 'ANULADA';
  usuarioId: string;
  usuarioNombre: string;
  fecha: string;
  notas?: string;
}

// FASE 3.7F: corregido para reflejar exactamente lo que
// ReturnsController.recalculateReturnAuthoritatively realmente calcula y
// persiste en Devoluciones.items_json -- `saleItemId` nunca existió en el
// backend real (las líneas se identifican por varianteId, no por un id de
// renglón de venta); `sku`/`costoUnitario`/`descuentoMonto`/
// `impuestoMonto`/`subtotal` sí se calculan y devuelven, pero no estaban
// declarados.
export interface ReturnItem {
  productoId: string;
  varianteId: string;
  nombreProducto: string;
  sku?: string;
  talla: string;
  color: string;
  cantidad: number;
  precioUnitario: number;
  costoUnitario?: number;
  descuentoMonto?: number;
  impuestoMonto?: number;
  subtotal?: number;
  total: number;
}

export interface ReturnRecord {
  id: string;
  numeroDevolucion: string; // e.g. DEV-000001
  ventaId: string;
  numeroVenta: string;
  clienteId?: string;
  clienteNombre: string;
  items: ReturnItem[];
  montoDevuelto: number;
  tipoReembolso: 'EFECTIVO' | 'CREDITO_CUENTA' | 'VALE_TIENDA';
  motivo: string;
  usuarioId: string;
  usuarioNombre: string;
  fecha: string;
}

export interface Expense {
  id: string;
  numeroGasto: string;
  categoriaId?: string;
  categoriaNombre?: string;
  categoria?: 'ALQUILER' | 'SERVICIOS' | 'NOMINA' | 'ENVIOS' | 'EMPAQUE' | 'PUBLICIDAD' | 'MANTENIMIENTO' | 'OTROS' | string;
  descripcion: string;
  proveedor?: string;
  monto: number;
  metodoPago: PaymentMethodType;
  comprobante?: string;
  cajaSesionId?: string;
  usuarioId: string;
  usuarioNombre: string;
  fecha: string;
  pagadoConCajaActiva?: boolean;
}

export type AuditActionType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VOID'
  | 'SALE'
  | 'RETURN'
  | 'CREDIT_CREATED'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_VOIDED'
  | 'CASH_OPENED'
  | 'CASH_CLOSED'
  | 'INVENTORY_ADJUSTMENT'
  | 'ROLE_CHANGED'
  | 'PERMISSION_CHANGED'
  | 'USER_BLOCKED'
  | 'USER_UNBLOCKED'
  | 'SETTINGS_UPDATE';

export interface AuditLog {
  id: string;
  fecha: string;
  usuarioId: string;
  usuarioNombre: string;
  usuarioRol: string;
  accion: AuditActionType | string;
  modulo: string;
  entidad: string;
  entidadId: string;
  descripcion: string;
  detalle?: string;
  datosAnteriores?: any;
  datosNuevos?: any;
  resultado: 'EXITO' | 'FALLO';
  ip?: string;
}

export interface SystemSettings {
  nombreNegocio: string;
  eslogan: string;
  rnc: string;
  telefono: string;
  correo: string;
  direccion: string;
  ciudad: string;
  moneda: string; // e.g. "DOP"
  simboloMoneda: string; // e.g. "RD$"
  impuestoPorcentaje: number; // e.g. 18
  aplicarImpuestoPorDefecto: boolean;
  limiteCreditoPorDefecto: number; // e.g. 25000
  diasVencimientoPorDefecto: number; // e.g. 30
  descuentoMaximoCajero: number; // e.g. 10
  mensajeTicketPie: string;
  mensajeReciboPie: string;
  googleAppsScriptUrl?: string;
  modoConexion: 'LOCAL_HYBRID' | 'APPS_SCRIPT_DIRECT';
  impresionAutomatica: boolean;
  sonidosHabilitados: boolean;
}

/**
 * FASE 3.6 / PARTE 5 (Hydration-First): estado de trabajo del POS
 * persistido para sobrevivir un F5. Es solo conveniencia de UX -- nunca
 * fuente de verdad de stock, precio o venta.
 */
export interface PosWorkingState {
  cartItems: SaleItem[];
  selectedCustomerId?: string;
  discountType: 'PORCENTAJE' | 'MONTO';
  overallDiscountValue: number;
  applyTax: boolean;
}

export interface ToastNotification {
  id: string;
  tipo: 'exito' | 'informacion' | 'advertencia' | 'error';
  titulo: string;
  mensaje: string;
  duracion?: number;
}
