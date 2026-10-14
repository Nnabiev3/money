import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MONTH_TARGET, DEFAULT_SETTINGS } from '../src/categories.js';
import {
  categoryTotals, countOperations, deleteAllStatements, deleteOperation, ensureUser, getOperation, getTotals, getUser,
  insertOperation, insertOperationOnce, listLastOperations, listOperations, monthlyTotals, purgeProcessedUpdates,
  removeStatements, saveSettingsStatement, upsertStatements
} from '../src/db.js';
import { NOW, resetDb } from './helpers.js';

const db = env.DB;
const op = (id, overrides = {}) => ({
  id, name: 'Такси', amount: 100, type: 'expense', category: 'Транспорт', date: '2026-10-10T12:00:00.000Z', source: 'bot', ...overrides
});

beforeEach(() => resetDb(db));

describe('users', () => {
  it('getUser returns null for an unknown user', async () => {
    expect(await getUser(db, 404)).toBeNull();
  });

  it('ensureUser creates default settings once and never overwrites them', async () => {
    const created = await ensureUser(db, 1, NOW);
    expect(created).toEqual({ id: 1, settings: DEFAULT_SETTINGS, monthTarget: DEFAULT_MONTH_TARGET });

    await saveSettingsStatement(db, 1, { settings: { ...DEFAULT_SETTINGS, goal: 5 }, monthTarget: 7 }, NOW).run();
    const again = await ensureUser(db, 1, NOW);
    expect(again.settings.goal).toBe(5);
    expect(again.monthTarget).toBe(7);
  });

  it('saveSettingsStatement updates only the provided fields', async () => {
    await ensureUser(db, 1, NOW);
    await saveSettingsStatement(db, 1, { monthTarget: 42 }, NOW).run();
    const user = await getUser(db, 1);
    expect(user.monthTarget).toBe(42);
    expect(user.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('writing operations', () => {
  it('inserts more rows than fit in one statement and updates on conflict, keeping created_at', async () => {
    const many = Array.from({ length: 25 }, (_, i) => op(`id${i}`, { amount: i + 1 }));
    const statements = upsertStatements(db, 1, many, NOW);
    expect(statements).toHaveLength(3);
    await db.batch(statements);
    expect(await countOperations(db, 1)).toBe(25);

    await db.batch(upsertStatements(db, 1, [op('id0', { amount: 999, name: 'Новое' })], NOW + 5000));
    expect(await getOperation(db, 1, 'id0')).toMatchObject({ amount: 999, name: 'Новое' });
    const { results } = await db.prepare('SELECT created_at FROM operations WHERE user_id = 1 AND id = ?').bind('id0').all();
    expect(results[0].created_at).toBe(NOW);
  });

  it('removes by id in chunks and only for the given user', async () => {
    const ids = Array.from({ length: 95 }, (_, i) => `id${i}`);
    await db.batch([...upsertStatements(db, 1, ids.map(id => op(id)), NOW), ...upsertStatements(db, 2, [op('id0')], NOW)]);

    const statements = removeStatements(db, 1, ids);
    expect(statements).toHaveLength(2);
    await db.batch(statements);
    expect(await countOperations(db, 1)).toBe(0);
    expect(await countOperations(db, 2)).toBe(1);
  });

  it('keeps operations of different users with the same id apart', async () => {
    await insertOperation(db, 1, op('same', { amount: 1 }), NOW);
    await insertOperation(db, 2, op('same', { amount: 2 }), NOW);
    expect((await getOperation(db, 1, 'same')).amount).toBe(1);
    expect((await getOperation(db, 2, 'same')).amount).toBe(2);
  });

  it('insertOperationOnce ignores a repeated update id', async () => {
    expect(await insertOperationOnce(db, 1, op('first'), 777, NOW)).toBe(true);
    expect(await insertOperationOnce(db, 1, op('second'), 777, NOW)).toBe(false);
    expect(await countOperations(db, 1)).toBe(1);
    expect(await getOperation(db, 1, 'second')).toBeNull();
  });

  it('purgeProcessedUpdates forgets old updates so they could be processed again', async () => {
    await insertOperationOnce(db, 1, op('first'), 777, NOW);
    await purgeProcessedUpdates(db, NOW + 1);
    expect(await insertOperationOnce(db, 1, op('second'), 777, NOW + 2)).toBe(true);
  });
});

describe('reading operations', () => {
  it('lists oldest-first and last-first', async () => {
    await insertOperation(db, 1, op('a'), NOW);
    await insertOperation(db, 1, op('b'), NOW + 1);
    await insertOperation(db, 1, op('c'), NOW + 2);
    expect((await listOperations(db, 1)).map(o => o.id)).toEqual(['a', 'b', 'c']);
    expect((await listLastOperations(db, 1, 2)).map(o => o.id)).toEqual(['c', 'b']);
  });

  it('deleteOperation reports whether something was removed and is scoped to the user', async () => {
    await insertOperation(db, 1, op('a'), NOW);
    expect(await deleteOperation(db, 2, 'a')).toBe(false);
    expect(await deleteOperation(db, 1, 'a')).toBe(true);
    expect(await deleteOperation(db, 1, 'a')).toBe(false);
  });
});

describe('totals', () => {
  beforeEach(async () => {
    await db.batch(upsertStatements(db, 1, [
      op('a', { type: 'income', amount: 1000.25, category: 'Зарплата', date: '2026-10-03T09:00:00.000Z' }),
      op('b', { amount: 300.1, category: 'Еда', date: '2026-10-05T09:00:00.000Z' }),
      op('c', { amount: 200.2, category: 'Еда', date: '2026-10-31T09:00:00.000Z' }),
      op('d', { amount: 50, category: 'Транспорт', date: '2026-09-30T09:00:00.000Z' }),
      op('e', { amount: 10, category: null, date: '2026-10-06T09:00:00.000Z' })
    ], NOW));
  });

  it('sums a date range inclusively, rounded to kopecks', async () => {
    expect(await getTotals(db, 1, '2026-10-01', '2026-10-31')).toEqual({ income: 1000.25, expense: 510.3 });
  });

  it('returns zeros for a user without operations', async () => {
    expect(await getTotals(db, 2, '2026-10-01', '2026-10-31')).toEqual({ income: 0, expense: 0 });
  });

  it('groups by category, biggest first, naming missing categories', async () => {
    expect(await categoryTotals(db, 1, 'expense', '2026-10-01', '2026-10-31')).toEqual([
      { category: 'Еда', total: 500.3 },
      { category: 'Без категории', total: 10 }
    ]);
  });

  it('groups by month', async () => {
    expect(await monthlyTotals(db, 1, '2026-09-01', '2026-10-31')).toEqual([
      { month: '2026-09', income: 0, expense: 50 },
      { month: '2026-10', income: 1000.25, expense: 510.3 }
    ]);
  });
});

describe('deleteAllStatements', () => {
  it('removes the user and every operation, leaving other users alone', async () => {
    await ensureUser(db, 1, NOW);
    await ensureUser(db, 2, NOW);
    await insertOperation(db, 1, op('a'), NOW);
    await insertOperation(db, 2, op('b'), NOW);
    await db.batch(deleteAllStatements(db, 1));
    expect(await getUser(db, 1)).toBeNull();
    expect(await countOperations(db, 1)).toBe(0);
    expect(await countOperations(db, 2)).toBe(1);
    expect(await getUser(db, 2)).not.toBeNull();
  });
});
