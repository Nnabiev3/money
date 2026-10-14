const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

const respond = (payload, status, headers) =>
  new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...headers } });

/** @param {unknown} data @param {Record<string, string>} [headers] */
export const ok = (data, headers = {}) => respond({ success: true, data, error: null }, 200, headers);

/** @param {string} error @param {number} status @param {Record<string, string>} [headers] */
export const fail = (error, status, headers = {}) => respond({ success: false, data: null, error }, status, headers);

/** CORS только для сайта на GitHub Pages; без настроенного адреса и для чужих адресов заголовков нет. */
export function corsHeaders(request, allowedOrigin) {
  const origin = request.headers.get('Origin');
  if (!allowedOrigin || origin !== allowedOrigin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Читает JSON-тело с ограничением размера.
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, status: number, error: string }>}
 */
export async function readJson(request, maxBytes) {
  const tooLarge = { ok: false, status: 413, error: 'Слишком большой запрос' };
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) return tooLarge;
  const text = await request.text();
  if (text.length > maxBytes) return tooLarge;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'Некорректный JSON' };
  }
}
