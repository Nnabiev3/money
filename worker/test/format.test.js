import { describe, expect, it } from 'vitest';
import {
  dateToIso, escapeHtml, formatDateShort, formatMoney, monthKey, monthRange, monthTitle, percent, round2, todayDate
} from '../src/format.js';

describe('escapeHtml', () => {
  it('escapes &, < and > so user text cannot inject markup', () => {
    expect(escapeHtml('<b>Tom & "Jerry"</b>')).toBe('&lt;b&gt;Tom &amp; "Jerry"&lt;/b&gt;');
  });

  it('turns non-strings into text', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('formatMoney', () => {
  it('groups thousands and appends the currency', () => {
    expect(formatMoney(94480, '₽')).toMatch(/^94\D480 ₽$/);
  });

  it('rounds to whole units like the app does', () => {
    expect(formatMoney(1499.6, '₽')).toMatch(/^1\D500 ₽$/);
  });
});

describe('round2 and percent', () => {
  it('round2 cuts floating point noise', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.456)).toBe(10.46);
  });

  it('percent is a whole number clamped to 0..100', () => {
    expect(percent(79480, 100000)).toBe(79);
    expect(percent(-5, 100)).toBe(0);
    expect(percent(500, 100)).toBe(100);
  });

  it('percent of a zero or negative total is 0', () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(5, -1)).toBe(0);
  });
});

describe('dates', () => {
  it('todayDate uses UTC+3, so 00:30 Moscow already is the next day', () => {
    expect(todayDate(Date.UTC(2026, 9, 13, 21, 30))).toBe('2026-10-14');
    expect(todayDate(Date.UTC(2026, 9, 13, 20, 59))).toBe('2026-10-13');
  });

  it('dateToIso pins the day at noon UTC', () => {
    expect(dateToIso('2026-10-14')).toBe('2026-10-14T12:00:00.000Z');
  });

  it('monthKey, monthRange and monthTitle describe the month of a date', () => {
    expect(monthKey('2026-10-14')).toBe('2026-10');
    expect(monthRange('2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthTitle('2026-10-14')).toBe('октябрь 2026');
  });

  it('formatDateShort prints dd.mm.yyyy', () => {
    expect(formatDateShort('2026-10-13T12:00:00.000Z')).toBe('13.10.2026');
  });
});
