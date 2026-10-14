import { resolveCategory } from './categories.js';
import {
  categoryTotals, countOperations, ensureUser, getTotals, insertOperation, insertOperationOnce, monthlyTotals
} from './db.js';
import { dateToIso, monthRange, monthTitle, percent, round2, todayDate } from './format.js';
import { MAX_NAME, MAX_OPERATIONS } from './limits.js';

const ALL_TIME = { from: '0000-01-01', to: '9999-12-31' };

export class LimitError extends Error {}

function newOperationId(nowMs) {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(3)), byte => byte.toString(36).padStart(2, '0')).join('');
  return nowMs.toString(36) + random;
}

/**
 * Добавляет операцию «на сегодня». Общая точка входа для команд, живой речи и ИИ.
 * @param {D1Database} db
 * @param {number} userId
 * @param {{ type: 'income' | 'expense', amount: number, text: string, updateId?: number, nowMs: number, maxOperations?: number }} input
 * @returns {Promise<{ operation: import('./db.js').Operation, inserted: boolean, monthBalance: number, settings: object }>}
 */
export async function addOperation(db, userId, { type, amount, text, updateId, nowMs, maxOperations = MAX_OPERATIONS }) {
  const user = await ensureUser(db, userId, nowMs);
  if ((await countOperations(db, userId)) >= maxOperations) throw new LimitError('operations-limit');

  const { category, name } = resolveCategory(type, text, user.settings.categories);
  const date = todayDate(nowMs);
  const operation = {
    id: newOperationId(nowMs), name: name.slice(0, MAX_NAME), amount, type, category, date: dateToIso(date), source: 'bot'
  };

  let inserted = true;
  if (updateId === undefined) await insertOperation(db, userId, operation, nowMs);
  else inserted = await insertOperationOnce(db, userId, operation, updateId, nowMs);

  const { from, to } = monthRange(date);
  const totals = await getTotals(db, userId, from, to);
  return { operation, inserted, monthBalance: round2(totals.income - totals.expense), settings: user.settings };
}

/**
 * @param {D1Database} db
 * @param {number} userId
 * @param {{ from: string, to: string }} range даты YYYY-MM-DD, включительно
 */
export async function getReport(db, userId, { from, to }) {
  const [totals, expenseCategories, incomeCategories, byMonth] = await Promise.all([
    getTotals(db, userId, from, to),
    categoryTotals(db, userId, 'expense', from, to),
    categoryTotals(db, userId, 'income', from, to),
    monthlyTotals(db, userId, from, to)
  ]);
  return { ...totals, balance: round2(totals.income - totals.expense), expenseCategories, incomeCategories, byMonth };
}

/** Данные для /balance: месяц, всё время и прогресс к целям (формулы как в приложении). */
export async function balanceSummary(db, userId, nowMs) {
  const user = await ensureUser(db, userId, nowMs);
  const date = todayDate(nowMs);
  const [month, total] = await Promise.all([
    getTotals(db, userId, monthRange(date).from, monthRange(date).to),
    getTotals(db, userId, ALL_TIME.from, ALL_TIME.to)
  ]);
  const monthBalance = round2(month.income - month.expense);
  const totalBalance = round2(total.income - total.expense);
  const { goal, goalName, currency } = user.settings;
  return {
    monthTitle: monthTitle(date),
    month: { ...month, balance: monthBalance },
    total: { ...total, balance: totalBalance },
    monthTarget: user.monthTarget,
    monthPct: percent(monthBalance, user.monthTarget),
    goal,
    goalName,
    goalPct: percent(totalBalance, goal),
    currency
  };
}
