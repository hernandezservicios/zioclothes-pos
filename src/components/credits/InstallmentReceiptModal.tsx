import React, { useState } from 'react';
import { PaymentInstallment, SystemSettings } from '../../types';
import { InstallmentReceiptTicket } from './InstallmentReceiptTicket';
import { printThermalElement } from '../../utils/exportUtils';
import { useToast } from '../../context/ToastContext';
import {
  Printer,
  X,
  Send,
  Download,
  Copy,
  CheckCircle2,
  FileText,
} from 'lucide-react';

interface InstallmentReceiptModalProps {
  installment: PaymentInstallment | null;
  settings: SystemSettings;
  onClose: () => void;
}

export const InstallmentReceiptModal: React.FC<InstallmentReceiptModalProps> = ({
  installment,
  settings,
  onClose,
}) => {
  const { showToast } = useToast();
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const [copied, setCopied] = useState(false);

  if (!installment) return null;

  const receiptNumber = installment.numeroRecibo || installment.numeroAbono || installment.id;
  const saldoAnterior = installment.saldoAnterior ?? 0;
  const montoAbonado = installment.montoAbonado ?? 0;
  const saldoRestante = installment.saldoRestante ?? installment.saldoNuevo ?? Math.max(0, saldoAnterior - montoAbonado);

  const handlePrint = () => {
    printThermalElement('installment-thermal-receipt-modal');
    showToast('Imprimiendo', `Enviando recibo ${receiptNumber} a la impresora térmica...`, 'informacion');
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(
      `*${settings.nombreNegocio || 'ZIO CLOTHES'}* - Comprobante de Abono\n` +
      `--------------------------------\n` +
      `*Recibo:* ${receiptNumber}\n` +
      `*Cliente:* ${installment.clienteNombre}\n` +
      `*Cuenta:* #${installment.cuentaCobrarId}\n` +
      `*Fecha:* ${installment.fecha}\n` +
      `*Saldo Anterior:* ${settings.simboloMoneda} ${saldoAnterior.toLocaleString()}\n` +
      `*Monto Abonado:* ${settings.simboloMoneda} ${montoAbonado.toLocaleString()}\n` +
      `*Saldo Restante:* ${settings.simboloMoneda} ${saldoRestante.toLocaleString()}\n` +
      `*Forma de Pago:* ${installment.metodoPago}\n` +
      `--------------------------------\n` +
      `¡Gracias por su puntual abono!`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleCopyText = () => {
    const text =
      `${settings.nombreNegocio || 'ZIO CLOTHES'} - Recibo de Abono ${receiptNumber}\n` +
      `Cliente: ${installment.clienteNombre}\n` +
      `Cuenta: #${installment.cuentaCobrarId}\n` +
      `Fecha: ${installment.fecha}\n` +
      `Abono: ${settings.simboloMoneda} ${montoAbonado.toLocaleString()}\n` +
      `Saldo Restante: ${settings.simboloMoneda} ${saldoRestante.toLocaleString()}\n` +
      `Cajero: ${installment.usuarioNombre}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    showToast('Copiado', 'Detalles del comprobante copiados al portapapeles.', 'exito');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#FAF8F4] rounded-3xl border border-[#E4DDD2] shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E4DDD2] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#F6F1E8] border border-[#E4DDD2] flex items-center justify-center text-[#2F2A25]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[#2F2A25]">
                Comprobante de Abono
              </h3>
              <p className="text-[11px] font-mono text-[#756E65]">{receiptNumber}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Paper Switcher */}
            <div className="flex items-center bg-[#FAF8F4] border border-[#E4DDD2] rounded-xl p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  paperWidth === '80mm'
                    ? 'bg-[#2F2A25] text-white shadow-2xs'
                    : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  paperWidth === '58mm'
                    ? 'bg-[#2F2A25] text-white shadow-2xs'
                    : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                58mm
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Thermal Ticket Container */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-[#ECE7DE]/50 flex justify-center items-start">
          <div className="bg-white p-2 rounded-2xl shadow-md border border-[#E4DDD2]/80">
            <InstallmentReceiptTicket
              id="installment-thermal-receipt-modal"
              installment={installment}
              settings={settings}
              paperWidth={paperWidth}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-[#E4DDD2] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyText}
              className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition flex items-center gap-1.5"
              title="Copiar texto del recibo"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#756E65]" />
                  <span>Copiar</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleWhatsApp}
              className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition flex items-center gap-1.5"
              title="Compartir por WhatsApp"
            >
              <Send className="w-3.5 h-3.5 text-emerald-600" />
              <span>WhatsApp</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#756E65] hover:bg-[#F6F1E8] transition"
            >
              Cerrar
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Printer className="w-4 h-4 text-[#E8DCC8]" />
              <span>Imprimir Recibo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
