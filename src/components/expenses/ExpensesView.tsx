import React, { useState, useMemo } from 'react';
import { ExpenseRecord, ExpenseCategory } from '../../types';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { useAuth } from '../../context/AuthContext';
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
} from 'lucide-react';

export const ExpensesView: React.FC = () => {
  const { currentUser, settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [expenses, setExpenses] = useState<ExpenseRecord[]>(() => storageService.getExpenses() || []);
  const categories = storageService.getExpenseCategories() || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('TODOS');
  const [modalOpen, setModalOpen] = useState(false);

  // Form Fields
  const [categoriaId, setCategoriaId] = useState(categories[0]?.id || '');
  const [monto, setMonto] = useState<number | string>(0);
  const [descripcion, setDescripcion] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [metodoPago, setMetodoPago] = useState<'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA'>('EFECTIVO');
  const [comprobante, setComprobante] = useState('');
  const [deducirDeCaja, setDeducirDeCaja] = useState(true);
  const [loading, setLoading] = useState(false);

  const filteredExpenses = useMemo(() => {
    return (expenses || []).filter((e) => {
      if (!e) return false;
      const matchesCat = selectedCat === 'TODOS' || e.categoriaId === selectedCat;
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

    setLoading(true);

    const cat = (categories || []).find((c) => c.id === categoriaId);
    const catName = cat ? cat.nombre : 'General';

    const newExpense: ExpenseRecord = {
      id: `EXP-${Date.now()}`,
      numeroGasto: storageService.getNextSequence('EXP'),
      categoriaId,
      categoriaNombre: catName,
      monto: expenseAmount,
      descripcion: descripcion.trim(),
      proveedor: proveedor.trim() || 'Varios',
      metodoPago,
      comprobante: comprobante.trim() || undefined,
      usuarioId: currentUser.id,
      usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
      fecha: new Date().toISOString().replace('T', ' ').substring(0, 19),
      pagadoConCajaActiva: deducirDeCaja && metodoPago === 'EFECTIVO',
    };

    // If paid from active cash session, register movement
    if (deducirDeCaja && metodoPago === 'EFECTIVO') {
      const activeCash = storageService.getActiveCashSession();
      if (activeCash) {
        await apiService.addCashMovement({
          sessionId: activeCash.id,
          tipo: 'SALIDA',
          monto: expenseAmount,
          motivo: `Gasto ${newExpense.numeroGasto}: ${newExpense.descripcion}`,
          usuarioId: currentUser.id,
          usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        });
      }
    }

    const currentExpenses = storageService.getExpenses();
    currentExpenses.unshift(newExpense);
    storageService.saveExpenses(currentExpenses);
    setExpenses(currentExpenses);

    setLoading(false);
    setModalOpen(false);
    setDescripcion('');
    setProveedor('');
    setComprobante('');
    showToast('Gasto Registrado', `Gasto ${newExpense.numeroGasto} guardado con éxito.`, 'exito');
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
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {hasPermission('gastos.crear') && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Registrar Gasto</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Total Banner */}
      <div className="p-4 bg-[#F6F1E8] rounded-2xl border border-[#E4DDD2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase text-[#756E65]">Total Gastos Registrados</span>
          <h2 className="text-2xl font-serif font-bold text-rose-800">
            {formatCurrency(totalExpenseSum, settings.simboloMoneda)}
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
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
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
                      {exp.categoriaNombre}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-medium text-[#2F2A25]">{exp.descripcion}</td>
                  <td className="py-3.5 px-4 text-[#756E65]">{exp.proveedor}</td>
                  <td className="py-3.5 px-4 text-[#756E65]">{exp.metodoPago}</td>
                  <td className="py-3.5 px-4 text-right font-bold text-rose-700">
                    -{formatCurrency(exp.monto, settings.simboloMoneda)}
                  </td>
                  <td className="py-3.5 px-4 text-[#756E65]">{exp.usuarioNombre}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(filteredExpenses || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Receipt className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">No hay gastos registrados</p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE EXPENSE MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">Registrar Gasto Operativo</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} noValidate className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-[#2F2A25] mb-1">Categoría del Gasto:</label>
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
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
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={monto === '' ? '' : monto}
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
                    placeholder="Ej. EDEESTE / Plaza Lama"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Forma de Pago:</label>
                  <select
                    value={metodoPago}
                    onChange={(e) => setMetodoPago(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                  >
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                    <option value="TARJETA">Tarjeta Empresarial</option>
                  </select>
                </div>
              </div>

              {metodoPago === 'EFECTIVO' && (
                <label className="flex items-center gap-2 p-2.5 bg-white border border-[#E4DDD2] rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deducirDeCaja}
                    onChange={(e) => setDeducirDeCaja(e.target.checked)}
                    className="rounded text-[#2F2A25]"
                  />
                  <span className="text-[#2F2A25] font-semibold">
                    Deducir automáticamente de la gaveta de caja activa
                  </span>
                </label>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md hover:bg-[#403932]"
                >
                  {loading ? 'Guardando...' : 'Guardar Gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
