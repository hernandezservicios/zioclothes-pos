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
  // FASE (normalización comercial -- variantes opcionales): se agregó
  // 'tiene_variantes' al final -- solo aplica a instalaciones NUEVAS
  // (setupDatabase crea la hoja con estos headers desde cero). Una
  // instalación YA EXISTENTE conserva sus columnas actuales tal cual
  // están en su Google Sheet real; DbHelper.insertRow/updateRowById
  // mapean por nombre de columna leído del propio Sheet, así que si esa
  // columna todavía no existe ahí, el valor se ignora sin error -- nunca
  // rompe nada, simplemente no persiste hasta que se agregue la columna
  // manualmente (ver reporte).
  Productos: ['id', 'sku', 'codigo_barras', 'nombre', 'descripcion', 'categoria_id', 'categoria_nombre', 'marca', 'proveedor_id', 'costo', 'precio', 'precio_especial', 'impuesto', 'descuento_maximo', 'stock_minimo', 'estado', 'imagen_url', 'creado_en', 'tiene_variantes'],
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
  // FASE 6 (devoluciones/notas de crédito/créditos a favor): un crédito a
  // favor (VALE_TIENDA) y una nota de crédito (NOTA_CREDITO) son el MISMO
  // pasivo comercial ("el negocio le debe un valor al cliente") con la
  // misma necesidad de número/monto/saldo/estado/aplicaciones -- se
  // modelan en UNA sola hoja distinguida por `tipo`, en vez de duplicar
  // dos estructuras idénticas (ver decisión documentada en el reporte,
  // Parte J). Espeja exactamente el mismo patrón ya usado por
  // Creditos/Abonos (documento + hoja de aplicaciones/movimientos
  // separada), solo que en la dirección opuesta del saldo.
  Creditos_Favor: ['id', 'numero', 'tipo', 'cliente_id', 'cliente_nombre', 'devolucion_id', 'venta_origen_id', 'monto_original', 'monto_aplicado', 'saldo_disponible', 'estado', 'motivo_anulacion', 'anulado_por', 'fecha_anulacion', 'usuario_id', 'usuario_nombre', 'fecha_creacion', 'actualizado_en'],
  // Historial de aplicaciones -- nunca se sobreescribe, solo se agregan
  // filas, para poder reconstruir exactamente en qué ventas se usó cada
  // crédito/nota (Parte 10 de la fase).
  Creditos_Favor_Aplicaciones: ['id', 'credito_favor_id', 'venta_id', 'numero_venta', 'monto', 'fecha', 'usuario_id', 'usuario_nombre'],
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
    // FASE 6: 'NC' (Nota de Crédito) y 'VALE' (Crédito a Favor/Vale) para
    // Creditos_Favor.id/numero -- mismo id sirve de "numero" visible,
    // igual que ya hace Abonos (numero_recibo = id) y Devoluciones
    // (numero_devolucion = id). 'CFAPP' para Creditos_Favor_Aplicaciones.id.
    const prefixes = ['VEN', 'CLI', 'PRD', 'VAR', 'CAJA', 'ABO', 'CRED', 'MOV', 'GAS', 'COM', 'DEV', 'AUD', 'USR', 'ITM', 'CAT', 'SIZ', 'COL', 'PRV', 'NC', 'VALE', 'CFAPP'];
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
      // FASE 6 (créditos a favor / notas de crédito): un solo grupo de
      // permisos para ambos documentos -- son el mismo pasivo comercial
      // (ver Creditos_Favor.tipo), así que comparten control de acceso.
      'creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar', 'creditos_favor.anular',
      'gastos.ver', 'gastos.crear',
      'compras.ver', 'compras.crear', 'compras.proveedores',
      'devoluciones.ver', 'devoluciones.crear',
      'reportes.ventas', 'reportes.inventario', 'reportes.caja', 'reportes.creditos', 'reportes.gastos', 'reportes.utilidad',
      'admin.usuarios', 'admin.roles', 'admin.configuracion', 'auditoria.ver'
    ];

    const roleDefinitions = [
      { rol: 'ADMIN', nombre: 'Administrador General', descripcion: 'Acceso total y configuración del sistema', permisos_json: JSON.stringify(allPermissions) },
      { rol: 'GERENTE', nombre: 'Gerente de Tienda', descripcion: 'Supervisión operativa, reportes y anulación controlada', permisos_json: JSON.stringify(allPermissions.filter(p => !p.startsWith('admin.'))) },
      // FASE 6: SUPERVISOR obtiene creditos_favor.ver/crear/aplicar (ya
      // procesa devoluciones.crear, de donde se emiten) pero NO
      // creditos_favor.anular -- mismo criterio restrictivo ya usado para
      // creditos.anular_abonos (tampoco en la lista de SUPERVISOR, solo
      // vía ADMIN/GERENTE). CAJERO/VENDEDOR obtienen solo
      // creditos_favor.ver/aplicar (pueden aplicar un crédito ya emitido
      // durante una venta), no .crear (no procesan devoluciones hoy) ni
      // .anular.
      { rol: 'SUPERVISOR', nombre: 'Supervisor de Turno', descripcion: 'Gestión de caja, arqueos, descuentos e inventario', permisos_json: JSON.stringify(['ventas.crear', 'ventas.ver', 'ventas.anular', 'ventas.descuento', 'caja.abrir', 'caja.cerrar', 'caja.movimientos', 'caja.ver', 'productos.ver', 'inventario.ver', 'inventario.ajustar', 'clientes.ver', 'clientes.crear', 'creditos.ver', 'abonos.crear', 'creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar', 'gastos.ver', 'gastos.crear', 'devoluciones.ver', 'devoluciones.crear', 'reportes.ventas', 'reportes.caja']) },
      { rol: 'CAJERO', nombre: 'Cajero / POS', descripcion: 'Cobro de ventas, recepción de abonos y cuadre de turno', permisos_json: JSON.stringify(['ventas.crear', 'ventas.ver', 'caja.abrir', 'caja.cerrar', 'caja.movimientos', 'caja.ver', 'productos.ver', 'clientes.ver', 'clientes.crear', 'creditos.ver', 'abonos.crear', 'creditos_favor.ver', 'creditos_favor.aplicar']) },
      { rol: 'VENDEDOR', nombre: 'Asesor de Ventas', descripcion: 'Consulta de catálogo y registro de ventas', permisos_json: JSON.stringify(['ventas.crear', 'ventas.ver', 'productos.ver', 'clientes.ver', 'clientes.crear', 'creditos_favor.ver', 'creditos_favor.aplicar']) }
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

  // FASE FINAL (integración CONFIG -> almacenamiento de imágenes): una
  // instalación "lista para usar" también debe dejar resuelta su carpeta
  // de Drive para fotos de productos, sin depender de que alguien suba una
  // fotografía primero. Se reutiliza tal cual la función administrativa ya
  // centralizada en ProductsController.gs (PRODUCT_IMAGES_FOLDER_ID vía
  // PropertiesService, getOrCreateProductImagesFolder) -- este archivo NO
  // duplica ni reimplementa nada de Drive, solo llama a la función que ya
  // existe. Se integra aquí (seedInitialData) y no en setupDatabase()
  // porque seedInitialData es el único flujo que deja una instalación
  // nueva realmente utilizable de principio a fin (hojas + roles +
  // usuarios + configuración semilla) -- setupDatabase() por sí solo sigue
  // siendo un paso puramente estructural (crear hojas/encabezados) que debe
  // poder re-ejecutarse sobre una instalación ya existente (por ejemplo,
  // para añadir una hoja nueva a un negocio ya en producción) sin
  // necesidad de volver a tocar Drive cada vez. Es idempotente: si
  // PRODUCT_IMAGES_FOLDER_ID ya está configurado y la carpeta sigue siendo
  // accesible, no crea nada nuevo, solo la reutiliza.
  const productImageStorage = ProductsController.initializeProductImageStorage();

  Logger.log('[SeedSetup] Datos iniciales sembrados con éxito.');
  return {
    success: true,
    message: 'Base de datos inicializada con usuarios semilla (admin/admin123, cajero/cajero123, gerente/gerente123) y roles maestros.',
    productImageStorage: productImageStorage
  };
}

