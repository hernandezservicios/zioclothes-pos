import React, { useState } from 'react';
import { CreditAccount, PaymentMethodType, Installment } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiService } from '../../services/apiService';
import { formatCurrency } from '../../utils/formatters';
import { printThermalElement } from '../../utils/exportUtils';
import { sounds } from '../../utils/soundEffects';
import confetti from 'canvas-confetti';
import { InstallmentReceiptTicket } from './InstallmentReceiptTicket';
import {
  X,
  Coins,
  CheckCircle2,
  Printer,
  Receipt,
  Send,
} from 'lucide-react';

interface InstallmentModalProps {
  credit: CreditAccount;
  onClose: () => void;
  onSuccess: () => void;
}

export const InstallmentModal: React.FC<InstallmentModalProps> = ({
  credit,
  onClose,
  onSuccess,
}) => {
  const { currentUser, settings } = useAuth();
  const { showToast } = useToast();

  const [montoAbonado, setMontoAbonado] = useState<number | string>(0);
  const [metodoPago, setMetodoPago] = useState<PaymentMethodType>('EFECTIVO');
  const [referencia, setReferencia] = useState<string>('');
  const [notas, setNotas] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [completedInstallment, setCompletedInstallment] = useState<Installment | null>(null);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');

  React.useEffect(() => {
    setMontoAbonado(0);
    setReferencia('');
    setNotas('');
    setMetodoPago('EFECTIVO');
  }, [credit.id]);

  const numericAmount = typeof montoAbonado === 'number' ? montoAbonado : parseFloat(montoAbonado) || 0;
  const nuevoSaldo = Math.max(0, credit.saldoPendiente - numericAmount);

  const handleProcessAbono = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const amount = typeof montoAbonado === 'number' ? montoAbonado : parseFloat(montoAbonado);
    if (!Number.isFinite(amount) || amount <= 0) {
      sounds.playError();
      showToast('Monto Inválido', 'El monto del abono debe ser mayor que RD$ 0.00.', 'error');
      return;
    }
    if (amount > credit.saldoPendiente) {
      sounds.playError();
      showToast(
        'Monto Excede Saldo',
        `El abono no puede superar el saldo pendiente de ${formatCurrency(credit.saldoPendiente, settings.simboloMoneda)}.`,
        'advertencia'
      );
      return;
    }

    setLoading(true);

    const res = await apiService.registerInstallment({
      cuentaCobrarId: credit.id,
      monto: amount,
      metodoPago,
      referencia: referencia.trim() || undefined,
      observaciones: notas.trim() || undefined,
    });

    setLoading(false);

    if (res.success && res.data) {
      sounds.playSuccess();
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
      showToast('Abono Registrado', res.message, 'exito');
      setCompletedInstallment(res.data);
    } else {
      sounds.playError();
      showToast('Error', res.message, 'error');
    }
  };

  const handlePrintReceipt = () => {
    printThermalElement('abono-thermal-voucher');
  };

  const handleWhatsApp = () => {
    if (!completedInstallment) return;
    const recNum = completedInstallment.numeroRecibo || completedInstallment.numeroAbono;
    const saldoAnt = completedInstallment.saldoAnterior || 0;
    const abonoMonto = completedInstallment.montoAbonado || 0;
    const saldoRest = completedInstallment.saldoRestante ?? completedInstallment.saldoNuevo ?? 0;

    const text = encodeURIComponent(
      `*${settings.nombreNegocio || 'ZIO CLOTHES'}* - Comprobante de Abono\n` +
      `--------------------------------\n` +
      `*Recibo:* ${recNum}\n` +
      `*Cliente:* ${completedInstallment.clienteNombre}\n` +
      `*Cuenta:* #${completedInstallment.cuentaCobrarId}\n` +
      `*Fecha:* ${completedInstallment.fecha}\n` +
      `*Saldo Anterior:* ${settings.simboloMoneda} ${saldoAnt.toLocaleString()}\n` +
      `*Monto Abonado:* ${settings.simboloMoneda} ${abonoMonto.toLocaleString()}\n` +
      `*Saldo Restante:* ${settings.simboloMoneda} ${saldoRest.toLocaleString()}\n` +
      `*Forma de Pago:* ${completedInstallment.metodoPago}\n` +
      `--------------------------------\n` +
      `¡Gracias por su puntual abono!`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 my-8">
        {/* Header */}
        <div className="no-print p-4 border-b border-[#E4DDD2] flex items-center justify-between bg-[#F6F1E8]">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-emerald-700" />
            <h3 className="text-sm font-bold text-[#2F2A25]">
              {completedInstallment ? 'Recibo de Abono' : 'Registrar Abono a Cuenta'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {completedInstallment && (
              <div className="flex items-center bg-white border border-[#E4DDD2] rounded-lg p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setPaperWidth('80mm')}
                  className={`px-2 py-0.5 rounded transition ${
                    paperWidth === '80mm' ? 'bg-[#2F2A25] text-white' : 'text-[#756E65]'
                  }`}
                >
                  80mm
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth('58mm')}
                  className={`px-2 py-0.5 rounded transition ${
                    paperWidth === '58mm' ? 'bg-[#2F2A25] text-white' : 'text-[#756E65]'
                  }`}
                >
                  58mm
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (completedInstallment) onSuccess();
                else onClose();
              }}
              className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#E8DCC8]/50 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!completedInstallment ? (
          /* FORM VIEW */
          <form onSubmit={handleProcessAbono} noValidate className="p-5 space-y-4 text-xs">
            {/* Account Summary Banner */}
            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#756E65]">Cuenta por Cobrar:</span>
                <span className="font-bold text-[#2F2A25]">{credit.numeroCredito || credit.numeroCuenta}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#756E65]">Cliente:</span>
                <span className="font-bold text-[#2F2A25]">{credit.clienteNombre}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#756E65]">Factura Original:</span>
                <span className="font-mono text-[#2F2A25]">{credit.numeroVenta}</span>
              </div>
              <div className="pt-1.5 border-t border-[#E4DDD2] flex justify-between font-bold">
                <span className="text-[#756E65]">Saldo Pendiente Actual:</span>
                <span className="text-rose-700 text-sm">
                  {formatCurrency(credit.saldoPendiente, settings.simboloMoneda)}
                </span>
              </div>
            </div>

            {/* Input Amount */}
            <div>
              <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">
                Monto del Abono (RD$):
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-[#756E65]">
                  {settings.simboloMoneda}
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={montoAbonado === '' ? '' : montoAbonado}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setMontoAbonado('');
                    } else {
                      const num = parseFloat(val);
                      setMontoAbonado(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-base text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
                />
              </div>

              {/* Quick Amount Pills */}
              <div className="flex gap-1.5 mt-2">
                <button
                  type="button"
                  onClick={() => setMontoAbonado(credit.saldoPendiente)}
                  className="px-2.5 py-1 rounded-lg bg-[#F6F1E8] border border-[#E4DDD2] text-[11px] font-bold text-[#2F2A25] hover:bg-[#E8DCC8]"
                >
                  Saldar Total ({formatCurrency(credit.saldoPendiente, settings.simboloMoneda)})
                </button>
                {credit.saldoPendiente > 1000 && (
                  <button
                    type="button"
                    onClick={() => setMontoAbonado(Math.round(credit.saldoPendiente / 2))}
                    className="px-2.5 py-1 rounded-lg bg-[#F6F1E8] border border-[#E4DDD2] text-[11px] font-medium text-[#2F2A25] hover:bg-[#E8DCC8]"
                  >
                    50%
                  </button>
                )}
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">
                Método de Cobro:
              </label>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value as PaymentMethodType)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-semibold text-xs text-[#2F2A25]"
              >
                <option value="EFECTIVO">Efectivo de Caja</option>
                <option value="TARJETA">Tarjeta de Débito / Crédito</option>
                <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>

            {metodoPago !== 'EFECTIVO' && (
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">
                  Referencia / Comprobante de Transacción:
                </label>
                <input
                  type="text"
                  placeholder="Ej. BPD-TRF-49910 o Aprobación POS"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white text-xs"
                />
              </div>
            )}

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">Notas / Observaciones:</label>
              <input
                type="text"
                placeholder="Ej. Abono quincena / Pagado por familiar"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white text-xs"
              />
            </div>

            {/* New Balance Projection */}
            <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-center justify-between text-xs font-bold text-emerald-900">
              <span>Nuevo Saldo Restante:</span>
              <span className="text-sm">{formatCurrency(nuevoSaldo, settings.simboloMoneda)}</span>
            </div>

            <div className="flex gap-2 pt-2 border-t border-[#E4DDD2]">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] text-xs font-bold text-white shadow-md hover:bg-[#403932] disabled:bg-zinc-300 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{loading ? 'Procesando...' : 'Aplicar Abono'}</span>
              </button>
            </div>
          </form>
        ) : (
          /* COMPLETED RECEIPT VOUCHER */
          <div className="p-5 space-y-4">
            <div className="bg-white p-2 rounded-2xl border border-[#E4DDD2] shadow-xs flex justify-center">
              <InstallmentReceiptTicket
                id="abono-thermal-voucher"
                installment={completedInstallment}
                settings={settings}
                paperWidth={paperWidth}
              />
            </div>

            <div className="no-print flex gap-2">
              <button
                type="button"
                onClick={onSuccess}
                className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleWhatsApp}
                className="py-2.5 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-center gap-1 hover:bg-emerald-100"
                title="Compartir por WhatsApp"
              >
                <Send className="w-3.5 h-3.5 text-emerald-600" />
                <span>WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={handlePrintReceipt}
                className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-[#E8DCC8]" />
                <span>Imprimir</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
