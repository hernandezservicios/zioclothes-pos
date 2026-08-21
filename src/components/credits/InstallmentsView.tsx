import React, { useState, useMemo } from 'react';
import { Installment, CreditAccount } from '../../types';
import { storageService } from '../../services/storageService';
import { useAuth } from '../../context/AuthContext';
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
} from 'lucide-react';

export const InstallmentsView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [installments, setInstallments] = useState<Installment[]>(() => storageService.getInstallments() || []);
  const credits = storageService.getCredits() || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('TODOS');

  // Direct Abono Modal
  const [selectedCreditForNewAbono, setSelectedCreditForNewAbono] = useState<CreditAccount | null>(null);
  const [directAbonoModalOpen, setDirectAbonoModalOpen] = useState(false);

  // Selected Installment for Receipt Modal
  const [selectedReceiptInstallment, setSelectedReceiptInstallment] = useState<Installment | null>(null);

  const activeCredits = (credits || []).filter((c) => c && (c.saldoPendiente || 0) > 0);

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

  const totalCollected = (filteredInstallments || []).reduce((acc, i) => acc + (i.montoAbonado || 0), 0);

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
    }));
    exportToCSV('Historial_Abonos_ZIO', rows);
    showToast('Exportación Exitosa', 'Historial de abonos exportado en CSV.', 'exito');
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
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {(hasPermission('creditos.abonos') || hasPermission('abonos.crear')) && activeCredits.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedCreditForNewAbono(activeCredits[0]);
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

      {/* Summary KPI Banner */}
      <div className="p-4 bg-[#F6F1E8] rounded-2xl border border-[#E4DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase text-[#756E65]">Total Recaudado en Abonos</span>
          <h2 className="text-2xl font-serif font-bold text-[#2F2A25]">
            {formatCurrency(totalCollected, settings.simboloMoneda)}
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
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredInstallments || []).map((inst) => {
                const recNum = inst.numeroRecibo || inst.numeroAbono || inst.id;
                const saldoRest = inst.saldoRestante ?? inst.saldoNuevo ?? 0;

                return (
                  <tr key={inst.id} className="hover:bg-[#FAF8F4]/80 transition">
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
                    <td className="py-3.5 px-4 text-right font-bold text-emerald-700 text-sm">
                      {formatCurrency(inst.montoAbonado, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-[#2F2A25]">
                      {formatCurrency(saldoRest, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-[#756E65]">{inst.usuarioNombre}</td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedReceiptInstallment(inst)}
                          className="p-1.5 rounded-lg text-[#2F2A25] hover:bg-[#F6F1E8] border border-[#E4DDD2] transition flex items-center gap-1 text-[11px] font-semibold"
                          title="Ver y reimprimir recibo térmico"
                        >
                          <Printer className="w-3.5 h-3.5 text-[#756E65]" />
                          <span>Recibo</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(filteredInstallments || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Coins className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">No se han registrado abonos aún</p>
            </div>
          )}
        </div>
      </div>

      {/* Direct Abono Modal with Account Selector */}
      {directAbonoModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-[#2F2A25] border-b border-[#E4DDD2] pb-2">
              Seleccionar Cuenta por Cobrar a Abonar
            </h3>
            <div className="space-y-3">
              <label className="block text-xs font-bold text-[#2F2A25]">Cuentas con saldo pendiente:</label>
              <select
                value={selectedCreditForNewAbono?.id || ''}
                onChange={(e) => {
                  const found = (activeCredits || []).find((c) => c && c.id === e.target.value);
                  if (found) setSelectedCreditForNewAbono(found);
                }}
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
          onClose={() => setSelectedCreditForNewAbono(null)}
          onSuccess={() => {
            setSelectedCreditForNewAbono(null);
            setInstallments(storageService.getInstallments());
          }}
        />
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
