import React, { useState } from 'react';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { normalizeAppsScriptUrl } from '../../utils/backendUrl';
import { Server, CheckCircle2, XCircle, Loader2, ArrowRight, UserPlus, Lock } from 'lucide-react';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 * TAREA — INSTALACIÓN LIMPIA + CONFIGURACIÓN SEGURA DEL PRIMER ADMIN.
 *
 * Pantalla previa al Login, mostrada únicamente cuando esta instalación
 * (este navegador) todavía no tiene una URL de backend guardada --
 * App.tsx decide cuándo renderizarla, esta vista solo se encarga de
 * conseguir una URL REAL y validada, y -- desde esta tarea -- de crear el
 * primer administrador si el backend conectado todavía no tiene uno
 * (Fase 16/17).
 *
 * Nunca guarda nada en `storageService` hasta que `apiService.
 * checkBackendConnection` confirma una conexión real (success===true,
 * status==='ONLINE', spreadsheetConnected===true) -- ver Requisito 2.
 * `storageService.getGoogleAppsScriptUrl/setGoogleAppsScriptUrl` sigue
 * siendo la ÚNICA fuente de verdad (Requisito 1) -- esta pantalla no
 * introduce ningún almacenamiento paralelo.
 *
 * Fase 18 (contraseña nunca persistida): `adminPassword`/
 * `adminPasswordConfirm` viven ÚNICAMENTE en `useState` de este
 * componente -- nunca se pasan a `storageService`, nunca se registran en
 * consola/Logger, y se limpian del estado en cuanto la creación del
 * administrador tiene éxito (antes incluso de mostrar el mensaje de
 * éxito). Si el usuario cierra la pestaña o navega antes de terminar,
 * React descarta ese estado -- no queda persistido en ningún lugar.
 */

type ConnectionStatus = 'idle' | 'checking' | 'success' | 'error';
// Fase 16: paso adicional una vez la URL ya está validada -- 'checking-install'
// consulta system.installationStatus; 'create-admin' muestra el formulario
// del primer ADMIN; 'admin-created' es la confirmación breve antes de pasar al Login.
type SetupStep = 'connect' | 'checking-install' | 'create-admin' | 'admin-created';

interface InitialSetupViewProps {
  onConfigured: () => void;
}

