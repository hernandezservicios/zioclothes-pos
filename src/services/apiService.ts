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

// FASE 4.0 (CORREGIR AUDITORÍA): códigos de error emitidos por la propia
// capa de transporte HTTP -- distintos de los códigos de negocio que ya
// emitía el backend (formato "CODIGO: mensaje", sin cambios, ver más abajo).
// Sirven para que la UI muestre siempre un mensaje humano y nunca el texto
// crudo de un SyntaxError ("Unexpected token '<'...").
export type TransportErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'HTTP_ERROR'
  | 'DATA_FORMAT_ERROR'
  | 'API_ERROR'
  | 'ABORTED';

const REQUEST_TIMEOUT_MS = 20000;
const RETRY_DELAY_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * FASE 4.0: acciones de solo lectura -- seguras para UN único reintento
 * automático ante un fallo transitorio de red/timeout. Deliberadamente NO
 * se reintenta ninguna acción que cree/modifique/elimine datos (crear
 * venta, guardar producto, registrar abono, abrir caja, etc.): el backend
 * no implementa ningún mecanismo de idempotencia para esas acciones, así
 * que reintentar automáticamente arriesgaría duplicar la operación real en
 * Google Sheets. Ante duda, una acción NO listada aquí nunca se reintenta.
 */
function isSafeToRetry(action: string): boolean {
  if (action.endsWith('.list') || action.endsWith('.listAuxiliaries') || action.endsWith('.kardex')) return true;
  return ['system.ping', 'system.getSettings', 'system.getBootstrapData', 'auth.validateSession', 'cash.getActiveSession'].includes(
    action
  );
}

/**
 * FASE 4.0: mensajes amigables por código de transporte -- el detalle
 * técnico real (stack, status, contenido del body) se registra aparte vía
 * console.warn/console.error para diagnóstico, nunca se muestra al usuario.
 */
