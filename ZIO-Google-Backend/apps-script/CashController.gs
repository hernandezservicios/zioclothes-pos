/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: CashController.gs
 * Description: Cash register session management, opening floats, cash drawer movements,
 * blind audit counts, and atomic session close calculations.
 */

const CashController = {
  /**
   * Returns the currently open cash session (if any) along with its movements and real-time expected cash.
   */
  handleGetActiveSession() {
    const sessions = DbHelper.getAllRows('Cajas');
    const active = sessions.find(s => s.estado === 'ABIERTA');

    if (!active) {
      return {
        success: true,
        activeSession: null
      };
    }

    const movements = DbHelper.findRows('Caja_Movimientos', m => m.caja_sesion_id === active.id);
    movements.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

    const montoInicial = Number(active.monto_inicial) || 0;
    const ventasEfectivo = Number(active.ventas_efectivo) || 0;
    const abonosEfectivo = Number(active.abonos_efectivo) || 0;
    const ingresosManuales = Number(active.ingresos_manuales) || 0;
    const retirosManuales = Number(active.retiros_manuales) || 0;
    const gastos = Number(active.gastos) || 0;
    const devolucionesEfectivo = Number(active.devoluciones_efectivo) || 0;

    const efectivoEsperado = montoInicial + ventasEfectivo + abonosEfectivo + ingresosManuales - retirosManuales - gastos - devolucionesEfectivo;

    return {
      success: true,
      activeSession: {
        id: active.id,
        codigoCaja: active.codigo_caja,
        cajaNombre: active.caja_nombre || 'Caja Principal',
        cajeroId: active.cajero_id,
        cajeroNombre: active.cajero_nombre,
        usuarioAperturaNombre: active.usuario_apertura_nombre || active.cajero_nombre,
        montoInicial: montoInicial,
        fechaApertura: active.fecha_apertura,
        observacionApertura: active.observacion_apertura || '',
        estado: active.estado,
        ventasEfectivo: ventasEfectivo,
        abonosEfectivo: abonosEfectivo,
        ingresosManuales: ingresosManuales,
        retirosManuales: retirosManuales,
        gastos: gastos,
        devolucionesEfectivo: devolucionesEfectivo,
        efectivoEsperado: efectivoEsperado,
        efectivoRealContado: active.efectivo_real_contado ? Number(active.efectivo_real_contado) : undefined,
        diferencia: active.diferencia !== undefined && active.diferencia !== '' ? Number(active.diferencia) : undefined,
        fechaCierre: active.fecha_cierre || undefined,
        observacionCierre: active.observacion_cierre || undefined,
        movimientos: movements
      }
    };
  },

  /**
   * Returns all cash sessions (history).
   */
  handleListSessions() {
    const sessions = DbHelper.getAllRows('Cajas');
    sessions.sort((a, b) => String(b.fecha_apertura || '').localeCompare(String(a.fecha_apertura || '')));

    return {
      success: true,
      sessions: sessions.map(s => ({
        id: s.id,
        codigoCaja: s.codigo_caja,
        cajaNombre: s.caja_nombre || 'Caja Principal',
        cajeroId: s.cajero_id,
        cajeroNombre: s.cajero_nombre,
        montoInicial: Number(s.monto_inicial) || 0,
        fechaApertura: s.fecha_apertura,
        estado: s.estado,
        ventasEfectivo: Number(s.ventas_efectivo) || 0,
        abonosEfectivo: Number(s.abonos_efectivo) || 0,
        ingresosManuales: Number(s.ingresos_manuales) || 0,
        retirosManuales: Number(s.retiros_manuales) || 0,
        gastos: Number(s.gastos) || 0,
        devolucionesEfectivo: Number(s.devoluciones_efectivo) || 0,
        efectivoEsperado: Number(s.efectivo_esperado) || 0,
        efectivoRealContado: s.efectivo_real_contado ? Number(s.efectivo_real_contado) : undefined,
        diferencia: s.diferencia !== undefined && s.diferencia !== '' ? Number(s.diferencia) : undefined,
        fechaCierre: s.fecha_cierre || undefined,
        observacionCierre: s.observacion_cierre || undefined
      }))
    };
  },

  /**
   * ATOMIC CASH OPEN
   */
  handleOpenSession(data, user) {
    Security.requirePermission(user, 'caja.abrir');

    const montoInicial = Number(data.montoInicial || 0);
    if (isNaN(montoInicial) || montoInicial < 0) {
      throw new Error('VALIDATION_ERROR: El fondo inicial debe ser un número mayor o igual a 0.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const sessions = DbHelper.getAllRows('Cajas');
      const alreadyOpen = sessions.find(s => s.estado === 'ABIERTA');

      if (alreadyOpen) {
        throw new Error(`CASH_ALREADY_OPEN: Ya existe una caja abierta (${alreadyOpen.codigo_caja}). Debe cerrarla antes de iniciar un nuevo turno.`);
      }

      const cajaId = Sequences.getNext('CAJA');
      const nowStr = getNowFormatted();

      const newSession = {
        id: cajaId,
        codigo_caja: cajaId,
        caja_nombre: data.cajaNombre || 'Caja Principal 01',
        cajero_id: user ? user.id : 'USR-001',
        cajero_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
        usuario_apertura_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Supervisor',
        monto_inicial: montoInicial,
        fecha_apertura: nowStr,
        observacion_apertura: data.observacionApertura || '',
        estado: 'ABIERTA',
        ventas_efectivo: 0,
        abonos_efectivo: 0,
        ingresos_manuales: 0,
        retiros_manuales: 0,
        gastos: 0,
        devoluciones_efectivo: 0,
        efectivo_esperado: montoInicial,
        efectivo_real_contado: '',
        diferencia: '',
        fecha_cierre: '',
        observacion_cierre: ''
      };

      DbHelper.insertRow('Cajas', newSession);

      AuditController.log(
        user,
        'CASH_OPENED',
        'CAJA',
        'CashSession',
        cajaId,
        `Apertura de turno de caja con fondo inicial de RD$${montoInicial.toLocaleString()}`
      );

      return {
        success: true,
        message: `Turno de caja ${cajaId} abierto correctamente.`,
        session: newSession
      };
    });
  },

  /**
   * ATOMIC CASH CLOSE (Arqueo de Turno)
   */
  handleCloseSession(data, user) {
    Security.requirePermission(user, 'caja.cerrar');

    if (data.efectivoRealContado === undefined || data.efectivoRealContado === null) {
      throw new Error('VALIDATION_ERROR: Debe indicar el monto de efectivo real contado en el arqueo.');
    }

    const efectivoReal = Number(data.efectivoRealContado);
    if (isNaN(efectivoReal) || efectivoReal < 0) {
      throw new Error('VALIDATION_ERROR: El efectivo contado no puede ser negativo.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const active = DbHelper.findRows('Cajas', s => s.estado === 'ABIERTA')[0];
      if (!active) {
        throw new Error('NOT_FOUND: No hay ningún turno de caja abierto para cerrar.');
      }

      const montoInicial = Number(active.monto_inicial) || 0;
      const ventasEfectivo = Number(active.ventas_efectivo) || 0;
      const abonosEfectivo = Number(active.abonos_efectivo) || 0;
      const ingresosManuales = Number(active.ingresos_manuales) || 0;
      const retirosManuales = Number(active.retiros_manuales) || 0;
      const gastos = Number(active.gastos) || 0;
      const devolucionesEfectivo = Number(active.devoluciones_efectivo) || 0;

      const esperado = montoInicial + ventasEfectivo + abonosEfectivo + ingresosManuales - retirosManuales - gastos - devolucionesEfectivo;
      const diferencia = efectivoReal - esperado;
      const nowStr = getNowFormatted();

      DbHelper.updateRowById('Cajas', active.id, {
        estado: 'CERRADA',
        efectivo_esperado: esperado,
        efectivo_real_contado: efectivoReal,
        diferencia: diferencia,
        fecha_cierre: nowStr,
        observacion_cierre: data.observacionCierre || ''
      });

      AuditController.log(
        user,
        'CASH_CLOSED',
        'CAJA',
        'CashSession',
        active.id,
        `Cierre de caja ${active.codigo_caja}. Esperado: RD$${esperado.toLocaleString()}, Contado: RD$${efectivoReal.toLocaleString()}, Diferencia: RD$${diferencia.toLocaleString()}`
      );

      return {
        success: true,
        message: `Turno ${active.codigo_caja} cerrado exitosamente.`,
        efectivoEsperado: esperado,
        efectivoRealContado: efectivoReal,
        diferencia: diferencia
      };
    });
  },

  /**
   * Manual cash movement (INGRESO or RETIRO)
   */
  handleAddMovement(data, user) {
    Security.requirePermission(user, 'caja.movimientos');

    if (!data.tipo || !data.monto || !data.motivo) {
      throw new Error('VALIDATION_ERROR: Tipo, monto y motivo son obligatorios.');
    }

    const monto = Number(data.monto);
    if (isNaN(monto) || monto <= 0) {
      throw new Error('VALIDATION_ERROR: El monto debe ser mayor que cero.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const active = DbHelper.findRows('Cajas', s => s.estado === 'ABIERTA')[0];
      if (!active) {
        throw new Error('NOT_FOUND: No hay ningún turno de caja abierto para registrar movimientos.');
      }

      const tipo = data.tipo.toUpperCase();
      if (tipo !== 'INGRESO' && tipo !== 'RETIRO') {
        throw new Error('VALIDATION_ERROR: El tipo debe ser INGRESO o RETIRO.');
      }

      const cmovId = Sequences.getNext('CMOV');
      const nowStr = getNowFormatted();

      // Update session accumulated values
      if (tipo === 'INGRESO') {
        const currentIng = Number(active.ingresos_manuales) || 0;
        DbHelper.updateRowById('Cajas', active.id, { ingresos_manuales: currentIng + monto });
      } else {
        const currentRet = Number(active.retiros_manuales) || 0;
        DbHelper.updateRowById('Cajas', active.id, { retiros_manuales: currentRet + monto });
      }

      // Insert movement
      DbHelper.insertRow('Caja_Movimientos', {
        id: cmovId,
        caja_sesion_id: active.id,
        tipo: tipo,
        monto: monto,
        motivo: data.motivo.trim(),
        categoria_gasto: '',
        referencia: data.referencia || '',
        usuario_id: user ? user.id : 'USR-001',
        usuario_nombre: user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Cajero',
        fecha: nowStr,
        estado: 'ACTIVO'
      });

      AuditController.log(
        user,
        `CASH_${tipo}`,
        'CAJA',
        'CashMovement',
        cmovId,
        `${tipo} manual de RD$${monto.toLocaleString()} en caja: ${data.motivo}`
      );

      return {
        success: true,
        message: `${tipo} de RD$${monto.toLocaleString()} registrado exitosamente en la caja activa.`
      };
    });
  }
};
