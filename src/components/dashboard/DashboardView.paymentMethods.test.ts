import { describe, it, expect } from 'vitest';
import { computePaymentMethodsData, PaymentMethodBreakdown } from './DashboardView';
import type { Sale, SalePaymentSplit } from '../../types';

/**
 * FASE — CORRECCIÓN CRÍTICA DE GRÁFICOS / MÉTODOS DE PAGO EN DASHBOARD.
 *
 * Regresión específica del bug reportado: EFECTIVO mostraba
 * "RD$ 22,551,000,240,065,016,000,000 (0%)". Causa raíz (ver comentario
 * de `toSafeAmount`/`computePaymentMethodsData` en DashboardView.tsx):
 * el cálculo anterior sumaba con el operador `+` sin forzar `Number(...)`
 * primero -- si `p.monto` llegaba como STRING (Google Sheets puede
 * devolver una celda numérica como texto), `+` concatenaba en vez de
 * sumar, y ese string ya corrupto envenenaba cada suma siguiente.
 *
 * Estas pruebas ejercitan `computePaymentMethodsData` DIRECTAMENTE (una
 * función pura, sin necesidad de montar `DashboardView` completo) con
 * datos que violan deliberadamente el tipo `number` de
 * `SalePaymentSplit.monto` -- exactamente lo que puede llegar en runtime
 * desde un backend/Sheets real, aunque el contrato de TypeScript diga
 * `number`. Los casts `as unknown as Sale[]` son intencionales: sin
 * ellos no se podría probar la defensa en runtime contra un dato que en
 * teoría "nunca debería" no ser numérico.
 */

// Helper mínimo: solo `pagos` importa para esta función -- el resto de
// los campos de `Sale` son irrelevantes para computePaymentMethodsData.
function ventaCon(pagos: Array<Partial<SalePaymentSplit> & { metodo: string }>): Pick<Sale, 'pagos'> {
  return { pagos: pagos as SalePaymentSplit[] };
}

function montoDe(data: PaymentMethodBreakdown[], metodo: string): number | undefined {
  return data.find((d) => d.metodo === metodo)?.monto;
}
function porcentajeDe(data: PaymentMethodBreakdown[], metodo: string): number | undefined {
  return data.find((d) => d.metodo === metodo)?.porcentaje;
}

describe('computePaymentMethodsData -- casos base (Séptima Parte 1-4)', () => {
  it('1) una venta de RD$100 efectivo -> EFECTIVO = 100, 100%', () => {
    const data = computePaymentMethodsData([ventaCon([{ metodo: 'EFECTIVO', monto: 100 }])]);
    expect(montoDe(data, 'EFECTIVO')).toBe(100);
    expect(porcentajeDe(data, 'EFECTIVO')).toBe(100);
    expect(montoDe(data, 'TARJETA')).toBe(0);
    expect(porcentajeDe(data, 'TARJETA')).toBe(0);
  });

  it('2) RD$100 efectivo + RD$50 transferencia -> montos exactos y porcentajes redondeados consistentes con el total', () => {
    const data = computePaymentMethodsData([
      ventaCon([
        { metodo: 'EFECTIVO', monto: 100 },
        { metodo: 'TRANSFERENCIA', monto: 50 },
      ]),
    ]);
    expect(montoDe(data, 'EFECTIVO')).toBe(100);
    expect(montoDe(data, 'TRANSFERENCIA')).toBe(50);
    // Math.round(100/150*100) = Math.round(66.666...) = 67
    // Math.round(50/150*100)  = Math.round(33.333...) = 33
    // (la razón exacta es 66.67%/33.33%; el redondeo a entero ya era el
    // comportamiento de esta pantalla desde el primer commit del repo --
    // no se introduce ni se cambia aquí ninguna precisión nueva).
    expect(porcentajeDe(data, 'EFECTIVO')).toBe(67);
    expect(porcentajeDe(data, 'TRANSFERENCIA')).toBe(33);
  });

  it('3) venta con tarjeta y efectivo combinados', () => {
    const data = computePaymentMethodsData([
      ventaCon([
        { metodo: 'TARJETA', monto: 300 },
        { metodo: 'EFECTIVO', monto: 200 },
      ]),
    ]);
    expect(montoDe(data, 'TARJETA')).toBe(300);
    expect(montoDe(data, 'EFECTIVO')).toBe(200);
    expect(porcentajeDe(data, 'TARJETA')).toBe(60);
    expect(porcentajeDe(data, 'EFECTIVO')).toBe(40);
  });

  it('4) venta con crédito -> CREDITO = monto total, 100%', () => {
    const data = computePaymentMethodsData([ventaCon([{ metodo: 'CREDITO', monto: 1000 }])]);
    expect(montoDe(data, 'CREDITO')).toBe(1000);
    expect(porcentajeDe(data, 'CREDITO')).toBe(100);
  });
});

