import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { InitialSetupView } from './InitialSetupView';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 * TAREA — INSTALACIÓN LIMPIA + CONFIGURACIÓN SEGURA DEL PRIMER ADMIN.
 *
 * Ejercita InitialSetupView.tsx TAL COMO ES. Se sustituyen
 * `apiService.checkBackendConnection`/`getInstallationStatus`/
 * `setupInitialAdmin` (transporte de red real -- ya probado por separado
 * en apiService.test.ts) y `storageService.setGoogleAppsScriptUrl` (para
 * verificar que es el ÚNICO punto de escritura, sin inspeccionar
 * localStorage directamente).
 */

vi.mock('../../services/storageService', () => ({
  storageService: {
    setGoogleAppsScriptUrl: vi.fn(),
  },
}));

// Por defecto, "instalación ya tiene administrador" -- así las pruebas
// existentes de conexión (que no son sobre el flujo del primer ADMIN)
// siguen yendo directo a onConfigured() como antes de esta tarea. Las
// pruebas nuevas del primer ADMIN sobreescriben este mock puntualmente.
vi.mock('../../services/apiService', () => ({
  apiService: {
    checkBackendConnection: vi.fn(),
    getInstallationStatus: vi.fn().mockResolvedValue({
      success: true,
      message: 'OK',
      data: { installationConfigured: true, initialAdminConfigured: true },
    }),
    setupInitialAdmin: vi.fn(),
  },
}));

const VALID_URL = 'https://script.google.com/macros/s/AKfycbyABC123/exec';

async function connectSuccessfully() {
  (apiService.checkBackendConnection as any).mockResolvedValue({
    success: true,
    message: 'Conexión establecida correctamente.',
    data: { status: 'ONLINE', spreadsheetConnected: true },
  });
  typeUrl(VALID_URL);
  fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));
  await screen.findByRole('button', { name: /Continuar/i });
  fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (apiService.getInstallationStatus as any).mockResolvedValue({
    success: true,
    message: 'OK',
    data: { installationConfigured: true, initialAdminConfigured: true },
  });
});
afterEach(() => {
  cleanup();
});

function typeUrl(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/https:\/\/script\.google\.com/i), { target: { value } });
}

describe('InitialSetupView -- validación real antes de continuar', () => {
  it('URL con formato inválido: no permite continuar y nunca llama a checkBackendConnection', async () => {
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl('esto-no-es-una-url');
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    expect(await screen.findByText(/no tiene el formato esperado/i)).toBeInTheDocument();
    expect(apiService.checkBackendConnection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Continuar/i })).not.toBeInTheDocument();
  });

  it('URL del editor de Apps Script (no es un Web App): rechazada sin red', async () => {
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl('https://script.google.com/d/ABC123/edit');
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    expect(await screen.findByText(/no tiene el formato esperado/i)).toBeInTheDocument();
    expect(apiService.checkBackendConnection).not.toHaveBeenCalled();
  });

  it('backend caído (error de red): muestra el mensaje real y no permite continuar', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: false,
      message: 'No se pudo conectar con el servidor. Verifique la URL y su conexión a internet.',
      errorCode: 'NETWORK_ERROR',
    });
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl(VALID_URL);
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    expect(await screen.findByText(/No se pudo conectar con el servidor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continuar/i })).not.toBeInTheDocument();
    expect(storageService.setGoogleAppsScriptUrl).not.toHaveBeenCalled();
  });

  it('backend responde pero success!==true o status!==ONLINE: no permite continuar', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: false,
      message: 'El servidor respondió, pero no confirma estar en línea.',
      errorCode: 'BACKEND_OFFLINE',
    });
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl(VALID_URL);
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    expect(await screen.findByText(/no confirma estar en línea/i)).toBeInTheDocument();
  });

  it('spreadsheetConnected !== true: no permite continuar (backend en línea pero sin Spreadsheet)', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: false,
      message: 'El servidor está en línea, pero no tiene conexión con su hoja de cálculo (Spreadsheet).',
      errorCode: 'SPREADSHEET_DISCONNECTED',
      data: { status: 'ONLINE', spreadsheetConnected: false },
    });
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl(VALID_URL);
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    expect(await screen.findByText(/no tiene conexión con su hoja de cálculo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continuar/i })).not.toBeInTheDocument();
  });

  it('backend ONLINE con Spreadsheet conectada: permite continuar', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: true,
      message: 'Conexión establecida correctamente.',
      data: { service: 'ZIO CLOTHES POS', version: '1.0', status: 'ONLINE', timezone: 'America/Santo_Domingo', spreadsheetConnected: true },
    });
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl(VALID_URL);
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));

    expect(await screen.findByText(/Conexión establecida correctamente/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continuar/i })).toBeInTheDocument();
    expect(apiService.checkBackendConnection).toHaveBeenCalledWith(VALID_URL);
  });

  it('al confirmar "Continuar", guarda la URL vía storageService (única fuente de verdad) y notifica onConfigured', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({
      success: true,
      message: 'Conexión establecida correctamente.',
      data: { status: 'ONLINE', spreadsheetConnected: true },
    });
    const onConfigured = vi.fn();
    render(<InitialSetupView onConfigured={onConfigured} />);
    typeUrl(VALID_URL);
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));
    await screen.findByRole('button', { name: /Continuar/i });

    fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));

    expect(storageService.setGoogleAppsScriptUrl).toHaveBeenCalledWith(VALID_URL);
    // TAREA -- PRIMER ADMIN: "Continuar" ahora consulta
    // system.installationStatus antes de notificar onConfigured -- el
    // mock por defecto resuelve "ya tiene administrador".
    await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
    expect(apiService.getInstallationStatus).toHaveBeenCalledTimes(1);
  });

  it('"Intentar nuevamente" tras un error permite reintentar (el botón sigue disponible)', async () => {
    (apiService.checkBackendConnection as any).mockResolvedValue({ success: false, message: 'No se pudo conectar.', errorCode: 'NETWORK_ERROR' });
    render(<InitialSetupView onConfigured={vi.fn()} />);
    typeUrl(VALID_URL);
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/i }));
    await screen.findByText(/No se pudo conectar/i);

    expect(screen.getByRole('button', { name: /Probar conexión/i })).not.toBeDisabled();
  });
});

