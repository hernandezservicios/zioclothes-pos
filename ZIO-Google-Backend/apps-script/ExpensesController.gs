/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: ExpensesController.gs
 * Description: Operational expenses tracking, categorisation, and active cash drawer synchronization.
 */

const ExpensesController = {
  /**
   * Returns operational expenses sorted by date descending.
   */
  handleListExpenses(data) {
    const expenses = DbHelper.getAllRows('Gastos');
    expenses.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    return {
      success: true,
      expenses: expenses.map(g => ({
        id: g.id,
        numeroGasto: g.numero_gasto,
        categoria: g.categoria,
        descripcion: g.descripcion,
        proveedor: g.proveedor || '',
        monto: Number(g.monto) || 0,
        metodoPago: g.metodo_pago,
        comprobante: g.comprobante || '',
        cajaSesionId: g.caja_sesion_id || undefined,
        usuarioId: g.usuario_id,
        usuarioNombre: g.usuario_nombre,
        fecha: g.fecha,
        pagadoConCajaActiva: g.pagado_con_caja_activa === true || g.pagado_con_caja_activa === 'TRUE' || g.pagado_con_caja_activa === 'true'
      }))
    };
  },

  /**
   * ATOMIC EXPENSE CREATION
   */
  handleCreateExpense(data, user) {
    Security.requirePermission(user, 'gastos.crear');

    if (!data.categoria || !data.descripcion || !data.monto) {
      throw new Error('VALIDATION_ERROR: Categoría, descripción y monto son obligatorios.');
    }

    const monto = Number(data.monto);
    if (isNaN(monto) || monto <= 0) {
      throw new Error('VALIDATION_ERROR: El monto del gasto debe ser mayor que cero.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const tx = DbHelper.beginTx();

      try {
        const gasId = Sequences.getNext('GAS');
        const nowStr = getNowFormatted();
        const pagadoConCaja = data.pagadoConCajaActiva === true || data.metodoPago === 'EFECTIVO';
        let cajaId = '';

        if (pagadoConCaja) {
          const activeCash = DbHelper.findRows('Cajas', s => s.estado === 'ABIERTA')[0];
          if (activeCash) {
            cajaId = activeCash.id;
            const currentGastos = Number(activeCash.gastos) || 0;

            DbHelper.recordUpdate(tx, 'Cajas', cajaId, { gastos: currentGastos });
            DbHelper.updateRowById('Cajas', cajaId, { gastos: currentGastos + monto });

            const cmovId = Sequences.getNext('CMOV');
            const cashMov = {
              id: cmovId,
              caja_sesion_id: cajaId,
              tipo: 'GASTO',
              monto: monto,
              motivo: `Gasto: ${data.descripcion}`,
              categoria_gasto: data.categoria,
              referencia: gasId,
              usuario_id: user ? user.id : 'USR-001',
              usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Sistema',
              fecha: nowStr,
              estado: 'ACTIVO'
            };
            DbHelper.insertRow('Caja_Movimientos', cashMov);
            DbHelper.recordInsert(tx, 'Caja_Movimientos', cmovId);
          }
        }

        const expenseRecord = {
          id: gasId,
          numero_gasto: gasId,
          categoria: data.categoria,
          descripcion: data.descripcion.trim(),
          proveedor: (data.proveedor || '').trim(),
          monto: monto,
          metodo_pago: data.metodoPago || 'EFECTIVO',
          comprobante: (data.comprobante || '').trim(),
          caja_sesion_id: cajaId,
          usuario_id: user ? user.id : 'USR-001',
          usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Usuario',
          fecha: nowStr,
          pagado_con_caja_activa: pagadoConCaja && cajaId ? 'TRUE' : 'FALSE'
        };

        DbHelper.insertRow('Gastos', expenseRecord);
        DbHelper.recordInsert(tx, 'Gastos', gasId);

        AuditController.log(
          user,
          'EXPENSE_CREATED',
          'GASTOS',
          'Expense',
          gasId,
          `Gasto registrado por RD$${monto.toLocaleString()} (${data.categoria}): ${data.descripcion}`
        );

        return {
          success: true,
          message: `Gasto ${gasId} registrado exitosamente por RD$${monto.toLocaleString()}.`,
          gastoId: gasId
        };

      } catch (err) {
        DbHelper.rollback(tx, err);
        throw err;
      }
    });
  }
};
