import React, { useState } from 'react';
import { Customer, PaymentMethodType, Sale, SaleItem, SalePaymentSplit } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { formatCurrency } from '../../utils/formatters';
import { sounds } from '../../utils/soundEffects';
import confetti from 'canvas-confetti';
import {
  X,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  Calendar,
  Split,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  UserCheck,
} from 'lucide-react';

interface PaymentModalProps {
  items: SaleItem[];
  subtotal: number;
  descuentoTotal: number;
  impuestoTotal: number;
  total: number;
  selectedCustomer: Customer;
  onClose: () => void;
  onSuccess: (sale: Sale) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  items,
  subtotal,
  descuentoTotal,
  impuestoTotal,
  total,
  selectedCustomer,
  onClose,
  onSuccess,
}) => {
  const { currentUser, settings } = useAuth();
  const { showToast } = useToast();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('EFECTIVO');
  const [efectivoRecibido, setEfectivoRecibido] = useState<number | string>(0);
  const [referenciaTarjeta, setReferenciaTarjeta] = useState<string>('');
  const [referenciaTransferencia, setReferenciaTransferencia] = useState<string>('');
  const [diasPlazo, setDiasPlazo] = useState<number>(selectedCustomer.diasCreditoPorDefecto || 30);
  const [observacionesCredito, setObservacionesCredito] = useState<string>('');

  // Mixed payment states (all start at 0)
  const [splitCash, setSplitCash] = useState<number | string>(0);
  const [splitCard, setSplitCard] = useState<number | string>(0);
  const [splitTransfer, setSplitTransfer] = useState<number | string>(0);
  const [splitCredit, setSplitCredit] = useState<number | string>(0);

  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    setEfectivoRecibido(0);
    setReferenciaTarjeta('');
    setReferenciaTransferencia('');
    setObservacionesCredito('');
    setSplitCash(0);
    setSplitCard(0);
    setSplitTransfer(0);
    setSplitCredit(0);
  }, [selectedCustomer.id, total]);

  // Customer Credit Analysis
  const activeCredits = (storageService.getCredits() || []).filter(
    (c) =>
      c.clienteId === selectedCustomer.id &&
      (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL' || c.estado === 'VENCIDA')
  );
  const currentDebt = activeCredits.reduce((acc, c) => acc + c.saldoPendiente, 0);
  const availableCredit = selectedCustomer.limiteCredito - currentDebt;
  const hasOverdue = activeCredits.some((c) => c.estado === 'VENCIDA');

  // Change Calculation for Cash
  const numEfectivoRecibido = typeof efectivoRecibido === 'number' ? efectivoRecibido : parseFloat(efectivoRecibido) || 0;
  const cambio = Math.max(0, numEfectivoRecibido - total);

  // Split sum validation
  const numSplitCash = typeof splitCash === 'number' ? splitCash : parseFloat(splitCash) || 0;
  const numSplitCard = typeof splitCard === 'number' ? splitCard : parseFloat(splitCard) || 0;
  const numSplitTransfer = typeof splitTransfer === 'number' ? splitTransfer : parseFloat(splitTransfer) || 0;
  const numSplitCredit = typeof splitCredit === 'number' ? splitCredit : parseFloat(splitCredit) || 0;

  const splitTotal = numSplitCash + numSplitCard + numSplitTransfer + numSplitCredit;
  const splitDifference = total - splitTotal;

  const handleProcessSale = async () => {
    if (!currentUser) return;
    setLoading(true);

    try {
      let finalPayments: SalePaymentSplit[] = [];
      let esCredito = false;
      let montoFinanciado = 0;

      if (paymentMethod === 'EFECTIVO') {
        const cashAmount = typeof efectivoRecibido === 'number' ? efectivoRecibido : parseFloat(efectivoRecibido);
        if (!Number.isFinite(cashAmount) || cashAmount < total) {
          sounds.playError();
          showToast('Monto Insuficiente', `El efectivo recibido (RD$ ${(cashAmount || 0).toLocaleString()}) no puede ser menor al total de la venta (${formatCurrency(total, settings.simboloMoneda)}).`, 'error');
          setLoading(false);
          return;
        }
        finalPayments = [{ metodo: 'EFECTIVO', monto: total }];
      } else if (paymentMethod === 'TARJETA') {
        finalPayments = [{ metodo: 'TARJETA', monto: total, referencia: referenciaTarjeta || 'TARJETA-POS' }];
      } else if (paymentMethod === 'TRANSFERENCIA') {
        finalPayments = [
          { metodo: 'TRANSFERENCIA', monto: total, referencia: referenciaTransferencia || 'TRANSFERENCIA' },
        ];
      } else if (paymentMethod === 'CREDITO') {
        if (selectedCustomer.id === 'CLI-005' || selectedCustomer.nombre === 'Consumidor Final') {
          sounds.playError();
          showToast('Cliente Requerido', 'No se puede otorgar crédito al cliente genérico "Consumidor Final". Seleccione un cliente registrado.', 'advertencia');
          setLoading(false);
          return;
        }
        if (total > availableCredit && selectedCustomer.limiteCredito > 0) {
          sounds.playError();
          showToast(
            'Límite de Crédito Excedido',
            `El total (${formatCurrency(total, settings.simboloMoneda)}) supera el crédito disponible (${formatCurrency(Math.max(0, availableCredit), settings.simboloMoneda)})`,
            'error'
          );
          setLoading(false);
          return;
        }
        esCredito = true;
        montoFinanciado = total;
        finalPayments = [{ metodo: 'CREDITO', monto: total }];
      } else if (paymentMethod === 'MIXTO') {
        if (Math.abs(splitDifference) > 0.01) {
          sounds.playError();
          showToast(
            'Monto Mixto No Cuadra',
            `La suma de pagos (${formatCurrency(splitTotal, settings.simboloMoneda)}) debe coincidir exactamente con el total (${formatCurrency(total, settings.simboloMoneda)}). Diferencia: ${formatCurrency(splitDifference, settings.simboloMoneda)}`,
            'error'
          );
          setLoading(false);
          return;
        }

        if (splitCash > 0) finalPayments.push({ metodo: 'EFECTIVO', monto: splitCash });
        if (splitCard > 0) finalPayments.push({ metodo: 'TARJETA', monto: splitCard });
        if (splitTransfer > 0) finalPayments.push({ metodo: 'TRANSFERENCIA', monto: splitTransfer });
        if (splitCredit > 0) {
          if (selectedCustomer.id === 'CLI-005') {
            showToast('Cliente Requerido', 'Debe seleccionar un cliente registrado para la porción a crédito.', 'advertencia');
            setLoading(false);
            return;
          }
          if (splitCredit > availableCredit && selectedCustomer.limiteCredito > 0) {
            showToast('Límite Excedido', 'La porción a crédito excede el disponible del cliente.', 'error');
            setLoading(false);
            return;
          }
          esCredito = true;
          montoFinanciado = splitCredit;
          finalPayments.push({ metodo: 'CREDITO', monto: splitCredit });
        }
      }

      const res = await apiService.createSale({
        clienteId: selectedCustomer.id,
        clienteNombre: `${selectedCustomer.nombre} ${selectedCustomer.apellido}`.trim(),
        clienteDocumento: selectedCustomer.documento,
        vendedorId: currentUser.id,
        vendedorNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        items,
        subtotal,
        descuentoTotal,
        impuestoTotal,
        total,
        metodoPago: paymentMethod,
        pagos: finalPayments,
        efectivoRecibido: paymentMethod === 'EFECTIVO' ? efectivoRecibido : undefined,
        cambioEntregado: paymentMethod === 'EFECTIVO' ? cambio : undefined,
        esCredito,
        montoFinanciado: esCredito ? montoFinanciado : undefined,
        estado: 'COMPLETADA',
      });

      if (res.success && res.data) {
        sounds.playSuccess();
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
        showToast('Venta Procesada', res.message, 'exito');
        onSuccess(res.data);
      } else {
        sounds.playError();
        showToast('Error al Procesar Venta', res.message, 'error');
      }
    } catch (err: any) {
      sounds.playError();
      showToast('Error Inesperado', err.message || 'Ocurrió un error al procesar la venta', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 my-8">
        {/* Header */}
        <div className="p-5 border-b border-[#E4DDD2] flex items-center justify-between bg-[#F6F1E8]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#2F2A25] text-[#E8DCC8] flex items-center justify-center shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#2F2A25]">Cobro de Venta</h3>
              <p className="text-xs text-[#756E65]">
                Cliente: <span className="font-semibold text-[#2F2A25]">{selectedCustomer.nombre} {selectedCustomer.apellido}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#E8DCC8]/50 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Total Banner */}
        <div className="p-5 bg-gradient-to-br from-[#2F2A25] to-[#4A433B] text-[#FAF8F4] flex items-center justify-between">
          <div>
            <span className="text-xs uppercase tracking-widest text-[#E8DCC8] font-medium">Total a Cobrar</span>
            <div className="text-3xl font-serif font-bold text-white tracking-tight">
              {formatCurrency(total, settings.simboloMoneda)}
            </div>
            <span className="text-[11px] text-[#E8DCC8]/80">
              {(items || []).length} prenda(s) en orden
            </span>
          </div>
          <div className="text-right text-xs space-y-0.5 text-[#E8DCC8]/80">
            <div>Subtotal: {formatCurrency(subtotal, settings.simboloMoneda)}</div>
            {descuentoTotal > 0 && <div className="text-emerald-300">Descuento: -{formatCurrency(descuentoTotal, settings.simboloMoneda)}</div>}
            {impuestoTotal > 0 && <div>ITBIS: {formatCurrency(impuestoTotal, settings.simboloMoneda)}</div>}
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Payment Method Tabs */}
          <div>
            <label className="block text-xs font-bold text-[#2F2A25] mb-2 uppercase tracking-wider">
              Forma de Pago:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('EFECTIVO')}
                className={`p-2.5 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'EFECTIVO'
                    ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25] shadow-xs'
                    : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                }`}
              >
                <Banknote className="w-4 h-4" />
                <span>Efectivo</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('TARJETA')}
                className={`p-2.5 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'TARJETA'
                    ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25] shadow-xs'
                    : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Tarjeta</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('TRANSFERENCIA')}
                className={`p-2.5 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'TRANSFERENCIA'
                    ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25] shadow-xs'
                    : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                }`}
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>Transferencia</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CREDITO')}
                className={`p-2.5 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  paymentMethod === 'CREDITO'
                    ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25] shadow-xs'
                    : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>A Crédito</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('MIXTO');
                  setSplitCash(0);
                  setSplitCard(0);
                  setSplitTransfer(0);
                  setSplitCredit(0);
                }}
                className={`p-2.5 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition col-span-2 sm:col-span-1 ${
                  paymentMethod === 'MIXTO'
                    ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25] shadow-xs'
                    : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                }`}
              >
                <Split className="w-4 h-4" />
                <span>Mixto</span>
              </button>
            </div>
          </div>

          {/* EFECTIVO PANEL */}
          {paymentMethod === 'EFECTIVO' && (
            <div className="bg-white p-4 rounded-2xl border border-[#E4DDD2] space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#2F2A25] mb-1.5 uppercase tracking-wider">
                  Efectivo Recibido:
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#756E65]">
                    {settings.simboloMoneda}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={efectivoRecibido === '' ? '' : efectivoRecibido}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setEfectivoRecibido('');
                      } else {
                        const num = parseFloat(val);
                        setEfectivoRecibido(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] font-bold text-lg text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
                  />
                </div>
              </div>

              {/* Quick Cash Buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEfectivoRecibido(total)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#F6F1E8] border border-[#E4DDD2] text-[#2F2A25] hover:bg-[#E8DCC8]"
                >
                  Exacto ({formatCurrency(total, settings.simboloMoneda)})
                </button>
                {[500, 1000, 2000, 5000].map((bill) => (
                  <button
                    key={bill}
                    type="button"
                    onClick={() => setEfectivoRecibido(bill)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[#F6F1E8] border border-[#E4DDD2] text-[#2F2A25] hover:bg-[#E8DCC8]"
                  >
                    RD$ {bill.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Cambio Result */}
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-900 uppercase">Cambio a Devolver:</span>
                <span className="text-xl font-bold text-emerald-800">
                  {formatCurrency(cambio, settings.simboloMoneda)}
                </span>
              </div>
            </div>
          )}

          {/* TARJETA PANEL */}
          {paymentMethod === 'TARJETA' && (
            <div className="bg-white p-4 rounded-2xl border border-[#E4DDD2] space-y-3">
              <label className="block text-xs font-bold text-[#2F2A25] uppercase tracking-wider">
                Referencia / Código de Aprobación POS:
              </label>
              <input
                type="text"
                placeholder="Ej. APR-89410 o Últimos 4 dígitos"
                value={referenciaTarjeta}
                onChange={(e) => setReferenciaTarjeta(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
              />
              <p className="text-[11px] text-[#756E65]">
                Procese el cobro en su terminal bancario (Verifone / Cardnet / Azul) y coloque la referencia.
              </p>
            </div>
          )}

          {/* TRANSFERENCIA PANEL */}
          {paymentMethod === 'TRANSFERENCIA' && (
            <div className="bg-white p-4 rounded-2xl border border-[#E4DDD2] space-y-3">
              <label className="block text-xs font-bold text-[#2F2A25] uppercase tracking-wider">
                Comprobante / Banco Emisor:
              </label>
              <input
                type="text"
                placeholder="Ej. BPD-TRF-091244 / Banco Popular"
                value={referenciaTransferencia}
                onChange={(e) => setReferenciaTransferencia(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
              />
              <p className="text-[11px] text-[#756E65]">
                Verifique que los fondos hayan ingresado a la cuenta bancaria de la boutique.
              </p>
            </div>
          )}

          {/* CRÉDITO PANEL (CRÍTICO) */}
          {paymentMethod === 'CREDITO' && (
            <div className="bg-white p-4 rounded-2xl border border-[#E4DDD2] space-y-4">
              {/* Credit Status Card */}
              <div className="p-3.5 rounded-xl border border-[#E4DDD2] bg-[#F6F1E8]/70 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#756E65]">Límite de Crédito:</span>
                  <span className="font-bold text-[#2F2A25]">
                    {formatCurrency(selectedCustomer.limiteCredito, settings.simboloMoneda)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#756E65]">Deuda Actual Acumulada:</span>
                  <span className="font-bold text-rose-700">
                    {formatCurrency(currentDebt, settings.simboloMoneda)}
                  </span>
                </div>
                <div className="border-t border-[#E4DDD2] pt-2 flex items-center justify-between text-xs font-bold">
                  <span className="text-[#2F2A25]">Crédito Disponible:</span>
                  <span className={availableCredit >= total ? 'text-emerald-700' : 'text-rose-600'}>
                    {formatCurrency(Math.max(0, availableCredit), settings.simboloMoneda)}
                  </span>
                </div>
              </div>

              {hasOverdue && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Este cliente posee facturas vencidas pendientes de pago.</span>
                </div>
              )}

              {/* Term Days Selection */}
              <div>
                <label className="block text-xs font-bold text-[#2F2A25] mb-1.5 uppercase tracking-wider">
                  Plazo de Vencimiento:
                </label>
                <div className="flex gap-2">
                  {[7, 15, 30, 45, 60].map((dias) => (
                    <button
                      key={dias}
                      type="button"
                      onClick={() => setDiasPlazo(dias)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                        diasPlazo === dias
                          ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25]'
                          : 'bg-[#FAF8F4] text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                      }`}
                    >
                      {dias} días
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-[#2F2A25] mb-1.5 uppercase tracking-wider">
                  Observaciones / Condiciones:
                </label>
                <input
                  type="text"
                  placeholder="Ej. Cuotas quincenales / Autorizado por gerencia"
                  value={observacionesCredito}
                  onChange={(e) => setObservacionesCredito(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
                />
              </div>
            </div>
          )}

          {/* MIXTO PANEL */}
          {paymentMethod === 'MIXTO' && (
            <div className="bg-white p-4 rounded-2xl border border-[#E4DDD2] space-y-3">
              <p className="text-xs text-[#756E65] leading-relaxed">
                Distribuya los montos exactos entre las diferentes vías de cobro:
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-[#2F2A25] mb-1">Efectivo:</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={splitCash === '' ? '' : splitCash}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setSplitCash('');
                      else {
                        const num = parseFloat(val);
                        setSplitCash(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#2F2A25] mb-1">Tarjeta:</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={splitCard === '' ? '' : splitCard}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setSplitCard('');
                      else {
                        const num = parseFloat(val);
                        setSplitCard(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#2F2A25] mb-1">Transferencia:</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={splitTransfer === '' ? '' : splitTransfer}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setSplitTransfer('');
                      else {
                        const num = parseFloat(val);
                        setSplitTransfer(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#2F2A25] mb-1">Crédito (Deuda):</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={splitCredit === '' ? '' : splitCredit}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setSplitCredit('');
                      else {
                        const num = parseFloat(val);
                        setSplitCredit(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-xs font-bold"
                  />
                </div>
              </div>

              <div
                className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                  Math.abs(splitDifference) < 0.01
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <span>Total Asignado: {formatCurrency(splitTotal, settings.simboloMoneda)}</span>
                <span>
                  {Math.abs(splitDifference) < 0.01
                    ? '✓ Cuadrado Exacto'
                    : `Faltan / Sobran: ${formatCurrency(splitDifference, settings.simboloMoneda)}`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[#E4DDD2] bg-[#F6F1E8] flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 px-4 rounded-2xl text-xs font-medium text-[#756E65] bg-white border border-[#E4DDD2] hover:bg-zinc-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleProcessSale}
            className="flex-2 py-3 px-6 rounded-2xl text-xs font-bold text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] disabled:bg-zinc-300 disabled:cursor-not-allowed transition shadow-md flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{loading ? 'Procesando Venta...' : 'Completar Venta & Emitir Factura'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
