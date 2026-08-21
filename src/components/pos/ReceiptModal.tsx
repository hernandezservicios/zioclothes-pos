import React, { useState } from 'react';
import { Sale } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { printThermalElement } from '../../utils/exportUtils';
import { ReceiptTicket } from './ReceiptTicket';
import { X, Printer, CheckCircle2 } from 'lucide-react';

interface ReceiptModalProps {
  sale: Sale | null;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, onClose }) => {
  const { settings } = useAuth();
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>('80mm');

  if (!sale) return null;

  const handlePrint = () => {
    printThermalElement('thermal-receipt-content', `Factura_${sale.numeroVenta}_ZIO`);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 my-8">
        {/* Top Actions - Hidden in Print */}
        <div className="no-print p-4 border-b border-[#E4DDD2] flex items-center justify-between bg-[#F6F1E8]">
          <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Venta Procesada Exitosamente</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-[#E8DCC8]/60 p-0.5 rounded-lg text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-2 py-0.5 rounded-md transition ${
                  paperWidth === '80mm' ? 'bg-[#2F2A25] text-white' : 'text-[#756E65]'
                }`}
              >
                80 mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-2 py-0.5 rounded-md transition ${
                  paperWidth === '58mm' ? 'bg-[#2F2A25] text-white' : 'text-[#756E65]'
                }`}
              >
                58 mm
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#E8DCC8]/50 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Ticket Area - Uses the exact same ReceiptTicket component */}
        <div className="p-6 bg-zinc-100/60 overflow-y-auto max-h-[65vh] flex justify-center">
          <div className="bg-white shadow-md border border-zinc-200 rounded-lg p-2">
            <ReceiptTicket
              id="thermal-receipt-content"
              sale={sale}
              settings={settings}
              paperWidth={paperWidth}
            />
          </div>
        </div>

        {/* Action Buttons - Hidden in Print */}
        <div className="no-print p-4 border-t border-[#E4DDD2] bg-[#F6F1E8] flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-[#756E65] bg-white border border-[#E4DDD2] hover:bg-zinc-50 transition"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex-2 py-2.5 px-4 rounded-xl text-xs font-bold text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-[#E8DCC8]" />
            <span>Imprimir Ticket ({paperWidth})</span>
          </button>
        </div>
      </div>
    </div>
  );
};


