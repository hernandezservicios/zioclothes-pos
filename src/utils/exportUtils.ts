export function exportToCSV(filename: string, rows: Record<string, any>[]): void {
  if (!rows || !rows.length) return;

  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((header) => {
          let cell = row[header] === null || row[header] === undefined ? '' : row[header];
          cell = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
          cell = cell.replace(/"/g, '""');
          if (cell.search(/("|,|\n)/g) >= 0) {
            cell = `"${cell}"`;
          }
          return cell;
        })
        .join(',')
    ),
  ].join('\r\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().substring(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * High-quality HTML/CSS thermal printing for 80mm/58mm POS receipt printers.
 * Triggers native browser print dialog with full HTML/CSS fidelity.
 * Supports both standalone browser windows and sandboxed iframe environments.
 */
export function printThermalElement(elementId: string = 'thermal-receipt-content', title = 'Comprobante - ZIO CLOTHES'): void {
  const elem = document.getElementById(elementId);
  const contentHtml = elem ? elem.outerHTML : '';

  const isIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  // If running inside an iframe (like AI Studio preview), use popup window print to bypass sandbox restrictions
  if (isIframe && contentHtml) {
    try {
      const printWindow = window.open('', '_blank', 'width=420,height=750,menubar=no,toolbar=no,location=no,status=no');
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(`
          <!DOCTYPE html>
          <html lang="es">
            <head>
              <meta charset="utf-8">
              <title>${title}</title>
              <style>
                /* FIX (CORRECCIÓN QUIRÚRGICA -- margen superior de impresión):
                   este es un documento COMPLETAMENTE APARTE de la app principal
                   (la ventana emergente que se usa cuando la app corre dentro de
                   un iframe -- ver isIframe más arriba) -- src/index.css nunca
                   se carga aquí. Tenía el MISMO bug que index.css tenía antes de
                   esta corrección: "80mm auto" es un valor inválido para el
                   descriptor size de @page (la spec de CSS Paged Media solo
                   permite una o dos longitudes, o auto sola, nunca mezcladas) --
                   el navegador lo descarta en silencio y cae al tamaño de página
                   por defecto (Carta/A4). Misma corrección aplicada aquí: dos
                   longitudes válidas. @page :first refuerza el margen 0 en la
                   primera página para los motores que le dan trato especial. */
                @page {
                  size: 80mm 297mm;
                  margin: 0mm;
                }
                @page :first {
                  margin: 0mm;
                }
                *, *::before, *::after {
                  box-sizing: border-box;
                  margin: 0;
                  padding: 0;
                  color: #000000 !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  text-shadow: none !important;
                }
                html, body {
                  width: 80mm;
                  max-width: 80mm;
                  margin: 0 !important;
                  padding: 0 !important;
                  background-color: #ffffff !important;
                  color: #000000 !important;
                  font-family: Arial, Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  font-weight: 600;
                  -webkit-font-smoothing: antialiased;
                  text-rendering: geometricPrecision;
                  font-size: 11.5px;
                  line-height: 1.35;
                }
                /* FIX: html,body traía padding: 2mm 1mm -- ese 2mm DE
                   ARRIBA era espacio superior externo real, distinto del padding
                   interno del propio ticket (que ya trae su propio padding en
                   los estilos inline de ReceiptTicket.tsx/el resto de tickets --
                   elem.outerHTML se inyecta tal cual, con esos estilos
                   inline intactos). Se quita de aquí (arriba) para que el único
                   espacio antes del contenido sea el padding interno del propio
                   recibo, nunca uno adicional del documento contenedor -- el
                   mismo criterio que ya se aplicó en index.css. */
                .no-print { display: none !important; }
                table {
                  width: 100%;
                  border-collapse: collapse;
                  color: #000000 !important;
                }
                th, td {
                  color: #000000 !important;
                }
                @media print {
                  html, body {
                    width: 80mm !important;
                    margin: 0 !important;
                    padding: 0 !important;
                  }
                  .no-print { display: none !important; }
                }
              </style>
            </head>
            <body>
              ${contentHtml}
              <script>
                window.onload = function() {
                  window.focus();
                  window.print();
                };
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
        return;
      }
    } catch (e) {
      console.warn('[printThermalElement] Iframe popup fallback error:', e);
    }
  }

  // Native top-level document print
  window.print();
}