describe('computePaymentMethodsData -- CREDITO_FAVOR (Cuarta Parte / Séptima Parte 5-7)', () => {
  it('5) venta con CREDITO_FAVOR aplicado cuenta exactamente el monto aplicado', () => {
    const data = computePaymentMethodsData([ventaCon([{ metodo: 'CREDITO_FAVOR', monto: 403.2 }])]);
    expect(montoDe(data, 'CREDITO_FAVOR')).toBe(403.2);
    expect(porcentajeDe(data, 'CREDITO_FAVOR')).toBe(100);
  });

  it('6) crédito a favor aplicado PARCIALMENTE solo cuenta por el monto realmente aplicado, no por el saldo total del vale', () => {
    // El vale original pudo ser de RD$500, pero solo se aplicaron RD$200 a
    // esta venta (PaymentModal.tsx siempre envía el monto aplicado exacto,
    // nunca el saldo total del vale) -- computePaymentMethodsData confía
    // en el monto recibido, no vuelve a calcular ni duplica desde otra
    // fuente.
    const data = computePaymentMethodsData([
      ventaCon([
        { metodo: 'CREDITO_FAVOR', monto: 200 },
        { metodo: 'EFECTIVO', monto: 300 },
      ]),
    ]);
    expect(montoDe(data, 'CREDITO_FAVOR')).toBe(200);
    expect(montoDe(data, 'EFECTIVO')).toBe(300);
  });

  it('7) un crédito a favor EMITIDO pero NUNCA aplicado a ninguna venta no aparece como pago', () => {
    // Arquitectura confirmada (ver ReturnsController/CreditNotesController):
    // un crédito no aplicado nunca genera una línea en `sale.pagos` de
    // NINGUNA venta -- no hay nada que "filtrar" aquí, se prueba pasando
    // ventas que sencillamente no incluyen esa línea.
    const data = computePaymentMethodsData([ventaCon([{ metodo: 'EFECTIVO', monto: 100 }])]);
    expect(data.find((d) => d.metodo === 'CREDITO_FAVOR')).toBeUndefined();
  });
});

describe('computePaymentMethodsData -- exclusiones correctas (Séptima Parte 8-9)', () => {
  it('8) una venta ANULADA no debe seguir contando como pago (mismo filtro que aplica DashboardView antes de llamar a esta función)', () => {
    const ventaAnulada = { estado: 'ANULADA', pagos: [{ metodo: 'EFECTIVO', monto: 999 }] } as unknown as Sale;
    const ventaValida = { estado: 'COMPLETADA', pagos: [{ metodo: 'EFECTIVO', monto: 100 }] } as unknown as Sale;

    // Replica exactamente el filtro que hace DashboardView.tsx antes de
    // pasar `sales` a computePaymentMethodsData.
    const sales = [ventaAnulada, ventaValida].filter((s) => s && s.estado !== 'ANULADA');
    const data = computePaymentMethodsData(sales);

    expect(montoDe(data, 'EFECTIVO')).toBe(100); // NO 1099
  });

  it('9) una devolución no se convierte accidentalmente en un método de pago', () => {
    // Una devolución vive en una estructura completamente distinta
    // (ReturnRecord.montoDevuelto), nunca en Sale.pagos.
    // computePaymentMethodsData solo lee `.pagos` -- cualquier otro campo
    // parecido a un monto (aunque conviva en el mismo objeto de venta) se
    // ignora por completo.
    const ventaConCampoDeDevolucionColado = {
      pagos: [{ metodo: 'EFECTIVO', monto: 100 }],
      // Campo ajeno simulando una fuga accidental de datos de devolución;
      // NO debe sumarse a ningún método de pago.
      montoDevuelto: 500,
    } as unknown as Sale;

    const data = computePaymentMethodsData([ventaConCampoDeDevolucionColado]);
    expect(montoDe(data, 'EFECTIVO')).toBe(100);
    const total = data.reduce((acc, d) => acc + d.monto, 0);
    expect(total).toBe(100); // nunca 600
  });
});

