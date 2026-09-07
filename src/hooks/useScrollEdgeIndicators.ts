import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * AJUSTE VISUAL -- indicadores de scroll (flechas discretas) para los dos
 * paneles con scroll real de la app (el <nav> del Sidebar y el <main> de
 * contenido en App.tsx). Ninguno de los dos usa un tercer componente en
 * común hoy, así que la parte que SÍ es idéntica entre ambos -- detectar
 * si hay contenido arriba/abajo del área visible y desplazar suavemente
 * al hacer clic -- se extrae aquí para no duplicar la lógica.
 *
 * Nunca decide overflow/scroll real: solo LEE `scrollTop`/`scrollHeight`/
 * `clientHeight` del elemento ya scrolleable (el `overflow-y-auto` sigue
 * siendo exactamente el mismo de siempre) y expone si hay más contenido
 * en cada dirección más un helper para desplazarse.
 */

const EDGE_TOLERANCE_PX = 4;

export interface ScrollEdgeIndicators {
  /** Hay contenido oculto por encima del área visible. */
  canScrollUp: boolean;
  /** Hay contenido oculto por debajo del área visible. */
  canScrollDown: boolean;
  /** Recalcula el estado a partir de las dimensiones reales actuales. */
  recompute: () => void;
  /** Desplaza suavemente ~60% de la altura visible (nunca salta directo al final). */
  scrollStep: (direction: 'up' | 'down') => void;
}

export function useScrollEdgeIndicators<T extends HTMLElement>(
  containerRef: RefObject<T | null>
): ScrollEdgeIndicators {
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setCanScrollUp(scrollTop > EDGE_TOLERANCE_PX);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE_PX);
  }, [containerRef]);

  // Se guarda en un ref para que el useEffect de abajo no necesite
  // re-suscribirse cada vez que `recompute` cambia de identidad.
  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handle = () => recomputeRef.current();
    handle();

    el.addEventListener('scroll', handle, { passive: true });
    window.addEventListener('resize', handle);

    // Recalcula cuando cambia el TAMAÑO del propio contenedor (ej. el
    // usuario redimensiona la ventana/el layout responsive cambia).
    // ResizeObserver no existe en jsdom (entorno de pruebas) -- se activa
    // solo si el navegador real lo soporta, sin romper nada donde no.
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handle);
      resizeObserver.observe(el);
    }

    // Recalcula cuando cambia el CONTENIDO scrolleable (contenido
    // dinámico: filas que se agregan/quitan, secciones que aparecen o
    // desaparecen por permisos, etc.) sin depender de que cada pantalla
    // que use este hook recuerde pasar sus propias dependencias.
    let mutationObserver: MutationObserver | undefined;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(handle);
      mutationObserver.observe(el, { childList: true, subtree: true });
    }

    return () => {
      el.removeEventListener('scroll', handle);
      window.removeEventListener('resize', handle);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [containerRef]);

  const scrollStep = useCallback(
    (direction: 'up' | 'down') => {
      const el = containerRef.current;
      if (!el) return;
      // ~60% de lo visible -- avanza "una cantidad razonable", nunca
      // salta directo al inicio/final (requisito explícito de la tarea).
      const amount = Math.max(el.clientHeight * 0.6, 80);
      el.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'smooth' });
    },
    [containerRef]
  );

  return { canScrollUp, canScrollDown, recompute, scrollStep };
}
