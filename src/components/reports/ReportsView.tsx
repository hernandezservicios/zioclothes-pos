import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  Download,
  Calendar,
  DollarSign,
  PieChart as PieIcon,
  Package,
  Users,
  CreditCard,
  AlertTriangle,
  RefreshCcw,
} from 'lucide-react';

const COLORS = ['#2F2A25', '#C2410C', '#059669', '#2563EB', '#D97706', '#9333EA'];

export const ReportsView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [timeRange, setTimeRange] = useState<'HOY' | 'SEMANA' | 'MES' | 'TODO'>('MES');

  // FASE 3.7A/3.7B/3.7E / CORREGIR AUDITORÍA: ventas, créditos y gastos
  // reales, ahora leídos del DataStore central -- la MISMA colección que
  // consumen SalesView/ReturnsView/Dashboard (ventas),
  // CreditsView/InstallmentsView/Dashboard (créditos) y ExpensesView
  // (gastos). Antes cada uno de estos 3 dominios se pedía por separado
  // desde este componente (una de las 3-4 llamadas independientes a cada
  // endpoint detectadas en el informe de auditoría).
  const {
    sales: rawSales,
    salesLoading,
    salesError,
    refreshSales,
    credits: rawCredits,
    creditsLoading,
    creditsError,
    refreshCredits,
    // FASE 7 (Parte 29 -- reportes): mismo dominio central ya usado por
    // CreditNotesView/POS desde la Fase 6, sin pedir una llamada de red
    // adicional propia de este componente.
    creditNotes: rawCreditNotes,
    creditNotesLoading,
    refreshCreditNotes,
    expenses: rawExpenses,
    expensesLoading,
    expensesError,
    refreshExpenses,
    // FASE 10 (auditoría E2E -- hallazgo real, "ventas netas"): antes este
    // reporte filtraba `s.estado === 'COMPLETADA'`, lo que descartaba POR
    // COMPLETO cualquier venta con una devolución parcial/total
    // (DEVUELTA_PARCIAL/DEVUELTA_TOTAL) -- incluyendo la parte de esa
    // venta que NUNCA se devolvió. Eso SUBESTIMABA "Ventas Totales", en
    // sentido contrario al Dashboard (que SOBRESTIMABA al no restar nada
    // de lo devuelto) -- ambas pantallas mostraban números distintos e
    // incorrectos para el mismo concepto. Se corrige igual que en
    // DashboardView.tsx: se incluyen esas ventas en el bruto y se resta lo
    // realmente devuelto (returns.list), nunca se descarta la venta entera.
    returns: rawReturns,
    refreshReturns,
  } = useDataStore();

  useEffect(() => {
    refreshSales();
    refreshCredits();
    refreshCreditNotes();
    refreshExpenses();
    refreshReturns();
  }, [refreshSales, refreshCredits, refreshCreditNotes, refreshExpenses, refreshReturns]);

  const sales = (rawSales || []).filter((s) => s && s.estado !== 'ANULADA');
  const returnsList = rawReturns || [];
  const expenses = rawExpenses || [];
  const credits = rawCredits || [];
  const installments = (rawCredits || []).flatMap((c) => c.abonos || []).filter((i) => i && i.estado !== 'ANULADO');

  // Metrics Calculation
  const totalSalesRevenueBruto = sales.reduce((acc, s) => acc + (s.total || 0), 0);
  // FASE 3.7A: antes, cuando faltaba costoUnitario en un item, se asumía
  // un margen del 50% (item.precioUnitario * 0.5) -- un dato financiero
  // inventado. sales.list ya devuelve costoTotal real por venta (calculado
  // autoritativamente en el backend al crear la venta desde el costo real
  // de la variante), así que se usa directamente sin recalcular ni asumir
  // nada a nivel de item.
  const totalCOGSBruto = sales.reduce((acc, s) => acc + (s.costoTotal || 0), 0);

  // Devoluciones reales (todo el historial, mismo alcance "sin filtro de
  // período" que ya tenía el resto de este reporte -- ver `timeRange`,
  // declarado pero nunca aplicado a ningún cálculo de esta pantalla,
  // documentado como hallazgo separado en el informe de auditoría).
  const totalDevueltoMonto = returnsList.reduce((acc, r) => acc + (r.montoDevuelto || 0), 0);
  const totalDevueltoCosto = returnsList.reduce(
    (acc, r) => acc + (r.items || []).reduce((s, it) => s + (it.costoUnitario || 0) * (it.cantidad || 0), 0),
    0
  );

  const totalSalesRevenue = Math.max(0, totalSalesRevenueBruto - totalDevueltoMonto);
  const totalCOGS = Math.max(0, totalCOGSBruto - totalDevueltoCosto);

  const grossProfit = totalSalesRevenue - totalCOGS;
  const grossMargin = totalSalesRevenue > 0 ? (grossProfit / totalSalesRevenue) * 100 : 0;
  const totalExpenses = expenses.reduce((acc, e) => acc + (e.monto || 0), 0);
  const netProfit = grossProfit - totalExpenses;

  // Total Receivables & Collected
  const totalCreditIssued = credits.reduce((acc, c) => acc + (c.montoOriginal || 0), 0);
  const totalCreditCollected = installments.reduce((acc, i) => acc + (i.montoAbonado || 0), 0);
  const totalPendingDebt = credits
    .filter((c) => c && c.estado !== 'PAGADA' && c.estado !== 'ANULADA')
    .reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);

  // FASE 7 (Parte 29): Créditos a Favor / Notas de Crédito -- concepto
  // DISTINTO de la cartera por cobrar de arriba (aquí el negocio le debe
  // al cliente, no al revés; ver Creditos_Favor vs Creditos en el
  // backend). Nunca se suman entre sí.
  const creditNotes = rawCreditNotes || [];
  const totalCreditNotesIssued = creditNotes
    .filter((c) => c && c.estado !== 'ANULADA')
    .reduce((acc, c) => acc + (c.montoOriginal || 0), 0);
  const totalCreditNotesApplied = creditNotes.reduce((acc, c) => acc + (c.montoAplicado || 0), 0);
  const totalCreditNotesPending = creditNotes
    .filter((c) => c && c.estado !== 'ANULADA')
    .reduce((acc, c) => acc + (c.saldoDisponible || 0), 0);

  // Sales by Category Chart Data
  const categorySalesMap: Record<string, number> = {};
  sales.forEach((s) => {
    (s.items || []).forEach((item) => {
      const cat = item.categoria || 'Moda General';
      categorySalesMap[cat] = (categorySalesMap[cat] || 0) + (item.total || 0);
    });
  });

  const categoryChartData = Object.entries(categorySalesMap).map(([name, value]) => ({
    name,
    value,
  }));

  // Sales by Payment Method
  const paymentMethodMap: Record<string, number> = {};
  sales.forEach((s) => {
    if (s.metodoPago) {
      paymentMethodMap[s.metodoPago] = (paymentMethodMap[s.metodoPago] || 0) + (s.total || 0);
    }
  });

  const paymentChartData = Object.entries(paymentMethodMap).map(([name, total]) => ({
    name,
    total,
  }));

  const handleExportFullFinancialReport = () => {
    const reportRows = [
      { Concepto: 'Ventas Brutas', Monto: totalSalesRevenueBruto },
      { Concepto: 'Devoluciones (monto devuelto)', Monto: -totalDevueltoMonto },
      { Concepto: 'Ingresos Totales por Ventas (neto de devoluciones)', Monto: totalSalesRevenue },
      { Concepto: 'Costo de Mercancía Vendida (COGS, neto de devoluciones)', Monto: -totalCOGS },
      { Concepto: 'Ganancia Bruta', Monto: grossProfit },
      { Concepto: 'Margen Bruto (%)', Monto: `${grossMargin.toFixed(2)}%` },
      { Concepto: 'Gastos Operativos Registrados', Monto: -totalExpenses },
      { Concepto: 'Ganancia Neta Real', Monto: netProfit },
      { Concepto: 'Créditos Emitidos', Monto: totalCreditIssued },
      { Concepto: 'Abonos Cobrados', Monto: totalCreditCollected },
      { Concepto: 'Cartera por Cobrar Pendiente', Monto: totalPendingDebt },
    ];
    exportToCSV('Estado_Financiero_ZIO_Clothes', reportRows);
    showToast('Reporte Generado', 'Estado financiero descargado en CSV.', 'exito');
  };

  return (
    <div id="reports-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Márgenes, Finanzas & Rendimiento
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Reportes Ejecutivos & Estado de Resultados
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportFullFinancialReport}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar Estado Financiero</span>
          </button>
        </div>
      </div>

      {/* Error real del backend de ventas -- nunca se sustituye por datos demo/locales */}
      {salesError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudieron cargar las ventas reales para este reporte: {salesError}</span>
          </div>
          <button
            type="button"
            onClick={() => refreshSales({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0 flex items-center gap-1.5"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Reintentar
          </button>
        </div>
      )}
      {expensesError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudieron cargar los gastos reales para este reporte: {expensesError}</span>
          </div>
          <button
            type="button"
            onClick={() => refreshExpenses({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0 flex items-center gap-1.5"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Reintentar
          </button>
        </div>
      )}

      {/* Financial Statement P&L Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-xs">
          <span className="text-[11px] font-bold uppercase text-[#756E65]">Ventas Totales</span>
          <p className="text-xl font-serif font-bold text-[#2F2A25] mt-1">
            {salesLoading ? '...' : formatCurrency(totalSalesRevenue, settings.simboloMoneda)}
          </p>
          <span className="text-[10px] text-emerald-700 font-semibold">
            {sales.length} transacciones{totalDevueltoMonto > 0 ? ` · neto de ${formatCurrency(totalDevueltoMonto, settings.simboloMoneda)} devuelto` : ''}
          </span>
        </div>

        {hasPermission('costos.ver') && (
          <>
            <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-xs">
              <span className="text-[11px] font-bold uppercase text-[#756E65]">Ganancia Bruta (Margen)</span>
              <p className="text-xl font-serif font-bold text-emerald-800 mt-1">
                {salesLoading ? '...' : formatCurrency(grossProfit, settings.simboloMoneda)}
              </p>
              <span className="text-[10px] text-emerald-700 font-semibold">
                Margen Bruto: {salesLoading ? '...' : `${grossMargin.toFixed(1)}%`}
              </span>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-xs">
              <span className="text-[11px] font-bold uppercase text-[#756E65]">Gastos Operativos</span>
              <p className="text-xl font-serif font-bold text-rose-800 mt-1">
                {expensesLoading ? '...' : `-${formatCurrency(totalExpenses, settings.simboloMoneda)}`}
              </p>
              <span className="text-[10px] text-rose-700 font-semibold">{expenses.length} gastos registrados</span>
            </div>

            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-xs">
              <span className="text-[11px] font-bold uppercase text-emerald-800">Ganancia Neta Real</span>
              <p className="text-xl font-serif font-bold text-emerald-950 mt-1">
                {salesLoading || expensesLoading ? '...' : formatCurrency(netProfit, settings.simboloMoneda)}
              </p>
              <span className="text-[10px] text-emerald-700 font-semibold">Utilidad final neta</span>
            </div>
          </>
        )}
      </div>

      {/* Credit Cartera Health -- FASE 3.7B: conectado a credits.list real
          (DataStore central). */}
      {creditsError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudo cargar la cartera real de créditos para este reporte: {creditsError}</span>
          </div>
          <button
            type="button"
            onClick={() => refreshCredits({ force: true })}
            className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0 flex items-center gap-1.5"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Reintentar
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-[#756E65] uppercase">Total Créditos Concedidos</span>
          <p className="text-base font-bold text-[#2F2A25] mt-1">
            {creditsLoading ? '...' : formatCurrency(totalCreditIssued, settings.simboloMoneda)}
          </p>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-emerald-700 uppercase">Abonos Recaudados</span>
          <p className="text-base font-bold text-emerald-800 mt-1">
            {creditsLoading ? '...' : formatCurrency(totalCreditCollected, settings.simboloMoneda)}
          </p>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-amber-800 uppercase">Cartera Pendiente de Cobro</span>
          <p className="text-base font-bold text-amber-900 mt-1">
            {creditsLoading ? '...' : formatCurrency(totalPendingDebt, settings.simboloMoneda)}
          </p>
        </div>
      </div>

      {/* Créditos a Favor / Notas de Crédito -- FASE 7 (Parte 29): concepto
          opuesto a la cartera por cobrar de arriba, mostrado por separado
          para no mezclar ambos saldos en la misma lectura. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-[#756E65] uppercase">Créditos a Favor / Notas Emitidos</span>
          <p className="text-base font-bold text-[#2F2A25] mt-1">
            {creditNotesLoading ? '...' : formatCurrency(totalCreditNotesIssued, settings.simboloMoneda)}
          </p>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-emerald-700 uppercase">Aplicados en Ventas</span>
          <p className="text-base font-bold text-emerald-800 mt-1">
            {creditNotesLoading ? '...' : formatCurrency(totalCreditNotesApplied, settings.simboloMoneda)}
          </p>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-amber-800 uppercase">Saldo a Favor Pendiente de Usar</span>
          <p className="text-base font-bold text-amber-900 mt-1">
            {creditNotesLoading ? '...' : formatCurrency(totalCreditNotesPending, settings.simboloMoneda)}
          </p>
        </div>
      </div>
      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Category */}
        <div className="p-5 bg-white rounded-3xl border border-[#E4DDD2] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            {/* FASE 7 (Parte 38 -- auditoría final de texto): "de Ropa" era
                terminología específica de vestimenta en el título de una
                pantalla/gráfico (mismo patrón ya corregido antes en
                "Devoluciones de Prendas" -> "Devoluciones") -- se retira
                sin tocar el cálculo (categorySalesMap ya usa la categoría
                real del producto, nunca una etiqueta de ropa fija). */}
            <h3 className="font-serif font-bold text-base text-[#2F2A25]">
              Distribución de Ventas por Categoría
            </h3>
            <PieIcon className="w-4 h-4 text-[#756E65]" />
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryChartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {categoryChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any) => formatCurrency(Number(value), settings.simboloMoneda)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales by Payment Method */}
        <div className="p-5 bg-white rounded-3xl border border-[#E4DDD2] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif font-bold text-base text-[#2F2A25]">
              Volumen por Forma de Pago
            </h3>
            <CreditCard className="w-4 h-4 text-[#756E65]" />
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4DDD2" />
                <XAxis dataKey="name" stroke="#756E65" fontSize={11} />
                <YAxis stroke="#756E65" fontSize={11} />
                <Tooltip
                  formatter={(value: any) => formatCurrency(Number(value), settings.simboloMoneda)}
                />
                <Bar dataKey="total" fill="#2F2A25" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