/**
 * TAREA — INSTALACIÓN LIMPIA + CONFIGURACIÓN SEGURA DEL PRIMER ADMIN
 * (Fase 16/17/18).
 */
describe('InitialSetupView -- creación del primer administrador', () => {
  it('si initialAdminConfigured=true, pasa directo a onConfigured sin mostrar el formulario de administrador', async () => {
    (apiService.getInstallationStatus as any).mockResolvedValue({
      success: true, message: 'OK',
      data: { installationConfigured: true, initialAdminConfigured: true },
    });
    const onConfigured = vi.fn();
    render(<InitialSetupView onConfigured={onConfigured} />);
    await connectSuccessfully();

    await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/todavía no tiene ningún administrador/i)).not.toBeInTheDocument();
    expect(apiService.setupInitialAdmin).not.toHaveBeenCalled();
  });

  it('si initialAdminConfigured=false, muestra "Crear Administrador" en vez de pasar al Login', async () => {
    (apiService.getInstallationStatus as any).mockResolvedValue({
      success: true, message: 'OK',
      data: { installationConfigured: true, initialAdminConfigured: false },
    });
    const onConfigured = vi.fn();
    render(<InitialSetupView onConfigured={onConfigured} />);
    await connectSuccessfully();

    expect(await screen.findByText(/todavía no tiene ningún administrador/i)).toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    // Fase 17 -- nunca se ofrece un selector de rol.
    expect(screen.queryByText(/rol/i)).not.toBeInTheDocument();
  });

  it('si getInstallationStatus falla (error de red), degrada de forma segura y pasa al Login como antes de esta tarea', async () => {
    (apiService.getInstallationStatus as any).mockResolvedValue({
      success: false, message: 'No se pudo conectar.', errorCode: 'NETWORK_ERROR',
    });
    const onConfigured = vi.fn();
    render(<InitialSetupView onConfigured={onConfigured} />);
    await connectSuccessfully();

    // Nunca debe quedar bloqueada la instalación existente por un error
    // de red en esta consulta adicional (Fase 12/24, compatibilidad).
    await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/todavía no tiene ningún administrador/i)).not.toBeInTheDocument();
  });

  async function reachCreateAdminForm() {
    (apiService.getInstallationStatus as any).mockResolvedValue({
      success: true, message: 'OK',
      data: { installationConfigured: true, initialAdminConfigured: false },
    });
    await connectSuccessfully();
    await screen.findByText(/todavía no tiene ningún administrador/i);
  }

  function fillAdminForm({ nombre = 'María Pérez', usuario = 'maria', password = 'ClaveSegura123', confirm }: { nombre?: string; usuario?: string; password?: string; confirm?: string } = {}) {
    fireEvent.change(screen.getByPlaceholderText('Tu nombre completo'), { target: { value: nombre } });
    fireEvent.change(screen.getByPlaceholderText('Nombre de usuario para iniciar sesión'), { target: { value: usuario } });
    fireEvent.change(screen.getByPlaceholderText('Mínimo 8 caracteres'), { target: { value: password } });
    fireEvent.change(screen.getByPlaceholderText('Repite la contraseña'), { target: { value: confirm !== undefined ? confirm : password } });
  }

  it('campos solo con espacios: el atributo required del navegador no los detiene, pero la validación propia sí -- no llama a la API, muestra error', async () => {
    // Con los campos LITERALMENTE vacíos, el `required` nativo del <input>
    // bloquea el envío del formulario antes de que el handler de React
    // llegue a ejecutarse (comportamiento real del navegador/jsdom) --
    // esta prueba usa espacios en blanco, que sí pasan esa validación
    // nativa, para ejercitar la validación propia de handleCreateAdmin.
    render(<InitialSetupView onConfigured={vi.fn()} />);
    await reachCreateAdminForm();
    fillAdminForm({ nombre: '   ', usuario: '   ', password: '   ', confirm: '   ' });

    fireEvent.click(screen.getByRole('button', { name: /Crear Administrador/i }));

    expect(await screen.findByText(/Todos los campos son obligatorios/i)).toBeInTheDocument();
    expect(apiService.setupInitialAdmin).not.toHaveBeenCalled();
  });

  it('contraseñas que no coinciden: no llama a la API, muestra error', async () => {
    render(<InitialSetupView onConfigured={vi.fn()} />);
    await reachCreateAdminForm();
    fillAdminForm({ password: 'ClaveSegura123', confirm: 'OtraClaveDistinta456' });

    fireEvent.click(screen.getByRole('button', { name: /Crear Administrador/i }));

    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument();
    expect(apiService.setupInitialAdmin).not.toHaveBeenCalled();
  });

  it('contraseña corta (<8): rechazada en el cliente antes de llamar a la API', async () => {
    render(<InitialSetupView onConfigured={vi.fn()} />);
    await reachCreateAdminForm();
    fillAdminForm({ password: 'corta1', confirm: 'corta1' });

    fireEvent.click(screen.getByRole('button', { name: /Crear Administrador/i }));

    expect(await screen.findByText(/al menos 8 caracteres/i)).toBeInTheDocument();
    expect(apiService.setupInitialAdmin).not.toHaveBeenCalled();
  });

  it('éxito: llama a setupInitialAdmin (nunca con un campo rol), limpia la contraseña de memoria, y permite avanzar al Login', async () => {
    (apiService.setupInitialAdmin as any).mockResolvedValue({
      success: true, message: 'Administrador creado exitosamente.', data: { userId: 'USR-100' },
    });
    const onConfigured = vi.fn();
    render(<InitialSetupView onConfigured={onConfigured} />);
    await reachCreateAdminForm();
    fillAdminForm();

    fireEvent.click(screen.getByRole('button', { name: /Crear Administrador/i }));

    await waitFor(() => expect(apiService.setupInitialAdmin).toHaveBeenCalledTimes(1));
    const payload = (apiService.setupInitialAdmin as any).mock.calls[0][0];
    expect(payload).toEqual({ nombre: 'María Pérez', usuario: 'maria', password: 'ClaveSegura123' });
    expect(payload.rol).toBeUndefined();

    expect(await screen.findByText(/Administrador creado exitosamente/i)).toBeInTheDocument();
    // Fase 18 -- el campo de contraseña, si sigue montado en algún punto
    // posterior, nunca debe conservar el valor ingresado.
    expect(screen.queryByDisplayValue('ClaveSegura123')).not.toBeInTheDocument();

    expect(onConfigured).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ir al Inicio de Sesión/i }));
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  it('el backend rechaza (ej. ya existe un administrador): muestra el error real, permite reintentar, nunca pasa al Login', async () => {
    (apiService.setupInitialAdmin as any).mockResolvedValue({
      success: false, message: 'Esta instalación ya tiene un administrador configurado.', errorCode: 'API_ERROR',
    });
    const onConfigured = vi.fn();
    render(<InitialSetupView onConfigured={onConfigured} />);
    await reachCreateAdminForm();
    fillAdminForm();

    fireEvent.click(screen.getByRole('button', { name: /Crear Administrador/i }));

    expect(await screen.findByText(/ya tiene un administrador configurado/i)).toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Crear Administrador/i })).not.toBeDisabled();
  });

  it('Fase 18 -- la contraseña nunca se pasa a storageService en ningún punto del flujo', async () => {
    (apiService.setupInitialAdmin as any).mockResolvedValue({
      success: true, message: 'OK', data: { userId: 'USR-100' },
    });
    render(<InitialSetupView onConfigured={vi.fn()} />);
    await reachCreateAdminForm();
    fillAdminForm({ password: 'ClaveSecretaUnica777', confirm: 'ClaveSecretaUnica777' });
    fireEvent.click(screen.getByRole('button', { name: /Crear Administrador/i }));
    await screen.findByText(/Administrador creado exitosamente/i);

    // storageService, en este archivo, SOLO expone setGoogleAppsScriptUrl
    // -- si la contraseña se hubiera intentado persistir con cualquier
    // otro método, este mock habría lanzado "is not a function" antes de
    // llegar aquí. Confirmación explícita adicional: nunca se llamó con
    // el valor de la contraseña.
    (storageService.setGoogleAppsScriptUrl as any).mock.calls.forEach((call: unknown[]) => {
      expect(JSON.stringify(call)).not.toContain('ClaveSecretaUnica777');
    });
  });
});
