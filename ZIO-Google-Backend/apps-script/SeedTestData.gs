/**
 * ZIO CLOTHES — SeedTestData_v2.gs
 * Datos E2E alineados con SCHEMAS de SeedSetup.gs.
 *
 * Ejecutar: seedAllTestData()
 * Verificar: verifyTestData()
 *
 * NO modifica Configuracion, Usuarios, Roles_Permisos ni Secuencias.
 * Limpia primero solamente registros cuyo ID comienza con TEST-.
 */

const TEST_DATA_PREFIX = 'TEST-';

function seedAllTestData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    setupDatabase();
    seedInitialData();
    cleanTestRowsInternal_();

    const now = getNowFormatted();
    const yesterday = testDate_(new Date(Date.now() - 86400000));
    const twoDaysAgo = testDate_(new Date(Date.now() - 2 * 86400000));
    const due = testDate_(new Date(Date.now() + 14 * 86400000));

    insertObjects_('Categorias', [
      {id:'TEST-CAT-001',nombre:'Ropa Test',descripcion:'Categoría para pruebas E2E',estado:'ACTIVO'},
      {id:'TEST-CAT-002',nombre:'Calzado Test',descripcion:'Categoría para pruebas E2E',estado:'ACTIVO'}
    ]);

    insertObjects_('Tallas', [
      {id:'TEST-SIZ-001',nombre:'S',orden:1},{id:'TEST-SIZ-002',nombre:'M',orden:2},
      {id:'TEST-SIZ-003',nombre:'L',orden:3},{id:'TEST-SIZ-004',nombre:'40',orden:4},
      {id:'TEST-SIZ-005',nombre:'42',orden:5}
    ]);

    insertObjects_('Colores', [
      {id:'TEST-COL-001',nombre:'Negro Test',hex:'#111111'},
      {id:'TEST-COL-002',nombre:'Blanco Test',hex:'#FFFFFF'},
      {id:'TEST-COL-003',nombre:'Azul Test',hex:'#0000AA'},
      {id:'TEST-COL-004',nombre:'Rojo Test',hex:'#AA0000'}
    ]);

    insertObjects_('Proveedores', [
      {id:'TEST-PRV-001',nombre:'Proveedor Test A',contacto:'Laura Test',telefono:'809-555-1001',correo:'proveedor.a.test@example.com',rnc:'101-TEST-001',direccion:'Direccion Test A',estado:'ACTIVO'},
      {id:'TEST-PRV-002',nombre:'Proveedor Test B',contacto:'Pedro Test',telefono:'809-555-1002',correo:'proveedor.b.test@example.com',rnc:'101-TEST-002',direccion:'Direccion Test B',estado:'ACTIVO'}
    ]);

    insertObjects_('Productos', [
      {id:'TEST-PRD-001',sku:'TEST-SKU-001',codigo_barras:'TEST-BAR-001',nombre:'Camisa Básica Test',descripcion:'Producto para pruebas POS',categoria_id:'TEST-CAT-001',categoria_nombre:'Ropa Test',marca:'ZIO TEST',proveedor_id:'TEST-PRV-001',costo:80,precio:120,precio_especial:110,impuesto:18,descuento_maximo:10,stock_minimo:5,estado:'ACTIVO',imagen_url:'',creado_en:now},
      {id:'TEST-PRD-002',sku:'TEST-SKU-002',codigo_barras:'TEST-BAR-002',nombre:'Jeans Clásico Test',descripcion:'Producto para crédito y ventas',categoria_id:'TEST-CAT-001',categoria_nombre:'Ropa Test',marca:'ZIO TEST',proveedor_id:'TEST-PRV-001',costo:150,precio:250,precio_especial:225,impuesto:18,descuento_maximo:15,stock_minimo:5,estado:'ACTIVO',imagen_url:'',creado_en:now},
      {id:'TEST-PRD-003',sku:'TEST-SKU-003',codigo_barras:'TEST-BAR-003',nombre:'Vestido Casual Test',descripcion:'Producto con stock medio',categoria_id:'TEST-CAT-001',categoria_nombre:'Ropa Test',marca:'ZIO TEST',proveedor_id:'TEST-PRV-002',costo:200,precio:320,precio_especial:300,impuesto:18,descuento_maximo:10,stock_minimo:5,estado:'ACTIVO',imagen_url:'',creado_en:now},
      {id:'TEST-PRD-004',sku:'TEST-SKU-004',codigo_barras:'TEST-BAR-004',nombre:'Zapatos Urbanos Test',descripcion:'Producto para prueba de agotado',categoria_id:'TEST-CAT-002',categoria_nombre:'Calzado Test',marca:'ZIO TEST',proveedor_id:'TEST-PRV-002',costo:500,precio:800,precio_especial:750,impuesto:18,descuento_maximo:10,stock_minimo:5,estado:'ACTIVO',imagen_url:'',creado_en:now}
    ]);

    insertObjects_('Variantes', [
      {id:'TEST-VAR-001',producto_id:'TEST-PRD-001',sku:'TEST-VAR-S-NEGRO',codigo_barras:'TEST-VBAR-001',color:'Negro Test',talla:'S',costo:80,precio:120,stock:20,estado:'ACTIVO'},
      {id:'TEST-VAR-002',producto_id:'TEST-PRD-001',sku:'TEST-VAR-M-NEGRO',codigo_barras:'TEST-VBAR-002',color:'Negro Test',talla:'M',costo:80,precio:120,stock:15,estado:'ACTIVO'},
      {id:'TEST-VAR-003',producto_id:'TEST-PRD-001',sku:'TEST-VAR-L-BLANCO',codigo_barras:'TEST-VBAR-003',color:'Blanco Test',talla:'L',costo:85,precio:130,stock:5,estado:'ACTIVO'},
      {id:'TEST-VAR-004',producto_id:'TEST-PRD-002',sku:'TEST-VAR-30-AZUL',codigo_barras:'TEST-VBAR-004',color:'Azul Test',talla:'30',costo:150,precio:250,stock:20,estado:'ACTIVO'},
      {id:'TEST-VAR-005',producto_id:'TEST-PRD-002',sku:'TEST-VAR-32-AZUL',codigo_barras:'TEST-VBAR-005',color:'Azul Test',talla:'32',costo:150,precio:250,stock:3,estado:'ACTIVO'},
      {id:'TEST-VAR-006',producto_id:'TEST-PRD-003',sku:'TEST-VAR-M-ROJO',codigo_barras:'TEST-VBAR-006',color:'Rojo Test',talla:'M',costo:200,precio:320,stock:8,estado:'ACTIVO'},
      {id:'TEST-VAR-007',producto_id:'TEST-PRD-004',sku:'TEST-VAR-40-NEGRO',codigo_barras:'TEST-VBAR-007',color:'Negro Test',talla:'40',costo:500,precio:800,stock:10,estado:'ACTIVO'},
      {id:'TEST-VAR-008',producto_id:'TEST-PRD-004',sku:'TEST-VAR-42-NEGRO',codigo_barras:'TEST-VBAR-008',color:'Negro Test',talla:'42',costo:500,precio:800,stock:0,estado:'ACTIVO'}
    ]);

    insertObjects_('Clientes', [
      {id:'TEST-CLI-001',nombre:'Juan',apellido:'Prueba',documento:'TEST-DOC-001',telefono:'809-555-2001',correo:'juan.test@example.com',direccion:'Calle Test 1',ciudad:'Santo Domingo',limite_credito:10000,dias_credito_por_defecto:30,notas:'Cliente de prueba con crédito',estado:'ACTIVO',creado_en:now},
      {id:'TEST-CLI-002',nombre:'Maria',apellido:'Prueba',documento:'TEST-DOC-002',telefono:'809-555-2002',correo:'maria.test@example.com',direccion:'Calle Test 2',ciudad:'Santo Domingo',limite_credito:5000,dias_credito_por_defecto:15,notas:'Cliente de prueba',estado:'ACTIVO',creado_en:now},
      {id:'TEST-CLI-003',nombre:'Carlos',apellido:'Prueba',documento:'TEST-DOC-003',telefono:'809-555-2003',correo:'carlos.test@example.com',direccion:'Calle Test 3',ciudad:'Santiago',limite_credito:0,dias_credito_por_defecto:15,notas:'Cliente contado',estado:'ACTIVO',creado_en:now},
      {id:'TEST-CLI-004',nombre:'Cliente',apellido:'Inactivo',documento:'TEST-DOC-004',telefono:'809-555-2004',correo:'inactivo.test@example.com',direccion:'Calle Test 4',ciudad:'Santo Domingo',limite_credito:0,dias_credito_por_defecto:15,notas:'Prueba de estado inactivo',estado:'INACTIVO',creado_en:now}
    ]);

    insertObjects_('Cajas', [
      {id:'TEST-CAJA-HIST-001',codigo_caja:'TEST-CAJA-HIST',caja_nombre:'Caja Histórica Test',cajero_id:'USR-001',cajero_nombre:'Carlos Mendoza',usuario_apertura_nombre:'Carlos Mendoza',monto_inicial:3000,fecha_apertura:twoDaysAgo,observacion_apertura:'Caja histórica de pruebas',estado:'CERRADA',ventas_efectivo:1168.2,abonos_efectivo:100,ingresos_manuales:0,retiros_manuales:0,gastos:300,devoluciones_efectivo:0,efectivo_esperado:3968.2,efectivo_real_contado:3968.2,diferencia:0,fecha_cierre:yesterday,observacion_cierre:'Cierre histórico E2E'},
      {id:'TEST-CAJA-OPEN-001',codigo_caja:'TEST-CAJA-E2E',caja_nombre:'Caja E2E Activa',cajero_id:'USR-001',cajero_nombre:'Carlos Mendoza',usuario_apertura_nombre:'Carlos Mendoza',monto_inicial:5000,fecha_apertura:now,observacion_apertura:'Caja activa para pruebas E2E',estado:'ABIERTA',ventas_efectivo:0,abonos_efectivo:0,ingresos_manuales:0,retiros_manuales:0,gastos:0,devoluciones_efectivo:0,efectivo_esperado:5000,efectivo_real_contado:0,diferencia:0,fecha_cierre:'',observacion_cierre:''}
    ]);

    const saleItems1 = [
      {producto_id:'TEST-PRD-001',variante_id:'TEST-VAR-001',nombre_producto:'Camisa Básica Test',sku:'TEST-VAR-S-NEGRO',talla:'S',color:'Negro Test',categoria:'Ropa Test',cantidad:2,costo_unitario:80,precio_unitario:120,descuento_porcentaje:0,descuento_monto:0,subtotal:240,impuesto_monto:43.2,total:283.2},
      {producto_id:'TEST-PRD-002',variante_id:'TEST-VAR-004',nombre_producto:'Jeans Clásico Test',sku:'TEST-VAR-30-AZUL',talla:'30',color:'Azul Test',categoria:'Ropa Test',cantidad:3,costo_unitario:150,precio_unitario:250,descuento_porcentaje:0,descuento_monto:0,subtotal:750,impuesto_monto:135,total:885}
    ];

    insertObjects_('Ventas', [
      {id:'TEST-VEN-001',numero_venta:'TEST-VENTA-001',cliente_id:'TEST-CLI-003',cliente_nombre:'Carlos Prueba',cliente_documento:'TEST-DOC-003',vendedor_id:'USR-001',vendedor_nombre:'Carlos Mendoza',caja_sesion_id:'TEST-CAJA-HIST-001',subtotal:990,descuento_total:0,impuesto_total:178.2,total:1168.2,costo_total:610,metodo_pago:'EFECTIVO',pagos_json:JSON.stringify([{metodo:'EFECTIVO',monto:1168.2}]),efectivo_recibido:1200,cambio_entregado:31.8,es_credito:false,monto_financiado:0,cuenta_cobrar_id:'',estado:'COMPLETADA',motivo_anulacion:'',anulada_por:'',fecha_anulacion:'',fecha:twoDaysAgo},
      {id:'TEST-VEN-002',numero_venta:'TEST-VENTA-002',cliente_id:'TEST-CLI-001',cliente_nombre:'Juan Prueba',cliente_documento:'TEST-DOC-001',vendedor_id:'USR-001',vendedor_nombre:'Carlos Mendoza',caja_sesion_id:'',subtotal:250,descuento_total:0,impuesto_total:45,total:295,costo_total:150,metodo_pago:'CREDITO',pagos_json:JSON.stringify([]),efectivo_recibido:0,cambio_entregado:0,es_credito:true,monto_financiado:295,cuenta_cobrar_id:'TEST-CRED-001',estado:'COMPLETADA',motivo_anulacion:'',anulada_por:'',fecha_anulacion:'',fecha:yesterday}
    ]);

    insertObjects_('Venta_Items', saleItems1.map(function(x,i){ x.id='TEST-VI-00'+(i+1); x.venta_id='TEST-VEN-001'; return x; }).concat([
      {id:'TEST-VI-003',venta_id:'TEST-VEN-002',producto_id:'TEST-PRD-002',variante_id:'TEST-VAR-005',nombre_producto:'Jeans Clásico Test',sku:'TEST-VAR-32-AZUL',talla:'32',color:'Azul Test',categoria:'Ropa Test',cantidad:1,costo_unitario:150,precio_unitario:250,descuento_porcentaje:0,descuento_monto:0,subtotal:250,impuesto_monto:45,total:295}
    ]));

    insertObjects_('Creditos', [
      {id:'TEST-CRED-001',numero_credito:'TEST-CREDITO-001',cliente_id:'TEST-CLI-001',cliente_nombre:'Juan Prueba',cliente_telefono:'809-555-2001',cliente_documento:'TEST-DOC-001',venta_id:'TEST-VEN-002',numero_venta:'TEST-VENTA-002',monto_original:295,monto_pagado:100,saldo_pendiente:195,fecha_creacion:yesterday,fecha_vencimiento:due,dias_plazo:15,estado:'PENDIENTE',observaciones:'Crédito histórico E2E',creado_por:'USR-001'}
    ]);

    insertObjects_('Abonos', [
      {id:'TEST-ABO-001',numero_recibo:'TEST-RECIBO-001',cuenta_cobrar_id:'TEST-CRED-001',cliente_id:'TEST-CLI-001',cliente_nombre:'Juan Prueba',venta_id:'TEST-VEN-002',numero_venta:'TEST-VENTA-002',saldo_anterior:295,monto_abonado:100,saldo_restante:195,metodo_pago:'EFECTIVO',referencia:'TEST-ABONO-001',caja_sesion_id:'TEST-CAJA-HIST-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',observaciones:'Abono histórico E2E',fecha:yesterday,estado:'ACTIVO',motivo_anulacion:'',anulado_por:'',fecha_anulacion:''}
    ]);

    insertObjects_('Caja_Movimientos', [
      {id:'TEST-MOV-001',caja_sesion_id:'TEST-CAJA-HIST-001',tipo:'APERTURA',monto:3000,motivo:'Apertura histórica',categoria_gasto:'',referencia:'TEST-CAJA-HIST-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:twoDaysAgo,estado:'ACTIVO'},
      {id:'TEST-MOV-002',caja_sesion_id:'TEST-CAJA-HIST-001',tipo:'INGRESO',monto:100,motivo:'Abono crédito',categoria_gasto:'',referencia:'TEST-ABO-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday,estado:'ACTIVO'},
      {id:'TEST-MOV-003',caja_sesion_id:'TEST-CAJA-HIST-001',tipo:'RETIRO',monto:300,motivo:'Gasto histórico',categoria_gasto:'OPERATIVO',referencia:'TEST-GAS-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday,estado:'ACTIVO'}
    ]);

    insertObjects_('Gastos', [
      {id:'TEST-GAS-001',numero_gasto:'TEST-GASTO-001',categoria:'OPERATIVO',descripcion:'Gasto histórico de prueba',proveedor:'Proveedor Test A',monto:300,metodo_pago:'EFECTIVO',comprobante:'TEST-COMP-001',caja_sesion_id:'TEST-CAJA-HIST-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday,pagado_con_caja_activa:true},
      {id:'TEST-GAS-002',numero_gasto:'TEST-GASTO-002',categoria:'ADMINISTRATIVO',descripcion:'Gasto no efectivo de prueba',proveedor:'Proveedor Test B',monto:500,metodo_pago:'TARJETA',comprobante:'TEST-COMP-002',caja_sesion_id:'',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday,pagado_con_caja_activa:false}
    ]);

    const purchaseItems = [
      {producto_id:'TEST-PRD-001',variante_id:'TEST-VAR-001',nombre_producto:'Camisa Básica Test',sku:'TEST-VAR-S-NEGRO',cantidad:5,costo_unitario:80,subtotal:400},
      {producto_id:'TEST-PRD-002',variante_id:'TEST-VAR-004',nombre_producto:'Jeans Clásico Test',sku:'TEST-VAR-30-AZUL',cantidad:2,costo_unitario:150,subtotal:300},
      {producto_id:'TEST-PRD-003',variante_id:'TEST-VAR-006',nombre_producto:'Vestido Casual Test',sku:'TEST-VAR-M-ROJO',cantidad:2,costo_unitario:200,subtotal:400}
    ];

    insertObjects_('Compras', [
      {id:'TEST-COM-001',numero_compra:'TEST-COMPRA-001',proveedor_id:'TEST-PRV-001',proveedor:'Proveedor Test A',numero_factura_proveedor:'TEST-FACT-001',items_json:JSON.stringify(purchaseItems),total:1100,forma_pago:'EFECTIVO',estado:'COMPLETADA',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:twoDaysAgo,notas:'Compra histórica E2E'}
    ]);

    const returnItems = [
      {producto_id:'TEST-PRD-001',variante_id:'TEST-VAR-001',nombre_producto:'Camisa Básica Test',sku:'TEST-VAR-S-NEGRO',talla:'S',color:'Negro Test',cantidad:1,precio_unitario:120,total:120}
    ];

    insertObjects_('Devoluciones', [
      {id:'TEST-DEV-001',numero_devolucion:'TEST-DEVOL-001',venta_id:'TEST-VEN-001',numero_venta:'TEST-VENTA-001',cliente_id:'TEST-CLI-003',cliente_nombre:'Carlos Prueba',items_json:JSON.stringify(returnItems),monto_devuelto:120,tipo_reembolso:'EFECTIVO',motivo:'Devolución histórica E2E',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday}
    ]);

    insertObjects_('Inventario_Kardex', [
      {id:'TEST-KAR-001',producto_id:'TEST-PRD-001',producto_nombre:'Camisa Básica Test',variante_id:'TEST-VAR-001',sku:'TEST-VAR-S-NEGRO',talla:'S',color:'Negro Test',cantidad:5,tipo:'ENTRADA',stock_anterior:20,stock_nuevo:25,motivo:'Compra de prueba',referencia:'TEST-COM-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:twoDaysAgo},
      {id:'TEST-KAR-002',producto_id:'TEST-PRD-001',producto_nombre:'Camisa Básica Test',variante_id:'TEST-VAR-001',sku:'TEST-VAR-S-NEGRO',talla:'S',color:'Negro Test',cantidad:2,tipo:'SALIDA',stock_anterior:25,stock_nuevo:23,motivo:'Venta de prueba',referencia:'TEST-VEN-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:twoDaysAgo},
      {id:'TEST-KAR-003',producto_id:'TEST-PRD-001',producto_nombre:'Camisa Básica Test',variante_id:'TEST-VAR-001',sku:'TEST-VAR-S-NEGRO',talla:'S',color:'Negro Test',cantidad:1,tipo:'ENTRADA',stock_anterior:23,stock_nuevo:24,motivo:'Devolución de prueba',referencia:'TEST-DEV-001',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday},
      {id:'TEST-KAR-004',producto_id:'TEST-PRD-002',producto_nombre:'Jeans Clásico Test',variante_id:'TEST-VAR-005',sku:'TEST-VAR-32-AZUL',talla:'32',color:'Azul Test',cantidad:1,tipo:'SALIDA',stock_anterior:4,stock_nuevo:3,motivo:'Venta de prueba',referencia:'TEST-VEN-002',usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',fecha:yesterday}
    ]);

    insertObjects_('Auditoria', [
      {id:'TEST-AUD-001',fecha:now,usuario_id:'USR-001',usuario_nombre:'Carlos Mendoza',usuario_rol:'ADMIN',accion:'SEED_TEST',modulo:'TEST',entidad:'SeedTestData',entidad_id:'TEST-SEED',descripcion:'Carga de datos E2E',detalle:'Datos de prueba generados',resultado:'OK'}
    ]);

    SpreadsheetApp.flush();
    Logger.log('SEED E2E V2 COMPLETADO. Configuracion no fue modificada.');
  } finally {
    lock.releaseLock();
  }
}

function verifyTestData() {
  const ss = getSpreadsheet();
  let total = 0;
  Object.keys(SCHEMAS).forEach(function(name) {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    let count = 0;
    ids.forEach(function(r){ if (String(r[0]).indexOf(TEST_DATA_PREFIX) === 0) count++; });
    if (count) { Logger.log(name + ': TEST rows=' + count); total += count; }
  });
  const cfg = ss.getSheetByName('Configuracion');
  Logger.log('Configuracion rows=' + (cfg ? cfg.getLastRow() : 'NO ENCONTRADA'));
  Logger.log('TOTAL TEST rows=' + total);
}

function insertObjects_(sheetName, objects) {
  const sh = getSpreadsheet().getSheetByName(sheetName);
  if (!sh) throw new Error('Hoja requerida no existe: ' + sheetName);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const rows = objects.map(function(obj) {
    return headers.map(function(h) {
      return Object.prototype.hasOwnProperty.call(obj,h) ? obj[h] : '';
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,headers.length).setValues(rows);
}

function cleanTestRowsInternal_() {
  const ss = getSpreadsheet();
  Object.keys(SCHEMAS).forEach(function(name) {
    if (name === 'Configuracion' || name === 'Usuarios' || name === 'Roles_Permisos' || name === 'Secuencias') return;
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    const rows = [];
    ids.forEach(function(r,i){ if (String(r[0]).indexOf(TEST_DATA_PREFIX) === 0) rows.push(i+2); });
    for (let i=rows.length-1;i>=0;i--) sh.deleteRow(rows[i]);
  });
}

function testDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
