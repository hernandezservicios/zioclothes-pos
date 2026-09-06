import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContext';

/**
 * FASE — SISTEMA GLOBAL DE ALERTAS Y NOTIFICACIONES, Parte 2/19.
 *
 * Verifica el ÚNICO requisito visual global de esta fase sobre el
 * sistema de Toast ya existente: debe aparecer en la esquina SUPERIOR
 * derecha, nunca abajo. No se prueba nada más de ToastContext (su
 * comportamiento de auto-cierre, tipos, etc. no cambió en esta fase).
 */

function TriggerButton() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Guardado', 'Operación completada', 'exito')}>Disparar Toast</button>
  );
}

afterEach(() => {
  cleanup();
});

describe('ToastContext -- posición global (Parte 2/19 de esta fase)', () => {
  it('TEST 1: el contenedor de toasts usa una clase de posicionamiento superior (top-right)', () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Disparar Toast'));

    const container = document.getElementById('toast-container');
    expect(container).toBeTruthy();
    expect(container!.className).toMatch(/\btop-\d+\b/);
    expect(container!.className).toMatch(/\bright-\d+\b/);
  });

  it('TEST 2: el contenedor de toasts NUNCA usa una clase de posicionamiento inferior (bottom-*)', () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Disparar Toast'));

    const container = document.getElementById('toast-container');
    expect(container).toBeTruthy();
    expect(container!.className).not.toMatch(/\bbottom-/);
  });

  it('el toast disparado realmente se muestra dentro del contenedor superior derecho', () => {
    render(
      <ToastProvider>
        <TriggerButton />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Disparar Toast'));

    const container = document.getElementById('toast-container');
    expect(container?.textContent).toContain('Operación completada');
  });
});
