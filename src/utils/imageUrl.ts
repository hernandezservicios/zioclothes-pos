/**
 * FIX (visualización de fotos de Google Drive -- auditoría aprobada):
 * `ProductsController.handleUploadImage` (Apps Script) guarda en
 * `Productos.imagen_url` URLs con el formato
 * `https://drive.google.com/uc?export=view&id=<fileId>` -- esa URL SÍ
 * descarga el archivo real (confirmado con una petición HTTP real contra
 * un archivo subido de verdad), pero la respuesta final de Google trae el
 * header `Cross-Origin-Resource-Policy: same-site`, que los navegadores
 * basados en Chromium usan para BLOQUEAR la carga de ese recurso dentro de
 * un `<img>` de cualquier dominio que no sea el propio de Google -- por
 * eso el POS mostraba el ícono de imagen rota y el `alt` (nombre del
 * producto) en vez de la fotografía, aunque el archivo y el permiso de
 * Drive estuvieran perfectamente correctos.
 *
 * `https://drive.google.com/thumbnail?id=<fileId>` sirve el mismo archivo
 * a través de `lh3.googleusercontent.com`, cuya respuesta NO incluye ese
 * header -- se confirmó con una petición HTTP real contra el mismo
 * archivo que esa URL sí es embebible en un `<img>` cross-origin.
 *
 * Esta función solo cambia cómo se MUESTRA una URL ya existente -- nunca
 * se usa para decidir qué se sube a Drive ni qué se guarda en
 * `Productos.imagen_url` (eso sigue siendo responsabilidad exclusiva de
 * `ProductsController.gs`/`productsApi.ts`, sin cambios). Cualquier valor
 * que no sea exactamente ese patrón de Drive -- una URL externa, una de
 * Drive en otro formato, o un Data URL Base64 histórico -- se devuelve
 * intacto.
 */
export function toDisplayableImageUrl(url?: string): string | undefined {
  if (!url) return undefined;

  const match = /^https:\/\/drive\.google\.com\/uc\?export=view&id=([^&]+)$/.exec(url);

  return match ? `https://drive.google.com/thumbnail?id=${match[1]}` : url;
}
