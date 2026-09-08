import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Navbar } from './Navbar';
import { Sidebar } from './Sidebar';

/**
 * FASE -- AUDITORÍA Y CORRECCIÓN: REGRESIÓN DE IMÁGENES Y LOGO.
 *
 * Cubre el requisito 6 de la tarea: "SÍ debe existir un fallback visual
 * para cuando UNA imagen individual realmente no exista" -- antes de esta
 * fase, si `settings.logoUrl` tenía un valor pero la imagen fallaba al
 * cargar (Drive, red, permiso -- cualquier causa real), el `<img>` se
 * quedaba mostrando el ícono roto del navegador para siempre, porque
 * `settings.logoUrl ? <img> : <fallback>` nunca se reevalúa tras un fallo
 * de RED -- solo reacciona a si el VALOR de la URL existe o no. `onError`
 * cae al MISMO emblema "Z" que ya existía como fallback -- nunca se
 * inventó un fallback nuevo, nunca se tocó `toDisplayableImageUrl` ni la
 * URL real. jsdom no ejecuta peticiones de red reales -- estas pruebas
 * disparan el evento `error` sintético del propio `<img>` (patrón
 * estándar de Testing Library para simular un fallo de carga real, sin
 * inventar resultados de red).
 */

let mockSettings = {
  logoUrl: '',
  nombreNegocio: 'ZIO CLOTHES',
  simboloMoneda: 'RD$',
  impuestoPorcentaje: 18,
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { id: 'U1', nombre: 'Cajera', apellido: 'Prueba', rol: 'ADMIN' },
    logout: vi.fn(),
    canView: () => true,
    activeCashSession: null,
    settings: mockSettings,
  }),
}));

vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

beforeEach(() => {
  mockSettings = { logoUrl: '', nombreNegocio: 'ZIO CLOTHES', simboloMoneda: 'RD$', impuestoPorcentaje: 18 };
});
afterEach(() => cleanup());

describe('Navbar -- logo con fallback ante fallo real de carga', () => {
  it('URL de logo válida: renderiza el <img> real, ya transformado por toDisplayableImageUrl', () => {
    mockSettings = { ...mockSettings, logoUrl: 'https://drive.google.com/uc?export=view&id=ABC123' };
    render(<Navbar onToggleSidebar={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);
    const img = screen.getByAltText('ZIO CLOTHES') as HTMLImageElement;
    // Misma transformación de siempre, sin cambios: uc?export=view -> thumbnail?id=
    // (evita el bloqueo real de CORP de Drive documentado en imageUrl.ts).
    expect(img.src).toBe('https://drive.google.com/thumbnail?id=ABC123');
  });

  it('sin logo configurado: muestra el emblema "Z" (comportamiento ya existente, sin cambios)', () => {
    render(<Navbar onToggleSidebar={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('URL de logo inválida (falla real de carga): cae al fallback "Z" en vez del ícono roto del navegador', () => {
    mockSettings = { ...mockSettings, logoUrl: 'https://drive.google.com/uc?export=view&id=ROTO' };
    render(<Navbar onToggleSidebar={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);

    const img = screen.getByAltText('ZIO CLOTHES');
    expect(screen.queryByText('Z')).not.toBeInTheDocument();

    // Simula el fallo real de red/CORS/Drive que el navegador reporta al
    // <img> -- mismo mecanismo con el que un navegador real avisa que la
    // imagen no cargó, sin inventar ningún resultado de red.
    fireEvent.error(img);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Z')).toBeInTheDocument();
  });
});

describe('Sidebar -- logo con fallback ante fallo real de carga', () => {
  it('URL de logo válida: renderiza el <img> real', () => {
    mockSettings = { ...mockSettings, logoUrl: 'https://drive.google.com/uc?export=view&id=XYZ789' };
    render(<Sidebar isOpen={false} onClose={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);
    const img = screen.getByAltText('ZIO CLOTHES') as HTMLImageElement;
    expect(img.src).toBe('https://drive.google.com/thumbnail?id=XYZ789');
  });

  it('URL de logo inválida (falla real de carga): cae al fallback "Z"', () => {
    mockSettings = { ...mockSettings, logoUrl: 'https://drive.google.com/uc?export=view&id=ROTO' };
    render(<Sidebar isOpen={false} onClose={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);

    const img = screen.getByAltText('ZIO CLOTHES');
    fireEvent.error(img);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('el logo se reintenta si la URL configurada cambia (no queda atascado en el fallback de una URL vieja)', () => {
    mockSettings = { ...mockSettings, logoUrl: 'https://drive.google.com/uc?export=view&id=PRIMERO' };
    const { rerender } = render(<Sidebar isOpen={false} onClose={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);
    fireEvent.error(screen.getByAltText('ZIO CLOTHES'));
    expect(screen.getByText('Z')).toBeInTheDocument();

    // El admin sube/corrige el logo -- nueva URL real.
    mockSettings = { ...mockSettings, logoUrl: 'https://drive.google.com/uc?export=view&id=SEGUNDO' };
    rerender(<Sidebar isOpen={false} onClose={vi.fn()} activeView="dashboard" onNavigate={vi.fn()} />);

    const img = screen.getByAltText('ZIO CLOTHES') as HTMLImageElement;
    expect(img.src).toBe('https://drive.google.com/thumbnail?id=SEGUNDO');
  });
});
