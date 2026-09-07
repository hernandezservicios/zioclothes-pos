/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: SalesController.gs
 * Description: Mission-critical POS sales transactions, atomic stock deduction, credit limit validation,
 * Kardex updates, cash register synchronization, and compensating rollback engine.
 */

const SalesController = {
  /**
   * Returns list of sales enriched with item details.
   */
  handleListSales(data) {
    const sales = DbHelper.getAllRows('Ventas');
    const items = DbHelper.getAllRows('Venta_Items');

    const itemsBySale = {};
    items.forEach(it => {
      const vId = String(it.venta_id).trim();
      if (!itemsBySale[vId]) itemsBySale[vId] = [];
      itemsBySale[vId].push({
        id: it.id,
        productoId: it.producto_id,
        varianteId: it.variante_id,
        nombreProducto: it.nombre_producto,
        sku: it.sku,
        talla: it.talla,
        color: it.color,
        cantidad: Number(it.cantidad) || 0,
        costoUnitario: Number(it.costo_unitario) || 0,
        precioUnitario: Number(it.precio_unitario) || 0,
        descuentoPorcentaje: Number(it.descuento_porcentaje) || 0,
        descuentoMonto: Number(it.descuento_monto) || 0,
        subtotal: Number(it.subtotal) || 0,
        impuestoMonto: Number(it.impuesto_monto) || 0,
        total: Number(it.total) || 0
      });
    });

    const enriched = sales.map(s => {
      const sId = String(s.id).trim();
      let pagos = [];
      try {
        pagos = s.pagos_json ? JSON.parse(s.pagos_json) : [];
      } catch (e) {
        pagos = [];
      }

      return {
        id: s.id,
        numeroVenta: s.numero_venta,
        clienteId: s.cliente_id || undefined,
        clienteNombre: s.cliente_nombre || 'Consumidor Final',
        clienteDocumento: s.cliente_documento || '',
        vendedorId: s.vendedor_id,
        vendedorNombre: s.vendedor_nombre,
        cajaSesionId: s.caja_sesion_id || undefined,
        subtotal: Number(s.subtotal) || 0,
        descuentoTotal: Number(s.descuento_total) || 0,
        impuestoTotal: Number(s.impuesto_total) || 0,
        total: Number(s.total) || 0,
        costoTotal: Number(s.costo_total) || 0,
        metodoPago: s.metodo_pago,
        pagos: pagos,
        efectivoRecibido: s.efectivo_recibido ? Number(s.efectivo_recibido) : undefined,
        cambioEntregado: s.cambio_entregado ? Number(s.cambio_entregado) : undefined,
        esCredito: s.es_credito === true || s.es_credito === 'TRUE' || s.es_credito === 'true',
        montoFinanciado: s.monto_financiado ? Number(s.monto_financiado) : undefined,
        cuentaCobrarId: s.cuenta_cobrar_id || undefined,
        estado: s.estado,
        motivoAnulacion: s.motivo_anulacion || undefined,
        anuladaPor: s.anulada_por || undefined,
        // FASE 3.7A: handleVoidSale ya escribía fecha_anulacion en Ventas,
        // pero sales.list no la exponía -- el tipo Sale del frontend ya
        // declaraba fechaAnulacion? desde antes. Se agrega para que el
        // contrato sea consistente con lo que el backend realmente
        // persiste (sin esto, SalesView no podría mostrar cuándo se anuló
        // una venta sin inventar el dato).
        fechaAnulacion: s.fecha_anulacion || undefined,
        fecha: s.fecha,
        items: itemsBySale[sId] || []
      };
    });

    // Sort descending by date
    enriched.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    return {
      success: true,
      sales: enriched
    };
  },

  /**
   * FASE 3.6 (corrección de bloqueante crítico): recalcula de forma
   * AUTORITATIVA el precio, costo, descuento (con tope real por producto),
   * impuesto y total de cada renglón -- directamente desde `Productos` y
   * `Variantes` del Spreadsheet, ignorando el precio/costo que haya
   * enviado el cliente. El navegador nunca es la fuente de verdad del
   * precio.
   *
   * Reglas aplicadas (todas verificadas en datos reales existentes, no
   * inventadas):
   *   - precioUnitario / costoUnitario: SIEMPRE variante.precio / .costo.
   *   - descuentoPorcentaje solicitado por línea: se acepta como
   *     discreción del cajero, pero JAMÁS por encima de
   *     producto.descuento_maximo (rechaza si lo excede).
   *   - impuestoMonto: base imponible (subtotal - descuento) por
   *     producto.impuesto, solo si data.aplicarImpuesto !== false.
   *   - Descuento global de orden (Parte del POS que reduce el total
   *     completo, no ligado a un producto): se acepta como discreción
   *     adicional del cajero, pero nunca puede exceder el subtotal ya
   *     recalculado (no puede llevar el total por debajo de cero).
   *
   * @returns {{subtotal, descuentoItems, descuentoGlobal, descuentoTotal,
   *            impuestoTotal, total, items: Array}}
   */
  recalculateSaleAuthoritatively(data) {
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('VALIDATION_ERROR: La venta debe contener al menos una prenda.');
    }

    const allVariants = DbHelper.getAllRows('Variantes');
    const allProducts = DbHelper.getAllRows('Productos');
    const aplicarImpuesto = data.aplicarImpuesto !== false;

    let subtotalCalculado = 0;
    let descuentoItemsCalculado = 0;
    let impuestoCalculado = 0;
    const computedItems = [];

    for (const item of data.items) {
      const varId = String(item.varianteId || '').trim();
      const variant = allVariants.find(v => String(v.id).trim() === varId);

      if (!variant) {
        throw new Error(`STOCK_ERROR: La variante '${item.nombreProducto || varId}' no existe en el catálogo.`);
      }
      if (String(variant.estado || '').toUpperCase() !== 'ACTIVO') {
        throw new Error(`STOCK_ERROR: La variante '${item.nombreProducto || varId}' (${variant.talla}/${variant.color}) no está activa para la venta.`);
      }

      const product = allProducts.find(p => String(p.id).trim() === String(variant.producto_id).trim());
      if (!product) {
        throw new Error(`STOCK_ERROR: El producto asociado a la variante '${varId}' no existe.`);
      }

      const cantidad = Number(item.cantidad) || 0;
      if (cantidad <= 0) {
        throw new Error(`VALIDATION_ERROR: La cantidad para '${item.nombreProducto}' debe ser mayor que 0.`);
      }

      const currentStock = Number(variant.stock) || 0;
      if (currentStock < cantidad) {
        throw new Error(
          `STOCK_INSUFICIENTE: Stock insuficiente para '${item.nombreProducto}' (${variant.talla}/${variant.color}). Disponible: ${currentStock}, Solicitado: ${cantidad}.`
        );
      }

      // Autoritativo: SIEMPRE del Spreadsheet, nunca de lo que mandó el cliente.
      const precioReal = Number(variant.precio) || 0;
      const costoReal = Number(variant.costo) || 0;
      const itemSubtotal = roundMoney(precioReal * cantidad);

      const maxDescuentoPct = Number(product.descuento_maximo) || 0;
      let descuentoPctSolicitado = Number(item.descuentoPorcentaje) || 0;
      if (!descuentoPctSolicitado && item.descuentoMonto) {
        descuentoPctSolicitado = itemSubtotal > 0 ? (Number(item.descuentoMonto) / itemSubtotal) * 100 : 0;
      }
      if (descuentoPctSolicitado > maxDescuentoPct) {
        throw new Error(
          `DISCOUNT_EXCEEDS_MAXIMUM: El descuento solicitado (${descuentoPctSolicitado.toFixed(2)}%) para '${item.nombreProducto}' excede el máximo autorizado para ese producto (${maxDescuentoPct}%).`
        );
      }
      const descuentoPctAplicado = Math.max(0, Math.min(descuentoPctSolicitado, 100));
      const itemDescuento = roundMoney(itemSubtotal * (descuentoPctAplicado / 100));

      const baseImponible = itemSubtotal - itemDescuento;
      const tasaImpuesto = aplicarImpuesto ? (Number(product.impuesto) || 0) : 0;
      const itemImpuesto = roundMoney(baseImponible * (tasaImpuesto / 100));
      const itemTotal = roundMoney(baseImponible + itemImpuesto);

      subtotalCalculado = roundMoney(subtotalCalculado + itemSubtotal);
      descuentoItemsCalculado = roundMoney(descuentoItemsCalculado + itemDescuento);
      impuestoCalculado = roundMoney(impuestoCalculado + itemImpuesto);

      computedItems.push({
        raw: item,
        variant,
        product,
        cantidad,
        precioUnitario: precioReal,
        costoUnitario: costoReal,
        descuentoPorcentaje: descuentoPctAplicado,
        descuentoMonto: itemDescuento,
        subtotal: itemSubtotal,
        impuestoMonto: itemImpuesto,
        total: itemTotal
      });
    }

    // Descuento GLOBAL de orden (aplicado por el cajero sobre el total, no
    // ligado a un producto en particular -- no existe una regla de tope
    // por-producto que aplique aquí). Se toma como la diferencia entre lo
    // que el cliente declaró como descuentoTotal de la venta y lo que ya
    // se validó por línea, acotado para que nunca exceda el subtotal ya
    // recalculado (no puede dejar la venta en negativo).
    const descuentoTotalSolicitado = Number(data.descuentoTotal) || 0;
    const descuentoGlobalSolicitado = Math.max(0, descuentoTotalSolicitado - descuentoItemsCalculado);
    const descuentoGlobalAplicado = Math.max(
      0,
      Math.min(descuentoGlobalSolicitado, roundMoney(subtotalCalculado - descuentoItemsCalculado))
    );

    const descuentoTotalCalculado = roundMoney(descuentoItemsCalculado + descuentoGlobalAplicado);
    const totalCalculado = roundMoney(subtotalCalculado - descuentoTotalCalculado + impuestoCalculado);

    // El total enviado por el cliente es solo dato auxiliar para detectar
    // inconsistencias -- NUNCA la fuente de verdad. Tolerancia de RD$1 por
    // acumulación de redondeo entre líneas, no para tolerar manipulación.
    const totalEnviado = Number(data.total);
    if (!Number.isFinite(totalEnviado) || Math.abs(totalEnviado - totalCalculado) > 1) {
      throw new Error(
        `PRICE_MISMATCH: El total enviado (RD$${Number.isFinite(totalEnviado) ? totalEnviado.toLocaleString() : 'inválido'}) no coincide con el total calculado por el servidor a partir del catálogo real (RD$${totalCalculado.toLocaleString()}). Venta rechazada.`
      );
    }

    return {
      subtotal: subtotalCalculado,
      descuentoTotal: descuentoTotalCalculado,
      impuestoTotal: impuestoCalculado,
      total: totalCalculado,
      items: computedItems
    };
  },

  /**
   * ATOMIC SALE TRANSACTION
   * 1. LockService
   * 2. Recalcular precio/descuento/impuesto/total AUTORITATIVAMENTE
   *    (recalculateSaleAuthoritatively) y validar stock
   * 3. If credit sale, validate customer limit
   * 4. Generate sale sequential number
   * 5. Insert Sale & Sale_Items
   * 6. Deduct stock in Variantes
   * 7. Record Kardex movement
   * 8. If credit, insert into Creditos
   * 9. If cash, update Cajas & Caja_Movimientos
   * 10. Audit log
   * If any step fails, compensation rollback is guaranteed.
   */
  handleCreateSale(data, user) {
    Security.requirePermission(user, 'ventas.crear');

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();

      try {
        // Steps 1-2: recálculo autoritativo de precio/descuento/impuesto/
        // total (lanza STOCK_ERROR/STOCK_INSUFICIENTE/DISCOUNT_EXCEEDS_
        // MAXIMUM/PRICE_MISMATCH si algo no es válido) + stock ya validado
        // contra Variantes real dentro del mismo recálculo.
        const computed = this.recalculateSaleAuthoritatively(data);
        const allVariants = computed.items.map(ci => ci.variant);

        // Validación adicional contra manipulación, ANTES de escribir nada:
        // la SUMA del desglose de pagos (data.pagos) debe cubrir el total
        // autoritativo -- si no, el cliente podría declarar un total
        // correcto pero un desglose de pagos que en realidad no lo cubre.
        if (Array.isArray(data.pagos) && data.pagos.length > 0) {
          const sumaPagos = roundMoney(data.pagos.reduce((sum, p) => sum + (Number(p.monto) || 0), 0));
          if (Math.abs(sumaPagos - computed.total) > 1) {
            throw new Error(
              `PRICE_MISMATCH: La suma de los pagos declarados (RD$${sumaPagos.toLocaleString()}) no cubre el total calculado por el servidor (RD$${computed.total.toLocaleString()}). Venta rechazada.`
            );
          }
        }

        // FASE 7 (Parte 3/17 -- hallazgo de auditoría, "nunca confiar en lo
        // que declara el frontend"): un pago con metodo 'CREDITO_FAVOR'
        // dentro de data.pagos es SOLO una etiqueta declarativa para que
        // sumaPagos cuadre con el total -- lo que REALMENTE descuenta el
        // saldo del crédito es data.creditoFavorAplicado.monto (ver Step
        // "creditoFavorAplicado" más abajo). Si ambos números no
        // coincidieran, un cliente malicioso podría declarar que pagó con
        // crédito para cuadrar sumaPagos, sin que el backend en realidad
        // descontara ningún saldo (fuga de mercancía), o declarar un pago
        // en efectivo que oculta una aplicación de crédito adicional no
        // reflejada en el total. Se exige que ambos existan y coincidan
        // exactamente (tolerancia RD$1 por redondeo).
        const pagosCreditoFavor = Array.isArray(data.pagos)
          ? roundMoney(data.pagos.filter(p => p.metodo === 'CREDITO_FAVOR').reduce((sum, p) => sum + (Number(p.monto) || 0), 0))
          : 0;
        const creditoFavorMontoSolicitado = (data.creditoFavorAplicado && data.creditoFavorAplicado.id)
          ? roundMoney(Number(data.creditoFavorAplicado.monto) || 0)
          : 0;
        if (pagosCreditoFavor > 0 || creditoFavorMontoSolicitado > 0) {
          if (!data.creditoFavorAplicado || !data.creditoFavorAplicado.id || creditoFavorMontoSolicitado <= 0) {
            throw new Error(
              'VALIDATION_ERROR: Se declaró un pago con método CREDITO_FAVOR sin especificar un creditoFavorAplicado.id/monto válido.'
            );
          }
          if (Math.abs(pagosCreditoFavor - creditoFavorMontoSolicitado) > 1) {
            throw new Error(
              `PRICE_MISMATCH: El monto declarado en pagos con método CREDITO_FAVOR (RD$${pagosCreditoFavor.toLocaleString()}) no coincide con el monto de creditoFavorAplicado (RD$${creditoFavorMontoSolicitado.toLocaleString()}).`
            );
          }
        }

        // Step 3: Validate customer credit limit if applicable
        const esCredito = data.esCredito === true || data.metodoPago === 'CREDITO';
        let customer = null;
        let creditId = '';
        // Declarado en este scope (no dentro del if) porque se usa más
        // abajo, tanto al insertar la venta como al crear el crédito.
        let nuevoMontoFinanciado = 0;

        if (esCredito) {
          if (!data.clienteId) {
            throw new Error('CREDIT_ERROR: Las ventas a crédito requieren seleccionar un cliente registrado.');
          }

          customer = DbHelper.findById('Clientes', data.clienteId);
          if (!customer || customer.estado !== 'ACTIVO') {
            throw new Error('CREDIT_ERROR: El cliente no existe o se encuentra inactivo.');
          }

          const activeCredits = DbHelper.findRows('Creditos', c =>
            c.cliente_id === data.clienteId && c.estado !== 'PAGADA' && c.estado !== 'ANULADA'
          );
          const currentDebt = activeCredits.reduce((sum, c) => sum + (Number(c.saldo_pendiente) || 0), 0);
          const limit = Number(customer.limite_credito) || 0;
          // El monto financiado nunca puede exceder el total ya recalculado
          // por el servidor -- si el cliente pidiera financiar más que el
          // total real de la venta, se acota al total.
          nuevoMontoFinanciado = Math.min(Number(data.montoFinanciado) || computed.total, computed.total);

          if (currentDebt + nuevoMontoFinanciado > limit) {
            const disp = Math.max(0, limit - currentDebt);
            throw new Error(
              `LIMITE_CREDITO_EXCEDIDO: Crédito disponible insuficiente para ${customer.nombre}. Disponible: RD$${disp.toLocaleString()}, Intentado: RD$${nuevoMontoFinanciado.toLocaleString()}.`
            );
          }
        } else if (creditoFavorMontoSolicitado > 0) {
          // FASE 7 (Parte 31 -- nunca confiar en cliente_id enviado por el
          // frontend): si la venta no es a cuenta por cobrar pero SÍ
          // consume un Crédito a Favor/Nota de Crédito, igual se relee y
          // valida el cliente real (existente y activo) -- antes solo se
          // hacía esta verificación cuando esCredito era true, dejando sin
          // validar la existencia real del cliente en el resto de los
          // casos (la pertenencia del crédito ya se valida aparte dentro
          // de applyToSaleWithinTx_, pero esto cierra el hueco de un
          // clienteId que coincida por casualidad sin ser un cliente real).
          if (!data.clienteId) {
            throw new Error(
              'CLIENTE_REQUERIDO: Para aplicar un Crédito a Favor/Nota de Crédito la venta debe tener un cliente registrado.'
            );
          }
          customer = DbHelper.findById('Clientes', data.clienteId);
          if (!customer || customer.estado !== 'ACTIVO') {
            throw new Error('CREDIT_ERROR: El cliente no existe o se encuentra inactivo.');
          }
        }

        // Step 4: Generate sequential numbers
        const saleId = Sequences.getNext('VEN');
        const numeroVenta = saleId;
        const nowStr = getNowFormatted();
        const costoTotalCalculado = roundMoney(
          computed.items.reduce((sum, ci) => sum + ci.costoUnitario * ci.cantidad, 0)
        );

        // Step 5: Insert Sale Header -- usando EXCLUSIVAMENTE los valores
        // recalculados por el servidor (computed), nunca los del cliente.
        const saleRecord = {
          id: saleId,
          numero_venta: numeroVenta,
          cliente_id: data.clienteId || '',
          cliente_nombre: data.clienteNombre || 'Consumidor Final',
          cliente_documento: data.clienteDocumento || '',
          vendedor_id: user ? user.id : 'USR-001',
          vendedor_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Vendedor',
          caja_sesion_id: data.cajaSesionId || '',
          subtotal: computed.subtotal,
          descuento_total: computed.descuentoTotal,
          impuesto_total: computed.impuestoTotal,
          total: computed.total,
          costo_total: costoTotalCalculado,
          metodo_pago: data.metodoPago || 'EFECTIVO',
          pagos_json: JSON.stringify(data.pagos || [{ metodo: data.metodoPago || 'EFECTIVO', monto: computed.total }]),
          efectivo_recibido: data.efectivoRecibido ? Number(data.efectivoRecibido) : '',
          cambio_entregado: data.cambioEntregado ? Number(data.cambioEntregado) : '',
          es_credito: esCredito ? 'TRUE' : 'FALSE',
          monto_financiado: esCredito ? nuevoMontoFinanciado : '',
          cuenta_cobrar_id: '',
          estado: 'COMPLETADA',
          motivo_anulacion: '',
          anulada_por: '',
          fecha_anulacion: '',
          fecha: nowStr
        };

        DbHelper.insertRow('Ventas', saleRecord);
        DbHelper.recordInsert(tx, 'Ventas', saleId);

        // Step 6: Insert Sale Items & Deduct Stock & Kardex -- a partir de
        // computed.items (ya recalculados), no de data.items crudo.
        const saleItemsToInsert = [];
        const kardexToInsert = [];

        for (const ci of computed.items) {
          const itemId = Sequences.getNext('ITM');
          const variant = ci.variant;
          const varId = String(variant.id).trim();
          const item = ci.raw;

          const saleItem = {
            id: itemId,
            venta_id: saleId,
            producto_id: variant.producto_id,
            variante_id: varId,
            nombre_producto: item.nombreProducto || ci.product.nombre,
            sku: variant.sku,
            talla: variant.talla,
            color: variant.color,
            categoria: item.categoria || '',
            cantidad: ci.cantidad,
            costo_unitario: ci.costoUnitario,
            precio_unitario: ci.precioUnitario,
            descuento_porcentaje: ci.descuentoPorcentaje,
            descuento_monto: ci.descuentoMonto,
            subtotal: ci.subtotal,
            impuesto_monto: ci.impuestoMonto,
            total: ci.total
          };
          saleItemsToInsert.push(saleItem);
          DbHelper.recordInsert(tx, 'Venta_Items', itemId);

          // Deduct variant stock
          const oldStock = Number(variant.stock) || 0;
          const newStock = oldStock - ci.cantidad;

          DbHelper.recordUpdate(tx, 'Variantes', varId, { stock: oldStock });
          DbHelper.updateRowById('Variantes', varId, { stock: newStock });

          // Kardex entry
          const movId = Sequences.getNext('MOV');
          const kardexEntry = {
            id: movId,
            producto_id: variant.producto_id,
            producto_nombre: item.nombreProducto || ci.product.nombre,
            variante_id: varId,
            sku: variant.sku,
            talla: variant.talla,
            color: variant.color,
            cantidad: -ci.cantidad,
            tipo: 'VENTA',
            stock_anterior: oldStock,
            stock_nuevo: newStock,
            motivo: `Venta ${numeroVenta}`,
            referencia: numeroVenta,
            usuario_id: user ? user.id : 'USR-001',
            usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
            fecha: nowStr
          };
          kardexToInsert.push(kardexEntry);
          DbHelper.recordInsert(tx, 'Inventario_Kardex', movId);
        }

        DbHelper.insertRows('Venta_Items', saleItemsToInsert);
        DbHelper.insertRows('Inventario_Kardex', kardexToInsert);

        // Step 6: Create Credit if applicable
        if (esCredito && customer) {
          creditId = Sequences.getNext('CRED');
          // FIX (regresión: el plazo elegido en el POS para ESTA venta se
          // ignoraba por completo -- el vencimiento siempre se calculaba
          // con el plazo predeterminado del cliente). data.diasPlazo es el
          // plazo elegido explícitamente en el modal de Cobro de Venta
          // ("A Crédito", 7/15/30/45/60 días) y tiene prioridad; el
          // default del cliente (customer.dias_credito_por_defecto) solo
          // se usa como respaldo si no se envió un valor válido (venta
          // creada sin pasar por ese selector, ej. seedAllTestData/tests
          // antiguos). Nunca se sobrescribe uno por el otro cuando el
          // frontend sí declaró una elección explícita.
          const diasPlazoSolicitado = Number(data.diasPlazo);
          const diasPlazo = Number.isFinite(diasPlazoSolicitado) && diasPlazoSolicitado > 0 && diasPlazoSolicitado <= 3650
            ? diasPlazoSolicitado
            : (customer.dias_credito_por_defecto ? Number(customer.dias_credito_por_defecto) : 15);
          const vencimientoDate = new Date(Date.now() + diasPlazo * 24 * 3600 * 1000);
          const vencimientoStr = Utilities.formatDate(vencimientoDate, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
          // nuevoMontoFinanciado ya fue calculado y acotado a computed.total
          // arriba (paso de validación de crédito) -- no se vuelve a leer
          // data.montoFinanciado crudo aquí.
          const montoCredito = nuevoMontoFinanciado;

          const creditRecord = {
            id: creditId,
            numero_credito: creditId,
            cliente_id: customer.id,
            cliente_nombre: `${customer.nombre} ${customer.apellido || ''}`.trim(),
            cliente_telefono: customer.telefono || '',
            cliente_documento: customer.documento || '',
            venta_id: saleId,
            numero_venta: numeroVenta,
            monto_original: montoCredito,
            monto_pagado: 0,
            saldo_pendiente: montoCredito,
            fecha_creacion: nowStr,
            fecha_vencimiento: vencimientoStr,
            dias_plazo: diasPlazo,
            estado: 'PENDIENTE',
            observaciones: `Crédito originado en venta ${numeroVenta}`,
            creado_por: user ? user.id : 'USR-001'
          };

          DbHelper.insertRow('Creditos', creditRecord);
          DbHelper.recordInsert(tx, 'Creditos', creditId);

          // Update sale with credit ID
          DbHelper.updateRowById('Ventas', saleId, { cuenta_cobrar_id: creditId });
        }

        // FASE 6/7 (créditos a favor / notas de crédito -- integración
        // operativa en POS): si la venta incluye data.creditoFavorAplicado
        // ({ id, monto }), se aplica DENTRO de esta misma transacción --
        // comparte exactamente CreditNotesController.applyToSaleWithinTx_
        // (la misma función que usa la acción independiente
        // creditNotes.apply), sin duplicar la validación/lock. Se le pasa
        // data.clienteId para que valide que el crédito pertenece
        // realmente al cliente de ESTA venta (FASE 7: antes no se
        // verificaba, hallazgo de auditoría corregido). Si el crédito no
        // existe, ya está anulado, no pertenece a este cliente, o el monto
        // excede su saldo disponible, esto lanza un error que aborta TODA
        // la venta (stock, items, todo se revierte) -- igual que cualquier
        // otra validación de esta función. No se genera ningún movimiento
        // de caja para este monto (Parte 24: "no debe inventar dinero
        // físico en caja") -- el filtro de `cashAmount` de abajo ya solo
        // suma pagos con metodo 'EFECTIVO', así que un pago con metodo
        // 'CREDITO_FAVOR' queda automáticamente excluido sin necesidad de
        // ningún cambio adicional aquí. La validación de arriba
        // (pagosCreditoFavor vs creditoFavorMontoSolicitado) ya garantizó
        // que este monto es consistente con lo declarado en data.pagos.
        let creditoFavorAplicado = null;
        if (data.creditoFavorAplicado && data.creditoFavorAplicado.id) {
          creditoFavorAplicado = CreditNotesController.applyToSaleWithinTx_(
            tx,
            data.creditoFavorAplicado.id,
            saleId,
            numeroVenta,
            data.creditoFavorAplicado.monto,
            data.clienteId,
            user
          );
        }

        // Step 7: Update Cash Session if cash payment
        const cashAmount = Array.isArray(data.pagos)
          ? data.pagos.filter(p => p.metodo === 'EFECTIVO').reduce((sum, p) => sum + (Number(p.monto) || 0), 0)
          : (data.metodoPago === 'EFECTIVO' ? computed.total : 0);

        if (cashAmount > 0 && data.cajaSesionId) {
          const cashSession = DbHelper.findById('Cajas', data.cajaSesionId);
          if (cashSession && cashSession.estado === 'ABIERTA') {
            const currentCashSales = Number(cashSession.ventas_efectivo) || 0;
            DbHelper.recordUpdate(tx, 'Cajas', data.cajaSesionId, { ventas_efectivo: currentCashSales });
            DbHelper.updateRowById('Cajas', data.cajaSesionId, {
              ventas_efectivo: currentCashSales + cashAmount
            });

            const cmovId = Sequences.getNext('CMOV');
            const cashMov = {
              id: cmovId,
              caja_sesion_id: data.cajaSesionId,
              tipo: 'VENTA_EFECTIVO',
              monto: cashAmount,
              motivo: `Cobro en efectivo venta ${numeroVenta}`,
              categoria_gasto: '',
              referencia: numeroVenta,
              usuario_id: user ? user.id : 'USR-001',
              usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
              fecha: nowStr,
              estado: 'ACTIVO'
            };
            DbHelper.insertRow('Caja_Movimientos', cashMov);
            DbHelper.recordInsert(tx, 'Caja_Movimientos', cmovId);
          }
        }

        // Step 8: Audit
        AuditController.log(
          user,
          'SALE_CREATED',
          'VENTAS',
          'Sale',
          saleId,
          `Venta ${numeroVenta} completada por RD$${computed.total.toLocaleString()} a ${data.clienteNombre || 'Consumidor Final'}`
        );

        return {
          success: true,
          message: `Venta ${numeroVenta} procesada exitosamente.`,
          saleId: saleId,
          numeroVenta: numeroVenta,
          cuentaCobrarId: creditId || undefined,
          creditoFavorAplicado: creditoFavorAplicado || undefined
        };

      } catch (err) {
        // Compensation Rollback in reverse order
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  },

  /**
   * ATOMIC VOID SALE (Anulación de Factura)
   * Restores stock, marks sale as ANULADA, registers Kardex DEVOLUCION,
   * cancels the associated Credito (cuenta por cobrar) if unpaid, and
   * (FASE 10) reverses cualquier aplicación de Crédito a Favor/Nota de
   * Crédito que esta venta hubiera consumido, restaurando su saldo.
   */
  handleVoidSale(data, user) {
    Security.requirePermission(user, 'ventas.anular');
    if (!data.saleId || !data.motivo) {
      throw new Error('VALIDATION_ERROR: ID de venta y motivo de anulación son requeridos.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const sale = DbHelper.findById('Ventas', data.saleId);
      if (!sale) throw new Error('NOT_FOUND: Venta no encontrada.');

      if (sale.estado === 'ANULADA') {
        throw new Error('INVALID_STATE: La venta ya se encuentra anulada.');
      }

      const saleItems = DbHelper.findRows('Venta_Items', it => it.venta_id === data.saleId);
      const allVariants = DbHelper.getAllRows('Variantes');
      const nowStr = getNowFormatted();

      // FASE 3.7A (hallazgo durante la integración real de sales.void): a
      // diferencia de handleCreateSale/ReturnsController.handleCreateReturn,
      // esta operación no usaba el motor de compensación (DbHelper.beginTx/
      // recordUpdate/recordInsert/rollback) pese a escribir en múltiples
      // hojas (Variantes, Inventario_Kardex, Creditos, Ventas). Si un paso
      // fallaba a mitad de camino (ej. Creditos.updateRowById lanza una
      // excepción), el stock ya quedaba reintegrado pero la venta seguía
      // "ACTIVA" -- estado financiero parcial e inconsistente. Se aplica el
      // mismo patrón de rollback ya usado en el resto del sistema.
      const tx = DbHelper.beginTx();
      try {
        // Step 1: Reintegrate stock and record Kardex
        for (const item of saleItems) {
          const variant = allVariants.find(v => v.id === item.variante_id);
          if (variant) {
            const oldStock = Number(variant.stock) || 0;
            const restoredStock = oldStock + Number(item.cantidad);
            DbHelper.recordUpdate(tx, 'Variantes', variant.id, { stock: oldStock });
            DbHelper.updateRowById('Variantes', variant.id, { stock: restoredStock });

            const movId = Sequences.getNext('MOV');
            DbHelper.insertRow('Inventario_Kardex', {
              id: movId,
              producto_id: item.producto_id,
              producto_nombre: item.nombre_producto,
              variante_id: item.variante_id,
              sku: item.sku,
              talla: item.talla,
              color: item.color,
              cantidad: Number(item.cantidad),
              tipo: 'DEVOLUCION',
              stock_anterior: oldStock,
              stock_nuevo: restoredStock,
              motivo: `Anulación de venta ${sale.numero_venta}: ${data.motivo}`,
              referencia: sale.numero_venta,
              usuario_id: user ? user.id : 'USR-001',
              usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
              fecha: nowStr
            });
            DbHelper.recordInsert(tx, 'Inventario_Kardex', movId);
          }
        }

        // Step 2: Cancel Credit if associated
        if (sale.cuenta_cobrar_id) {
          const credit = DbHelper.findById('Creditos', sale.cuenta_cobrar_id);
          if (credit) {
            DbHelper.recordUpdate(tx, 'Creditos', credit.id, {
              estado: credit.estado,
              observaciones: credit.observaciones
            });
            DbHelper.updateRowById('Creditos', credit.id, {
              estado: 'ANULADA',
              observaciones: `${credit.observaciones || ''} | Anulado por revocación de venta ${sale.numero_venta}`
            });
          }
        }

        // Step 2b (FASE 10 -- auditoría E2E, hallazgo real): si esta venta
        // consumió un Crédito a Favor/Nota de Crédito
        // (CreditNotesController.applyToSaleWithinTx_, ver
        // Creditos_Favor_Aplicaciones), anular la venta NUNCA revertía esa
        // aplicación -- el saldo del cliente quedaba consumido para
        // siempre aunque la venta que lo usó ya no existiera. Se restaura
        // el saldo del/de los crédito(s) aplicado(s) a esta venta, y se
        // registra la reversión como una NUEVA fila en
        // Creditos_Favor_Aplicaciones con monto NEGATIVO (nunca se edita
        // ni se borra la aplicación original -- mismo principio de
        // histórico append-only que ya usa esta hoja) para que el rastro
        // completo (aplicación original + reversión) quede visible.
        const creditNoteApplications = DbHelper.findRows('Creditos_Favor_Aplicaciones', a => a.venta_id === data.saleId);
        for (const application of creditNoteApplications) {
          const creditNote = DbHelper.findById('Creditos_Favor', application.credito_favor_id);
          if (!creditNote || creditNote.estado === 'ANULADA') continue;

          const montoAplicadoOriginal = roundMoney(Number(application.monto) || 0);
          if (montoAplicadoOriginal <= 0) continue;

          const nuevoSaldo = roundMoney((Number(creditNote.saldo_disponible) || 0) + montoAplicadoOriginal);
          const nuevoMontoAplicado = roundMoney(Math.max(0, (Number(creditNote.monto_aplicado) || 0) - montoAplicadoOriginal));
          const nuevoEstadoCredito = nuevoMontoAplicado <= 0 ? 'EMITIDA' : 'PARCIALMENTE_APLICADA';

          DbHelper.recordUpdate(tx, 'Creditos_Favor', creditNote.id, {
            monto_aplicado: creditNote.monto_aplicado,
            saldo_disponible: creditNote.saldo_disponible,
            estado: creditNote.estado,
            actualizado_en: creditNote.actualizado_en
          });
          DbHelper.updateRowById('Creditos_Favor', creditNote.id, {
            monto_aplicado: nuevoMontoAplicado,
            saldo_disponible: nuevoSaldo,
            estado: nuevoEstadoCredito,
            actualizado_en: nowStr
          });

          const reversalId = Sequences.getNext('CFAPP');
          DbHelper.insertRow('Creditos_Favor_Aplicaciones', {
            id: reversalId,
            credito_favor_id: creditNote.id,
            venta_id: data.saleId,
            numero_venta: sale.numero_venta,
            monto: -montoAplicadoOriginal,
            fecha: nowStr,
            usuario_id: user ? user.id : 'USR-001',
            usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema'
          });
          DbHelper.recordInsert(tx, 'Creditos_Favor_Aplicaciones', reversalId);

          AuditController.log(
            user,
            'CREDIT_NOTE_APPLICATION_REVERSED',
            'CREDITOS_FAVOR',
            'CreditNote',
            creditNote.id,
            `Aplicación de RD$${montoAplicadoOriginal.toLocaleString()} a la venta ${sale.numero_venta} revertida por anulación de venta. Saldo restaurado a RD$${nuevoSaldo.toLocaleString()}.`
          );
        }

        // Step 3: Mark Sale as ANULADA
        DbHelper.recordUpdate(tx, 'Ventas', data.saleId, {
          estado: sale.estado,
          motivo_anulacion: sale.motivo_anulacion,
          anulada_por: sale.anulada_por,
          fecha_anulacion: sale.fecha_anulacion
        });
        DbHelper.updateRowById('Ventas', data.saleId, {
          estado: 'ANULADA',
          motivo_anulacion: data.motivo,
          anulada_por: user ? user.id : 'USR-001',
          fecha_anulacion: nowStr
        });

        AuditController.log(
          user,
          'SALE_VOIDED',
          'VENTAS',
          'Sale',
          data.saleId,
          `Venta ${sale.numero_venta} anulada. Motivo: ${data.motivo}`
        );

        return {
          success: true,
          message: `Venta ${sale.numero_venta} anulada correctamente y prendas reintegradas al stock.`
        };
      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  }
};
