/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: CreditNotesController.gs
 * Description: Créditos a Favor / Vales y Notas de Crédito -- saldo reutilizable que el
 * NEGOCIO le debe al CLIENTE (dirección opuesta a Creditos/Abonos, que es lo que el
 * cliente le debe al negocio). Emisión (desde una devolución), aplicación en una venta
 * futura (con historial de aplicaciones), y anulación -- todo con LockService/rollback,
 * el mismo motor transaccional ya usado por ReturnsController/SalesController/CreditsController.
 *
 * FASE 6 (decisión arquitectónica documentada en el reporte de esta fase): "Crédito a
 * Favor / Vale" (tipo VALE_TIENDA) y "Nota de Crédito" (tipo NOTA_CREDITO) son el MISMO
 * pasivo comercial -- comparten exactamente la misma necesidad de número, monto
 * original, monto aplicado, saldo disponible, estado y aplicaciones. Se modelan como
 * UNA sola entidad (`Creditos_Favor` + `Creditos_Favor_Aplicaciones`) distinguida por el
 * campo `tipo`, en vez de duplicar dos hojas/controladores idénticos. Esto es
 * DISTINTO de `Creditos` (cuenta por cobrar: el CLIENTE le debe al negocio) -- nunca se
 * mezclan ni comparten saldo entre sí.
 */

