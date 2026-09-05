# ZIO CLOTHES — BACKEND PORTABLE & REUTILIZABLE (GOOGLE APPS SCRIPT + GOOGLE SHEETS)

Backend centralizado, modular y portable para **ZIO CLOTHES Boutique**. Diseñado para actuar como **única fuente de verdad** y ser consumido de manera simultánea e independiente por múltiples aplicaciones frontend (**Google AI Studio**, **Antigravity**, o aplicaciones móviles).

---

## 🏛️ Arquitectura del Sistema

```
                      ┌────────────────────────────────────────┐
                      │             GOOGLE SHEETS              │
                      │       (Única Base de Datos)            │
                      │        22 Hojas Normalizadas           │
                      └───────────────────▲────────────────────┘
                                          │
                                          │ SpreadsheetApp API
                                          │
                      ┌───────────────────┴────────────────────┐
                      │    GOOGLE APPS SCRIPT — BACKEND ÚNICO  │
                      │  • LockService (Concurrencia)          │
                      │  • Rollback Compensation Engine        │
                      │  • SHA-256 + Salt Auth & Sessions      │
                      │  • Business Domain Controllers         │
                      └───────────────────▲────────────────────┘
                                          │
                                          │ HTTPS POST (JSON)
                                          │
                       ┌──────────────────┴──────────────────┐
                       │                                     │
           ┌───────────┴──────────┐              ┌───────────┴──────────┐
           │   AI STUDIO FRONTEND │              │ ANTIGRAVITY FRONTEND │
           │     (React 19 SPA)   │              │     (React / Web)    │
           └──────────────────────┘              └──────────────────────┘
```

---

## 📦 Estructura del Backend

```
ZIO-Google-Backend/
├── apps-script/
│   ├── appsscript.json        # Manifiesto, zona horaria (America/Santo_Domingo) y V8 runtime
│   ├── Main.gs                # Enrutador HTTP principal (doGet/doPost) y despachador de acciones
│   ├── Config.gs              # Manejador de propiedades de script y SPREADSHEET_ID
│   ├── DbHelper.gs            # Motor CRUD de alto rendimiento y motor de rollback/compensación
│   ├── Security.gs            # Autenticación, SHA-256 con salt aleatorio, tokens de sesión y RBAC
│   ├── LockServiceHelper.gs   # Aislamiento atómico de transacciones concurrentes
│   ├── Sequences.gs           # Generador atómico de correlativos (VEN, CLI, PRD, CAJA, etc.)
│   ├── AuditController.gs     # Registro inmutable de eventos sensibles
│   ├── AuthController.gs      # Controlador de login, logout y cuentas de usuario
│   ├── ProductsController.gs  # Catálogo de prendas, variantes (talla/color/stock) y auxiliares
│   ├── CustomersController.gs # Cartera de clientes y balance dinámico de crédito comercial
│   ├── SalesController.gs     # Facturación POS, descuento de stock, crédito y cuadre de caja
│   ├── InventoryController.gs # Ajustes de inventario y Kardex de movimientos
│   ├── CreditsController.gs   # Cuentas por cobrar y abonos a crédito con recibo oficial
│   ├── CashController.gs      # Arqueos de caja, fondo inicial, retiros/ingresos y cierre
│   ├── ExpensesController.gs  # Gastos operativos y sincronización con caja activa
│   ├── PurchasesController.gs # Recepción de compras y carga masiva a stock
│   ├── ReturnsController.gs   # Devoluciones de clientes con reingreso a stock
│   ├── SettingsController.gs  # Parámetros del negocio y bundle bootstrap de inicio
│   └── SeedSetup.gs           # Aprovisionador automático de las 22 hojas y datos semilla
├── README.md                  # Este manual de instalación y despliegue
├── API.md                     # Especificación completa de los 28 endpoints
└── DATABASE.md                # Estructura detallada de las 22 hojas y relaciones
```

---

## 🚀 Guía de Instalación y Despliegue Paso a Paso

