import React from 'react';
import { PaymentInstallment, SystemSettings } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

interface InstallmentReceiptTicketProps {
  installment: PaymentInstallment;
  settings: SystemSettings;
  paperWidth?: '80mm' | '58mm';
  id?: string;
  className?: string;
}

export const InstallmentReceiptTicket: React.FC<InstallmentReceiptTicketProps> = ({
  installment,
  settings,
  paperWidth = '80mm',
  id = 'installment-thermal-receipt',
  className = '',
}) => {
  const is58mm = paperWidth === '58mm';
  const receiptNumber = installment.numeroRecibo || installment.numeroAbono || installment.id;
  const saldoAnterior = installment.saldoAnterior ?? 0;
  const montoAbonado = installment.montoAbonado ?? 0;
  const saldoRestante = installment.saldoRestante ?? installment.saldoNuevo ?? Math.max(0, saldoAnterior - montoAbonado);
  const referencia = installment.referencia || installment.referenciaPago;
  const notas = installment.observaciones || installment.notas;

  return (
    <div
      id={id}
      className={`installment-ticket ${is58mm ? 'installment-ticket--58mm' : 'installment-ticket--80mm'} ${className}`}
      style={{
        fontFamily: 'Arial, Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#000000',
        backgroundColor: '#FFFFFF',
        width: is58mm ? '58mm' : '80mm',
        maxWidth: is58mm ? '58mm' : '80mm',
        margin: '0 auto',
        padding: is58mm ? '3mm 2mm' : '4mm 3mm',
        boxSizing: 'border-box',
        lineHeight: 1.35,
        fontWeight: 600,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* 1. HEADER */}
      <header
        style={{
          textAlign: 'center',
          paddingBottom: '6px',
          borderBottom: '1.5px dashed #000000',
          marginBottom: '6px',
        }}
      >
        <div
          style={{
            fontSize: is58mm ? '15px' : '18px',
            fontWeight: 800,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: '#000000',
            marginBottom: '2px',
          }}
        >
          {settings.nombreNegocio || 'ZIO CLOTHES'}
        </div>
        {settings.eslogan && (
          <div
            style={{
              fontSize: is58mm ? '10px' : '11.5px',
              fontWeight: 700,
              color: '#000000',
              marginBottom: '3px',
              textTransform: 'uppercase',
            }}
          >
            {settings.eslogan}
          </div>
        )}
        <div
          style={{
            fontSize: is58mm ? '10px' : '11.5px',
            fontWeight: 600,
            color: '#000000',
            lineHeight: 1.35,
          }}
        >
          {settings.rnc && (
            <div>
              <strong style={{ fontWeight: 800 }}>RNC:</strong> {settings.rnc}
            </div>
          )}
          {settings.direccion && <div style={{ fontWeight: 600 }}>{settings.direccion}</div>}
          {settings.telefono && (
            <div>
              <strong style={{ fontWeight: 800 }}>Tel:</strong> {settings.telefono}
            </div>
          )}
        </div>
        <div
          style={{
            marginTop: '4px',
            paddingTop: '3px',
            borderTop: '1px solid #000000',
            fontSize: is58mm ? '11px' : '13px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          COMPROBANTE DE ABONO A CUENTA
        </div>
      </header>

      {/* 2. RECEIPT & CLIENT INFO */}
      <section
        style={{
          fontSize: is58mm ? '10.5px' : '12px',
          paddingBottom: '6px',
          borderBottom: '1px dashed #000000',
          marginBottom: '6px',
          lineHeight: 1.4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <strong style={{ fontWeight: 800 }}>RECIBO N°:</strong>
          <span style={{ fontWeight: 800 }}>{receiptNumber}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Fecha/Hora:</span>
          <span>{formatDateTime(installment.fecha)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Cuenta por Cobrar:</span>
          <strong style={{ fontWeight: 800 }}>#{installment.cuentaCobrarId}</strong>
        </div>
        {installment.numeroVenta && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Factura Origen:</span>
            <span>{installment.numeroVenta}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Cliente:</span>
          <strong style={{ fontWeight: 800, textAlign: 'right' }}>{installment.clienteNombre}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Cajero:</span>
          <span>{installment.usuarioNombre}</span>
        </div>
      </section>

      {/* 3. PAYMENT BREAKDOWN */}
      <section
        style={{
          fontSize: is58mm ? '11px' : '12.5px',
          paddingBottom: '6px',
          borderBottom: '1.5px solid #000000',
          marginBottom: '6px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '3px 0',
            fontSize: is58mm ? '11px' : '12px',
          }}
        >
          <span>Saldo Anterior:</span>
          <span style={{ fontWeight: 700 }}>
            {formatCurrency(saldoAnterior, settings.simboloMoneda)}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            fontSize: is58mm ? '13px' : '15px',
            fontWeight: 900,
            borderTop: '1px solid #000000',
            borderBottom: '1px solid #000000',
            margin: '3px 0',
          }}
        >
          <span>MONTO ABONADO:</span>
          <span>{formatCurrency(montoAbonado, settings.simboloMoneda)}</span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '3px 0',
            fontSize: is58mm ? '11.5px' : '13px',
            fontWeight: 800,
          }}
        >
          <span>SALDO RESTANTE:</span>
          <span style={{ color: saldoRestante === 0 ? '#000000' : '#000000' }}>
            {saldoRestante === 0 ? 'SALDADO (RD$ 0.00)' : formatCurrency(saldoRestante, settings.simboloMoneda)}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: is58mm ? '10px' : '11.5px',
            paddingTop: '3px',
          }}
        >
          <span>Forma de Pago:</span>
          <strong style={{ fontWeight: 800 }}>{installment.metodoPago}</strong>
        </div>

        {referencia && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: is58mm ? '10px' : '11px',
            }}
          >
            <span>Referencia:</span>
            <span>{referencia}</span>
          </div>
        )}

        {notas && (
          <div
            style={{
              fontSize: is58mm ? '9.5px' : '11px',
              paddingTop: '2px',
              fontStyle: 'italic',
            }}
          >
            Nota: {notas}
          </div>
        )}
      </section>

      {/* 4. FOOTER & POLICIES */}
      <footer
        style={{
          textAlign: 'center',
          fontSize: is58mm ? '9.5px' : '11px',
          lineHeight: 1.35,
          paddingTop: '4px',
        }}
      >
        <div style={{ fontWeight: 800, textTransform: 'uppercase', marginBottom: '2px' }}>
          {saldoRestante === 0 ? '¡CUENTA SALDADA EN SU TOTALIDAD!' : '¡GRACIAS POR SU ABONO!'}
        </div>
        <div style={{ fontSize: is58mm ? '9px' : '10px', color: '#000000' }}>
          {settings.mensajeReciboPie || 'Conserve este comprobante como respaldo de su pago.'}
        </div>
        <div
          style={{
            marginTop: '6px',
            fontSize: is58mm ? '8.5px' : '9.5px',
            letterSpacing: '0.3px',
          }}
        >
          {settings.nombreNegocio || 'ZIO CLOTHES'} • Sistema POS
        </div>
      </footer>
    </div>
  );
};
