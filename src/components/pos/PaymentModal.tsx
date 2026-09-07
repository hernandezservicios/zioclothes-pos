import React, { useState } from 'react';
import { Customer, CreditNote, PaymentMethodType, Sale, SaleItem, SalePaymentSplit } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { storageService } from '../../services/storageService';
import { salesApi } from '../../services/salesApi';
import { creditsApi } from '../../services/creditsApi';
import { creditNotesApi } from '../../services/creditNotesApi';
import { formatCurrency, computeCashSettlement, computeMixedPaymentTotals } from '../../utils/formatters';
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
  Gift,
} from 'lucide-react';

interface PaymentModalProps {
  items: SaleItem[];
  subtotal: number;
  descuentoTotal: number;
  impuestoTotal: number;
  total: number;
  applyTax: boolean;
  // FASE 3.6C: null es un estado válido -- "sin cliente seleccionado" /
  // Consumidor Final. No se asume que siempre exista un cliente real
  // (Sheets puede estar vacío de clientes).
  selectedCustomer: Customer | null;
  onClose: () => void;
  onSuccess: (sale: Sale) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  items,
  subtotal,
  descuentoTotal,
  impuestoTotal,
  total,
  applyTax,
  selectedCustomer,
  onClose,
  onSuccess,
}) => {
  const { currentUser, settings, activeCashSession } = useAuth();
  const { showToast } = useToast();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('EFECTIVO');
  // FIX P0 (inputs de montos sin 0 precargado): inician en '' -- no en 0 --
  // para que el cajero escriba el monto directamente sin borrar un cero
  // primero. El tipo (number | string) no cambia: los onChange de estos
  // campos ya soportaban '' desde antes (ver más abajo), solo el valor
  // inicial/de reseteo estaba en 0.
  const [efectivoRecibido, setEfectivoRecibido] = useState<number | string>('');
  const [referenciaTarjeta, setReferenciaTarjeta] = useState<string>('');
  const [referenciaTransferencia, setReferenciaTransferencia] = useState<string>('');
  const [diasPlazo, setDiasPlazo] = useState<number>(selectedCustomer?.diasCreditoPorDefecto || 30);
  const [observacionesCredito, setObservacionesCredito] = useState<string>('');

  // Mixed payment states (all start empty, not at 0 -- ver comentario arriba)
  const [splitCash, setSplitCash] = useState<number | string>('');
  const [splitCard, setSplitCard] = useState<number | string>('');
  const [splitTransfer, setSplitTransfer] = useState<number | string>('');
  const [splitCredit, setSplitCredit] = useState<number | string>('');

  const [loading, setLoading] = useState(false);

  // FASE 7 (integración operativa de Créditos a Favor / Notas de Crédito
  // en el POS -- Parte 5): créditos a favor/notas de crédito REALES y
  // DISPONIBLES (no anulados, saldo > 0) del cliente seleccionado. Nunca
  // se consultan ni se muestran para "Consumidor Final" (Parte 14) -- si
  // el cliente cambia, se descarta cualquier selección previa de
  // inmediato para no arrastrar el crédito de un cliente distinto.
  const [availableCreditNotes, setAvailableCreditNotes] = useState<CreditNote[]>([]);
  const [loadingCreditNotes, setLoadingCreditNotes] = useState(false);
  // FASE 8 (Parte 8 -- hardening de errores): si la consulta falla, se
  // distingue "sin crédito disponible" de "no se pudo verificar" (mismo
  // criterio ya usado abajo para `hasOverdue`/`overdueChecked`) -- nunca
  // se asume silenciosamente que el cliente no tiene saldo a favor cuando
  // en realidad la consulta al backend falló.
  const [creditNotesLoadFailed, setCreditNotesLoadFailed] = useState(false);
  const [selectedCreditNoteId, setSelectedCreditNoteId] = useState<string>('');
  const [creditoFavorMontoInput, setCreditoFavorMontoInput] = useState<number | string>('');

  const fetchAvailableCreditNotes = React.useCallback((clienteId: string, onCancelledRef: { current: boolean }) => {
    setLoadingCreditNotes(true);
    setCreditNotesLoadFailed(false);
    creditNotesApi.list({ clienteId }).then((res) => {
      if (onCancelledRef.current) return;
      if (res.success) {
        const usable = (res.data || []).filter((c) => c && c.estado !== 'ANULADA' && c.saldoDisponible > 0);
        setAvailableCreditNotes(usable);
      } else {
        // Si falla la consulta, se deja la lista vacía (no se inventa
        // saldo disponible) -- pero se avisa que no se pudo verificar, en
        // vez de dar a entender que el cliente simplemente no tiene nada.
        setCreditNotesLoadFailed(true);
      }
      setLoadingCreditNotes(false);
    });
  }, []);

  React.useEffect(() => {
    const cancelledRef = { current: false };
    setAvailableCreditNotes([]);
    setSelectedCreditNoteId('');
    setCreditoFavorMontoInput('');
    setCreditNotesLoadFailed(false);
    if (!selectedCustomer) return; // Consumidor Final nunca ve/usa saldos a favor.

    fetchAvailableCreditNotes(selectedCustomer.id, cancelledRef);

    return () => {
      cancelledRef.current = true;
    };
  }, [selectedCustomer?.id, fetchAvailableCreditNotes]);

  const selectedCreditNote = availableCreditNotes.find((c) => c.id === selectedCreditNoteId) || null;
  const numCreditoFavorMontoInput =
    typeof creditoFavorMontoInput === 'number' ? creditoFavorMontoInput : parseFloat(creditoFavorMontoInput) || 0;
  // Nunca se puede aplicar más del saldo disponible del documento NI más
  // del total de la venta (Parte 13: "no aplicar automáticamente el
  // exceso" -- el sobrante del crédito simplemente permanece disponible).
  const maxCreditoFavorAplicable = selectedCreditNote ? Math.min(selectedCreditNote.saldoDisponible, total) : 0;
  const creditoFavorMontoAplicado = selectedCreditNote
    ? Math.max(0, Math.min(numCreditoFavorMontoInput, maxCreditoFavorAplicable))
    : 0;
  // Monto que sigue necesitando un método de pago tradicional (Efectivo/
  // Tarjeta/Transferencia/A Cuenta/Mixto) después de restar el crédito a
  // favor aplicado -- NUNCA el `total` original se envía como lo que hay
  // que cobrar por esos medios cuando ya hay crédito aplicado.
  const totalRestante = Math.max(0, total - creditoFavorMontoAplicado);
  const cubiertoCompletoConCredito = creditoFavorMontoAplicado > 0 && totalRestante < 0.01;

  const handleSelectCreditNote = (id: string) => {
    setSelectedCreditNoteId(id);
    const cn = availableCreditNotes.find((c) => c.id === id);
    // Por defecto se propone aplicar el máximo posible (saldo del
    // documento, acotado al total de la venta) -- el cajero puede editarlo
    // libremente para una aplicación parcial (Parte 8).
    setCreditoFavorMontoInput(cn ? String(Math.min(cn.saldoDisponible, total)) : '');
  };

  const handleClearCreditNote = () => {
    setSelectedCreditNoteId('');
    setCreditoFavorMontoInput('');
  };

  // FASE 8 (Parte 4, hardening -- "crédito seleccionado y luego se cambia
  // el total mediante un descuento"): si el total de la venta baja
  // DESPUÉS de haber escrito un monto de crédito (ej. el cajero aplica un
  // descuento adicional al carrito con el modal ya abierto), el monto que
  // el cajero VE en el campo debe bajar con él -- de lo contrario, el
  // recuadro seguiría mostrando un número que en realidad ya está
  // recortado silenciosamente por `creditoFavorMontoAplicado` (correcto
  // para lo que se envía, pero engañoso para lo que se muestra). Se
  // recorta solo hacia abajo, nunca se "adivina" un valor mayor.
  React.useEffect(() => {
    if (!selectedCreditNoteId) return;
    if (numCreditoFavorMontoInput > maxCreditoFavorAplicable) {
      setCreditoFavorMontoInput(maxCreditoFavorAplicable > 0 ? String(maxCreditoFavorAplicable) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxCreditoFavorAplicable, selectedCreditNoteId]);

  React.useEffect(() => {
    setEfectivoRecibido('');
    setReferenciaTarjeta('');
    setReferenciaTransferencia('');
    setObservacionesCredito('');
    setSplitCash('');
    setSplitCard('');
    setSplitTransfer('');
    setSplitCredit('');
  }, [selectedCustomer?.id, total, creditoFavorMontoAplicado]);

  // FASE 3.6D (Parte 6) / FASE 3.7B (Sección 11): la deuda actual y el
  // crédito disponible vienen calculados por el backend real
  // (customers.list / bootstrap -> CustomersController.handleListCustomers,
  // campos `saldoPendiente`/`creditoDisponible`, autoritativos porque se
  // derivan de `Creditos` real en Sheets). El tipo `Customer` base ahora
  // declara estos dos campos como opcionales (ver types/index.ts) -- ya no
  // hace falta un cast manual como en FASE 3.6D. Si por algún motivo
  // faltaran, se asume 0 disponible -- nunca crédito ilimitado por dato
  // faltante.
  const currentDebt = selectedCustomer?.saldoPendiente != null ? Number(selectedCustomer.saldoPendiente) || 0 : 0;
  const availableCredit =
    selectedCustomer?.creditoDisponible != null ? Number(selectedCustomer.creditoDisponible) || 0 : 0;

  // FASE 3.7B (Sección 10): el aviso de "facturas vencidas" ahora SÍ puede
  // conectarse al backend real, porque credits.list ya existe (creditsApi).
  // Se consulta solo cuando el cajero realmente elige pagar a crédito con
  // un cliente seleccionado (no en cada apertura del modal, para no cargar
  // toda la cartera de créditos en cada venta). Mientras carga o si falla,
  // NO se asume "sin vencidas" -- simplemente no se muestra el aviso
  // (opción B de la Sección 10) hasta tener una respuesta real.
  const [hasOverdue, setHasOverdue] = useState(false);
  const [overdueChecked, setOverdueChecked] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setHasOverdue(false);
    setOverdueChecked(false);
    if (paymentMethod !== 'CREDITO' || !selectedCustomer) return;

    creditsApi.list().then((res) => {
      if (cancelled) return;
      if (res.success) {
        const overdue = (res.data || []).some(
          (c) => c.clienteId === selectedCustomer.id && c.estado === 'VENCIDA'
        );
        setHasOverdue(overdue);
      }
      // Si falla, se deja hasOverdue en false (sin aviso) en vez de
      // fabricar un estado -- se documenta como "no disponible" en vez de
      // "sin vencidas" mostrando overdueChecked=false más abajo.
      setOverdueChecked(res.success);
    });

    return () => {
      cancelled = true;
    };
  }, [paymentMethod, selectedCustomer]);

  // Change Calculation for Cash -- FASE 7: sobre `totalRestante` (lo que
  // falta después de restar cualquier Crédito a Favor/Nota de Crédito ya
  // aplicado), no sobre el `total` original de la venta.
  //
  // FIX (regresión "Cambio a Devolver" mostraba RD$0.00 con pago
  // insuficiente): computeCashSettlement() es ahora la única fuente de
  // verdad del estado del efectivo -- deriva tanto el cambio a devolver
  // como el faltante por cobrar de una sola resta, con redondeo seguro a
  // centavos. La validación del botón "Completar Venta" (más abajo) y el
  // recuadro que lo muestra en pantalla consumen este mismo resultado.
  const numEfectivoRecibido = typeof efectivoRecibido === 'number' ? efectivoRecibido : parseFloat(efectivoRecibido) || 0;
  const { change: cambio, due: faltanteEfectivo } = computeCashSettlement(numEfectivoRecibido, totalRestante);

  // Split sum validation -- también sobre `totalRestante` (el grid Mixto
  // reparte lo que falta por cobrar con medios tradicionales; el crédito a
  // favor se administra en su propia sección, no aquí).
  const numSplitCash = typeof splitCash === 'number' ? splitCash : parseFloat(splitCash) || 0;
  const numSplitCard = typeof splitCard === 'number' ? splitCard : parseFloat(splitCard) || 0;
  const numSplitTransfer = typeof splitTransfer === 'number' ? splitTransfer : parseFloat(splitTransfer) || 0;
  const numSplitCredit = typeof splitCredit === 'number' ? splitCredit : parseFloat(splitCredit) || 0;

  const { assigned: splitTotal, remaining: splitDifference } = computeMixedPaymentTotals(totalRestante, {
    cash: numSplitCash,
    card: numSplitCard,
    transfer: numSplitTransfer,
    credit: numSplitCredit,
  });

  const handleProcessSale = async () => {
    if (!currentUser) return;
    setLoading(true);

    try {
      let finalPayments: SalePaymentSplit[] = [];
      let esCredito = false;
      let montoFinanciado = 0;
      // FASE 7: `metodoPago` real de la venta -- distinto de `paymentMethod`
      // (que solo controla la pestaña activa para EL RESTANTE, no el total
      // completo, cuando ya se aplicó un Crédito a Favor/Nota de Crédito).
      let metodoPagoFinal: PaymentMethodType = paymentMethod;

      if (cubiertoCompletoConCredito) {
        // Parte 9/13: el crédito a favor cubre el total completo -- no se
        // necesita ningún otro método de pago, y nunca se genera un
        // "cambio" en efectivo por el sobrante del crédito (el sobrante,
        // si lo hay, simplemente permanece disponible en el documento).
        finalPayments = [{ metodo: 'CREDITO_FAVOR', monto: creditoFavorMontoAplicado }];
        metodoPagoFinal = 'CREDITO_FAVOR';
      } else {
        // Parte 10/11/12: lo que se cobra por el método tradicional
        // elegido es SIEMPRE `totalRestante` (total menos lo ya cubierto
        // con crédito a favor), nunca el total completo de la venta.
        if (paymentMethod === 'EFECTIVO') {
          // Misma fuente de verdad que el recuadro "Cambio a Devolver" /
          // "Falta por Cobrar" de abajo (computeCashSettlement) -- nunca
          // una segunda comparación que pueda desincronizarse de lo que el
          // cajero está viendo en pantalla.
          if (faltanteEfectivo > 0) {
            sounds.playError();
            showToast(
              'Monto Insuficiente',
              `El efectivo recibido (${formatCurrency(numEfectivoRecibido, settings.simboloMoneda)}) no puede ser menor al monto a cobrar (${formatCurrency(totalRestante, settings.simboloMoneda)}). Falta ${formatCurrency(faltanteEfectivo, settings.simboloMoneda)}.`,
              'error'
            );
            setLoading(false);
            return;
          }
          finalPayments = [{ metodo: 'EFECTIVO', monto: totalRestante }];
        } else if (paymentMethod === 'TARJETA') {
          finalPayments = [{ metodo: 'TARJETA', monto: totalRestante, referencia: referenciaTarjeta || 'TARJETA-POS' }];
        } else if (paymentMethod === 'TRANSFERENCIA') {
          finalPayments = [
            { metodo: 'TRANSFERENCIA', monto: totalRestante, referencia: referenciaTransferencia || 'TRANSFERENCIA' },
          ];
        } else if (paymentMethod === 'CREDITO') {
          if (!selectedCustomer) {
            sounds.playError();
            showToast('Cliente Requerido', 'Debe seleccionar un cliente registrado para vender a crédito. "Consumidor Final" (sin cliente) no puede tener crédito.', 'advertencia');
            setLoading(false);
            return;
          }
          if (totalRestante > availableCredit && selectedCustomer.limiteCredito > 0) {
            sounds.playError();
            showToast(
              'Límite de Crédito Excedido',
              `El monto a financiar (${formatCurrency(totalRestante, settings.simboloMoneda)}) supera el crédito disponible (${formatCurrency(Math.max(0, availableCredit), settings.simboloMoneda)})`,
              'error'
            );
            setLoading(false);
            return;
          }
          esCredito = true;
          montoFinanciado = totalRestante;
          finalPayments = [{ metodo: 'CREDITO', monto: totalRestante }];
        } else if (paymentMethod === 'MIXTO') {
          if (Math.abs(splitDifference) > 0.01) {
            sounds.playError();
            showToast(
              'Monto Mixto No Cuadra',
              `La suma de pagos (${formatCurrency(splitTotal, settings.simboloMoneda)}) debe coincidir exactamente con el monto a cobrar (${formatCurrency(totalRestante, settings.simboloMoneda)}). Diferencia: ${formatCurrency(splitDifference, settings.simboloMoneda)}`,
              'error'
            );
            setLoading(false);
            return;
          }

          if (splitCash > 0) finalPayments.push({ metodo: 'EFECTIVO', monto: splitCash });
          if (splitCard > 0) finalPayments.push({ metodo: 'TARJETA', monto: splitCard });
          if (splitTransfer > 0) finalPayments.push({ metodo: 'TRANSFERENCIA', monto: splitTransfer });
          if (splitCredit > 0) {
            if (!selectedCustomer) {
              showToast('Cliente Requerido', 'Debe seleccionar un cliente registrado para la porción a cuenta (deuda).', 'advertencia');
              setLoading(false);
              return;
            }
            if (splitCredit > availableCredit && selectedCustomer.limiteCredito > 0) {
              showToast('Límite Excedido', 'La porción a cuenta (deuda) excede el disponible del cliente.', 'error');
              setLoading(false);
              return;
            }
            esCredito = true;
            montoFinanciado = splitCredit;
            finalPayments.push({ metodo: 'CREDITO', monto: splitCredit });
          }
        }

        // Parte 10 (venta mixta obligatoria): si además se aplicó un
        // Crédito a Favor/Nota de Crédito, se agrega su línea de pago y la
        // venta pasa a ser 'MIXTO' de cara al backend/reportes, incluso si
        // el cajero solo tocó una pestaña "simple" (ej. Efectivo) para el
        // restante -- comercialmente sigue siendo un pago combinado.
        if (creditoFavorMontoAplicado > 0) {
          finalPayments = [{ metodo: 'CREDITO_FAVOR', monto: creditoFavorMontoAplicado }, ...finalPayments];
          metodoPagoFinal = 'MIXTO';
        }
      }

      // FASE 3.6: venta real contra ZIO-Google-Backend (sales.create) vía
      // salesApi -- el backend es quien valida stock/crédito, descuenta
      // existencias, genera el número de venta y actualiza caja/crédito.
      // Sin cliente seleccionado: se envía exactamente como lo espera el
      // backend para "sin cliente registrado" (ver SalesController.gs --
      // cliente_nombre por defecto 'Consumidor Final' cuando no hay
      // clienteId), en vez de asumir que siempre existe un Customer real.
      //
      // FASE 7: `total` enviado es SIEMPRE el total real y completo de la
      // venta (nunca `totalRestante`) -- el backend recalcula todo desde
      // el carrito de todas formas y es quien decide cuánto cubre
      // realmente el crédito a favor (re-validando saldo/pertenencia
      // dentro de su propio candado), así que aquí nunca se le "resta" el
      // crédito al total antes de enviarlo.
      const res = await salesApi.createSale({
        clienteId: selectedCustomer?.id,
        clienteNombre: selectedCustomer ? `${selectedCustomer.nombre} ${selectedCustomer.apellido}`.trim() : 'Consumidor Final',
        clienteDocumento: selectedCustomer?.documento,
        vendedorId: currentUser.id,
        vendedorNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        cajaSesionId: activeCashSession?.id,
        items,
        subtotal,
        descuentoTotal,
        impuestoTotal,
        total,
        metodoPago: metodoPagoFinal,
        pagos: finalPayments,
        efectivoRecibido: paymentMethod === 'EFECTIVO' && !cubiertoCompletoConCredito ? efectivoRecibido : undefined,
        cambioEntregado: paymentMethod === 'EFECTIVO' && !cubiertoCompletoConCredito ? cambio : undefined,
        esCredito,
        montoFinanciado: esCredito ? montoFinanciado : undefined,
        // FIX (regresión "el plazo del cliente siempre se imponía"): antes
        // `diasPlazo` (el estado que sí cambia con los botones 7/15/30/45/
        // 60 días) nunca se enviaba al backend -- la venta se creaba sin
        // ese campo y el backend, al no recibir nada, siempre recaía en el
        // plazo predeterminado del cliente. Ahora se envía el plazo
        // realmente seleccionado en el modal para ESTA venta.
        diasPlazo: esCredito ? diasPlazo : undefined,
        aplicarImpuesto: applyTax,
        creditoFavorAplicado:
          creditoFavorMontoAplicado > 0 && selectedCreditNote
            ? { id: selectedCreditNote.id, monto: creditoFavorMontoAplicado }
            : undefined,
      });

      if (res.success && res.data) {
        sounds.playSuccess();
        confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
        showToast('Venta Procesada', res.message, 'exito');
        if (res.data.creditoFavorAplicado) {
          const cfa = res.data.creditoFavorAplicado;
          showToast(
            'Crédito a Favor Aplicado',
            `Se aplicó ${formatCurrency(cfa.montoAplicado, settings.simboloMoneda)} de ${cfa.numero}. Saldo restante: ${formatCurrency(cfa.saldoRestante, settings.simboloMoneda)}.`,
            'informacion'
          );
        }
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
                Cliente:{' '}
                <span className="font-semibold text-[#2F2A25]">
                  {selectedCustomer ? `${selectedCustomer.nombre} ${selectedCustomer.apellido}` : 'Consumidor Final (sin cliente)'}
                </span>
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
          {/* FASE 7 (Parte 5/6/7/8 -- integración operativa de Créditos a
              Favor / Notas de Crédito en el POS): sección dedicada,
              deliberadamente con un encabezado que dice "Saldo a Favor"
              -- nunca la palabra suelta "Crédito Disponible" -- para no
              confundirse con el límite de financiamiento a cuenta que ya
              se muestra más abajo en la pestaña "A Crédito" (concepto
              opuesto: ahí el cliente le debe al negocio, aquí el negocio
              le debe al cliente). Solo se muestra con un cliente real
              seleccionado (Parte 14: nunca para "Consumidor Final") y solo
              si existe al menos un documento disponible. */}
          {selectedCustomer && (loadingCreditNotes || availableCreditNotes.length > 0 || creditNotesLoadFailed) && (
            <div className="bg-white p-4 rounded-2xl border border-[#E4DDD2] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#2F2A25] uppercase tracking-wider flex items-center gap-1.5">
                  <Gift className="w-3.5 h-3.5 text-[#C2410C]" />
                  <span>Saldo a Favor del Cliente (Vale / Nota de Crédito):</span>
                </label>
                {loadingCreditNotes && <span className="text-[10px] text-[#756E65]">Consultando...</span>}
              </div>

              {/* FASE 8 (Parte 8 -- errores): se distingue "no se pudo
                  verificar" de "no tiene nada" -- nunca se asume lo segundo
                  cuando en realidad fue lo primero. */}
              {!loadingCreditNotes && creditNotesLoadFailed && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex items-center justify-between gap-2">
                  <span>No se pudo verificar el saldo a favor de este cliente.</span>
                  <button
                    type="button"
                    onClick={() => fetchAvailableCreditNotes(selectedCustomer.id, { current: false })}
                    className="px-2 py-1 rounded-lg bg-rose-700 text-white font-bold text-[10px] shrink-0"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {!loadingCreditNotes && availableCreditNotes.length > 0 && (
                <div className="space-y-2">
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {availableCreditNotes.map((cn) => (
                      <button
                        key={cn.id}
                        type="button"
                        onClick={() => handleSelectCreditNote(cn.id)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition ${
                          selectedCreditNoteId === cn.id
                            ? 'bg-[#2F2A25] text-white border-[#2F2A25]'
                            : 'bg-[#FAF8F4] text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span>
                            {cn.numero} · {cn.tipo === 'NOTA_CREDITO' ? 'Nota de Crédito' : 'Crédito a Favor / Vale'}
                          </span>
                          <span>{formatCurrency(cn.saldoDisponible, settings.simboloMoneda)}</span>
                        </div>
                        <div className={`text-[10px] ${selectedCreditNoteId === cn.id ? 'text-[#E8DCC8]' : 'text-[#756E65]'}`}>
                          Emitido: {cn.fechaCreacion}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedCreditNote && (
                    <div className="p-3 bg-[#F6F1E8] rounded-xl border border-[#E4DDD2] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#756E65]">Aplicando: {selectedCreditNote.numero}</span>
                        <button
                          type="button"
                          onClick={handleClearCreditNote}
                          className="text-[10px] text-rose-600 font-bold hover:underline"
                        >
                          Quitar
                        </button>
                      </div>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#756E65]">
                          {settings.simboloMoneda}
                        </span>
                        <input
                          type="number"
                          min="0"
                          max={maxCreditoFavorAplicable}
                          step="any"
                          inputMode="decimal"
                          value={creditoFavorMontoInput === '' ? '' : creditoFavorMontoInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setCreditoFavorMontoInput('');
                              return;
                            }
                            const num = parseFloat(val);
                            setCreditoFavorMontoInput(isNaN(num) ? '' : val);
                          }}
                          className="w-full pl-12 pr-4 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold text-sm text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] gap-2">
                        <button
                          type="button"
                          onClick={() => setCreditoFavorMontoInput(String(maxCreditoFavorAplicable))}
                          className="text-[#2F2A25] font-bold hover:underline shrink-0"
                        >
                          Usar máximo posible ({formatCurrency(maxCreditoFavorAplicable, settings.simboloMoneda)})
                        </button>
                        <span className="text-[#756E65] text-right">
                          Saldo restante del documento: {formatCurrency(Math.max(0, selectedCreditNote.saldoDisponible - creditoFavorMontoAplicado), settings.simboloMoneda)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Resumen de lo cubierto con crédito a favor vs. lo que falta
              por cobrar con un método tradicional. */}
          {creditoFavorMontoAplicado > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1 text-xs">
              <div className="flex items-center justify-between font-bold text-emerald-900">
                <span>Cubierto con Crédito a Favor:</span>
                <span>-{formatCurrency(creditoFavorMontoAplicado, settings.simboloMoneda)}</span>
              </div>
              <div className="flex items-center justify-between font-bold text-[#2F2A25] text-sm pt-1 border-t border-emerald-200">
                <span>Resta por Pagar:</span>
                <span>{formatCurrency(totalRestante, settings.simboloMoneda)}</span>
              </div>
            </div>
          )}

          {/* Parte 9/13: si el crédito a favor cubre el total completo, no
              se necesita ningún método de pago tradicional -- se oculta la
              sección de "Forma de Pago" por completo en vez de forzar al
              cajero a elegir una pestaña irrelevante. */}
          {cubiertoCompletoConCredito ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>Venta cubierta completamente con el crédito a favor seleccionado. No se requiere ningún otro método de pago.</span>
            </div>
          ) : (
          <>
          {/* Payment Method Tabs */}
          <div>
            <label className="block text-xs font-bold text-[#2F2A25] mb-2 uppercase tracking-wider">
              Forma de Pago{creditoFavorMontoAplicado > 0 ? ' (por el restante)' : ''}:
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
                disabled={!selectedCustomer}
                onClick={() => setPaymentMethod('CREDITO')}
                title={!selectedCustomer ? 'Seleccione un cliente registrado para vender a crédito' : undefined}
                className={`p-2.5 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition ${
                  !selectedCustomer
                    ? 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'
                    : paymentMethod === 'CREDITO'
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
                  setSplitCash('');
                  setSplitCard('');
                  setSplitTransfer('');
                  setSplitCredit('');
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
                  onClick={() => setEfectivoRecibido(totalRestante)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#F6F1E8] border border-[#E4DDD2] text-[#2F2A25] hover:bg-[#E8DCC8]"
                >
                  Exacto ({formatCurrency(totalRestante, settings.simboloMoneda)})
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

              {/* Cambio / Faltante Result -- FIX: antes este recuadro
                  siempre decía "Cambio a Devolver" y mostraba RD$0.00
                  también cuando el cliente pagó de menos (Math.max(0, ...)
                  ocultaba el faltante). Ahora distingue explícitamente los
                  dos estados posibles de computeCashSettlement: si falta
                  dinero se muestra en rojo como "Falta por Cobrar", nunca
                  como un cambio de RD$0.00. */}
              {faltanteEfectivo > 0 ? (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-900 uppercase">Falta por Cobrar:</span>
                  <span className="text-xl font-bold text-rose-700">
                    {formatCurrency(faltanteEfectivo, settings.simboloMoneda)}
                  </span>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900 uppercase">Cambio a Devolver:</span>
                  <span className="text-xl font-bold text-emerald-800">
                    {formatCurrency(cambio, settings.simboloMoneda)}
                  </span>
                </div>
              )}
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
          {paymentMethod === 'CREDITO' && !selectedCustomer && (
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-xs text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Debe seleccionar un cliente registrado (arriba, en el POS) para vender a crédito.</span>
            </div>
          )}
          {paymentMethod === 'CREDITO' && selectedCustomer && (
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
                  <span className={availableCredit >= totalRestante ? 'text-emerald-700' : 'text-rose-600'}>
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
              {!hasOverdue && !overdueChecked && (
                <div className="p-2.5 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-[#756E65] text-[11px] flex items-center gap-2">
                  <span>Verificando estado de vencimientos con el backend...</span>
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
                  {/* FASE 7 (Parte 28 -- evitar confusión comercial):
                      renombrado de "Crédito (Deuda)" a "A Cuenta (Deuda)"
                      -- este campo es la cuenta por cobrar (el cliente le
                      debe al negocio), un concepto opuesto al "Saldo a
                      Favor" que ahora convive en este mismo modal. */}
                  <label className="block text-[11px] font-bold text-[#2F2A25] mb-1">A Cuenta (Deuda):</label>
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
          </>
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
