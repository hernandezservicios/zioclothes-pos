# ESPECIFICACIÓN DE LA API — ZIO CLOTHES GOOGLE APPS SCRIPT BACKEND

## Protocolo General

* **Método HTTP:** `POST` (o `GET` para ping/diagnóstico básico)
* **URL:** Endpoint público del Web App desplegado en Apps Script (`https://script.google.com/macros/s/.../exec`)
* **Content-Type Recomendado:** `text/plain;charset=utf-8` (para evitar preflight CORS de navegadores web)
* **Estructura Estándar de Petición:**
```json
{
  "action": "MODULO.ACCION",
  "sessionToken": "ZIO-SESS-...",
  "data": { ... }
}
```
* **Estructura Estándar de Respuesta Exitosa:**
```json
{
  "success": true,
  "...": "Campos de respuesta según la acción"
}
```
* **Estructura Estándar de Error:**
```json
{
  "success": false,
  "error": "DESCRIPCION_DEL_ERROR",
  "timestamp": "2026-09-04 15:30:00"
}
```

---

## Índice de Endpoints

### 1. Sistema y Diagnóstico
* `system.ping`: Comprueba el estado en línea y la vinculación con Google Sheets.
* `system.setupDatabase`: Aprovisiona las 22 hojas con encabezados y estilos.
* `system.seedInitialData`: Crea roles, tallas, colores, categorías y usuario admin.
* `system.getBootstrapData`: Descarga en un único viaje de red la configuración, catálogo, clientes y turno activo.
* `system.getSettings`: Lee la tabla clave/valor de configuración del negocio.
* `system.updateSettings`: Actualiza parámetros operativos del negocio.

### 2. Autenticación y Usuarios
* `auth.login`: Inicia sesión validando credenciales contra SHA-256 + salt.
* `auth.validateSession`: Rehidrata sesión y refresca permisos ante recarga del navegador.
* `auth.logout`: Destruye el token de sesión.
* `auth.listUsers`: Lista de empleados registrados sin exponer hashes.
* `auth.saveUser`: Crea o actualiza un empleado con nuevo salt y hash de contraseña.

### 3. Catálogo y Productos
* `products.list`: Lista todas las prendas con sus variantes anidadas y existencias.
* `products.save`: Crea o actualiza una prenda y sus variantes de manera atómica.
* `products.delete`: Desactiva una prenda y sus variantes (soft delete).
* `products.listAuxiliaries`: Obtiene categorías, tallas, colores y proveedores.

### 4. Clientes
* `customers.list`: Cartera de clientes con saldo adeudado y crédito disponible en tiempo real.
* `customers.save`: Registra o actualiza información de un cliente.

### 5. Ventas (POS)
* `sales.list`: Historial de ventas con detalle de ítems, pagos e impuestos.
* `sales.create`: Transacción atómica de facturación (valida stock, descuenta existencias, genera Kardex, genera crédito si aplica y actualiza caja).
* `sales.void`: Anula factura, restaura stock en inventario y cancela cuenta por cobrar si no estaba pagada.

### 6. Inventario y Kardex
* `inventory.adjust`: Ajuste manual de existencias físicas con registro inmutable en Kardex. Contrato (FASE 3.7C): `{ varianteId, cantidadAjuste, tipo: 'ENTRADA'|'SALIDA'|'AJUSTE', motivo, referencia? }` -- delta-based; el backend calcula `nuevoStock = stockActual + cantidadAjuste` bajo LockService, nunca acepta un stock absoluto del cliente. Rechaza con `STOCK_INSUFICIENTE` si el resultado sería negativo, y con `VALIDATION_ERROR` si la variante está inactiva.
* `inventory.kardex`: Consulta de trazabilidad histórica de movimientos de stock.

### 7. Créditos y Abonos
* `credits.list`: Cuentas por cobrar con recibos de abonos aplicados.
* `credits.registerAbono`: Registro de pago a crédito con emisión de recibo oficial, recálculo de saldo pendiente y actualización de caja.
* `credits.voidAbono`: Anulación de recibo de abono con restauración de deuda.

### 8. Caja y Arqueos
* `cash.getActiveSession`: Turno de caja abierto, balance teórico esperado y movimientos.
* `cash.listSessions`: Historial de turnos de caja cerrados.
* `cash.open`: Apertura de turno con fondo inicial.
* `cash.close`: Cierre y arqueo ciego con cálculo automático de faltante o sobrante.
* `cash.addMovement`: Registro de ingresos o retiros manuales de efectivo.

### 9. Gastos
* `expenses.list`: Egresos operativos clasificados por categoría.
* `expenses.create`: Registro de gasto con impacto opcional en efectivo de caja activa.

