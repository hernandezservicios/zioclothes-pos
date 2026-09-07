/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: ReturnsController.gs
 * Description: Customer return processing, stock reincorporation, Kardex logging, and cash refund handling.
 */

const ReturnsController = {
  /**
   * Returns list of processed customer returns.
   */
  handleListReturns(data) {
    const returnsList = DbHelper.getAllRows('Devoluciones');
    returnsList.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    return {
      success: true,
      returns: returnsList.map(r => {
        let items = [];
        try {
          items = r.items_json ? JSON.parse(r.items_json) : [];
        } catch (e) {
          items = [];
        }

        return {
          id: r.id,
          numeroDevolucion: r.numero_devolucion,
          ventaId: r.venta_id,
          numeroVenta: r.numero_venta,
          clienteId: r.cliente_id || undefined,
          clienteNombre: r.cliente_nombre || 'Cliente',
          items: items,
          montoDevuelto: Number(r.monto_devuelto) || 0,
          tipoReembolso: r.tipo_reembolso,
          motivo: r.motivo,
          usuarioId: r.usuario_id,
          usuarioNombre: r.usuario_nombre,
          fecha: r.fecha
        };
      })
    };
  },

  /**
   * FASE 3.6D (corrección de bloqueante P0): recalcula de forma
   * AUTORITATIVA el importe de cada línea de devolución a partir de lo
   * que realmente quedó registrado en `Venta_Items` para esa venta --
   * nunca del `item.total`/`subtotal`/`descuento`/`impuesto` que envíe el
   * cliente. Usar el precio/descuento/impuesto de la venta ORIGINAL (no
   * el precio actual de `Variantes`) es lo correcto contablemente: se
   * reembolsa lo que el cliente realmente pagó, no el precio de catálogo
   * de hoy (que pudo haber cambiado desde la venta).
   *
   * También valida que la cantidad devuelta no exceda la cantidad
   * vendida menos lo ya devuelto en devoluciones previas de esa misma
   * venta (evita devolver dos veces la misma mercancía).
   *
   * @returns {{ items: Array, totalRefund: number }}
   */
  recalculateReturnAuthoritatively(sale, data) {
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('VALIDATION_ERROR: Debe indicar al menos una prenda a devolver.');
    }

    const ventaItems = DbHelper.findRows('Venta_Items', vi => vi.venta_id === sale.id);
    const allVariants = DbHelper.getAllRows('Variantes');

    // Cantidad ya devuelta previamente, por variante, en devoluciones
    // anteriores de ESTA misma venta (recorre Devoluciones reales, no lo
    // que diga el cliente).
    const previousReturns = DbHelper.findRows('Devoluciones', r => r.venta_id === sale.id);
    const alreadyReturnedByVariant = {};
    previousReturns.forEach(r => {
      let prevItems = [];
      try {
        prevItems = r.items_json ? JSON.parse(r.items_json) : [];
      } catch (e) {
        prevItems = [];
      }
      prevItems.forEach(pi => {
        const vId = String(pi.varianteId || '').trim();
        alreadyReturnedByVariant[vId] = (alreadyReturnedByVariant[vId] || 0) + (Number(pi.cantidad) || 0);
      });
    });

    let totalRefund = 0;
    const computedItems = [];

    for (const item of data.items) {
      const varId = String(item.varianteId || '').trim();
      const variant = allVariants.find(v => v.id === varId);

      if (!variant) {
        throw new Error(`NOT_FOUND: La variante '${varId}' no existe en el catálogo.`);
      }

      const qty = Number(item.cantidad);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('VALIDATION_ERROR: La cantidad a devolver debe ser mayor a cero.');
      }

      // La línea DEBE existir en la venta original -- no se puede
      // devolver algo que esa venta nunca vendió.
      const originalItem = ventaItems.find(vi => vi.variante_id === varId);
      if (!originalItem) {
        throw new Error(`NOT_FOUND: La variante '${varId}' no forma parte de la venta ${sale.numero_venta}.`);
      }

      const cantidadVendida = Number(originalItem.cantidad) || 0;
      const yaDevuelta = alreadyReturnedByVariant[varId] || 0;
      const disponibleParaDevolver = cantidadVendida - yaDevuelta;

      if (qty > disponibleParaDevolver) {
        throw new Error(
          `DEVOLUCION_EXCEDE_CANTIDAD: No se puede devolver ${qty} unidad(es) de '${variant.sku}' -- vendidas: ${cantidadVendida}, ya devueltas: ${yaDevuelta}, disponible para devolver: ${Math.max(0, disponibleParaDevolver)}.`
        );
      }

      // Autoritativo: precio/descuento/impuesto de la línea ORIGINAL de
      // venta (lo que el cliente realmente pagó), prorrateado por unidad
      // -- nunca lo que envíe el cliente en esta petición de devolución.
      const precioUnitario = Number(originalItem.precio_unitario) || 0;
      const costoUnitario = Number(originalItem.costo_unitario) || 0;
      const descuentoUnitario = cantidadVendida > 0 ? (Number(originalItem.descuento_monto) || 0) / cantidadVendida : 0;
      const impuestoUnitario = cantidadVendida > 0 ? (Number(originalItem.impuesto_monto) || 0) / cantidadVendida : 0;

      const itemSubtotal = roundMoney(precioUnitario * qty);
      const itemDescuento = roundMoney(descuentoUnitario * qty);
      const itemImpuesto = roundMoney(impuestoUnitario * qty);
      const itemTotal = roundMoney(itemSubtotal - itemDescuento + itemImpuesto);

      totalRefund = roundMoney(totalRefund + itemTotal);

      computedItems.push({
        varianteId: varId,
        variant,
        productoId: variant.producto_id,
        nombreProducto: originalItem.nombre_producto || 'Prenda',
        sku: variant.sku,
        talla: variant.talla,
        color: variant.color,
        cantidad: qty,
        precioUnitario,
        costoUnitario,
        descuentoMonto: itemDescuento,
        impuestoMonto: itemImpuesto,
        subtotal: itemSubtotal,
        total: itemTotal
      });
    }

    return { items: computedItems, totalRefund };
  },

  /**
   * ATOMIC RETURN PROCESSING
   */
  handleCreateReturn(data, user) {
    Security.requirePermission(user, 'devoluciones.crear');

    if (!data.ventaId || !data.items || !Array.isArray(data.items) || data.items.length === 0 || !data.motivo) {
      throw new Error('VALIDATION_ERROR: Venta original, prendas a devolver y motivo son obligatorios.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();

      try {
        const sale = DbHelper.findById('Ventas', data.ventaId);
        if (!sale) throw new Error('NOT_FOUND: Venta original no encontrada.');

        if (sale.estado === 'ANULADA') {
          throw new Error('INVALID_STATE: No se puede procesar devolución de una venta que ya fue anulada.');
        }

        // Recalculo autoritativo (lanza NOT_FOUND/VALIDATION_ERROR/
        // DEVOLUCION_EXCEDE_CANTIDAD si algo no es válido) -- ANTES de
        // escribir nada, igual que en SalesController.
        const computed = this.recalculateReturnAuthoritatively(sale, data);

        const returnId = Sequences.getNext('DEV');
        const nowStr = getNowFormatted();
        const kardexToInsert = [];

        for (const ci of computed.items) {
          const variant = ci.variant;
          const varId = String(variant.id).trim();

          const oldStock = Number(variant.stock) || 0;
          const newStock = oldStock + ci.cantidad;

          DbHelper.recordUpdate(tx, 'Variantes', varId, { stock: oldStock });
          DbHelper.updateRowById('Variantes', varId, { stock: newStock });

          const movId = Sequences.getNext('MOV');
          const kardex = {
            id: movId,
            producto_id: variant.producto_id,
            producto_nombre: ci.nombreProducto,
            variante_id: varId,
            sku: variant.sku,
            talla: variant.talla,
            color: variant.color,
            cantidad: ci.cantidad,
            tipo: 'DEVOLUCION',
            stock_anterior: oldStock,
            stock_nuevo: newStock,
            motivo: `Devolución ${returnId} (Venta ${sale.numero_venta}): ${data.motivo}`,
            referencia: returnId,
            usuario_id: user ? user.id : 'USR-001',
            usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
            fecha: nowStr
          };
          kardexToInsert.push(kardex);
          DbHelper.recordInsert(tx, 'Inventario_Kardex', movId);
        }

        DbHelper.insertRows('Inventario_Kardex', kardexToInsert);

        // If cash refund and cash session open, update cash session
        const esReembolsoEfectivo = data.tipoReembolso === 'EFECTIVO';
        if (esReembolsoEfectivo) {
          const activeCash = DbHelper.findRows('Cajas', s => s.estado === 'ABIERTA')[0];
          if (activeCash) {
            const currentDevs = Number(activeCash.devoluciones_efectivo) || 0;
            DbHelper.recordUpdate(tx, 'Cajas', activeCash.id, { devoluciones_efectivo: currentDevs });
            DbHelper.updateRowById('Cajas', activeCash.id, {
              devoluciones_efectivo: currentDevs + computed.totalRefund
            });

            const cmovId = Sequences.getNext('CMOV');
            const cashMov = {
              id: cmovId,
              caja_sesion_id: activeCash.id,
              tipo: 'DEVOLUCION_EFECTIVO',
              monto: computed.totalRefund,
              motivo: `Reembolso por devolución ${returnId}`,
              categoria_gasto: '',
              referencia: returnId,
              usuario_id: user ? user.id : 'USR-001',
              usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
              fecha: nowStr,
              estado: 'ACTIVO'
            };
            DbHelper.insertRow('Caja_Movimientos', cashMov);
            DbHelper.recordInsert(tx, 'Caja_Movimientos', cmovId);
          }
        }

        // FASE 6 (créditos a favor / notas de crédito): si el reembolso
        // elegido es VALE_TIENDA o NOTA_CREDITO (o su valor histórico
        // equivalente CREDITO_CUENTA -- ver Parte 17 del reporte de esta
        // fase, compatibilidad sin romper datos existentes), se emite un
        // Crédito a Favor/Nota de Crédito real por el monto de la
        // devolución, DENTRO de esta misma transacción.
        //
        // Guarda deliberada: NO se emite si la venta original ya generó
        // una cuenta por cobrar (sale.cuenta_cobrar_id) -- en ese caso el
        // bloque de abajo YA reduce esa deuda por el mismo monto
        // devuelto (lógica preexistente, sin tocar); emitir además un
        // crédito nuevo duplicaría el beneficio para el cliente por la
        // misma devolución. Este caso límite (devolución de una venta A
        // CRÉDITO eligiendo específicamente "Vale"/"Nota de Crédito")
        // queda documentado como riesgo pendiente en el reporte -- no se
        // inventó una política de negocio para él.
        let creditoFavorEmitido = null;
        const esCreditoFavor = data.tipoReembolso === 'VALE_TIENDA';
        const esNotaCredito = data.tipoReembolso === 'NOTA_CREDITO' || data.tipoReembolso === 'CREDITO_CUENTA';
        if ((esCreditoFavor || esNotaCredito) && !sale.cuenta_cobrar_id) {
          creditoFavorEmitido = CreditNotesController.issueFromReturnWithinTx_(
            tx,
            esNotaCredito ? 'NOTA_CREDITO' : 'VALE_TIENDA',
            sale,
            returnId,
            computed.totalRefund,
            user
          );
        }

        // If the return corresponds to a credit sale, reduce the
        // outstanding credit balance proportionally (crédito real, no
        // inventado): solo si la venta generó una cuenta por cobrar.
        if (sale.cuenta_cobrar_id) {
          const credit = DbHelper.findById('Creditos', sale.cuenta_cobrar_id);
          if (credit && credit.estado !== 'PAGADA' && credit.estado !== 'ANULADA') {
            const reduccion = Math.min(computed.totalRefund, Number(credit.saldo_pendiente) || 0);
            if (reduccion > 0) {
              const nuevoSaldo = roundMoney((Number(credit.saldo_pendiente) || 0) - reduccion);
              DbHelper.recordUpdate(tx, 'Creditos', credit.id, {
                saldo_pendiente: credit.saldo_pendiente,
                estado: credit.estado
              });
              DbHelper.updateRowById('Creditos', credit.id, {
                saldo_pendiente: nuevoSaldo,
                estado: nuevoSaldo <= 0 ? 'PAGADA' : credit.estado
              });
            }
          }
        }

        // Insert Return record -- items_json guarda los importes YA
        // recalculados autoritativamente, nunca los del cliente.
        const returnRecord = {
          id: returnId,
          numero_devolucion: returnId,
          venta_id: sale.id,
          numero_venta: sale.numero_venta,
          cliente_id: sale.cliente_id || '',
          cliente_nombre: sale.cliente_nombre || 'Consumidor Final',
          items_json: JSON.stringify(computed.items.map(ci => ({
            varianteId: ci.varianteId,
            productoId: ci.productoId,
            nombreProducto: ci.nombreProducto,
            sku: ci.sku,
            talla: ci.talla,
            color: ci.color,
            cantidad: ci.cantidad,
            precioUnitario: ci.precioUnitario,
            costoUnitario: ci.costoUnitario,
            descuentoMonto: ci.descuentoMonto,
            impuestoMonto: ci.impuestoMonto,
            subtotal: ci.subtotal,
            total: ci.total
          }))),
          monto_devuelto: computed.totalRefund,
          tipo_reembolso: data.tipoReembolso || 'EFECTIVO',
          motivo: data.motivo.trim(),
          usuario_id: user ? user.id : 'USR-001',
          usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
          fecha: nowStr
        };

        DbHelper.insertRow('Devoluciones', returnRecord);
        DbHelper.recordInsert(tx, 'Devoluciones', returnId);

        // FIX (DEVUELTA_TOTAL incorrecto al devolver solo UNA línea de una
        // factura con varias): la comparación anterior determinaba el
        // estado sumando MONTOS, y tenía DOS problemas:
        //
        // 1) Doble conteo real: `DbHelper.insertRow('Devoluciones', ...)`
        //    de arriba ya escribe la fila en el Sheet -- un `findRows`
        //    posterior en la MISMA ejecución la ve de inmediato (DbHelper
        //    no cachea, lee el Sheet en vivo). El código anterior sumaba
        //    `findRows('Devoluciones', ...).reduce(...)` (que YA incluía
        //    esta devolución) y ADEMÁS `+ computed.totalRefund` -- el
        //    monto de esta misma devolución se contaba dos veces. Ejemplo
        //    exacto del reporte: venta de RD$640 con 2 prendas de RD$320
        //    c/u, se devuelve solo la primera (RD$320) -> el código viejo
        //    calculaba 320 (de la fila ya insertada) + 320
        //    (computed.totalRefund) = 640 >= sale.total(640) ->
        //    DEVUELTA_TOTAL, con la segunda prenda todavía sin devolver.
        //
        // 2) Frágil incluso sin el doble conteo: `Venta_Items.total` por
        //    línea nunca incluye el prorrateo de un descuento GLOBAL de la
        //    venta (solo el descuento por línea; ver
        //    SalesController.recalculateSaleAuthoritatively,
        //    descuentoGlobalAplicado nunca se distribuye a las líneas),
        //    así que la suma de los totales de línea puede exceder
        //    sale.total y disparar DEVUELTA_TOTAL antes de tiempo.
        //
        // Ahora el estado se determina por CANTIDADES, línea por línea:
        // DEVUELTA_TOTAL únicamente cuando, para CADA línea real de
        // Venta_Items, la cantidad devuelta acumulada (todas las
        // devoluciones reales de esta venta, incluida la que se acaba de
        // insertar arriba) alcanza la cantidad facturada de esa línea.
        // Si queda una sola unidad pendiente en cualquier línea, el
        // resultado es DEVUELTA_PARCIAL. Reutiliza el mismo patrón de
        // acumulación por variante que recalculateReturnAuthoritatively ya
        // usa para validar cantidades (alreadyReturnedByVariant), nunca
        // una segunda fórmula distinta.
        const allVentaItemsDeVenta = DbHelper.findRows('Venta_Items', vi => vi.venta_id === sale.id);
        const devolucionesDeVenta = DbHelper.findRows('Devoluciones', r => r.venta_id === sale.id);
        const cantidadDevueltaPorVariante = {};
        devolucionesDeVenta.forEach(r => {
          let prevItems = [];
          try {
            prevItems = r.items_json ? JSON.parse(r.items_json) : [];
          } catch (e) {
            prevItems = [];
          }
          prevItems.forEach(pi => {
            const vId = String(pi.varianteId || '').trim();
            cantidadDevueltaPorVariante[vId] = (cantidadDevueltaPorVariante[vId] || 0) + (Number(pi.cantidad) || 0);
          });
        });
        const todasLasLineasCompletamenteDevueltas = allVentaItemsDeVenta.length > 0 && allVentaItemsDeVenta.every(vi => {
          const vendida = Number(vi.cantidad) || 0;
          const devuelta = cantidadDevueltaPorVariante[String(vi.variante_id).trim()] || 0;
          return devuelta >= vendida;
        });
        const nuevoEstadoVenta = todasLasLineasCompletamenteDevueltas ? 'DEVUELTA_TOTAL' : 'DEVUELTA_PARCIAL';
        DbHelper.recordUpdate(tx, 'Ventas', sale.id, { estado: sale.estado });
        DbHelper.updateRowById('Ventas', sale.id, { estado: nuevoEstadoVenta });

        AuditController.log(
          user,
          'RETURN_PROCESSED',
          'VENTAS',
          'ReturnRecord',
          returnId,
          `Devolución ${returnId} por RD$${computed.totalRefund.toLocaleString()} procesada para venta ${sale.numero_venta}`
        );

        return {
          success: true,
          message: `Devolución ${returnId} procesada exitosamente por RD$${computed.totalRefund.toLocaleString()}.`,
          devolucionId: returnId,
          montoDevuelto: computed.totalRefund,
          creditoFavorEmitido: creditoFavorEmitido || undefined
        };

      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  }
};