const CreditNotesController = {
  /**
   * Lista créditos a favor / notas de crédito, con su historial de
   * aplicaciones embebido (mismo patrón que CreditsController.handleListCredits
   * embebe Abonos dentro de cada Crédito). Filtros opcionales: clienteId, tipo.
   */
  handleListCreditNotes(data) {
    const rows = DbHelper.getAllRows('Creditos_Favor');
    const aplicaciones = DbHelper.getAllRows('Creditos_Favor_Aplicaciones');

    const aplicacionesByCredito = {};
    aplicaciones.forEach(a => {
      const cId = String(a.credito_favor_id || '').trim();
      if (!aplicacionesByCredito[cId]) aplicacionesByCredito[cId] = [];
      aplicacionesByCredito[cId].push({
        id: a.id,
        creditoFavorId: a.credito_favor_id,
        ventaId: a.venta_id,
        numeroVenta: a.numero_venta,
        monto: Number(a.monto) || 0,
        fecha: a.fecha,
        usuarioId: a.usuario_id,
        usuarioNombre: a.usuario_nombre
      });
    });

    let filtered = rows;
    if (data && data.clienteId) {
      filtered = filtered.filter(r => String(r.cliente_id) === String(data.clienteId));
    }
    if (data && data.tipo) {
      filtered = filtered.filter(r => r.tipo === data.tipo);
    }

    const enriched = filtered.map(r => {
      const rId = String(r.id).trim();
      return {
        id: r.id,
        numero: r.numero,
        tipo: r.tipo,
        clienteId: r.cliente_id,
        clienteNombre: r.cliente_nombre,
        devolucionId: r.devolucion_id || undefined,
        ventaOrigenId: r.venta_origen_id || undefined,
        montoOriginal: Number(r.monto_original) || 0,
        montoAplicado: Number(r.monto_aplicado) || 0,
        saldoDisponible: Number(r.saldo_disponible) || 0,
        estado: r.estado,
        motivoAnulacion: r.motivo_anulacion || undefined,
        anuladoPor: r.anulado_por || undefined,
        fechaAnulacion: r.fecha_anulacion || undefined,
        usuarioId: r.usuario_id,
        usuarioNombre: r.usuario_nombre,
        fechaCreacion: r.fecha_creacion,
        actualizadoEn: r.actualizado_en,
        aplicaciones: aplicacionesByCredito[rId] || []
      };
    });

    enriched.sort((a, b) => String(b.fechaCreacion || '').localeCompare(String(a.fechaCreacion || '')));

    return { success: true, creditNotes: enriched };
  },

  /**
   * Emite un Crédito a Favor / Vale o una Nota de Crédito a partir de una
   * devolución -- llamada INTERNAMENTE por ReturnsController.handleCreateReturn
   * dentro de su MISMA transacción (tx) ya abierta, nunca como acción pública
   * independiente (emitir un crédito sin una devolución real que lo origine
   * no está permitido -- siempre debe tener un origen verificable).
   *
   * Política (Parte 12 de la fase): exige un cliente real en la venta
   * origen -- un Crédito a Favor/Nota de Crédito anónimo ("Consumidor
   * Final") sería irrecuperable, así que se rechaza explícitamente en vez
   * de crear un documento que nadie podría reclamar.
   *
   * @param {Object} tx - transacción de DbHelper YA ABIERTA por el llamador
   * @param {'VALE_TIENDA'|'NOTA_CREDITO'} tipo
   * @param {Object} sale - fila de Ventas (venta original)
   * @param {string} returnId - id de la devolución que origina este crédito
   * @param {number} monto - monto a emitir (computed.totalRefund de la devolución)
   * @param {Object} user
   * @returns {{id, numero, tipo, montoOriginal}}
   */
  issueFromReturnWithinTx_(tx, tipo, sale, returnId, monto, user) {
    if (!sale.cliente_id) {
      throw new Error(
        'CLIENTE_REQUERIDO: Para emitir un Crédito a Favor/Vale o una Nota de Crédito se requiere que la venta original tenga un cliente registrado -- no puede emitirse a "Consumidor Final" porque quedaría irrecuperable.'
      );
    }

    const montoEmitir = roundMoney(Number(monto));
    if (!Number.isFinite(montoEmitir) || montoEmitir <= 0) {
      throw new Error('VALIDATION_ERROR: El monto a emitir debe ser mayor a 0.');
    }

    const prefix = tipo === 'NOTA_CREDITO' ? 'NC' : 'VALE';
    const id = Sequences.getNext(prefix);
    const nowStr = getNowFormatted();

    const record = {
      id: id,
      numero: id,
      tipo: tipo,
      cliente_id: sale.cliente_id,
      cliente_nombre: sale.cliente_nombre || '',
      devolucion_id: returnId,
      venta_origen_id: sale.id,
      monto_original: montoEmitir,
      monto_aplicado: 0,
      saldo_disponible: montoEmitir,
      estado: 'EMITIDA',
      motivo_anulacion: '',
      anulado_por: '',
      fecha_anulacion: '',
      usuario_id: user ? user.id : 'USR-001',
      usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
      fecha_creacion: nowStr,
      actualizado_en: nowStr
    };

    DbHelper.insertRow('Creditos_Favor', record);
    DbHelper.recordInsert(tx, 'Creditos_Favor', id);

    return { id: id, numero: id, tipo: tipo, montoOriginal: montoEmitir };
  },

  /**
   * Aplica (total o parcialmente) un Crédito a Favor/Vale o Nota de
   * Crédito a una venta -- llamada tanto desde handleApplyCreditNote
   * (acción independiente) como desde SalesController.handleCreateSale
   * (aplicación como parte del pago de una venta nueva). SIEMPRE debe
   * ejecutarse dentro de una sección protegida por LockService (del
   * llamador) -- esta función NO adquiere su propio candado, para poder
   * compartir la MISMA transacción atómica que el resto de la operación
   * que la invoca (Parte 11: atomicidad/concurrencia).
   *
   * Relee el saldo actual DIRECTAMENTE de Creditos_Favor en el momento de
   * aplicar (nunca un valor cacheado de antes de entrar al candado) --
   * así, si dos ventas simultáneas intentaran usar el mismo crédito, el
   * candado de LockService (exclusión mutua de todo el backend) garantiza
   * que la segunda vea el saldo YA reducido por la primera y sea
   * rechazada si no alcanza.
   *
   * FASE 7 (Parte 3/15 -- hallazgo de auditoría corregido ANTES de
   * construir la UI del POS, como exige la fase): esta función antes NO
   * verificaba a quién pertenece el crédito. Cualquier `creditoFavorId`
   * válido podía aplicarse a la venta de CUALQUIER cliente, sin importar
   * su `cliente_id` real -- un hueco de seguridad/negocio real, no
   * cosmético. Ahora exige `clienteId` (el cliente de la venta que
   * consume el crédito) y rechaza si no coincide con `credito.cliente_id`,
   * o si no se proporcionó ningún cliente ("Consumidor Final" nunca puede
   * aplicar un crédito, igual que nunca puede emitirse uno a su nombre).
   *
   * @param {Object} tx
   * @param {string} creditoFavorId
   * @param {string} ventaId
   * @param {string} numeroVenta
   * @param {number} monto
   * @param {string} clienteId - cliente de la venta que aplica el crédito (nunca vacío)
   * @param {Object} user
   * @returns {{creditoFavorId, numero, montoAplicado, saldoRestante, estado}}
   */
  applyToSaleWithinTx_(tx, creditoFavorId, ventaId, numeroVenta, monto, clienteId, user) {
    const credito = DbHelper.findById('Creditos_Favor', creditoFavorId);
    if (!credito) {
      throw new Error('NOT_FOUND: Crédito a Favor / Nota de Crédito no encontrado.');
    }
    if (credito.estado === 'ANULADA') {
      throw new Error(`INVALID_STATE: ${credito.numero} ya fue anulado y no puede aplicarse.`);
    }

    if (!clienteId) {
      throw new Error(
        'CLIENTE_REQUERIDO: Para aplicar un Crédito a Favor/Nota de Crédito la venta debe tener un cliente registrado -- "Consumidor Final" no puede utilizar saldos a favor.'
      );
    }
    if (String(credito.cliente_id) !== String(clienteId)) {
      throw new Error(
        `CREDITO_NO_PERTENECE_AL_CLIENTE: ${credito.numero} no pertenece al cliente de esta venta -- no puede aplicarse.`
      );
    }

    const montoAplicar = roundMoney(Number(monto));
    if (!Number.isFinite(montoAplicar) || montoAplicar <= 0) {
      throw new Error('VALIDATION_ERROR: El monto a aplicar debe ser mayor a 0.');
    }

    const saldoActual = roundMoney(Number(credito.saldo_disponible) || 0);
    if (montoAplicar > saldoActual) {
      throw new Error(
        `SALDO_INSUFICIENTE: El monto a aplicar (RD$${montoAplicar.toLocaleString()}) excede el saldo disponible de ${credito.numero} (RD$${saldoActual.toLocaleString()}).`
      );
    }

    const nuevoSaldo = roundMoney(saldoActual - montoAplicar);
    const nuevoMontoAplicado = roundMoney((Number(credito.monto_aplicado) || 0) + montoAplicar);
    const nuevoEstado = nuevoSaldo <= 0 ? 'APLICADA' : 'PARCIALMENTE_APLICADA';
    const nowStr = getNowFormatted();

    DbHelper.recordUpdate(tx, 'Creditos_Favor', credito.id, {
      monto_aplicado: credito.monto_aplicado,
      saldo_disponible: credito.saldo_disponible,
      estado: credito.estado,
      actualizado_en: credito.actualizado_en
    });
    DbHelper.updateRowById('Creditos_Favor', credito.id, {
      monto_aplicado: nuevoMontoAplicado,
      saldo_disponible: nuevoSaldo,
      estado: nuevoEstado,
      actualizado_en: nowStr
    });

    const aplicacionId = Sequences.getNext('CFAPP');
    const aplicacionRecord = {
      id: aplicacionId,
      credito_favor_id: credito.id,
      venta_id: ventaId,
      numero_venta: numeroVenta,
      monto: montoAplicar,
      fecha: nowStr,
      usuario_id: user ? user.id : 'USR-001',
      usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema'
    };
    DbHelper.insertRow('Creditos_Favor_Aplicaciones', aplicacionRecord);
    DbHelper.recordInsert(tx, 'Creditos_Favor_Aplicaciones', aplicacionId);

    return {
      creditoFavorId: credito.id,
      numero: credito.numero,
      montoAplicado: montoAplicar,
      saldoRestante: nuevoSaldo,
      estado: nuevoEstado
    };
  },

  /**
   * Acción pública independiente: aplica un crédito a una venta YA
   * EXISTENTE (uso administrativo/de consulta, o para clientes que
   * integren esto fuera del flujo de creación de venta). El flujo
   * principal del POS (aplicar crédito COMO PARTE del pago de una venta
   * nueva) pasa en cambio por SalesController.handleCreateSale
   * (data.creditoFavorAplicado), que comparte esta misma lógica interna
   * (applyToSaleWithinTx_) dentro de su propia transacción -- nunca se
   * duplica la validación/aplicación en dos lugares distintos.
   */
  handleApplyCreditNote(data, user) {
    Security.requirePermission(user, 'creditos_favor.aplicar');

    if (!data.creditoFavorId || !data.ventaId || !data.monto) {
      throw new Error('VALIDATION_ERROR: Crédito/nota, venta y monto son obligatorios.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();
      try {
        const sale = DbHelper.findById('Ventas', data.ventaId);
        if (!sale) throw new Error('NOT_FOUND: Venta no encontrada.');
        // FASE 7 (hallazgo de auditoría): aplicar un crédito a una venta ya
        // anulada no tiene sentido comercial -- esa venta ya no representa
        // ningún cobro pendiente real.
        if (sale.estado === 'ANULADA') {
          throw new Error('INVALID_STATE: No se puede aplicar un crédito a una venta que ya fue anulada.');
        }

        const result = this.applyToSaleWithinTx_(
          tx, data.creditoFavorId, sale.id, sale.numero_venta, data.monto, sale.cliente_id, user
        );

        AuditController.log(
          user,
          'CREDIT_NOTE_APPLIED',
          'CREDITOS_FAVOR',
          'CreditNote',
          result.creditoFavorId,
          `Se aplicó RD$${result.montoAplicado.toLocaleString()} de ${result.numero} a la venta ${sale.numero_venta}. Saldo restante: RD$${result.saldoRestante.toLocaleString()}.`
        );

        return {
          success: true,
          message: `RD$${result.montoAplicado.toLocaleString()} de ${result.numero} aplicado exitosamente a la venta ${sale.numero_venta}.`,
          creditoFavorId: result.creditoFavorId,
          numero: result.numero,
          montoAplicado: result.montoAplicado,
          saldoRestante: result.saldoRestante,
          estado: result.estado
        };
      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  },

  /**
   * Anula un Crédito a Favor/Vale o Nota de Crédito -- NUNCA borra el
   * registro (Parte 15: usar estado ANULADA + usuario/fecha/motivo). Si
   * el crédito ya tiene aplicaciones registradas (monto_aplicado > 0), se
   * bloquea la anulación directa -- exactamente la política explícita que
   * pide la fase ("si ya fue aplicado a ventas: bloquear anulación
   * directa") en vez de inventar una reversión automática de las ventas
   * que ya lo usaron.
   */
  handleVoidCreditNote(data, user) {
    Security.requirePermission(user, 'creditos_favor.anular');

    if (!data.creditoFavorId || !data.motivo) {
      throw new Error('VALIDATION_ERROR: Crédito/nota y motivo de anulación son obligatorios.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();
      try {
        const credito = DbHelper.findById('Creditos_Favor', data.creditoFavorId);
        if (!credito) throw new Error('NOT_FOUND: Crédito/nota no encontrado.');

        if (credito.estado === 'ANULADA') {
          throw new Error('INVALID_STATE: Este crédito/nota ya se encuentra anulado.');
        }

        const montoAplicado = Number(credito.monto_aplicado) || 0;
        if (montoAplicado > 0) {
          throw new Error(
            `NO_ANULABLE: ${credito.numero} ya tiene RD$${montoAplicado.toLocaleString()} aplicado a venta(s) -- no puede anularse directamente. Requiere una política de reversión explícita (fuera del alcance de esta fase).`
          );
        }

        const nowStr = getNowFormatted();
        DbHelper.recordUpdate(tx, 'Creditos_Favor', credito.id, {
          estado: credito.estado,
          saldo_disponible: credito.saldo_disponible,
          motivo_anulacion: credito.motivo_anulacion,
          anulado_por: credito.anulado_por,
          fecha_anulacion: credito.fecha_anulacion,
          actualizado_en: credito.actualizado_en
        });
        DbHelper.updateRowById('Creditos_Favor', credito.id, {
          estado: 'ANULADA',
          saldo_disponible: 0,
          motivo_anulacion: data.motivo.trim(),
          anulado_por: user ? user.id : 'USR-001',
          fecha_anulacion: nowStr,
          actualizado_en: nowStr
        });

        AuditController.log(
          user,
          'CREDIT_NOTE_VOIDED',
          'CREDITOS_FAVOR',
          'CreditNote',
          credito.id,
          `${credito.numero} anulado. Motivo: ${data.motivo}`
        );

        return { success: true, message: `${credito.numero} anulado exitosamente.` };
      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  }
};
