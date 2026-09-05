import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { storageService } from '../../services/storageService';
import { authApi } from '../../services/authApi';
import { settingsApi } from '../../services/settingsApi';
import { SystemSettings, UserRole, User } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { exportToCSV } from '../../utils/exportUtils';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
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
  const { settings, updateSettings, currentUser, hasPermission, refreshCatalog } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'GENERAL' | 'USUARIOS' | 'SHEETS' | 'BACKUP' | 'AUDITORIA'>('GENERAL');

  // FASE 3.7H: configuración empresarial real vía settingsApi.get()
  // (SettingsController.handleGetSettings -> hoja Configuracion real).
  // `settings` de AuthContext (poblado en login/bootstrap) se usa solo
  // como valor inicial para no mostrar campos vacíos mientras se confirma
  // la lectura fresca -- pero SIEMPRE se sobreescribe con la respuesta
  // real al abrir esta pantalla, tal como exige esta fase ("Al abrir
  // SettingsView: obtener configuración desde backend").
  const [formSettings, setFormSettings] = useState<SystemSettings>({ ...settings });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // FASE 3 (logo de empresa -- reutiliza Google Drive de productos): mismo
  // patrón que ProductFormModal con fotos de productos. `formSettings.logoUrl`
  // hace doble función -- Base64 de previsualización mientras se elige un
  // archivo nuevo, o la URL real ya guardada; `selectedLogoFile` solo se
  // activa cuando el usuario elige/cambia un logo EN ESTA sesión del
  // formulario, y es lo único que decide si hace falta subir un logo nuevo
  // a Drive antes de guardar la configuración.
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const fetchBusinessSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsLoadError(null);
    const res = await settingsApi.get();
    if (res.success) {
      setFormSettings((prev) => ({ ...prev, ...res.data }));
    } else {
      setSettingsLoadError(res.message || 'No se pudo obtener la configuración real desde el backend.');
    }
    setSettingsLoading(false);
  }, []);

  useEffect(() => {
    fetchBusinessSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FASE 3.6D (Parte 3): la URL del Web App ya NO vive en formSettings/
  // zio_settings -- vive en zio_infrastructure_config, separada de la
  // configuración comercial, para que limpiar el caché de negocio nunca
  // la destruya.
  const [googleAppsScriptUrl, setGoogleAppsScriptUrlState] = useState<string>(() =>
    storageService.getGoogleAppsScriptUrl()
  );

  // FASE 3.7G: usuarios administrativos reales vía auth.listUsers/
  // auth.saveUser (AuthController.gs). Antes storageService.getUsers()/
  // saveUsers() eran 100% locales -- un "usuario" creado aquí nunca podía
  // iniciar sesión de verdad (AuthContext ya validaba solo contra el
  // backend real desde antes de esta fase), y la lista mostrada no tenía
  // relación alguna con los usuarios reales de Sheets. El backend NUNCA
  // devuelve contraseñas ni hashes -- este estado tampoco los guarda
  // jamás.
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    const res = await authApi.listUsers();
    if (res.success) {
      setUsers(res.data || []);
    } else {
      setUsersError(res.message || 'No se pudo obtener la lista real de usuarios.');
    }
    setUsersLoading(false);
  }, []);

  useEffect(() => {
    if (hasPermission('admin.usuarios')) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNombre, setNewNombre] = useState('');
  const [newApellido, setNewApellido] = useState('');
  const [newCorreo, setNewCorreo] = useState('');
  const [newTelefono, setNewTelefono] = useState('');
  const [newRol, setNewRol] = useState<UserRole>('CAJERO');
  const [newEstado, setNewEstado] = useState<'ACTIVO' | 'INACTIVO' | 'BLOQUEADO'>('ACTIVO');
  const [savingUser, setSavingUser] = useState(false);

  // Únicamente los 5 roles reales definidos en SeedSetup.gs -- el
  // selector anterior ofrecía 'ENCARGADO', un rol que nunca existió en el
  // backend (asignado solo mediante un cast de TypeScript que ocultaba el
  // problema en tiempo de compilación).
  const REAL_ROLES: { value: UserRole; label: string }[] = [
    { value: 'CAJERO', label: 'Cajero / POS (Ventas, Clientes, Abonos)' },
    { value: 'VENDEDOR', label: 'Asesor de Ventas (Catálogo, Ventas)' },
    { value: 'SUPERVISOR', label: 'Supervisor de Turno (Caja, Inventario, Descuentos)' },
    { value: 'GERENTE', label: 'Gerente de Tienda (Reportes, Anulaciones)' },
    { value: 'ADMIN', label: 'Administrador General (Acceso Total)' },
  ];

  const handleOpenCreateUser = () => {
    setEditingUserId(null);
    setNewUsername('');
    setNewPassword('');
    setNewNombre('');
    setNewApellido('');
    setNewCorreo('');
    setNewTelefono('');
    setNewRol('CAJERO');
    setNewEstado('ACTIVO');
    setUserModalOpen(true);
  };

  const handleOpenEditUser = (u: User) => {
    setEditingUserId(u.id);
    setNewUsername(u.usuario);
    setNewPassword('');
    setNewNombre(u.nombre);
    setNewApellido(u.apellido || '');
    setNewCorreo(u.correo || '');
    setNewTelefono(u.telefono || '');
    setNewRol(u.rol);
    setNewEstado((u.estado as 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO') || 'ACTIVO');
    setUserModalOpen(true);
  };

  // Audit Logs
  const auditLogs = storageService.getAuditLogs() || [];

  // Syncing state
  const [syncing, setSyncing] = useState(false);

  // Save General Settings
  // FASE 3.7H: ahora async y real -- espera la confirmación del backend
  // (vía AuthContext.updateSettings -> settingsApi.save ->
  // system.updateSettings) antes de mostrar éxito. Sin actualización
  // optimista: si el backend rechaza, el toast de error ya lo muestra
  // updateSettings y esta función simplemente no hace nada más.
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSettings) return; // previene doble submit
    const tax = Number(formSettings.impuestoPorcentaje);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      showToast('Impuesto Inválido', 'El ITBIS debe ser un porcentaje válido entre 0% y 100%.', 'error');
      return;
    }

    setSavingSettings(true);

    // FASE 3 (logo de empresa -- reutiliza Drive de productos): si el
    // usuario seleccionó un logo nuevo en esta sesión del formulario, se
    // sube primero a Drive (mismo flujo que ProductFormModal con fotos de
    // productos) y se sustituye el Base64 temporal por la URL real ANTES
    // de guardar la configuración. Nunca se envía Base64 a
    // system.updateSettings. Si el usuario no tocó el logo,
    // `formSettings.logoUrl` ya contiene lo correcto tal cual (la URL real
    // existente, o '' si nunca hubo/se eliminó) y se envía directamente.
    let finalLogoUrl = (formSettings.logoUrl || '').trim();

    if (selectedLogoFile) {
      setUploadingLogo(true);
      const uploadRes = await settingsApi.uploadLogo(finalLogoUrl);
      setUploadingLogo(false);

      if (!uploadRes.success || !uploadRes.data) {
        showToast('Error al Subir Logo', uploadRes.message || 'No se pudo subir el logo a Google Drive.', 'error');
        setSavingSettings(false);
        return; // el formulario permanece abierto para reintentar -- no se guarda con Base64 ni con una URL inventada.
      }

      finalLogoUrl = uploadRes.data.imageUrl;
    }

    const success = await updateSettings({
      ...formSettings,
      impuestoPorcentaje: tax,
      logoUrl: finalLogoUrl,
    });

    if (success) {
      setSelectedLogoFile(null);
      setFormSettings((prev) => ({ ...prev, logoUrl: finalLogoUrl }));
    }
    setSavingSettings(false);
  };

  // FASE 3 (logo de empresa): mismo mecanismo de selección/previsualización
  // ya usado en ProductFormModal para fotos de productos.
  const handleLogoFileSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('Formato Inválido', 'El archivo seleccionado no es una imagen válida (formatos soportados: JPG, PNG, WEBP).', 'error');
      return;
    }

    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE_BYTES) {
      showToast('Archivo Demasiado Grande', `El logo supera el tamaño máximo permitido de 10MB (${(file.size / (1024 * 1024)).toFixed(1)}MB).`, 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setFormSettings((prev) => ({ ...prev, logoUrl: event.target!.result as string }));
        setSelectedLogoFile(file);
      }
    };
    reader.onerror = () => {
      showToast('Error de Carga', 'No se pudo leer la imagen seleccionada.', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleLogoFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLogoFileSelected(file);
    e.target.value = '';
  };

  // "Usar logo del sistema": deja el campo vacío -- se confirma recién al
  // pulsar "Guardar Cambios" (igual que el resto de este formulario), y es
  // entonces cuando el backend intenta limpiar el logo anterior en Drive.
  const handleRemoveLogo = () => {
    setFormSettings((prev) => ({ ...prev, logoUrl: '' }));
    setSelectedLogoFile(null);
    if (logoFileInputRef.current) logoFileInputRef.current.value = '';
  };

  // FASE 3.7G: crea/edita un usuario real vía auth.saveUser
  // (AuthController.handleSaveUser). Nunca se construye ni se guarda
  // localmente un usuario -- solo se refleja lo que el backend confirmó,
  // recargando la lista real. La contraseña nunca se persiste en
  // storageService/localStorage; solo vive en el estado del formulario
  // mientras el modal está abierto y se descarta al cerrarlo.
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingUser) return; // previene doble submit
    if (!newUsername.trim() || !newNombre.trim()) {
      showToast('Campos Requeridos', 'Usuario y nombre son obligatorios.', 'error');
      return;
    }
    // Contraseña obligatoria solo al crear -- al editar, un campo vacío
    // significa "no cambiar la contraseña actual" (semántica ya
    // soportada explícitamente por el backend real).
    if (!editingUserId && !newPassword.trim()) {
      showToast('Contraseña Requerida', 'Debe asignar una contraseña inicial para el nuevo usuario.', 'error');
      return;
    }

    setSavingUser(true);

    const res = await authApi.saveUser({
      id: editingUserId || undefined,
      usuario: newUsername.trim().toLowerCase(),
      nombre: newNombre.trim(),
      apellido: newApellido.trim() || undefined,
      correo: newCorreo.trim() || undefined,
      telefono: newTelefono.trim() || undefined,
      rol: newRol,
      estado: newEstado,
      password: newPassword.trim() || undefined,
    });

    setSavingUser(false);

    if (res.success) {
      showToast(editingUserId ? 'Usuario Actualizado' : 'Usuario Creado', res.message, 'exito');
      setUserModalOpen(false);
      await fetchUsers();
    } else {
      showToast('Error', res.message, 'error');
      // No se agrega ni modifica ningún usuario en la lista mostrada --
      // sigue siendo la última confirmada por el backend.
    }
  };

  // FASE 3.6 (corrección de bloqueante — Parte 9): "FULL_SYNC" no existe
  // como acción en Main.gs (verificado en el backend real) -- este botón
  // llamaba a un endpoint inventado que siempre fallaría. Se repunta al
  // mecanismo real de sincronización que ya existe (system.getBootstrapData,
  // vía refreshCatalog en AuthContext), en vez de inventar un endpoint.
  const handleTriggerSync = async () => {
    setSyncing(true);
    const ok = await refreshCatalog();
    setSyncing(false);

    if (ok) {
      showToast('Sincronización Exitosa', 'Catálogo (productos, clientes, configuración) actualizado desde Google Sheets.', 'exito');
    } else {
      showToast(
        'Aviso de Sincronización',
        'No se pudo sincronizar. Verifique la URL del Web App y que haya una sesión iniciada.',
        'advertencia'
      );
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

  // FASE 3.6B: ya NO restaura un catálogo/directorio de demostración --
  // storageService.initialize() dejó de sembrar productos/clientes/etc.
  // demo (ver storageService.ts). Ahora solo limpia el caché local
  // (sesión, catálogo cacheado, estado de trabajo del POS) y reaplica los
  // valores de configuración/permisos por defecto; el catálogo real se
  // vuelve a traer del backend en el siguiente login/sincronización.
  const handleResetData = () => {
    if (
      window.confirm(
        'Esto borrará el caché local (sesión, catálogo cacheado, carrito) y restablecerá la configuración a sus valores por defecto. La URL de conexión con Google Sheets NO se borra. El catálogo real se volverá a descargar al iniciar sesión de nuevo. ¿Continuar?'
      )
    ) {
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

        {/* FASE 3.7G: corregido -- el backend real exige 'admin.usuarios'
            (AuthController.handleListUsers/handleSaveUser vía
            Security.requirePermission), no 'usuarios.gestionar', que
            nunca existió en ningún rol real del seed (ver SeedSetup.gs).
            Antes de este fix, esta pestaña era inalcanzable para
            cualquier rol que no sea ADMIN (que ya tiene un bypass total
            en AuthContext.hasPermission independiente del código exacto
            del permiso). */}
        {hasPermission('admin.usuarios') && (
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
        <div className="space-y-4">
          {settingsLoadError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>No se pudo cargar la configuración real desde el backend: {settingsLoadError}</span>
              </div>
              <button type="button" onClick={() => fetchBusinessSettings()} className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0">
                Reintentar
              </button>
            </div>
          )}

          <form onSubmit={handleSaveGeneral} noValidate className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-serif font-bold text-base text-[#2F2A25]">Identidad de la Boutique & Facturación</h3>
                <p className="text-xs text-[#756E65]">Datos que se imprimen en recibos térmicos y estados de cuenta.</p>
              </div>
              <button
                type="button"
                onClick={() => fetchBusinessSettings()}
                disabled={settingsLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] disabled:opacity-50"
                title="Volver a consultar el backend real"
              >
                <RefreshCw className={`w-4 h-4 text-[#756E65] ${settingsLoading ? 'animate-spin' : ''}`} />
                <span>{settingsLoading ? 'Cargando...' : 'Actualizar'}</span>
              </button>
            </div>

            <fieldset disabled={settingsLoading || savingSettings} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs disabled:opacity-60">
              {/* FASE 3 (logo de empresa -- Google Drive, misma carpeta
                  administrada que las fotos de productos): reemplazo
                  seguro con limpieza automática del logo anterior tras un
                  guardado exitoso (ver SettingsController.handleUpdateSettings). */}
              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Logo de la Empresa:</label>
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg"
                  onChange={handleLogoFileInputChange}
                  className="hidden"
                  id="company-logo-input"
                />
                <div className="flex items-center gap-4 p-3 rounded-2xl border border-[#E4DDD2] bg-[#FAF8F4]">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden border border-[#E4DDD2] bg-white flex items-center justify-center shrink-0">
                    {formSettings.logoUrl ? (
                      <img
                        src={toDisplayableImageUrl(formSettings.logoUrl)}
                        alt="Logo actual de la empresa"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="font-serif font-bold text-xl text-[#2F2A25]">Z</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => logoFileInputRef.current?.click()}
                        disabled={uploadingLogo}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-[#2F2A25] font-bold text-[11px] hover:bg-[#F6F1E8] transition disabled:opacity-50"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#756E65]" />
                        <span>{formSettings.logoUrl ? 'Cambiar Logo' : 'Seleccionar Imagen'}</span>
                      </button>
                      {formSettings.logoUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          disabled={uploadingLogo}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-rose-200 text-rose-700 font-bold text-[11px] hover:bg-rose-50 transition disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Usar Logo del Sistema</span>
                        </button>
                      )}
                      {uploadingLogo && <span className="text-[11px] text-[#756E65] font-semibold">Subiendo logo a Drive...</span>}
                    </div>
                    <span className="text-[10px] text-[#756E65]">
                      JPG, PNG o WEBP (máx. 10MB). Si no se configura, se muestra el emblema predeterminado del sistema. Los cambios se aplican al pulsar "Guardar Cambios".
                    </span>
                  </div>
                </div>
              </div>

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
                {/* FASE 3.7H: corregido -- este campo leía/escribía
                    `formSettings.mensajePieFactura`, una clave que nunca
                    existió en SystemSettings ni en el backend (el campo
                    real ya declarado en el tipo es `mensajeTicketPie`,
                    mapeado a `pieTicket` en el backend). El input quedaba
                    permanentemente vacío sin importar lo que el backend
                    devolviera. */}
                <input
                  type="text"
                  value={formSettings.mensajeTicketPie || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, mensajeTicketPie: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
              </div>

              {/* FASE 4 (textos del recibo -- auditoría): estos 3 campos
                  reemplazan texto que antes estaba fijo dentro del propio
                  componente del recibo (ReceiptTicket.tsx). Un campo vacío
                  hace que el recibo omita esa línea por completo -- no
                  muestra "undefined"/"null" ni deja un espacio en blanco. */}
              <div className="col-span-1 sm:col-span-2 pt-2 border-t border-[#E4DDD2]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#756E65]">
                  Textos del Recibo / Comprobante
                </span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Eslogan del Negocio:</label>
                <input
                  type="text"
                  value={formSettings.eslogan || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, eslogan: e.target.value })}
                  placeholder="Ej. Elegancia, Vanguardia y Estilo Contemporáneo"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
                <span className="text-[10px] text-[#756E65]">Aparece bajo el nombre del negocio, en el encabezado del recibo. Vacío = no se muestra.</span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Mensaje Final del Recibo:</label>
                <input
                  type="text"
                  value={formSettings.mensajeFinalRecibo || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, mensajeFinalRecibo: e.target.value })}
                  placeholder="Ej. ¡Gracias por vestir ZIO CLOTHES!"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-bold"
                />
                <span className="text-[10px] text-[#756E65]">Línea final de agradecimiento, en negrita, al pie del recibo. Vacío = no se muestra.</span>
              </div>

              <div className="col-span-1 sm:col-span-2">
                <label className="block font-bold text-[#2F2A25] mb-1">Pie Técnico del Recibo:</label>
                <input
                  type="text"
                  value={formSettings.pieTecnicoRecibo || ''}
                  onChange={(e) => setFormSettings({ ...formSettings, pieTecnicoRecibo: e.target.value })}
                  placeholder="Ej. Sistema POS ZIO • Comprobante Digital / Físico"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white"
                />
                <span className="text-[10px] text-[#756E65]">Última línea, más pequeña, al final del recibo. Vacío = no se muestra.</span>
              </div>
            </fieldset>

            <div className="pt-4 border-t border-[#E4DDD2] flex justify-end">
              <button
                type="submit"
                disabled={settingsLoading || savingSettings}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-xs disabled:bg-zinc-300"
              >
                <Save className="w-4 h-4 text-[#E8DCC8]" />
                <span>{savingSettings ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2: USERS & ROLES */}
      {activeTab === 'USUARIOS' && (
        <div className="bg-white p-6 rounded-3xl border border-[#E4DDD2] space-y-6 shadow-xs">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-serif font-bold text-base text-[#2F2A25]">Cuentas de Usuarios & Roles</h3>
              <p className="text-xs text-[#756E65]">Control de acceso por cajero, supervisor y administrador.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchUsers()}
                disabled={usersLoading}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E4DDD2] text-xs font-semibold text-[#2F2A25] hover:bg-[#F6F1E8] disabled:opacity-50"
                title="Volver a consultar el backend real"
              >
                <RefreshCw className={`w-4 h-4 text-[#756E65] ${usersLoading ? 'animate-spin' : ''}`} />
                <span>{usersLoading ? 'Actualizando...' : 'Actualizar'}</span>
              </button>
              <button
                type="button"
                onClick={handleOpenCreateUser}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932]"
              >
                <Plus className="w-4 h-4 text-[#E8DCC8]" />
                <span>Nuevo Usuario</span>
              </button>
            </div>
          </div>

          {usersError && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>No se pudo cargar la lista real de usuarios: {usersError}</span>
              </div>
              <button type="button" onClick={() => fetchUsers()} className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold text-[11px] shrink-0">
                Reintentar
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            {usersLoading && users.length === 0 ? (
              <div className="text-center py-10 text-[#756E65] text-xs">Consultando usuarios reales en el backend...</div>
            ) : !usersLoading && !usersError && users.length === 0 ? (
              <div className="text-center py-10 text-[#756E65] text-xs">Todavía no hay usuarios registrados en Google Sheets.</div>
            ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F6F1E8] text-[#2F2A25] uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-4">Usuario</th>
                  <th className="py-2.5 px-4">Nombre Completo</th>
                  <th className="py-2.5 px-4">Rol Asignado</th>
                  <th className="py-2.5 px-4 text-center">Estado</th>
                  <th className="py-2.5 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4DDD2]/60">
                {(users || []).map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-mono font-bold text-[#2F2A25]">@{u.usuario}</td>
                    <td className="py-3 px-4">{u.nombre} {u.apellido}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[10px] font-bold text-[#2F2A25]">
                        {u.rol}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          u.estado === 'ACTIVO'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {u.estado}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleOpenEditUser(u)}
                        className="px-2.5 py-1 rounded-lg bg-[#FAF8F4] border border-[#E4DDD2] text-[11px] font-bold text-[#2F2A25] hover:bg-[#F6F1E8]"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>

          {userModalOpen && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
              <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
                <h3 className="text-sm font-bold text-[#2F2A25] border-b border-[#E4DDD2] pb-2">
                  {editingUserId ? 'Editar Empleado / Usuario' : 'Crear Empleado / Usuario'}
                </h3>
                {editingUserId && editingUserId === currentUser?.id && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
                    ⚠ Estás editando tu propia cuenta. Si cambias tu rol o estado, el cambio no tendrá efecto en tu sesión actual hasta que vuelvas a iniciar sesión.
                  </div>
                )}
                <form onSubmit={handleSaveUser} noValidate className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">Nombre de Usuario (@):</label>
                    <input
                      type="text"
                      required
                      placeholder="ej. maria.vendedor"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      disabled={savingUser}
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
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Apellido:</label>
                      <input
                        type="text"
                        value={newApellido}
                        onChange={(e) => setNewApellido(e.target.value)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Correo (opcional):</label>
                      <input
                        type="email"
                        value={newCorreo}
                        onChange={(e) => setNewCorreo(e.target.value)}
                        disabled={savingUser}
                        placeholder="usuario@zioclothes.com"
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Teléfono (opcional):</label>
                      <input
                        type="text"
                        value={newTelefono}
                        onChange={(e) => setNewTelefono(e.target.value)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-bold text-[#2F2A25] mb-1">Rol / Permisos:</label>
                      <select
                        value={newRol}
                        onChange={(e) => setNewRol(e.target.value as UserRole)}
                        disabled={savingUser}
                        className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                      >
                        {REAL_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    {editingUserId && (
                      <div>
                        <label className="block font-bold text-[#2F2A25] mb-1">Estado:</label>
                        <select
                          value={newEstado}
                          onChange={(e) => setNewEstado(e.target.value as any)}
                          disabled={savingUser}
                          className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-semibold"
                        >
                          <option value="ACTIVO">Activo</option>
                          <option value="INACTIVO">Inactivo</option>
                          <option value="BLOQUEADO">Bloqueado</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1">
                      Contraseña{editingUserId ? ' (dejar en blanco para no cambiarla):' : ':'}
                    </label>
                    <input
                      type="password"
                      required={!editingUserId}
                      autoComplete="new-password"
                      placeholder={editingUserId ? '••••••••' : ''}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={savingUser}
                      className="w-full px-3 py-2 rounded-xl border border-[#E4DDD2] bg-white font-mono"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setUserModalOpen(false)}
                      disabled={savingUser}
                      className="flex-1 py-2 rounded-xl bg-white border border-[#E4DDD2] font-semibold text-[#756E65] disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingUser}
                      className="flex-1 py-2 rounded-xl bg-[#2F2A25] font-bold text-white shadow-md disabled:bg-zinc-300"
                    >
                      {savingUser ? 'Guardando...' : editingUserId ? 'Guardar Cambios' : 'Crear Usuario'}
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
                value={googleAppsScriptUrl}
                onChange={(e) => {
                  const url = e.target.value;
                  setGoogleAppsScriptUrlState(url);
                  storageService.setGoogleAppsScriptUrl(url);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-white font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-200">
            <div>
              <span className="text-[11px] font-bold uppercase text-emerald-900">Estado de la Sincronización</span>
              <p className="text-xs text-emerald-800 mt-0.5">
                {googleAppsScriptUrl
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
              <h4 className="font-bold text-xs text-rose-900">Limpiar Caché Local</h4>
              <p className="text-xs text-rose-800">
                Borra la sesión y el catálogo cacheado localmente, y restablece la configuración por
                defecto. La URL de conexión con Google Sheets se conserva. El catálogo real se vuelve
                a descargar al iniciar sesión.
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
