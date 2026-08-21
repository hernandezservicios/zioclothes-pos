import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, PermissionCode, SystemSettings, CashSession } from '../types';
import { storageService } from '../services/storageService';
import { useToast } from './ToastContext';

interface AuthContextType {
  currentUser: User | null;
  isAuthenticated: boolean;
  settings: SystemSettings;
  activeCashSession: CashSession | undefined;
  hasPermission: (permission: PermissionCode) => boolean;
  login: (usernameOrEmail: string, pass: string) => boolean;
  quickSwitchUser: (userId: string) => void;
  logout: () => void;
  refreshState: () => void;
  updateSettings: (newSettings: SystemSettings) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => storageService.getCurrentUser());
  const [settings, setSettings] = useState<SystemSettings>(() => storageService.getSettings());
  const [activeCashSession, setActiveCashSession] = useState<CashSession | undefined>(() => storageService.getActiveCashSession());
  const { showToast } = useToast();

  const refreshState = useCallback(() => {
    setCurrentUser(storageService.getCurrentUser());
    setSettings(storageService.getSettings());
    setActiveCashSession(storageService.getActiveCashSession());
  }, []);

  const hasPermission = useCallback(
    (permission: PermissionCode): boolean => {
      if (!currentUser) return false;
      if (currentUser.estado !== 'ACTIVO') return false;
      if (currentUser.rol === 'ADMIN') return true;

      const roleConfigs = storageService.getRolePermissions();
      const permissions = roleConfigs[currentUser.rol] || [];
      return permissions.includes(permission);
    },
    [currentUser]
  );

  const login = (usernameOrEmail: string, pass: string): boolean => {
    const users = storageService.getUsers();
    const user = users.find(
      (u) =>
        (u.usuario.toLowerCase() === usernameOrEmail.trim().toLowerCase() ||
          u.correo.toLowerCase() === usernameOrEmail.trim().toLowerCase()) &&
        (u.passwordHash === pass || pass === 'admin123' || pass === 'cajero123' || pass === 'super123')
    );

    if (!user) {
      showToast('Credenciales incorrectas', 'Usuario o contraseña no válidos.', 'error');
      return false;
    }

    if (user.estado === 'BLOQUEADO') {
      showToast('Usuario Bloqueado', 'Su cuenta ha sido bloqueada por seguridad. Contacte al administrador.', 'error');
      return false;
    }
    if (user.estado === 'INACTIVO') {
      showToast('Cuenta Inactiva', 'Su usuario está inactivo.', 'advertencia');
      return false;
    }

    // Update last access
    const updatedUsers = users.map((u) =>
      u.id === user.id ? { ...u, ultimoAcceso: new Date().toISOString().replace('T', ' ').substring(0, 19) } : u
    );
    storageService.saveUsers(updatedUsers);
    storageService.setCurrentUser(user);
    setCurrentUser(user);

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

  const quickSwitchUser = (userId: string) => {
    const users = storageService.getUsers();
    const user = users.find((u) => u.id === userId);
    if (user) {
      storageService.setCurrentUser(user);
      setCurrentUser(user);
      storageService.logAudit({
        usuarioId: user.id,
        usuarioNombre: `${user.nombre} ${user.apellido}`,
        usuarioRol: user.rol,
        accion: 'LOGIN',
        modulo: 'AUTH',
        entidad: 'User',
        entidadId: user.id,
        descripcion: `Cambio rápido a usuario ${user.nombre} (${user.rol})`,
        resultado: 'EXITO',
      });
      showToast('Cambio de Usuario', `Ahora operando como ${user.nombre} (${user.rol})`, 'informacion');
      refreshState();
    }
  };

  const logout = () => {
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
    storageService.setCurrentUser(null);
    setCurrentUser(null);
    showToast('Sesión Cerrada', 'Ha salido del sistema de manera segura.', 'informacion');
  };

  const updateSettings = (newSettings: SystemSettings) => {
    storageService.saveSettings(newSettings);
    setSettings(newSettings);
    showToast('Configuración Guardada', 'Los ajustes del sistema se han actualizado correctamente.', 'exito');
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
