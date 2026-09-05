# ESQUEMA DE BASE DE DATOS — GOOGLE SHEETS (ZIO CLOTHES)

El libro de cálculo de Google Sheets actúa como la **única base de datos relacional normalizada** del sistema, estructurado en **22 hojas**.

---

## Matriz General de las 22 Hojas

| # | Hoja | Clave Primaria (PK) | Entidad TypeScript | Descripción |
| :---: | :--- | :---: | :--- | :--- |
| **1** | `Configuracion` | `clave` | `SystemSettings` | Parámetros del negocio y políticas de venta |
| **2** | `Usuarios` | `id` | `User` | Cuentas de empleados, roles y hashes SHA-256 |
| **3** | `Roles_Permisos` | `rol` | `RolePermissionConfig` | Matriz de permisos habilitados por rol |
| **4** | `Categorias` | `id` | `Category` | Clasificación de prendas |
| **5** | `Tallas` | `id` | `Size` | Catálogo de tallas normalizadas |
| **6** | `Colores` | `id` | `Color` | Catálogo de colores y códigos hexadecimales |
| **7** | `Proveedores` | `id` | `Supplier` | Directorio de talleres y distribuidores |
| **8** | `Productos` | `id` | `Product` | Registro padre de prendas |
| **9** | `Variantes` | `id` | `ProductVariant` | Unidad física con SKU, código de barras y stock |
| **10** | `Clientes` | `id` | `Customer` | Cartera de clientes y límite de crédito comercial |
| **11** | `Ventas` | `id` | `Sale` | Facturas y comprobantes emitidos |
| **12** | `Venta_Items` | `id` | `SaleItem` | Renglón de prendas vendidas por factura |
| **13** | `Creditos` | `id` | `AccountReceivable` | Cuentas por cobrar generadas a clientes |
| **14** | `Abonos` | `id` | `PaymentInstallment` | Recibos de pagos parciales a cuentas por cobrar |
| **15** | `Cajas` | `id` | `CashSession` | Turnos de caja, fondo inicial y arqueo de cierre |
| **16** | `Caja_Movimientos` | `id` | `CashMovement` | Ingresos, retiros manuales y cobros en efectivo |
| **17** | `Gastos` | `id` | `Expense` | Egresos operativos clasificados por categoría |
| **18** | `Compras` | `id` | `Purchase` | Entradas de mercancía de proveedores |
| **19** | `Devoluciones` | `id` | `ReturnRecord` | Reintegros de prendas por clientes |
| **20** | `Inventario_Kardex` | `id` | `InventoryMovement` | Trazabilidad inmutable de cambios de stock |
| **21** | `Auditoria` | `id` | `AuditLog` | Trazabilidad inmutable de eventos del sistema |
| **22** | `Secuencias` | `prefijo` | `Sequences` | Contadores atómicos de correlativos |

---

## Detalle de Campos por Hoja

### 1. `Configuracion`
* `clave` (PK, Text): Identificador de la opción (`nombreNegocio`, `rnc`, `impuestoPorcentaje`, etc.).
* `valor` (Text): Valor de la opción.
* `descripcion` (Text): Descripción de uso.
* `actualizado_en` (DateTime): Fecha de última actualización.

### 2. `Usuarios`
* `id` (PK, Text): `USR-000001`
* `usuario` (Text, Unique): Nombre de usuario en minúsculas.
* `nombre` (Text): Nombres.
* `apellido` (Text): Apellidos.
* `correo` (Text, Unique): Correo electrónico.
* `telefono` (Text): Teléfono de contacto.
* `rol` (FK -> Roles_Permisos.rol): `ADMIN`, `GERENTE`, `SUPERVISOR`, `CAJERO`, `VENDEDOR`.
* `estado` (Text): `ACTIVO`, `INACTIVO`, `BLOQUEADO`.
* `password_hash` (Text): SHA-256 de (password + salt).
* `password_salt` (Text): Sal criptográfica aleatoria de 16 caracteres.
* `avatar` (Text): URL de avatar.
* `creado_en` (DateTime): Fecha de creación.
* `ultimo_acceso` (DateTime): Última sesión iniciada.

