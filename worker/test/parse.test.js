import { describe, expect, it } from 'vitest';
import { parseAmountAndText, parseCommand, parseFreeText } from '../src/parse.js';

describe('parseFreeText', () => {
  it.each([
    [' 200 такси', 'expense', 200, 'такси'],
    ['кофе 150', 'expense', 150, 'кофе'],
    ['такси 1 500', 'expense', 1500, 'такси'],
    ['потратил 300р на обед', 'expense', 300, 'обед'],
    ['300₽ аптека', 'expense', 300, 'аптека'],
    ['заплатил 99,50 руб за кофе', 'expense', 99.5, 'кофе'],
    ['покушал на 300', 'expense', 300, 'Еда'],
    ['Пообедал за 450', 'expense', 450, 'Еда'],
    ['-300 такси', 'expense', 300, 'такси'],
    ['+5000 зарплата', 'income', 5000, 'зарплата'],
    ['получил 3000 за подработку', 'income', 3000, 'подработку'],
    ['пришла зарплата 50000', 'income', 50000, 'зарплата']
  ])('reads %j as %s %d with text %j', (input, type, amount, text) => {
    expect(parseFreeText(input)).toEqual({ ok: true, type, amount, text });
  });

  it('takes the amount marked with «на»/«за» or a currency when several numbers appear', () => {
    expect(parseFreeText('купил 2 пива за 300')).toEqual({ ok: true, type: 'expense', amount: 300, text: '2 пива' });
    expect(parseFreeText('в 5 магазинов потратил 700р')).toEqual({ ok: true, type: 'expense', amount: 700, text: 'в 5 магазинов' });
  });

  it.each([
    ['привет'],
    ['просто текст без сумм'],
    [''],
    [undefined],
    ['/help']
  ])('ignores %j: no number to record', input => {
    expect(parseFreeText(input)).toEqual({ ok: false, reason: 'format' });
  });

  it('asks for clarification when several numbers have no marker', () => {
    expect(parseFreeText('купил 2 пива 300')).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it.each([
    ['0 такси', 'positive'],
    ['12.345 кофе', 'decimals'],
    ['1000000000 такси', 'too_big']
  ])('rejects %j because of %s', (input, reason) => {
    expect(parseFreeText(input)).toEqual({ ok: false, reason });
  });

  it('ignores very long messages', () => {
    expect(parseFreeText(`${'слово '.repeat(40)}300`)).toEqual({ ok: false, reason: 'format' });
  });
});

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
