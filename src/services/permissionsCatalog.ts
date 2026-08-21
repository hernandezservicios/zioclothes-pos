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

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  ADMIN: [...ALL_PERMISSIONS],
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
    'caja.abrir',
    'caja.cerrar',
    'caja.ver',
    'caja.ingresos',
    'caja.gastos',
    'devoluciones.ver',
    'devoluciones.crear',
    'reportes.dashboard',
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
  ],
  GERENTE: [
    ...ALL_PERMISSIONS.filter((p) => p !== 'admin.configuracion' && p !== 'admin.roles'),
  ],
};
