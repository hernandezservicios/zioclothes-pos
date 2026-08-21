import React, { createContext, useContext, useState, useCallback } from 'react';
import { ToastNotification } from '../types';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

interface ToastContextType {
  showToast: (titulo: string, mensaje: string, tipo?: ToastNotification['tipo']) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const showToast = useCallback((titulo: string, mensaje: string, tipo: ToastNotification['tipo'] = 'exito') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: ToastNotification = { id, titulo, mensaje, tipo, duracion: 3500 };

    setToasts((prev) => [...prev, newToast]);

    // Auto remove after duration
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, newToast.duracion);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast Render Container */}
      <div id="toast-container" className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => {
          let bgClass = 'bg-[#FAF8F4] border-[#E4DDD2] text-[#2F2A25]';
          let icon = <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />;

          if (toast.tipo === 'error') {
            bgClass = 'bg-[#FFF5F5] border-rose-200 text-[#2F2A25]';
            icon = <XCircle className="w-5 h-5 text-rose-600 shrink-0" />;
          } else if (toast.tipo === 'advertencia') {
            bgClass = 'bg-[#FFFDF0] border-amber-200 text-[#2F2A25]';
            icon = <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />;
          } else if (toast.tipo === 'informacion') {
            bgClass = 'bg-[#F0F7FF] border-blue-200 text-[#2F2A25]';
            icon = <Info className="w-5 h-5 text-blue-600 shrink-0" />;
          }

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-4 rounded-xl border shadow-lg flex items-start gap-3 transition-all duration-300 transform translate-y-0 ${bgClass}`}
            >
              <div className="mt-0.5">{icon}</div>
              <div className="flex-1 pr-1">
                <h4 className="text-sm font-semibold text-[#2F2A25] leading-tight">{toast.titulo}</h4>
                <p className="text-xs text-[#756E65] mt-1 leading-relaxed">{toast.mensaje}</p>
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="text-[#756E65] hover:text-[#2F2A25] p-1 rounded-lg hover:bg-black/5 transition"
                aria-label="Cerrar notificación"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: (titulo: string, mensaje: string) => {
        console.log(`[Toast] ${titulo}: ${mensaje}`);
      },
    };
  }
  return context;
};
