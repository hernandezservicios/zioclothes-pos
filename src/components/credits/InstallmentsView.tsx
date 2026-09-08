import React, { useState, useMemo, useEffect } from 'react';
import { Installment } from '../../types';
import { creditsApi } from '../../services/creditsApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { InstallmentModal } from './InstallmentModal';
import { InstallmentReceiptModal } from './InstallmentReceiptModal';
import {
  Coins,
  Search,
  Download,
  Printer,
  Plus,
  Eye,
  FileText,
  CreditCard,
  AlertTriangle,
  RefreshCcw,
  Ban,
} from 'lucide-react';

export const InstallmentsView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  // FASE 3.7B / CORREGIR AUDITORÍA: no existe un endpoint separado
  // "listar abonos" -- el contrato real (CreditsController.
  // handleListCredits) embebe el historial de abonos dentro de cada
  // cuenta (credit.abonos[]). Esta vista aplana ese historial a partir
  // del DataStore central de créditos -- la MISMA colección que también
  // consumen CreditsView, DashboardView y ReportsView (antes cada una
  // pedía credits.list por su cuenta, ver informe de auditoría).
  const { credits, creditsLoading: loading, creditsError: loadError, creditsStale, refreshCredits, refreshCustomers } =
    useDataStore();

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  const installments: Installment[] = useMemo(() => {
    const flat = (credits || []).flatMap((c) => c.abonos || []);
    flat.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    return flat;
  }, [credits]);

  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('TODOS');

  // Direct Abono Modal
  const [selectedCreditForNewAbonoId, setSelectedCreditForNewAbonoId] = useState<string | null>(null);
  const [directAbonoModalOpen, setDirectAbonoModalOpen] = useState(false);

  // Selected Installment for Receipt Modal
  const [selectedReceiptInstallment, setSelectedReceiptInstallment] = useState<Installment | null>(null);

  // Void Abono
  const [voidingAbono, setVoidingAbono] = useState<Installment | null>(null);
  const [voidAbonoReason, setVoidAbonoReason] = useState('');
  const [loadingVoidAbono, setLoadingVoidAbono] = useState(false);

  const activeCredits = (credits || []).filter((c) => c && (c.saldoPendiente || 0) > 0);
  const selectedCreditForNewAbono = useMemo(
    () => activeCredits.find((c) => c.id === selectedCreditForNewAbonoId) || null,
    [activeCredits, selectedCreditForNewAbonoId]
  );

  const filteredInstallments = useMemo(() => {
    return (installments || []).filter((inst) => {
      if (!inst) return false;
      const matchesMethod = methodFilter === 'TODOS' || inst.metodoPago === methodFilter;
      const q = searchQuery.toLowerCase().trim();
      const recNum = (inst.numeroRecibo || inst.numeroAbono || '').toLowerCase();
      const client = (inst.clienteNombre || '').toLowerCase();
      const acct = (inst.cuentaCobrarId || '').toLowerCase();
      const user = (inst.usuarioNombre || '').toLowerCase();
      const ref = (inst.referencia || inst.referenciaPago || '').toLowerCase();

      const matchesSearch =
        !q ||
        recNum.includes(q) ||
        client.includes(q) ||
        acct.includes(q) ||
        user.includes(q) ||
        ref.includes(q);

      return matchesMethod && matchesSearch;
    });
  }, [installments, methodFilter, searchQuery]);

  const totalCollected = (filteredInstallments || [])
    .filter((i) => i.estado !== 'ANULADO')
    .reduce((acc, i) => acc + (i.montoAbonado || 0), 0);

  const handleExportCSV = () => {
    const rows = (filteredInstallments || []).map((i) => ({
      NumeroRecibo: i.numeroRecibo || i.numeroAbono,
      Fecha: i.fecha,
      CuentaCobrar: i.cuentaCobrarId,
      Cliente: i.clienteNombre,
      MontoAbonado: i.montoAbonado,
      MetodoPago: i.metodoPago,
      Referencia: i.referencia || i.referenciaPago || 'N/A',
      SaldoAnterior: i.saldoAnterior,
      SaldoRestante: i.saldoRestante ?? i.saldoNuevo,
      Cajero: i.usuarioNombre,
      Estado: i.estado,
    }));
    exportToCSV('Historial_Abonos_ZIO', rows);
    showToast('Exportación Exitosa', 'Historial de abonos exportado en CSV.', 'exito');
  };

  const handleConfirmVoidAbono = async () => {
    if (!voidingAbono) return;
    if (!voidAbonoReason.trim()) {
      showToast('Motivo Requerido', 'Debe ingresar el motivo de la anulación.', 'error');
      return;
    }
    setLoadingVoidAbono(true);
    const res = await creditsApi.voidAbono(voidingAbono.id, voidAbonoReason.trim());
    setLoadingVoidAbono(false);

    if (res.success) {
      showToast('Abono Anulado', res.message, 'exito');
      setVoidingAbono(null);
      setVoidAbonoReason('');
      // CORREGIR AUDITORÍA (§6): invalida créditos y clientes --
      // CreditsView/Dashboard/Reportes/POS reflejan el resultado de
      // inmediato, sin logout/login ni F5.
      await Promise.all([refreshCredits({ force: true }), refreshCustomers({ force: true })]);
    } else {
      showToast('Error', res.message, 'error');
    }
  };

  return (
    <div id="installments-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Cobranzas & Abonos
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Historial de Abonos Recibidos
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
            disabled={installments.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {(hasPermission('creditos.abonos') || hasPermission('abonos.crear')) && activeCredits.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedCreditForNewAbonoId(activeCredits[0].id);
                setDirectAbonoModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Nuevo Abono</span>
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
              No se pudo cargar el historial de abonos desde el backend: {loadError}
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

      {/* Summary KPI Banner */}
      <div className="p-4 bg-[#F6F1E8] rounded-2xl border border-[#E4DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase text-[#756E65]">Total Recaudado en Abonos</span>
          <h2 className="text-2xl font-serif font-bold text-[#2F2A25]">
            {loading ? '...' : formatCurrency(totalCollected, settings.simboloMoneda)}
          </h2>
        </div>
        <div className="text-xs text-[#756E65] sm:text-right">
          <span className="font-bold text-[#2F2A25]">{filteredInstallments.length}</span> recibo(s) de abono en total
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por # recibo, cliente, cuenta o cajero..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>

        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
        >
          <option value="TODOS">Todas las Formas de Pago</option>
          <option value="EFECTIVO">Efectivo</option>
          <option value="TARJETA">Tarjeta</option>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="CHEQUE">Cheque</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        {loading && installments.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando abonos reales en el backend...</p>
          </div>
        ) : !loading && !loadError && installments.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <Coins className="w-8 h-8 opacity-40 mx-auto" />
            <p className="font-semibold text-xs text-[#2F2A25]">No se han registrado abonos aún</p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4"># Recibo</th>
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Cliente</th>
                <th className="py-3 px-4">Cuenta Asociada</th>
                <th className="py-3 px-4">Método</th>
                <th className="py-3 px-4 text-right">Monto Abonado</th>
                <th className="py-3 px-4 text-right">Nuevo Saldo</th>
                <th className="py-3 px-4">Cajero</th>
                <th className="py-3 px-4 text-center">Estado</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredInstallments || []).map((inst) => {
                const recNum = inst.numeroRecibo || inst.numeroAbono || inst.id;
                const saldoRest = inst.saldoRestante ?? inst.saldoNuevo ?? 0;
                const isVoided = inst.estado === 'ANULADO';

                return (
                  <tr key={inst.id} className={`hover:bg-[#FAF8F4]/80 transition ${isVoided ? 'opacity-60' : ''}`}>
                    <td className="py-3.5 px-4 font-mono font-bold text-[#2F2A25]">
                      {recNum}
                    </td>
                    <td className="py-3.5 px-4 text-[#756E65]">{formatDateTime(inst.fecha)}</td>
                    <td className="py-3.5 px-4 font-bold text-[#2F2A25]">{inst.clienteNombre}</td>
                    <td className="py-3.5 px-4 font-mono text-[#756E65]">#{inst.cuentaCobrarId}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[11px] font-semibold text-[#2F2A25]">
                        {inst.metodoPago}
                      </span>
                    </td>
                    <td className={`py-3.5 px-4 text-right font-bold text-sm ${isVoided ? 'text-[#756E65] line-through' : 'text-emerald-700'}`}>
                      {formatCurrency(inst.montoAbonado, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-[#2F2A25]">
                      {formatCurrency(saldoRest, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-[#756E65]">{inst.usuarioNombre}</td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          isVoided
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {inst.estado}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedReceiptInstallment(inst)}
                          className="p-1.5 rounded-lg text-[#2F2A25] hover:bg-[#F6F1E8] border border-[#E4DDD2] transition flex items-center gap-1 text-[11px] font-semibold"
                          title="Ver y reimprimir recibo térmico"
                        >
                          <Printer className="w-3.5 h-3.5 text-[#756E65]" />
                        </button>
                        {!isVoided && hasPermission('creditos.anular_abonos') && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoidingAbono(inst);
                              setVoidAbonoReason('');
                            }}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 transition"
                            title="Anular abono"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {installments.length > 0 && (filteredInstallments || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Coins className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">Ningún abono coincide con los filtros aplicados</p>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Direct Abono Modal with Account Selector.
          AUDITORÍA (FASE -- responsive completo): overlay desplazable
          (`overflow-y-auto` + `my-8`), mismo patrón que el resto de esta
          auditoría -- sin tocar ningún campo ni la lógica de abonos. */}
      {directAbonoModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl my-8">
            <h3 className="text-sm font-bold text-[#2F2A25] border-b border-[#E4DDD2] pb-2">
              Seleccionar Cuenta por Cobrar a Abonar
            </h3>
            <div className="space-y-3">
              <label className="block text-xs font-bold text-[#2F2A25]">Cuentas con saldo pendiente:</label>
              <select
                value={selectedCreditForNewAbonoId || ''}
                onChange={(e) => setSelectedCreditForNewAbonoId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-[#E4DDD2] bg-white text-xs font-semibold text-[#2F2A25]"
              >
                {(activeCredits || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.clienteNombre} — #{c.numeroCredito || c.numeroCuenta} (Saldo: {formatCurrency(c.saldoPendiente, settings.simboloMoneda)})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDirectAbonoModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirectAbonoModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] text-xs font-bold text-white shadow-md hover:bg-[#403932]"
              >
                Continuar a Registrar Abono
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Installment Registration Modal */}
      {selectedCreditForNewAbono && !directAbonoModalOpen && (
        <InstallmentModal
          credit={selectedCreditForNewAbono}
          onClose={() => setSelectedCreditForNewAbonoId(null)}
          onSuccess={async () => {
            setSelectedCreditForNewAbonoId(null);
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

      {/* Thermal Receipt Modal */}
      {selectedReceiptInstallment && (
        <InstallmentReceiptModal
          installment={selectedReceiptInstallment}
          settings={settings}
          onClose={() => setSelectedReceiptInstallment(null)}
        />
      )}
    </div>
  );
};
