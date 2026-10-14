import { describe, expect, it } from 'vitest';
import { addedText, balanceText, lastText, monthText, operationLine, usageText } from '../src/messages.js';

const op = (overrides = {}) => ({
  id: 'a', name: 'такси', amount: 780, type: 'expense', category: 'Транспорт', date: '2026-10-13T12:00:00.000Z', source: 'bot', ...overrides
});

describe('addedText', () => {
  it('shows type, amount, category, name and the month balance', () => {
    const text = addedText({ operation: op(), monthBalance: 94480 }, '₽');
    expect(text).toMatch(/^✅ Расход 780 ₽ · Транспорт · такси\nОстаток за месяц: 94\D480 ₽$/);
  });

  it('does not repeat the name when it equals the category', () => {
    const text = addedText({ operation: op({ type: 'income', name: 'Зарплата', category: 'Зарплата' }), monthBalance: 1 }, '₽');
    expect(text).toContain('✅ Доход 780 ₽ · Зарплата\n');
  });

  it('escapes user text', () => {
    const text = addedText({ operation: op({ name: '<b>x</b> & y' }), monthBalance: 0 }, '₽');
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(text).not.toContain('<b>x</b>');
  });
});

describe('usageText', () => {
  it('explains the specific problem and gives an example', () => {
    expect(usageText('spent', 'decimals')).toContain('двух знаков');
    expect(usageText('income', 'format')).toContain('/income 500 такси');
  });
});

describe('lists', () => {
  it('operationLine prefixes income with + and expense with −', () => {
    expect(operationLine(op({ type: 'income' }), '₽')).toMatch(/^\+780 ₽ · Транспорт · такси · 13\.10\.2026$/);
    expect(operationLine(op(), '₽')).toMatch(/^−780 ₽/);
  });

  it('lastText numbers the operations', () => {
    const text = lastText([op({ id: 'a' }), op({ id: 'b', name: 'Транспорт' })], '₽');
    expect(text).toContain('1. −780 ₽ · Транспорт · такси');
    expect(text).toContain('2. −780 ₽ · Транспорт · 13.10.2026');
  });
});

describe('balanceText and monthText', () => {
  const summary = {
    monthTitle: 'октябрь 2026', currency: '₽',
    month: { income: 120000, expense: 40520, balance: 79480 },
    total: { income: 135000, expense: 40520, balance: 94480 },
    monthTarget: 100000, monthPct: 79, goal: 1000000, goalName: 'Квартира', goalPct: 9
  };

  it('balanceText covers the month, the total and both goals', () => {
    const text = balanceText(summary);
    expect(text).toContain('октябрь 2026');
    expect(text).toMatch(/Доход: 120\D000 ₽/);
    expect(text).toMatch(/Остаток: 79\D480 ₽/);
    expect(text).toMatch(/Всего накоплено: 94\D480 ₽/);
    expect(text).toMatch(/Цель на месяц: 79\D480 ₽ из 100\D000 ₽ \(79%\)/);
    expect(text).toMatch(/Квартира: 94\D480 ₽ из 1\D000\D000 ₽ \(9%\)/);
  });

  it('monthText lists categories with shares and handles an empty month', () => {
    const report = { expense: 40520, expenseCategories: [{ category: 'Жильё', total: 35000 }, { category: 'Еда', total: 5520 }] };
    const text = monthText('октябрь 2026', report, '₽');
    expect(text).toMatch(/Всего: 40\D520 ₽/);
    expect(text).toMatch(/Жильё — 35\D000 ₽ \(86%\)/);
    expect(monthText('октябрь 2026', { expense: 0, expenseCategories: [] }, '₽')).toBe('Расходов за октябрь 2026 нет.');
  });

  it('monthText shows the top ten and counts the rest', () => {
    const expenseCategories = Array.from({ length: 12 }, (_, i) => ({ category: `К${i}`, total: 100 - i }));
    expect(monthText('октябрь 2026', { expense: 1000, expenseCategories }, '₽')).toContain('и ещё 2');
  });
});
