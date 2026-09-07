import { describe, it, expect } from 'vitest';
import { roundMoney, computeCashSettlement, computeMixedPaymentTotals } from './formatters';

/**
 * FASE — AUDITORÍA Y CORRECCIÓN CRÍTICA / MODAL POS COBRO DE VENTA.
 *
 * Regresión corregida: el modal de Cobro de Venta (PaymentModal.tsx)
 * calculaba el "Cambio a Devolver" con `Math.max(0, recibido - total)`,
 * que colapsa "el cliente pagó de menos" y "el cliente pagó exacto" en el
 * mismo RD$0.00 visible -- sin ninguna forma de distinguir un pago
 * insuficiente de uno saldado. `computeCashSettlement` es ahora la única
 * fuente de verdad de ese cálculo (usada tanto por el recuadro que lo
 * muestra en pantalla como por la validación del botón "Completar
 * Venta"), y estos son sus 10 casos de prueba obligatorios.
 */

describe('computeCashSettlement', () => {
  // TEST 1
  it('recibido menor al total: no hay cambio, hay faltante', () => {
    expect(computeCashSettlement(5000, 5400)).toEqual({ change: 0, due: 400 });
  });

  // TEST 2
  it('recibido igual al total: ni cambio ni faltante', () => {
    expect(computeCashSettlement(5400, 5400)).toEqual({ change: 0, due: 0 });
  });

  // TEST 3
  it('recibido mayor al total: hay cambio, no hay faltante', () => {
    expect(computeCashSettlement(6000, 5400)).toEqual({ change: 600, due: 0 });
  });

  // TEST 4
  it('total mínimo (RD$1) sin nada recibido: faltante = total completo', () => {
    expect(computeCashSettlement(0, 1)).toEqual({ change: 0, due: 1 });
  });

  // TEST 5
  it('venta de RD$0 sin nada recibido: ni cambio ni faltante', () => {
    expect(computeCashSettlement(0, 0)).toEqual({ change: 0, due: 0 });
  });

  // TEST 6
  it('centavos -- pagó de más: el cambio no arrastra errores de coma flotante', () => {
    expect(computeCashSettlement(6000.0, 5400.5)).toEqual({ change: 599.5, due: 0 });
  });

  // TEST 7
  it('centavos -- pagó de menos: el faltante no arrastra errores de coma flotante', () => {
    expect(computeCashSettlement(5000.0, 5400.5)).toEqual({ change: 0, due: 400.5 });
  });

  it('nunca reporta cambio y faltante a la vez, para ningún caso', () => {
    const cases: Array<[number, number]> = [[5000, 5400], [5400, 5400], [6000, 5400], [0, 1], [0, 0]];
    for (const [received, total] of cases) {
      const { change, due } = computeCashSettlement(received, total);
      expect(change === 0 || due === 0).toBe(true);
    }
  });

  it('entradas inválidas (NaN/undefined) se tratan como 0, nunca lanzan', () => {
    expect(computeCashSettlement(NaN, 100)).toEqual({ change: 0, due: 100 });
    expect(computeCashSettlement(undefined as unknown as number, 100)).toEqual({ change: 0, due: 100 });
  });
});

describe('computeMixedPaymentTotals (MIXTO)', () => {
  // TEST 8
  it('pago exacto mediante MIXTO: remaining = 0', () => {
    const { assigned, remaining } = computeMixedPaymentTotals(5400, {
      cash: 2000,
      card: 2000,
      transfer: 1000,
      credit: 400,
    });
    expect(assigned).toBe(5400);
    expect(remaining).toBe(0);
  });

  // TEST 9
  it('MIXTO con faltante: remaining > 0 -- nunca debe interpretarse como venta totalmente pagada', () => {
    const { remaining } = computeMixedPaymentTotals(5400, { cash: 2000, card: 2000, transfer: 1000 });
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBe(400);
  });

  // TEST 10
  it('MIXTO con la suma por encima del total: se reporta como diferencia negativa, no se oculta como cuadrado', () => {
    const { remaining } = computeMixedPaymentTotals(5400, { cash: 3000, card: 2000, transfer: 1000 });
    expect(remaining).toBeLessThan(0);
    expect(remaining).toBe(-600);
  });

  it('centavos: la suma de partes no arrastra errores de coma flotante', () => {
    const { assigned, remaining } = computeMixedPaymentTotals(100, { cash: 33.33, card: 33.33, transfer: 33.34 });
    expect(assigned).toBe(100);
    expect(remaining).toBe(0);
  });
});

describe('roundMoney', () => {
  it('corrige el error clásico de coma flotante de JavaScript', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('conserva dos decimales exactos sin alterar el valor', () => {
    expect(roundMoney(5400.5)).toBe(5400.5);
    expect(roundMoney(600)).toBe(600);
  });

  it('trata entradas no numéricas como 0', () => {
    expect(roundMoney(NaN)).toBe(0);
  });
});
