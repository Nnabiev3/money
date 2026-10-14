import { describe, expect, it } from 'vitest';
import { parseAmountAndText, parseCommand } from '../src/parse.js';

describe('parseCommand', () => {
  it('splits the command name from its arguments', () => {
    expect(parseCommand('/spent 500 такси')).toEqual({ name: 'spent', args: '500 такси' });
  });

  it('accepts a command without arguments and normalises case', () => {
    expect(parseCommand('/BALANCE')).toEqual({ name: 'balance', args: '' });
  });

  it('drops the @botname suffix used in groups', () => {
    expect(parseCommand('/spent@MoneyBot 500 еда')).toEqual({ name: 'spent', args: '500 еда' });
  });

  it('returns null for plain text', () => {
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe('parseAmountAndText', () => {
  it.each([
    ['500', 500, ''],
    ['500 такси', 500, 'такси'],
    ['1 500 такси', 1500, 'такси'],
    ['1\u00a0500 кофе', 1500, 'кофе'],
    ['1500,50', 1500.5, ''],
    ['1500.50 кофе', 1500.5, 'кофе'],
    ['999999999.99', 999999999.99, ''],
    ['  300   обед в кафе ', 300, 'обед в кафе']
  ])('reads %j as amount %d and text %j', (args, amount, text) => {
    expect(parseAmountAndText(args)).toEqual({ ok: true, amount, text });
  });

  it.each([
    ['', 'format'],
    ['abc', 'format'],
    ['-5', 'format'],
    ['500р такси', 'format'],
    ['12.345', 'decimals'],
    ['0', 'positive'],
    ['0,00 x', 'positive'],
    ['1000000000', 'too_big']
  ])('rejects %j because of %s', (args, reason) => {
    expect(parseAmountAndText(args)).toEqual({ ok: false, reason });
  });
});
