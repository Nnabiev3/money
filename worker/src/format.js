// «Сегодня» считается по UTC+3 одной константой, без настроек часового пояса
const DAY_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** @param {unknown} text @returns {string} */
export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {number} amount @param {string} currency @returns {string} */
export function formatMoney(amount, currency) {
  return `${Math.round(amount).toLocaleString('ru-RU')} ${currency}`;
}

/** @param {number} n @returns {number} */
export const round2 = n => Math.round(n * 100) / 100;

/** Целый процент 0..100; при неположительном итоге 0. */
export function percent(part, total) {
  if (!(total > 0)) return 0;
  return Math.round(Math.max(0, Math.min((part / total) * 100, 100)));
}

/** @param {number} nowMs @returns {string} 'YYYY-MM-DD' */
export function todayDate(nowMs) {
  return new Date(nowMs + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** @param {string} date 'YYYY-MM-DD' @returns {string} */
export const dateToIso = date => `${date}T12:00:00.000Z`;

/** @param {string} date 'YYYY-MM-DD' @returns {string} 'YYYY-MM' */
export const monthKey = date => date.slice(0, 7);

/** @param {string} date 'YYYY-MM-DD' @returns {{ from: string, to: string }} */
export function monthRange(date) {
  const month = monthKey(date);
  return { from: `${month}-01`, to: `${month}-31` };
}

/** @param {string} date 'YYYY-MM-DD' @returns {string} например 'октябрь 2026' */
export function monthTitle(date) {
  const [year, month] = date.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** @param {string} iso ISO-дата @returns {string} 'dd.mm.yyyy' */
export function formatDateShort(iso) {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}
