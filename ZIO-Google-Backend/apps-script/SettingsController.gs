/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: SettingsController.gs
 * Description: Business configuration, initial SPA bootstrap bundle, and system diagnostics.
 */

const SettingsController = {
  /**
   * Returns application settings mapped from key/value rows in 'Configuracion'.
   */
  handleGetSettings() {
    const rows = DbHelper.getAllRows('Configuracion');
    const settings = {
      nombreNegocio: 'ZIO CLOTHES',
      rnc: '132-45678-9',
      telefono: '809-555-0192',
      correo: 'contacto@zioclothes.com',
      direccion: 'Av. Winston Churchill #109, BlueMall Nivel 2, Santo Domingo',
      moneda: 'RD$',
      impuestoPorcentaje: 18,
      pieTicket: '¡Gracias por elegir ZIO CLOTHES! Calidad y elegancia en cada prenda.',
      politicaDevolucion: 'Cambios permitidos dentro de los 15 días posteriores a la compra con recibo original.',
      permitirVentaSinStock: false,
      notificarStockBajo: true,
      umbralStockBajo: 5,
      diasCreditoPorDefecto: 15,
      actualizadoEn: getNowFormatted()
    };

    rows.forEach(r => {
      const k = String(r.clave).trim();
      let v = r.valor;
      if (v === 'true' || v === 'TRUE') v = true;
      else if (v === 'false' || v === 'FALSE') v = false;
      else if (!isNaN(Number(v)) && String(v).trim() !== '') v = Number(v);

      if (k) {
        settings[k] = v;
      }
    });

    return {
      success: true,
      settings: settings
    };
  },

  /**
   * FASE 3.7H (hallazgo/bug concreto confirmado por auditoría): la hoja
   * `Configuracion` usa `clave` como PK real (ver SCHEMAS en SeedSetup.gs
   * y DATABASE.md: `['clave', 'valor', 'descripcion', 'actualizado_en']`)
   * -- NO tiene columna `id`. `DbHelper.updateRowById()` asume una
   * columna `id` en cualquier hoja (busca `headers.indexOf('id')` y lanza
   * si no la encuentra), así que `handleUpdateSettings` fallaba con
   * "La hoja 'Configuracion' no tiene columna 'id'" cada vez que
   * intentaba ACTUALIZAR una clave ya existente -- es decir, siempre
   * después de la primera vez (y `seedInitialData()` ya siembra 13 claves
   * reales desde el arranque, así que en la práctica fallaba desde el
   * primer guardado real). Se agrega este helper LOCAL, exclusivo de
   * `Configuracion`, en vez de modificar `DbHelper.gs` (compartido por
   * todos los demás controladores) para no afectar ningún otro módulo.
   */
  updateConfigRowByClave(clave, valor, actualizadoEn) {
    const sheet = DbHelper.getSheet('Configuracion');
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return false;

    const headers = data[0].map(h => String(h).trim());
    const claveColIndex = headers.indexOf('clave');
    const valorColIndex = headers.indexOf('valor');
    const actualizadoColIndex = headers.indexOf('actualizado_en');
    if (claveColIndex === -1 || valorColIndex === -1) {
      throw new Error("VALIDATION_ERROR: La hoja 'Configuracion' no tiene las columnas esperadas.");
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][claveColIndex]).trim() === clave) {
        sheet.getRange(i + 1, valorColIndex + 1).setValue(valor);
        if (actualizadoColIndex !== -1) {
          sheet.getRange(i + 1, actualizadoColIndex + 1).setValue(actualizadoEn);
        }
        return true;
      }
    }
    return false;
  },

  /**
   * Updates application settings.
   */
  handleUpdateSettings(data, user) {
    Security.requirePermission(user, 'admin.configuracion');

    if (!data || typeof data !== 'object') {
      throw new Error('VALIDATION_ERROR: Datos de configuración inválidos.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const nowStr = getNowFormatted();
      const existing = DbHelper.getAllRows('Configuracion');
      const existingKeys = new Set(existing.map(r => r.clave));

      Object.keys(data).forEach(key => {
        const val = typeof data[key] === 'object' ? JSON.stringify(data[key]) : String(data[key]);

        if (existingKeys.has(key)) {
          this.updateConfigRowByClave(key, val, nowStr);
        } else {
          DbHelper.insertRow('Configuracion', {
            clave: key,
            valor: val,
            descripcion: '',
            actualizado_en: nowStr
          });
        }
      });

      AuditController.log(user, 'SETTINGS_UPDATED', 'CONFIG', 'SystemSettings', 'GLOBAL', 'Parámetros del sistema actualizados.');

      return {
        success: true,
        message: 'Configuración actualizada exitosamente.'
      };
    });
  },

  /**
   * BOOTSTRAP BUNDLE:
   * Consolidates all initial master data into a single, high-speed API payload:
   * - System settings
   * - Categories, sizes, colors, suppliers
   * - Full products catalog with variants & stocks
   * - Customers
   * - Active Cash Session
   */
  handleGetBootstrapData() {
    const settingsRes = this.handleGetSettings();
    const auxiliaries = ProductsController.handleListAuxiliaries();
    const productsRes = ProductsController.handleListProducts();
    const customersRes = CustomersController.handleListCustomers();
    const cashRes = CashController.handleGetActiveSession();

    return {
      success: true,
      data: {
        settings: settingsRes.settings,
        categories: auxiliaries.categories,
        sizes: auxiliaries.sizes,
        colors: auxiliaries.colors,
        suppliers: auxiliaries.suppliers,
        products: productsRes.products,
        customers: customersRes.customers,
        activeCashSession: cashRes.activeSession
      }
    };
  }
};
