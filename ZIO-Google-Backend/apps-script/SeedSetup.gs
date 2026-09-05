/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: SeedSetup.gs
 * Description: Automatic database provisioner. Creates all 22 normalized sheets, sets up header rows,
 * visual formatting, and seeds initial master configuration and superadmin credentials.
 */

const SCHEMAS = {
  Configuracion: ['clave', 'valor', 'descripcion', 'actualizado_en'],
  Usuarios: ['id', 'usuario', 'nombre', 'apellido', 'correo', 'telefono', 'rol', 'estado', 'password_hash', 'password_salt', 'avatar', 'creado_en', 'ultimo_acceso'],
  Roles_Permisos: ['rol', 'nombre', 'descripcion', 'permisos_json'],
  Categorias: ['id', 'nombre', 'descripcion', 'estado'],
  Tallas: ['id', 'nombre', 'orden'],
  Colores: ['id', 'nombre', 'hex'],
  Proveedores: ['id', 'nombre', 'contacto', 'telefono', 'correo', 'rnc', 'direccion', 'estado'],
  Productos: ['id', 'sku', 'codigo_barras', 'nombre', 'descripcion', 'categoria_id', 'categoria_nombre', 'marca', 'proveedor_id', 'costo', 'precio', 'precio_especial', 'impuesto', 'descuento_maximo', 'stock_minimo', 'estado', 'imagen_url', 'creado_en'],
  Variantes: ['id', 'producto_id', 'sku', 'codigo_barras', 'color', 'talla', 'costo', 'precio', 'stock', 'estado'],
  Clientes: ['id', 'nombre', 'apellido', 'documento', 'telefono', 'correo', 'direccion', 'ciudad', 'limite_credito', 'dias_credito_por_defecto', 'notas', 'estado', 'creado_en'],
  Ventas: ['id', 'numero_venta', 'cliente_id', 'cliente_nombre', 'cliente_documento', 'vendedor_id', 'vendedor_nombre', 'caja_sesion_id', 'subtotal', 'descuento_total', 'impuesto_total', 'total', 'costo_total', 'metodo_pago', 'pagos_json', 'efectivo_recibido', 'cambio_entregado', 'es_credito', 'monto_financiado', 'cuenta_cobrar_id', 'estado', 'motivo_anulacion', 'anulada_por', 'fecha_anulacion', 'fecha'],
  Venta_Items: ['id', 'venta_id', 'producto_id', 'variante_id', 'nombre_producto', 'sku', 'talla', 'color', 'categoria', 'cantidad', 'costo_unitario', 'precio_unitario', 'descuento_porcentaje', 'descuento_monto', 'subtotal', 'impuesto_monto', 'total'],
  Creditos: ['id', 'numero_credito', 'cliente_id', 'cliente_nombre', 'cliente_telefono', 'cliente_documento', 'venta_id', 'numero_venta', 'monto_original', 'monto_pagado', 'saldo_pendiente', 'fecha_creacion', 'fecha_vencimiento', 'dias_plazo', 'estado', 'observaciones', 'creado_por'],
  Abonos: ['id', 'numero_recibo', 'cuenta_cobrar_id', 'cliente_id', 'cliente_nombre', 'venta_id', 'numero_venta', 'saldo_anterior', 'monto_abonado', 'saldo_restante', 'metodo_pago', 'referencia', 'caja_sesion_id', 'usuario_id', 'usuario_nombre', 'observaciones', 'fecha', 'estado', 'motivo_anulacion', 'anulado_por', 'fecha_anulacion'],
  Cajas: ['id', 'codigo_caja', 'caja_nombre', 'cajero_id', 'cajero_nombre', 'usuario_apertura_nombre', 'monto_inicial', 'fecha_apertura', 'observacion_apertura', 'estado', 'ventas_efectivo', 'abonos_efectivo', 'ingresos_manuales', 'retiros_manuales', 'gastos', 'devoluciones_efectivo', 'efectivo_esperado', 'efectivo_real_contado', 'diferencia', 'fecha_cierre', 'observacion_cierre'],
  Caja_Movimientos: ['id', 'caja_sesion_id', 'tipo', 'monto', 'motivo', 'categoria_gasto', 'referencia', 'usuario_id', 'usuario_nombre', 'fecha', 'estado'],
  Gastos: ['id', 'numero_gasto', 'categoria', 'descripcion', 'proveedor', 'monto', 'metodo_pago', 'comprobante', 'caja_sesion_id', 'usuario_id', 'usuario_nombre', 'fecha', 'pagado_con_caja_activa'],
  Compras: ['id', 'numero_compra', 'proveedor_id', 'proveedor', 'numero_factura_proveedor', 'items_json', 'total', 'forma_pago', 'estado', 'usuario_id', 'usuario_nombre', 'fecha', 'notas'],
  Devoluciones: ['id', 'numero_devolucion', 'venta_id', 'numero_venta', 'cliente_id', 'cliente_nombre', 'items_json', 'monto_devuelto', 'tipo_reembolso', 'motivo', 'usuario_id', 'usuario_nombre', 'fecha'],
  Inventario_Kardex: ['id', 'producto_id', 'producto_nombre', 'variante_id', 'sku', 'talla', 'color', 'cantidad', 'tipo', 'stock_anterior', 'stock_nuevo', 'motivo', 'referencia', 'usuario_id', 'usuario_nombre', 'fecha'],
  Auditoria: ['id', 'fecha', 'usuario_id', 'usuario_nombre', 'usuario_rol', 'accion', 'modulo', 'entidad', 'entidad_id', 'descripcion', 'detalle', 'resultado'],
  Secuencias: ['prefijo', 'siguiente_numero', 'actualizado_en']
};

