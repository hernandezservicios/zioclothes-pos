/**
 * FASE — CONFIGURACIÓN INICIAL DEL BACKEND ANTES DEL LOGIN.
 *
 * Auditoría previa (ver reporte de esta fase): no existía ninguna
 * función de normalización/validación de la URL del Web App en todo el
 * proyecto -- `SettingsView.tsx` guardaba en `storageService` cualquier
 * texto tecleado, sin trim ni validación alguna. Esta es la única
 * función nueva para esa validación -- se reutiliza tanto desde
 * `InitialSetupView` como desde `SettingsView` (pestaña de conexión),
 * nunca se duplica.
 */

/**
 * Valida y normaliza una URL de Web App de Google Apps Script.
 *
 * Formato real esperado (confirmado contra el despliegue real de este
 * proyecto): `https://script.google.com/macros/s/<ID>/exec`.
 *
 * Devuelve `null` (nunca "intenta arreglar") cuando la URL:
 *  - está vacía o son solo espacios;
 *  - no usa `https:`;
 *  - no apunta al host real de Apps Script (`script.google.com`);
 *  - es una URL del editor (`/.../edit`) en vez del Web App publicado;
 *  - está incompleta o no termina en `/exec` (con o sin una barra final,
 *    que se recorta como parte de la normalización).
 *
 * Cuando la URL es válida, se recorta a su forma canónica exacta
 * (protocolo + host + `/macros/s/<ID>/exec`, sin query params/fragmentos
 * ni barra final) -- nunca se reescribe de ninguna otra forma una URL ya
 * válida (Requisito 3: "no modificar URLs válidas innecesariamente").
 */
export function normalizeAppsScriptUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== 'script.google.com') return null;

  const pathMatch = /^\/macros\/s\/([^/]+)\/exec\/?$/.exec(parsed.pathname);
  if (!pathMatch) return null;

  return `https://script.google.com/macros/s/${pathMatch[1]}/exec`;
}
