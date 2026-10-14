import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, guessCategory, resolveCategory, withDefaults } from '../src/categories.js';

const categories = DEFAULT_SETTINGS.categories;

describe('guessCategory', () => {
  it('uses the same keyword rules as the statement import', () => {
    expect(guessCategory('expense', 'такси домой')).toBe('Транспорт');
    expect(guessCategory('expense', 'Пятёрочка')).toBe('Еда');
    expect(guessCategory('income', 'аванс за октябрь')).toBe('Зарплата');
  });

  it('returns null when nothing matches', () => {
    expect(guessCategory('expense', 'xyz')).toBeNull();
  });
});

describe('resolveCategory', () => {
  it('prefers an exact match with the user category, ignoring case', () => {
    expect(resolveCategory('expense', 'еда', categories)).toEqual({ category: 'Еда', name: 'Еда' });
  });

  it('falls back to keyword rules and keeps the typed text as the name', () => {
    expect(resolveCategory('expense', 'такси', categories)).toEqual({ category: 'Транспорт', name: 'такси' });
  });

  it('uses "Прочее" and the category as the name when there is no text', () => {
    expect(resolveCategory('expense', '', categories)).toEqual({ category: 'Прочее', name: 'Прочее' });
  });

  it('uses "Прочее" for unknown text', () => {
    expect(resolveCategory('expense', 'xyz', categories)).toEqual({ category: 'Прочее', name: 'xyz' });
  });

  it('does not use a guessed category the user has deleted', () => {
    const custom = { income: ['Зарплата'], expense: ['Дом', 'Прочее'] };
    expect(resolveCategory('expense', 'такси', custom).category).toBe('Прочее');
  });

  it('falls back to the first category when "Прочее" is missing', () => {
    const custom = { income: ['Зарплата'], expense: ['Дом'] };
    expect(resolveCategory('expense', 'xyz', custom).category).toBe('Дом');
  });

  it('resolves income the same way', () => {
    expect(resolveCategory('income', 'зарплата', categories)).toEqual({ category: 'Зарплата', name: 'Зарплата' });
    expect(resolveCategory('income', 'премия за квартал', categories)).toEqual({ category: 'Зарплата', name: 'премия за квартал' });
  });
});

describe('withDefaults', () => {
  it('fills in everything missing, including nested categories', () => {
    expect(withDefaults({})).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults({ goal: 5, categories: { income: ['X'] } })).toMatchObject({
      goal: 5,
      categories: { income: ['X'], expense: DEFAULT_SETTINGS.categories.expense }
    });
  });
});
