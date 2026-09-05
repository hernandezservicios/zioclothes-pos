import React, { useState } from 'react';
import { CashSession, CashMovement } from '../../types';
import { storageService } from '../../services/storageService';
import { cashApi } from '../../services/cashApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { printThermalElement, exportToCSV } from '../../utils/exportUtils';
import { sounds } from '../../utils/soundEffects';
import {
  Wallet,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  Unlock,
  Printer,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  History,
} from 'lucide-react';

export const CashView: React.FC = () => {
  const { currentUser, settings, hasPermission, activeCashSession, refreshActiveCashSession } = useAuth();
  const { showToast } = useToast();

  // FASE 3.6 (Parte 4): la sesión activa real vive en AuthContext
  // (respaldada por cash.getActiveSession contra el backend real), no en
  // storageService local. El historial de cierres pasados sigue siendo
  // local por ahora (fuera de alcance de esta corrección).
  const activeSession = activeCashSession || null;
  const [pastSessions, setPastSessions] = useState<CashSession[]>(() =>
    (storageService.getCashSessions() || []).filter((s) => s.estado === 'CERRADA')
  );

  // Modals
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [receiptSession, setReceiptSession] = useState<CashSession | null>(null);

  // Open Form State
  const [montoInicial, setMontoInicial] = useState<number | string>(0);

  // Close Form State
  const [montoCierreReal, setMontoCierreReal] = useState<number | string>(0);
  const [notasCierre, setNotasCierre] = useState<string>('');

  // Cash Movement Form State (Ingreso / Retiro)
  const [movementType, setMovementType] = useState<'ENTRADA' | 'SALIDA'>('SALIDA');
  const [movementAmount, setMovementAmount] = useState<number | string>(0);
  const [movementReason, setMovementReason] = useState('');

  const [loading, setLoading] = useState(false);

  // Open Cash Register — FASE 3.6: contra el backend real (cash.open)
  const handleOpenCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const initialAmount = typeof montoInicial === 'number' ? montoInicial : parseFloat(montoInicial);
    if (!Number.isFinite(initialAmount) || initialAmount < 0) {
      sounds.playError();
      showToast('Monto Inválido', 'El fondo inicial debe ser un número válido mayor o igual a RD$ 0.00.', 'error');
      return;
    }

    setLoading(true);
    const res = await cashApi.openSession({
      montoInicial: initialAmount,
      cajaNombre: 'Caja Principal Boutique',
    });
    setLoading(false);

    if (res.success && res.data) {
      sounds.playSuccess();
      showToast('Caja Abierta', res.message, 'exito');
      await refreshActiveCashSession();
      setOpenModalOpen(false);
    } else {
      sounds.playError();
      showToast('Error', res.message, 'error');
    }
  };

  // Close Cash Register — FASE 3.6: contra el backend real (cash.close)
  const handleCloseCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !currentUser) return;

    const closeAmount = typeof montoCierreReal === 'number' ? montoCierreReal : parseFloat(montoCierreReal);
    if (!Number.isFinite(closeAmount) || closeAmount < 0) {
      sounds.playError();
      showToast('Monto Inválido', 'El efectivo físico debe ser un número válido mayor o igual a RD$ 0.00.', 'error');
      return;
    }

    setLoading(true);
    const res = await cashApi.closeSession({
      efectivoRealContado: closeAmount,
      observacionCierre: notasCierre.trim() || undefined,
    });
    setLoading(false);

    if (res.success && res.data) {
      sounds.playSuccess();
      showToast('Caja Cerrada', res.message, 'exito');
      // El ticket de cierre usa el último estado conocido de la sesión
      // (activeSession) combinado con los totales finales del cierre real.
      if (activeSession) {
        setReceiptSession({
          ...activeSession,
          estado: 'CERRADA',
          efectivoEsperado: res.data.efectivoEsperado,
          efectivoRealContado: res.data.efectivoRealContado,
          montoCierreReal: res.data.efectivoRealContado,
          diferencia: res.data.diferencia,
          fechaCierre: new Date().toISOString().replace('T', ' ').substring(0, 19),
          observacionCierre: notasCierre.trim(),
        });
        setPastSessions((prev) => [
          { ...activeSession, estado: 'CERRADA', efectivoRealContado: res.data!.efectivoRealContado, diferencia: res.data!.diferencia },
          ...prev,
        ]);
      }
      setCloseModalOpen(false);
      await refreshActiveCashSession();
    } else {
      sounds.playError();
      showToast('Error', res.message, 'error');
    }
  };

  // Register Cash Movement (Ingreso o Retiro) — FASE 3.6: contra el
  // backend real (cash.addMovement)
  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !currentUser) return;

    const moveAmount = typeof movementAmount === 'number' ? movementAmount : parseFloat(movementAmount);
    if (!Number.isFinite(moveAmount) || moveAmount <= 0) {
      sounds.playError();
      showToast('Monto Inválido', 'El monto debe ser mayor que RD$ 0.00.', 'error');
      return;
    }
    if (!movementReason.trim()) {
      sounds.playError();
      showToast('Concepto Requerido', 'Debe especificar el concepto o motivo del movimiento.', 'error');
      return;
    }

    setLoading(true);
    const res = await cashApi.addMovement({
      tipo: movementType === 'ENTRADA' ? 'INGRESO' : 'RETIRO',
      monto: moveAmount,
      motivo: movementReason.trim(),
    });
    setLoading(false);

    if (res.success) {
      showToast('Movimiento Registrado', res.message, 'exito');
      setMovementModalOpen(false);
      await refreshActiveCashSession();
    } else {
      showToast('Error', res.message, 'error');
    }
  };

  return (
    <div id="cash-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Arqueo, Cuadre & Movimientos
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Control de Caja Registradora
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          {activeSession ? (
            <>
              {hasPermission('caja.movimientos') && (
                <button
                  type="button"
                  onClick={() => {
                    setMovementAmount(0);
                    setMovementReason('');
                    setMovementType('SALIDA');
                    setMovementModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
                >
                  <Coins className="w-4 h-4 text-[#756E65]" />
                  <span>Ingreso / Retiro</span>
                </button>
              )}
              {hasPermission('caja.cerrar') && (
                <button
                  type="button"
                  onClick={() => {
                    setMontoCierreReal(0);
                    setNotasCierre('');
                    setCloseModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold transition shadow-xs"
                >
                  <Lock className="w-4 h-4" />
                  <span>Cerrar Turno & Cuadre</span>
                </button>
              )}
            </>
          ) : (
            hasPermission('caja.abrir') && (
              <button
                type="button"
                onClick={() => {
                  setMontoInicial(0);
                  setOpenModalOpen(true);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] hover:bg-[#403932] text-white text-xs font-bold transition shadow-xs"
              >
                <Unlock className="w-4 h-4 text-[#E8DCC8]" />
                <span>Abrir Turno de Caja</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* ACTIVE CASH SESSION DASHBOARD */}
      {activeSession ? (
        <div className="space-y-6">
          {/* Active Banner */}
          <div className="p-5 bg-gradient-to-br from-[#2F2A25] to-[#4A433B] text-[#FAF8F4] rounded-3xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[11px] uppercase tracking-widest text-[#E8DCC8] font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Turno de Caja Abierto • {activeSession.cajaNombre}
              </span>
              <h2 className="text-3xl font-serif font-bold text-white mt-1">
                {formatCurrency(activeSession.efectivoEsperado, settings.simboloMoneda)}
              </h2>
              <p className="text-xs text-[#E8DCC8]/80 mt-1">
                Abierta por {activeSession.usuarioAperturaNombre} el {formatDateTime(activeSession.fechaApertura)}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMontoCierreReal(0);
                  setNotasCierre('');
                  setCloseModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-white text-[#2F2A25] font-bold text-xs hover:bg-[#F6F1E8] transition shadow-2xs"
              >
                Realizar Cuadre (Cierre)
              </button>
            </div>
          </div>

          {/* Cash breakdown metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2]">
              <span className="text-[10px] font-bold text-[#756E65] uppercase">Fondo Inicial</span>
              <p className="text-sm font-bold text-[#2F2A25] mt-1">
                {formatCurrency(activeSession.montoInicial, settings.simboloMoneda)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2]">
              <span className="text-[10px] font-bold text-emerald-800 uppercase">Ventas Efectivo</span>
              <p className="text-sm font-bold text-emerald-700 mt-1">
                +{formatCurrency(activeSession.ventasEfectivo, settings.simboloMoneda)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2]">
              <span className="text-[10px] font-bold text-emerald-800 uppercase">Abonos Efectivo</span>
              <p className="text-sm font-bold text-emerald-700 mt-1">
                +{formatCurrency(activeSession.abonosEfectivo, settings.simboloMoneda)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2]">
              <span className="text-[10px] font-bold text-blue-800 uppercase">Entradas Manuales</span>
              <p className="text-sm font-bold text-blue-700 mt-1">
                +{formatCurrency(activeSession.entradasEfectivo, settings.simboloMoneda)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2]">
              <span className="text-[10px] font-bold text-rose-800 uppercase">Salidas / Gastos</span>
              <p className="text-sm font-bold text-rose-700 mt-1">
                -{formatCurrency(activeSession.salidasEfectivo, settings.simboloMoneda)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2]">
              <span className="text-[10px] font-bold text-purple-800 uppercase">Devoluciones</span>
              <p className="text-sm font-bold text-purple-700 mt-1">
                -{formatCurrency(activeSession.devolucionesEfectivo, settings.simboloMoneda)}
              </p>
            </div>
          </div>

          {/* Electronic non-cash totals in shift */}
          <div className="p-4 bg-[#F6F1E8] rounded-2xl border border-[#E4DDD2] flex flex-wrap items-center justify-between gap-4 text-xs">
            <span className="font-bold text-[#2F2A25] uppercase text-[11px]">Cobros Electrónicos en Turno:</span>
            <div className="flex gap-4">
              <span>
                Tarjeta: <strong className="text-[#2F2A25]">{formatCurrency(activeSession.ventasTarjeta, settings.simboloMoneda)}</strong>
              </span>
              <span>
                Transferencia: <strong className="text-[#2F2A25]">{formatCurrency(activeSession.ventasTransferencia, settings.simboloMoneda)}</strong>
              </span>
              <span>
                Créditos Emitidos: <strong className="text-[#2F2A25]">{formatCurrency(activeSession.ventasCredito, settings.simboloMoneda)}</strong>
              </span>
            </div>
          </div>

          {/* Cash Movements in this Shift */}
          <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
            <div className="p-4 bg-[#F6F1E8] border-b border-[#E4DDD2] font-bold text-xs text-[#2F2A25] flex justify-between items-center">
              <span>Movimientos Manuales Registrados en este Turno</span>
              <button
                type="button"
                onClick={() => setMovementModalOpen(true)}
                className="text-[11px] text-[#C2410C] hover:underline font-bold"
              >
                + Registrar Ingreso / Gasto
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#FAF8F4] text-[#756E65] uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Hora</th>
                    <th className="py-2.5 px-4">Tipo</th>
                    <th className="py-2.5 px-4">Motivo / Concepto</th>
                    <th className="py-2.5 px-4 text-right">Monto</th>
                    <th className="py-2.5 px-4">Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4DDD2]/60">
                  {(activeSession.movimientos || []).map((m) => (
                    <tr key={m.id}>
                      <td className="py-3 px-4 text-[#756E65]">{formatDateTime(m.fecha)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            m.tipo === 'ENTRADA'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-rose-50 text-rose-800 border-rose-200'
                          }`}
                        >
                          {m.tipo}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-[#2F2A25]">{m.motivo}</td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={m.tipo === 'ENTRADA' ? 'text-emerald-700' : 'text-rose-700'}>
                          {m.tipo === 'ENTRADA' ? '+' : '-'}
                          {formatCurrency(m.monto, settings.simboloMoneda)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#756E65]">{m.usuarioNombre}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {(activeSession.movimientos || []).length === 0 && (
                <div className="text-center py-6 text-xs text-[#756E65]">
                  No hay ingresos o gastos manuales registrados en este turno.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* NO ACTIVE SESSION */
        <div className="bg-white p-12 rounded-3xl border border-[#E4DDD2] text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-3xl bg-[#F6F1E8] border border-[#E4DDD2] flex items-center justify-center mx-auto text-[#756E65]">
            <Lock className="w-8 h-8 opacity-60" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#2F2A25]">La Caja se Encuentra Cerrada</h3>
            <p className="text-xs text-[#756E65] max-w-md mx-auto mt-1">
              Debe abrir un turno con el fondo de caja inicial para comenzar a cobrar ventas en efectivo y registrar movimientos.
            </p>
          </div>
          {hasPermission('caja.abrir') && (
            <button
              type="button"
              onClick={() => setOpenModalOpen(true)}
              className="px-6 py-2.5 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md inline-flex items-center gap-2"
            >
              <Unlock className="w-4 h-4 text-[#E8DCC8]" />
              <span>Abrir Turno de Caja</span>
            </button>
          )}
        </div>
      )}

      {/* PAST CLOSED SESSIONS HISTORY */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs space-y-4 p-5">
        <div className="flex items-center justify-between border-b border-[#E4DDD2] pb-3">
          <div className="flex items-center gap-2 font-bold text-xs text-[#2F2A25]">
            <History className="w-4 h-4 text-[#756E65]" />
            <span>Historial de Cuadres y Cierres Anteriores</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#FAF8F4] text-[#756E65] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-4">Fecha Apertura</th>
                <th className="py-2.5 px-4">Fecha Cierre</th>
                <th className="py-2.5 px-4">Cajero</th>
                <th className="py-2.5 px-4 text-right">Fondo Inicial</th>
                <th className="py-2.5 px-4 text-right">Esperado</th>
                <th className="py-2.5 px-4 text-right">Cierre Real</th>
                <th className="py-2.5 px-4 text-center">Diferencia</th>
                <th className="py-2.5 px-4 text-center">Ticket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(pastSessions || []).map((session) => {
                const diff = session.diferencia || 0;
                return (
                  <tr key={session.id} className="hover:bg-[#FAF8F4]">
                    <td className="py-3 px-4 text-[#756E65]">{formatDateTime(session.fechaApertura)}</td>
                    <td className="py-3 px-4 text-[#756E65]">
                      {session.fechaCierre ? formatDateTime(session.fechaCierre) : 'N/A'}
                    </td>
                    <td className="py-3 px-4 font-medium text-[#2F2A25]">{session.usuarioAperturaNombre}</td>
                    <td className="py-3 px-4 text-right">
                      {formatCurrency(session.montoInicial, settings.simboloMoneda)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">
                      {formatCurrency(session.efectivoEsperado, settings.simboloMoneda)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-[#2F2A25]">
                      {formatCurrency(session.montoCierreReal || 0, settings.simboloMoneda)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          Math.abs(diff) < 0.01
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : diff > 0
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}
                      >
                        {Math.abs(diff) < 0.01
                          ? 'Cuadre Exacto'
                          : `${diff > 0 ? 'Sobrante' : 'Faltante'} ${formatCurrency(diff, settings.simboloMoneda)}`}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => setReceiptSession(session)}
                        className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8]"
                        title="Ver Ticket de Cierre"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* OPEN CASH MODAL */}
      {openModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Apertura de Caja Registradora</h3>
              <button type="button" onClick={() => setOpenModalOpen(false)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenCash} noValidate className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">
                  Fondo Inicial de Caja (RD$):
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={montoInicial === '' ? '' : montoInicial}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setMontoInicial('');
                    else {
                      const num = parseFloat(val);
                      setMontoInicial(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-base text-[#2F2A25]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpenModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md hover:bg-[#403932]"
                >
                  {loading ? 'Abriendo...' : 'Confirmar Apertura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLOSE CASH / CUADRE MODAL */}
      {closeModalOpen && activeSession && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Cierre y Cuadre de Caja (Arqueo)</h3>
              <button type="button" onClick={() => setCloseModalOpen(false)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCloseCash} noValidate className="space-y-4 text-xs">
              <div className="p-3 bg-white rounded-2xl border border-[#E4DDD2] space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#756E65]">Efectivo Sistema Esperado:</span>
                  <span className="font-bold text-[#2F2A25]">
                    {formatCurrency(activeSession.efectivoEsperado, settings.simboloMoneda)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1 uppercase text-[11px]">
                  Efectivo Físico Contado en Gaveta (RD$):
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
                    value={montoCierreReal === '' ? '' : montoCierreReal}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setMontoCierreReal('');
                      else {
                        const num = parseFloat(val);
                        setMontoCierreReal(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full pl-12 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-base text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:ring-1 focus:ring-[#2F2A25]"
                  />
                </div>
                <p className="text-[10px] text-[#756E65] mt-1">
                  Introduzca manualmente el total de billetes y monedas contados físicamente en la gaveta.
                </p>
              </div>

              {/* Difference Preview */}
              {(() => {
                const numericCierre = typeof montoCierreReal === 'number' ? montoCierreReal : parseFloat(montoCierreReal) || 0;
                const diff = numericCierre - activeSession.efectivoEsperado;
                return (
                  <div
                    className={`p-3 rounded-2xl border flex items-center justify-between font-bold ${
                      Math.abs(diff) < 0.01
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : diff > 0
                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <span className="text-[11px]">Diferencia de Cuadre:</span>
                    <span className="text-xs">
                      {Math.abs(diff) < 0.01
                        ? '✓ Cuadre Exacto (Sin diferencias)'
                        : `${diff > 0 ? 'Sobrante (+)' : 'Faltante (-)'}: ${formatCurrency(diff, settings.simboloMoneda)}`}
                    </span>
                  </div>
                );
              })()}

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Notas / Justificación de Cierre:</label>
                <input
                  type="text"
                  placeholder="Ej. Cuadre verificado por supervisor"
                  value={notasCierre}
                  onChange={(e) => setNotasCierre(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCloseModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 font-bold text-white shadow-md"
                >
                  {loading ? 'Cerrando...' : 'Confirmar Cierre & Imprimir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CASH MOVEMENT MODAL */}
      {movementModalOpen && activeSession && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Movimiento de Efectivo</h3>
              <button type="button" onClick={() => setMovementModalOpen(false)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddMovement} noValidate className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Tipo de Movimiento:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMovementType('SALIDA')}
                    className={`py-2 rounded-xl font-bold border transition ${
                      movementType === 'SALIDA'
                        ? 'bg-rose-700 text-white border-rose-700'
                        : 'bg-white text-[#756E65] border-[#E4DDD2]'
                    }`}
                  >
                    Salida / Gasto (-)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMovementType('ENTRADA')}
                    className={`py-2 rounded-xl font-bold border transition ${
                      movementType === 'ENTRADA'
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-[#756E65] border-[#E4DDD2]'
                    }`}
                  >
                    Ingreso Extra (+)
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Monto (RD$):</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={movementAmount === '' ? '' : movementAmount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setMovementAmount('');
                    else {
                      const num = parseFloat(val);
                      setMovementAmount(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-base"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Concepto / Motivo:</label>
                <input
                  type="text"
                  required
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  placeholder="Ej. Pago de flete / Compra de bolsas / Aporte de cambio"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMovementModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md hover:bg-[#403932]"
                >
                  {loading ? 'Guardando...' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* THERMAL SHIFT CLOSURE VOUCHER MODAL */}
      {receiptSession && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="no-print flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Ticket de Cierre de Caja (Corte Z)</h3>
              <button type="button" onClick={() => setReceiptSession(null)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div
              id="thermal-shift-closure-voucher"
              className="p-4 bg-white border-2 border-black rounded-2xl text-xs text-black space-y-2 select-text font-semibold"
              style={{
                fontFamily: 'Arial, Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                maxWidth: '80mm',
                margin: '0 auto',
                color: '#000000',
              }}
            >
              <div className="text-center pb-2 border-b-2 border-dashed border-black">
                <p className="font-extrabold text-lg tracking-wider text-black">{settings.nombreNegocio || 'ZIO CLOTHES'}</p>
                <p className="text-xs font-extrabold uppercase text-black">Corte de Caja (Corte Z) - {receiptSession.cajaNombre}</p>
                {settings.rnc && <p className="text-[11px] font-bold text-black">RNC: {settings.rnc}</p>}
              </div>

              <div className="space-y-1.5 text-xs py-2 border-b-2 border-dashed border-black leading-relaxed">
                <div className="flex justify-between">
                  <span className="font-bold text-black">Apertura:</span>
                  <span className="font-bold text-black">{formatDateTime(receiptSession.fechaApertura)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">Cierre:</span>
                  <span className="font-bold text-black">{receiptSession.fechaCierre ? formatDateTime(receiptSession.fechaCierre) : 'En curso'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">Cajero/a:</span>
                  <span className="font-extrabold text-black">{receiptSession.usuarioAperturaNombre}</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs py-2 border-b-2 border-dashed border-black leading-relaxed">
                <div className="flex justify-between">
                  <span className="font-bold text-black">Fondo Inicial:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.montoInicial, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">(+) Ventas Efectivo:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.ventasEfectivo, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">(+) Abonos Efectivo:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.abonosEfectivo, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">(+) Entradas Manuales:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.entradasEfectivo, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">(-) Salidas / Gastos:</span>
                  <span className="font-bold text-black">-{formatCurrency(receiptSession.salidasEfectivo, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold text-black">(-) Devoluciones:</span>
                  <span className="font-bold text-black">-{formatCurrency(receiptSession.devolucionesEfectivo, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-extrabold pt-2 border-t-2 border-black text-black text-sm">
                  <span>EFECTIVO ESPERADO:</span>
                  <span>{formatCurrency(receiptSession.efectivoEsperado, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-black text-sm">
                  <span>EFECTIVO REAL:</span>
                  <span>{formatCurrency(receiptSession.montoCierreReal || 0, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-black text-sm">
                  <span>DIFERENCIA:</span>
                  <span className="font-extrabold text-black">
                    {formatCurrency(receiptSession.diferencia || 0, settings.simboloMoneda)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs py-2 border-b-2 border-dashed border-black leading-relaxed">
                <p className="font-extrabold text-black uppercase">Ventas No Efectivo:</p>
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-black">Tarjeta:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.ventasTarjeta, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-black">Transferencia:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.ventasTransferencia, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="font-bold text-black">A Crédito:</span>
                  <span className="font-bold text-black">{formatCurrency(receiptSession.ventasCredito, settings.simboloMoneda)}</span>
                </div>
              </div>

              <div className="text-center pt-2 text-[11px] text-black space-y-0.5">
                <p className="font-extrabold text-black">Auditoría del Sistema ZIO CLOTHES</p>
                <p className="font-bold text-black">Comprobante de Turno Oficial</p>
              </div>
            </div>

            <div className="no-print flex gap-2">
              <button
                type="button"
                onClick={() => setReceiptSession(null)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => printThermalElement('thermal-shift-closure-voucher')}
                className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-[#E8DCC8]" />
                <span>Imprimir Comprobante</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
