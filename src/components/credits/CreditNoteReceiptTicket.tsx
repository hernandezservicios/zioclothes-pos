import React from 'react';
import { CreditNote, SystemSettings } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

interface CreditNoteReceiptTicketProps {
  creditNote: CreditNote;
  settings: SystemSettings;
  paperWidth?: '80mm' | '58mm';
  id?: string;
  className?: string;
}

/**
 * FASE 6 — Ticket térmico imprimible para un Crédito a Favor/Vale o una
 * Nota de Crédito (misma entidad de backend, `Creditos_Favor`, distinguida
 * por `tipo`). Sigue el mismo patrón visual/estructural de
 * InstallmentReceiptTicket.tsx (header del negocio, bloque de datos del
 * documento, desglose de montos, footer configurable) -- sin rediseño.
 *
 * Importante (Parte 4 de Fase 6): este documento es un comprobante
 * INTERNO/operativo del negocio, no un comprobante fiscal. Nunca se rotula
 * como "comprobante fiscal", no incluye NCF/e-CF -- una integración fiscal
 * real, si se decide, es una fase futura separada.
 */
export const CreditNoteReceiptTicket: React.FC<CreditNoteReceiptTicketProps> = ({
  creditNote,
  settings,
  paperWidth = '80mm',
  id = 'credit-note-thermal-receipt',
  className = '',
}) => {
  const is58mm = paperWidth === '58mm';
  const esNota = creditNote.tipo === 'NOTA_CREDITO';
  const tituloDocumento = esNota ? 'NOTA DE CRÉDITO' : 'CRÉDITO A FAVOR / VALE';

  const estadoLabel: Record<string, string> = {
    EMITIDA: 'EMITIDA (Saldo Completo Disponible)',
    PARCIALMENTE_APLICADA: 'PARCIALMENTE APLICADA',
    APLICADA: 'APLICADA EN SU TOTALIDAD',
    ANULADA: 'ANULADA',
  };

  return (
    <div
      id={id}
      className={`credit-note-ticket ${is58mm ? 'credit-note-ticket--58mm' : 'credit-note-ticket--80mm'} ${className}`}
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
          {tituloDocumento}
        </div>
        <div style={{ fontSize: is58mm ? '8px' : '9px', fontWeight: 600, marginTop: '2px' }}>
          Documento interno del negocio -- no es un comprobante fiscal
        </div>
      </header>

      {/* 2. DOCUMENT & CLIENT INFO */}
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
          <strong style={{ fontWeight: 800 }}>N° {esNota ? 'NOTA' : 'VALE'}:</strong>
          <span style={{ fontWeight: 800 }}>{creditNote.numero}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Fecha de Emisión:</span>
          <span>{formatDateTime(creditNote.fechaCreacion)}</span>
        </div>
        {creditNote.ventaOrigenId && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Venta Origen:</span>
            <span>{creditNote.ventaOrigenId}</span>
          </div>
        )}
        {creditNote.devolucionId && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Devolución Origen:</span>
            <span>{creditNote.devolucionId}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Cliente:</span>
          <strong style={{ fontWeight: 800, textAlign: 'right' }}>{creditNote.clienteNombre}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Emitido por:</span>
          <span>{creditNote.usuarioNombre}</span>
        </div>
      </section>

      {/* 3. AMOUNT BREAKDOWN */}
      <section
        style={{
          fontSize: is58mm ? '11px' : '12.5px',
          paddingBottom: '6px',
          borderBottom: '1.5px solid #000000',
          marginBottom: '6px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span>Monto Original:</span>
          <span style={{ fontWeight: 700 }}>{formatCurrency(creditNote.montoOriginal, settings.simboloMoneda)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span>Monto Aplicado:</span>
          <span style={{ fontWeight: 700 }}>{formatCurrency(creditNote.montoAplicado, settings.simboloMoneda)}</span>
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
          <span>SALDO DISPONIBLE:</span>
          <span>{formatCurrency(creditNote.saldoDisponible, settings.simboloMoneda)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: is58mm ? '10px' : '11.5px', paddingTop: '3px' }}>
          <span>Estado:</span>
          <strong style={{ fontWeight: 800 }}>{estadoLabel[creditNote.estado] || creditNote.estado}</strong>
        </div>
      </section>

      {/* 4. FOOTER */}
      <footer style={{ textAlign: 'center', fontSize: is58mm ? '9.5px' : '11px', lineHeight: 1.35, paddingTop: '4px' }}>
        <div style={{ fontWeight: 800, textTransform: 'uppercase', marginBottom: '2px' }}>
          Conserve este documento para reclamar su saldo
        </div>
        {settings.mensajeReciboPie && (
          <div style={{ fontSize: is58mm ? '9px' : '10px', color: '#000000' }}>{settings.mensajeReciboPie}</div>
        )}
        <div style={{ marginTop: '6px', fontSize: is58mm ? '8.5px' : '9.5px', letterSpacing: '0.3px' }}>
          {settings.nombreNegocio || 'ZIO CLOTHES'}
        </div>
      </footer>
    </div>
  );
};
