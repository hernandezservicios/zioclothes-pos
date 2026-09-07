import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { InitialSetupView } from './InitialSetupView';
import { storageService } from '../../services/storageService';
import { apiService } from '../../services/apiService';

/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 *
 * Ejercita InitialSetupView.tsx TAL COMO ES. Solo se sustituye
 * `apiService.checkBackendConnection` (la prueba de red real -- ya
 * probada por separado en apiService.test.ts) y `storageService.
 * setGoogleAppsScriptUrl` (para verificar que es el ÚNICO punto de
 * escritura, sin inspeccionar localStorage directamente).
 */

vi.mock('../../services/storageService', () => ({
  storageService: {
    setGoogleAppsScriptUrl: vi.fn(),
  },
}));

vi.mock('../../services/apiService', () => ({
  apiService: {
    checkBackendConnection: vi.fn(),
  },
}));

const VALID_URL = 'https://script.google.com/macros/s/AKfycbyABC123/exec';

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(onConfigured).toHaveBeenCalledTimes(1);
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
