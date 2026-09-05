import React, { useState, useMemo, useEffect } from 'react';
import { Customer } from '../../types';
import { customersApi, CustomerWithCredit } from '../../services/customersApi';
import { useAuth } from '../../context/AuthContext';
import { useDataStore } from '../../context/DataStoreContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import {
  Users,
  Search,
  Plus,
  Edit2,
  Trash2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Download,
  Eye,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

/**
 * FASE 3.6B (corrección de fuente de datos): Clientes vienen
 * EXCLUSIVAMENTE de customersApi (backend real, ver
 * CustomersController.gs). Sin fallback local, sin datos demo. El saldo
 * pendiente / crédito disponible que se muestra viene YA calculado por el
 * backend desde Creditos real (customers.list) -- no se recalcula aquí a
 * partir de datos locales.
 */
export const CustomersView: React.FC = () => {
  const { settings, hasPermission } = useAuth();
  const { showToast } = useToast();

  // CORREGIR AUDITORÍA: clientes ya no viven en un estado local propio de
  // esta vista -- se leen del DataStore central, la MISMA colección que
  // también consume POSView (selector de cliente) y que Créditos/Abonos
  // invalidan tras registrar/anular un abono (saldoPendiente/
  // creditoDisponible se recalculan server-side desde Creditos real).
  const {
    customers,
    customersLoading: loading,
    customersError: error,
    customersStale,
    refreshCustomers,
  } = useDataStore();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refreshCustomers();
  }, [refreshCustomers]);

  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<CustomerWithCredit | null>(null);

  // Form Fields
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [documento, setDocumento] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('Santo Domingo');
  const [limiteCredito, setLimiteCredito] = useState<number | string>(30000);
  const [diasCreditoPorDefecto, setDiasCreditoPorDefecto] = useState<number | string>(30);

  const filteredCustomers = useMemo(() => {
    return (customers || []).filter((c) => {
      if (!c) return false;
      const q = searchQuery.toLowerCase().trim();
      return (
        !q ||
        (c.nombre && c.nombre.toLowerCase().includes(q)) ||
        (c.apellido && c.apellido.toLowerCase().includes(q)) ||
        (c.documento && c.documento.toLowerCase().includes(q)) ||
        (c.telefono && c.telefono.toLowerCase().includes(q)) ||
        (c.correo && c.correo.toLowerCase().includes(q))
      );
    });
  }, [customers, searchQuery]);

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setNombre('');
    setApellido('');
    setDocumento('');
    setTelefono('');
    setCorreo('');
    setDireccion('');
    setCiudad('Santo Domingo');
    setLimiteCredito(30000);
    setDiasCreditoPorDefecto(30);
    setModalOpen(true);
  };

  const handleOpenEdit = (cust: Customer) => {
    setEditingCustomer(cust);
    setNombre(cust.nombre);
    setApellido(cust.apellido);
    setDocumento(cust.documento);
    setTelefono(cust.telefono);
    setCorreo(cust.correo);
    setDireccion(cust.direccion);
    setCiudad(cust.ciudad);
    setLimiteCredito(cust.limiteCredito);
    setDiasCreditoPorDefecto(cust.diasCreditoPorDefecto);
    setModalOpen(true);
  };

  // FASE 3.6B: contra customers.save real (CustomersController.gs). El
  // modal permanece abierto si falla, y se recarga la lista completa
  // desde el backend tras un éxito.
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      showToast('Nombre Requerido', 'Debe ingresar el nombre del cliente.', 'error');
      return;
    }
    if (!telefono.trim()) {
      showToast('Teléfono Requerido', 'Debe ingresar el teléfono del cliente.', 'error');
      return;
    }

    const numLimite = typeof limiteCredito === 'number' ? limiteCredito : parseFloat(limiteCredito);
    const numDias = typeof diasCreditoPorDefecto === 'number' ? diasCreditoPorDefecto : parseInt(diasCreditoPorDefecto, 10);

    const safeLimite = Number.isFinite(numLimite) && numLimite >= 0 ? numLimite : 0;
    const safeDias = Number.isFinite(numDias) && numDias >= 0 ? numDias : 30;

    setSaving(true);
    const res = await customersApi.save({
      id: editingCustomer ? editingCustomer.id : undefined,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      documento: documento.trim(),
      telefono: telefono.trim(),
      correo: correo.trim(),
      direccion: direccion.trim(),
      ciudad: ciudad.trim(),
      limiteCredito: safeLimite,
      diasCreditoPorDefecto: safeDias,
    });
    setSaving(false);

    if (!res.success) {
      showToast('Error al Guardar', res.message || 'No se pudo guardar el cliente en el backend.', 'error');
      return; // El modal permanece abierto para reintentar.
    }

    showToast(
      editingCustomer ? 'Cliente Actualizado' : 'Cliente Registrado',
      res.message || `${nombre} guardado exitosamente en Google Sheets.`,
      'exito'
    );
    setModalOpen(false);
    // CORREGIR AUDITORÍA: invalida el DataStore central -- el POS ve el
    // cliente nuevo/editado de inmediato, sin logout/login ni F5.
    await refreshCustomers({ force: true });
  };

  const handleExportCSV = () => {
    const rows = (filteredCustomers || []).map((c) => ({
      ID: c.id,
      Nombre: `${c.nombre} ${c.apellido}`,
      Documento: c.documento,
      Telefono: c.telefono,
      Correo: c.correo,
      Direccion: c.direccion,
      LimiteCredito: c.limiteCredito,
      DiasCredito: c.diasCreditoPorDefecto,
      Estado: c.estado,
    }));
    exportToCSV('Directorio_Clientes_ZIO', rows);
    showToast('Exportación Exitosa', 'Lista de clientes exportada en CSV.', 'exito');
  };

  return (
    <div id="customers-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Directorio & Perfiles de Clientes
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Clientes & Créditos ZIO
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => refreshCustomers({ force: true })}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-[#756E65] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Cargando...' : 'Recargar'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-[#756E65]" />
            <span>Exportar CSV</span>
          </button>

          {hasPermission('clientes.crear') && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Nuevo Cliente</span>
            </button>
          )}
        </div>
      </div>

      {/* FASE 3.6B: estado de error explícito con Retry -- nunca cae a
          datos demo/locales. */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-rose-800">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-bold text-xs">No se pudo cargar el directorio desde el backend</p>
              <p className="text-[11px]">{error}</p>
              {customersStale && (
                <p className="text-[11px] mt-1 font-semibold text-rose-900">
                  La tabla de abajo muestra la última información disponible -- no se pudo confirmar si sigue siendo la actual.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => refreshCustomers({ force: true })}
            className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4DDD2] flex items-center justify-between shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#756E65] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nombre, cédula, teléfono o correo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25]"
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-3xl border border-[#E4DDD2] overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F6F1E8] text-[#2F2A25] border-b border-[#E4DDD2] uppercase text-[10px] tracking-wider font-bold">
              <tr>
                <th className="py-3 px-4">Cliente</th>
                <th className="py-3 px-4">Cédula / RNC</th>
                <th className="py-3 px-4">Contacto</th>
                <th className="py-3 px-4 text-right">Límite Crédito</th>
                <th className="py-3 px-4 text-right">Deuda Actual</th>
                <th className="py-3 px-4 text-center">Estado Deuda</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4DDD2]/60">
              {(filteredCustomers || []).map((cust) => {
                // FASE 3.6B: saldoPendiente ya viene calculado por el
                // backend (customers.list, agregado real desde Creditos)
                // -- no se recalcula a partir de datos locales. El estado
                // "vencida" por cuenta individual requeriría credits.list
                // (fuera de alcance de esta corrección), así que el badge
                // se simplifica a dos estados honestos: con o sin deuda.
                const currentDebt = cust.saldoPendiente;

                return (
                  <tr key={cust.id} className="hover:bg-[#FAF8F4]/80 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-[#2F2A25]">
                        {cust.nombre} {cust.apellido}
                      </div>
                      <div className="text-[10px] text-[#756E65]">{cust.id}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[#756E65]">{cust.documento}</td>
                    <td className="py-3.5 px-4 space-y-0.5">
                      <div className="text-[#2F2A25] font-medium">{cust.telefono}</div>
                      <div className="text-[10px] text-[#756E65]">{cust.correo}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-[#756E65]">
                      {formatCurrency(cust.limiteCredito, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-[#2F2A25]">
                      {formatCurrency(currentDebt, settings.simboloMoneda)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                          currentDebt === 0
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-900 border-amber-200'
                        }`}
                      >
                        {currentDebt === 0 ? 'Al Día (Sin Deuda)' : 'Con Crédito Activo'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setViewingCustomer(cust)}
                          className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                          title="Ver Perfil"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {hasPermission('clientes.editar') && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(cust)}
                            className="p-1.5 rounded-lg text-[#756E65] hover:text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                            title="Editar"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {loading && customers.length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <RefreshCw className="w-8 h-8 opacity-40 mx-auto animate-spin" />
              <p className="font-semibold text-xs text-[#2F2A25]">Cargando directorio desde Google Sheets...</p>
            </div>
          )}

          {/* FASE 3.6B: estado vacío honesto -- nunca se rellena con datos
              demo si el backend devuelve []. */}
          {!loading && !error && (filteredCustomers || []).length === 0 && (
            <div className="text-center py-12 text-[#756E65] space-y-2">
              <Users className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-semibold text-xs text-[#2F2A25]">
                {customers.length === 0
                  ? 'El directorio de clientes está vacío en Google Sheets'
                  : 'No se encontraron clientes con ese filtro'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CREATE / EDIT CUSTOMER MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <h3 className="text-sm font-bold text-[#2F2A25]">
                {editingCustomer ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} noValidate className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Nombre:</label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej. Juan"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Apellido:</label>
                  <input
                    type="text"
                    value={apellido}
                    onChange={(e) => setApellido(e.target.value)}
                    placeholder="Ej. Pérez"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Cédula / RNC:</label>
                  <input
                    type="text"
                    value={documento}
                    onChange={(e) => setDocumento(e.target.value)}
                    placeholder="402-XXXXXXX-X"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Teléfono / WhatsApp:</label>
                  <input
                    type="text"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="809-XXX-XXXX"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-[#2F2A25] mb-1">Correo Electrónico:</label>
                  <input
                    type="email"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-[#2F2A25] mb-1">Dirección de Entrega:</label>
                  <input
                    type="text"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    placeholder="Calle, Sector, Número..."
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Límite de Crédito (RD$):</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={limiteCredito === '' ? '' : limiteCredito}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setLimiteCredito('');
                      else {
                        const num = parseFloat(val);
                        setLimiteCredito(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1">Plazo de Pago (Días):</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="30"
                    value={diasCreditoPorDefecto === '' ? '' : diasCreditoPorDefecto}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') setDiasCreditoPorDefecto('');
                      else {
                        const num = parseInt(val, 10);
                        setDiasCreditoPorDefecto(isNaN(num) ? '' : val);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 rounded-xl bg-[#2F2A25] text-xs font-bold text-white shadow-md hover:bg-[#403932] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? 'Guardando...' : 'Guardar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW CUSTOMER PROFILE DRAWER */}
      {viewingCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#E4DDD2] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#2F2A25]">
                  {viewingCustomer.nombre} {viewingCustomer.apellido}
                </h3>
                <span className="text-[11px] text-[#756E65]">ID: {viewingCustomer.id}</span>
              </div>
              <button type="button" onClick={() => setViewingCustomer(null)} className="text-[#756E65] p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2] space-y-1">
                <p>
                  <span className="text-[#756E65]">Cédula/RNC:</span>{' '}
                  <span className="font-bold text-[#2F2A25]">{viewingCustomer.documento}</span>
                </p>
                <p>
                  <span className="text-[#756E65]">Teléfono:</span>{' '}
                  <span className="font-bold text-[#2F2A25]">{viewingCustomer.telefono}</span>
                </p>
                <p>
                  <span className="text-[#756E65]">Correo:</span>{' '}
                  <span className="font-medium text-[#2F2A25]">{viewingCustomer.correo}</span>
                </p>
                <p>
                  <span className="text-[#756E65]">Dirección:</span>{' '}
                  <span className="font-medium text-[#2F2A25]">{viewingCustomer.direccion}, {viewingCustomer.ciudad}</span>
                </p>
              </div>

              {/* FASE 3.6B: resumen de crédito real (customers.list ya lo
                  calcula desde Creditos en el backend). El detalle por
                  cuenta individual (número, vencimiento, estado) requiere
                  credits.list, fuera de alcance de esta corrección -- no
                  se muestra una lista inventada. */}
              <div className="p-3.5 bg-white rounded-2xl border border-[#E4DDD2] space-y-1.5">
                <h5 className="font-bold text-[#2F2A25] uppercase text-[10px] mb-1">
                  Resumen de Crédito (Google Sheets):
                </h5>
                <p className="flex justify-between">
                  <span className="text-[#756E65]">Límite de Crédito:</span>
                  <span className="font-bold text-[#2F2A25]">
                    {formatCurrency(viewingCustomer.limiteCredito, settings.simboloMoneda)}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[#756E65]">Saldo Pendiente:</span>
                  <span className="font-bold text-[#2F2A25]">
                    {formatCurrency(viewingCustomer.saldoPendiente, settings.simboloMoneda)}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span className="text-[#756E65]">Crédito Disponible:</span>
                  <span className="font-bold text-emerald-800">
                    {formatCurrency(viewingCustomer.creditoDisponible, settings.simboloMoneda)}
                  </span>
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setViewingCustomer(null)}
                className="w-full py-2.5 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#756E65]"
              >
                Cerrar Perfil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
