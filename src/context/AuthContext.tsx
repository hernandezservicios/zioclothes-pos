import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, PermissionCode, SystemSettings, CashSession } from '../types';
import { storageService } from '../services/storageService';
import { apiService } from '../services/apiService';
import { cashApi } from '../services/cashApi';
import { settingsApi, mapBackendSettingsToFrontend } from '../services/settingsApi';
import { useToast } from './ToastContext';
import { useDataStore, BootstrapBundle } from './DataStoreContext';

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  settings: SystemSettings;
  activeCashSession: CashSession | undefined;
  hasPermission: (permission: PermissionCode) => boolean;
  login: (usernameOrEmail: string, pass: string) => Promise<boolean>;
  quickSwitchUser: (userId: string) => void;
  logout: () => void;
  refreshState: () => void;
  // FASE 3.6 (Parte 4): refresca activeCashSession desde el backend real
  // (cash.getActiveSession) -- CashView la llama tras abrir/cerrar/
  // registrar un movimiento, en vez de leer storageService local.
  refreshActiveCashSession: () => Promise<void>;
  // FASE 3.6 (corrección de bloqueante — Parte 9): reemplaza el botón
  // "Sincronizar Ahora" que llamaba a la acción inexistente FULL_SYNC.
  // Reutiliza el mismo mecanismo real de sincronización que ya existe
  // (system.getBootstrapData), en vez de inventar un endpoint nuevo.
  refreshCatalog: () => Promise<boolean>;
  // FASE 3.7H: ahora real -- llama a settingsApi.save() (system.
  // updateSettings) y solo actualiza el estado visible si el backend
  // confirma éxito. Devuelve un booleano (mismo patrón que login/
  // refreshCatalog) para que el llamador sepa si debe mostrar un error.
  updateSettings: (newSettings: SystemSettings) => Promise<boolean>;
}

/**
 * FASE 3.6: mapea el "safeUser" que devuelve AuthController.gs
 * (id, usuario, nombre, apellido, correo, telefono, rol, estado, avatar)
 * al tipo User del frontend. Los campos coinciden 1:1 -- no se inventa
 * ningún campo nuevo, solo se tipa lo que el backend realmente devuelve.
 */
function mapBackendUser(raw: any): User {
  return {
    id: raw.id,
    nombre: raw.nombre,
    apellido: raw.apellido || '',
    usuario: raw.usuario,
    correo: raw.correo || '',
    telefono: raw.telefono || '',
    rol: raw.rol,
    estado: raw.estado,
    avatar: raw.avatar || '',
    fechaCreacion: raw.creado_en || '',
    ultimoAcceso: raw.ultimo_acceso || '',
  };
}

/**
 * FASE 3.6: trae el catálogo real (productos, clientes, configuración) del
 * backend en un solo viaje (system.getBootstrapData).
 *
 * CORREGIR AUDITORÍA: antes, este bundle se escribía directo en
 * storageService (localStorage) y CADA vista volvía a pedir sus propios
 * datos por su cuenta (products.list/sales.list/credits.list repetidos
 * desde 3-4 archivos distintos cada uno, ver informe de auditoría) -- el
 * POS en particular leía SOLO ese caché de localStorage, completamente
 * desconectado de lo que Catálogo/Inventario mostraban en memoria. Ahora
 * ese mismo viaje de red hidrata el DataStore central (vía el callback
 * `hydrateStore`, provisto por el llamador con acceso real a
 * useDataStore()) -- ninguna vista vuelve a pedir por su cuenta lo que
 * este bootstrap ya trajo. `storageService` sigue recibiendo estos mismos
 * datos (dentro de hydrateStore/DataStoreContext) únicamente como
 * persistencia para la hidratación inicial de un F5 futuro -- ya no es lo
 * que las vistas leen en vivo.
 * No se sincroniza activeCashSession aquí: la caja sigue gestionándose de
 * forma local en esta fase (fuera del alcance de Fase 3.6), y mezclar
 * ambos modelos arriesgaría corromper CashView. Se documenta como
 * pendiente en el informe final.
 */