### 3. `Roles_Permisos`
* `rol` (PK, Text): `ADMIN`, `GERENTE`, `SUPERVISOR`, `CAJERO`, `VENDEDOR`.
* `nombre` (Text): Nombre legible del rol.
* `descripcion` (Text): Alcance.
* `permisos_json` (JSON Text): Array con los códigos de permiso habilitados.

### 4. `Categorias`
* `id` (PK, Text): `CAT-000001`
* `nombre` (Text, Unique): Nombre de la categoría.
* `descripcion` (Text): Detalle opcional.
* `estado` (Text): `ACTIVO` o `INACTIVO`.

### 5. `Tallas`
* `id` (PK, Text): `SIZ-000001`
* `nombre` (Text, Unique): XS, S, M, L, XL, 32, 34, etc.
* `orden` (Number): Orden numérico de visualización.

### 6. `Colores`
* `id` (PK, Text): `COL-000001`
* `nombre` (Text, Unique): Nombre del color.
* `hex` (Text): Código hexadecimal (ej. `#D2B48C`).

### 7. `Proveedores`
* `id` (PK, Text): `PRV-000001`
* `nombre` (Text): Razón social.
* `contacto` (Text): Persona de contacto.
* `telefono` (Text): Teléfono.
* `correo` (Text): Correo de pedidos.
* `rnc` (Text): Documento fiscal.
* `direccion` (Text): Ubicación física.
* `estado` (Text): `ACTIVO` o `INACTIVO`.

### 8. `Productos`
* `id` (PK, Text): `PRD-000001`
* `sku` (Text, Unique): SKU base del modelo.
* `codigo_barras` (Text): Código de barras general.
* `nombre` (Text): Nombre comercial.
* `descripcion` (Text): Descripción y composición.
* `categoria_id` (FK -> Categorias.id)
* `categoria_nombre` (Text)
* `marca` (Text): Marca (default ZIO CLOTHES).
* `proveedor_id` (FK -> Proveedores.id)
* `costo` (Number): Costo promedio en RD$.
* `precio` (Number): Precio estándar en RD$.
* `precio_especial` (Number, Nullable): Precio mayorista o VIP.
* `impuesto` (Number): ITBIS aplicable (ej. 18).
* `descuento_maximo` (Number): Porcentaje tope de descuento.
* `stock_minimo` (Number): Umbral para alerta de agotamiento.
* `estado` (Text): `ACTIVO` o `INACTIVO`.
* `imagen_url` (Text): Imagen del producto.
* `creado_en` (DateTime)

### 9. `Variantes`
* `id` (PK, Text): `VAR-000001`
* `producto_id` (FK -> Productos.id)
* `sku` (Text, Unique): SKU de la talla y color específico.
* `codigo_barras` (Text, Unique): Código de barras para lector POS.
* `color` (Text)
* `talla` (Text)
* `costo` (Number)
* `precio` (Number)
* `stock` (Number): **Existencia real disponible en tienda**.
* `estado` (Text): `ACTIVO` o `INACTIVO`.

### 10. `Clientes`
* `id` (PK, Text): `CLI-000001`
* `nombre` (Text)
* `apellido` (Text)
* `documento` (Text): Cédula o RNC.
* `telefono` (Text)
* `correo` (Text)
* `direccion` (Text)
* `ciudad` (Text)
* `limite_credito` (Number): Límite de crédito otorgado en RD$.
* `dias_credito_por_defecto` (Number): Plazo de crédito en días.
* `notas` (Text)
* `estado` (Text): `ACTIVO`, `INACTIVO`, `BLOQUEADO`.
* `creado_en` (DateTime)