function friendlyTransportMessage(code: TransportErrorCode, detail?: string): string {
  switch (code) {
    case 'NETWORK_ERROR':
      return 'No se pudo conectar con el servidor. Verifique su conexión a internet e intente de nuevo.';
    case 'TIMEOUT_ERROR':
      return 'El servidor tardó demasiado en responder. Intente de nuevo en unos segundos.';
    case 'HTTP_ERROR':
      return `El servidor respondió con un error${detail ? ` (${detail})` : ''}. Intente de nuevo más tarde.`;
    case 'DATA_FORMAT_ERROR':
      return 'El servidor no está disponible en este momento. Verifique la URL de conexión configurada e intente de nuevo.';
    case 'ABORTED':
      return 'La solicitud fue cancelada.';
    case 'API_ERROR':
    default:
      return 'Ocurrió un error inesperado al comunicarse con el servidor.';
  }
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

  // FASE 4.0: deduplicación de requests idénticos en vuelo. Si dos llamadas
  // con la misma acción + mismos datos + mismo token están en curso al
  // mismo tiempo -- típicamente por el doble montaje de React StrictMode en
  // desarrollo, o por dos componentes pidiendo el mismo dominio a la vez --
  // comparten la misma Promise en vez de disparar dos peticiones HTTP
  // reales. La entrada se limpia apenas la petición en vuelo resuelve
  // (éxito o error), así que nunca sirve un resultado obsoleto.
  private inFlight = new Map<string, Promise<ApiResponse>>();

  /**
   * Google Apps Script Proxy Dispatcher.
   *
   * FASE 3.6: corregido para usar el contrato REAL de ZIO-Google-Backend
   * (Main.gs doPost), verificado directamente en el código del backend:
   *   Petición:  { action, sessionToken, data }
   *   Éxito:     { success: true, ...campos según la acción }
   *   Error:     { success: false, error: "CODIGO: mensaje", timestamp }
   * (antes se enviaba { action, payload, user, timestamp }, que no
   * corresponde a ningún campo que Main.gs lea).
   *
   * `data` en la respuesta contiene el JSON crudo devuelto por el backend
   * (distinto según la acción: sessionToken/user/permissions en login,
   * saleId/numeroVenta en sales.create, data.products/data.customers en
   * system.getBootstrapData, etc.) -- los callers desestructuran lo que
   * necesiten de ahí en vez de asumir una forma única.
   *
   * FASE 4.0 (CORREGIR AUDITORÍA): el contrato de entrada/salida de este
   * método NO cambia -- todos los callers existentes (productsApi,
   * salesApi, settingsApi, etc.) siguen funcionando sin modificación.
   * Se le agrega, por dentro: deduplicación de requests idénticos en
   * vuelo, timeout real vía AbortController, verificación de
   * `response.ok`/cuerpo no vacío antes de parsear JSON, clasificación de
   * errores de transporte (nunca más "Unexpected token '<'" crudo llegando
   * a la UI), y un único reintento automático solo para acciones de
   * lectura ante fallo transitorio de red/timeout.
   */
  public async syncWithGoogleAppsScript(
    action: string,
    data: any = {},
    sessionToken?: string
  ): Promise<ApiResponse> {
    const dedupeKey = `${action}|${sessionToken || ''}|${JSON.stringify(data ?? {})}`;
    const existing = this.inFlight.get(dedupeKey);
    if (existing) return existing;

    const promise = this.executeWithRetry(action, data, sessionToken);
    this.inFlight.set(dedupeKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(dedupeKey);
    }
  }

  private async executeWithRetry(action: string, data: any, sessionToken?: string): Promise<ApiResponse> {
    const result = await this.executeRequest(action, data, sessionToken);
    const isTransient = result.errorCode === 'NETWORK_ERROR' || result.errorCode === 'TIMEOUT_ERROR';

    if (!result.success && isTransient && isSafeToRetry(action)) {
      await delay(RETRY_DELAY_MS);
      return this.executeRequest(action, data, sessionToken);
    }
    return result;
  }

  private async executeRequest(action: string, data: any, sessionToken?: string): Promise<ApiResponse> {
    // FASE 3.6D (Parte 3): la URL del Web App vive en la configuración de
    // infraestructura separada (zio_infrastructure_config), no en
    // zio_settings -- así una limpieza de caché de negocio/UX nunca la
    // destruye.
    const url = storageService.getGoogleAppsScriptUrl();
    if (!url || !url.startsWith('http')) {
      return {
        success: false,
        message: 'No se ha configurado la URL del Web App de Google Apps Script.',
        errorCode: 'URL_NOT_CONFIGURED',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps script friendly, evita preflight CORS
        body: JSON.stringify({ action, sessionToken, data }),
        signal: controller.signal,
      });
    } catch (error: any) {
      clearTimeout(timer);
      if (error && error.name === 'AbortError') {
        console.warn(`[apiService] Timeout (${REQUEST_TIMEOUT_MS}ms) en la acción "${action}".`);
        return { success: false, message: friendlyTransportMessage('TIMEOUT_ERROR'), errorCode: 'TIMEOUT_ERROR' };
      }
      console.warn(`[apiService] Error de red en la acción "${action}":`, error);
      return { success: false, message: friendlyTransportMessage('NETWORK_ERROR'), errorCode: 'NETWORK_ERROR' };
    }
    clearTimeout(timer);

    // Diagnóstico técnico completo a consola -- nunca al usuario.
    const contentType = response.headers.get('content-type') || '';

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (error) {
      console.warn(`[apiService] No se pudo leer el cuerpo de la respuesta para "${action}".`, error);
      return { success: false, message: friendlyTransportMessage('NETWORK_ERROR'), errorCode: 'NETWORK_ERROR' };
    }

    if (!bodyText || !bodyText.trim()) {
      console.warn(`[apiService] Respuesta vacía para "${action}" (status ${response.status}, content-type "${contentType}").`);
      return { success: false, message: friendlyTransportMessage('DATA_FORMAT_ERROR'), errorCode: 'DATA_FORMAT_ERROR' };
    }

    let json: any;
    try {
      json = JSON.parse(bodyText);
    } catch (parseError) {
      // Aquí es exactamente donde antes se filtraba "Unexpected token '<'"
      // hacia la UI -- ahora queda solo en consola, con todo el contexto
      // real para diagnosticar (status, content-type, primeros caracteres
      // del cuerpo real recibido).
      console.warn(
        `[apiService] Respuesta no-JSON para "${action}" (status ${response.status}, content-type "${contentType}"): ` +
          bodyText.slice(0, 200)
      );
      return {
        success: false,
        message: friendlyTransportMessage('DATA_FORMAT_ERROR'),
        errorCode: 'DATA_FORMAT_ERROR',
      };
    }

    if (!response.ok) {
      // El backend (Main.gs) siempre responde 200 incluso en sus propios
      // errores de negocio -- si llegamos aquí con response.ok === false
      // pero el body sí parseó como JSON, es una respuesta de negocio real
      // (defensivo, por si el contrato cambiara); si no trae la forma
      // esperada, se clasifica como HTTP_ERROR explícito.
      if (!json || typeof json.success !== 'boolean') {
        console.warn(`[apiService] HTTP ${response.status} para "${action}".`, json);
        return {
          success: false,
          message: friendlyTransportMessage('HTTP_ERROR', `HTTP ${response.status}`),
          errorCode: 'HTTP_ERROR',
        };
      }
    }

    if (json && json.success === true) {
      return { success: true, message: json.message || 'OK', data: json };
    }

    // El backend real siempre lanza errores con formato "CODIGO: mensaje"
    // (ver AuthController/SalesController/etc.), capturados por el
    // catch-all de Main.gs como { success:false, error: "...", timestamp }.
    // Estos son códigos de NEGOCIO (backend), distintos de los
    // TransportErrorCode de arriba -- se preservan sin cambios.
    const rawError: string = (json && (json.error || json.message)) || 'Error desconocido del servidor.';
    const match = /^([A-Z_]+):\s*(.*)$/.exec(rawError);

    return {
      success: false,
      errorCode: match ? match[1] : undefined,
      message: match ? match[2] : rawError,
    };
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
      // FASE 3.7C: 'AJUSTE_POSITIVO'/'AJUSTE_NEGATIVO' nunca fueron valores
      // reales de Inventario_Kardex.tipo (ver InventoryMovementType) --
      // este método local ya no tiene ningún llamador real
      // (InventoryView usa inventoryApi.adjust), se ajusta solo para
      // seguir compilando contra el tipo corregido.
      tipo: delta > 0 ? 'ENTRADA' : 'SALIDA',
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
