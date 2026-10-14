export const MAX_AMOUNT = 999999999.99;
export const MAX_OPERATIONS = 20000;
export const MAX_SYNC_ITEMS = 100;
export const MAX_NAME = 200;
export const MAX_CATEGORY = 40;
export const MAX_CATEGORIES = 50;
export const MAX_BODY_BYTES = 1000000;
export const BOT_RATE_PER_MINUTE = 30;
export const API_RATE_PER_MINUTE = 120;

/**
 * Аварийный «рубильник»: если список задан, работают только перечисленные ID.
 * @param {string | undefined} allowlist ID через запятую
 * @param {number} userId
 * @returns {boolean}
 */
export function isAllowed(allowlist, userId) {
  if (!allowlist) return true;
  return allowlist.split(',').map(id => id.trim()).filter(Boolean).includes(String(userId));
}

const MINUTE_MS = 60_000;
const KEEP_MINUTES = 5;

/**
 * Считает обращение пользователя в текущей минуте; старые окна удаляются попутно.
 * @param {D1Database} db
 * @param {number} userId
 * @param {'bot' | 'api'} scope
 * @param {number} limit разрешённое число обращений в минуту
 * @param {number} nowMs
 * @returns {Promise<{ allowed: boolean, count: number }>}
 */
export async function hitRateLimit(db, userId, scope, limit, nowMs) {
  const minute = Math.floor(nowMs / MINUTE_MS);
  const [hit] = await db.batch([
    db.prepare(
      'INSERT INTO rate_limits (user_id, scope, minute, count) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT (user_id, scope, minute) DO UPDATE SET count = count + 1 RETURNING count'
    ).bind(userId, scope, minute),
    db.prepare('DELETE FROM rate_limits WHERE minute < ?').bind(minute - KEEP_MINUTES)
  ]);
  const count = hit.results[0].count;
  return { allowed: count <= limit, count };
}
