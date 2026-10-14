import { describe, expect, it } from 'vitest';
import { normalizeOperation, normalizeSettings, validateSync } from '../src/validate.js';

const validOp = (overrides = {}) => ({
  id: 'abc123', name: 'Такси', amount: 500, type: 'expense', category: 'Транспорт', date: '2026-10-14T09:00:00.000Z', source: 'pdf', ...overrides
});

describe('normalizeOperation', () => {
  it('accepts a valid operation and returns exactly the known fields', () => {
    expect(normalizeOperation({ ...validOp(), extra: 'ignored' })).toEqual({ ok: true, value: validOp() });
  });

  it.each([
    [{ id: 'bad id!' }, 'bad-id'],
    [{ id: 5 }, 'bad-id'],
    [{ type: 'transfer' }, 'bad-type'],
    [{ amount: '500' }, 'bad-amount'],
    [{ amount: 0 }, 'bad-amount'],
    [{ amount: -1 }, 'bad-amount'],
    [{ amount: 0.004 }, 'bad-amount'],
    [{ amount: 1e12 }, 'bad-amount'],
    [{ amount: NaN }, 'bad-amount'],
    [{ date: 'not-a-date' }, 'bad-date'],
    [{ date: '2026-13-45T09:00:00.000Z' }, 'bad-date']
  ])('rejects %j as %s', (overrides, reason) => {
    expect(normalizeOperation(validOp(overrides))).toEqual({ ok: false, reason });
  });

  it('rejects non-objects', () => {
    expect(normalizeOperation(null)).toEqual({ ok: false, reason: 'not-object' });
  });

  it('rounds the amount to kopecks', () => {
    expect(normalizeOperation(validOp({ amount: 10.456 })).value.amount).toBe(10.46);
  });

  it('truncates long texts instead of rejecting them', () => {
    const { value } = normalizeOperation(validOp({ name: 'я'.repeat(300), category: 'к'.repeat(100), source: 'x'.repeat(50) }));
    expect([value.name.length, value.category.length, value.source.length]).toEqual([200, 40, 20]);
  });

  it('falls back to the category, then a default, when the name is missing', () => {
    expect(normalizeOperation(validOp({ name: '  ' })).value.name).toBe('Транспорт');
    expect(normalizeOperation(validOp({ name: undefined, category: null })).value.name).toBe('Операция');
  });

  it('turns an empty or missing category and source into null', () => {
    const { value } = normalizeOperation(validOp({ category: '', source: undefined }));
    expect([value.category, value.source]).toEqual([null, null]);
  });
});

describe('normalizeSettings', () => {
  const validSettings = () => ({
    goal: 1000000, goalName: 'Цель', currency: '₽', theme: 'light',
    categories: { income: ['Зарплата'], expense: ['Еда', 'Прочее'] }
  });

  it('accepts valid settings', () => {
    expect(normalizeSettings(validSettings())).toEqual({ ok: true, value: validSettings() });
  });

  it('defaults the theme and ignores unknown fields', () => {
    const { value } = normalizeSettings({ ...validSettings(), theme: undefined, extra: 1 });
    expect(value.theme).toBe('dark');
    expect(value).not.toHaveProperty('extra');
  });

  it.each([
    [{ goal: -1 }],
    [{ goal: 'много' }],
    [{ categories: undefined }],
    [{ categories: { income: [], expense: ['Еда'] } }],
    [{ categories: { income: ['A'], expense: [5] } }],
    [{ categories: { income: Array.from({ length: 51 }, (_, i) => `c${i}`), expense: ['Еда'] } }]
  ])('rejects invalid settings %j', overrides => {
    expect(normalizeSettings({ ...validSettings(), ...overrides }).ok).toBe(false);
  });

  it('truncates long names', () => {
    const { value } = normalizeSettings({ ...validSettings(), goalName: 'я'.repeat(100), categories: { income: ['к'.repeat(90)], expense: ['Еда'] } });
    expect(value.goalName).toHaveLength(60);
    expect(value.categories.income[0]).toHaveLength(40);
  });
});

describe('validateSync', () => {
  it('accepts an empty change set', () => {
    expect(validateSync({})).toEqual({ ok: true, value: { upsert: [], remove: [], settings: undefined, monthTarget: undefined, rejected: [] } });
  });

  it('rejects a body that is not an object or has non-array lists', () => {
    expect(validateSync(null).ok).toBe(false);
    expect(validateSync({ upsert: 'x' }).ok).toBe(false);
    expect(validateSync({ remove: {} }).ok).toBe(false);
  });

  it('rejects too many items at once', () => {
    const many = Array.from({ length: 101 }, (_, i) => validOp({ id: `id${i}` }));
    expect(validateSync({ upsert: many }).ok).toBe(false);
    expect(validateSync({ remove: many.map(o => o.id) }).ok).toBe(false);
  });

  it('keeps good operations and reports broken ones instead of failing the whole request', () => {
    const result = validateSync({ upsert: [validOp({ id: 'good' }), validOp({ id: 'zero', amount: 0 }), { nonsense: true }] });
    expect(result.ok).toBe(true);
    expect(result.value.upsert.map(o => o.id)).toEqual(['good']);
    expect(result.value.rejected).toEqual([{ id: 'zero', reason: 'bad-amount' }, { id: null, reason: 'bad-id' }]);
  });

  it('collapses duplicate ids and drops malformed ids to remove', () => {
    const result = validateSync({ upsert: [validOp({ id: 'a' }), validOp({ id: 'a', amount: 9 })], remove: ['x', 'x', 'bad id', 7] });
    expect(result.value.upsert).toHaveLength(1);
    expect(result.value.remove).toEqual(['x']);
  });

  it('validates settings and monthTarget when present', () => {
    expect(validateSync({ settings: { goal: -1 } }).ok).toBe(false);
    expect(validateSync({ monthTarget: -5 }).ok).toBe(false);
    expect(validateSync({ monthTarget: 'x' }).ok).toBe(false);
    expect(validateSync({ monthTarget: 150000 }).value.monthTarget).toBe(150000);
  });
});
