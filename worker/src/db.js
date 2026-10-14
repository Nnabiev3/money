import { DEFAULT_MONTH_TARGET, DEFAULT_SETTINGS, withDefaults } from './categories.js';

/**
 * @typedef {object} Operation
 * @property {string} id
 * @property {string} name
 * @property {number} amount
 * @property {'income' | 'expense'} type
 * @property {string | null} category
 * @property {string} date ISO-строка
 * @property {string | null} source
 */

const COLUMNS = 'id, name, amount, type, category, date, source';
const INSERT_COLUMNS = 'id, user_id, type, name, amount, category, date, source, created_at';
const ROWS_PER_STATEMENT = 10; // 9 параметров на строку; у D1 лимит 100 параметров на запрос
const IDS_PER_STATEMENT = 90; // плюс user_id: 91 параметр

const toOperation = row => ({
  id: row.id, name: row.name, amount: row.amount, type: row.type, category: row.category, date: row.date, source: row.source
});

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const operationParams = (userId, op, nowMs) =>
  [op.id, userId, op.type, op.name, op.amount, op.category ?? null, op.date, op.source ?? null, nowMs];

// ----- Пользователи -----

/** @returns {Promise<{ id: number, settings: object, monthTarget: number } | null>} */
export async function getUser(db, userId) {
  const row = await db.prepare('SELECT id, settings, month_target FROM users WHERE id = ?').bind(userId).first();
  if (!row) return null;
  return { id: row.id, settings: withDefaults(JSON.parse(row.settings)), monthTarget: row.month_target };
}

/** Создаёт пользователя с настройками по умолчанию, если его ещё нет. */
export async function ensureUser(db, userId, nowMs) {
  const existing = await getUser(db, userId);
  if (existing) return existing;
  await db.prepare('INSERT OR IGNORE INTO users (id, settings, month_target, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, JSON.stringify(DEFAULT_SETTINGS), DEFAULT_MONTH_TARGET, nowMs, nowMs).run();
  return getUser(db, userId);
}

/** Обновляет только переданные поля. */
export function saveSettingsStatement(db, userId, { settings, monthTarget }, nowMs) {
  const sets = ['updated_at = ?'];
  const params = [nowMs];
  if (settings !== undefined) { sets.push('settings = ?'); params.push(JSON.stringify(settings)); }
  if (monthTarget !== undefined) { sets.push('month_target = ?'); params.push(monthTarget); }
  return db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params, userId);
}

// ----- Запись операций -----

/** Пачки по 10 строк: создаёт или обновляет операции, `created_at` при обновлении не трогает. */
export function upsertStatements(db, userId, operations, nowMs) {
  return chunk(operations, ROWS_PER_STATEMENT).map(rows => {
    const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = rows.flatMap(op => operationParams(userId, op, nowMs));
    return db.prepare(
      `INSERT INTO operations (${INSERT_COLUMNS}) VALUES ${placeholders} ` +
      'ON CONFLICT (user_id, id) DO UPDATE SET type = excluded.type, name = excluded.name, amount = excluded.amount, ' +
      'category = excluded.category, date = excluded.date, source = excluded.source'
    ).bind(...params);
  });
}

export function removeStatements(db, userId, ids) {
  return chunk(ids, IDS_PER_STATEMENT).map(part =>
    db.prepare(`DELETE FROM operations WHERE user_id = ? AND id IN (${part.map(() => '?').join(', ')})`).bind(userId, ...part)
  );
}

export async function insertOperation(db, userId, operation, nowMs) {
  await upsertStatements(db, userId, [operation], nowMs)[0].run();
}

/**
 * Атомарно: вставляет операцию и запоминает update_id; повторный update_id ничего не вставляет.
 * @returns {Promise<boolean>} true, если операция вставлена
 */
export async function insertOperationOnce(db, userId, operation, updateId, nowMs) {
  const insert = db.prepare(
    `INSERT INTO operations (${INSERT_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? ` +
    'WHERE NOT EXISTS (SELECT 1 FROM processed_updates WHERE update_id = ?)'
  ).bind(...operationParams(userId, operation, nowMs), updateId);
  const claim = db.prepare('INSERT OR IGNORE INTO processed_updates (update_id, at) VALUES (?, ?)').bind(updateId, nowMs);
  const [inserted] = await db.batch([insert, claim]);
  return inserted.meta.changes > 0;
}

export async function purgeProcessedUpdates(db, beforeMs) {
  await db.prepare('DELETE FROM processed_updates WHERE at < ?').bind(beforeMs).run();
}

export async function deleteOperation(db, userId, id) {
  const result = await db.prepare('DELETE FROM operations WHERE user_id = ? AND id = ?').bind(userId, id).run();
  return result.meta.changes > 0;
}

export function deleteAllStatements(db, userId) {
  return [
    db.prepare('DELETE FROM operations WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId)
  ];
}

// ----- Чтение операций -----

/** @returns {Promise<Operation[]>} старые сначала */
export async function listOperations(db, userId) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM operations WHERE user_id = ? ORDER BY created_at ASC, rowid ASC`).bind(userId).all();
  return results.map(toOperation);
}

/** @returns {Promise<Operation[]>} новые сначала */
export async function listLastOperations(db, userId, limit) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM operations WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`).bind(userId, limit).all();
  return results.map(toOperation);
}

/** @returns {Promise<Operation | null>} */
export async function getOperation(db, userId, id) {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM operations WHERE user_id = ? AND id = ?`).bind(userId, id).first();
  return row ? toOperation(row) : null;
}

export async function countOperations(db, userId) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM operations WHERE user_id = ?').bind(userId).first();
  return row.n;
}

// ----- Суммы (даты YYYY-MM-DD, границы включительно) -----

export async function getTotals(db, userId, from, to) {
  const { results } = await db.prepare(
    'SELECT type, ROUND(SUM(amount), 2) AS total FROM operations WHERE user_id = ? AND substr(date, 1, 10) BETWEEN ? AND ? GROUP BY type'
  ).bind(userId, from, to).all();
  const totals = { income: 0, expense: 0 };
  for (const row of results) totals[row.type] = row.total;
  return totals;
}

export async function categoryTotals(db, userId, type, from, to) {
  const { results } = await db.prepare(
    "SELECT COALESCE(category, 'Без категории') AS category, ROUND(SUM(amount), 2) AS total FROM operations " +
    'WHERE user_id = ? AND type = ? AND substr(date, 1, 10) BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC, category ASC'
  ).bind(userId, type, from, to).all();
  return results.map(row => ({ category: row.category, total: row.total }));
}

export async function monthlyTotals(db, userId, from, to) {
  const { results } = await db.prepare(
    'SELECT substr(date, 1, 7) AS month, type, ROUND(SUM(amount), 2) AS total FROM operations ' +
    'WHERE user_id = ? AND substr(date, 1, 10) BETWEEN ? AND ? GROUP BY month, type ORDER BY month'
  ).bind(userId, from, to).all();
  const byMonth = new Map();
  for (const row of results) {
    const entry = byMonth.get(row.month) ?? { month: row.month, income: 0, expense: 0 };
    byMonth.set(row.month, { ...entry, [row.type]: row.total });
  }
  return [...byMonth.values()];
}
