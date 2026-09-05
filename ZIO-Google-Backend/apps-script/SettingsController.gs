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
      // FASE 3 (logo de empresa): default vacío -- mientras no exista una
      // fila real 'logoUrl' en Configuracion, el frontend recibe '' y
      // muestra el logo del sistema (fallback), nunca undefined.
      logoUrl: '',
      moneda: 'RD$',
      impuestoPorcentaje: 18,
      pieTicket: '¡Gracias por elegir ZIO CLOTHES! Calidad y elegancia en cada prenda.',
      // FASE 4 (textos del recibo -- auditoría): `eslogan` ya existía en el
      // tipo SystemSettings del frontend y ya se usaba en el recibo
      // (ReceiptTicket.tsx/InstallmentReceiptTicket.tsx), pero nunca tuvo
      // un default ni una fila real en esta hoja -- se completa la
      // conexión aquí, con el mismo valor que ya usaba el frontend
      // (INITIAL_SETTINGS.eslogan) para no cambiar el aspecto actual del
      // recibo. `mensajeFinalRecibo`/`pieTecnicoRecibo` reemplazan texto
      // que antes estaba fijo dentro del propio componente del recibo --
      // mismos valores exactos, ahora configurables.
      eslogan: 'Elegancia, Vanguardia y Estilo Contemporáneo',
      mensajeFinalRecibo: '¡Gracias por vestir ZIO CLOTHES!',
      pieTecnicoRecibo: 'Sistema POS ZIO • Comprobante Digital / Físico',
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
   * FASE 3 (logo de empresa -- reutiliza infraestructura de Drive de
   * productos): sube el logo del negocio a la MISMA carpeta administrada
   * (PRODUCT_IMAGES_FOLDER_ID / "POS - Imagenes de Productos"), usando
   * exactamente el mismo mecanismo ya usado para fotos de productos
   * (ProductsController.uploadImageToManagedFolder_) -- nunca se crea una
   * carpeta ni una cuenta de Drive nueva. El archivo se distingue de las
   * fotos de productos por su prefijo de nombre ('empresa-logo_...') y por
   * su propia entrada de auditoría; la URL resultante NO se guarda todavía
   * en ningún lado -- el frontend debe llamar después a
   * `system.updateSettings` con `{ logoUrl: <esta URL> }`, igual que
   * ProductFormModal hace con `products.save` tras `products.uploadImage`.
   *
   * Exige el mismo permiso que ya protege el resto de esta configuración
   * (`admin.configuracion`) -- no se inventa un permiso nuevo.
   */
  handleUploadLogo(data, user) {
    Security.requirePermission(user, 'admin.configuracion');

    if (!data || typeof data.imageDataUrl !== 'string' || !data.imageDataUrl.trim()) {
      throw new Error('VALIDATION_ERROR: Debe proporcionar la imagen del logo a subir.');
    }

    const uploaded = ProductsController.uploadImageToManagedFolder_(data.imageDataUrl, 'empresa-logo');

    AuditController.log(
      user,
      'COMPANY_LOGO_UPLOADED',
      'CONFIG',
      'CompanyLogo',
      uploaded.fileId,
      `Logo de la empresa subido a Google Drive (${uploaded.fileName}, ${(uploaded.bytesLength / 1024).toFixed(0)}KB)`
    );

    return {
      success: true,
      message: 'Logo subido exitosamente a Google Drive.',
      imageUrl: uploaded.imageUrl,
      fileId: uploaded.fileId
    };
  },

  /**
   * Updates application settings.
   *
   * FASE 3 (logo de empresa -- reemplazo seguro, mismo patrón que FASE 2
   * de productos en ProductsController.handleSaveProduct): si `data`
   * incluye `logoUrl`, se lee el valor ACTUAL de esa clave en
   * `Configuracion` (fuente de verdad) antes de guardar -- así se sabe
   * cuál era el logo anterior sin que el frontend tenga que enviar un
   * parámetro nuevo. Tras un guardado exitoso, si `logoUrl` cambió, se
   * intenta enviar el logo anterior a la papelera (solo si de verdad es
   * un archivo administrado, no está en uso por otro lado, y no es el
   * logo que se está guardando ahora) mediante
   * ProductsController.trashManagedImageIfSafe_ -- la misma función ya
   * usada y probada para fotos de productos, sin duplicar su lógica.
   */
  handleUpdateSettings(data, user) {
    Security.requirePermission(user, 'admin.configuracion');

    if (!data || typeof data !== 'object') {
      throw new Error('VALIDATION_ERROR: Datos de configuración inválidos.');
    }

    const hasLogoUrl = Object.prototype.hasOwnProperty.call(data, 'logoUrl');
    const oldLogoUrl = hasLogoUrl ? (this.handleGetSettings().settings.logoUrl || '') : '';

    let result;
    try {
      result = this.updateSettingsTransaction_(data, user);
    } catch (err) {
      // CASO B (logo nuevo ya subido a Drive, pero el guardado de la
      // configuración falla): ese archivo nuevo quedaría huérfano -- se
      // intenta limpiar, sin que un fallo en esa limpieza oculte el error
      // real del guardado (que siempre se relanza sin modificar).
      if (hasLogoUrl && data.logoUrl && data.logoUrl !== oldLogoUrl) {
        ProductsController.trashManagedImageIfSafe_(data.logoUrl, oldLogoUrl, null);
      }
      throw err;
    }

    // CASO C (guardado exitoso, la limpieza del logo anterior podría
    // fallar): la configuración YA quedó guardada (result ya está armado)
    // -- esta limpieza ocurre fuera de LockServiceHelper.runWithLock (ver
    // updateSettingsTransaction_) para no retener el candado mientras se
    // llama a la red de Drive, y nunca puede convertir este éxito en un
    // error.
    if (hasLogoUrl && data.logoUrl !== oldLogoUrl) {
      ProductsController.trashManagedImageIfSafe_(oldLogoUrl, data.logoUrl, null);
    }

    return result;
  },

  /**
   * Cuerpo transaccional original de handleUpdateSettings (sin cambios de
   * comportamiento respecto a antes de la FASE 3) -- extraído a un método
   * aparte solo para poder envolver la llamada completa en el try/catch
   * de arriba, igual que ProductsController.saveProductTransaction_.
   */
  updateSettingsTransaction_(data, user) {
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
