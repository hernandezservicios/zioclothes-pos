/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: CustomersController.gs
 * Description: Customer directory, commercial credit limit validation, and receivables summary.
 */

const CustomersController = {
  /**
   * Returns list of customers enriched with current live credit balance and available credit.
   */
  handleListCustomers() {
    const customers = DbHelper.getAllRows('Clientes');
    const credits = DbHelper.getAllRows('Creditos');

    // Aggregate active debt by customer_id
    const debtByCustomer = {};
    credits.forEach(c => {
      if (c.estado !== 'PAGADA' && c.estado !== 'ANULADA') {
        const cId = String(c.cliente_id).trim();
        const pending = Number(c.saldo_pendiente) || 0;
        debtByCustomer[cId] = (debtByCustomer[cId] || 0) + pending;
      }
    });

    const enriched = customers.map(c => {
      const cId = String(c.id).trim();
      const deuda = debtByCustomer[cId] || 0;
      const limit = Number(c.limite_credito) || 0;
      const disponible = Math.max(0, limit - deuda);

      return {
        id: c.id,
        nombre: c.nombre,
        apellido: c.apellido || '',
        nombreCompleto: `${c.nombre} ${c.apellido || ''}`.trim(),
        documento: c.documento || '',
        telefono: c.telefono || '',
        correo: c.correo || '',
        direccion: c.direccion || '',
        ciudad: c.ciudad || '',
        limiteCredito: limit,
        diasCreditoPorDefecto: Number(c.dias_credito_por_defecto) || 15,
        saldoPendiente: deuda,
        creditoDisponible: disponible,
        notas: c.notas || '',
        estado: c.estado || 'ACTIVO',
        creadoEn: c.creado_en
      };
    });

    return {
      success: true,
      customers: enriched
    };
  },

  /**
   * Creates or updates a customer.
   */
  handleSaveCustomer(data, user) {
    if (data.id) {
      Security.requirePermission(user, 'clientes.editar');
    } else {
      Security.requirePermission(user, 'clientes.crear');
    }

    if (!data.nombre || !data.telefono) {
      throw new Error('VALIDATION_ERROR: Nombre y teléfono del cliente son requeridos.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const isUpdate = !!data.id;
      let customerId = data.id;

      if (!isUpdate) {
        customerId = Sequences.getNext('CLI');
      }

      const record = {
        id: customerId,
        nombre: data.nombre.trim(),
        apellido: (data.apellido || '').trim(),
        documento: (data.documento || '').trim(),
        telefono: (data.telefono || '').trim(),
        correo: (data.correo || '').trim().toLowerCase(),
        direccion: (data.direccion || '').trim(),
        ciudad: (data.ciudad || '').trim(),
        limite_credito: data.limiteCredito !== undefined ? Number(data.limiteCredito) : 0,
        dias_credito_por_defecto: data.diasCreditoPorDefecto ? Number(data.diasCreditoPorDefecto) : 15,
        notas: (data.notas || '').trim(),
        estado: data.estado || 'ACTIVO',
        creado_en: data.creadoEn || getNowFormatted()
      };

      if (isUpdate) {
        DbHelper.updateRowById('Clientes', customerId, record);
      } else {
        DbHelper.insertRow('Clientes', record);
      }

      AuditController.log(
        user,
        isUpdate ? 'CUSTOMER_UPDATED' : 'CUSTOMER_CREATED',
        'CLIENTES',
        'Customer',
        customerId,
        `${isUpdate ? 'Actualización' : 'Registro'} de cliente: ${record.nombre} ${record.apellido} (${customerId})`
      );

      return {
        success: true,
        message: `Cliente ${isUpdate ? 'actualizado' : 'registrado'} exitosamente.`,
        customerId: customerId
      };
    });
  }
};
