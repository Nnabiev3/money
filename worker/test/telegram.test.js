import { describe, expect, it, vi } from 'vitest';
import { appKeyboard, confirmDeleteKeyboard, createTelegram, undoKeyboard } from '../src/telegram.js';

const okResponse = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

describe('createTelegram', () => {
  it('sends an HTML message to the right Bot API url', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    await createTelegram('123:ABC', fetchFn).send(77, 'Привет', { inline_keyboard: [] });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: 77, text: 'Привет', parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
  });

  it('omits reply_markup when none is given', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    await createTelegram('t', fetchFn).send(1, 'x');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).not.toHaveProperty('reply_markup');
  });

  it('answers callbacks and clears buttons', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const tg = createTelegram('t', fetchFn);
    await tg.answerCallback('cb1', 'Готово');
    await tg.clearButtons(5, 9);
    expect(fetchFn.mock.calls[0][0]).toMatch(/answerCallbackQuery$/);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ callback_query_id: 'cb1', text: 'Готово' });
    expect(fetchFn.mock.calls[1][0]).toMatch(/editMessageReplyMarkup$/);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ chat_id: 5, message_id: 9, reply_markup: { inline_keyboard: [] } });
  });

  it('returns null instead of throwing on an HTTP error, without logging the token', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await createTelegram('SECRET-TOKEN', fetchFn).send(1, 'x')).toBeNull();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('SECRET-TOKEN');
    errorLog.mockRestore();
  });

  it('returns null when the network request fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => { throw new Error('offline'); });
    expect(await createTelegram('t', fetchFn).send(1, 'x')).toBeNull();
    errorLog.mockRestore();
  });
});

describe('keyboards', () => {
  it('appKeyboard has Web App buttons for the app and for the import screen', () => {
    const keyboard = appKeyboard('https://example.github.io/money/');
    const [[open], [statement]] = keyboard.inline_keyboard;
    expect(open).toEqual({ text: '📊 Открыть приложение', web_app: { url: 'https://example.github.io/money/' } });
    expect(statement).toEqual({ text: '📥 Добавить выписку', web_app: { url: 'https://example.github.io/money/?action=import' } });
  });

  it('undoKeyboard carries the operation id in callback_data', () => {
    expect(undoKeyboard('abc123').inline_keyboard[0][0]).toEqual({ text: '↩️ Отменить', callback_data: 'undo:abc123' });
  });

  it('confirmDeleteKeyboard offers yes and no', () => {
    const [yes, no] = confirmDeleteKeyboard().inline_keyboard[0];
    expect([yes.callback_data, no.callback_data]).toEqual(['deleteall:yes', 'deleteall:no']);
  });
});
