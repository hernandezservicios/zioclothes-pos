/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: PurchasesController.gs
 * Description: Merchandise supplier purchases, inventory reception, and atomic stock increment.
 */

const PurchasesController = {
  /**
   * Returns list of merchandise purchases.
   */
  handleListPurchases(data) {
    const purchases = DbHelper.getAllRows('Compras');
    purchases.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    return {
      success: true,
      purchases: purchases.map(p => {
        let items = [];
        try {
          items = p.items_json ? JSON.parse(p.items_json) : [];
        } catch (e) {
          items = [];
        }

        return {
          id: p.id,
          numeroCompra: p.numero_compra,
          proveedorId: p.proveedor_id || undefined,
          proveedor: p.proveedor,
          numeroFacturaProveedor: p.numero_factura_proveedor || '',
          items: items,
          total: Number(p.total) || 0,
          formaPago: p.forma_pago,
          estado: p.estado,
          usuarioId: p.usuario_id,
          usuarioNombre: p.usuario_nombre,
          fecha: p.fecha,
          notas: p.notas || ''
        };
      })
    };
  },

  /**
   * FASE 3.7D (hallazgo P0 confirmado por auditoría): el código original
   * escribía `total: Number(data.total) || 0` directamente -- el cliente
   * podía declarar cualquier total sin que el backend lo verificara contra
   * los items reales (ej. cantidad:100 x costoUnitario:10 pero
   * total:10). Este método recalcula el total AUTORITATIVAMENTE a partir
   * de cantidad x costoUnitario por línea.
   *
   * División de autoridad (Sección 4/5 del encargo): `costoUnitario` por
   * línea SÍ es un dato base legítimo que el cliente propone (el costo
   * negociado con el proveedor -- no existe un "costo real" alternativo
   * en el catálogo contra el cual validarlo, a diferencia del precio de
   * venta). Pero el TOTAL de cada línea y el total general NUNCA son
   * responsabilidad del cliente: siempre se calculan aquí, y se rechaza
   * la compra completa si el total declarado no coincide (protege contra
   * un frontend con un bug de cálculo, no solo contra manipulación
   * deliberada).
   *
   * NOTA IMPORTANTE (Sección 3/8 del encargo -- "REGLA DE COSTO NO
   * DEFINIDA"): este método NO actualiza `Variantes.costo`. Se auditó
   * exhaustivamente el sistema real (SalesController, InventoryController,
   * DATABASE.md, y todo el código fuente) y se confirmó que NO existe
   * ninguna fórmula de costo promedio ponderado, ni ningún campo
   * `costo_promedio`, en ninguna parte del sistema -- `Variantes.costo` es
   * un valor simple y estático que SalesController toma tal cual al
   * momento de la venta (ver SalesController.gs línea ~161:
   * `costoReal = Number(variant.costo) || 0`), y que hoy solo se escribe
   * desde ProductsController.handleSaveProduct (edición manual del
   * producto). No existe ninguna regla definida de cómo una compra
   * debería modificar ese costo (¿reemplazarlo? ¿promediarlo? ¿con qué
   * ventana?). Implementar una fórmula aquí sería inventar una regla de
   * negocio financiera no autorizada. Esta fase deja `Variantes.costo`
   * exactamente como estaba (sin tocar), documentado explícitamente en el
   * reporte de esta fase como bloqueo real, no como omisión accidental.
   */
  recalculatePurchaseAuthoritatively(data) {
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('VALIDATION_ERROR: Debe incluir al menos un ítem de compra.');
    }

    const allVariants = DbHelper.getAllRows('Variantes');
    let totalCalculado = 0;
    const computedItems = [];

    for (const item of data.items) {
      const varId = String(item.varianteId || '').trim();
      const variant = allVariants.find(v => v.id === varId);
      if (!variant) throw new Error(`NOT_FOUND: La variante '${item.varianteId}' no existe en el catálogo.`);
      if (variant.estado !== 'ACTIVO') {
        throw new Error(`VALIDATION_ERROR: La variante '${variant.sku}' está inactiva y no puede recibir mercancía.`);
      }

      const cantidad = Number(item.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new Error('VALIDATION_ERROR: La cantidad a recibir debe ser un número mayor que cero.');
      }

      const costoUnitario = Number(item.costoUnitario);
      if (!Number.isFinite(costoUnitario) || costoUnitario <= 0) {
        throw new Error('VALIDATION_ERROR: El costo unitario debe ser un número mayor que cero.');
      }

      const itemTotal = roundMoney(cantidad * costoUnitario);
      totalCalculado = roundMoney(totalCalculado + itemTotal);

      computedItems.push({
        varianteId: varId,
        variant: variant,
        productoId: variant.producto_id,
        nombreProducto: item.nombreProducto || 'Prenda',
        sku: variant.sku,
        talla: variant.talla,
        color: variant.color,
        cantidad: cantidad,
        costoUnitario: costoUnitario,
        total: itemTotal
      });
    }

    // Tolerancia de RD$1 por acumulación de redondeo entre líneas, no para
    // tolerar manipulación real.
    const totalEnviado = Number(data.total);
    if (!Number.isFinite(totalEnviado) || Math.abs(totalEnviado - totalCalculado) > 1) {
      throw new Error(
        `PURCHASE_TOTAL_MISMATCH: El total enviado (RD$${Number.isFinite(totalEnviado) ? totalEnviado.toLocaleString() : 'inválido'}) no coincide con el total calculado por el servidor a partir de cantidad x costo unitario por línea (RD$${totalCalculado.toLocaleString()}). Compra rechazada.`
      );
    }

    return { items: computedItems, total: totalCalculado };
  },

  /**
   * ATOMIC PURCHASE CREATION
   * Increments variant stock, adds Kardex entries, inserts Purchase record.
   */
  handleCreatePurchase(data, user) {
    Security.requirePermission(user, 'compras.crear');

    if (!data.proveedor) {
      throw new Error('VALIDATION_ERROR: Proveedor es obligatorio.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();

      try {
        // Recálculo autoritativo (lanza VALIDATION_ERROR/NOT_FOUND/
        // PURCHASE_TOTAL_MISMATCH si algo no es válido) -- nunca confía en
        // el total ni en el stock resultante que hubiera enviado el cliente.
        const computed = this.recalculatePurchaseAuthoritatively(data);

        const purchaseId = Sequences.getNext('COM');
        const nowStr = getNowFormatted();
        const kardexToInsert = [];

        for (const ci of computed.items) {
          const oldStock = Number(ci.variant.stock) || 0;
          const newStock = oldStock + ci.cantidad;

          // Record update for compensation
          DbHelper.recordUpdate(tx, 'Variantes', ci.varianteId, { stock: oldStock });
          DbHelper.updateRowById('Variantes', ci.varianteId, { stock: newStock });

          const movId = Sequences.getNext('MOV');
          kardexToInsert.push({
            id: movId,
            producto_id: ci.productoId,
            producto_nombre: ci.nombreProducto,
            variante_id: ci.varianteId,
            sku: ci.sku,
            talla: ci.talla,
            color: ci.color,
            cantidad: ci.cantidad,
            tipo: 'COMPRA',
            stock_anterior: oldStock,
            stock_nuevo: newStock,
            motivo: `Recepción compra ${purchaseId} (${data.proveedor})`,
            referencia: purchaseId,
            usuario_id: user ? user.id : 'USR-001',
            usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
            fecha: nowStr
          });
          DbHelper.recordInsert(tx, 'Inventario_Kardex', movId);
        }

        DbHelper.insertRows('Inventario_Kardex', kardexToInsert);

        const purchaseRecord = {
          id: purchaseId,
          numero_compra: purchaseId,
          proveedor_id: data.proveedorId || '',
          proveedor: data.proveedor.trim(),
          numero_factura_proveedor: (data.numeroFacturaProveedor || '').trim(),
          items_json: JSON.stringify(computed.items.map(ci => ({
            varianteId: ci.varianteId,
            productoId: ci.productoId,
            nombreProducto: ci.nombreProducto,
            sku: ci.sku,
            talla: ci.talla,
            color: ci.color,
            cantidad: ci.cantidad,
            costoUnitario: ci.costoUnitario,
            total: ci.total
          }))),
          total: computed.total,
          forma_pago: data.formaPago || 'TRANSFERENCIA',
          estado: 'RECIBIDA',
          usuario_id: user ? user.id : 'USR-001',
          usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Usuario',
          fecha: nowStr,
          notas: (data.notas || '').trim()
        };

        DbHelper.insertRow('Compras', purchaseRecord);
        DbHelper.recordInsert(tx, 'Compras', purchaseId);

        AuditController.log(
          user,
          'PURCHASE_CREATED',
          'COMPRAS',
          'Purchase',
          purchaseId,
          `Compra ${purchaseId} de RD$${computed.total.toLocaleString()} recibida de ${data.proveedor} (autoritativo, recalculado server-side)`
        );

        return {
          success: true,
          message: `Compra ${purchaseId} registrada y existencias incrementadas.`,
          compraId: purchaseId,
          total: computed.total
        };

      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  }
};
