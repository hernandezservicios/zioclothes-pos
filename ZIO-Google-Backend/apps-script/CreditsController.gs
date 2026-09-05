/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: CreditsController.gs
 * Description: Accounts receivable management, atomic debt installments (Abonos),
 * balance recalculation, and cash register integration.
 */

const CreditsController = {
  /**
   * Returns accounts receivable with embedded payment installments (Abonos).
   */
  handleListCredits(data) {
    const credits = DbHelper.getAllRows('Creditos');
    const installments = DbHelper.getAllRows('Abonos');

    const installmentsByCredit = {};
    installments.forEach(inst => {
      const cId = String(inst.cuenta_cobrar_id).trim();
      if (!installmentsByCredit[cId]) installmentsByCredit[cId] = [];
      installmentsByCredit[cId].push({
        id: inst.id,
        numeroRecibo: inst.numero_recibo,
        cuentaCobrarId: inst.cuenta_cobrar_id,
        clienteId: inst.cliente_id,
        clienteNombre: inst.cliente_nombre,
        ventaId: inst.venta_id || undefined,
        numeroVenta: inst.numero_venta || '',
        saldoAnterior: Number(inst.saldo_anterior) || 0,
        montoAbonado: Number(inst.monto_abonado) || 0,
        saldoRestante: Number(inst.saldo_restante) || 0,
        metodoPago: inst.metodo_pago,
        referencia: inst.referencia || '',
        cajaSesionId: inst.caja_sesion_id || undefined,
        usuarioId: inst.usuario_id,
        usuarioNombre: inst.usuario_nombre,
        observaciones: inst.observaciones || '',
        fecha: inst.fecha,
        estado: inst.estado,
        motivoAnulacion: inst.motivo_anulacion || undefined,
        anuladoPor: inst.anulado_por || undefined,
        fechaAnulacion: inst.fecha_anulacion || undefined
      });
    });

    const enriched = credits.map(c => {
      const cId = String(c.id).trim();
      const abonos = installmentsByCredit[cId] || [];

      return {
        id: c.id,
        numeroCredito: c.numero_credito,
        clienteId: c.cliente_id,
        clienteNombre: c.cliente_nombre,
        clienteTelefono: c.cliente_telefono || '',
        clienteDocumento: c.cliente_documento || '',
        ventaId: c.venta_id,
        numeroVenta: c.numero_venta,
        montoOriginal: Number(c.monto_original) || 0,
        montoPagado: Number(c.monto_pagado) || 0,
        saldoPendiente: Number(c.saldo_pendiente) || 0,
        fechaCreacion: c.fecha_creacion,
        fechaVencimiento: c.fecha_vencimiento,
        diasPlazo: Number(c.dias_plazo) || 15,
        estado: c.estado,
        observaciones: c.observaciones || '',
        creadoPor: c.creado_por,
        abonos: abonos
      };
    });

    enriched.sort((a, b) => String(b.fechaCreacion || '').localeCompare(String(a.fechaCreacion || '')));

    return {
      success: true,
      credits: enriched
    };
  },

  /**
   * ATOMIC ABONO REGISTRATION
   * 1. LockService
   * 2. Validate credit exists & has pending balance
   * 3. Validate montoAbonado <= saldoPendiente
   * 4. Insert Abono
   * 5. Update Credit balance and status (PARCIAL or PAGADA)
   * 6. If cash payment, update active Cash Session & Cash Movement
   * 7. Audit log
   */
  handleRegisterAbono(data, user) {
    Security.requirePermission(user, 'abonos.crear');

    if (!data.cuentaCobrarId || !data.monto || Number(data.monto) <= 0) {
      throw new Error('VALIDATION_ERROR: Cuenta por cobrar y monto mayor a 0 son obligatorios.');
    }

    // FASE 3.7B (Sección 15, redondeo monetario): sin roundMoney, abonos
    // sucesivos con decimales (ej. saldar en 3 partes de 33.33) podían
    // dejar residuos de punto flotante (0.000000000001) que impedirían
    // saldar la cuenta exactamente o dispararían ABONO_EXCEDE_SALDO por un
    // excedente microscópico al usar el botón "Saldar Total".
    const montoAbonado = roundMoney(Number(data.monto));

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();

      try {
        const credit = DbHelper.findById('Creditos', data.cuentaCobrarId);
        if (!credit) throw new Error('NOT_FOUND: Cuenta por cobrar no encontrada.');

        if (credit.estado === 'PAGADA' || credit.estado === 'ANULADA') {
          throw new Error(`INVALID_STATE: Esta cuenta ya se encuentra ${credit.estado.toLowerCase()}.`);
        }

        const saldoAnterior = roundMoney(Number(credit.saldo_pendiente) || 0);
        if (montoAbonado > saldoAnterior) {
          throw new Error(
            `ABONO_EXCEDE_SALDO: El monto a abonar (RD$${montoAbonado.toLocaleString()}) excede el saldo pendiente (RD$${saldoAnterior.toLocaleString()}).`
          );
        }

        const saldoRestante = roundMoney(Math.max(0, saldoAnterior - montoAbonado));
        const nuevoMontoPagado = roundMoney((Number(credit.monto_pagado) || 0) + montoAbonado);
        const nuevoEstado = saldoRestante <= 0 ? 'PAGADA' : 'PARCIAL';
        const nowStr = getNowFormatted();

        // Step 1: Insert Abono record
        const abonoId = Sequences.getNext('ABO');
        const numeroRecibo = abonoId;

        const abonoRecord = {
          id: abonoId,
          numero_recibo: numeroRecibo,
          cuenta_cobrar_id: credit.id,
          cliente_id: credit.cliente_id,
          cliente_nombre: credit.cliente_nombre,
          venta_id: credit.venta_id || '',
          numero_venta: credit.numero_venta || '',
          saldo_anterior: saldoAnterior,
          monto_abonado: montoAbonado,
          saldo_restante: saldoRestante,
          metodo_pago: data.metodoPago || 'EFECTIVO',
          referencia: data.referencia || '',
          caja_sesion_id: data.cajaSesionId || '',
          usuario_id: user ? user.id : 'USR-001',
          usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
          observaciones: data.observaciones || '',
          fecha: nowStr,
          estado: 'ACTIVO',
          motivo_anulacion: '',
          anulado_por: '',
          fecha_anulacion: ''
        };

        DbHelper.insertRow('Abonos', abonoRecord);
        DbHelper.recordInsert(tx, 'Abonos', abonoId);

        // Step 2: Update Credit balance
        DbHelper.recordUpdate(tx, 'Creditos', credit.id, {
          monto_pagado: credit.monto_pagado,
          saldo_pendiente: credit.saldo_pendiente,
          estado: credit.estado
        });

        DbHelper.updateRowById('Creditos', credit.id, {
          monto_pagado: nuevoMontoPagado,
          saldo_pendiente: saldoRestante,
          estado: nuevoEstado
        });

        // Step 3: If cash payment and cash session provided, update Cash Register
        if (data.metodoPago === 'EFECTIVO' && data.cajaSesionId) {
          const cashSession = DbHelper.findById('Cajas', data.cajaSesionId);
          if (cashSession && cashSession.estado === 'ABIERTA') {
            const currentAbonosCash = Number(cashSession.abonos_efectivo) || 0;
            DbHelper.recordUpdate(tx, 'Cajas', data.cajaSesionId, { abonos_efectivo: currentAbonosCash });
            DbHelper.updateRowById('Cajas', data.cajaSesionId, {
              abonos_efectivo: currentAbonosCash + montoAbonado
            });

            const cmovId = Sequences.getNext('CMOV');
            const cashMov = {
              id: cmovId,
              caja_sesion_id: data.cajaSesionId,
              tipo: 'ABONO_EFECTIVO',
              monto: montoAbonado,
              motivo: `Cobro abono recibo ${numeroRecibo} (${credit.cliente_nombre})`,
              categoria_gasto: '',
              referencia: numeroRecibo,
              usuario_id: user ? user.id : 'USR-001',
              usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
              fecha: nowStr,
              estado: 'ACTIVO'
            };
            DbHelper.insertRow('Caja_Movimientos', cashMov);
            DbHelper.recordInsert(tx, 'Caja_Movimientos', cmovId);
          }
        }

        // Step 4: Audit
        AuditController.log(
          user,
          'ABONO_CREATED',
          'CREDITOS',
          'PaymentInstallment',
          abonoId,
          `Abono de RD$${montoAbonado.toLocaleString()} a cuenta ${credit.numero_credito} (${credit.cliente_nombre}). Saldo restante: RD$${saldoRestante.toLocaleString()}`
        );

        return {
          success: true,
          message: `Abono de RD$${montoAbonado.toLocaleString()} registrado con recibo ${numeroRecibo}.`,
          reciboId: abonoId,
          numeroRecibo: numeroRecibo,
          saldoRestante: saldoRestante,
          estadoCuenta: nuevoEstado
        };

      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  },

  /**
   * ATOMIC VOID ABONO
   * Reverts credit balance and cancels the payment receipt.
   */
  handleVoidAbono(data, user) {
    Security.requirePermission(user, 'creditos.anular_abonos');
    if (!data.abonoId || !data.motivo) {
      throw new Error('VALIDATION_ERROR: ID de abono y motivo de anulación requeridos.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const abono = DbHelper.findById('Abonos', data.abonoId);
      if (!abono) throw new Error('NOT_FOUND: Recibo de abono no encontrado.');

      if (abono.estado === 'ANULADO') {
        throw new Error('INVALID_STATE: Este abono ya fue anulado.');
      }

      const credit = DbHelper.findById('Creditos', abono.cuenta_cobrar_id);
      if (!credit) throw new Error('NOT_FOUND: Cuenta por cobrar asociada no encontrada.');

      // FASE 3.7B (hallazgo durante la integración real de credits.voidAbono):
      // esta operación escribía en Creditos, Abonos y potencialmente Cajas
      // sin el motor de compensación (DbHelper.beginTx/recordUpdate/rollback)
      // que sí usan handleRegisterAbono/handleCreateSale/handleCreateReturn/
      // handleVoidSale -- un fallo a mitad de camino podía dejar el saldo
      // restaurado pero el abono sin marcar ANULADO. Además, NUNCA revertía
      // el efecto en caja de un abono cobrado en efectivo: la caja seguía
      // reflejando el dinero como cobrado aunque la deuda del cliente ya
      // hubiera sido restaurada. Se aplica el mismo patrón ya establecido
      // (rollback + reversión de caja igual que ReturnsController).
      const tx = DbHelper.beginTx();
      try {
        const nowStr = getNowFormatted();
        const montoRestaurado = roundMoney(Number(abono.monto_abonado) || 0);
        const nuevoSaldo = roundMoney((Number(credit.saldo_pendiente) || 0) + montoRestaurado);
        const nuevoPagado = roundMoney(Math.max(0, (Number(credit.monto_pagado) || 0) - montoRestaurado));

        // Revert credit
        DbHelper.recordUpdate(tx, 'Creditos', credit.id, {
          monto_pagado: credit.monto_pagado,
          saldo_pendiente: credit.saldo_pendiente,
          estado: credit.estado
        });
        DbHelper.updateRowById('Creditos', credit.id, {
          monto_pagado: nuevoPagado,
          saldo_pendiente: nuevoSaldo,
          estado: nuevoSaldo > 0 ? 'PARCIAL' : 'PAGADA'
        });

        // Void abono
        DbHelper.recordUpdate(tx, 'Abonos', data.abonoId, {
          estado: abono.estado,
          motivo_anulacion: abono.motivo_anulacion,
          anulado_por: abono.anulado_por,
          fecha_anulacion: abono.fecha_anulacion
        });
        DbHelper.updateRowById('Abonos', data.abonoId, {
          estado: 'ANULADO',
          motivo_anulacion: data.motivo,
          anulado_por: user ? user.id : 'USR-001',
          fecha_anulacion: nowStr
        });

        // Reverse the cash effect if the abono was collected in cash and
        // there is a currently open cash session (mismo criterio que
        // ReturnsController.handleCreateReturn: se revierte contra la caja
        // ABIERTA actual, no necesariamente la misma sesión original).
        if (abono.metodo_pago === 'EFECTIVO') {
          const activeCash = DbHelper.findRows('Cajas', s => s.estado === 'ABIERTA')[0];
          if (activeCash) {
            const currentAbonosCash = Number(activeCash.abonos_efectivo) || 0;
            DbHelper.recordUpdate(tx, 'Cajas', activeCash.id, { abonos_efectivo: currentAbonosCash });
            DbHelper.updateRowById('Cajas', activeCash.id, {
              abonos_efectivo: Math.max(0, currentAbonosCash - montoRestaurado)
            });

            const cmovId = Sequences.getNext('CMOV');
            DbHelper.insertRow('Caja_Movimientos', {
              id: cmovId,
              caja_sesion_id: activeCash.id,
              tipo: 'REVERSION_ABONO',
              monto: montoRestaurado,
              motivo: `Reversión de abono ${abono.numero_recibo} anulado (${credit.cliente_nombre})`,
              categoria_gasto: '',
              referencia: abono.numero_recibo,
              usuario_id: user ? user.id : 'USR-001',
              usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
              fecha: nowStr,
              estado: 'ACTIVO'
            });
            DbHelper.recordInsert(tx, 'Caja_Movimientos', cmovId);
          }
        }

        AuditController.log(
          user,
          'ABONO_VOIDED',
          'CREDITOS',
          'PaymentInstallment',
          data.abonoId,
          `Abono ${abono.numero_recibo} anulado por RD$${montoRestaurado.toLocaleString()}. Motivo: ${data.motivo}`
        );

        return {
          success: true,
          message: `Recibo de abono ${abono.numero_recibo} anulado. Saldo restaurado a RD$${nuevoSaldo.toLocaleString()}.`
        };
      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  }
};