### 11. `Ventas`
* `id` (PK, Text): `VEN-000001`
* `numero_venta` (Text, Unique): Número consecutivo de factura.
* `cliente_id` (FK -> Clientes.id, Nullable)
* `cliente_nombre` (Text)
* `cliente_documento` (Text)
* `vendedor_id` (FK -> Usuarios.id)
* `vendedor_nombre` (Text)
* `caja_sesion_id` (FK -> Cajas.id, Nullable)
* `subtotal` (Number)
* `descuento_total` (Number)
* `impuesto_total` (Number)
* `total` (Number)
* `costo_total` (Number)
* `metodo_pago` (Text): `EFECTIVO`, `TARJETA`, `TRANSFERENCIA`, `CREDITO`, `MIXTO`.
* `pagos_json` (JSON Text): Detalle de medios de pago.
* `efectivo_recibido` (Number, Nullable)
* `cambio_entregado` (Number, Nullable)
* `es_credito` (Boolean): `TRUE` o `FALSE`.
* `monto_financiado` (Number, Nullable)
* `cuenta_cobrar_id` (FK -> Creditos.id, Nullable)
* `estado` (Text): `COMPLETADA`, `ANULADA`, `DEVUELTA_PARCIAL`, `DEVUELTA_TOTAL`.
* `motivo_anulacion` (Text)
* `anulada_por` (FK -> Usuarios.id)
* `fecha_anulacion` (DateTime)
* `fecha` (DateTime)

### 12. `Venta_Items`
* `id` (PK, Text): `ITM-000001`
* `venta_id` (FK -> Ventas.id)
* `producto_id` (FK -> Productos.id)
* `variante_id` (FK -> Variantes.id)
* `nombre_producto` (Text)
* `sku` (Text)
* `talla` (Text)
* `color` (Text)
* `categoria` (Text)
* `cantidad` (Number)
* `costo_unitario` (Number)
* `precio_unitario` (Number)
* `descuento_porcentaje` (Number)
* `descuento_monto` (Number)
* `subtotal` (Number)
* `impuesto_monto` (Number)
* `total` (Number)

### 13. `Creditos`
* `id` (PK, Text): `CRED-000001`
* `numero_credito` (Text, Unique)
* `cliente_id` (FK -> Clientes.id)
* `cliente_nombre` (Text)
* `cliente_telefono` (Text)
* `cliente_documento` (Text)
* `venta_id` (FK -> Ventas.id)
* `numero_venta` (Text)
* `monto_original` (Number)
* `monto_pagado` (Number)
* `saldo_pendiente` (Number)
* `fecha_creacion` (DateTime)
* `fecha_vencimiento` (DateTime)
* `dias_plazo` (Number)
* `estado` (Text): `PENDIENTE`, `PARCIAL`, `PAGADA`, `VENCIDA`, `ANULADA`.
* `observaciones` (Text)
* `creado_por` (FK -> Usuarios.id)

### 14. `Abonos`
* `id` (PK, Text): `ABO-000001`
* `numero_recibo` (Text, Unique)
* `cuenta_cobrar_id` (FK -> Creditos.id)
* `cliente_id` (FK -> Clientes.id)
* `cliente_nombre` (Text)
* `venta_id` (FK -> Ventas.id)
* `numero_venta` (Text)
* `saldo_anterior` (Number)
* `monto_abonado` (Number)
* `saldo_restante` (Number)
* `metodo_pago` (Text)
* `referencia` (Text)
* `caja_sesion_id` (FK -> Cajas.id)
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `observaciones` (Text)
* `fecha` (DateTime)
* `estado` (Text): `ACTIVO` o `ANULADO`.
* `motivo_anulacion` (Text)
* `anulado_por` (FK -> Usuarios.id)
* `fecha_anulacion` (DateTime)

### 15. `Cajas`
* `id` (PK, Text): `CAJA-000001`
* `codigo_caja` (Text, Unique)
* `caja_nombre` (Text)
* `cajero_id` (FK -> Usuarios.id)
* `cajero_nombre` (Text)
* `usuario_apertura_nombre` (Text)
* `monto_inicial` (Number)
* `fecha_apertura` (DateTime)
* `observacion_apertura` (Text)
* `estado` (Text): `ABIERTA` o `CERRADA`.
* `ventas_efectivo` (Number)
* `abonos_efectivo` (Number)
* `ingresos_manuales` (Number)
* `retiros_manuales` (Number)
* `gastos` (Number)
* `devoluciones_efectivo` (Number)
* `efectivo_esperado` (Number)
* `efectivo_real_contado` (Number, Nullable)
* `diferencia` (Number, Nullable)
* `fecha_cierre` (DateTime, Nullable)
* `observacion_cierre` (Text, Nullable)