### 10. Compras y Devoluciones
* `purchases.list`: Historial de recepciones de mercancía a proveedores.
* `purchases.create`: Recepción de mercancía con incremento masivo de stock. Contrato (FASE 3.7D): `{ proveedor, proveedorId?, numeroFacturaProveedor?, items: [{varianteId, cantidad, costoUnitario, nombreProducto?}], total, formaPago?, notas? }`. `costoUnitario` por línea es un dato base legítimo (costo negociado con el proveedor), pero el `total` SIEMPRE se recalcula server-side (`cantidad × costoUnitario` sumado) y se rechaza con `PURCHASE_TOTAL_MISMATCH` si no coincide. **No actualiza `Variantes.costo`** -- no existe una regla de costo promedio ponderado definida en el sistema (ver reporte FASE 3.7D); solo incrementa `Variantes.stock` y registra Kardex tipo `COMPRA`.
* `returns.list`: Historial de devoluciones de clientes.
* `returns.create`: Reingreso de prendas devueltas a inventario y reembolso en caja.

### 11. Auditoría
* `audit.list`: Trazabilidad inmutable de eventos sensibles del sistema.

---

## Detalle de Endpoints Críticos

### `sales.create`
* **Requiere Permiso:** `ventas.crear`
* **FASE 3.6 (corrección de bloqueante de seguridad):** el servidor recalcula de forma AUTORITATIVA `precioUnitario`/`costoUnitario` de cada renglón directamente desde `Variantes`, valida el descuento por línea contra `Productos.descuento_maximo`, recalcula el ITBIS desde `Productos.impuesto` (solo si `aplicarImpuesto !== false`), y compara el `total` recalculado contra el enviado por el cliente (tolerancia RD$1 por redondeo). Si no coincide, o si el descuento excede el máximo del producto, o si la suma de `pagos` no cubre el total, la venta se **rechaza** — el precio/subtotal/descuento/impuesto/total que envía el cliente son solo datos auxiliares para detectar inconsistencias, nunca la fuente de verdad.
* **Campo adicional:** `aplicarImpuesto` (boolean, opcional, default `true`) — si `false`, el servidor no aplica ITBIS a ningún renglón.
* **Errores nuevos de este endpoint:** `PRICE_MISMATCH` (total/pagos no coinciden con lo calculado), `DISCOUNT_EXCEEDS_MAXIMUM` (descuento de línea excede `descuento_maximo` del producto).
* **Payload de Ejemplo:**
```json
{
  "action": "sales.create",
  "sessionToken": "ZIO-SESS-...",
  "data": {
    "clienteId": "CLI-000001",
    "clienteNombre": "Mariana Gómez",
    "clienteDocumento": "001-9876543-2",
    "cajaSesionId": "CAJA-000001",
    "subtotal": 6500,
    "descuentoTotal": 500,
    "impuestoTotal": 1080,
    "total": 7080,
    "costoTotal": 3200,
    "metodoPago": "EFECTIVO",
    "pagos": [{ "metodo": "EFECTIVO", "monto": 7080 }],
    "efectivoRecibido": 8000,
    "cambioEntregado": 920,
    "esCredito": false,
    "items": [
      {
        "productoId": "PRD-000001",
        "varianteId": "VAR-000001",
        "nombreProducto": "Vestido Gala Seda",
        "sku": "ZIO-VES-001-BEI-M",
        "talla": "M",
        "color": "Beige Arena",
        "cantidad": 1,
        "costoUnitario": 3200,
        "precioUnitario": 6500,
        "descuentoPorcentaje": 0,
        "descuentoMonto": 500,
        "subtotal": 6000,
        "impuestoMonto": 1080,
        "total": 7080
      }
    ]
  }
}
```
* **Respuesta Exitosa:**
```json
{
  "success": true,
  "message": "Venta VEN-000001 procesada exitosamente.",
  "saleId": "VEN-000001",
  "numeroVenta": "VEN-000001"
}
```

---

## Mecanismo de Compensación (Rollback Engine)

Cada transacción crítica inicializa un contexto de compensación (`DbHelper.beginTx()`).
A medida que se ejecutan escrituras en Google Sheets, se apilan acciones de reversión:
* Si se insertó una fila en `Ventas` o `Venta_Items`, se registra su ID para borrado si ocurre un error posterior.
* Si se descontó stock de una variante en `Variantes`, se preserva el `oldStock` exacto para restaurarlo.
* Si se alteró el balance de `Cajas`, se preserva el acumulado previo para restaurarlo.

En caso de cualquier excepción no controlada (por ejemplo, desconexión de red o fallo de cuota), el bloque `catch` ejecuta `DbHelper.rollback(tx, err)` en orden estrictamente inverso, **garantizando que nunca queden datos huérfanos o inconsistentes entre hojas**.
