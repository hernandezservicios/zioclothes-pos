import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { sounds } from '../../utils/soundEffects';
import { toDisplayableImageUrl } from '../../utils/imageUrl';
import { Lock, User as UserIcon, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { login, settings } = useAuth();

  const [username, setUsername] = useState('admin');
  // FASE 3.7G-FIX: el campo de contraseña ya no precarga la contraseña
  // real del admin sembrado -- el usuario debe escribirla manualmente.
  // No se tocó `username` (no es una credencial secreta) ni los botones
  // de "Acceso Rápido para Demostración" (acción explícita y visible del
  // usuario, no un valor precargado en silencio) -- ver reporte de esta
  // fase, quedan documentados pero fuera del alcance pedido.
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    // FASE 3.6: login ahora es real (async) contra el backend -- ya no
    // asume éxito antes de conocer la respuesta.
    const success = await login(username.trim().toLowerCase(), password);
    setLoading(false);

    if (success) {
      sounds.playSuccess();
    } else {
      sounds.playError();
      setErrorMsg('Usuario o contraseña incorrectos');
    }
    // El toast de éxito/error ya lo muestra AuthContext.login con el
    // mensaje real del backend -- no se duplica aquí.
  };

  const handleQuickLogin = async (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setLoading(true);
    const success = await login(u, p);
    setLoading(false);
    if (success) {
      sounds.playSuccess();
    } else {
      sounds.playError();
      setErrorMsg('Usuario o contraseña incorrectos');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F4] flex flex-col justify-center items-center p-4 sm:p-6 text-[#2F2A25]">
      <div className="max-w-md w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          {/* FASE 3 (logo de empresa): fallback automático al emblema "Z"
              del sistema si la empresa no configuró un logo propio. */}
          {settings.logoUrl ? (
            <img
              src={toDisplayableImageUrl(settings.logoUrl)}
              alt={settings.nombreNegocio}
              className="inline-block w-14 h-14 rounded-3xl object-cover shadow-lg mb-2"
            />
          ) : (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-3xl bg-[#2F2A25] text-white shadow-lg mb-2">
              <span className="font-serif font-bold text-2xl tracking-tighter text-[#E8DCC8]">Z</span>
            </div>
          )}
          <h1 className="text-3xl font-serif font-bold tracking-tight text-[#2F2A25]">
            {settings.nombreNegocio}
          </h1>
          <p className="text-xs uppercase tracking-widest text-[#756E65] font-semibold">
            Punto de Venta, Inventario & Créditos
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white border border-[#E4DDD2] p-6 sm:p-8 rounded-3xl shadow-sm space-y-5">
          <div className="border-b border-[#E4DDD2] pb-3">
            <h2 className="text-base font-bold text-[#2F2A25]">Iniciar Sesión</h2>
            <p className="text-xs text-[#756E65]">Ingrese sus credenciales de colaborador</p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 animate-in fade-in">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">
                Usuario / Identificador:
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#756E65] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white"
                  placeholder="ej. admin"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#2F2A25] mb-1.5 uppercase">
                Contraseña:
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#756E65] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E4DDD2] bg-[#FAF8F4] font-medium text-[#2F2A25] focus:outline-none focus:border-[#2F2A25] focus:bg-white"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-2xl bg-[#2F2A25] text-white text-xs font-bold hover:bg-[#403932] transition shadow-md flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Ingresando...' : 'Acceder al Sistema'}</span>
              <ArrowRight className="w-4 h-4 text-[#E8DCC8]" />
            </button>
          </form>

          {/* Quick Demo Access Badges */}
          <div className="pt-3 border-t border-[#E4DDD2] space-y-2">
            <span className="text-[10px] uppercase font-bold text-[#756E65] tracking-wider block text-center">
              Acceso Rápido para Demostración:
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('admin', 'admin123')}
                className="p-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-center hover:bg-[#F6F1E8] transition"
              >
                <p className="font-bold text-[11px] text-[#2F2A25]">Admin</p>
                <span className="text-[9px] text-[#756E65]">Acceso Total</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('gerente', 'gerente123')}
                className="p-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-center hover:bg-[#F6F1E8] transition"
              >
                <p className="font-bold text-[11px] text-[#2F2A25]">Gerente</p>
                <span className="text-[9px] text-[#756E65]">Tienda & Caja</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('cajero', 'cajero123')}
                className="p-2 rounded-xl bg-[#FAF8F4] border border-[#E4DDD2] text-center hover:bg-[#F6F1E8] transition"
              >
                <p className="font-bold text-[11px] text-[#2F2A25]">Cajero</p>
                <span className="text-[9px] text-[#756E65]">POS & Ventas</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-[#756E65]">
          <p>ZIO CLOTHES POS • Santo Domingo, República Dominicana</p>
        </div>
      </div>
    </div>
  );
};
