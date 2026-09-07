import { PermissionCode, RolePermissionConfig, UserRole } from '../types';

export interface PermissionGroup {
  modulo: string;
  nombre: string;
  permisos: {
    codigo: PermissionCode;
    nombre: string;
    descripcion: string;
  }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    modulo: 'VENTAS',
    nombre: 'Ventas y POS',
    permisos: [
      { codigo: 'ventas.ver', nombre: 'Ver ventas', descripcion: 'Consultar listado e historial de ventas realizadas' },
      { codigo: 'ventas.crear', nombre: 'Crear ventas (POS)', descripcion: 'Realizar nuevas ventas en el punto de venta' },
      { codigo: 'ventas.editar', nombre: 'Editar ventas', descripcion: 'Modificar datos permitidos de una venta' },
      { codigo: 'ventas.anular', nombre: 'Anular ventas', descripcion: 'Cancelar ventas y revertir inventario' },
      { codigo: 'ventas.descuentos', nombre: 'Aplicar descuentos', descripcion: 'Otorgar rebajas en el punto de venta' },
      { codigo: 'ventas.ver_costos', nombre: 'Ver costos en ventas', descripcion: 'Visualizar costo unitario de productos al vender' },
      { codigo: 'ventas.ver_ganancias', nombre: 'Ver ganancias en ventas', descripcion: 'Visualizar margen de ganancia en el POS' },
    ],
  },
  {
    modulo: 'PRODUCTOS',
    nombre: 'Productos y Variantes',
    permisos: [
      { codigo: 'productos.ver', nombre: 'Ver productos', descripcion: 'Consultar catálogo de ropa, tallas y colores' },
      { codigo: 'productos.crear', nombre: 'Crear productos', descripcion: 'Registrar nuevas prendas y variantes' },
      { codigo: 'productos.editar', nombre: 'Editar productos', descripcion: 'Modificar precios, fotos, descripciones' },
      { codigo: 'productos.eliminar', nombre: 'Eliminar productos', descripcion: 'Desactivar o borrar prendas del catálogo' },
      { codigo: 'productos.cambiar_precios', nombre: 'Cambiar precios', descripcion: 'Actualizar precios de venta y ofertas' },
      { codigo: 'productos.ver_costos', nombre: 'Ver costos de compra', descripcion: 'Visualizar costo de adquisición de prendas' },
    ],
  },
  {
    modulo: 'INVENTARIO',
    nombre: 'Inventario',
    permisos: [
      { codigo: 'inventario.ver', nombre: 'Ver inventario', descripcion: 'Consultar existencias por talla y color' },
      { codigo: 'inventario.ajustar', nombre: 'Ajustar inventario', descripcion: 'Registrar entradas, mermas y correcciones' },
      { codigo: 'inventario.movimientos', nombre: 'Ver movimientos', descripcion: 'Consultar bitácora de entradas y salidas' },
      { codigo: 'inventario.transferencias', nombre: 'Transferencias', descripcion: 'Mover mercancía entre sucursales o almacenes' },
    ],
  },
  {
    modulo: 'CLIENTES',
    nombre: 'Clientes',
    permisos: [
      { codigo: 'clientes.ver', nombre: 'Ver clientes', descripcion: 'Consultar directorio y fichas de clientes' },
      { codigo: 'clientes.crear', nombre: 'Crear clientes', descripcion: 'Registrar nuevos clientes en el sistema' },
      { codigo: 'clientes.editar', nombre: 'Editar clientes', descripcion: 'Actualizar datos de contacto y direcciones' },
      { codigo: 'clientes.eliminar', nombre: 'Eliminar clientes', descripcion: 'Desactivar cuentas de clientes' },
    ],
  },
  {
    modulo: 'CREDITOS',
    nombre: 'Créditos y Cuentas por Cobrar',
    permisos: [
      { codigo: 'creditos.ver', nombre: 'Ver créditos', descripcion: 'Consultar cuentas por cobrar y deudas' },
      { codigo: 'creditos.crear', nombre: 'Crear venta a crédito', descripcion: 'Autorizar y procesar ventas financiadas' },
      { codigo: 'creditos.abonos', nombre: 'Registrar abonos', descripcion: 'Cobrar pagos parciales o totales de deudas' },
      { codigo: 'creditos.anular_abonos', nombre: 'Anular abonos', descripcion: 'Revertir recibos de pago con justificación' },
      { codigo: 'creditos.modificar', nombre: 'Modificar condiciones', descripcion: 'Ajustar límites de crédito y plazos' },
      { codigo: 'creditos.ver_deudas', nombre: 'Ver saldos deudores', descripcion: 'Consultar estado financiero del cliente' },
      { codigo: 'creditos.ver_vencidas', nombre: 'Ver cuentas vencidas', descripcion: 'Acceder a gestión de cobranza y mora' },
    ],
  },
  {
    // FASE 7 (Parte 27 -- "no dejar referencias incompletas"): estos 4
    // permisos ya existen y se validan en el backend real desde la FASE 6
    // (CreditNotesController.gs/SeedSetup.gs) -- se agregan aquí también
    // para que este catálogo (usado como fallback antes de tener una
    // sesión real, ver AuthContext.hasPermission) no quede desactualizado
    // respecto a lo que el backend realmente reconoce.
    modulo: 'CREDITOS_FAVOR',
    nombre: 'Créditos a Favor / Vales y Notas de Crédito',
    permisos: [
      { codigo: 'creditos_favor.ver', nombre: 'Ver créditos a favor', descripcion: 'Consultar Vales/Notas de Crédito y su saldo disponible' },
      { codigo: 'creditos_favor.crear', nombre: 'Emitir créditos a favor', descripcion: 'Generar un Vale/Nota de Crédito a partir de una devolución' },
      { codigo: 'creditos_favor.aplicar', nombre: 'Aplicar créditos a favor', descripcion: 'Usar el saldo de un Vale/Nota de Crédito como pago en una venta' },
      { codigo: 'creditos_favor.anular', nombre: 'Anular créditos a favor', descripcion: 'Anular un Vale/Nota de Crédito emitido que aún no fue aplicado' },
    ],
  },
  {
    modulo: 'CAJA',
    nombre: 'Caja y Efectivo',
    permisos: [
      { codigo: 'caja.abrir', nombre: 'Abrir caja', descripcion: 'Iniciar turno con fondo inicial' },
      { codigo: 'caja.cerrar', nombre: 'Cerrar caja', descripcion: 'Realizar arqueo y cierre de turno' },
      { codigo: 'caja.ver', nombre: 'Ver balance de caja', descripcion: 'Consultar saldo en tiempo real de la sesión' },
      { codigo: 'caja.ingresos', nombre: 'Registrar ingresos', descripcion: 'Ingresar efectivo manual a la caja' },
      { codigo: 'caja.retiros', nombre: 'Registrar retiros', descripcion: 'Retirar dinero de caja chica o depósito' },
      { codigo: 'caja.gastos', nombre: 'Registrar gastos', descripcion: 'Registrar pagos de servicios con caja' },
      { codigo: 'caja.anular_movimientos', nombre: 'Anular movimientos', descripcion: 'Revertir transacciones de caja erróneas' },
    ],
  },
  {
    modulo: 'COMPRAS',
    nombre: 'Compras y Proveedores',
    permisos: [
      { codigo: 'compras.ver', nombre: 'Ver compras', descripcion: 'Consultar historial de órdenes y compras' },
      { codigo: 'compras.crear', nombre: 'Registrar compras', descripcion: 'Ingresar nueva mercancía de proveedores' },
      { codigo: 'compras.proveedores', nombre: 'Administrar proveedores', descripcion: 'Gestionar contactos y datos de suplidores' },
    ],
  },
  {
    modulo: 'DEVOLUCIONES',
    nombre: 'Devoluciones',
    permisos: [
      { codigo: 'devoluciones.ver', nombre: 'Ver devoluciones', descripcion: 'Consultar historial de cambios y devoluciones' },
      { codigo: 'devoluciones.crear', nombre: 'Procesar devolución', descripcion: 'Reintegrar prendas a inventario y ajustar saldo' },
    ],
  },
  {
    modulo: 'REPORTES',
    nombre: 'Reportes y Estadísticas',
    permisos: [
      { codigo: 'reportes.dashboard', nombre: 'Acceso al Dashboard', descripcion: 'Visualizar resumen ejecutivo e indicadores clave' },
      { codigo: 'reportes.ventas', nombre: 'Reportes de ventas', descripcion: 'Reportes detallados por fecha, cajero y producto' },
      { codigo: 'reportes.inventario', nombre: 'Reportes de inventario', descripcion: 'Valoración de stock, rotación y bajas' },
      { codigo: 'reportes.compras', nombre: 'Reportes de compras', descripcion: 'Historial de adquisiciones y costos' },
      { codigo: 'reportes.caja', nombre: 'Reportes de caja', descripcion: 'Arqueos históricos y flujo de efectivo' },
      { codigo: 'reportes.creditos', nombre: 'Reportes de créditos', descripcion: 'Cuentas por cobrar y antigüedad de deuda' },
      { codigo: 'reportes.deudas', nombre: 'Reportes de deudas', descripcion: 'Análisis de cartera y morosidad' },
      { codigo: 'reportes.ganancias', nombre: 'Reportes de ganancias', descripcion: 'Márgenes de rentabilidad y utilidad neta' },
      { codigo: 'reportes.auditoria', nombre: 'Ver auditoría', descripcion: 'Consultar bitácora de seguridad y acciones de usuarios' },
    ],
  },
  {
    modulo: 'ADMINISTRACION',
    nombre: 'Administración del Sistema',
    permisos: [
      { codigo: 'admin.usuarios', nombre: 'Gestión de usuarios', descripcion: 'Crear, editar, activar y bloquear usuarios' },
      { codigo: 'admin.roles', nombre: 'Gestión de roles', descripcion: 'Crear y configurar perfiles de acceso' },
      { codigo: 'admin.permisos', nombre: 'Matriz de permisos', descripcion: 'Asignar permisos específicos a roles' },
      { codigo: 'admin.configuracion', nombre: 'Configuración general', descripcion: 'Parámetros del negocio, Google Sheets, recibos' },
    ],
  },
];

