import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { addOperation, balanceSummary, getReport, LimitError } from '../src/core.js';
import { countOperations, getOperation } from '../src/db.js';
import { NOW, resetDb, seedOperation } from './helpers.js';

const db = env.DB;
beforeEach(() => resetDb(db));

describe('addOperation', () => {
  it('adds an expense with category, name, bot source and today\'s date', async () => {
    const result = await addOperation(db, 1, { type: 'expense', amount: 500, text: 'такси', nowMs: NOW });
    expect(result.inserted).toBe(true);
    expect(result.operation).toMatchObject({
      type: 'expense', amount: 500, category: 'Транспорт', name: 'такси', date: '2026-10-14T12:00:00.000Z', source: 'bot'
    });
    expect(result.operation.id).toMatch(/^[a-z0-9]{12,}$/);
    expect(await getOperation(db, 1, result.operation.id)).toEqual(result.operation);
  });

  it('uses the category as the name when no text is given', async () => {
    const { operation } = await addOperation(db, 1, { type: 'expense', amount: 10, text: '', nowMs: NOW });
    expect(operation).toMatchObject({ category: 'Прочее', name: 'Прочее' });
  });

  it('returns the month balance including the new operation', async () => {
    await addOperation(db, 1, { type: 'income', amount: 1000, text: 'зарплата', nowMs: NOW });
    const { monthBalance } = await addOperation(db, 1, { type: 'expense', amount: 300, text: 'еда', nowMs: NOW });
    expect(monthBalance).toBe(700);
  });

  it('does not insert twice for the same update id', async () => {
    const first = await addOperation(db, 1, { type: 'expense', amount: 5, text: '', updateId: 7, nowMs: NOW });
    const second = await addOperation(db, 1, { type: 'expense', amount: 5, text: '', updateId: 7, nowMs: NOW });
    expect([first.inserted, second.inserted]).toEqual([true, false]);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('refuses to exceed the operation limit', async () => {
    await addOperation(db, 1, { type: 'expense', amount: 1, text: '', nowMs: NOW, maxOperations: 1 });
    await expect(
      addOperation(db, 1, { type: 'expense', amount: 1, text: '', nowMs: NOW, maxOperations: 1 })
    ).rejects.toBeInstanceOf(LimitError);
  });

  it('truncates a very long description', async () => {
    const { operation } = await addOperation(db, 1, { type: 'expense', amount: 1, text: 'я'.repeat(500), nowMs: NOW });
    expect(operation.name).toHaveLength(200);
  });
});

describe('reports', () => {
  beforeEach(async () => {
    const op = (id, type, amount, category, date) => ({ id, type, amount, category, date: `${date}T09:00:00.000Z` });
    for (const o of [
      op('a', 'income', 120000, 'Зарплата', '2026-10-03'),
      op('b', 'expense', 35000, 'Жильё', '2026-10-05'),
      op('c', 'expense', 5520, 'Еда', '2026-10-12'),
      op('d', 'income', 15000, 'Подработка', '2026-09-20')
    ]) await seedOperation(db, 1, o);
  });

  it('getReport totals a range with category breakdown and monthly series', async () => {
    const report = await getReport(db, 1, { from: '2026-09-01', to: '2026-10-31' });
    expect(report).toMatchObject({ income: 135000, expense: 40520, balance: 94480 });
    expect(report.expenseCategories).toEqual([{ category: 'Жильё', total: 35000 }, { category: 'Еда', total: 5520 }]);
    expect(report.incomeCategories.map(c => c.category)).toEqual(['Зарплата', 'Подработка']);
    expect(report.byMonth).toEqual([
      { month: '2026-09', income: 15000, expense: 0 },
      { month: '2026-10', income: 120000, expense: 40520 }
    ]);
  });

  it('balanceSummary reports the month, all time and progress to goals', async () => {
    const summary = await balanceSummary(db, 1, NOW);
    expect(summary).toMatchObject({
      monthTitle: 'октябрь 2026',
      month: { income: 120000, expense: 40520, balance: 79480 },
      total: { income: 135000, expense: 40520, balance: 94480 },
      monthTarget: 100000, monthPct: 79,
      goal: 1000000, goalName: 'Главная цель', goalPct: 9,
      currency: '₽'
    });
  });
});