async function fetchAndApplyBootstrap(token: string, hydrateStore: (bundle: BootstrapBundle) => void): Promise<boolean> {
  const res = await apiService.syncWithGoogleAppsScript('system.getBootstrapData', {}, token);
  if (!res.success || !res.data || !res.data.data) {
    return false;
  }
  const bundle = res.data.data;

  hydrateStore({
    products: Array.isArray(bundle.products) ? bundle.products : undefined,
    customers: Array.isArray(bundle.customers) ? bundle.customers : undefined,
    categories: Array.isArray(bundle.categories) ? bundle.categories : undefined,
    sizes: Array.isArray(bundle.sizes) ? bundle.sizes : undefined,
    colors: Array.isArray(bundle.colors) ? bundle.colors : undefined,
    suppliers: Array.isArray(bundle.suppliers) ? bundle.suppliers : undefined,
  });

  if (bundle.settings && typeof bundle.settings === 'object') {
    // FASE 3.7H: bundle.settings viene del mismo handleGetSettings() real
    // que usa system.getSettings -- SUS nombres de campo (moneda,
    // pieTicket, etc.) no coinciden 1:1 con SystemSettings del frontend
    // (simboloMoneda, mensajeTicketPie). Antes se mezclaba el objeto
    // crudo tal cual, lo que dejaba campos huérfanos (`moneda`/`pieTicket`
    // como propiedades extra nunca leídas) sin actualizar jamás los
    // campos reales que SettingsView sí muestra. Se traduce con el mismo
    // mapeo que usa settingsApi.get(), para tener una sola fuente de
    // verdad de esa traducción. Los campos que solo existen en el
    // frontend (modoConexion, sonidosHabilitados, etc.) sobreviven -- el
    // backend no los conoce y no debe borrarlos.
    const current = storageService.getSettings();
    storageService.saveSettings({ ...current, ...mapBackendSettingsToFrontend(bundle.settings) });
  }

  return true;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => storageService.getCurrentUser());
  const [settings, setSettings] = useState<SystemSettings>(() => storageService.getSettings());
  const [activeCashSession, setActiveCashSession] = useState<CashSession | undefined>(() => storageService.getActiveCashSession());
  const { showToast } = useToast();
  // CORREGIR AUDITORÍA: DataStoreProvider envuelve a AuthProvider en
  // App.tsx precisamente para que este componente pueda hidratar/limpiar
  // el DataStore central directamente en login/logout/refreshCatalog.
  const dataStore = useDataStore();

  const refreshState = useCallback(() => {
    setCurrentUser(storageService.getCurrentUser());
    setSettings(storageService.getSettings());
    setActiveCashSession(storageService.getActiveCashSession());
  }, []);

  /**
   * FASE 3.6 (Parte 4): trae la sesión de caja real (cash.getActiveSession)
   * y actualiza el estado de React. Deliberadamente NO escribe en
   * storageService.saveCashSessions -- eso sobrescribiría el historial
   * local de sesiones cerradas que CashView todavía usa para su tabla de
   * "Historial de Cuadres" (fuera de alcance de esta fase). Se llama tras
   * login y tras cada acción real de caja (abrir/cerrar/movimiento).
   */
  const refreshActiveCashSession = useCallback(async () => {
    const res = await cashApi.getActiveSession();
    if (res.success) {
      setActiveCashSession(res.data || undefined);
    }
  }, []);

  /**
   * FASE 3.6 (Parte 9): re-descarga el catálogo real (productos, clientes,
   * configuración) bajo demanda -- usado por el botón "Sincronizar Ahora"
   * de Configuración, que antes llamaba a una acción FULL_SYNC inexistente
   * en el backend.
   */
  const refreshCatalog = useCallback(async (): Promise<boolean> => {
    const token = storageService.getSessionToken();
    if (!token) return false;
    const ok = await fetchAndApplyBootstrap(token, dataStore.hydrateFromBootstrap);
    if (ok) {
      setSettings(storageService.getSettings());
    }
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataStore.hydrateFromBootstrap]);

  const hasPermission = useCallback(
    (permission: PermissionCode): boolean => {
      if (!currentUser) return false;
      if (currentUser.estado !== 'ACTIVO') return false;
      if (currentUser.rol === 'ADMIN') return true;

      // FASE 3.6: si hay una sesión real (auth.login/auth.validateSession
      // ya devolvió permisos del backend), esos son la fuente de verdad.
      // Si no hay sesión real todavía, se usa el catálogo local como antes.
      const sessionPermissions = storageService.getSessionPermissions();
      const permissions =
        sessionPermissions.length > 0
          ? sessionPermissions
          : storageService.getRolePermissions()[currentUser.rol] || [];

      return permissions.includes(permission);
    },
    [currentUser]
  );

  /**
   * FASE 3.6: login real contra ZIO-Google-Backend (auth.login).
   * Ya NO valida contra storageService.getUsers() ni acepta las
   * contraseñas maestras locales -- las credenciales las verifica
   * exclusivamente Security.verifyPassword en el backend (SHA-256 + salt).
   */
  const login = async (usernameOrEmail: string, pass: string): Promise<boolean> => {
    const res = await apiService.syncWithGoogleAppsScript('auth.login', {
      username: usernameOrEmail.trim(),
      password: pass,
    });

    if (!res.success || !res.data || !res.data.sessionToken || !res.data.user) {
      showToast(
        'Credenciales incorrectas',
        res.message || 'Usuario o contraseña no válidos.',
        'error'
      );
      return false;
    }

    const user = mapBackendUser(res.data.user);
    const permissions: string[] = Array.isArray(res.data.permissions) ? res.data.permissions : [];

    storageService.setSessionToken(res.data.sessionToken);
    storageService.setSessionPermissions(permissions);
    storageService.setCurrentUser(user);
    setCurrentUser(user);

    // Catálogo real (productos/clientes/config) del backend. Si falla, no
    // se bloquea el login -- se avisa y la app sigue con el catálogo local
    // que ya tenía (degradación explícita, no silenciosa).
    const bootstrapped = await fetchAndApplyBootstrap(res.data.sessionToken, dataStore.hydrateFromBootstrap);
    if (!bootstrapped) {
      showToast(
        'Aviso de Sincronización',
        'Sesión iniciada, pero no se pudo descargar el catálogo real del backend. Se muestran datos locales.',
        'advertencia'
      );
    }

    // Caja real (Parte 4): refleja si ya hay un turno abierto en el
    // backend, en vez de asumir el estado local.
    refreshActiveCashSession();

    storageService.logAudit({
      usuarioId: user.id,
      usuarioNombre: `${user.nombre} ${user.apellido}`,
      usuarioRol: user.rol,
      accion: 'LOGIN',
      modulo: 'AUTH',
      entidad: 'User',
      entidadId: user.id,
      descripcion: `Inicio de sesión exitoso de ${user.nombre} (${user.rol})`,
      resultado: 'EXITO',
    });

    showToast('Bienvenido a ZIO CLOTHES', `Sesión iniciada como ${user.nombre} (${user.rol})`, 'exito');
    refreshState();
    return true;
  };

  /**
   * FASE 5 (Hydration-First) aplicado a AUTH: en el primer render ya se
   * hidrató currentUser desde storageService (arriba). Aquí, en segundo
   * plano y sin bloquear ni vaciar nada durante el primer render, se
   * confirma esa sesión contra el backend real. Si el token ya no es
   * válido, recién ahí se cierra sesión localmente.
   */
  useEffect(() => {
    const token = storageService.getSessionToken();
    if (!token) return;

    let cancelled = false;

    (async () => {
      const res = await apiService.syncWithGoogleAppsScript('auth.validateSession', {}, token);
      if (cancelled) return;

      if (res.success && res.data && res.data.user) {
        const user = mapBackendUser(res.data.user);
        const permissions: string[] = Array.isArray(res.data.permissions) ? res.data.permissions : [];
        storageService.setSessionPermissions(permissions);
        storageService.setCurrentUser(user);
        setCurrentUser(user);
        refreshActiveCashSession();
      } else {
        // Sesión expirada/inválida en el backend real: recién aquí se
        // cierra sesión localmente -- nunca de forma optimista en el
        // primer render.
        storageService.clearSessionToken();
        storageService.clearSessionPermissions();
        storageService.setCurrentUser(null);
        setCurrentUser(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * FASE 3.6 (corrección de bloqueante — Parte 7): DESHABILITADO.
   * Antes, este cambio rápido de usuario reemplazaba el currentUser LOCAL
   * sin credenciales, dejando el sessionToken/permisos reales de la sesión
   * anterior sin cambiar -- cualquier llamada real al backend después de
   * un "cambio" seguía autenticada como el usuario ORIGINAL, no como el
   * que se mostraba en pantalla (identidad de UI ≠ identidad autenticada
   * en backend). No existe ningún endpoint real de impersonación en
   * ZIO-Google-Backend (no se inventa uno), así que la única solución seg
   * ura sin backend nuevo es exigir autenticación real: se deshabilita la
   * función y se le indica al usuario que use el login real. No se
   * detectó ningún componente de la UI que la esté invocando actualmente
   * (verificado por búsqueda en toda la carpeta src/), así que
   * deshabilitarla no quita ningún botón visible hoy.
   */
  const quickSwitchUser = (_userId: string) => {
    showToast(
      'Función deshabilitada',
      'El cambio rápido de usuario fue deshabilitado por seguridad: mostraría una identidad distinta a la autenticada realmente en el backend. Use el inicio de sesión real.',
      'advertencia'
    );
  };

  const logout = () => {
    const token = storageService.getSessionToken();
    if (token) {
      // Fire-and-forget: destruye la sesión en el backend real
      // (Security.destroySession vía auth.logout). No bloquea el cierre
      // de sesión local si la red falla.
      apiService.syncWithGoogleAppsScript('auth.logout', {}, token).catch(() => {});
    }

    if (currentUser) {
      storageService.logAudit({
        usuarioId: currentUser.id,
        usuarioNombre: `${currentUser.nombre} ${currentUser.apellido}`,
        usuarioRol: currentUser.rol,
        accion: 'LOGOUT',
        modulo: 'AUTH',
        entidad: 'User',
        entidadId: currentUser.id,
        descripcion: `Cierre de sesión de ${currentUser.nombre}`,
        resultado: 'EXITO',
      });
    }
    storageService.clearSessionToken();
    storageService.clearSessionPermissions();
    storageService.setCurrentUser(null);
    setCurrentUser(null);
    // CORREGIR AUDITORÍA: vacía el DataStore en memoria -- evita que, en el
    // mismo tab, un siguiente login de OTRO usuario/turno muestre por un
    // instante productos/ventas/créditos cacheados del usuario anterior
    // antes de que su propio bootstrap termine.
    dataStore.clear();
    showToast('Sesión Cerrada', 'Ha salido del sistema de manera segura.', 'informacion');
  };

  // FASE 3.7H: ahora llama al backend real (system.updateSettings) antes
  // de tocar cualquier estado visible -- sin actualización optimista. Solo
  // si el backend confirma éxito se guarda en storageService (como caché,
  // no como autoridad) y se actualiza el estado de React.
  const updateSettings = async (newSettings: SystemSettings): Promise<boolean> => {
    const res = await settingsApi.save({
      nombreNegocio: newSettings.nombreNegocio,
      rnc: newSettings.rnc,
      telefono: newSettings.telefono,
      direccion: newSettings.direccion,
      simboloMoneda: newSettings.simboloMoneda,
      impuestoPorcentaje: newSettings.impuestoPorcentaje,
      mensajeTicketPie: newSettings.mensajeTicketPie,
      // FASE 3 (logo de empresa): mismo nombre en frontend/backend, se
      // envía tal cual -- '' significa "usar el logo del sistema".
      logoUrl: newSettings.logoUrl,
      // FASE 4 (textos del recibo): mismo nombre en frontend/backend --
      // '' significa "no mostrar esta línea en el recibo".
      eslogan: newSettings.eslogan,
      mensajeFinalRecibo: newSettings.mensajeFinalRecibo,
      pieTecnicoRecibo: newSettings.pieTecnicoRecibo,
      // FASE 5 (textos del recibo de abono): mismo nombre en
      // frontend/backend -- '' significa "no mostrar esta línea".
      mensajeReciboPie: newSettings.mensajeReciboPie,
      mensajeFinalAbono: newSettings.mensajeFinalAbono,
      pieTecnicoAbono: newSettings.pieTecnicoAbono,
    });

    if (res.success) {
      storageService.saveSettings(newSettings);
      setSettings(newSettings);
      showToast('Configuración Guardada', res.message || 'Los ajustes del sistema se han actualizado correctamente.', 'exito');
      return true;
    } else {
      showToast('Error al Guardar', res.message || 'No se pudo actualizar la configuración en el backend.', 'error');
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        settings,
        activeCashSession,
        hasPermission,
        login,
        quickSwitchUser,
        logout,
        refreshState,
        refreshActiveCashSession,
        refreshCatalog,
        updateSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