export const ALL_PERMISSIONS: PermissionCode[] = PERMISSION_GROUPS.flatMap((g) => g.permisos.map((p) => p.codigo));

/**
 * TAREA -- SISTEMA DE PERMISOS DE VISTAS POR ROL.
 *
 * Catálogo de las 16 vistas reales del sistema (idénticas a `AppView` /
 * `VALID_VIEWS` en App.tsx -- ninguna inventada) para la pantalla
 * "Roles y Permisos -> Acceso a Vistas". `id` es el mismo valor que ya
 * usa `AppView`/`Sidebar` (también usado por `canView(id)` en
 * AuthContext, que arma el código real como `vista.<id>`).
 */
export interface ViewAccessDef {
  id: string;
  label: string;
}

export const VIEW_ACCESS_CATALOG: ViewAccessDef[] = [
  { id: 'dashboard', label: 'Panel Principal' },
  { id: 'pos', label: 'Caja & Mostrador POS' },
  { id: 'sales', label: 'Historial de Ventas' },
  { id: 'returns', label: 'Devoluciones' },
  { id: 'products', label: 'Productos' },
  { id: 'inventory', label: 'Inventario / Kardex' },
  { id: 'purchases', label: 'Órdenes de Compra' },
  { id: 'credits', label: 'Cuentas por Cobrar' },
  { id: 'installments', label: 'Abonos Recibidos' },
  { id: 'creditNotes', label: 'Notas de Crédito' },
  { id: 'storeCredits', label: 'Créditos a Favor / Vales' },
  { id: 'cash', label: 'Caja & Cuadres de Turno' },
  { id: 'customers', label: 'Clientes' },
  { id: 'expenses', label: 'Gastos Operativos' },
  { id: 'reports', label: 'Reportes & Margen' },
  { id: 'settings', label: 'Configuración' },
];

