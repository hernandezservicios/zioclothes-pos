import React, { useState } from 'react';
import { CreditNote, SystemSettings } from '../../types';
import { CreditNoteReceiptTicket } from './CreditNoteReceiptTicket';
import { printThermalElement } from '../../utils/exportUtils';
import { useToast } from '../../context/ToastContext';
import { Printer, X, Send, Copy, CheckCircle2, FileText } from 'lucide-react';

interface CreditNoteReceiptModalProps {
  creditNote: CreditNote | null;
  settings: SystemSettings;
  onClose: () => void;
}

/**
 * FASE 6 — Modal de impresión/reimpresión para un Crédito a Favor/Vale o
 * una Nota de Crédito, siguiendo el mismo patrón visual de
 * InstallmentReceiptModal.tsx (selector de ancho de papel, copiar,
 * WhatsApp, imprimir). No es un comprobante fiscal -- ver
 * CreditNoteReceiptTicket.tsx.
 */
export const CreditNoteReceiptModal: React.FC<CreditNoteReceiptModalProps> = ({ creditNote, settings, onClose }) => {
  const { showToast } = useToast();
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');
  const [copied, setCopied] = useState(false);

  if (!creditNote) return null;

  const esNota = creditNote.tipo === 'NOTA_CREDITO';
  const tituloDocumento = esNota ? 'Nota de Crédito' : 'Crédito a Favor / Vale';

  const handlePrint = () => {
    printThermalElement('credit-note-thermal-receipt-modal');
    showToast('Imprimiendo', `Enviando ${tituloDocumento.toLowerCase()} ${creditNote.numero} a la impresora térmica...`, 'informacion');
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(
      `*${settings.nombreNegocio || 'ZIO CLOTHES'}* - ${tituloDocumento}\n` +
      `--------------------------------\n` +
      `*N°:* ${creditNote.numero}\n` +
      `*Cliente:* ${creditNote.clienteNombre}\n` +
      `*Monto Original:* ${settings.simboloMoneda} ${creditNote.montoOriginal.toLocaleString()}\n` +
      `*Saldo Disponible:* ${settings.simboloMoneda} ${creditNote.saldoDisponible.toLocaleString()}\n` +
      `*Estado:* ${creditNote.estado}\n` +
      `--------------------------------\n` +
      `Documento interno del negocio, no es un comprobante fiscal.`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleCopyText = () => {
    const text =
      `${settings.nombreNegocio || 'ZIO CLOTHES'} - ${tituloDocumento} ${creditNote.numero}\n` +
      `Cliente: ${creditNote.clienteNombre}\n` +
      `Monto Original: ${settings.simboloMoneda} ${creditNote.montoOriginal.toLocaleString()}\n` +
      `Saldo Disponible: ${settings.simboloMoneda} ${creditNote.saldoDisponible.toLocaleString()}\n` +
      `Estado: ${creditNote.estado}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    showToast('Copiado', 'Detalles del documento copiados al portapapeles.', 'exito');
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
              <h3 className="text-sm sm:text-base font-bold text-[#2F2A25]">{tituloDocumento}</h3>
              <p className="text-[11px] font-mono text-[#756E65]">{creditNote.numero}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#FAF8F4] border border-[#E4DDD2] rounded-xl p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  paperWidth === '80mm' ? 'bg-[#2F2A25] text-white shadow-2xs' : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  paperWidth === '58mm' ? 'bg-[#2F2A25] text-white shadow-2xs' : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                58mm
              </button>
            </div>

            <button type="button" onClick={onClose} className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Thermal Ticket Container */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-[#ECE7DE]/50 flex justify-center items-start">
          <div className="bg-white p-2 rounded-2xl shadow-md border border-[#E4DDD2]/80">
            <CreditNoteReceiptTicket
              id="credit-note-thermal-receipt-modal"
              creditNote={creditNote}
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
              title="Copiar texto del documento"
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
              <span>Imprimir / Reimprimir</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
