const encoder = new TextEncoder();
const MAX_FUTURE_SKEW_SEC = 60;

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** Сравнение строк за время, не зависящее от места первого расхождения. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Заголовок X-Telegram-Bot-Api-Secret-Token должен совпасть с WEBHOOK_SECRET. */
export function verifyWebhookSecret(request, secret) {
  if (!secret) return false;
  return timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', secret);
}

/**
 * Проверяет подпись initData по схеме Telegram (HMAC-SHA256, ключ из токена бота).
 * В строку проверки входят все поля, кроме hash (signature тоже входит).
 * @param {string} initData строка запроса, полученная мини-аппом от Telegram
 * @param {string} botToken
 * @param {number} nowMs
 * @param {number} [maxAgeSec] максимальный возраст auth_date
 * @returns {Promise<{ ok: true, userId: number } | { ok: false }>}
 */
export async function verifyInitData(initData, botToken, nowMs, maxAgeSec = 86400) {
  if (!initData || !botToken) return { ok: false };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmac(encoder.encode('WebAppData'), botToken);
  if (!timingSafeEqual(toHex(await hmac(secretKey, dataCheckString)), hash)) return { ok: false };

  const age = nowMs / 1000 - Number(params.get('auth_date'));
  if (!Number.isFinite(age) || age > maxAgeSec || age < -MAX_FUTURE_SKEW_SEC) return { ok: false };

  try {
    const user = JSON.parse(params.get('user'));
    return Number.isSafeInteger(user?.id) ? { ok: true, userId: user.id } : { ok: false };
  } catch {
    return { ok: false };
  }
}
