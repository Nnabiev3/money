import { MAX_AMOUNT, MAX_CATEGORIES, MAX_CATEGORY, MAX_NAME, MAX_SYNC_ITEMS } from './limits.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_SOURCE = 20;
const MAX_GOAL_NAME = 60;
const MAX_CURRENCY = 8;
const MAX_MONEY_SETTING = 1e12;

const cut = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Приводит операцию к виду, пригодному для записи. Тексты усекаются, неверная структура отвергается.
 * @param {unknown} raw
 * @returns {{ ok: true, value: import('./db.js').Operation } | { ok: false, reason: string }}
 */
export function normalizeOperation(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-object' };
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { ok: false, reason: 'bad-id' };
  if (raw.type !== 'income' && raw.type !== 'expense') return { ok: false, reason: 'bad-type' };

  const amount = typeof raw.amount === 'number' ? Math.round(raw.amount * 100) / 100 : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, reason: 'bad-amount' };
  if (typeof raw.date !== 'string' || !ISO_RE.test(raw.date) || Number.isNaN(Date.parse(raw.date))) {
    return { ok: false, reason: 'bad-date' };
  }

  const category = cut(raw.category, MAX_CATEGORY) || null;
  return {
    ok: true,
    value: {
      id: raw.id,
      name: cut(raw.name, MAX_NAME) || category || 'Операция',
      amount,
      type: raw.type,
      category,
      date: raw.date,
      source: cut(raw.source, MAX_SOURCE) || null
    }
  };
}

function normalizeCategoryList(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CATEGORIES) return null;
  if (!list.every(item => typeof item === 'string')) return null;
  const cleaned = [...new Set(list.map(item => cut(item, MAX_CATEGORY)).filter(Boolean))];
  return cleaned.length ? cleaned : null;
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function normalizeSettings(raw) {
  const bad = error => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('Настройки должны быть объектом');
  if (typeof raw.goal !== 'number' || !Number.isFinite(raw.goal) || raw.goal < 0 || raw.goal > MAX_MONEY_SETTING) {
    return bad('Неверная сумма цели');
  }
  const income = normalizeCategoryList(raw.categories?.income);
  const expense = normalizeCategoryList(raw.categories?.expense);
  if (!income || !expense) return bad('Неверный список категорий');

  return {
    ok: true,
    value: {
      goal: raw.goal,
      goalName: cut(raw.goalName, MAX_GOAL_NAME) || 'Главная цель',
      currency: cut(raw.currency, MAX_CURRENCY) || '₽',
      theme: raw.theme === 'light' ? 'light' : 'dark',
      categories: { income, expense }
    }
  };
}

/**
 * Проверяет тело POST /api/sync. Структурные ошибки отвергают запрос целиком,
 * отдельные испорченные операции пропускаются и возвращаются в `rejected`.
 * @param {unknown} body
 */
export function validateSync(body) {
  const fail = error => ({ ok: false, error });
  if (!body || typeof body !== 'object') return fail('Тело запроса должно быть JSON-объектом');

  const upsertRaw = body.upsert ?? [];
  const removeRaw = body.remove ?? [];
  if (!Array.isArray(upsertRaw) || !Array.isArray(removeRaw)) return fail('upsert и remove должны быть списками');
  if (upsertRaw.length > MAX_SYNC_ITEMS || removeRaw.length > MAX_SYNC_ITEMS) {
    return fail(`Не более ${MAX_SYNC_ITEMS} элементов за запрос`);
  }

  const upsert = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of upsertRaw) {
    const result = normalizeOperation(raw);
    if (!result.ok) {
      rejected.push({ id: typeof raw?.id === 'string' ? raw.id : null, reason: result.reason });
    } else if (!seen.has(result.value.id)) {
      seen.add(result.value.id);
      upsert.push(result.value);
    }
  }
  const remove = [...new Set(removeRaw.filter(id => typeof id === 'string' && ID_RE.test(id)))];

  let settings;
  if (body.settings !== undefined) {
    const result = normalizeSettings(body.settings);
    if (!result.ok) return fail(result.error);
    settings = result.value;
  }

  let monthTarget;
  if (body.monthTarget !== undefined) {
    const value = body.monthTarget;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MONEY_SETTING) {
      return fail('Неверная цель на месяц');
    }
    monthTarget = value;
  }

  return { ok: true, value: { upsert, remove, settings, monthTarget, rejected } };
}
