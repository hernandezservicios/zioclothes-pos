import React, { useEffect, useMemo, useState } from 'react';
import { CreditNote } from '../../types';
import { creditNotesApi } from '../../services/creditNotesApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { CreditNoteReceiptModal } from './CreditNoteReceiptModal';
import {
  Gift,
  Search,
  AlertTriangle,
  CheckCircle2,
  Eye,
  X,
  Printer,
  Ban,
  RefreshCcw,
  Wallet,
} from 'lucide-react';

type EstadoFilter = 'TODOS' | 'EMITIDA' | 'PARCIALMENTE_APLICADA' | 'APLICADA' | 'ANULADA';

interface CreditNotesViewProps {
  /**
   * FASE 6: el Sidebar tiene DOS entradas distintas ("Notas de Crédito" y
   * "Créditos a Favor / Vales") que apuntan a esta MISMA pantalla -- ambas
   * son la misma entidad de backend (Creditos_Favor) distinguida por
   * `tipo`. Cuando se pasa, el tipo queda FIJO para esta vista (no es un
   * filtro editable por el usuario): cada entrada de menú representa un
   * concepto de negocio distinto para el cajero/administrador, aunque
   * compartan la misma tabla e infraestructura por decisión arquitectónica.
   */
  tipo: 'VALE_TIENDA' | 'NOTA_CREDITO';
  initialSearchQuery?: string;
}

