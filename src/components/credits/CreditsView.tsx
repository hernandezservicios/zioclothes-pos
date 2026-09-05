import React, { useState, useMemo, useEffect } from 'react';
import { AccountReceivable, Sale, PaymentInstallment } from '../../types';
import { creditsApi } from '../../services/creditsApi';
import { salesApi } from '../../services/salesApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { InstallmentModal } from './InstallmentModal';
import { InstallmentReceiptModal } from './InstallmentReceiptModal';
import { ReceiptModal } from '../pos/ReceiptModal';
import {
  CreditCard,
  Search,
  Filter,
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  Eye,
  Plus,
  Coins,
  X,
  FileText,
  Printer,
  Ban,
  RefreshCcw,
} from 'lucide-react';

interface CreditsViewProps {
  initialStatusFilter?: 'TODOS' | 'PENDIENTE' | 'PARCIAL' | 'VENCIDA' | 'PAGADA';
  initialSearchQuery?: string;
  onNavigateToInstallments?: () => void;
}

export const CreditsView: React.FC<CreditsViewProps> = ({
  initialStatusFilter,
  initialSearchQuery,
  onNavigateToInstallments,
}) => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  // FASE 3.7B / CORREGIR AUDITORÍA: créditos/cuentas por cobrar y sus
  // abonos embebidos vienen EXCLUSIVAMENTE de credits.list
  // (CreditsController.handleListCredits -> Google Sheets real), ahora
  // leídos del DataStore central -- la MISMA colección que también
  // consumen InstallmentsView, DashboardView y ReportsView (antes cada
  // una lo pedía por su cuenta, 4 llamadas independientes a credits.list,
  // ver informe de auditoría). No hay una fuente local separada de
  // "installments": cada crédito ya trae su propio historial de abonos
  // (credit.abonos[]) directamente del backend.
  const { credits, creditsLoading: loading, creditsError: loadError, creditsStale, refreshCredits, refreshCustomers } =
    useDataStore();

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'PENDIENTE' | 'PARCIAL' | 'VENCIDA' | 'PAGADA'>(
    initialStatusFilter || 'TODOS'
  );

  React.useEffect(() => {
    if (initialStatusFilter) {
      setStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  React.useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Modals -- se guarda solo el ID y se deriva el objeto fresco desde
  // `credits` en cada render, para que un refresh tras registrar/anular un
  // abono se refleje de inmediato sin mantener una copia local obsoleta.
  const [selectedCreditDetailId, setSelectedCreditDetailId] = useState<string | null>(null);
  const [creditForInstallmentId, setCreditForInstallmentId] = useState<string | null>(null);
  const [selectedReceiptInstallment, setSelectedReceiptInstallment] = useState<PaymentInstallment | null>(null);
  const [selectedSaleForReceipt, setSelectedSaleForReceipt] = useState<Sale | null>(null);
  const [loadingSaleReceipt, setLoadingSaleReceipt] = useState(false);

  const selectedCreditDetail = useMemo(
    () => credits.find((c) => c.id === selectedCreditDetailId) || null,
    [credits, selectedCreditDetailId]
  );
  const creditForInstallment = useMemo(
    () => credits.find((c) => c.id === creditForInstallmentId) || null,
    [credits, creditForInstallmentId]
  );

  // Void Abono
  const [voidingAbono, setVoidingAbono] = useState<PaymentInstallment | null>(null);
  const [voidAbonoReason, setVoidAbonoReason] = useState('');
  const [loadingVoidAbono, setLoadingVoidAbono] = useState(false);

  // Filtered Credits
  const filteredCredits = useMemo(() => {
    return (credits || []).filter((c) => {
      if (!c) return false;
      const matchesStatus = statusFilter === 'TODOS' || c.estado === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const acctNum = (c.numeroCredito || c.numeroCuenta || '').toLowerCase();
      const clientName = (c.clienteNombre || '').toLowerCase();
      const saleNum = (c.numeroVenta || '').toLowerCase();
      const doc = (c.clienteDocumento || '').toLowerCase();

      const matchesSearch =
        !q ||
        acctNum.includes(q) ||
        clientName.includes(q) ||
        saleNum.includes(q) ||
        doc.includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [credits, statusFilter, searchQuery]);

  // KPIs
  const totalReceivables = (credits || [])
    .filter((c) => c && c.estado !== 'PAGADA' && c.estado !== 'ANULADA')
    .reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);

  const overdueTotal = (credits || [])
    .filter((c) => c && c.estado === 'VENCIDA')
    .reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);

  const activeAccountsCount = (credits || []).filter(
    (c) => c && (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL' || c.estado === 'VENCIDA')
  ).length;

  const handleExportCSV = () => {
    const rows = (filteredCredits || []).map((c) => ({
      NumeroCuenta: c.numeroCredito || c.numeroCuenta,
      FacturaVenta: c.numeroVenta,
      Cliente: c.clienteNombre,
      Documento: c.clienteDocumento || 'N/A',
      Telefono: c.clienteTelefono || 'N/A',
      MontoOriginal: c.montoOriginal,
      MontoPagado: c.montoPagado,
      SaldoPendiente: c.saldoPendiente,
      FechaEmision: c.fechaCreacion || c.fechaEmision,
      FechaVencimiento: c.fechaVencimiento,
      DiasPlazo: c.diasPlazo,
      Estado: c.estado,
    }));
    exportToCSV('Cartera_Creditos_ZIO', rows);
    showToast('Exportación Exitosa', 'Listado de cuentas por cobrar exportado en CSV.', 'exito');
  };

  const handleSendWhatsAppReminder = (credit: AccountReceivable) => {
    const phone = (credit.clienteTelefono || '').replace(/[^0-9]/g, '');
    const acctNum = credit.numeroCredito || credit.numeroCuenta;
    const msg = encodeURIComponent(
      `Hola *${credit.clienteNombre}*, le saludamos cordialmente de *${settings.nombreNegocio || 'ZIO CLOTHES'}*.\n\n` +
      `Le recordamos que su cuenta *#${acctNum}* (Factura ${credit.numeroVenta}) presenta un saldo pendiente de *${settings.simboloMoneda} ${credit.saldoPendiente.toLocaleString()}*, con fecha límite de vencimiento *${credit.fechaVencimiento}*.\n\n` +
      `Agradecemos su puntual pago. ¡Feliz día!`
    );
    const url = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(url, '_blank');
  };

  // FASE 3.7B: antes buscaba la venta original en storageService.getSales(),
  // un arreglo que desde FASE 3.7A nadie real vuelve a escribir (sales.create
  // quedó conectado al backend) -- este botón siempre habría fallado con
  // "Factura no encontrada" pese a que la venta sí existe en Sheets. Ahora
  // consulta salesApi.list() bajo demanda, solo al hacer clic.
  const handleOpenSaleReceipt = async (credit: AccountReceivable) => {
    setLoadingSaleReceipt(true);
    const res = await salesApi.list();
    setLoadingSaleReceipt(false);
    if (!res.success) {
      showToast('Error', res.message || 'No se pudo consultar el historial de ventas.', 'error');
      return;
    }
    const foundSale = (res.data || []).find((s) => s.id === credit.ventaId || s.numeroVenta === credit.numeroVenta);
    if (foundSale) {
      setSelectedSaleForReceipt(foundSale);
    } else {
      showToast('Factura no encontrada', `No se encontró el registro completo de la venta ${credit.numeroVenta}`, 'advertencia');
    }
  };

  const handleConfirmVoidAbono = async () => {
    if (!voidingAbono) return;
    if (!voidAbonoReason.trim()) {
      showToast('Motivo Requerido', 'Debe ingresar el motivo de la anulación.', 'error');
      return;
    }
    setLoadingVoidAbono(true);
    // FASE 3.7B: credits.voidAbono real (CreditsController.handleVoidAbono).
    // El backend valida el permiso creditos.anular_abonos, restaura el
    // saldo de la cuenta y revierte el efecto en caja si el abono fue en
    // efectivo -- si rechaza, se muestra el error real y no se toca nada
    // localmente.
    const res = await creditsApi.voidAbono(voidingAbono.id, voidAbonoReason.trim());
    setLoadingVoidAbono(false);

    if (res.success) {
      showToast('Abono Anulado', res.message, 'exito');
      setVoidingAbono(null);
      setVoidAbonoReason('');
      // CORREGIR AUDITORÍA (§6): invalida créditos y clientes (customers.list
      // recalcula saldoPendiente/creditoDisponible desde Creditos real) --
      // InstallmentsView/Dashboard/Reportes/POS reflejan el resultado de
      // inmediato, sin logout/login ni F5.
      await Promise.all([refreshCredits({ force: true }), refreshCustomers({ force: true })]);
    } else {
      showToast('Error', res.message, 'error');
    }
  };

  return (
    <div id="credits-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Finanzas & Cartera
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[#2F2A25] tracking-tight">
            Cuentas por Cobrar & Créditos
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => refreshCredits({ force: true })}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
            title="Volver a consultar el backend real"
          >
            <RefreshCcw className={`w-4 h-4 text-[#756E65] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={credits.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {onNavigateToInstallments && (
            <button
              type="button"
              onClick={onNavigateToInstallments}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F6F1E8] border border-[#E4DDD2] text-xs font-bold text-[#2F2A25] hover:bg-[#E8DCC8] transition shadow-2xs"
            >
              <Coins className="w-4 h-4 text-[#756E65]" />
              <span>Historial de Abonos</span>
            </button>
          )}
        </div>
      </div>

      {/* Error real del backend -- nunca se sustituye por datos demo/locales */}
      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No se pudo cargar la cartera de créditos desde el backend: {loadError}
              {creditsStale && ' (se muestra la última información disponible, puede no estar actualizada)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => refreshCredits({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-2xs">
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Cartera Total por Cobrar</span>
            <CreditCard className="w-4 h-4 text-[#2F2A25]" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-[#2F2A25]">
              {loading ? '...' : formatCurrency(totalReceivables, settings.simboloMoneda)}
            </h3>
            <span className="text-[11px] text-[#756E65]">
              {activeAccountsCount} cuenta(s) activa(s)
            </span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-2xs">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">En Mora / Vencidas</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-rose-700">
              {loading ? '...' : formatCurrency(overdueTotal, settings.simboloMoneda)}
            </h3>
            <span className="text-[11px] text-rose-600">Requiere gestión de cobro</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-2xs">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Recuperación Efectiva</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-emerald-700">
              {loading
                ? '...'
                : formatCurrency(
                    (credits || []).reduce((acc, c) => acc + (c?.montoPagado || 0), 0),
                    settings.simboloMoneda
                  )}
            </h3>
            <span className="text-[11px] text-[#756E65]">Abonado acumulado</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por # cuenta, factura, cliente o cédula..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
        >
          <option value="TODOS">Todos los Estados</option>
          <option value="PENDIENTE">Pendientes (Sin Abono)</option>
          <option value="PARCIAL">Con Abonos Parciales</option>
          <option value="VENCIDA">Vencidas (Mora)</option>
          <option value="PAGADA">Pagadas / Saldadas</option>
        </select>
      </div>

      {/* Credits Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        {loading && credits.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando cartera de créditos real en el backend...</p>
          </div>
        ) : !loading && !loadError && credits.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <CreditCard className="w-8 h-8 opacity-40 mx-auto" />
            <p className="font-semibold text-xs text-[#2F2A25]">
              Todavía no hay cuentas por cobrar en Google Sheets.
            </p>
            <p className="text-[11px]">Las ventas a crédito realizadas desde el POS aparecerán aquí automáticamente.</p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4"># Cuenta</th>
                <th className="py-3 px-4">Factura</th>
                <th className="py-3 px-4">Cliente</th>
                <th className="py-3 px-4 text-right">Monto Original</th>
                <th className="py-3 px-4 text-right">Abonado</th>
                <th className="py-3 px-4 text-right">Saldo Pendiente</th>
                <th className="py-3 px-4">Vencimiento</th>
                <th className="py-3 px-4 text-center">Estado</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredCredits || []).map((credit) => {
                const acctNum = credit.numeroCredito || credit.numeroCuenta;
                return (
                  <tr key={credit.id} className="hover:bg-[#FAF8F4]/80 transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#2F2A25]">
                      {acctNum}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[#756E65]">
                      <button
                        type="button"
                        onClick={() => handleOpenSaleReceipt(credit)}
                        disabled={loadingSaleReceipt}
                        className="hover:underline hover:text-[#2F2A25] text-left disabled:opacity-50"
                        title="Ver comprobante de venta original"
                      >
                        {credit.numeroVenta}
                      </button>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#2F2A25]">{credit.clienteNombre}</div>
                      {credit.clienteDocumento && (
                        <div className="text-[10px] text-[#756E65]">Doc: {credit.clienteDocumento}</div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-[#756E65]">
                      {formatCurrency(credit.montoOriginal, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-emerald-700">
                      {formatCurrency(credit.montoPagado, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-[#2F2A25]">
                      {formatCurrency(credit.saldoPendiente, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-[#756E65]">
                      <div>{credit.fechaVencimiento}</div>
                      <div className="text-[10px] text-[#756E65]">Plazo: {credit.diasPlazo} días</div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          credit.estado === 'PAGADA'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : credit.estado === 'VENCIDA'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : credit.estado === 'PARCIAL'
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {credit.estado}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {credit.saldoPendiente > 0 && (hasPermission('creditos.abonos') || hasPermission('abonos.crear')) && (
                          <button
                            type="button"
                            onClick={() => setCreditForInstallmentId(credit.id)}
                            className="px-2.5 py-1 rounded-lg bg-[#2F2A25] text-white text-[11px] font-bold hover:bg-[#403932] transition flex items-center gap-1"
                            title="Registrar Abono"
                          >
                            <Coins className="w-3 h-3 text-[#E8DCC8]" />
                            <span>Abonar</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCreditDetailId(credit.id)}
                          className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                          title="Ver detalle del estado de cuenta"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {credit.saldoPendiente > 0 && (
                          <button
                            type="button"
                            onClick={() => handleSendWhatsAppReminder(credit)}
                            className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition"
                            title="Recordatorio WhatsApp"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {credits.length > 0 && (filteredCredits || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <CreditCard className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">No hay cuentas por cobrar con estos filtros</p>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Credit Account Detail Modal */}
      {selectedCreditDetail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#2F2A25]">
                  Estado de Cuenta {selectedCreditDetail.numeroCredito || selectedCreditDetail.numeroCuenta}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-[#756E65]">
                    Factura de Venta: {selectedCreditDetail.numeroVenta}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenSaleReceipt(selectedCreditDetail)}
                    disabled={loadingSaleReceipt}
                    className="text-[10px] font-bold text-[#2F2A25] underline hover:text-black disabled:opacity-50"
                  >
                    (Ver Factura)
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCreditDetailId(null)}
                className="text-[#756E65] p-1 hover:text-[#2F2A25]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-white rounded-2xl border border-[#E4DDD2] space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#756E65]">Cliente:</span>
                  <span className="font-bold text-[#2F2A25]">{selectedCreditDetail.clienteNombre}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#756E65]">Fecha de Emisión:</span>
                  <span className="font-medium text-[#2F2A25]">{selectedCreditDetail.fechaCreacion || selectedCreditDetail.fechaEmision}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#756E65]">Fecha de Vencimiento:</span>
                  <span className="font-bold text-[#2F2A25]">{selectedCreditDetail.fechaVencimiento}</span>
                </div>
                <div className="border-t border-[#E4DDD2] pt-1.5 flex justify-between font-bold">
                  <span>Monto Financiado:</span>
                  <span>{formatCurrency(selectedCreditDetail.montoOriginal, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-700">
                  <span>Total Abonado:</span>
                  <span>{formatCurrency(selectedCreditDetail.montoPagado, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm text-[#2F2A25] pt-1 border-t border-[#E4DDD2]">
                  <span>Saldo Pendiente:</span>
                  <span>{formatCurrency(selectedCreditDetail.saldoPendiente, settings.simboloMoneda)}</span>
                </div>
              </div>

              {/* Installments History -- directamente de credit.abonos, ya
                  poblado por el backend real (credits.list). */}
              <div>
                <h5 className="font-bold text-[#2F2A25] uppercase text-[10px] mb-2">
                  Historial de Abonos Recibidos:
                </h5>
                <div className="space-y-2">
                  {(() => {
                    const creditAbonos = selectedCreditDetail.abonos || [];
                    if (creditAbonos.length === 0) {
                      return <p className="text-[#756E65] text-[11px] italic">No se han registrado abonos todavía.</p>;
                    }

                    return creditAbonos.map((abono, idx) => {
                      const recNum = abono.numeroRecibo || abono.numeroAbono || abono.id;
                      const isVoided = abono.estado === 'ANULADO';
                      return (
                        <div
                          key={idx}
                          className={`p-2.5 bg-white border rounded-xl flex items-center justify-between ${
                            isVoided ? 'border-rose-200 opacity-60' : 'border-[#E4DDD2]'
                          }`}
                        >
                          <div>
                            <p className="font-bold text-[#2F2A25]">
                              {recNum} • {abono.metodoPago}
                              {isVoided && <span className="ml-1.5 text-[9px] text-rose-700 font-bold">ANULADO</span>}
                            </p>
                            <p className="text-[10px] text-[#756E65]">
                              {formatDateTime(abono.fecha)} • Por: {abono.usuarioNombre}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`font-bold ${isVoided ? 'text-[#756E65] line-through' : 'text-emerald-800'}`}>
                              {formatCurrency(abono.montoAbonado, settings.simboloMoneda)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedReceiptInstallment(abono)}
                              className="p-1 rounded-lg text-[#2F2A25] hover:bg-[#F6F1E8] border border-[#E4DDD2]"
                              title="Ver recibo de abono"
                            >
                              <Printer className="w-3.5 h-3.5 text-[#756E65]" />
                            </button>
                            {!isVoided && hasPermission('creditos.anular_abonos') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidingAbono(abono);
                                  setVoidAbonoReason('');
                                }}
                                className="p-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200"
                                title="Anular abono"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedCreditDetailId(null)}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cerrar
              </button>
              {selectedCreditDetail.saldoPendiente > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCreditForInstallmentId(selectedCreditDetail.id);
                    setSelectedCreditDetailId(null);
                  }}
                  className="flex-1 py-2 rounded-xl bg-[#2F2A25] text-xs font-bold text-white flex items-center justify-center gap-1.5"
                >
                  <Coins className="w-3.5 h-3.5 text-[#E8DCC8]" />
                  <span>Registrar Abono</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Installment Registration Modal */}
      {creditForInstallment && (
        <InstallmentModal
          credit={creditForInstallment}
          onClose={() => setCreditForInstallmentId(null)}
          onSuccess={async () => {
            setCreditForInstallmentId(null);
            // CORREGIR AUDITORÍA (§6 "Créditos y abonos"): invalida
            // créditos y clientes -- InstallmentsView/Dashboard/Reportes/
            // POS reflejan el nuevo saldo de inmediato, sin logout/login
            // ni F5.
            await Promise.all([refreshCredits({ force: true }), refreshCustomers({ force: true })]);
          }}
        />
      )}

      {/* Void Abono Reason Modal */}
      {voidingAbono && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-800 font-bold text-sm border-b border-[#E4DDD2] pb-3">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <span>Anular Abono {voidingAbono.numeroRecibo || voidingAbono.numeroAbono}</span>
            </div>

            <p className="text-xs text-[#756E65] leading-relaxed">
              Esta acción restaurará el saldo pendiente de la cuenta por{' '}
              {formatCurrency(voidingAbono.montoAbonado, settings.simboloMoneda)}, y revertirá el
              efecto en caja si el abono fue cobrado en efectivo.
            </p>

            <div>
              <label className="block text-xs font-bold text-[#2F2A25] mb-1 uppercase">
                Motivo de Anulación:
              </label>
              <textarea
                rows={3}
                required
                value={voidAbonoReason}
                onChange={(e) => setVoidAbonoReason(e.target.value)}
                placeholder="Ej. Abono registrado por error / Duplicado"
                className="w-full p-2.5 rounded-xl border border-[#E4DDD2] bg-white text-xs text-[#2F2A25] focus:outline-none focus:border-rose-600"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVoidingAbono(null)}
                disabled={loadingVoidAbono}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loadingVoidAbono || !voidAbonoReason.trim()}
                onClick={handleConfirmVoidAbono}
                className="flex-1 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-xs font-bold text-white transition disabled:bg-zinc-300"
              >
                {loadingVoidAbono ? 'Anulando...' : 'Confirmar Anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Installment Thermal Receipt Modal */}
      {selectedReceiptInstallment && (
        <InstallmentReceiptModal
          installment={selectedReceiptInstallment}
          settings={settings}
          onClose={() => setSelectedReceiptInstallment(null)}
        />
      )}

      {/* Original Sale Receipt Modal */}
      {selectedSaleForReceipt && (
        <ReceiptModal
          sale={selectedSaleForReceipt}
          onClose={() => setSelectedSaleForReceipt(null)}
        />
      )}
    </div>
  );
};