export const InitialSetupView: React.FC<InitialSetupViewProps> = ({ onConfigured }) => {
  const [urlInput, setUrlInput] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [validUrl, setValidUrl] = useState<string | null>(null);

  const [step, setStep] = useState<SetupStep>('connect');
  const [adminNombre, setAdminNombre] = useState('');
  const [adminUsuario, setAdminUsuario] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [adminError, setAdminError] = useState('');

  const handleTestConnection = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalized = normalizeAppsScriptUrl(urlInput);
    if (!normalized) {
      setStatus('error');
      setValidUrl(null);
      setErrorMessage(
        'La URL no tiene el formato esperado. Debe ser la URL de un Web App publicado (https://script.google.com/macros/s/.../exec), no la del editor.'
      );
      return;
    }

    setStatus('checking');
    setErrorMessage('');

    const res = await apiService.checkBackendConnection(normalized);

    if (res.success) {
      setStatus('success');
      setValidUrl(normalized);
    } else {
      setStatus('error');
      setValidUrl(null);
      setErrorMessage(res.message || 'No se pudo conectar con el servidor.');
    }
  };

  // Fase 16: al confirmar la URL, se guarda (único punto de escritura de
  // esta pantalla, Requisito 1) y se consulta system.installationStatus
  // -- solo si responde explícitamente initialAdminConfigured===false se
  // muestra el formulario del primer ADMIN; cualquier ambigüedad (error
  // de red, respuesta inesperada) degrada de forma segura al
  // comportamiento previo (pasar directo al Login), para no romper nunca
  // una instalación existente que ya funciona (Fase 12/24).
  const handleContinue = async () => {
    if (!validUrl) return;
    storageService.setGoogleAppsScriptUrl(validUrl);

    setStep('checking-install');
    const statusRes = await apiService.getInstallationStatus();

    if (statusRes.success && statusRes.data && statusRes.data.initialAdminConfigured === false) {
      setStep('create-admin');
      return;
    }

    onConfigured();
  };

  const handleEditUrl = () => {
    setStatus('idle');
    setValidUrl(null);
    setErrorMessage('');
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError('');

    if (!adminNombre.trim() || !adminUsuario.trim() || !adminPassword) {
      setAdminError('Todos los campos son obligatorios.');
      return;
    }
    if (adminPassword.length < 8) {
      setAdminError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (adminPassword !== adminPasswordConfirm) {
      setAdminError('Las contraseñas no coinciden.');
      return;
    }

    setCreatingAdmin(true);
    const res = await apiService.setupInitialAdmin({
      nombre: adminNombre.trim(),
      usuario: adminUsuario.trim(),
      password: adminPassword,
    });
    setCreatingAdmin(false);

    if (!res.success) {
      setAdminError(res.message || 'No se pudo crear el administrador.');
      return;
    }

    // Fase 18: la contraseña sale de memoria en cuanto ya no hace falta --
    // nunca sobrevive más allá de esta solicitud.
    setAdminPassword('');
    setAdminPasswordConfirm('');
    setStep('admin-created');
  };

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col justify-center items-center p-4 sm:p-6 text-[#2F2A25]">
      <div className="max-w-md w-full space-y-6">
        {/* Brand Header -- genérico a propósito: todavía no se conoce el
            nombre/logo del negocio (eso vive en SU backend, aún sin
            conectar). Cada instalación mostrará su propia marca recién
            después de conectarse y autenticarse. */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-3xl bg-[#2F2A25] text-white shadow-lg mb-2">
            {step === 'create-admin' || step === 'admin-created' ? (
              <UserPlus className="w-7 h-7 text-[#E8DCC8]" />
            ) : (
              <Server className="w-7 h-7 text-[#E8DCC8]" />
            )}
          </div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-[#2F2A25]">Configuración Inicial</h1>
          <p className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            {step === 'create-admin' || step === 'admin-created'
              ? 'Crea el administrador de esta instalación para comenzar'
              : 'Conecta este sistema con el servidor de tu negocio para comenzar'}
          </p>
        </div>

        {/* Setup Card */}
        <div className="bg-white border border-[#E4DDD2] p-6 sm:p-8 rounded-3xl shadow-sm space-y-5">
          {(step === 'connect' || step === 'checking-install') && (
            <>
              <div className="border-b border-[#E4DDD2] pb-3">
                <h2 className="text-base font-bold text-[#2F2A25]">Conectar Servidor</h2>
                <p className="text-xs text-[#756E65]">Ingresa la dirección que te proporcionó tu proveedor del sistema.</p>
              </div>

              {status === 'error' && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-start gap-2 animate-in fade-in">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {status === 'success' && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-start gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Conexión establecida correctamente.</span>
                </div>
              )}

              {status === 'success' && validUrl ? (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-xs">
                    <span className="block font-bold text-[#2F2A25] mb-1 uppercase tracking-wide text-[10px]">Servidor</span>
                    <span className="font-mono text-[11px] text-[#756E65] break-all">{validUrl}</span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleEditUrl}
                      disabled={step === 'checking-install'}
                      className="flex-1 py-3 rounded-2xl border border-[#E4DDD2] text-xs font-bold text-[#756E65] hover:bg-[#FAF8F4] transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cambiar
                    </button>
                    <button
                      type="button"
                      onClick={handleContinue}
                      disabled={step === 'checking-install'}
                      className="flex-1 py-3 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {step === 'checking-install' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Verificando instalación...</span>
                        </>
                      ) : (
                        <>
                          <span>Continuar</span>
                          <ArrowRight className="w-4 h-4 text-[#E8DCC8]" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleTestConnection} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">URL del Servidor:</label>
                    <div className="relative">
                      <Server className="w-4 h-4 text-[#756E65] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        disabled={status === 'checking'}
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] font-mono text-[11px] text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white disabled:opacity-60"
                        placeholder="https://script.google.com/macros/s/.../exec"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={status === 'checking' || !urlInput.trim()}
                    className="w-full py-3 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md flex items-center justify-center gap-2 disabled:bg-zinc-300 disabled:cursor-not-allowed"
                  >
                    {status === 'checking' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Probando conexión...</span>
                      </>
                    ) : (
                      <span>Probar conexión</span>
                    )}
                  </button>
                </form>
              )}
            </>
          )}

          {/* Fase 17 -- pantalla del primer ADMIN: Nombre, Usuario,
              Contraseña, Confirmar contraseña. Sin selector de rol -- el
              backend siempre asigna ADMIN, esta pantalla ni lo ofrece. */}
          {step === 'create-admin' && (
            <>
              <div className="border-b border-[#E4DDD2] pb-3">
                <h2 className="text-base font-bold text-[#2F2A25]">Crear Administrador</h2>
                <p className="text-xs text-[#756E65]">
                  Esta instalación todavía no tiene ningún administrador. Crea el tuyo para comenzar a usar el sistema.
                </p>
              </div>

              {adminError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-start gap-2 animate-in fade-in">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{adminError}</span>
                </div>
              )}

              <form onSubmit={handleCreateAdmin} className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">Nombre:</label>
                  <input
                    type="text"
                    required
                    value={adminNombre}
                    onChange={(e) => setAdminNombre(e.target.value)}
                    disabled={creatingAdmin}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white disabled:opacity-60"
                    placeholder="Tu nombre completo"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">Usuario:</label>
                  <input
                    type="text"
                    required
                    value={adminUsuario}
                    onChange={(e) => setAdminUsuario(e.target.value)}
                    disabled={creatingAdmin}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white disabled:opacity-60"
                    placeholder="Nombre de usuario para iniciar sesión"
                  />
                </div>

                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">Contraseña:</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#756E65] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      disabled={creatingAdmin}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white disabled:opacity-60"
                      placeholder="Mínimo 8 caracteres"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">Confirmar contraseña:</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#756E65] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={adminPasswordConfirm}
                      onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                      disabled={creatingAdmin}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white disabled:opacity-60"
                      placeholder="Repite la contraseña"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creatingAdmin}
                  className="w-full py-3 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md flex items-center justify-center gap-2 disabled:bg-zinc-300 disabled:cursor-not-allowed"
                >
                  {creatingAdmin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creando administrador...</span>
                    </>
                  ) : (
                    <span>Crear Administrador</span>
                  )}
                </button>
              </form>
            </>
          )}

          {step === 'admin-created' && (
            <div className="space-y-4 text-center py-2">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-start gap-2 text-left animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Administrador creado exitosamente. Ya puedes iniciar sesión con tu usuario y contraseña.</span>
              </div>
              <button
                type="button"
                onClick={onConfigured}
                className="w-full py-3 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md flex items-center justify-center gap-2"
              >
                <span>Ir al Inicio de Sesión</span>
                <ArrowRight className="w-4 h-4 text-[#E8DCC8]" />
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-[#756E65]">
          <p>Este sistema funciona exclusivamente conectado al servidor de tu negocio.</p>
        </div>
      </div>
    </div>
  );
};