export const CreditNotesView: React.FC<CreditNotesViewProps> = ({ tipo, initialSearchQuery }) => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const { creditNotes, creditNotesLoading: loading, creditNotesError: loadError, creditNotesStale, refreshCreditNotes } =
    useDataStore();

  useEffect(() => {
    refreshCreditNotes();
  }, [refreshCreditNotes]);

  const esNota = tipo === 'NOTA_CREDITO';
  const tituloVista = esNota ? 'Notas de Crédito' : 'Créditos a Favor / Vales';

  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>('TODOS');

  useEffect(() => {
    if (initialSearchQuery !== undefined) setSearchQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  // Al cambiar de menú (Notas <-> Vales) se limpian los filtros locales de
  // texto/estado, para no arrastrar una búsqueda que pertenecía al otro
  // concepto.
  useEffect(() => {
    setSearchQuery(initialSearchQuery || '');
    setEstadoFilter('TODOS');
  }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [receiptCreditNote, setReceiptCreditNote] = useState<CreditNote | null>(null);

  const [voiding, setVoiding] = useState<CreditNote | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [loadingVoid, setLoadingVoid] = useState(false);

  const scopedCreditNotes = useMemo(
    () => (creditNotes || []).filter((c) => c && c.tipo === tipo),
    [creditNotes, tipo]
  );

  const selectedDetail = useMemo(
    () => scopedCreditNotes.find((c) => c.id === selectedDetailId) || null,
    [scopedCreditNotes, selectedDetailId]
  );

  const filteredCreditNotes = useMemo(() => {
    return scopedCreditNotes.filter((c) => {
      const matchesEstado = estadoFilter === 'TODOS' || c.estado === estadoFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (c.numero || '').toLowerCase().includes(q) ||
        (c.clienteNombre || '').toLowerCase().includes(q) ||
        (c.ventaOrigenId || '').toLowerCase().includes(q) ||
        (c.devolucionId || '').toLowerCase().includes(q);
      return matchesEstado && matchesSearch;
    });
  }, [scopedCreditNotes, estadoFilter, searchQuery]);

  const totalSaldoDisponible = scopedCreditNotes
    .filter((c) => c.estado !== 'ANULADA')
    .reduce((acc, c) => acc + (c.saldoDisponible || 0), 0);

  const totalEmitido = scopedCreditNotes
    .filter((c) => c.estado !== 'ANULADA')
    .reduce((acc, c) => acc + (c.montoOriginal || 0), 0);

  const activosCount = scopedCreditNotes.filter((c) => c.estado === 'EMITIDA' || c.estado === 'PARCIALMENTE_APLICADA').length;

  const canVoid = hasPermission('creditos_favor.anular');

  const handleConfirmVoid = async () => {
    if (!voiding) return;
    if (!voidReason.trim()) {
      showToast('Motivo Requerido', 'Debe ingresar el motivo de la anulación.', 'error');
      return;
    }
    setLoadingVoid(true);
    // FASE 6: creditNotes.void real (CreditNotesController.handleVoidCreditNote).
    // El backend rechaza con NO_ANULABLE si el documento ya tiene algún
    // monto aplicado -- nunca revierte ventas automáticamente. Nunca borra
    // la fila: solo cambia estado a ANULADA.
    const res = await creditNotesApi.void(voiding.id, voidReason.trim());
    setLoadingVoid(false);

    if (res.success) {
      showToast('Anulado', res.message, 'exito');
      setVoiding(null);
      setVoidReason('');
      await refreshCreditNotes({ force: true });
    } else {
      showToast('Error', res.message, 'error');
    }
  };

  const estadoBadgeClass = (estado: string) =>
    estado === 'APLICADA'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : estado === 'ANULADA'
      ? 'bg-rose-50 text-rose-800 border-rose-200'
      : estado === 'PARCIALMENTE_APLICADA'
      ? 'bg-blue-50 text-blue-800 border-blue-200'
      : 'bg-amber-50 text-amber-800 border-amber-200';

  return (
    <div id="credit-notes-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            {esNota ? 'Ventas & Clientes' : 'Créditos & Caja'}
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[#2F2A25] tracking-tight">{tituloVista}</h1>
          <p className="text-[11px] text-[#756E65] mt-0.5">
            {esNota
              ? 'Documento interno emitido por devoluciones -- no es un comprobante fiscal.'
              : 'Saldo reutilizable a favor del cliente, aplicable como pago parcial en una venta futura.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => refreshCreditNotes({ force: true })}
          disabled={loading}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          title="Volver a consultar el backend real"
        >
          <RefreshCcw className={`w-4 h-4 text-[#756E65] ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Actualizando...' : 'Actualizar'}</span>
        </button>
      </div>

      {/* Error real del backend -- nunca se sustituye por datos demo/locales */}
      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No se pudo cargar {tituloVista.toLowerCase()} desde el backend: {loadError}
              {creditNotesStale && ' (se muestra la última información disponible, puede no estar actualizada)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => refreshCreditNotes({ force: true })}
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
            <span className="text-[11px] font-bold uppercase tracking-wider">Saldo Disponible Total</span>
            <Wallet className="w-4 h-4 text-[#2F2A25]" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-[#2F2A25]">
              {loading ? '...' : formatCurrency(totalSaldoDisponible, settings.simboloMoneda)}
            </h3>
            <span className="text-[11px] text-[#756E65]">{activosCount} documento(s) activo(s)</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-2xs">
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Emitido</span>
            <Gift className="w-4 h-4 text-[#2F2A25]" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-[#2F2A25]">
              {loading ? '...' : formatCurrency(totalEmitido, settings.simboloMoneda)}
            </h3>
            <span className="text-[11px] text-[#756E65]">{scopedCreditNotes.length} documento(s) en total</span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-2xs">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Aplicado Acumulado</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2">
            <h3 className="text-xl font-bold text-emerald-700">
              {loading
                ? '...'
                : formatCurrency(
                    scopedCreditNotes.reduce((acc, c) => acc + (c.montoAplicado || 0), 0),
                    settings.simboloMoneda
                  )}
            </h3>
            <span className="text-[11px] text-[#756E65]">Consumido en ventas</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por número, cliente o venta..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>

        <select
          value={estadoFilter}
          onChange={(e) => setEstadoFilter(e.target.value as EstadoFilter)}
          className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
        >
          <option value="TODOS">Todos los Estados</option>
          <option value="EMITIDA">Emitidas (Saldo Completo)</option>
          <option value="PARCIALMENTE_APLICADA">Parcialmente Aplicadas</option>
          <option value="APLICADA">Aplicadas en su Totalidad</option>
          <option value="ANULADA">Anuladas</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        {loading && scopedCreditNotes.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando {tituloVista.toLowerCase()} real(es) en el backend...</p>
          </div>
        ) : !loading && !loadError && scopedCreditNotes.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <Gift className="w-8 h-8 opacity-40 mx-auto" />
            <p className="font-semibold text-xs text-[#2F2A25]">Todavía no hay {tituloVista.toLowerCase()} en Google Sheets.</p>
            <p className="text-[11px]">
              Se generan automáticamente al procesar una devolución con esta forma de reembolso, para un cliente registrado.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
                <tr>
                  <th className="py-3 px-4">N°</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Origen</th>
                  <th className="py-3 px-4">Fecha</th>
                  <th className="py-3 px-4 text-right">Monto Original</th>
                  <th className="py-3 px-4 text-right">Aplicado</th>
                  <th className="py-3 px-4 text-right">Saldo Disponible</th>
                  <th className="py-3 px-4 text-center">Estado</th>
                  <th className="py-3 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {filteredCreditNotes.map((cn) => (
                  <tr key={cn.id} className="hover:bg-[#FAF8F4]/80 transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#2F2A25]">{cn.numero}</td>
                    <td className="py-3.5 px-4 font-bold text-[#2F2A25]">{cn.clienteNombre}</td>
                    <td className="py-3.5 px-4 font-mono text-[#756E65]">{cn.ventaOrigenId || '-'}</td>
                    <td className="py-3.5 px-4 text-[#756E65]">{formatDateTime(cn.fechaCreacion)}</td>
                    <td className="py-3.5 px-4 text-right font-medium text-[#756E65]">
                      {formatCurrency(cn.montoOriginal, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-emerald-700">
                      {formatCurrency(cn.montoAplicado, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-[#2F2A25]">
                      {formatCurrency(cn.saldoDisponible, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${estadoBadgeClass(cn.estado)}`}>
                        {cn.estado}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedDetailId(cn.id)}
                          className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                          title="Ver detalle y aplicaciones"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setReceiptCreditNote(cn)}
                          className="p-1.5 rounded-lg text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                          title="Imprimir / Reimprimir"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {canVoid && cn.estado !== 'ANULADA' && cn.montoAplicado === 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoiding(cn);
                              setVoidReason('');
                            }}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition"
                            title="Anular"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {scopedCreditNotes.length > 0 && filteredCreditNotes.length === 0 && (
              <div className="text-center py-12 text-[#756E65] space-y-2">
                <Gift className="w-8 h-8 opacity-40 mx-auto" />
                <p className="font-semibold text-xs text-[#2F2A25]">No hay resultados con estos filtros</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedDetail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#2F2A25]">
                  {esNota ? 'Nota de Crédito' : 'Crédito a Favor / Vale'} {selectedDetail.numero}
                </h3>
                <span className="text-[11px] text-[#756E65]">Cliente: {selectedDetail.clienteNombre}</span>
              </div>
              <button type="button" onClick={() => setSelectedDetailId(null)} className="text-[#756E65] p-1 hover:text-[#2F2A25]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-white rounded-2xl border border-[#E4DDD2] space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#756E65]">Fecha de Emisión:</span>
                  <span className="font-medium text-[#2F2A25]">{formatDateTime(selectedDetail.fechaCreacion)}</span>
                </div>
                {selectedDetail.ventaOrigenId && (
                  <div className="flex justify-between">
                    <span className="text-[#756E65]">Venta Origen:</span>
                    <span className="font-mono font-medium text-[#2F2A25]">{selectedDetail.ventaOrigenId}</span>
                  </div>
                )}
                {selectedDetail.devolucionId && (
                  <div className="flex justify-between">
                    <span className="text-[#756E65]">Devolución Origen:</span>
                    <span className="font-mono font-medium text-[#2F2A25]">{selectedDetail.devolucionId}</span>
                  </div>
                )}
                <div className="border-t border-[#E4DDD2] pt-1.5 flex justify-between font-bold">
                  <span>Monto Original:</span>
                  <span>{formatCurrency(selectedDetail.montoOriginal, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-700">
                  <span>Monto Aplicado:</span>
                  <span>{formatCurrency(selectedDetail.montoAplicado, settings.simboloMoneda)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm text-[#2F2A25] pt-1 border-t border-[#E4DDD2]">
                  <span>Saldo Disponible:</span>
                  <span>{formatCurrency(selectedDetail.saldoDisponible, settings.simboloMoneda)}</span>
                </div>
                {selectedDetail.estado === 'ANULADA' && (
                  <div className="pt-1.5 border-t border-[#E4DDD2] text-rose-700">
                    <div className="font-bold">Anulado por: {selectedDetail.anuladoPor}</div>
                    <div>Fecha: {selectedDetail.fechaAnulacion && formatDateTime(selectedDetail.fechaAnulacion)}</div>
                    <div>Motivo: {selectedDetail.motivoAnulacion}</div>
                  </div>
                )}
              </div>

              <div>
                <h5 className="font-bold text-[#2F2A25] uppercase text-[10px] mb-2">Historial de Aplicaciones a Ventas:</h5>
                <div className="space-y-2">
                  {(selectedDetail.aplicaciones || []).length === 0 ? (
                    <p className="text-[#756E65] text-[11px] italic">Todavía no se ha aplicado a ninguna venta.</p>
                  ) : (
                    (selectedDetail.aplicaciones || []).map((app, idx) => (
                      <div key={idx} className="p-2.5 bg-white border border-[#E4DDD2] rounded-xl flex items-center justify-between">
                        <div>
                          <p className="font-bold text-[#2F2A25]">Venta {app.numeroVenta}</p>
                          <p className="text-[10px] text-[#756E65]">
                            {formatDateTime(app.fecha)} • Por: {app.usuarioNombre}
                          </p>
                        </div>
                        <span className="font-bold text-emerald-800">{formatCurrency(app.monto, settings.simboloMoneda)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedDetailId(null)}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => setReceiptCreditNote(selectedDetail)}
                className="flex-1 py-2 rounded-xl bg-[#2F2A25] text-xs font-bold text-white flex items-center justify-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5 text-[#E8DCC8]" />
                <span>Imprimir / Reimprimir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Reason Modal */}
      {voiding && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-800 font-bold text-sm border-b border-[#E4DDD2] pb-3">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <span>Anular {esNota ? 'Nota de Crédito' : 'Crédito a Favor / Vale'} {voiding.numero}</span>
            </div>

            <p className="text-xs text-[#756E65] leading-relaxed">
              Esta acción marcará el documento como ANULADO y su saldo disponible quedará en cero. No se puede
              deshacer desde aquí, y no está disponible si el documento ya fue aplicado a alguna venta.
            </p>

            <div>
              <label className="block text-xs font-bold text-[#2F2A25] mb-1 uppercase">Motivo de Anulación:</label>
              <textarea
                rows={3}
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Ej. Emitido por error / Duplicado"
                className="w-full p-2.5 rounded-xl border border-[#E4DDD2] bg-white text-xs text-[#2F2A25] focus:outline-none focus:border-rose-600"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVoiding(null)}
                disabled={loadingVoid}
                className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loadingVoid || !voidReason.trim()}
                onClick={handleConfirmVoid}
                className="flex-1 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-xs font-bold text-white transition disabled:bg-zinc-300"
              >
                {loadingVoid ? 'Anulando...' : 'Confirmar Anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt / Print Modal */}
      {receiptCreditNote && (
        <CreditNoteReceiptModal creditNote={receiptCreditNote} settings={settings} onClose={() => setReceiptCreditNote(null)} />
      )}
    </div>
  );
};
