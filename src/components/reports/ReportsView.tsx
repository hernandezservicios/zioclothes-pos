import React, { useState, useMemo } from 'react';
import { storageService } from '../../services/storageService';
import { useAuth } from '../../context/AuthContext';
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
} from 'lucide-react';

const COLORS = ['#2F2A25', '#C2410C', '#059669', '#2563EB', '#D97706', '#9333EA'];

export const ReportsView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [timeRange, setTimeRange] = useState<'HOY' | 'SEMANA' | 'MES' | 'TODO'>('MES');

  const sales = (storageService.getSales() || []).filter((s) => s && s.estado === 'COMPLETADA');
  const expenses = storageService.getExpenses() || [];
  const credits = storageService.getCredits() || [];
  const installments = storageService.getInstallments() || [];

  // Metrics Calculation
  const totalSalesRevenue = sales.reduce((acc, s) => acc + (s.total || 0), 0);
  const totalCOGS = sales.reduce((acc, s) => {
    return (
      acc +
      (s.items || []).reduce((sum, item) => {
        const itemCost = ((item.costoUnitario !== undefined ? item.costoUnitario : item.precioUnitario * 0.5)) * (item.cantidad || 0);
        return sum + itemCost;
      }, 0)
    );
  }, 0);

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
      { Concepto: 'Ingresos Totales por Ventas', Monto: totalSalesRevenue },
      { Concepto: 'Costo de Mercancía Vendida (COGS)', Monto: -totalCOGS },
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

      {/* Financial Statement P&L Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-xs">
          <span className="text-[11px] font-bold uppercase text-[#756E65]">Ventas Totales</span>
          <p className="text-xl font-serif font-bold text-[#2F2A25] mt-1">
            {formatCurrency(totalSalesRevenue, settings.simboloMoneda)}
          </p>
          <span className="text-[10px] text-emerald-700 font-semibold">{sales.length} transacciones</span>
        </div>

        {hasPermission('costos.ver') && (
          <>
            <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-xs">
              <span className="text-[11px] font-bold uppercase text-[#756E65]">Ganancia Bruta (Margen)</span>
              <p className="text-xl font-serif font-bold text-emerald-800 mt-1">
                {formatCurrency(grossProfit, settings.simboloMoneda)}
              </p>
              <span className="text-[10px] text-emerald-700 font-semibold">
                Margen Bruto: {grossMargin.toFixed(1)}%
              </span>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2] shadow-xs">
              <span className="text-[11px] font-bold uppercase text-[#756E65]">Gastos Operativos</span>
              <p className="text-xl font-serif font-bold text-rose-800 mt-1">
                -{formatCurrency(totalExpenses, settings.simboloMoneda)}
              </p>
              <span className="text-[10px] text-rose-700 font-semibold">{expenses.length} gastos registrados</span>
            </div>

            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-xs">
              <span className="text-[11px] font-bold uppercase text-emerald-800">Ganancia Neta Real</span>
              <p className="text-xl font-serif font-bold text-emerald-950 mt-1">
                {formatCurrency(netProfit, settings.simboloMoneda)}
              </p>
              <span className="text-[10px] text-emerald-700 font-semibold">Utilidad final neta</span>
            </div>
          </>
        )}
      </div>

      {/* Credit Cartera Health */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-[#756E65] uppercase">Total Créditos Concedidos</span>
          <p className="text-base font-bold text-[#2F2A25] mt-1">
            {formatCurrency(totalCreditIssued, settings.simboloMoneda)}
          </p>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-emerald-700 uppercase">Abonos Recaudados</span>
          <p className="text-base font-bold text-emerald-800 mt-1">
            {formatCurrency(totalCreditCollected, settings.simboloMoneda)}
          </p>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-[#E4DDD2]">
          <span className="text-[10px] font-bold text-amber-800 uppercase">Cartera Pendiente de Cobro</span>
          <p className="text-base font-bold text-amber-900 mt-1">
            {formatCurrency(totalPendingDebt, settings.simboloMoneda)}
          </p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Category */}
        <div className="p-5 bg-white rounded-3xl border border-[#E4DDD2] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif font-bold text-base text-[#2F2A25]">
              Distribución de Ventas por Categoría de Ropa
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
