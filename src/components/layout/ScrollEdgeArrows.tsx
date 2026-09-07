import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

/**
 * AJUSTE VISUAL -- indicador flotante y discreto de "hay más contenido
 * arriba/abajo", usado ÚNICAMENTE por los dos paneles cuyo scrollbar
 * nativo se ocultó (el <nav> del Sidebar y el <main> de contenido en
 * App.tsx -- ver `.no-native-scrollbar` en index.css). Debe montarse
 * dentro de un contenedor `position: relative` que envuelva al elemento
 * scrolleable, como hermano de este (nunca como descendiente de él) --
 * así el indicador NO se desplaza junto con el contenido ni le resta
 * espacio (siempre `position: absolute`, nunca ocupa layout).
 *
 * AJUSTE DE POSICIÓN (mismo componente/control, sin cambios de
 * funcionalidad): ancladas a `right-1.5` -- el EXTREMO DERECHO de su
 * contenedor, exactamente la franja donde antes se dibujaba el
 * scrollbar nativo -- en vez de centradas horizontalmente
 * (`left-1/2 -translate-x-1/2`, como estaban antes). `right-*` es un
 * offset fijo desde el borde derecho, así que en cualquier ancho de
 * pantalla (escritorio/laptop/tablet/móvil) el botón permanece pegado a
 * ese borde y nunca se desplaza hacia el centro, dejando la zona central
 * de lectura completamente libre.
 *
 * Los botones permanecen siempre montados y solo cambian opacidad/
 * `pointer-events` (transición suave de aparición/desaparición sin
 * depender de una librería de animación) -- así nunca bloquean clics en
 * el contenido real cuando están ocultos, y no reciben foco por teclado
 * en ese estado (`tabIndex={-1}` + `aria-hidden`).
 */
interface ScrollEdgeArrowsProps {
  canScrollUp: boolean;
  canScrollDown: boolean;
  onScrollUp: () => void;
  onScrollDown: () => void;
  labelUp?: string;
  labelDown?: string;
}

const baseButtonClass =
  'absolute right-1.5 z-10 w-6 h-6 rounded-full bg-white/95 border border-[#E4DDD2] shadow-sm flex items-center justify-center text-[#756E65] transition-opacity duration-200 hover:text-[#2F2A25] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F2A25]/30';

export const ScrollEdgeArrows: React.FC<ScrollEdgeArrowsProps> = ({
  canScrollUp,
  canScrollDown,
  onScrollUp,
  onScrollDown,
  labelUp = 'Ver contenido anterior',
  labelDown = 'Ver más contenido abajo',
}) => (
  <>
    <button
      type="button"
      onClick={onScrollUp}
      aria-label={labelUp}
      aria-hidden={!canScrollUp}
      tabIndex={canScrollUp ? 0 : -1}
      title={labelUp}
      className={`${baseButtonClass} top-1 ${canScrollUp ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <ChevronUp className="w-3.5 h-3.5" />
    </button>
    <button
      type="button"
      onClick={onScrollDown}
      aria-label={labelDown}
      aria-hidden={!canScrollDown}
      tabIndex={canScrollDown ? 0 : -1}
      title={labelDown}
      className={`${baseButtonClass} bottom-1 ${canScrollDown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <ChevronDown className="w-3.5 h-3.5" />
    </button>
  </>
);