describe('computePaymentMethodsData -- múltiples ventas y métodos (Séptima Parte 10)', () => {
  it('10) agrega correctamente varias ventas con distintos métodos', () => {
    const data = computePaymentMethodsData([
      ventaCon([{ metodo: 'EFECTIVO', monto: 100 }]),
      ventaCon([{ metodo: 'TARJETA', monto: 200 }]),
      ventaCon([
        { metodo: 'EFECTIVO', monto: 50 },
        { metodo: 'TRANSFERENCIA', monto: 75 },
      ]),
      ventaCon([{ metodo: 'CREDITO', monto: 25 }]),
    ]);
    expect(montoDe(data, 'EFECTIVO')).toBe(150);
    expect(montoDe(data, 'TARJETA')).toBe(200);
    expect(montoDe(data, 'TRANSFERENCIA')).toBe(75);
    expect(montoDe(data, 'CREDITO')).toBe(25);
    const total = data.reduce((acc, d) => acc + d.monto, 0);
    expect(total).toBe(450);
  });
});

describe('computePaymentMethodsData -- datos crudos de Google Sheets (Séptima Parte 11-14, LA REGRESIÓN)', () => {
  it('11) un monto que llega como STRING numérico se suma como número, no se concatena', () => {
    const data = computePaymentMethodsData([
      ventaCon([{ metodo: 'EFECTIVO', monto: '100' as unknown as number }]),
    ]);
    expect(montoDe(data, 'EFECTIVO')).toBe(100);
    expect(typeof montoDe(data, 'EFECTIVO')).toBe('number');
  });

  it('12) valores 0, null, undefined y vacío nunca producen NaN ni rompen la suma', () => {
    const data = computePaymentMethodsData([
      ventaCon([
        { metodo: 'EFECTIVO', monto: 0 },
        { metodo: 'EFECTIVO', monto: null as unknown as number },
        { metodo: 'EFECTIVO', monto: undefined as unknown as number },
        { metodo: 'EFECTIVO', monto: '' as unknown as number },
        { metodo: 'EFECTIVO', monto: 50 },
      ]),
    ]);
    expect(montoDe(data, 'EFECTIVO')).toBe(50);
    expect(Number.isNaN(montoDe(data, 'EFECTIVO'))).toBe(false);
  });

  it('13) NUNCA debe aparecer concatenación numérica (100+200+300 debe dar 600, jamás "100200300")', () => {
    const data = computePaymentMethodsData([
      ventaCon([{ metodo: 'EFECTIVO', monto: '100' as unknown as number }]),
      ventaCon([{ metodo: 'EFECTIVO', monto: '200' as unknown as number }]),
      ventaCon([{ metodo: 'EFECTIVO', monto: '300' as unknown as number }]),
    ]);
    const monto = montoDe(data, 'EFECTIVO');
    expect(monto).toBe(600);
    expect(monto).not.toBe('100200300' as unknown as number);
    expect(String(monto)).not.toContain('100200300');
  });

  it('14) regresión específica: muchas ventas con monto tipo string NUNCA deben producir un número gigante como el reportado (RD$ 22,551,000,240,065,016,000,000)', () => {
    // Simula el escenario real que produjo el bug: decenas de ventas cuyo
    // pagos_json (leído desde Google Sheets) trae `monto` como texto.
    const ventasHistoricasConMontoTexto = Array.from({ length: 60 }, () =>
      ventaCon([{ metodo: 'EFECTIVO', monto: '100' as unknown as number }])
    );
    const data = computePaymentMethodsData(ventasHistoricasConMontoTexto);
    const monto = montoDe(data, 'EFECTIVO')!;

    expect(monto).toBe(6000); // 60 * 100, suma numérica real
    expect(Number.isFinite(monto)).toBe(true);
    expect(Number.isSafeInteger(monto)).toBe(true);
    expect(monto).toBeLessThan(1_000_000); // muy lejos de 10^22
    expect(porcentajeDe(data, 'EFECTIVO')).toBe(100); // nunca 0% dominando el total
  });

  it('sin pagos -> todos los montos RD$0 y todos los porcentajes 0% (nunca división que produzca NaN/Infinity)', () => {
    const data = computePaymentMethodsData([]);
    data.forEach((d) => {
      expect(d.monto).toBe(0);
      expect(d.porcentaje).toBe(0);
    });
  });
});