/**
 * FASE 8 (Parte 2) — Migración IDEMPOTENTE de permisos `creditos_favor.*`
 * para instalaciones YA EXISTENTES.
 *
 * Por qué es necesaria: `seedInitialData()` solo siembra `Roles_Permisos`
 * `if (rolesSheet.getLastRow() <= 1)` -- una instalación que ya tenía
 * roles sembrados ANTES de la Fase 6 nunca recibió automáticamente
 * `creditos_favor.ver/crear/aplicar/anular` (riesgo documentado en los
 * reportes de Fase 6 y 7). Esta función cierra ese hueco sin necesidad de
 * editar la hoja a mano.
 *
 * Limitación de arquitectura detectada (documentada, no rodeada con un
 * hack): `Roles_Permisos` NO tiene columna `id` -- su clave natural es
 * `rol` (una fila por rol). `DbHelper.updateRowById`/`findById` están
 * codificados para buscar específicamente una columna llamada `id`
 * (`headers.indexOf('id')`), así que no sirven aquí. En vez de modificar
 * `DbHelper.gs` (fuera del alcance de esta fase, y usado por muchas otras
 * hojas que sí tienen `id`), esta función replica el mismo patrón de
 * lectura/escritura de `DbHelper.updateRowById` (leer todas las filas,
 * ubicar el índice de fila, reescribir solo la celda necesaria) pero
 * localizando la fila por `rol` en vez de por `id` -- ningún dato ni
 * columna existente se toca fuera de `permisos_json`.
 *
 * Garantías (Parte 2, requisitos explícitos):
 *  - Solo AGREGA las 4 cadenas nuevas que falten -- nunca quita, nunca
 *    reemplaza el arreglo completo.
 *  - Nunca duplica: compara contra el arreglo actual antes de agregar.
 *  - Roles fuera de los 5 estándar (ADMIN/GERENTE/SUPERVISOR/CAJERO/
 *    VENDEDOR) -- p. ej. un rol personalizado creado por el negocio -- se
 *    dejan completamente intactos, porque no existe un conjunto "correcto"
 *    definido para ellos y esta fase prohíbe explícitamente inventar uno.
 *  - Una fila cuyo `permisos_json` no se pueda parsear como arreglo JSON
 *    válido NUNCA se sobreescribe (se reporta para revisión manual) --
 *    nunca se arriesga a corromper datos ya existentes.
 *  - Ejecutarla dos (o más) veces produce exactamente el mismo resultado
 *    que ejecutarla una vez.
 */