/**
 * Main provisioner function. Can be called manually from the Apps Script editor or via API action.
 */
function setupDatabase() {
  const ss = getSpreadsheet();
  const createdSheets = [];

  Object.keys(SCHEMAS).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SCHEMAS[sheetName];

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      createdSheets.push(sheetName);
    }

    // Set and format headers in Row 1 if empty
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e293b'); // Dark slate header
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  });

  Logger.log(`[SeedSetup] Base de datos aprovisionada con éxito. Hojas: ${Object.keys(SCHEMAS).length}`);
  return {
    success: true,
    message: `Base de datos aprovisionada correctamente (${Object.keys(SCHEMAS).length} hojas).`,
    createdSheets: createdSheets
  };
}

/**
 * Seeds initial essential configuration, roles, tallas, colores, and admin user.
 */
function seedInitialData() {
  setupDatabase();
  const nowStr = getNowFormatted();

  // 1. Initial Sequences
  const secSheet = DbHelper.getSheet('Secuencias');
  if (secSheet.getLastRow() <= 1) {
    const prefixes = ['VEN', 'CLI', 'PRD', 'VAR', 'CAJA', 'ABO', 'CRED', 'MOV', 'GAS', 'COM', 'DEV', 'AUD', 'USR', 'ITM', 'CAT', 'SIZ', 'COL', 'PRV'];
    const rows = prefixes.map(p => [p, 100, nowStr]);
    DbHelper.insertRows('Secuencias', rows.map(r => ({ prefijo: r[0], siguiente_numero: r[1], actualizado_en: r[2] })));
  }

  // 2. Roles & Permissions
  const rolesSheet = DbHelper.getSheet('Roles_Permisos');
  if (rolesSheet.getLastRow() <= 1) {
    const allPermissions = [
      'ventas.crear', 'ventas.ver', 'ventas.anular', 'ventas.descuento', 'ventas.precio_especial',
      'caja.abrir', 'caja.cerrar', 'caja.movimientos', 'caja.ver',
      'productos.ver', 'productos.crear', 'productos.editar', 'productos.eliminar', 'productos.cambiar_precios',
      'inventario.ver', 'inventario.ajustar',
      'clientes.ver', 'clientes.crear', 'clientes.editar',
      'creditos.ver', 'creditos.crear', 'abonos.crear', 'creditos.anular_abonos',
      'gastos.ver', 'gastos.crear',
      'compras.ver', 'compras.crear', 'compras.proveedores',
      'devoluciones.ver', 'devoluciones.crear',
      'reportes.ventas', 'reportes.inventario', 'reportes.caja', 'reportes.creditos', 'reportes.gastos', 'reportes.utilidad',
      'admin.usuarios', 'admin.roles', 'admin.configuracion', 'auditoria.ver'
    ];

    const roleDefinitions = [
      { rol: 'ADMIN', nombre: 'Administrador General', descripcion: 'Acceso total y configuración del sistema', permisos_json: JSON.stringify(allPermissions) },
      { rol: 'GERENTE', nombre: 'Gerente de Tienda', descripcion: 'Supervisión operativa, reportes y anulación controlada', permisos_json: JSON.stringify(allPermissions.filter(p => !p.startsWith('admin.'))) },
      { rol: 'SUPERVISOR', nombre: 'Supervisor de Turno', descripcion: 'Gestión de caja, arqueos, descuentos e inventario', permisos_json: JSON.stringify(['ventas.crear', 'ventas.ver', 'ventas.anular', 'ventas.descuento', 'caja.abrir', 'caja.cerrar', 'caja.movimientos', 'caja.ver', 'productos.ver', 'inventario.ver', 'inventario.ajustar', 'clientes.ver', 'clientes.crear', 'creditos.ver', 'abonos.crear', 'gastos.ver', 'gastos.crear', 'devoluciones.ver', 'devoluciones.crear', 'reportes.ventas', 'reportes.caja']) },
      { rol: 'CAJERO', nombre: 'Cajero / POS', descripcion: 'Cobro de ventas, recepción de abonos y cuadre de turno', permisos_json: JSON.stringify(['ventas.crear', 'ventas.ver', 'caja.abrir', 'caja.cerrar', 'caja.movimientos', 'caja.ver', 'productos.ver', 'clientes.ver', 'clientes.crear', 'creditos.ver', 'abonos.crear']) },
      { rol: 'VENDEDOR', nombre: 'Asesor de Ventas', descripcion: 'Consulta de catálogo y registro de ventas', permisos_json: JSON.stringify(['ventas.crear', 'ventas.ver', 'productos.ver', 'clientes.ver', 'clientes.crear']) }
    ];

    DbHelper.insertRows('Roles_Permisos', roleDefinitions);
  }

  // 3. Initial Users (with SHA-256 + Salt hashed passwords)
  const usersSheet = DbHelper.getSheet('Usuarios');
  if (usersSheet.getLastRow() <= 1) {
    const adminSalt = Security.generateSalt(16);
    const cajeroSalt = Security.generateSalt(16);
    // FASE 3.6 (corrección de bloqueante — Parte 8): el frontend ofrece un
    // acceso rápido "Encargado" (rol GERENTE, ya definido arriba en
    // roleDefinitions) para el que no existía ningún usuario semilla real
    // -- se agrega aquí, coherente con el modelo real de usuarios/RBAC, en
    // vez de inventar credenciales fuera del sistema de seed.
    const gerenteSalt = Security.generateSalt(16);

    const initialUsers = [
      {
        id: 'USR-001',
        usuario: 'admin',
        nombre: 'Carlos',
        apellido: 'Mendoza',
        correo: 'admin@zioclothes.com',
        telefono: '809-555-0100',
        rol: 'ADMIN',
        estado: 'ACTIVO',
        password_hash: Security.hashPassword('admin123', adminSalt),
        password_salt: adminSalt,
        avatar: '',
        creado_en: nowStr,
        ultimo_acceso: ''
      },
      {
        id: 'USR-002',
        usuario: 'cajero',
        nombre: 'Ana',
        apellido: 'Castillo',
        correo: 'cajero@zioclothes.com',
        telefono: '809-555-0101',
        rol: 'CAJERO',
        estado: 'ACTIVO',
        password_hash: Security.hashPassword('cajero123', cajeroSalt),
        password_salt: cajeroSalt,
        avatar: '',
        creado_en: nowStr,
        ultimo_acceso: ''
      },
      {
        id: 'USR-003',
        usuario: 'gerente',
        nombre: 'Luis',
        apellido: 'Ramírez',
        correo: 'gerente@zioclothes.com',
        telefono: '809-555-0102',
        rol: 'GERENTE',
        estado: 'ACTIVO',
        password_hash: Security.hashPassword('gerente123', gerenteSalt),
        password_salt: gerenteSalt,
        avatar: '',
        creado_en: nowStr,
        ultimo_acceso: ''
      }
    ];

    DbHelper.insertRows('Usuarios', initialUsers);
  }

  // 4. Categories
  const catSheet = DbHelper.getSheet('Categorias');
  if (catSheet.getLastRow() <= 1) {
    const categories = [
      { id: 'CAT-001', nombre: 'Vestidos de Fiesta', descripcion: 'Trajes de gala y vestidos para eventos', estado: 'ACTIVO' },
      { id: 'CAT-002', nombre: 'Blusas y Tops', descripcion: 'Blusas casuales y formales en lino y seda', estado: 'ACTIVO' },
      { id: 'CAT-003', nombre: 'Pantalones y Jeans', descripcion: 'Pantalones sastre, palazzo y denim premium', estado: 'ACTIVO' },
      { id: 'CAT-004', nombre: 'Faldas', descripcion: 'Faldas midi, plisadas y tubo de alta costura', estado: 'ACTIVO' },
      { id: 'CAT-005', nombre: 'Chaquetas y Blazers', descripcion: 'Sacos ejecutivos y gabardinas finas', estado: 'ACTIVO' },
      { id: 'CAT-006', nombre: 'Accesorios y Calzado', descripcion: 'Cinturones de cuero, pañuelos y calzado boutique', estado: 'ACTIVO' }
    ];
    DbHelper.insertRows('Categorias', categories);
  }

  // 5. Sizes
  const sizeSheet = DbHelper.getSheet('Tallas');
  if (sizeSheet.getLastRow() <= 1) {
    const sizes = [
      { id: 'SIZ-001', nombre: 'XS', orden: 1 },
      { id: 'SIZ-002', nombre: 'S', orden: 2 },
      { id: 'SIZ-003', nombre: 'M', orden: 3 },
      { id: 'SIZ-004', nombre: 'L', orden: 4 },
      { id: 'SIZ-005', nombre: 'XL', orden: 5 },
      { id: 'SIZ-006', nombre: '32', orden: 6 },
      { id: 'SIZ-007', nombre: '34', orden: 7 },
      { id: 'SIZ-008', nombre: '36', orden: 8 },
      { id: 'SIZ-009', nombre: '38', orden: 9 }
    ];
    DbHelper.insertRows('Tallas', sizes);
  }

  // 6. Colors
  const colorSheet = DbHelper.getSheet('Colores');
  if (colorSheet.getLastRow() <= 1) {
    const colors = [
      { id: 'COL-001', nombre: 'Negro Ónix', hex: '#1A1A1A' },
      { id: 'COL-002', nombre: 'Blanco Perla', hex: '#F8F9FA' },
      { id: 'COL-003', nombre: 'Beige Arena', hex: '#D2B48C' },
      { id: 'COL-004', nombre: 'Rojo Borgoña', hex: '#800020' },
      { id: 'COL-005', nombre: 'Azul Marino', hex: '#000080' },
      { id: 'COL-006', nombre: 'Verde Esmeralda', hex: '#50C878' },
      { id: 'COL-007', nombre: 'Rosa Palo', hex: '#DDA0DD' }
    ];
    DbHelper.insertRows('Colores', colors);
  }

  // 7. Suppliers
  const supSheet = DbHelper.getSheet('Proveedores');
  if (supSheet.getLastRow() <= 1) {
    const suppliers = [
      { id: 'PRV-001', nombre: 'Confecciones Textiles Caribe', contacto: 'Manuel Rodríguez', telefono: '809-555-0301', correo: 'pedidos@textilescaribe.com', rnc: '101-99887-1', direccion: 'Zona Franca San Isidro, Nave 4B', estado: 'ACTIVO' },
      { id: 'PRV-002', nombre: 'Importadora Alta Costura Italiana', contacto: 'Lucia Ferretti', telefono: '809-555-0302', correo: 'import@altacostura.com', rnc: '102-33445-2', direccion: 'Av. 27 de Febrero #450, Piantini', estado: 'ACTIVO' }
    ];
    DbHelper.insertRows('Proveedores', suppliers);
  }

  // 8. Default System Settings
  const confSheet = DbHelper.getSheet('Configuracion');
  if (confSheet.getLastRow() <= 1) {
    const configs = [
      { clave: 'nombreNegocio', valor: 'ZIO CLOTHES', descripcion: 'Nombre comercial de la boutique', actualizado_en: nowStr },
      { clave: 'rnc', valor: '132-45678-9', descripcion: 'RNC fiscal de la empresa', actualizado_en: nowStr },
      { clave: 'telefono', valor: '809-555-0192', descripcion: 'Teléfono de contacto tienda', actualizado_en: nowStr },
      { clave: 'correo', valor: 'contacto@zioclothes.com', descripcion: 'Correo oficial', actualizado_en: nowStr },
      { clave: 'direccion', valor: 'Av. Winston Churchill #109, BlueMall Nivel 2, Santo Domingo', descripcion: 'Dirección física', actualizado_en: nowStr },
      { clave: 'moneda', valor: 'RD$', descripcion: 'Símbolo monetario por defecto', actualizado_en: nowStr },
      { clave: 'impuestoPorcentaje', valor: '18', descripcion: 'Porcentaje ITBIS aplicable', actualizado_en: nowStr },
      { clave: 'pieTicket', valor: '¡Gracias por elegir ZIO CLOTHES! Calidad y elegancia en cada prenda.', descripcion: 'Mensaje al pie del comprobante', actualizado_en: nowStr },
      { clave: 'politicaDevolucion', valor: 'Cambios permitidos dentro de los 15 días con recibo original y etiquetas.', descripcion: 'Términos de cambio', actualizado_en: nowStr },
      { clave: 'permitirVentaSinStock', valor: 'false', descripcion: 'Restricción estricta de inventario en POS', actualizado_en: nowStr },
      { clave: 'notificarStockBajo', valor: 'true', descripcion: 'Alerta visual en POS ante agotamiento', actualizado_en: nowStr },
      { clave: 'umbralStockBajo', valor: '5', descripcion: 'Unidades mínimas de alerta', actualizado_en: nowStr },
      { clave: 'diasCreditoPorDefecto', valor: '15', descripcion: 'Plazo predeterminado de cuentas por cobrar', actualizado_en: nowStr }
    ];
    DbHelper.insertRows('Configuracion', configs);
  }

  Logger.log('[SeedSetup] Datos iniciales sembrados con éxito.');
  return {
    success: true,
    message: 'Base de datos inicializada con usuarios semilla (admin/admin123, cajero/cajero123, gerente/gerente123) y roles maestros.'
  };
}
