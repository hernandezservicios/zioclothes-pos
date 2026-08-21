import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { SystemSettings, UserRole, User } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import {
  Settings as SettingsIcon,
  Store,
  Users,
  Shield,
  FileSpreadsheet,
  Database,
  History,
  Save,
  RefreshCw,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, currentUser, hasPermission } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'GENERAL' | 'USUARIOS' | 'SHEETS' | 'BACKUP' | 'AUDITORIA'>('GENERAL');

  // General Settings Form
  const [formSettings, setFormSettings] = useState<SystemSettings>({ ...settings });

  // Users State
  const [users, setUsers] = useState<User[]>(() => storageService.getUsers() || []);
  const [newUserModal, setNewUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('123456');
  const [newNombre, setNewNombre] = useState('');
  const [newApellido, setNewApellido] = useState('');
  const [newRol, setNewRol] = useState<UserRole>('CAJERO');

  // Audit Logs
  const auditLogs = storageService.getAuditLogs() || [];

  // Syncing state
  const [syncing, setSyncing] = useState(false);

  // Save General Settings
  const handleSaveGeneral = (e: React.FormEvent) => {
    e.preventDefault();
    const tax = Number(formSettings.impuestoPorcentaje);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      showToast('Impuesto Inválido', 'El ITBIS debe ser un porcentaje válido entre 0% y 100%.', 'error');
      return;
    }
    updateSettings({
      ...formSettings,
      impuestoPorcentaje: tax,
    });
    showToast('Configuración Guardada', 'Los datos del negocio han sido actualizados.', 'exito');
  };

  // Add User
  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newNombre.trim()) {
      showToast('Campos Requeridos', 'Complete todos los campos obligatorios.', 'error');
      return;
    }

    const newUser: User = {
      id: `USR-${Date.now()}`,
      usuario: newUsername.trim().toLowerCase(),
      username: newUsername.trim().toLowerCase(),
      nombre: newNombre.trim(),
      apellido: newApellido.trim(),
      correo: `${newUsername.trim().toLowerCase()}@zioclothes.com`,
      telefono: '809-555-0100',
      rol: newRol,
      estado: 'ACTIVO',
      activo: true,
      fechaCreacion: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };

    const updated = [...users, newUser];
    storageService.saveUsers(updated);
    setUsers(updated);
    setNewUserModal(false);
    showToast('Usuario Creado', `Usuario ${newUser.usuario} añadido con rol ${newUser.rol}.`, 'exito');
  };

  // Trigger Google Sheets Sync
  const handleTriggerSync = async () => {
    setSyncing(true);
    const res = await apiService.syncWithGoogleAppsScript('FULL_SYNC', {
      source: 'Settings Manual Trigger',
    });
    setSyncing(false);

    if (res.success) {
      showToast('Sincronización Exitosa', res.message, 'exito');
    } else {
      showToast('Aviso de Sincronización', res.message, 'advertencia');
    }
  };

  // Export JSON Database
  const handleExportBackup = () => {
    const data = storageService.exportFullDatabaseJSON();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ZIO_CLOTHES_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Copia de Seguridad', 'Base de datos exportada en formato JSON.', 'exito');
  };

  // Reset to Demo Data
  const handleResetData = () => {
    if (window.confirm('¿Está seguro de restablecer todos los datos a la demostración inicial de ZIO CLOTHES? Esta acción no se puede deshacer.')) {
      storageService.resetToInitialDemo();
      window.location.reload();
    }
  };

  return (
    <div id="settings-view" className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4DDD2]">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Panel de Control & Mantenimiento
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#2F2A25]">
            Configuración del Sistema
          </h1>
        </div>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-white border border-[#E4DDD2] rounded-2xl">
        <button
          type="button"
          onClick={() => setActiveTab('GENERAL')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'GENERAL'
              ? 'bg-[#2F2A25] text-white shadow-xs'
              : 'text-[#756E65] hover:bg-[#FAF8F4]'
          }`}
        >
          <Store className="w-4 h-4" />
          <span>Negocio & Ticket</span>
        </button>

        {hasPermission('usuarios.gestionar') && (
          <button
            type="button"
            onClick={() => setActiveTab('USUARIOS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'USUARIOS'
                ? 'bg-[#2F2A25] text-white shadow-xs'
                : 'text-[#756E65] hover:bg-[#FAF8F4]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Usuarios & Roles</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('SHEETS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'SHEETS'
              ? 'bg-[#2F2A25] text-white shadow-xs'
              : 'text-[#756E65] hover:bg-[#FAF8F4]'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          <span>Google Sheets Sync</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('BACKUP')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'BACKUP'
              ? 'bg-[#2F2A25] text-white shadow-xs'
              : 'text-[#756E65] hover:bg-[#FAF8F4]'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Copia de Seguridad</span>
        </button>

        {hasPermission('auditoria.ver') && (
          <button
            type="button"
            onClick={() => setActiveTab('AUDITORIA')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'AUDITORIA'
                ? 'bg-[#2F2A25] text-white shadow-xs'
                : 'text-[#756E65] hover:bg-[#FAF8F4]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Auditoría</span>
          </button>
        )}
      </div>

      {/* TAB 1: GENERAL SETTINGS */}
      {activeTab === 'GENERAL' && (
        <form onSubmit={handleSaveGeneral} noValidate className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div>
            <h3 className="font-serif font-bold text-base text-[#2F2A25]">Identidad de la Boutique & Facturación</h3>
            <p className="text-xs text-[#756E65]">Datos que se imprimen en recibos térmicos y estados de cuenta.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">Nombre Comercial:</label>
              <input
                type="text"
                value={formSettings.nombreNegocio}
                onChange={(e) => setFormSettings({ ...formSettings, nombreNegocio: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-medium"
              />
            </div>

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">RNC / Cédula Fiscal:</label>
              <input
                type="text"
                value={formSettings.rnc}
                onChange={(e) => setFormSettings({ ...formSettings, rnc: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">Teléfono / WhatsApp:</label>
              <input
                type="text"
                value={formSettings.telefono}
                onChange={(e) => setFormSettings({ ...formSettings, telefono: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
              />
            </div>

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">Dirección del Local:</label>
              <input
                type="text"
                value={formSettings.direccion}
                onChange={(e) => setFormSettings({ ...formSettings, direccion: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
              />
            </div>

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">Símbolo de Moneda:</label>
              <input
                type="text"
                value={formSettings.simboloMoneda}
                onChange={(e) => setFormSettings({ ...formSettings, simboloMoneda: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
              />
            </div>

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">Tasa de Impuesto / ITBIS (%):</label>
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                inputMode="decimal"
                value={formSettings.impuestoPorcentaje === undefined ? '' : formSettings.impuestoPorcentaje}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setFormSettings({ ...formSettings, impuestoPorcentaje: 0 });
                  } else {
                    const num = parseFloat(val);
                    setFormSettings({ ...formSettings, impuestoPorcentaje: isNaN(num) ? 0 : num });
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="block font-bold text-[#2F2A25] mb-1">Mensaje al Pie del Recibo:</label>
              <input
                type="text"
                value={formSettings.mensajePieFactura}
                onChange={(e) => setFormSettings({ ...formSettings, mensajePieFactura: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#E4DDD2] flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs"
            >
              <Save className="w-4 h-4 text-[#E8DCC8]" />
              <span>Guardar Cambios</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: USERS & ROLES */}
      {activeTab === 'USUARIOS' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Cuentas de Usuarios & Roles</h3>
              <p className="text-xs text-[#756E65]">Control de acceso por cajero, supervisor y administrador.</p>
            </div>
            <button
              type="button"
              onClick={() => setNewUserModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932]"
            >
              <Plus className="w-4 h-4 text-[#E8DCC8]" />
              <span>Nuevo Usuario</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-4">Usuario</th>
                  <th className="py-2.5 px-4">Nombre Completo</th>
                  <th className="py-2.5 px-4">Rol Asignado</th>
                  <th className="py-2.5 px-4 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(users || []).map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-mono font-bold text-[#2F2A25]">@{u.username}</td>
                    <td className="py-3 px-4">{u.nombre} {u.apellido}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[10px] font-bold text-[#2F2A25]">
                        {u.rol}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-[10px] font-bold text-emerald-700">ACTIVO</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {newUserModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
              <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
                <h3 className="text-sm font-bold text-[#2F2A25] border-b border-[#E4DDD2] pb-2">Crear Empleado / Usuario</h3>
                <form onSubmit={handleAddUser} noValidate className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Nombre de Usuario (@):</label>
                    <input
                      type="text"
                      required
                      placeholder="ej. maria.vendedor"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Nombre:</label>
                      <input
                        type="text"
                        required
                        value={newNombre}
                        onChange={(e) => setNewNombre(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Apellido:</label>
                      <input
                        type="text"
                        value={newApellido}
                        onChange={(e) => setNewApellido(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Rol / Permisos:</label>
                    <select
                      value={newRol}
                      onChange={(e) => setNewRol(e.target.value as UserRole)}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                    >
                      <option value="CAJERO">Cajero / Vendedor (POS, Ventas, Clientes)</option>
                      <option value="ENCARGADO">Encargado de Tienda (Inventario, Caja, Abonos)</option>
                      <option value="ADMIN">Administrador General (Acceso Total & Costos)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Contraseña:</label>
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-mono"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setNewUserModal(false)}
                      className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md"
                    >
                      Crear Usuario
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: GOOGLE SHEETS SYNC */}
      {activeTab === 'SHEETS' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Integración con Google Sheets</h3>
              <p className="text-xs text-[#756E65]">
                Sincronización en tiempo real de ventas, inventario, clientes y abonos a tu hoja de cálculo.
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#FAF8F4] rounded-2xl border border-[#E4DDD2] space-y-3 text-xs">
            <p className="text-[#2F2A25] leading-relaxed">
              El sistema ZIO CLOTHES está preparado para sincronizar automáticamente cada venta, entrada de inventario y abono a Google Sheets a través del Webhook de Google Apps Script.
            </p>
            <div>
              <label className="block font-bold text-[#2F2A25] mb-1">URL de Webhook (Google Apps Script):</label>
              <input
                type="text"
                placeholder="https://script.google.com/macros/s/.../exec"
                value={formSettings.googleAppsScriptUrl || ''}
                onChange={(e) => {
                  const updated = { ...formSettings, googleAppsScriptUrl: e.target.value };
                  setFormSettings(updated);
                  updateSettings(updated);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
            <div>
              <span className="text-[11px] font-bold uppercase text-emerald-900">Estado de la Sincronización</span>
              <p className="text-xs text-emerald-800 mt-0.5">
                {formSettings.googleAppsScriptUrl
                  ? 'Webhook configurado listo para enviar transacciones.'
                  : 'Listo para conectar con Google Sheets.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={syncing}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-bold hover:bg-emerald-900 transition shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Sincronizando...' : 'Sincronizar Ahora'}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: BACKUP & RESTORE */}
      {activeTab === 'BACKUP' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div>
            <h3 className="font-serif font-bold text-base text-[#2F2A25]">Copia de Seguridad & Restauración</h3>
            <p className="text-xs text-[#756E65]">Descargue toda la base de datos o restaure los datos de muestra.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-[#E4DDD2] bg-[#FAF8F4] space-y-3">
              <h4 className="font-bold text-xs text-[#2F2A25]">Exportar Copia de Seguridad JSON</h4>
              <p className="text-xs text-[#756E65]">
                Guarde un archivo seguro con todos los productos, ventas, clientes, créditos y sesiones de caja.
              </p>
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932]"
              >
                <Download className="w-4 h-4 text-[#E8DCC8]" />
                <span>Descargar Backup JSON</span>
              </button>
            </div>

            <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 space-y-3">
              <h4 className="font-bold text-xs text-rose-900">Restablecer Datos de Demostración</h4>
              <p className="text-xs text-rose-800">
                Reinicia el catálogo y clientes a las colecciones iniciales de ZIO CLOTHES.
              </p>
              <button
                type="button"
                onClick={handleResetData}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-700 text-white text-xs font-bold hover:bg-rose-800"
              >
                <Trash2 className="w-4 h-4" />
                <span>Restablecer Datos</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {activeTab === 'AUDITORIA' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-4 shadow-xs">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Registro de Auditoría</h3>
              <p className="text-xs text-[#756E65]">Historial de todas las acciones sensibles realizadas en el sistema.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-4">Fecha y Hora</th>
                  <th className="py-2.5 px-4">Acción</th>
                  <th className="py-2.5 px-4">Módulo</th>
                  <th className="py-2.5 px-4">Detalle</th>
                  <th className="py-2.5 px-4">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(auditLogs || []).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 text-[#756E65]">{formatDateTime(log.fecha)}</td>
                    <td className="py-2.5 px-4 font-bold text-[#2F2A25]">{log.accion}</td>
                    <td className="py-2.5 px-4 font-semibold text-[#756E65]">{log.modulo}</td>
                    <td className="py-2.5 px-4 text-[#2F2A25]">{log.detalle || log.descripcion}</td>
                    <td className="py-2.5 px-4 font-medium text-[#756E65]">{log.usuarioNombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
