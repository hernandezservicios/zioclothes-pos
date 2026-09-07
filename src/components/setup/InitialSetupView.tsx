import React, { useState } from 'react';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';
import { normalizeAppsScriptUrl } from '../../utils/backendUrl';
import { Server, CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 *
 * Pantalla previa al Login, mostrada únicamente cuando esta instalación
 * (este navegador) todavía no tiene una URL de backend guardada --
 * App.tsx decide cuándo renderizarla, esta vista solo se encarga de
 * conseguir una URL REAL y validada.
 *
 * Nunca guarda nada en `storageService` hasta que `apiService.
 * checkBackendConnection` confirma una conexión real (success===true,
 * status==='ONLINE', spreadsheetConnected===true) -- ver Requisito 2.
 * `storageService.getGoogleAppsScriptUrl/setGoogleAppsScriptUrl` sigue
 * siendo la ÚNICA fuente de verdad (Requisito 1) -- esta pantalla no
 * introduce ningún almacenamiento paralelo.
 */

type ConnectionStatus = 'idle' | 'checking' | 'success' | 'error';

interface InitialSetupViewProps {
  onConfigured: () => void;
}

export const InitialSetupView: React.FC<InitialSetupViewProps> = ({ onConfigured }) => {
  const [urlInput, setUrlInput] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [validUrl, setValidUrl] = useState<string | null>(null);

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

  const handleContinue = () => {
    if (!validUrl) return;
    // Único punto de escritura de esta pantalla -- la misma fuente de
    // verdad que ya usa apiService/Configuración (Requisito 1).
    storageService.setGoogleAppsScriptUrl(validUrl);
    onConfigured();
  };

  const handleEditUrl = () => {
    setStatus('idle');
    setValidUrl(null);
    setErrorMessage('');
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
            <Server className="w-7 h-7 text-[#E8DCC8]" />
          </div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-[#2F2A25]">Configuración Inicial</h1>
          <p className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Conecta este sistema con el servidor de tu negocio para comenzar
          </p>
        </div>

        {/* Setup Card */}
        <div className="bg-white border border-[#E4DDD2] p-6 sm:p-8 rounded-3xl shadow-sm space-y-5">
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
                  className="flex-1 py-3 rounded-2xl border border-[#E4DDD2] text-xs font-bold text-[#756E65] hover:bg-[#FAF8F4] transition"
                >
                  Cambiar
                </button>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="flex-1 py-3 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md flex items-center justify-center gap-2"
                >
                  <span>Continuar</span>
                  <ArrowRight className="w-4 h-4 text-[#E8DCC8]" />
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
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-[#756E65]">
          <p>Este sistema funciona exclusivamente conectado al servidor de tu negocio.</p>
        </div>
      </div>
    </div>
  );
};
