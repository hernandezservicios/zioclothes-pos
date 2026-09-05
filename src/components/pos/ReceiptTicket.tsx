import React from 'react';
import { Sale, SystemSettings } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

interface ReceiptTicketProps {
  sale: Sale;
  settings: SystemSettings;
  paperWidth?: '80mm' | '58mm';
  id?: string;
  className?: string;
}

export const ReceiptTicket: React.FC<ReceiptTicketProps> = ({
  sale,
  settings,
  paperWidth = '80mm',
  id = 'thermal-receipt-content',
  className = '',
}) => {
  const is58mm = paperWidth === '58mm';

  return (
    <div
      id={id}
      className={`receipt-ticket ${is58mm ? 'receipt-ticket--58mm' : 'receipt-ticket--80mm'} ${className}`}
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
        className="receipt-header"
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
      </header>

      {/* 2. INVOICE INFO */}
      <section
        className="receipt-info"
        style={{
          fontSize: is58mm ? '10px' : '11.5px',
          fontWeight: 600,
          color: '#000000',
          paddingBottom: '6px',
          borderBottom: '1.5px dashed #000000',
          marginBottom: '6px',
          lineHeight: 1.4,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: 800,
            fontSize: is58mm ? '11px' : '13px',
            marginBottom: '3px',
            color: '#000000',
          }}
        >
          <span>FACTURA DE VENTA:</span>
          <span>{sale.numeroVenta}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>Fecha:</span>
          <span style={{ fontWeight: 600 }}>{formatDateTime(sale.fecha)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>Cajero/a:</span>
          <span style={{ fontWeight: 700 }}>{sale.vendedorNombre}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>Cliente:</span>
          <span style={{ fontWeight: 800 }}>{sale.clienteNombre}</span>
        </div>
        {sale.clienteDocumento && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>RNC / Cédula:</span>
            <span style={{ fontWeight: 600 }}>{sale.clienteDocumento}</span>
          </div>
        )}
      </section>

      {/* 3. ITEM TABLE */}
      <section
        className="receipt-items"
        style={{
          paddingBottom: '6px',
          borderBottom: '1.5px dashed #000000',
          marginBottom: '6px',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: is58mm ? '10px' : '11.5px',
            color: '#000000',
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: '1.5px solid #000000',
                fontSize: is58mm ? '9.5px' : '11px',
                fontWeight: 800,
                textAlign: 'left',
                color: '#000000',
              }}
            >
              <th style={{ padding: '3px 0', width: '56%' }}>DESCRIPCIÓN</th>
              <th style={{ padding: '3px 0', width: '16%', textAlign: 'center' }}>CANT</th>
              <th style={{ padding: '3px 0', width: '28%', textAlign: 'right' }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items || []).map((item, idx) => (
              <tr
                key={idx}
                style={{
                  borderBottom:
                    idx === (sale.items || []).length - 1 ? 'none' : '1px dashed #444444',
                }}
              >
                <td
                  style={{
                    padding: '4px 2px 4px 0',
                    verticalAlign: 'top',
                    wordBreak: 'break-word',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      color: '#000000',
                      lineHeight: 1.25,
                    }}
                  >
                    {item.nombreProducto}
                  </div>
                  <div
                    style={{
                      fontSize: is58mm ? '9px' : '10.5px',
                      fontWeight: 600,
                      color: '#000000',
                      marginTop: '1px',
                    }}
                  >
                    {item.talla} / {item.color} @ {formatCurrency(item.precioUnitario, settings.simboloMoneda)}
                  </div>
                </td>
                <td
                  style={{
                    padding: '4px 0',
                    textAlign: 'center',
                    fontWeight: 800,
                    fontSize: is58mm ? '10px' : '12px',
                    verticalAlign: 'top',
                    color: '#000000',
                  }}
                >
                  {item.cantidad}
                </td>
                <td
                  style={{
                    padding: '4px 0',
                    textAlign: 'right',
                    fontWeight: 800,
                    fontSize: is58mm ? '10px' : '12px',
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                    color: '#000000',
                  }}
                >
                  {formatCurrency(item.total, settings.simboloMoneda)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 4. TOTALS */}
      <section
        className="receipt-totals"
        style={{
          fontSize: is58mm ? '10.5px' : '12px',
          fontWeight: 600,
          color: '#000000',
          paddingBottom: '6px',
          borderBottom: '1.5px dashed #000000',
          marginBottom: '6px',
          lineHeight: 1.45,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>SUBTOTAL:</span>
          <span style={{ fontWeight: 700 }}>{formatCurrency(sale.subtotal, settings.simboloMoneda)}</span>
        </div>

        {sale.descuentoTotal > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 800,
              color: '#000000',
            }}
          >
            <span>DESCUENTO:</span>
            <span>-{formatCurrency(sale.descuentoTotal, settings.simboloMoneda)}</span>
          </div>
        )}

        {sale.impuestoTotal > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>ITBIS ({settings.impuestoPorcentaje}%):</span>
            <span style={{ fontWeight: 700 }}>{formatCurrency(sale.impuestoTotal, settings.simboloMoneda)}</span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: is58mm ? '13px' : '15.5px',
            fontWeight: 900,
            borderTop: '2px solid #000000',
            marginTop: '4px',
            paddingTop: '4px',
            color: '#000000',
          }}
        >
          <span>TOTAL:</span>
          <span>{formatCurrency(sale.total, settings.simboloMoneda)}</span>
        </div>
      </section>

      {/* 5. PAYMENT INFORMATION */}
      <section
        className="receipt-payment"
        style={{
          fontSize: is58mm ? '10px' : '11.5px',
          fontWeight: 600,
          color: '#000000',
          paddingBottom: '6px',
          borderBottom: '1.5px dashed #000000',
          marginBottom: '6px',
          lineHeight: 1.4,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            marginBottom: '3px',
            textTransform: 'uppercase',
            color: '#000000',
          }}
        >
          FORMA DE PAGO: {sale.metodoPago}
        </div>

        {(sale.pagos || []).map((p, pIdx) => (
          <div
            key={pIdx}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: is58mm ? '9.5px' : '11px',
              fontWeight: 600,
              paddingLeft: '4px',
              color: '#000000',
            }}
          >
            <span>
              • {p.metodo} {p.referencia ? `(${p.referencia})` : ''}
            </span>
            <span style={{ fontWeight: 700 }}>
              {formatCurrency(p.monto, settings.simboloMoneda)}
            </span>
          </div>
        ))}

        {sale.efectivoRecibido !== undefined && sale.efectivoRecibido > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: is58mm ? '9.5px' : '11px',
              fontWeight: 600,
              paddingLeft: '4px',
              marginTop: '2px',
              color: '#000000',
            }}
          >
            <span style={{ fontWeight: 700 }}>Efectivo Recibido:</span>
            <span style={{ fontWeight: 700 }}>{formatCurrency(sale.efectivoRecibido, settings.simboloMoneda)}</span>
          </div>
        )}

        {sale.cambioEntregado !== undefined && sale.cambioEntregado > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: is58mm ? '10px' : '12px',
              fontWeight: 800,
              paddingLeft: '4px',
              color: '#000000',
              marginTop: '2px',
            }}
          >
            <span>CAMBIO ENTREGADO:</span>
            <span>{formatCurrency(sale.cambioEntregado, settings.simboloMoneda)}</span>
          </div>
        )}

        {/* Highlighted Credit Section if Sale is on Credit */}
        {(sale.esCredito || sale.metodoPago === 'CREDITO' || sale.cuentaCobrarId) && (
          <div
            className="receipt-credit-box"
            style={{
              marginTop: '5px',
              padding: '6px 7px',
              border: '2px solid #000000',
              borderRadius: '4px',
              backgroundColor: '#FFFFFF',
              fontSize: is58mm ? '9.5px' : '11px',
              lineHeight: 1.35,
              color: '#000000',
            }}
          >
            <div
              style={{
                fontWeight: 900,
                textTransform: 'uppercase',
                color: '#000000',
                marginBottom: '2px',
              }}
            >
              ★ VENTA A CRÉDITO
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700 }}>Cuenta por Cobrar:</span>
              <span style={{ fontWeight: 800 }}>#{sale.cuentaCobrarId || 'PENDIENTE'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700 }}>Total Financiado:</span>
              <span style={{ fontWeight: 800 }}>
                {formatCurrency(sale.total, settings.simboloMoneda)}
              </span>
            </div>
            <div
              style={{
                fontSize: is58mm ? '9px' : '10px',
                fontWeight: 600,
                color: '#000000',
                marginTop: '3px',
              }}
            >
              Registrada en cuenta de cliente. Favor conservar para sus abonos.
            </div>
          </div>
        )}
      </section>

      {/* 6. FOOTER */}
      <footer
        className="receipt-footer"
        style={{
          textAlign: 'center',
          paddingTop: '4px',
          fontSize: is58mm ? '9.5px' : '11px',
          fontWeight: 600,
          color: '#000000',
          lineHeight: 1.35,
        }}
      >
        {settings.mensajeTicketPie && (
          <div style={{ marginBottom: '4px', fontWeight: 700 }}>
            {settings.mensajeTicketPie}
          </div>
        )}
        {/* FASE 4 (textos del recibo -- auditoría): antes texto fijo
            "¡Gracias por vestir ZIO CLOTHES!" -- ahora viene de
            settings.mensajeFinalRecibo, con el mismo valor inicial. Mismo
            patrón `&&` que el resto del recibo (eslogan/mensajeTicketPie):
            si está vacío, el <div> completo no se renderiza -- ni el texto
            ni el estilo, sin dejar espacio en blanco. */}
        {settings.mensajeFinalRecibo && (
          <div
            style={{
              fontWeight: 800,
              fontSize: is58mm ? '10.5px' : '12px',
              color: '#000000',
              marginTop: '2px',
            }}
          >
            {settings.mensajeFinalRecibo}
          </div>
        )}
        {/* FASE 4: antes texto fijo "Sistema POS ZIO • Comprobante Digital
            / Físico" -- ahora viene de settings.pieTecnicoRecibo, mismo
            valor inicial, mismo patrón de renderizado condicional. */}
        {settings.pieTecnicoRecibo && (
          <div
            style={{
              fontSize: is58mm ? '8.5px' : '10px',
              fontWeight: 700,
              color: '#000000',
              marginTop: '3px',
            }}
          >
            {settings.pieTecnicoRecibo}
          </div>
        )}
      </footer>
    </div>
  );
};