### Paso 1: Crear el Google Spreadsheet
1. Accede a [Google Sheets](https://sheets.new) con tu cuenta de Google.
2. Nombra el documento: **`ZIO CLOTHES — BASE DE DATOS MAESTRA`**.
3. Copia el **ID del Spreadsheet** de la URL del navegador:
   `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e6f7g8h9i...`**`/edit`

### Paso 2: Crear el Proyecto en Google Apps Script
1. Dentro de la hoja, ve al menú superior: **Extensiones** $\to$ **Apps Script**.
2. O bien, crea un proyecto independiente en [script.google.com](https://script.google.com).
3. En el editor de Apps Script, crea cada uno de los archivos `.gs` que se encuentran en la carpeta `apps-script/` y pega el código correspondiente.
4. Reemplaza el contenido de `appsscript.json` con el provisto en esta carpeta (asegúrate de habilitar *"Ver archivo de manifiesto appsscript.json"* en la configuración del proyecto si no está visible).

### Paso 3: Configurar el ID de la Hoja
En el editor de Apps Script, selecciona el archivo `Config.gs`, elige la función `setSpreadsheetId` o ejecútala en la consola:
```javascript
setSpreadsheetId("TU_SPREADSHEET_ID_AQUI");
```
*Si creaste el script desde el menú Extensiones de la misma hoja, este paso es automático.*

### Paso 4: Inicializar la Base de Datos (Aprovisionamiento Automático)
1. En el selector de funciones del editor de Apps Script, selecciona la función **`seedInitialData`** (del archivo `SeedSetup.gs`).
2. Haz clic en **Ejecutar** (`Run`).
3. Google te solicitará autorizar los permisos de acceso al Spreadsheet. Acéptalos.
4. El script creará automáticamente las **22 hojas**, formateará los encabezados en color pizarra oscuro con texto en negrita, inmovilizará la primera fila y sembrará los roles, categorías, tallas, colores y el usuario inicial:
   - **Usuario:** `admin`
   - **Contraseña:** `admin123`
   - **Rol:** `ADMIN` (Acceso total)

### Paso 5: Desplegar como Web App (API Pública)
1. En la esquina superior derecha de Apps Script, haz clic en **Implementar** $\to$ **Nueva implementación**.
2. Selecciona el tipo: **Aplicación web**.
3. Configura exactamente los siguientes campos:
   - **Descripción:** `ZIO CLOTHES API v2.0`
   - **Ejecutar como:** `Yo (tu cuenta de Google)` (*Execute as: Me*)
   - **Quién tiene acceso:** `Cualquier usuario` (*Who has access: Anyone*)
4. Haz clic en **Implementar**.
5. Copia la **URL de la aplicación web** generada:
   `https://script.google.com/macros/s/AKfycbx.../exec`

---

## 🔗 Cómo Conectar Cualquier Frontend (AI Studio o Antigravity)

1. En el frontend (React/Vite), configura la URL en el archivo `.env`:
   ```env
   VITE_GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbx.../exec
   ```
2. O en la pantalla de **Ajustes / Configuración**, ingresa la URL en el campo *"Google Apps Script Web App URL"* y pulsa *"Probar Conexión"*.
3. Realiza la prueba inicial:
   - La aplicación ejecutará un `ping` HTTP hacia el backend.
   - Deberá responder con estado `ONLINE` y confirmar la conexión al Spreadsheet.
4. Inicia sesión con:
   - **Usuario:** `admin`
   - **Contraseña:** `admin123`

---

## 🛡️ Características de Nivel Empresarial Implementadas

1. **Aislamiento de Concurrencia:** Utiliza `LockService` en todas las operaciones que alteran existencias, caja o créditos, impidiendo sobreventas y descuadres.
2. **Motor de Rollback por Compensación (`DbHelper.rollback`):** Si una venta, abono o compra falla en medio de su ejecución en varias hojas, el motor revierte en orden inverso todas las inserciones y restaura las existencias originales.
3. **Criptografía Segura:** Las contraseñas se almacenan mediante `SHA-256` utilizando una sal aleatoria única por usuario (`password_salt`).
4. **Cero Dependencia de LocalStorage:** Toda la data vive y se valida en Google Sheets. El frontend solo conserva el `sessionToken` en memoria volátil de sesión.
