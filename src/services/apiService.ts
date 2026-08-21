import {
  Sale,
  AccountReceivable,
  PaymentInstallment,
  CashSession,
  Product,
  Customer,
  Expense,
  InventoryMovement,
  ReturnRecord,
  SystemSettings,
  User,
  UserRole,
  PermissionCode,
} from '../types';
import { storageService } from './storageService';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errorCode?: string;
}

class ApiService {
  // Check if current user has permission
  public hasPermission(permission: PermissionCode): boolean {
    const user = storageService.getCurrentUser();
    if (!user) return false;
    if (user.estado !== 'ACTIVO') return false;
    if (user.rol === 'ADMIN') return true;

    const roleConfigs = storageService.getRolePermissions();
    const permissions = roleConfigs[user.rol] || [];
    return permissions.includes(permission);
  }

  // Google Apps Script Proxy Dispatcher
  public async syncWithGoogleAppsScript(action: string, payload: any = {}): Promise<ApiResponse> {
    const settings = storageService.getSettings();
    const url = settings.googleAppsScriptUrl;
    if (!url || !url.startsWith('http')) {
      return {
        success: false,
        message: 'No se ha configurado la URL del Web App de Google Apps Script.',
        errorCode: 'URL_NOT_CONFIGURED',
      };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps script friendly
        body: JSON.stringify({
          action,
          payload,
          user: storageService.getCurrentUser(),
          timestamp: new Date().toISOString(),
        }),
      });
      const data = await response.json();
      return data;
    } catch (error: any) {
      console.warn('Google Apps Script request error:', error);
      return {
        success: false,
        message: `Error al conectar con Google Apps Script: ${error.message || error}`,
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  // --- SALES & POS TRANSACTION ---
  public async createSale(saleData: Omit<Sale, 'id' | 'numeroVenta' | 'fecha' | 'costoTotal'>): Promise<ApiResponse<Sale>> {
    if (!this.hasPermission('ventas.crear')) {
      return { success: false, message: 'No tiene permisos para crear ventas', errorCode: 'PERMISSION_DENIED' };
    }

    const products = storageService.getProducts();
    const movements = storageService.getMovements();
    const currentUser = storageService.getCurrentUser();
    const activeCash = storageService.getActiveCashSession();

    // 1. Verify Stock for every item & variant
    for (const item of saleData.items) {
      const product = products.find((p) => p.id === item.productoId);
      if (!product) {
        return { success: false, message: `Producto "${item.nombreProducto}" no existe`, errorCode: 'PRODUCT_NOT_FOUND' };
      }
      const variant = product.variantes.find((v) => v.id === item.varianteId);
      if (!variant) {
        return { success: false, message: `Variante talla ${item.talla} / color ${item.color} no existe`, errorCode: 'VARIANT_NOT_FOUND' };
      }
      if (variant.stock < item.cantidad) {
        return {
          success: false,
          message: `Stock insuficiente para ${product.nombre} (${variant.talla} / ${variant.color}). Disponible: ${variant.stock}, Solicitado: ${item.cantidad}`,
          errorCode: 'INSUFFICIENT_STOCK',
        };
      }
    }

    // 2. If Credit Sale: Validate Customer and Credit Limit
    let cuentaCobrar: AccountReceivable | undefined;
    if (saleData.esCredito && saleData.montoFinanciado && saleData.montoFinanciado > 0) {
      if (!saleData.clienteId) {
        return { success: false, message: 'Debe seleccionar un cliente registrado para ventas a crédito', errorCode: 'CUSTOMER_REQUIRED' };
      }
      const customer = storageService.getCustomers().find((c) => c.id === saleData.clienteId);
      if (!customer) {
        return { success: false, message: 'Cliente no encontrado', errorCode: 'CUSTOMER_NOT_FOUND' };
      }

      // Calculate current debt
      const activeCredits = storageService.getCredits().filter(
        (c) => c.clienteId === customer.id && (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL' || c.estado === 'VENCIDA')
      );
      const currentDebt = activeCredits.reduce((acc, c) => acc + c.saldoPendiente, 0);
      const availableCredit = customer.limiteCredito - currentDebt;

      if (saleData.montoFinanciado > availableCredit && customer.limiteCredito > 0) {
        return {
          success: false,
          message: `El monto solicitado (RD$${saleData.montoFinanciado.toLocaleString()}) excede el crédito disponible de este cliente (RD$${Math.max(0, availableCredit).toLocaleString()}). Límite: RD$${customer.limiteCredito.toLocaleString()}, Deuda actual: RD$${currentDebt.toLocaleString()}`,
          errorCode: 'CREDIT_LIMIT_EXCEEDED',
        };
      }
    }

    // 3. Deduct Stock & Record Inventory Movement
    let calculatedCostoTotal = 0;
    const updatedProducts = [...products];

    for (const item of saleData.items) {
      const pIndex = updatedProducts.findIndex((p) => p.id === item.productoId);
      const vIndex = updatedProducts[pIndex].variantes.findIndex((v) => v.id === item.varianteId);
      const variant = updatedProducts[pIndex].variantes[vIndex];

      calculatedCostoTotal += variant.costo * item.cantidad;
      const stockAnterior = variant.stock;
      const stockNuevo = stockAnterior - item.cantidad;
      updatedProducts[pIndex].variantes[vIndex].stock = stockNuevo;

      // Log movement
      const movId = storageService.getNextSequence('MOV');
      movements.unshift({
        id: movId,
        productoId: item.productoId,
        productoNombre: item.nombreProducto,
        varianteId: item.varianteId,
        sku: item.sku,
        talla: item.talla,
        color: item.color,
        cantidad: -item.cantidad,
        tipo: 'VENTA',
        stockAnterior,
        stockNuevo,
        motivo: `Venta en POS`,
        usuarioId: currentUser.id,
        usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      });
    }
    storageService.saveProducts(updatedProducts);
    storageService.saveMovements(movements);

    // 4. Generate Sale Record
    const numeroVenta = storageService.getNextSequence('VEN');
    const saleId = `SALE-${Date.now()}`;
    const newSale: Sale = {
      ...saleData,
      id: saleId,
      numeroVenta,
      costoTotal: calculatedCostoTotal,
      cajaSesionId: activeCash?.id,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };

    // 5. If Credit, generate Account Receivable
    if (newSale.esCredito && newSale.montoFinanciado && newSale.montoFinanciado > 0) {
      const creditNum = storageService.getNextSequence('CRED');
      const settings = storageService.getSettings();
      const customer = storageService.getCustomers().find((c) => c.id === newSale.clienteId);
      const diasPlazo = customer?.diasCreditoPorDefecto || settings.diasVencimientoPorDefecto || 30;

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + diasPlazo);

      cuentaCobrar = {
        id: `CREDIT-${Date.now()}`,
        numeroCredito: creditNum,
        clienteId: newSale.clienteId!,
        clienteNombre: newSale.clienteNombre,
        clienteTelefono: customer?.telefono || '',
        ventaId: saleId,
        numeroVenta: numeroVenta,
        montoOriginal: newSale.montoFinanciado,
        montoPagado: 0,
        saldoPendiente: newSale.montoFinanciado,
        fechaCreacion: newSale.fecha,
        fechaVencimiento: dueDate.toISOString().replace('T', ' ').substring(0, 19),
        diasPlazo,
        estado: 'PENDIENTE',
        observaciones: `Crédito originado por la venta ${numeroVenta}`,
        creadoPor: currentUser.id,
      };

      const credits = storageService.getCredits();
      credits.unshift(cuentaCobrar);
      storageService.saveCredits(credits);
      newSale.cuentaCobrarId = cuentaCobrar.id;
    }

    // 6. Save Sale
    const sales = storageService.getSales();
    sales.unshift(newSale);
    storageService.saveSales(sales);

    // 7. Update Cash Register if cash was paid
    const cashPaid = newSale.pagos
      .filter((p) => p.metodo === 'EFECTIVO')
      .reduce((acc, p) => acc + p.monto, 0);

    if (cashPaid > 0 && activeCash) {
      const cashSessions = storageService.getCashSessions();
      const sIndex = cashSessions.findIndex((s) => s.id === activeCash.id);
      if (sIndex !== -1) {
        cashSessions[sIndex].ventasEfectivo += cashPaid;
        cashSessions[sIndex].efectivoEsperado += cashPaid;
        storageService.saveCashSessions(cashSessions);
      }
    }

    // 8. Audit Log
    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'SALE',
      modulo: 'VENTAS',
      entidad: 'Sale',
      entidadId: saleId,
      descripcion: `Venta ${numeroVenta} procesada por RD$${newSale.total.toLocaleString()} a ${newSale.clienteNombre} (${newSale.metodoPago})`,
      resultado: 'EXITO',
      datosNuevos: { numeroVenta, total: newSale.total, itemsCount: newSale.items.length },
    });

    return {
      success: true,
      message: `Venta ${numeroVenta} completada exitosamente`,
      data: newSale,
    };
  }

  // --- INSTALLMENT / ABONO REGISTRATION ---
  public async registerInstallment(data: {
    cuentaCobrarId: string;
    monto: number;
    metodoPago: PaymentInstallment['metodoPago'];
    referencia?: string;
    observaciones?: string;
  }): Promise<ApiResponse<PaymentInstallment>> {
    if (!this.hasPermission('creditos.abonos')) {
      return { success: false, message: 'No tiene permisos para registrar abonos', errorCode: 'PERMISSION_DENIED' };
    }

    const credits = storageService.getCredits();
    const creditIndex = credits.findIndex((c) => c.id === data.cuentaCobrarId);
    if (creditIndex === -1) {
      return { success: false, message: 'Cuenta por cobrar no encontrada', errorCode: 'CREDIT_NOT_FOUND' };
    }

    const credit = credits[creditIndex];
    if (credit.saldoPendiente <= 0 || credit.estado === 'PAGADA' || credit.estado === 'ANULADA') {
      return { success: false, message: 'Esta cuenta ya se encuentra saldada o anulada', errorCode: 'CREDIT_ALREADY_PAID' };
    }

    if (data.monto <= 0) {
      return { success: false, message: 'El monto del abono debe ser mayor a cero', errorCode: 'INVALID_AMOUNT' };
    }

    if (data.monto > credit.saldoPendiente) {
      return {
        success: false,
        message: `El abono (RD$${data.monto.toLocaleString()}) no puede ser mayor que el saldo pendiente (RD$${credit.saldoPendiente.toLocaleString()})`,
        errorCode: 'AMOUNT_EXCEEDS_DEBT',
      };
    }

    const currentUser = storageService.getCurrentUser();
    const activeCash = storageService.getActiveCashSession();
    const receiptNum = storageService.getNextSequence('ABO');

    const saldoAnterior = credit.saldoPendiente;
    const saldoRestante = Math.max(0, saldoAnterior - data.monto);
    const nuevoMontoPagado = credit.montoPagado + data.monto;

    // Update credit
    credit.montoPagado = nuevoMontoPagado;
    credit.saldoPendiente = saldoRestante;
    credit.estado = saldoRestante === 0 ? 'PAGADA' : 'PARCIAL';
    credits[creditIndex] = credit;
    storageService.saveCredits(credits);

    // Create installment receipt
    const installment: PaymentInstallment = {
      id: `INST-${Date.now()}`,
      numeroRecibo: receiptNum,
      cuentaCobrarId: credit.id,
      clienteId: credit.clienteId,
      clienteNombre: credit.clienteNombre,
      ventaId: credit.ventaId,
      numeroVenta: credit.numeroVenta,
      saldoAnterior,
      montoAbonado: data.monto,
      saldoRestante,
      metodoPago: data.metodoPago,
      referencia: data.referencia,
      cajaSesionId: activeCash?.id,
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      observaciones: data.observaciones,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      estado: 'ACTIVO',
    };

    const installments = storageService.getInstallments();
    installments.unshift(installment);
    storageService.saveInstallments(installments);

    // Update cash register if cash
    if (data.metodoPago === 'EFECTIVO' && activeCash) {
      const cashSessions = storageService.getCashSessions();
      const sIndex = cashSessions.findIndex((s) => s.id === activeCash.id);
      if (sIndex !== -1) {
        cashSessions[sIndex].abonosEfectivo += data.monto;
        cashSessions[sIndex].efectivoEsperado += data.monto;
        storageService.saveCashSessions(cashSessions);
      }
    }

    // Audit log
    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'PAYMENT_CREATED',
      modulo: 'CREDITOS',
      entidad: 'PaymentInstallment',
      entidadId: installment.id,
      descripcion: `Abono ${receiptNum} por RD$${data.monto.toLocaleString()} registrado para ${credit.clienteNombre} (${credit.numeroCredito}). Saldo restante: RD$${saldoRestante.toLocaleString()}`,
      resultado: 'EXITO',
      datosNuevos: { receiptNum, monto: data.monto, saldoRestante },
    });

    return {
      success: true,
      message: `Abono de RD$${data.monto.toLocaleString()} registrado con éxito. Comprobante: ${receiptNum}`,
      data: installment,
    };
  }

  // --- VOID SALE ---
  public async voidSale(saleId: string, motivo: string): Promise<ApiResponse> {
    if (!this.hasPermission('ventas.anular')) {
      return { success: false, message: 'No tiene permisos para anular ventas', errorCode: 'PERMISSION_DENIED' };
    }

    const sales = storageService.getSales();
    const saleIndex = sales.findIndex((s) => s.id === saleId);
    if (saleIndex === -1) {
      return { success: false, message: 'Venta no encontrada', errorCode: 'SALE_NOT_FOUND' };
    }

    const sale = sales[saleIndex];
    if (sale.estado === 'ANULADA') {
      return { success: false, message: 'Esta venta ya se encuentra anulada', errorCode: 'SALE_ALREADY_VOID' };
    }

    const currentUser = storageService.getCurrentUser();
    const products = storageService.getProducts();
    const movements = storageService.getMovements();

    // 1. Revert Inventory
    for (const item of sale.items) {
      const pIndex = products.findIndex((p) => p.id === item.productoId);
      if (pIndex !== -1) {
        const vIndex = products[pIndex].variantes.findIndex((v) => v.id === item.varianteId);
        if (vIndex !== -1) {
          const variant = products[pIndex].variantes[vIndex];
          const stockAnterior = variant.stock;
          const stockNuevo = stockAnterior + item.cantidad;
          products[pIndex].variantes[vIndex].stock = stockNuevo;

          movements.unshift({
            id: storageService.getNextSequence('MOV'),
            productoId: item.productoId,
            productoNombre: item.nombreProducto,
            varianteId: item.varianteId,
            sku: item.sku,
            talla: item.talla,
            color: item.color,
            cantidad: item.cantidad,
            tipo: 'DEVOLUCION',
            stockAnterior,
            stockNuevo,
            motivo: `Anulación de venta ${sale.numeroVenta}: ${motivo}`,
            usuarioId: currentUser.id,
            usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
            fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
          });
        }
      }
    }
    storageService.saveProducts(products);
    storageService.saveMovements(movements);

    // 2. Revert Credit if credit sale
    if (sale.cuentaCobrarId) {
      const credits = storageService.getCredits();
      const cIndex = credits.findIndex((c) => c.id === sale.cuentaCobrarId);
      if (cIndex !== -1) {
        credits[cIndex].estado = 'ANULADA';
        credits[cIndex].observaciones = `Anulada por motivo: ${motivo}`;
        storageService.saveCredits(credits);
      }
    }

    // 3. Mark Sale as Voided
    sale.estado = 'ANULADA';
    sale.motivoAnulacion = motivo;
    sale.anuladaPor = `${currentUser.nombre} ${currentUser.apellido}`;
    sale.fechaAnulacion = new Date().toISOString().replace('T', ' ').substring(0, 19);
    sales[saleIndex] = sale;
    storageService.saveSales(sales);

    // 4. Audit Log
    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'VOID',
      modulo: 'VENTAS',
      entidad: 'Sale',
      entidadId: sale.id,
      descripcion: `Venta ${sale.numeroVenta} anulada por ${currentUser.nombre}. Motivo: ${motivo}`,
      resultado: 'EXITO',
    });

    return {
      success: true,
      message: `Venta ${sale.numeroVenta} anulada e inventario restablecido correctamente.`,
    };
  }

  // --- CASH REGISTER MANAGEMENT ---
  public async openCashSession(
    param: number | { montoInicial: number; usuarioId?: string; usuarioNombre?: string; cajaNombre?: string; observacion?: string },
    observacion?: string
  ): Promise<ApiResponse<CashSession>> {
    if (!this.hasPermission('caja.abrir')) {
      return { success: false, message: 'No tiene permisos para abrir caja', errorCode: 'PERMISSION_DENIED' };
    }

    const active = storageService.getActiveCashSession();
    if (active) {
      return { success: false, message: `Ya existe una caja abierta (${active.codigoCaja})`, errorCode: 'CASH_ALREADY_OPEN' };
    }

    const currentUser = storageService.getCurrentUser();
    const codigoCaja = storageService.getNextSequence('CAJA');
    const montoInicial = typeof param === 'number' ? param : param.montoInicial;
    const obs = typeof param === 'object' ? (param.observacion || 'Apertura de turno') : (observacion || 'Apertura de turno');
    const cajaNombre = typeof param === 'object' && param.cajaNombre ? param.cajaNombre : 'Caja Principal Boutique';

    const newSession: CashSession = {
      id: `CASH-${Date.now()}`,
      codigoCaja,
      cajaNombre,
      cajeroId: currentUser.id,
      cajeroNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioAperturaNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      montoInicial,
      fechaApertura: new Date().toISOString().replace('T', ' ').substring(0, 19),
      observacionApertura: obs,
      estado: 'ABIERTA',
      ventasEfectivo: 0,
      abonosEfectivo: 0,
      ingresosManuales: 0,
      retirosManuales: 0,
      gastos: 0,
      devolucionesEfectivo: 0,
      efectivoEsperado: montoInicial,
    };

    const sessions = storageService.getCashSessions();
    sessions.unshift(newSession);
    storageService.saveCashSessions(sessions);

    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'CASH_OPENED',
      modulo: 'CAJA',
      entidad: 'CashSession',
      entidadId: newSession.id,
      descripcion: `Apertura de caja ${codigoCaja} con fondo inicial RD$${montoInicial.toLocaleString()}`,
      resultado: 'EXITO',
    });

    return {
      success: true,
      message: `Caja ${codigoCaja} abierta con fondo inicial de RD$${montoInicial.toLocaleString()}`,
      data: newSession,
    };
  }

  public async closeCashSession(
    param: number | { sessionId?: string; montoCierreReal: number; notasCierre?: string; usuarioId?: string; usuarioNombre?: string },
    observacion?: string
  ): Promise<ApiResponse<CashSession>> {
    if (!this.hasPermission('caja.cerrar')) {
      return { success: false, message: 'No tiene permisos para cerrar caja', errorCode: 'PERMISSION_DENIED' };
    }

    const active = storageService.getActiveCashSession();
    if (!active) {
      return { success: false, message: 'No hay ninguna caja abierta actualmente', errorCode: 'NO_OPEN_CASH' };
    }

    const currentUser = storageService.getCurrentUser();
    const efectivoRealContado = typeof param === 'number' ? param : param.montoCierreReal;
    const obs = typeof param === 'object' ? param.notasCierre : observacion;
    const diferencia = efectivoRealContado - active.efectivoEsperado;

    const sessions = storageService.getCashSessions();
    const index = sessions.findIndex((s) => s.id === active.id);
    if (index !== -1) {
      sessions[index].estado = 'CERRADA';
      sessions[index].efectivoRealContado = efectivoRealContado;
      sessions[index].montoCierreReal = efectivoRealContado;
      sessions[index].diferencia = diferencia;
      sessions[index].fechaCierre = new Date().toISOString().replace('T', ' ').substring(0, 19);
      sessions[index].observacionCierre = obs;
      storageService.saveCashSessions(sessions);
    }

    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'CASH_CLOSED',
      modulo: 'CAJA',
      entidad: 'CashSession',
      entidadId: active.id,
      descripcion: `Cierre de caja ${active.codigoCaja}. Esperado: RD$${active.efectivoEsperado.toLocaleString()}, Contado: RD$${efectivoRealContado.toLocaleString()}, Diferencia: RD$${diferencia.toLocaleString()}`,
      resultado: 'EXITO',
      datosNuevos: { esperado: active.efectivoEsperado, contado: efectivoRealContado, diferencia },
    });

    return {
      success: true,
      message: `Caja ${active.codigoCaja} cerrada correctamente. Diferencia: RD$${diferencia.toLocaleString()}`,
      data: sessions[index],
    };
  }

  public async adjustInventory(data: {
    productoId: string;
    varianteId: string;
    cantidadAjuste?: number;
    cantidad?: number;
    motivo: string;
    tipo?: any;
    usuarioId?: string;
    usuarioNombre?: string;
  }): Promise<ApiResponse> {
    if (!this.hasPermission('inventario.ajustar')) {
      return { success: false, message: 'No tiene permisos para ajustar inventario', errorCode: 'PERMISSION_DENIED' };
    }

    const delta = data.cantidadAjuste !== undefined ? data.cantidadAjuste : (data.cantidad || 0);

    const products = storageService.getProducts();
    const pIndex = products.findIndex((p) => p.id === data.productoId);
    if (pIndex === -1) {
      return { success: false, message: 'Producto no encontrado', errorCode: 'PRODUCT_NOT_FOUND' };
    }

    const vIndex = products[pIndex].variantes.findIndex((v) => v.id === data.varianteId);
    if (vIndex === -1) {
      return { success: false, message: 'Variante no encontrada', errorCode: 'VARIANT_NOT_FOUND' };
    }

    const variant = products[pIndex].variantes[vIndex];
    const stockAnterior = variant.stock;
    const stockNuevo = Math.max(0, stockAnterior + delta);
    variant.stock = stockNuevo;
    products[pIndex].variantes[vIndex] = variant;
    storageService.saveProducts(products);

    const currentUser = storageService.getCurrentUser();
    const movements = storageService.getMovements();
    movements.unshift({
      id: storageService.getNextSequence('MOV'),
      productoId: data.productoId,
      productoNombre: products[pIndex].nombre,
      varianteId: data.varianteId,
      sku: variant.sku,
      talla: variant.talla,
      color: variant.color,
      cantidad: delta,
      tipo: delta > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
      stockAnterior,
      stockNuevo,
      motivo: data.motivo,
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
    });
    storageService.saveMovements(movements);

    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'INVENTORY_ADJUSTMENT',
      modulo: 'INVENTARIO',
      entidad: 'ProductVariant',
      entidadId: variant.id,
      descripcion: `Ajuste de inventario para ${products[pIndex].nombre} (${variant.talla}/${variant.color}): ${delta > 0 ? '+' : ''}${delta}. Motivo: ${data.motivo}`,
      resultado: 'EXITO',
    });

    return {
      success: true,
      message: `Inventario actualizado para ${products[pIndex].nombre}. Nuevo stock: ${stockNuevo}`,
    };
  }

  public async addCashMovement(
    param: string | { tipo: string; monto: number; motivo: string; sessionId?: string; usuarioId?: string; usuarioNombre?: string },
    montoParam?: number,
    motivoParam?: string
  ): Promise<ApiResponse> {
    const active = storageService.getActiveCashSession();
    if (!active) {
      return { success: false, message: 'No hay caja abierta para registrar movimientos', errorCode: 'NO_OPEN_CASH' };
    }

    let tipoRaw = typeof param === 'string' ? param : param.tipo;
    let monto = typeof param === 'string' ? (montoParam || 0) : param.monto;
    let motivo = typeof param === 'string' ? (motivoParam || '') : param.motivo;

    if (monto <= 0) {
      return { success: false, message: 'El monto debe ser mayor a cero', errorCode: 'INVALID_AMOUNT' };
    }

    const currentUser = storageService.getCurrentUser();
    const sessions = storageService.getCashSessions();
    const index = sessions.findIndex((s) => s.id === active.id);

    if (tipoRaw === 'INGRESO' || tipoRaw === 'ENTRADA') {
      sessions[index].ingresosManuales += monto;
      sessions[index].efectivoEsperado += monto;
    } else if (tipoRaw === 'RETIRO' || tipoRaw === 'SALIDA') {
      sessions[index].retirosManuales += monto;
      sessions[index].efectivoEsperado -= monto;
    } else if (tipoRaw === 'GASTO') {
      sessions[index].gastos += monto;
      sessions[index].efectivoEsperado -= monto;
    }

    storageService.saveCashSessions(sessions);

    storageService.logAudit({
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      usuarioRol: currentUser.rol,
      accion: 'UPDATE',
      modulo: 'CAJA',
      entidad: 'CashMovement',
      entidadId: active.id,
      descripcion: `Movimiento de caja ${tipoRaw} por RD$${monto.toLocaleString()}. Motivo: ${motivo}`,
      resultado: 'EXITO',
    });

    return {
      success: true,
      message: `Movimiento de ${tipoRaw.toLowerCase()} por RD$${monto.toLocaleString()} registrado con éxito.`,
    };
  }
}

export const apiService = new ApiService();
