/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: InventoryController.gs
 * Description: Real-time stock adjustments, Kardex movement history, and inventory auditing.
 */

const InventoryController = {
  /**
   * Performs an atomic, delta-based stock adjustment on a variant.
   *
   * FASE 3.7C (hallazgo durante la integración real de inventory.adjust):
   * el contrato original recibía {varianteId, nuevoStock, motivo} -- un
   * valor de stock ABSOLUTO decidido en el cliente. Bajo ese contrato, dos
   * ajustes concurrentes calculados sobre la misma lectura de stock
   * desactualizada se pisan entre sí en vez de componerse: si el stock
   * real es 10 y un cajero intenta "+5" (nuevoStock=15) mientras otro
   * intenta "-3" (nuevoStock=7) casi al mismo tiempo, el que el
   * LockService procese en segundo lugar SOBRESCRIBE por completo el
   * resultado del primero (7 o 15), en vez del resultado correcto (12).
   * El LockService por sí solo no resuelve esto: serializa el ACCESO, pero
   * no corrige que el valor absoluto ya viene calculado con datos
   * obsoletos.
   *
   * El nuevo contrato es delta-based: {varianteId, cantidadAjuste, tipo,
   * motivo}. El backend SIEMPRE calcula `nuevoStock = stockActual +
   * cantidadAjuste` a partir del stock real leído dentro del lock -- nunca
   * confía en un stock absoluto enviado por el cliente. Los deltas se
   * componen correctamente sin importar el orden de ejecución
   * (10 + 5 - 3 = 12 siempre). Este contrato coincide además con el flujo
   * que ya construía InventoryView.tsx (tipo de operación + cantidad),
   * nunca conectado antes a este endpoint real.
   *
   * `tipo` acepta 'ENTRADA' | 'SALIDA' | 'AJUSTE' -- los mismos valores
   * que ya ofrecía el selector de InventoryView y el filtro de su propio
   * Kardex (antes nunca coincidían con nada real, porque este endpoint
   * siempre grababa 'AJUSTE' sin importar el tipo elegido).
   */
  handleAdjustStock(data, user) {
    Security.requirePermission(user, 'inventario.ajustar');

    const VALID_TIPOS = ['ENTRADA', 'SALIDA', 'AJUSTE'];
    if (!data.varianteId || data.cantidadAjuste === undefined || !data.motivo || VALID_TIPOS.indexOf(data.tipo) === -1) {
      throw new Error("VALIDATION_ERROR: Variante, cantidad de ajuste, tipo ('ENTRADA'/'SALIDA'/'AJUSTE') y motivo son requeridos.");
    }

    const cantidadAjuste = Number(data.cantidadAjuste);
    if (!Number.isFinite(cantidadAjuste) || cantidadAjuste === 0) {
      throw new Error('VALIDATION_ERROR: La cantidad de ajuste debe ser un número distinto de cero.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();
      try {
        const variant = DbHelper.findById('Variantes', data.varianteId);
        if (!variant) throw new Error('NOT_FOUND: Variante no encontrada.');
        if (variant.estado !== 'ACTIVO') {
          throw new Error('VALIDATION_ERROR: No se puede ajustar el stock de una variante inactiva.');
        }

        const product = DbHelper.findById('Productos', variant.producto_id);
        const prodName = product ? product.nombre : 'Prenda';
        const stockAnterior = Number(variant.stock) || 0;
        const nuevoStock = stockAnterior + cantidadAjuste;

        if (nuevoStock < 0) {
          throw new Error(
            `STOCK_INSUFICIENTE: El ajuste dejaría el stock en negativo (actual: ${stockAnterior}, ajuste: ${cantidadAjuste > 0 ? '+' : ''}${cantidadAjuste}).`
          );
        }

        DbHelper.recordUpdate(tx, 'Variantes', variant.id, { stock: stockAnterior });
        DbHelper.updateRowById('Variantes', variant.id, { stock: nuevoStock });

        const movId = Sequences.getNext('MOV');
        const nowStr = getNowFormatted();

        DbHelper.insertRow('Inventario_Kardex', {
          id: movId,
          producto_id: variant.producto_id,
          producto_nombre: prodName,
          variante_id: variant.id,
          sku: variant.sku,
          talla: variant.talla,
          color: variant.color,
          cantidad: cantidadAjuste,
          tipo: data.tipo,
          stock_anterior: stockAnterior,
          stock_nuevo: nuevoStock,
          motivo: data.motivo.trim(),
          referencia: data.referencia || 'Ajuste Manual',
          usuario_id: user ? user.id : 'USR-001',
          usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
          fecha: nowStr
        });
        DbHelper.recordInsert(tx, 'Inventario_Kardex', movId);

        AuditController.log(
          user,
          'STOCK_ADJUSTED',
          'INVENTARIO',
          'ProductVariant',
          variant.id,
          `Ajuste de stock (${data.tipo}) en ${prodName} (${variant.talla}/${variant.color}): ${stockAnterior} -> ${nuevoStock} (${cantidadAjuste > 0 ? '+' : ''}${cantidadAjuste}). Motivo: ${data.motivo.trim()}`
        );

        return {
          success: true,
          message: `Stock ajustado exitosamente de ${stockAnterior} a ${nuevoStock} unidades.`,
          varianteId: variant.id,
          stockAnterior: stockAnterior,
          nuevoStock: nuevoStock
        };
      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  },

  /**
   * Returns complete Kardex movement history.
   */
  handleGetKardex(data) {
    const limit = (data && data.limit) ? Number(data.limit) : 500;
    const all = DbHelper.getAllRows('Inventario_Kardex');

    all.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    const paged = all.slice(0, limit);

    return {
      success: true,
      movements: paged.map(m => ({
        id: m.id,
        productoId: m.producto_id,
        productoNombre: m.producto_nombre,
        varianteId: m.variante_id,
        sku: m.sku,
        talla: m.talla,
        color: m.color,
        cantidad: Number(m.cantidad) || 0,
        tipo: m.tipo,
        stockAnterior: Number(m.stock_anterior) || 0,
        stockNuevo: Number(m.stock_nuevo) || 0,
        motivo: m.motivo,
        referencia: m.referencia || '',
        usuarioId: m.usuario_id,
        usuarioNombre: m.usuario_nombre,
        fecha: m.fecha
      }))
    };
  }
};
