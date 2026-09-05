/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: ProductsController.gs
 * Description: Management of products, garment variants (size/color/SKU/barcode/stock),
 * categories, sizes, colors, and suppliers.
 */

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
  }
};
