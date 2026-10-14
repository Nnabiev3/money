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
