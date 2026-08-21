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
                @page {
                  size: 80mm auto;
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
                  margin: 0 auto;
                  padding: 2mm 1mm;
                  background-color: #ffffff !important;
                  color: #000000 !important;
                  font-family: Arial, Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  font-weight: 600;
                  -webkit-font-smoothing: antialiased;
                  text-rendering: geometricPrecision;
                  font-size: 11.5px;
                  line-height: 1.35;
                }
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
                  body {
                    width: 80mm !important;
                    margin: 0 auto !important;
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

