/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: ProductsController.gs
 * Description: Management of products, garment variants (size/color/SKU/barcode/stock),
 * categories, sizes, colors, and suppliers.
 */

/**
 * FASE FINAL (multi-cuenta de fotos): nombre de Script Property donde se
 * persiste el ID de la carpeta de Drive de esta instalación, siguiendo el
 * mismo patrón ya usado por SPREADSHEET_ID en Config.gs (PropertiesService,
 * exclusivo del backend, nunca en Sheets/Product/frontend). El nombre de
 * carpeta de abajo solo se usa para la detección INICIAL de una instalación
 * que todavía no tiene ID configurado -- una vez encontrado o creado, el ID
 * queda guardado y las subidas futuras nunca vuelven a buscar por nombre.
 */
const PRODUCT_IMAGES_FOLDER_PROPERTY = 'PRODUCT_IMAGES_FOLDER_ID';
const PRODUCT_IMAGES_FOLDER_NAME = 'POS - Imagenes de Productos';

const ProductsController = {
  /**
   * Returns complete catalog with nested variants.
   * Performs an in-memory join between 'Productos' and 'Variantes'.
   * @param {Object} data - optional filters { categoriaId, estado, soloStockBajo }
   * @returns {Object} { success: true, products: Array }
   */
  handleListProducts(data) {
    const productsRaw = DbHelper.getAllRows('Productos');
    const variantsRaw = DbHelper.getAllRows('Variantes');

    // Group variants by producto_id
    const variantsByProduct = {};
    variantsRaw.forEach(v => {
      const prodId = String(v.producto_id || '').trim();
      if (!variantsByProduct[prodId]) variantsByProduct[prodId] = [];
      variantsByProduct[prodId].push({
        id: v.id,
        productoId: v.producto_id,
        sku: v.sku,
        codigoBarras: v.codigo_barras,
        color: v.color,
        talla: v.talla,
        costo: Number(v.costo) || 0,
        precio: Number(v.precio) || 0,
        stock: Number(v.stock) || 0,
        estado: v.estado || 'ACTIVO'
      });
    });

    // Assemble hierarchical product entities
    const products = productsRaw.map(p => {
      const pId = String(p.id).trim();
      const vars = variantsByProduct[pId] || [];
      const totalStock = vars.reduce((sum, v) => sum + (v.stock || 0), 0);

      return {
        id: p.id,
        sku: p.sku,
        codigoBarras: p.codigo_barras || '',
        nombre: p.nombre,
        descripcion: p.descripcion || '',
        categoriaId: p.categoria_id,
        categoriaNombre: p.categoria_nombre || '',
        marca: p.marca || 'ZIO CLOTHES',
        proveedorId: p.proveedor_id || '',
        costo: Number(p.costo) || 0,
        precio: Number(p.precio) || 0,
        precioEspecial: p.precio_especial ? Number(p.precio_especial) : undefined,
        impuesto: Number(p.impuesto) || 0,
        descuentoMaximo: p.descuento_maximo ? Number(p.descuento_maximo) : 0,
        stockMinimo: Number(p.stock_minimo) || 5,
        estado: p.estado || 'ACTIVO',
        imagenUrl: p.imagen_url || '',
        creadoEn: p.creado_en,
        variantes: vars,
        totalStock: totalStock
      };
    });

    return {
      success: true,
      products: products
    };
  },

  /**
   * Saves (creates or updates) a product and its associated variants.
   * Atomic operation protected by LockService.
   * @param {Object} data - Product and variants payload
   * @param {Object} user - Session user
   */
  handleSaveProduct(data, user) {
    if (data.id) {
      Security.requirePermission(user, 'productos.editar');
    } else {
      Security.requirePermission(user, 'productos.crear');
    }

    if (!data.nombre || !data.categoriaId) {
      throw new Error('VALIDATION_ERROR: Nombre de prenda y categoría son requeridos.');
    }

    // FASE 2 (reemplazo seguro y limpieza de imágenes en Drive): se lee el
    // valor de `imagen_url` que HOY tiene la fila en Sheets (fuente de
    // verdad) ANTES de sobreescribirla -- así el backend conoce la
    // "imagen anterior" sin que el frontend tenga que enviar un parámetro
    // nuevo (`previousImagenUrl`) que podría llegar desactualizado o
    // manipulado. En una creación (`data.id` vacío) no existe fila previa,
    // así que `oldImagenUrl` queda vacío y nunca se dispara limpieza --
    // exactamente el comportamiento pedido ("al crear no hay imagen
    // anterior, no ejecutar ninguna limpieza").
    const existingProduct = data.id ? DbHelper.findById('Productos', data.id) : null;
    const oldImagenUrl = existingProduct ? (existingProduct.imagen_url || '') : '';

    let result;
    try {
      result = this.saveProductTransaction_(data, user, oldImagenUrl);
    } catch (err) {
      // CASO B (subida nueva OK, products.save falla): si esta llamada
      // traía una imagen distinta a la que ya estaba guardada (o no había
      // ninguna, en una creación), esa imagen nueva ya se subió a Drive
      // pero el producto nunca llegó a apuntarle -- es un huérfano recién
      // nacido. Se intenta limpiar, pero un fallo en esa limpieza JAMÁS
      // debe ocultar el error real del guardado (que es lo que se
      // relanza siempre, sin modificar).
      if (data.imagenUrl && data.imagenUrl !== oldImagenUrl) {
        this.trashManagedImageIfSafe_(data.imagenUrl, oldImagenUrl, data.id || null);
      }
      throw err;
    }

    // CASO C (products.save funciona, limpieza de imagen antigua podría
    // fallar): el producto YA quedó guardado correctamente (result ya
    // está armado) -- esta limpieza ocurre FUERA del bloque anterior y
    // deliberadamente FUERA de LockServiceHelper.runWithLock (ver
    // saveProductTransaction_) para no retener el candado de escritura
    // mientras se hacen llamadas de red a Drive (getFileById/getParents),
    // que pueden tardar. `trashManagedImageIfSafe_` nunca lanza errores
    // hacia afuera -- la limpieza es siempre secundaria al guardado, así
    // que `result` (ya exitoso) se devuelve sin condicionarlo a esto.
    if (oldImagenUrl && data.imagenUrl !== oldImagenUrl) {
      this.trashManagedImageIfSafe_(oldImagenUrl, data.imagenUrl, result.productId);
    }

    return result;
  },

  /**
   * Cuerpo transaccional original de handleSaveProduct (sin cambios de
   * comportamiento respecto a antes de la FASE 2) -- extraído a un método
   * aparte solo para poder envolver la llamada completa en el try/catch
   * de arriba sin anidar aún más lógica dentro del propio candado.
   */
  saveProductTransaction_(data, user, oldImagenUrl) {
    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const isUpdate = !!data.id;
      let productId = data.id;

      // Find category name
      const categories = DbHelper.getAllRows('Categorias');
      const cat = categories.find(c => c.id === data.categoriaId);
      const catName = cat ? cat.nombre : 'General';

      if (!isUpdate) {
        productId = Sequences.getNext('PRD');
      }

      // Generate base SKU if not provided
      let baseSku = data.sku;
      if (!baseSku) {
        const cleanName = data.nombre.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() || 'PRE';
        baseSku = `ZIO-${cleanName}-${Math.floor(100 + Math.random() * 900)}`;
      }

      const productRecord = {
        id: productId,
        sku: baseSku,
        codigo_barras: data.codigoBarras || '',
        nombre: data.nombre.trim(),
        descripcion: (data.descripcion || '').trim(),
        categoria_id: data.categoriaId,
        categoria_nombre: catName,
        marca: data.marca || 'ZIO CLOTHES',
        proveedor_id: data.proveedorId || '',
        costo: Number(data.costo) || 0,
        precio: Number(data.precio) || 0,
        precio_especial: data.precioEspecial ? Number(data.precioEspecial) : '',
        impuesto: data.impuesto !== undefined ? Number(data.impuesto) : CONFIG.DEFAULT_TAX_RATE,
        descuento_maximo: data.descuentoMaximo ? Number(data.descuentoMaximo) : 0,
        stock_minimo: data.stockMinimo !== undefined ? Number(data.stockMinimo) : 5,
        estado: data.estado || 'ACTIVO',
        imagen_url: data.imagenUrl || '',
        creado_en: data.creadoEn || getNowFormatted()
      };

      if (isUpdate) {
        DbHelper.updateRowById('Productos', productId, productRecord);
      } else {
        DbHelper.insertRow('Productos', productRecord);
      }

      // Process variants
      const incomingVariants = Array.isArray(data.variantes) ? data.variantes : [];
      const existingVariants = DbHelper.findRows('Variantes', v => v.producto_id === productId);

      for (let i = 0; i < incomingVariants.length; i++) {
        const v = incomingVariants[i];
        const variantId = v.id || Sequences.getNext('VAR');
        const varSku = v.sku || `${baseSku}-${(v.color || 'COL').substring(0, 3).toUpperCase()}-${v.talla || 'U'}`;
        const barcode = v.codigoBarras || `74600${Math.floor(1000000 + Math.random() * 9000000)}`;

        const variantRecord = {
          id: variantId,
          producto_id: productId,
          sku: varSku,
          codigo_barras: barcode,
          color: v.color || 'Único',
          talla: v.talla || 'U',
          costo: v.costo !== undefined ? Number(v.costo) : productRecord.costo,
          precio: v.precio !== undefined ? Number(v.precio) : productRecord.precio,
          stock: v.stock !== undefined ? Number(v.stock) : 0,
          estado: v.estado || 'ACTIVO'
        };

        const existingVar = existingVariants.find(ev => ev.id === variantId);
        if (existingVar) {
          DbHelper.updateRowById('Variantes', variantId, variantRecord);
        } else {
          DbHelper.insertRow('Variantes', variantRecord);
        }
      }

      AuditController.log(
        user,
        isUpdate ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
        'PRODUCTOS',
        'Product',
        productId,
        `${isUpdate ? 'Actualización' : 'Creación'} de prenda: ${productRecord.nombre} (${productId})`
      );

      return {
        success: true,
        message: `Prenda ${isUpdate ? 'actualizada' : 'creada'} exitosamente.`,
        productId: productId
      };
    });
  },

  /**
   * Soft deletes (deactivates) a product and all its variants.
   */
  handleDeleteProduct(productId, user) {
    Security.requirePermission(user, 'productos.eliminar');
    if (!productId) throw new Error('VALIDATION_ERROR: ID de producto requerido.');

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const prod = DbHelper.findById('Productos', productId);
      if (!prod) throw new Error('NOT_FOUND: Prenda no encontrada.');

      DbHelper.updateRowById('Productos', productId, { estado: 'INACTIVO' });

      // Deactivate all variants
      const variants = DbHelper.findRows('Variantes', v => v.producto_id === productId);
      variants.forEach(v => {
        DbHelper.updateRowById('Variantes', v.id, { estado: 'INACTIVO' });
      });

      AuditController.log(user, 'PRODUCT_DELETED', 'PRODUCTOS', 'Product', productId, `Desactivación de prenda: ${prod.nombre}`);

      return { success: true, message: 'Prenda desactivada correctamente.' };
    });
  },

  /**
   * Auxiliary lists: Categories, Sizes, Colors, Suppliers.
   */
  handleListAuxiliaries() {
    return {
      success: true,
      categories: DbHelper.getAllRows('Categorias'),
      sizes: DbHelper.getAllRows('Tallas'),
      colors: DbHelper.getAllRows('Colores'),
      suppliers: DbHelper.getAllRows('Proveedores')
    };
  },

  /**
   * FIX (fotos de productos -- auditoría aprobada): sube una imagen real a
   * Google Drive y devuelve una URL utilizable directamente en <img src>.
   * Reemplaza el flujo anterior, que guardaba el Base64 completo de la
   * imagen directamente en la celda `imagen_url` de la hoja `Productos` --
   * eso excedía el límite real de Google Sheets (~50,000 caracteres por
   * celda) para cualquier fotografía real, y NUNCA debe repetirse:
   * `imagen_url` solo almacena una URL corta o una cadena vacía.
   *
   * Contrato: recibe `data.imageDataUrl`, un Data URL completo tal como lo
   * produce `FileReader.readAsDataURL()` en el navegador
   * (`data:image/<tipo>;base64,<contenido>`). El Base64 viaja en el body
   * de esta única petición HTTP (que Apps Script sí soporta sin problema
   * para archivos de hasta varios MB) -- nunca se escribe en Sheets.
   *
   * Requiere el mismo permiso que ya protege la creación/edición de
   * productos (`productos.crear` o `productos.editar`) -- no se inventa
   * un permiso nuevo que ningún rol tendría sembrado en Roles_Permisos.
   */
  handleUploadImage(data, user) {
    if (
      !Security.hasPermission(user, 'productos.crear') &&
      !Security.hasPermission(user, 'productos.editar')
    ) {
      throw new Error('FORBIDDEN: No tiene permiso para subir imágenes de productos.');
    }

    if (!data || typeof data.imageDataUrl !== 'string' || !data.imageDataUrl.trim()) {
      throw new Error('VALIDATION_ERROR: Debe proporcionar la imagen a subir.');
    }

    // FASE 3 (logo de empresa -- reutiliza infraestructura de Drive): toda
    // la mecánica de decodificar/validar el Base64, crear el Blob,
    // resolver la carpeta administrada, crear el archivo, compartirlo y
    // armar la URL vive ahora en uploadImageToManagedFolder_ -- compartida
    // con SettingsController.handleUploadLogo (logo de la empresa), para
    // no duplicar esa lógica entre ambos. El comportamiento externo de
    // handleUploadImage (mensajes de error, permiso exigido, forma de la
    // respuesta) permanece exactamente igual que antes de este cambio.
    const uploaded = this.uploadImageToManagedFolder_(data.imageDataUrl, 'producto');

    AuditController.log(
      user,
      'PRODUCT_IMAGE_UPLOADED',
      'PRODUCTOS',
      'ProductImage',
      uploaded.fileId,
      `Imagen de producto subida a Google Drive (${uploaded.fileName}, ${(uploaded.bytesLength / 1024).toFixed(0)}KB)`
    );

    return {
      success: true,
      message: 'Imagen subida exitosamente a Google Drive.',
      imageUrl: uploaded.imageUrl,
      fileId: uploaded.fileId
    };
  },

  /**
   * FASE 3 (logo de empresa -- reutiliza infraestructura de Drive de
   * productos): lógica de subida genérica -- decodificación/validación de
   * Base64, creación del Blob, resolución de la carpeta administrada
   * (PRODUCT_IMAGES_FOLDER_ID / "POS - Imagenes de Productos"), creación
   * del archivo, permisos de compartir y armado de la URL -- extraída de
   * `handleUploadImage` para que también pueda usarla
   * `SettingsController.handleUploadLogo` sin duplicar Base64→Blob,
   * validación MIME, creación de archivo, permisos o generación de URL.
   * Nunca se crea una carpeta nueva ni una cuenta de Drive nueva: reutiliza
   * exactamente `getOrCreateProductImagesFolder()`, ya existente.
   *
   * Deliberadamente NO valida permisos ni registra auditoría -- cada
   * llamador (fotos de productos, logo de empresa) mantiene su propio
   * chequeo de permiso y su propia entrada de auditoría, porque son
   * dominios distintos con permisos y trazabilidad distintos.
   *
   * @param {string} imageDataUrl - Data URL Base64 completo.
   * @param {string} fileNamePrefix - Prefijo del nombre de archivo (ej. 'producto', 'empresa-logo') -- permite distinguir lógicamente el propósito del archivo dentro de la misma carpeta compartida.
   * @returns {{imageUrl: string, fileId: string, fileName: string, bytesLength: number}}
   */
  uploadImageToManagedFolder_(imageDataUrl, fileNamePrefix) {
    if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.trim()) {
      throw new Error('VALIDATION_ERROR: Debe proporcionar la imagen a subir.');
    }

    // Extrae MIME type real y contenido Base64 del Data URL. Se valida
    // explícitamente que el MIME sea de imagen -- nunca se confía
    // ciegamente en lo que el cliente afirme sin verificarlo aquí también.
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageDataUrl.trim());
    if (!match) {
      throw new Error('VALIDATION_ERROR: El archivo proporcionado no es una imagen Base64 válida.');
    }

    const mimeType = match[1].toLowerCase();
    const base64Data = match[2];
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
      throw new Error(`VALIDATION_ERROR: Formato de imagen no soportado (${mimeType}). Use JPG, PNG, WEBP o GIF.`);
    }

    let bytes;
    try {
      bytes = Utilities.base64Decode(base64Data);
    } catch (e) {
      throw new Error('VALIDATION_ERROR: No se pudo decodificar el contenido de la imagen.');
    }

    // Mismo límite ya comunicado y validado en el frontend (10MB) --
    // defensa adicional del lado del servidor, no un cambio de ese límite.
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('VALIDATION_ERROR: La imagen supera el tamaño máximo permitido de 10MB.');
    }

    const extensionByMime = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    const extension = extensionByMime[mimeType] || 'jpg';
    const fileName = `${fileNamePrefix}_${Utilities.getUuid()}.${extension}`;

    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const folder = this.getOrCreateProductImagesFolder();
    const file = folder.createFile(blob);

    // El contenido no es información sensible -- se comparte como
    // "cualquiera con el enlace puede ver" para que el POS/Catálogo/
    // encabezado de la app puedan mostrarlo en <img src> sin autenticación.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    // Formato de URL de Drive directamente cargable como <img src> --
    // la URL de "vista" normal de Drive (file.getUrl()) sirve una página
    // HTML, no la imagen cruda, y NO funciona dentro de un <img>.
    const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return { imageUrl: imageUrl, fileId: fileId, fileName: fileName, bytesLength: bytes.length };
  },

  /**
   * FASE FINAL (multi-cuenta de fotos): resuelve la carpeta de Drive de
   * esta instalación de forma portable entre cuentas de Google distintas.
   * Nunca depende para siempre de una búsqueda por nombre ni crea una
   * carpeta nueva en cada subida -- sigue esta cadena exacta:
   *
   *   1. Si existe PRODUCT_IMAGES_FOLDER_ID en Script Properties, abrir esa
   *      carpeta con DriveApp.getFolderById() y confirmar que sigue siendo
   *      accesible (getFolderById lanza excepción si el ID ya no existe o
   *      pertenece a otra cuenta/fue borrado). Si es accesible, usarla --
   *      esta es la ÚNICA vía que deben tomar prácticamente todas las
   *      subidas después de la primera.
   *   2. Si NO hay ID configurado (instalación nueva) o el ID guardado dejó
   *      de ser válido, buscar por nombre exacto ('POS - Imagenes de
   *      Productos') SOLO dentro del Drive de la cuenta que ejecuta este
   *      script -- DriveApp siempre opera sobre el Drive del ejecutor, así
   *      que esta búsqueda nunca cruza cuentas ni instalaciones ajenas.
   *   3. Si la búsqueda por nombre encuentra la carpeta, se reutiliza. Si
   *      no la encuentra, se crea una única vez.
   *   4. En ambos casos del paso 3, el ID resultante se persiste de
   *      inmediato en PRODUCT_IMAGES_FOLDER_ID -- así el paso 2 (búsqueda
   *      por nombre) nunca se vuelve a ejecutar para esta instalación.
   *
   * El nombre de carpeta ('POS - Imagenes de Productos') es entonces
   * exclusivamente un mecanismo de detección/arranque inicial, nunca la
   * fuente de verdad en operación normal.
   */
  getOrCreateProductImagesFolder() {
    const props = PropertiesService.getScriptProperties();
    const storedId = props.getProperty(PRODUCT_IMAGES_FOLDER_PROPERTY);

    if (storedId) {
      try {
        const folder = DriveApp.getFolderById(storedId);
        // Tocar el objeto confirma que el ID sigue siendo válido y
        // accesible por la cuenta actual antes de confiar en él.
        folder.getName();
        return folder;
      } catch (e) {
        Logger.log(
          `[ProductsController] PRODUCT_IMAGES_FOLDER_ID guardado (${storedId}) ya no es accesible (${e.message}). Se buscará/creará de nuevo por nombre.`
        );
        // No relanza el error: cae al flujo de detección por nombre de
        // abajo en vez de dejar la subida de imagen totalmente rota.
      }
    }

    const existing = DriveApp.getFoldersByName(PRODUCT_IMAGES_FOLDER_NAME);
    const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(PRODUCT_IMAGES_FOLDER_NAME);

    props.setProperty(PRODUCT_IMAGES_FOLDER_PROPERTY, folder.getId());
    return folder;
  },

  /**
   * FASE 2 (reemplazo seguro y limpieza de imágenes en Drive): extrae el
   * fileId de una URL de Drive reconocible como generada/mostrada por
   * NUESTRO sistema -- soporta tanto el formato que handleUploadImage
   * genera y guarda en Sheets (`uc?export=view&id=`) como el formato que
   * el frontend usa para mostrarla (`thumbnail?id=`, ver
   * src/utils/imageUrl.ts). Cualquier otra cosa (URL externa, Base64
   * histórico, vacío, o cualquier formato de Drive no reconocido) NUNCA
   * se asume nuestra -- devuelve null, lo que impide cualquier limpieza.
   * @returns {string|null}
   */
  extractManagedDriveFileId_(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    const patterns = [
      /^https:\/\/drive\.google\.com\/uc\?export=view&id=([^&]+)$/,
      /^https:\/\/drive\.google\.com\/thumbnail\?id=([^&]+)$/
    ];
    for (let i = 0; i < patterns.length; i++) {
      const match = patterns[i].exec(trimmed);
      if (match) return match[1];
    }
    return null;
  },

  /**
   * FASE 2: confirma que un fileId realmente pertenece a la carpeta
   * administrada (PRODUCT_IMAGES_FOLDER_ID) -- nunca se asume por el solo
   * formato de la URL que un archivo es "nuestro". Si el archivo no
   * existe, ya no es accesible, la propiedad todavía no está configurada,
   * o ocurre cualquier error al verificarlo, devuelve false: "no se puede
   * verificar" siempre significa "no tocar este archivo", nunca lo
   * contrario.
   * @returns {boolean}
   */
  isFileInManagedFolder_(fileId) {
    try {
      const folderId = PropertiesService.getScriptProperties().getProperty(PRODUCT_IMAGES_FOLDER_PROPERTY);
      if (!folderId) return false;

      const parents = DriveApp.getFileById(fileId).getParents();
      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) return true;
      }
      return false;
    } catch (e) {
      Logger.log(`[ProductsController] No se pudo verificar la carpeta del archivo ${fileId}: ${e.message}`);
      return false;
    }
  },

  /**
   * FASE 2: protección contra imágenes compartidas por accidente entre
   * productos -- confirma si algún OTRO producto (distinto de
   * excludeProductId) todavía referencia este mismo fileId en su
   * `imagen_url` antes de permitir enviarlo a la papelera.
   * @returns {boolean}
   */
  isFileStillReferencedByAnotherProduct_(fileId, excludeProductId) {
    const rows = DbHelper.getAllRows('Productos');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (excludeProductId && String(row.id) === String(excludeProductId)) continue;
      if (this.extractManagedDriveFileId_(row.imagen_url) === fileId) return true;
    }
    return false;
  },

  /**
   * FASE 3 (logo de empresa -- protección cruzada): la misma carpeta de
   * Drive ahora se comparte entre fotos de productos y el logo de la
   * empresa (hoja Configuracion, clave 'logoUrl'), así que antes de
   * enviar CUALQUIER archivo a la papelera hay que confirmar también que
   * no sea el logo actualmente configurado -- sin esta verificación,
   * reemplazar la foto de un producto podría borrar por accidente el
   * mismo archivo que la empresa usa hoy como logo (caso extremo, pero
   * real, dado que ambos comparten carpeta). Ante cualquier error al
   * consultar la configuración, se devuelve `true` (tratarlo como "en
   * uso") -- la misma regla de "no se puede verificar -> no se borra" que
   * ya rige `isFileInManagedFolder_`, aplicada aquí con la polaridad
   * inversa porque esta función responde "¿está en uso?", no "¿es
   * nuestro?".
   * @returns {boolean}
   */
  isFileCurrentlyTheCompanyLogo_(fileId) {
    try {
      const settings = SettingsController.handleGetSettings().settings;
      return this.extractManagedDriveFileId_(settings.logoUrl) === fileId;
    } catch (e) {
      Logger.log(`[ProductsController] No se pudo verificar si el archivo ${fileId} es el logo actual de la empresa: ${e.message}`);
      return true;
    }
  },

  /**
   * FASE 2 (ampliada en FASE 3 para proteger también el logo de empresa):
   * envía a la papelera (NUNCA borrado permanente -- `setTrashed`,
   * recuperable desde Drive) una imagen anterior, solo si pasa TODAS las
   * verificaciones de seguridad en orden:
   *   1. Es distinta de la URL que se conserva (si son iguales, no hay
   *      nada que limpiar).
   *   2. Es una URL de Drive reconocible como generada por nuestro
   *      sistema (extractManagedDriveFileId_) -- una URL externa, un
   *      Base64 histórico, o un formato de Drive ajeno nunca se tocan.
   *   3. El archivo realmente pertenece a PRODUCT_IMAGES_FOLDER_ID
   *      (isFileInManagedFolder_) -- nunca se asume por el formato de URL.
   *   4. Ningún otro producto sigue referenciando el mismo fileId
   *      (isFileStillReferencedByAnotherProduct_).
   *   5. El archivo no es el logo de la empresa actualmente configurado
   *      (isFileCurrentlyTheCompanyLogo_) -- protege el logo cuando esta
   *      función se llama desde la limpieza de fotos de productos, y
   *      viceversa protege fotos de productos cuando se llama desde la
   *      limpieza del logo (ver SettingsController.handleUpdateSettings).
   * Cualquier error, o cualquier verificación que no se pueda confirmar,
   * cancela la limpieza silenciosamente (solo se registra en el log) --
   * esta función NUNCA lanza un error hacia quien la llama, porque la
   * limpieza es siempre secundaria a la operación de guardado que la
   * invoca (ver handleSaveProduct y SettingsController.handleUpdateSettings,
   * CASO B y CASO C en ambos).
   */
  trashManagedImageIfSafe_(urlToTrash, urlToKeep, excludeProductId) {
    try {
      if (!urlToTrash || urlToTrash === urlToKeep) return;

      const fileId = this.extractManagedDriveFileId_(urlToTrash);
      if (!fileId) return;

      if (!this.isFileInManagedFolder_(fileId)) return;

      if (this.isFileStillReferencedByAnotherProduct_(fileId, excludeProductId)) return;

      if (this.isFileCurrentlyTheCompanyLogo_(fileId)) return;

      DriveApp.getFileById(fileId).setTrashed(true);
      Logger.log(`[ProductsController] Imagen anterior enviada a la papelera (fileId=${fileId}).`);
    } catch (e) {
      Logger.log(`[ProductsController] No se pudo limpiar una imagen anterior (${urlToTrash}): ${e.message}`);
      // Nunca relanzar -- ver contrato del método en el comentario de arriba.
    }
  },

  /**
   * FASE FINAL (multi-cuenta de fotos): función administrativa OPCIONAL
   * para verificar/inicializar explícitamente la configuración de Drive de
   * esta instalación (por ejemplo, justo después de copiar este proyecto de
   * Apps Script a una cuenta de Google nueva), sin depender de que alguien
   * suba una fotografía primero.
   *
   * No es parte del flujo HTTP (no tiene una acción en Main.gs/doPost) --
   * se ejecuta manualmente desde el editor de Apps Script (menú Ejecutar >
   * initializeProductImageStorage), igual que ya se hace hoy con
   * setSpreadsheetId() en Config.gs. No es obligatoria: la primera subida
   * real de una imagen (handleUploadImage -> getOrCreateProductImagesFolder)
   * ejecuta exactamente la misma resolución de forma automática y perezosa
   * si esta función nunca se corrió a mano.
   *
   * @returns {Object} Información clara de lo que se hizo/encontró.
   */
  initializeProductImageStorage() {
    const props = PropertiesService.getScriptProperties();
    const existingId = props.getProperty(PRODUCT_IMAGES_FOLDER_PROPERTY);

    const folder = this.getOrCreateProductImagesFolder();

    const result = {
      success: true,
      folderId: folder.getId(),
      folderName: folder.getName(),
      folderUrl: folder.getUrl(),
      wasAlreadyConfigured: !!existingId,
      message: existingId
        ? `Ya existía ${PRODUCT_IMAGES_FOLDER_PROPERTY}=${existingId} configurado para esta instalación; se verificó que sigue siendo accesible.`
        : `Instalación nueva: se configuró ${PRODUCT_IMAGES_FOLDER_PROPERTY}=${folder.getId()} (carpeta "${folder.getName()}").`
    };

    Logger.log(`[ProductsController.initializeProductImageStorage] ${JSON.stringify(result)}`);
    return result;
  }
};

/**
 * Wrapper de nivel superior para que `initializeProductImageStorage` sea
 * seleccionable en el menú Ejecutar del editor de Apps Script (el selector
 * de funciones de ese menú solo lista funciones globales, no métodos
 * dentro de un objeto como ProductsController) -- mismo patrón que ya usa
 * setSpreadsheetId() en Config.gs para configuración administrativa
 * ejecutada manualmente una vez por instalación.
 */
function initializeProductImageStorage() {
  return ProductsController.initializeProductImageStorage();
}