### 16. `Caja_Movimientos`
* `id` (PK, Text): `CMOV-000001`
* `caja_sesion_id` (FK -> Cajas.id)
* `tipo` (Text): `INGRESO`, `RETIRO`, `GASTO`, `VENTA_EFECTIVO`, `ABONO_EFECTIVO`, `DEVOLUCION_EFECTIVO`.
* `monto` (Number)
* `motivo` (Text)
* `categoria_gasto` (Text)
* `referencia` (Text)
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `fecha` (DateTime)
* `estado` (Text): `ACTIVO` o `ANULADO`.

### 17. `Gastos`
* `id` (PK, Text): `GAS-000001`
* `numero_gasto` (Text, Unique)
* `categoria` (Text)
* `descripcion` (Text)
* `proveedor` (Text)
* `monto` (Number)
* `metodo_pago` (Text)
* `comprobante` (Text)
* `caja_sesion_id` (FK -> Cajas.id)
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `fecha` (DateTime)
* `pagado_con_caja_activa` (Boolean): `TRUE` o `FALSE`.

### 18. `Compras`
* `id` (PK, Text): `COM-000001`
* `numero_compra` (Text, Unique)
* `proveedor_id` (FK -> Proveedores.id)
* `proveedor` (Text)
* `numero_factura_proveedor` (Text)
* `items_json` (JSON Text)
* `total` (Number)
* `forma_pago` (Text)
* `estado` (Text): `RECIBIDA` o `ANULADA`.
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `fecha` (DateTime)
* `notas` (Text)

### 19. `Devoluciones`
* `id` (PK, Text): `DEV-000001`
* `numero_devolucion` (Text, Unique)
* `venta_id` (FK -> Ventas.id)
* `numero_venta` (Text)
* `cliente_id` (FK -> Clientes.id)
* `cliente_nombre` (Text)
* `items_json` (JSON Text)
* `monto_devuelto` (Number)
* `tipo_reembolso` (Text): `EFECTIVO`, `NOTA_CREDITO`, `OTRO`.
* `motivo` (Text)
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `fecha` (DateTime)

### 20. `Inventario_Kardex`
* `id` (PK, Text): `MOV-000001`
* `producto_id` (FK -> Productos.id)
* `producto_nombre` (Text)
* `variante_id` (FK -> Variantes.id)
* `sku` (Text)
* `talla` (Text)
* `color` (Text)
* `cantidad` (Number): Negativo para salidas, positivo para entradas.
* `tipo` (Text): `VENTA`, `COMPRA`, `DEVOLUCION`, `ENTRADA`, `SALIDA`, `AJUSTE`. (FASE 3.7C: `inventory.adjust` real graba exactamente el tipo elegido en el frontend -- `ENTRADA`/`SALIDA`/`AJUSTE` -- en vez de siempre `AJUSTE`; `MERMA` quedaba documentado pero nunca se usó en código, se deja fuera para no describir un valor inexistente.)
* `stock_anterior` (Number)
* `stock_nuevo` (Number)
* `motivo` (Text)
* `referencia` (Text)
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `fecha` (DateTime)

### 21. `Auditoria`
* `id` (PK, Text): `AUD-...`
* `fecha` (DateTime)
* `usuario_id` (FK -> Usuarios.id)
* `usuario_nombre` (Text)
* `usuario_rol` (Text)
* `accion` (Text)
* `modulo` (Text)
* `entidad` (Text)
* `entidad_id` (Text)
* `descripcion` (Text)
* `detalle` (Text)
* `resultado` (Text): `EXITO` o `FALLO`.

### 22. `Secuencias`
* `prefijo` (PK, Text): Prefijo del correlativo (`VEN`, `PRD`, `CLI`, etc.).
* `siguiente_numero` (Number): Siguiente entero consecutivo.
* `actualizado_en` (DateTime)
