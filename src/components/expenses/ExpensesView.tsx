import React, { useState, useMemo, useEffect } from 'react';
import { expensesApi } from '../../services/expensesApi';
import { storageService } from '../../services/storageService';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import {
  Receipt,
  Plus,
  Search,
  Download,
  Filter,
  Trash2,
  DollarSign,
  Calendar,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCcw,
} from 'lucide-react';

export const ExpensesView: React.FC = () => {
  const { currentUser, settings, hasPermission, activeCashSession, refreshActiveCashSession } = useAuth();
  const { showToast } = useToast();

  // FASE 3.7E: gastos reales vía expenses.list
  // (ExpensesController.handleListExpenses -> Google Sheets real). Antes
  // el registro del gasto en sí era 100% local (storageService), y solo
  // su efecto en caja se había corregido en FASE 3.6D con un
  // cashApi.addMovement('RETIRO', ...) manual. Esa llamada manual se
  // ELIMINA en esta fase: ExpensesController.handleCreateExpense YA
  // integra caja internamente en la MISMA transacción (tipo 'GASTO', no
  // 'RETIRO', sobre un campo dedicado Cajas.gastos) -- mantenerla habría
  // producido un DOBLE descuento de caja por cada gasto en efectivo.
  // CORREGIR AUDITORÍA: gastos ya no viven en un estado local propio de
  // esta vista -- se leen del DataStore central, la MISMA colección que
  // también consume ReportsView (antes cada una pedía expenses.list por
  // su cuenta, ver informe de auditoría).
  const { expenses, expensesLoading: loading, expensesError: loadError, expensesStale, refreshExpenses } = useDataStore();

  // Lista estática de categorías -- es solo vocabulario de UI (igual que
  // una lista fija de métodos de pago), no un dato de negocio ni un
  // catálogo con autoridad en Sheets: Gastos.categoria es un campo de
  // texto libre en el backend real (ver DATABASE.md), sin hoja de
  // categorías propia.
  const categories = storageService.getExpenseCategories() || [];

  useEffect(() => {
    refreshExpenses();
  }, [refreshExpenses]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('TODOS');
  const [modalOpen, setModalOpen] = useState(false);

  // Form Fields
  const [categoriaId, setCategoriaId] = useState(categories[0]?.id || '');
  // FIX P0 (inputs de montos sin 0 precargado): inicia en '' -- no en 0 --
  // para que el usuario escriba el monto directamente. El onChange ya
  // soportaba '' desde antes.
  const [monto, setMonto] = useState<number | string>('');
  const [descripcion, setDescripcion] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [metodoPago, setMetodoPago] = useState<'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA'>('EFECTIVO');
  const [comprobante, setComprobante] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);

  const filteredExpenses = useMemo(() => {
    return (expenses || []).filter((e) => {
      if (!e) return false;
      const matchesCat = selectedCat === 'TODOS' || e.categoriaNombre === selectedCat || e.categoria === selectedCat;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (e.descripcion && e.descripcion.toLowerCase().includes(q)) ||
        (e.proveedor && e.proveedor.toLowerCase().includes(q)) ||
        (e.categoriaNombre && e.categoriaNombre.toLowerCase().includes(q));

      return matchesCat && matchesSearch;
    });
  }, [expenses, selectedCat, searchQuery]);

  const totalExpenseSum = (filteredExpenses || []).reduce((acc, e) => acc + (e.monto || 0), 0);

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingExpense) return; // previene doble submit
    if (!currentUser) return;

    const expenseAmount = typeof monto === 'number' ? monto : parseFloat(monto);
    if (!Number.isFinite(expenseAmount) || expenseAmount <= 0) {
      showToast('Monto Inválido', 'El monto del gasto debe ser un número válido mayor a RD$ 0.00', 'error');
      return;
    }
    if (!descripcion.trim()) {
      showToast('Descripción Requerida', 'Ingrese el detalle del gasto', 'error');
      return;
    }

    setSavingExpense(true);

    const cat = (categories || []).find((c) => c.id === categoriaId);
    const catLabel = cat ? cat.nombre : 'General';

    // FASE 3.7E: expenses.create real (ExpensesController.
    // handleCreateExpense). El backend decide por sí mismo si el gasto
    // afecta la caja activa real (metodoPago === 'EFECTIVO') y lo hace
    // dentro de la MISMA transacción -- no se llama a cashApi.addMovement()
    // por separado (ver nota en expensesApi.ts). No se actualiza la lista
    // ni el total de gastos localmente antes de la respuesta real -- sin
    // actualización optimista.
    const res = await expensesApi.create({
      categoria: catLabel,
      descripcion: descripcion.trim(),
      proveedor: proveedor.trim() || undefined,
      monto: expenseAmount,
      metodoPago,
      comprobante: comprobante.trim() || undefined,
    });

    setSavingExpense(false);

    if (res.success) {
      showToast('Gasto Registrado', res.message, 'exito');
      setModalOpen(false);
      setDescripcion('');
      setProveedor('');
      setComprobante('');
      setMonto('');
      // CORREGIR AUDITORÍA: invalida el DataStore central de gastos --
      // ReportsView refleja el nuevo gasto de inmediato, sin logout/login
      // ni F5.
      await refreshExpenses({ force: true });
      // Si el gasto fue en efectivo, la caja activa real (efectivoEsperado)
      // ya cambió en el backend -- se refresca para que Navbar/Dashboard/
      // CashView lo reflejen de inmediato.
      if (metodoPago === 'EFECTIVO') {
        await refreshActiveCashSession();
      }
    } else {
      showToast('Error', res.message, 'error');
      // No se modifica la lista de gastos ni el total mostrado -- siguen
      // siendo los últimos reales confirmados por el backend.
    }
  };

  const handleExportCSV = () => {
    const rows = (filteredExpenses || []).map((e) => ({
      NumeroGasto: e.numeroGasto,
      Fecha: e.fecha,
      Categoria: e.categoriaNombre,
      Descripcion: e.descripcion,
      Proveedor: e.proveedor,
      Monto: e.monto,
      MetodoPago: e.metodoPago,
      Comprobante: e.comprobante || 'N/A',
      Usuario: e.usuarioNombre,
    }));
    exportToCSV('Gastos_Operativos_ZIO', rows);
    showToast('Exportación Exitosa', 'Reporte de gastos descargado en CSV.', 'exito');
  };

  return (
    <div id="expenses-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Egresos & Costos Operativos
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Gastos de la Boutique
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => refreshExpenses({ force: true })}
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
            disabled={expenses.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {hasPermission('gastos.crear') && (
            <button
              type="button"
              onClick={() => {
                setCategoriaId(categories[0]?.id || '');
                setMonto('');
                setDescripcion('');
                setProveedor('');
                setMetodoPago('EFECTIVO');
                setComprobante('');
                setModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Registrar Gasto</span>
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
              No se pudo cargar el historial de gastos desde el backend: {loadError}
              {expensesStale && ' (se muestra la última información disponible, puede no estar actualizada)'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => refreshExpenses({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* KPI Total Banner */}
      <div className="p-4 bg-[#F6F1E8] rounded-2xl border border-[#E4DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase text-[#756E65]">Total Gastos Registrados</span>
          <h2 className="text-2xl font-serif font-bold text-rose-800">
            {loading ? '...' : formatCurrency(totalExpenseSum, settings.simboloMoneda)}
          </h2>
        </div>
        <div className="text-xs text-[#756E65] sm:text-right">
          <span className="font-bold text-[#2F2A25]">{(filteredExpenses || []).length}</span> comprobante(s) de gasto
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por concepto, proveedor o categoría..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>

        <select
          value={selectedCat}
          onChange={(e) => setSelectedCat(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25]"
        >
          <option value="TODOS">Todas las Categorías</option>
          {(categories || []).map((c) => (
            <option key={c.id} value={c.nombre}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        {loading && expenses.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <RefreshCcw className="w-7 h-7 opacity-40 mx-auto animate-spin" />
            <p className="font-semibold text-xs">Consultando gastos reales en el backend...</p>
          </div>
        ) : !loading && !loadError && expenses.length === 0 ? (
          <div className="text-center py-14 space-y-2 text-[#756E65]">
            <Receipt className="w-8 h-8 opacity-40 mx-auto" />
            <p className="font-semibold text-xs text-[#2F2A25]">Todavía no hay gastos registrados en Google Sheets.</p>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4"># Gasto</th>
                <th className="py-3 px-4">Fecha</th>
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4">Concepto / Detalle</th>
                <th className="py-3 px-4">Proveedor</th>
                <th className="py-3 px-4">Forma de Pago</th>
                <th className="py-3 px-4 text-right">Monto</th>
                <th className="py-3 px-4">Registrado Por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredExpenses || []).map((exp) => (
                <tr key={exp.id} className="hover:bg-[#FAF8F4]/80 transition">
                  <td className="py-3.5 px-4 font-mono font-bold text-[#2F2A25]">
                    {exp.numeroGasto}
                  </td>
                  <td className="py-3.5 px-4 text-[#756E65]">{formatDateTime(exp.fecha)}</td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[11px] font-semibold text-[#2F2A25]">
                      {exp.categoriaNombre || exp.categoria}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-medium text-[#2F2A25]">{exp.descripcion}</td>
                  <td className="py-3.5 px-4 text-[#756E65]">{exp.proveedor}</td>
                  <td className="py-3.5 px-4 text-[#756E65]">
                    {exp.metodoPago}
                    {exp.metodoPago === 'EFECTIVO' && (
                      <span
                        className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                          exp.pagadoConCajaActiva
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                        title={exp.pagadoConCajaActiva ? 'Descontado de una caja real' : 'No había caja abierta al registrarlo'}
                      >
                        {exp.pagadoConCajaActiva ? 'CAJA' : 'SIN CAJA'}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-rose-700">
                    -{formatCurrency(exp.monto, settings.simboloMoneda)}
                  </td>
                  <td className="py-3.5 px-4 text-[#756E65]">{exp.usuarioNombre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* CREATE EXPENSE MODAL.
          AUDITORÍA (FASE -- responsive completo): overlay desplazable
          (`overflow-y-auto` + `my-8`), mismo patrón que el resto de esta
          auditoría -- sin tocar ningún campo ni la lógica de gastos. */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl my-8">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Gasto Operativo</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={savingExpense}
                className="text-[#756E65] p-1 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} noValidate className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Categoría del Gasto:</label>
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  disabled={savingExpense}
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                >
                  {(categories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Monto (RD$):</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={monto === '' ? '' : monto}
                  disabled={savingExpense}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setMonto('');
                    else {
                      const num = parseFloat(val);
                      setMonto(isNaN(num) ? '' : val);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold text-rose-800 text-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Concepto / Justificación:</label>
                <input
                  type="text"
                  required
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  disabled={savingExpense}
                  placeholder="Ej. Factura eléctrica mes / Compra fundas y perchas"
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Proveedor / Beneficiario:</label>
                  <input
                    type="text"
                    value={proveedor}
                    onChange={(e) => setProveedor(e.target.value)}
                    disabled={savingExpense}
                    placeholder="Ej. EDEESTE / Plaza Lama"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Forma de Pago:</label>
                  <select
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value as any)}
                    disabled={savingExpense}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                  >
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                    <option value="TARJETA">Tarjeta Empresarial</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Comprobante (opcional):</label>
                <input
                  type="text"
                  value={comprobante}
                  onChange={(e) => setComprobante(e.target.value)}
                  disabled={savingExpense}
                  placeholder="Ej. Factura #1123 / NCF B0100002345"
                  className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              {/* FASE 3.7E: el backend real SIEMPRE intenta descontar de la
                  caja activa cuando metodoPago es EFECTIVO (sin excepción
                  posible desde el frontend) -- el checkbox anterior
                  ("Deducir automáticamente...") sugería falsamente que
                  esto era opcional, cuando en realidad no tenía ningún
                  efecto real. Se reemplaza por un aviso informativo fiel
                  al comportamiento real del backend. */}
              {metodoPago === 'EFECTIVO' && (
                <div
                  className={`p-2.5 rounded-xl border text-[11px] ${
                    activeCashSession
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {activeCashSession
                    ? 'Este gasto se descontará automáticamente de la caja activa real.'
                    : 'No hay una caja abierta: el gasto se registrará igual, pero no afectará ningún turno de caja.'}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={savingExpense}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingExpense}
                  className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md hover:bg-[#403932] disabled:bg-zinc-300"
                >
                  {savingExpense ? 'Guardando...' : 'Guardar Gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