export const ALL_VIEW_PERMISSIONS: PermissionCode[] = VIEW_ACCESS_CATALOG.map(
  (v) => `vista.${v.id}` as PermissionCode
);

/**
 * Roles editables desde "Acceso a Vistas" -- ADMIN queda deliberadamente
 * fuera (Fase 17): `hasPermission` ya le da acceso total sin mirar
 * `permisos_json`, así que mostrarlo como editable no tendría ningún
 * efecto real y solo podría hacer creer a quien lo edite que restringió
 * al administrador.
 */
export const EDITABLE_ROLES: UserRole[] = ['GERENTE', 'SUPERVISOR', 'CAJERO', 'VENDEDOR'];

/**
 * Defaults de vista.* por rol -- exactamente los mismos que
 * `VIEW_PERMISSIONS_BY_ROLE` en SeedSetup.gs/migrateViewPermissions
 * (backend, fuente de verdad real). Se duplican aquí únicamente como
 * fallback local (mismo criterio que el resto de este archivo, usado por
 * AuthContext.hasPermission solo antes de que exista una sesión real).
 */
const DEFAULT_VIEW_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  ADMIN: [...ALL_VIEW_PERMISSIONS],
  GERENTE: [...ALL_VIEW_PERMISSIONS],
  SUPERVISOR: [
    'vista.pos', 'vista.sales', 'vista.returns', 'vista.products', 'vista.inventory', 'vista.purchases',
    'vista.credits', 'vista.installments', 'vista.creditNotes', 'vista.storeCredits', 'vista.cash',
    'vista.customers', 'vista.expenses', 'vista.reports',
  ],
  CAJERO: [
    'vista.pos', 'vista.sales', 'vista.returns', 'vista.products', 'vista.credits', 'vista.installments',
    'vista.creditNotes', 'vista.storeCredits', 'vista.cash', 'vista.customers',
  ],
  VENDEDOR: ['vista.pos', 'vista.sales', 'vista.products', 'vista.creditNotes', 'vista.storeCredits', 'vista.customers'],
};

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  ADMIN: [...ALL_PERMISSIONS, ...DEFAULT_VIEW_PERMISSIONS.ADMIN],
  CAJERO: [
    'ventas.ver',
    'ventas.crear',
    'ventas.descuentos',
    'productos.ver',
    'inventario.ver',
    'clientes.ver',
    'clientes.crear',
    'clientes.editar',
    'creditos.ver',
    'creditos.crear',
    'creditos.abonos',
    'abonos.ver',
    'abonos.crear',
    'creditos.ver_deudas',
    'creditos.ver_vencidas',
    // FASE 7 (Parte 27): mismo criterio ya usado en SeedSetup.gs -- CAJERO
    // puede consultar y aplicar créditos a favor/notas de crédito en una
    // venta, pero no emitirlos (no procesa devoluciones por defecto) ni
    // anularlos.
    'creditos_favor.ver',
    'creditos_favor.aplicar',
    'caja.abrir',
    'caja.cerrar',
    'caja.ver',
    'caja.ingresos',
    'caja.gastos',
    'devoluciones.ver',
    'devoluciones.crear',
    'reportes.dashboard',
    ...DEFAULT_VIEW_PERMISSIONS.CAJERO,
  ],
  SUPERVISOR: [
    'ventas.ver',
    'ventas.crear',
    'ventas.editar',
    'ventas.anular',
    'ventas.descuentos',
    'productos.ver',
    'productos.crear',
    'productos.editar',
    'inventario.ver',
    'inventario.ajustar',
    'inventario.movimientos',
    'clientes.ver',
    'clientes.crear',
    'clientes.editar',
    'creditos.ver',
    'creditos.crear',
    'creditos.abonos',
    'abonos.ver',
    'abonos.crear',
    'creditos.anular_abonos',
    'creditos.ver_deudas',
    'creditos.ver_vencidas',
    // FASE 7 (Parte 27): mismo criterio ya usado en SeedSetup.gs -- igual
    // que con 'creditos.anular_abonos' arriba, SUPERVISOR puede ver/crear/
    // aplicar créditos a favor pero no anularlos.
    'creditos_favor.ver',
    'creditos_favor.crear',
    'creditos_favor.aplicar',
    'caja.abrir',
    'caja.cerrar',
    'caja.ver',
    'caja.ingresos',
    'caja.retiros',
    'caja.gastos',
    'caja.anular_movimientos',
    'devoluciones.ver',
    'devoluciones.crear',
    'compras.ver',
    'reportes.dashboard',
    'reportes.ventas',
    'reportes.inventario',
    'reportes.creditos',
    'reportes.caja',
    ...DEFAULT_VIEW_PERMISSIONS.SUPERVISOR,
  ],
  VENDEDOR: [
    'ventas.ver',
    'ventas.crear',
    'productos.ver',
    'inventario.ver',
    'clientes.ver',
    'clientes.crear',
    'creditos.ver',
    'creditos.ver_deudas',
    // FASE 7 (Parte 27): mismo criterio ya usado en SeedSetup.gs -- puede
    // ver/aplicar créditos a favor en el POS, no emitirlos ni anularlos.
    'creditos_favor.ver',
    'creditos_favor.aplicar',
    ...DEFAULT_VIEW_PERMISSIONS.VENDEDOR,
  ],
  GERENTE: [
    ...ALL_PERMISSIONS.filter((p) => p !== 'admin.configuracion' && p !== 'admin.roles'),
    ...DEFAULT_VIEW_PERMISSIONS.GERENTE,
  ],
};
