import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useScrollEdgeIndicators } from './useScrollEdgeIndicators';
import { ScrollEdgeArrows } from '../components/layout/ScrollEdgeArrows';

/**
 * AJUSTE VISUAL -- flechas discretas ↑/↓ en reemplazo del scrollbar
 * nativo oculto (Sidebar <nav> y App.tsx <main>). jsdom NO calcula layout
 * real -- `scrollHeight`/`clientHeight` valen 0 por defecto -- así que,
 * como es el patrón estándar de RTL para este escenario, se redefinen
 * esas propiedades directamente sobre el nodo real vía
 * `Object.defineProperty` para simular contenido corto/largo y distintas
 * posiciones de scroll, y se dispara el evento `scroll` a mano.
 */

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const { canScrollUp, canScrollDown, scrollStep } = useScrollEdgeIndicators(ref);
  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} data-testid="scroll-box" style={{ overflowY: 'auto' }}>
        <div>contenido</div>
      </div>
      <ScrollEdgeArrows
        canScrollUp={canScrollUp}
        canScrollDown={canScrollDown}
        onScrollUp={() => scrollStep('up')}
        onScrollDown={() => scrollStep('down')}
      />
    </div>
  );
}

/** Redefine scrollHeight/clientHeight/scrollTop sobre el nodo real (jsdom
 *  los deja en 0/no-escribibles por defecto) y dispara `scroll` para que
 *  el hook recalcule, tal como haría un navegador real. */
function setScrollState(el: HTMLElement, { scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  fireEvent.scroll(el);
}

function upArrow() {
  return screen.getByLabelText('Ver contenido anterior');
}
function downArrow() {
  return screen.getByLabelText('Ver más contenido abajo');
}

describe('useScrollEdgeIndicators + ScrollEdgeArrows', () => {
  afterEach(() => cleanup());

  // TEST 1 -- contenido corto que no requiere scroll.
  it('contenido corto: ninguna flecha visible (ambas aria-hidden)', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 200 });

    expect(upArrow()).toHaveAttribute('aria-hidden', 'true');
    expect(downArrow()).toHaveAttribute('aria-hidden', 'true');
    expect(upArrow()).toHaveAttribute('tabindex', '-1');
    expect(downArrow()).toHaveAttribute('tabindex', '-1');
  });

  // TEST 2 -- contenido largo, aún arriba del todo: aparece ↓, no ↑.
  it('contenido largo, posición inicial: aparece ↓ pero no ↑', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 800 });

    expect(downArrow()).toHaveAttribute('aria-hidden', 'false');
    expect(upArrow()).toHaveAttribute('aria-hidden', 'true');
  });

  // TEST 3/5 -- al desplazarse a una posición intermedia: ambas flechas.
  it('al desplazarse a una posición intermedia: aparecen ↑ y ↓ (queda contenido en ambas direcciones)', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 800 });
    setScrollState(box, { scrollTop: 300, clientHeight: 200, scrollHeight: 800 });

    expect(upArrow()).toHaveAttribute('aria-hidden', 'false');
    expect(downArrow()).toHaveAttribute('aria-hidden', 'false');
  });

  // TEST 4 -- llegar completamente al final: ↓ desaparece.
  it('al llegar al final: ↓ desaparece, ↑ permanece', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 800 });
    setScrollState(box, { scrollTop: 600, clientHeight: 200, scrollHeight: 800 });

    expect(downArrow()).toHaveAttribute('aria-hidden', 'true');
    expect(upArrow()).toHaveAttribute('aria-hidden', 'false');
  });

  // TEST 6 -- volver al inicio: ↑ desaparece de nuevo.
  it('al volver al inicio: ↑ desaparece', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 800 });
    setScrollState(box, { scrollTop: 600, clientHeight: 200, scrollHeight: 800 });
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 800 });

    expect(upArrow()).toHaveAttribute('aria-hidden', 'true');
    expect(downArrow()).toHaveAttribute('aria-hidden', 'false');
  });

  // TEST 7 -- contenido dinámico: agregar contenido activa el indicador
  // sin que el propio componente dispare `scroll` manualmente -- el
  // MutationObserver interno del hook es quien debe recalcular.
  it('contenido dinámico: agregar filas activa ↓ automáticamente (vía MutationObserver)', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    // Arranca "corto" -- sin necesidad de scroll.
    Object.defineProperty(box, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 200, configurable: true });
    fireEvent.scroll(box);
    expect(downArrow()).toHaveAttribute('aria-hidden', 'true');

    // Ahora "crece" el contenido real (scrollHeight ya no cabe) y se
    // agrega un nodo -- el MutationObserver debe disparar la recomputación.
    Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true });
    const extra = document.createElement('div');
    extra.textContent = 'fila nueva';
    box.appendChild(extra);

    return vi.waitFor(() => {
      expect(downArrow()).toHaveAttribute('aria-hidden', 'false');
    });
  });

  // TEST -- interacción: clic en ↓ desplaza suavemente (scrollBy), no
  // salta directo al final.
  it('clic en ↓ llama a scrollBy con una cantidad parcial (nunca directo al final)', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 0, clientHeight: 200, scrollHeight: 800 });

    const scrollBySpy = vi.fn();
    // jsdom no implementa scrollBy -- se define explícitamente para
    // poder aserir cómo se lo invoca, igual que se hace con scrollIntoView.
    Object.defineProperty(box, 'scrollBy', { value: scrollBySpy, configurable: true });

    fireEvent.click(downArrow());

    expect(scrollBySpy).toHaveBeenCalledTimes(1);
    const arg = scrollBySpy.mock.calls[0][0];
    expect(arg.top).toBeGreaterThan(0);
    expect(arg.top).toBeLessThan(800); // nunca salta directo al final
    expect(arg.behavior).toBe('smooth');
  });

  // TEST -- clic en ↑ desplaza hacia arriba (top negativo).
  it('clic en ↑ llama a scrollBy con top negativo', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    setScrollState(box, { scrollTop: 600, clientHeight: 200, scrollHeight: 800 });

    const scrollBySpy = vi.fn();
    Object.defineProperty(box, 'scrollBy', { value: scrollBySpy, configurable: true });

    fireEvent.click(upArrow());

    expect(scrollBySpy).toHaveBeenCalledTimes(1);
    expect(scrollBySpy.mock.calls[0][0].top).toBeLessThan(0);
  });

  // TEST -- accesibilidad: aria-label descriptivo y sin depender solo del color.
  it('las flechas tienen aria-label descriptivo (no dependen únicamente de color/ícono)', () => {
    render(<Harness />);
    const box = screen.getByTestId('scroll-box');
    // Posición intermedia -- ambas flechas visibles/accesibles a la vez.
    setScrollState(box, { scrollTop: 300, clientHeight: 200, scrollHeight: 800 });

    expect(screen.getByRole('button', { name: 'Ver contenido anterior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver más contenido abajo' })).toBeInTheDocument();
  });
});