const CREDITOS_FAVOR_PERMISSIONS_BY_ROLE = {
  ADMIN: ['creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar', 'creditos_favor.anular'],
  GERENTE: ['creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar', 'creditos_favor.anular'],
  SUPERVISOR: ['creditos_favor.ver', 'creditos_favor.crear', 'creditos_favor.aplicar'],
  CAJERO: ['creditos_favor.ver', 'creditos_favor.aplicar'],
  VENDEDOR: ['creditos_favor.ver', 'creditos_favor.aplicar']
};

function migrateCreditosFavorPermissions() {
  const sheet = DbHelper.getSheet('Roles_Permisos');
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return {
      success: true,
      message: 'Roles_Permisos está vacía -- nada que migrar (seedInitialData la sembrará ya con estos permisos incluidos).',
      rolesUpdated: [], rolesUnchanged: [], rolesSkippedUnknown: [], rolesSkippedInvalidJson: []
    };
  }

  const headers = data[0].map(h => String(h).trim());
  const rolColIdx = headers.indexOf('rol');
  const jsonColIdx = headers.indexOf('permisos_json');
  if (rolColIdx === -1 || jsonColIdx === -1) {
    throw new Error("MIGRATION_UNSAFE: La hoja 'Roles_Permisos' no tiene las columnas esperadas ('rol'/'permisos_json') -- no se ejecuta ninguna escritura para evitar corromper datos.");
  }

  const rolesUpdated = [];
  const rolesUnchanged = [];
  const rolesSkippedUnknown = [];
  const rolesSkippedInvalidJson = [];

  for (let i = 1; i < data.length; i++) {
    const rol = String(data[i][rolColIdx] || '').trim();
    const target = CREDITOS_FAVOR_PERMISSIONS_BY_ROLE[rol];
    if (!target) {
      if (rol) rolesSkippedUnknown.push(rol);
      continue;
    }

    let current;
    try {
      current = JSON.parse(data[i][jsonColIdx] || '[]');
      if (!Array.isArray(current)) throw new Error('permisos_json no es un arreglo');
    } catch (e) {
      rolesSkippedInvalidJson.push(rol);
      continue;
    }

    const missing = target.filter(p => current.indexOf(p) === -1);
    if (missing.length === 0) {
      rolesUnchanged.push(rol);
      continue;
    }

    const merged = current.concat(missing);
    sheet.getRange(i + 1, jsonColIdx + 1).setValue(JSON.stringify(merged));
    rolesUpdated.push({ rol: rol, permisosAgregados: missing });
  }

  Logger.log(`[FASE 8] Migración creditos_favor.* -- actualizados: ${JSON.stringify(rolesUpdated)}; sin cambios: ${JSON.stringify(rolesUnchanged)}; roles no reconocidos (intactos): ${JSON.stringify(rolesSkippedUnknown)}; permisos_json inválido (intacto): ${JSON.stringify(rolesSkippedInvalidJson)}`);

  return {
    success: true,
    message: `Migración completada. Roles actualizados: ${rolesUpdated.length}. Sin cambios: ${rolesUnchanged.length}.`,
    rolesUpdated: rolesUpdated,
    rolesUnchanged: rolesUnchanged,
    rolesSkippedUnknown: rolesSkippedUnknown,
    rolesSkippedInvalidJson: rolesSkippedInvalidJson
  };
}
