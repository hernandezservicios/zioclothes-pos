import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { formatCurrency } from '../../utils/formatters';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  CreditCard,
  AlertTriangle,
  Coins,
  Users,
  Package,
  Wallet,
  Calendar,
  ChevronRight,
  Sparkles,
  PieChart,
  BarChart3,
  RefreshCcw,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (view: string, filterOrTab?: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { settings, hasPermission, activeCashSession } = useAuth();
  const [period, setPeriod] = useState<'7d' | '30d' | 'mes' | 'ano'>('30d');

  // FASE 3.7A/3.7B / CORREGIR AUDITORÍA: ventas, créditos, productos,
  // clientes y gastos vienen todos del DataStore central -- la MISMA
  // colección que consumen SalesView/ReturnsView (ventas),
  // CreditsView/InstallmentsView (créditos), ProductsView/POSView/
  // Inventario/Compras (productos) y CustomersView (clientes). Antes cada
  // uno de estos KPIs pedía su propio sales.list/credits.list por
  // separado (Dashboard era una de las 4 llamadas independientes a cada
  // uno, ver informe de auditoría), y productos/clientes/gastos se leían
  // directo de storageService (un caché que solo se llenaba en login,
  // igual que el bug del POS). No hay endpoint de "abonos" separado: se
  // aplana credit.abonos[] de cada cuenta.
  const {
    sales: salesData,
    salesLoading,
    salesError,
    refreshSales,
    credits: creditsData,
    creditsLoading,
    creditsError,
    refreshCredits,
    products,
    refreshProducts,
    customers,
    refreshCustomers,
    expenses,
    refreshExpenses,
  } = useDataStore();

  useEffect(() => {
    refreshSales();
    refreshCredits();
    refreshProducts();
    refreshCustomers();
    refreshExpenses();
  }, [refreshSales, refreshCredits, refreshProducts, refreshCustomers, refreshExpenses]);

  // activeCash viene de AuthContext (cash.getActiveSession real), no del
  // DataStore -- la caja sigue fuera de alcance de esta fase (ver informe).
  const sales = (salesData || []).filter((s) => s && s.estado !== 'ANULADA');
  const credits = creditsData || [];
  const installments = (creditsData || [])
    .flatMap((c) => c.abonos || [])
    .filter((i) => i && i.estado !== 'ANULADO');
  const activeCash = activeCashSession;

  // 1. KPI Calculations
  const todayStr = new Date().toISOString().substring(0, 10);
  const currentMonthStr = new Date().toISOString().substring(0, 7);

  const salesToday = (sales || [])
    .filter((s) => s && s.fecha && s.fecha.startsWith(todayStr))
    .reduce((acc, s) => acc + (s.total || 0), 0);

  const salesMonth = (sales || [])
    .filter((s) => s && s.fecha && s.fecha.startsWith(currentMonthStr))
    .reduce((acc, s) => acc + (s.total || 0), 0);

  const cogsMonth = (sales || [])
    .filter((s) => s && s.fecha && s.fecha.startsWith(currentMonthStr))
    .reduce((acc, s) => acc + (s.costoTotal || 0), 0);

  const grossProfitMonth = salesMonth - cogsMonth;

  const totalReceivables = (credits || [])
    .filter((c) => c && (c.estado === 'PENDIENTE' || c.estado === 'PARCIAL' || c.estado === 'VENCIDA'))
    .reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);

  const overdueCredits = (credits || []).filter((c) => c && c.estado === 'VENCIDA' && (c.saldoPendiente || 0) > 0);
  const overdueCreditsCount = overdueCredits.length;
  const overdueTotal = overdueCredits.reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);

  const installmentsMonth = (installments || [])
    .filter((i) => i && i.fecha && i.fecha.startsWith(currentMonthStr))
    .reduce((acc, i) => acc + (i.montoAbonado || 0), 0);

  const lowStockCount = (products || []).reduce((total, p) => {
    const isLow = (p.variantes || []).some((v) => (v.stock || 0) <= (p.stockMinimo || 4));
    return total + (isLow ? 1 : 0);
  }, 0);

  const expensesMonth = (expenses || [])
    .filter((e) => e && e.fecha && e.fecha.startsWith(currentMonthStr))
    .reduce((acc, e) => acc + (e.monto || 0), 0);

  // 2. Chart: Sales Trend Data
  const trendData = useMemo(() => {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 12;
    const result: { label: string; fullDate: string; ventas: number; ganancia: number }[] = [];

    if (period === '7d' || period === '30d') {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayKey = d.toISOString().substring(0, 10);
        const label =
          period === '7d'
            ? d.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric' })
            : `${d.getDate()}/${d.getMonth() + 1}`;

        const daySales = (sales || []).filter((s) => s && s.fecha && s.fecha.startsWith(dayKey));
        const dayTotal = daySales.reduce((sum, s) => sum + (s.total || 0), 0);
        const dayCost = daySales.reduce((sum, s) => sum + (s.costoTotal || 0), 0);

        result.push({
          label,
          fullDate: dayKey,
          ventas: dayTotal,
          ganancia: Math.max(0, dayTotal - dayCost),
        });
      }
    } else {
      // Monthly
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      months.forEach((m, idx) => {
        const mKey = `2026-${String(idx + 1).padStart(2, '0')}`;
        const mSales = (sales || []).filter((s) => s && s.fecha && s.fecha.startsWith(mKey));
        const mTotal = mSales.reduce((sum, s) => sum + (s.total || 0), 0);
        const mCost = mSales.reduce((sum, s) => sum + (s.costoTotal || 0), 0);
        result.push({
          label: m,
          fullDate: `Mes ${m} 2026`,
          ventas: mTotal,
          ganancia: Math.max(0, mTotal - mCost),
        });
      });
    }

    return result;
  }, [sales, period]);

  // 3. Payment Methods Breakdown
  const paymentMethodsData = useMemo(() => {
    const counts: Record<string, number> = {
      EFECTIVO: 0,
      TARJETA: 0,
      TRANSFERENCIA: 0,
      CREDITO: 0,
    };
    (sales || []).forEach((s) => {
      (s.pagos || []).forEach((p) => {
        if (p && p.metodo) {
          counts[p.metodo] = (counts[p.metodo] || 0) + (p.monto || 0);
        }
      });
    });
    const totalPayments = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(counts).map(([metodo, monto]) => ({
      metodo,
      monto,
      porcentaje: Math.round((monto / totalPayments) * 100),
    }));
  }, [sales]);

  // 4. Top Selling Products
  const topProducts = useMemo(() => {
    const map: Record<string, { nombre: string; cantidad: number; total: number; imagenUrl?: string }> = {};
    (sales || []).forEach((s) => {
      (s.items || []).forEach((item) => {
        if (item && item.productoId) {
          if (!map[item.productoId]) {
            const p = (products || []).find((pr) => pr && pr.id === item.productoId);
            map[item.productoId] = {
              nombre: item.nombreProducto || 'Prenda',
              cantidad: 0,
              total: 0,
              imagenUrl: p?.imagenUrl,
            };
          }
          map[item.productoId].cantidad += item.cantidad || 0;
          map[item.productoId].total += item.total || 0;
        }
      });
    });
    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [sales, products]);

  // 5. Receivables Aging
  const receivablesAging = useMemo(() => {
    let alDia = 0;
    let porVencer = 0;
    let vencidas = 0;

    (credits || []).forEach((c) => {
      if (!c || (c.saldoPendiente || 0) <= 0 || c.estado === 'PAGADA' || c.estado === 'ANULADA') return;
      if (c.estado === 'VENCIDA') {
        vencidas += c.saldoPendiente || 0;
      } else {
        const dueDate = new Date(c.fechaVencimiento);
        const now = new Date();
        const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 5) porVencer += c.saldoPendiente || 0;
        else alDia += c.saldoPendiente || 0;
      }
    });

    const sum = alDia + porVencer + vencidas || 1;
    return {
      alDia,
      porVencer,
      vencidas,
      total: alDia + porVencer + vencidas,
      pctAlDia: Math.round((alDia / sum) * 100),
      pctPorVencer: Math.round((porVencer / sum) * 100),
      pctVencidas: Math.round((vencidas / sum) * 100),
    };
  }, [credits]);

  return (
    <div id="dashboard-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome & Actions Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#FAF8F4] pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Panel de Control Ejecutivo
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[#2F2A25] tracking-tight">
            Resumen General ZIO CLOTHES
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-[#2F2A25] text-[#FAF8F4] text-xs font-bold shadow-sm hover:bg-[#403932] transition"
          >
            <ShoppingBag className="w-4 h-4 text-[#E8DCC8]" />
            <span>Nuevo Cobro (POS)</span>
          </button>
        </div>
      </div>

      {/* Error real del backend de ventas -- nunca se sustituye por datos demo/locales */}
      {salesError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudieron cargar las ventas reales para los KPIs: {salesError}</span>
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

      {/* Error real del backend de créditos -- nunca se sustituye por datos demo/locales */}
      {creditsError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>No se pudo cargar la cartera real de créditos para los KPIs: {creditsError}</span>
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

      {/* Actionable Alerts Bar */}
      {overdueCreditsCount > 0 || lowStockCount > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {overdueTotal > 0 && (
            <div
              onClick={() => onNavigate('credits', 'VENCIDA')}
              className="cursor-pointer p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between hover:bg-rose-100/70 transition shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-rose-200 text-rose-900 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold">Cuentas por Cobrar Vencidas</h4>
                  <p className="text-[11px] text-rose-700">
                    {overdueCreditsCount} cuenta(s) con morosidad: {formatCurrency(overdueTotal, settings.simboloMoneda)} • Clic para filtrar
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-rose-500" />
            </div>
          )}

          {lowStockCount > 0 && (
            <div
              onClick={() => onNavigate('inventory', 'STOCK_BAJO')}
              className="cursor-pointer p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between hover:bg-amber-100/70 transition shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold">Alerta de Stock Mínimo</h4>
                  <p className="text-[11px] text-amber-700">
                    {lowStockCount} prenda(s) con stock crítico • Clic para ver alertas
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-amber-500" />
            </div>
          )}
        </div>
      ) : null}

      {/* 10 CORE METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* 1. Ventas de Hoy */}
        <div
          onClick={() => onNavigate('sales')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Ventas Hoy</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">
              {salesLoading ? '...' : formatCurrency(salesToday, settings.simboloMoneda)}
            </h3>
            <span className="text-[10px] text-[#756E65]">Facturación del día</span>
          </div>
        </div>

        {/* 2. Ventas del Mes */}
        <div
          onClick={() => onNavigate('sales')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Ventas del Mes</span>
            <Calendar className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">
              {salesLoading ? '...' : formatCurrency(salesMonth, settings.simboloMoneda)}
            </h3>
            <span className="text-[10px] text-[#756E65]">Mes actual</span>
          </div>
        </div>

        {/* 3. Ganancia Estimada */}
        <div
          onClick={() => onNavigate('reports')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Ganancia Bruta</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-emerald-700">
              {salesLoading
                ? '...'
                : hasPermission('ventas.ver_ganancias')
                ? formatCurrency(grossProfitMonth, settings.simboloMoneda)
                : '******'}
            </h3>
            <span className="text-[10px] text-[#756E65]">Margen sobre costo</span>
          </div>
        </div>

        {/* 4. Cuentas por Cobrar (Deudas) */}
        <div
          onClick={() => onNavigate('credits', 'TODOS')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Por Cobrar</span>
            <CreditCard className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">
              {creditsLoading ? '...' : formatCurrency(totalReceivables, settings.simboloMoneda)}
            </h3>
            <span className="text-[10px] text-[#756E65]">Cartera de crédito activa</span>
          </div>
        </div>

        {/* 5. Deudas Vencidas */}
        <div
          onClick={() => onNavigate('credits', 'VENCIDA')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Vencidas</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-rose-700">
              {creditsLoading ? '...' : formatCurrency(overdueTotal, settings.simboloMoneda)}
            </h3>
            <span className="text-[10px] text-rose-600">{overdueCredits.length} cliente(s) en mora</span>
          </div>
        </div>

        {/* 6. Abonos del Mes */}
        <div
          onClick={() => onNavigate('installments')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Abonos Mes</span>
            <Coins className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">
              {creditsLoading ? '...' : formatCurrency(installmentsMonth, settings.simboloMoneda)}
            </h3>
            <span className="text-[10px] text-[#756E65]">Recuperación de cartera</span>
          </div>
        </div>

        {/* 7. Clientes */}
        <div
          onClick={() => onNavigate('customers')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Clientes</span>
            <Users className="w-4 h-4 text-[#756E65]" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">{customers.length}</h3>
            <span className="text-[10px] text-[#756E65]">Directorio activo</span>
          </div>
        </div>

        {/* 8. Productos */}
        <div
          onClick={() => onNavigate('products')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Prendas</span>
            <ShoppingBag className="w-4 h-4 text-[#756E65]" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">{products.length}</h3>
            <span className="text-[10px] text-[#756E65]">Estilos en catálogo</span>
          </div>
        </div>

        {/* 9. Stock Bajo */}
        <div
          onClick={() => onNavigate('inventory', 'STOCK_BAJO')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Stock Bajo</span>
            <Package className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-amber-700">{lowStockCount}</h3>
            <span className="text-[10px] text-amber-700">Requieren reorden</span>
          </div>
        </div>

        {/* 10. Caja Actual */}
        <div
          onClick={() => onNavigate('cash')}
          className="cursor-pointer p-4 rounded-2xl bg-white border border-[#E4DDD2] hover:border-[#2F2A25] transition flex flex-col justify-between shadow-2xs hover:shadow-sm"
        >
          <div className="flex items-center justify-between text-[#756E65]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Caja Actual</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg sm:text-xl font-bold text-[#2F2A25]">
              {activeCash ? formatCurrency(activeCash.efectivoEsperado, settings.simboloMoneda) : 'Cerrada'}
            </h3>
            <span className="text-[10px] text-[#756E65]">
              {activeCash ? 'Turno en curso' : 'Sin turno activo'}
            </span>
          </div>
        </div>
      </div>

      {/* MAIN CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales & Profit Trend Bar Visualizer (2 Columns) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs min-w-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#756E65]" />
              <h3 className="text-sm font-bold text-[#2F2A25]">Evolución de Ventas y Ganancia</h3>
            </div>
            {/* Period Selector Tabs */}
            <div className="flex bg-[#F6F1E8] border border-[#E4DDD2] p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setPeriod('7d')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  period === '7d' ? 'bg-[#2F2A25] text-[#FAF8F4]' : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                7 Días
              </button>
              <button
                type="button"
                onClick={() => setPeriod('30d')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  period === '30d' ? 'bg-[#2F2A25] text-[#FAF8F4]' : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                30 Días
              </button>
              <button
                type="button"
                onClick={() => setPeriod('ano')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  period === 'ano' ? 'bg-[#2F2A25] text-[#FAF8F4]' : 'text-[#756E65] hover:text-[#2F2A25]'
                }`}
              >
                Este Año
              </button>
            </div>
          </div>

          {/* Recharts responsive container */}
          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DDD2" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#756E65"
                  fontSize={period === '30d' ? 9 : 11}
                  interval={period === '30d' ? 2 : 0}
                  tickLine={false}
                  axisLine={{ stroke: '#E4DDD2' }}
                />
                <YAxis
                  stroke="#756E65"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val)}
                />
                <Tooltip
                  formatter={(value: any, name: any) => [
                    formatCurrency(Number(value) || 0, settings.simboloMoneda),
                    name,
                  ]}
                  contentStyle={{
                    backgroundColor: '#2F2A25',
                    borderColor: '#2F2A25',
                    borderRadius: '16px',
                    color: '#FAF8F4',
                    fontSize: '11px',
                    padding: '8px 12px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
                  }}
                  labelStyle={{ color: '#E8DCC8', fontWeight: 'bold', marginBottom: '4px' }}
                />
                <Bar
                  dataKey="ventas"
                  name="Ventas"
                  fill="#2F2A25"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={period === '30d' ? 14 : 32}
                />
                {hasPermission('ventas.ver_ganancias') && (
                  <Bar
                    dataKey="ganancia"
                    name="Ganancia Bruta"
                    fill="#C2410C"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={period === '30d' ? 14 : 32}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-xs text-[#756E65] pt-2 border-t border-[#E4DDD2]/60">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#2F2A25]" />
                Ventas
              </span>
              {hasPermission('ventas.ver_ganancias') && (
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#C2410C]" />
                  Ganancia Bruta
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-bold text-[#2F2A25] hover:underline"
            >
              Ver reporte detallado →
            </button>
          </div>
        </div>

        {/* Payment Methods Distribution */}
        <div className="bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#756E65]" />
              <h3 className="text-sm font-bold text-[#2F2A25]">Métodos de Pago</h3>
            </div>
            <span className="text-[10px] text-[#756E65] uppercase font-bold">Distribución</span>
          </div>

          <div className="space-y-3 my-auto">
            {paymentMethodsData.map((item) => (
              <div key={item.metodo} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-[#2F2A25]">
                  <span>{item.metodo}</span>
                  <span>
                    {formatCurrency(item.monto, settings.simboloMoneda)} ({item.porcentaje}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-[#F6F1E8] rounded-full overflow-hidden">
                  <div
                    style={{ width: `${item.porcentaje}%` }}
                    className={`h-full rounded-full transition-all ${
                      item.metodo === 'EFECTIVO'
                        ? 'bg-emerald-600'
                        : item.metodo === 'TARJETA'
                        ? 'bg-[#2F2A25]'
                        : item.metodo === 'TRANSFERENCIA'
                        ? 'bg-blue-600'
                        : 'bg-amber-600'
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 bg-[#FAF8F4] border border-[#E4DDD2] rounded-2xl text-[11px] text-[#756E65]">
            El <span className="font-bold text-[#2F2A25]">{paymentMethodsData[0]?.porcentaje || 0}%</span> de los ingresos se perciben vía{' '}
            {paymentMethodsData[0]?.metodo.toLowerCase() || 'efectivo'}.
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: Top Selling Clothes & Accounts Receivable Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 Products */}
        <div className="bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#2F2A25] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#C2410C]" />
              <span>Prendas Más Vendidas</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="text-xs font-bold text-[#756E65] hover:text-[#2F2A25]"
            >
              Ver catálogo →
            </button>
          </div>

          <div className="space-y-3">
            {topProducts.map((p, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-2xl bg-[#FAF8F4] border border-[#E4DDD2]/60 hover:border-[#2F2A25] transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[#E8DCC8] text-[#2F2A25] flex items-center justify-center font-bold text-xs shrink-0">
                    #{idx + 1}
                  </span>
                  {p.imagenUrl && (
                    <img
                      src={toDisplayableImageUrl(p.imagenUrl)}
                      alt={p.nombre}
                      className="w-10 h-10 rounded-xl object-cover border border-[#E4DDD2] shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <h5 className="text-xs font-bold text-[#2F2A25] truncate">{p.nombre}</h5>
                    <p className="text-[10px] text-[#756E65]">{p.cantidad} unidad(es) vendidas</p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <span className="text-xs font-bold text-[#2F2A25]">
                    {formatCurrency(p.total, settings.simboloMoneda)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Accounts Receivable Aging & Health */}
        <div className="bg-white p-5 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#2F2A25] flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#756E65]" />
              <span>Estado de Cuentas por Cobrar</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('credits')}
              className="text-xs font-bold text-[#756E65] hover:text-[#2F2A25]"
            >
              Gestionar →
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
              <span className="text-[10px] font-bold text-emerald-800 uppercase">Al Día</span>
              <p className="text-xs font-bold text-emerald-900 mt-1">
                {formatCurrency(receivablesAging.alDia, settings.simboloMoneda)}
              </p>
              <span className="text-[9px] text-emerald-700">{receivablesAging.pctAlDia}%</span>
            </div>

            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
              <span className="text-[10px] font-bold text-amber-800 uppercase">Por Vencer</span>
              <p className="text-xs font-bold text-amber-900 mt-1">
                {formatCurrency(receivablesAging.porVencer, settings.simboloMoneda)}
              </p>
              <span className="text-[9px] text-amber-700">{receivablesAging.pctPorVencer}%</span>
            </div>

            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200">
              <span className="text-[10px] font-bold text-rose-800 uppercase">Vencidas</span>
              <p className="text-xs font-bold text-rose-900 mt-1">
                {formatCurrency(receivablesAging.vencidas, settings.simboloMoneda)}
              </p>
              <span className="text-[9px] text-rose-700">{receivablesAging.pctVencidas}%</span>
            </div>
          </div>

          <div className="space-y-1.5 text-xs text-[#756E65]">
            <div className="flex justify-between">
              <span>Total en Cartera:</span>
              <span className="font-bold text-[#2F2A25]">
                {formatCurrency(receivablesAging.total, settings.simboloMoneda)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Abonos Recibidos Este Mes:</span>
              <span className="font-bold text-emerald-700">
                {formatCurrency(installmentsMonth, settings.simboloMoneda)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('installments')}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#FAF8F4] border border-[#E4DDD2] hover:bg-[#F6F1E8] text-[#2F2A25] transition"
          >
            Registrar Abono a Cuenta
          </button>
        </div>
      </div>
    </div>
  );
};
