import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../src/commands.js';
import { countOperations, getUser, listOperations } from '../src/db.js';
import { callbackUpdate, makeCtx, NOW, resetDb, seedOperation, textUpdate } from './helpers.js';

const db = env.DB;
beforeEach(() => resetDb(db));

const lastReply = ctx => ctx.tg.send.mock.calls.at(-1);

describe('/start, /help, /statement', () => {
  it('/start creates the user and shows both Web App buttons', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/start'), ctx);

    expect(await getUser(db, 1)).not.toBeNull();
    const [chatId, text, markup] = lastReply(ctx);
    expect(chatId).toBe(1);
    expect(text).toContain('/spent');
    expect(markup.inline_keyboard.flat().map(b => b.web_app.url)).toEqual([
      'https://example.github.io/money/', 'https://example.github.io/money/?action=import'
    ]);
  });

  it('/help and /statement both carry the buttons', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/help'), ctx);
    expect(lastReply(ctx)[2].inline_keyboard).toHaveLength(2);
    await handleUpdate(textUpdate('/statement', { updateId: 2 }), ctx);
    expect(lastReply(ctx)[1]).toContain('выписку');
    expect(lastReply(ctx)[2].inline_keyboard[1][0].text).toBe('📥 Добавить выписку');
  });
});

describe('/spent and /income', () => {
  it('/spent 500 такси stores an expense and answers with an undo button', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 500 такси'), ctx);

    const [stored] = await listOperations(db, 1);
    expect(stored).toMatchObject({
      type: 'expense', amount: 500, category: 'Транспорт', name: 'такси', date: '2026-10-14T12:00:00.000Z', source: 'bot'
    });
    const [, text, markup] = lastReply(ctx);
    expect(text).toContain('✅ Расход 500 ₽ · Транспорт · такси');
    expect(markup.inline_keyboard[0][0].callback_data).toBe(`undo:${stored.id}`);
  });

  it('/income 50000 зарплата stores an income in the matching category', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/income 50000 зарплата'), ctx);
    expect((await listOperations(db, 1))[0]).toMatchObject({ type: 'income', amount: 50000, category: 'Зарплата', name: 'Зарплата' });
    expect(lastReply(ctx)[1]).toContain('✅ Доход');
  });

  it('answers a bad amount with a usage hint and stores nothing', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent много'), ctx);
    await handleUpdate(textUpdate('/spent 12.345', { updateId: 2 }), ctx);
    expect(ctx.tg.send.mock.calls[0][1]).toContain('Пример: <code>/spent 500 такси</code>');
    expect(ctx.tg.send.mock.calls[1][1]).toContain('двух знаков');
    expect(await countOperations(db, 1)).toBe(0);
  });

  it('escapes markup in the description so the reply cannot be broken', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 5 <b>x</b> & <i>'), ctx);
    const [, text] = lastReply(ctx);
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &lt;i&gt;');
    expect(text).not.toContain('<b>x</b>');
  });

  it('processes a repeated update id only once and answers only once', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда', { updateId: 55 }), ctx);
    await handleUpdate(textUpdate('/spent 100 еда', { updateId: 55 }), ctx);
    expect(await countOperations(db, 1)).toBe(1);
    expect(ctx.tg.send).toHaveBeenCalledTimes(1);
  });
});

describe('access rules', () => {
  it('ignores group chats and messages without a sender', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 1', { chatType: 'group' }), ctx);
    await handleUpdate({ update_id: 3, message: { chat: { id: 1, type: 'private' }, text: '/help' } }, ctx);
    await handleUpdate({ update_id: 4 }, ctx);
    expect(ctx.tg.send).not.toHaveBeenCalled();
  });

  it('refuses users outside the allowlist', async () => {
    const ctx = makeCtx(db, { allowlist: '999' });
    await handleUpdate(textUpdate('/spent 100'), ctx);
    expect(lastReply(ctx)[1]).toBe('Доступ к боту закрыт.');
    expect(await countOperations(db, 1)).toBe(0);
  });

  it('answers the first 30 messages in a minute and warns once about the rest', async () => {
    const ctx = makeCtx(db);
    for (let i = 1; i <= 33; i++) await handleUpdate(textUpdate('/help', { updateId: i }), ctx);
    expect(ctx.tg.send).toHaveBeenCalledTimes(31);
    expect(lastReply(ctx)[1]).toContain('Слишком много');
  });

  it('hints at /help for unknown commands and plain text', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/nope'), ctx);
    await handleUpdate(textUpdate('просто текст', { updateId: 2 }), ctx);
    expect(ctx.tg.send.mock.calls.map(c => c[1])).toEqual(['Не понял. Список команд: /help', 'Не понял. Список команд: /help']);
  });
});

describe('/undo and /deleteall', () => {
  it('/undo removes the most recently added operation and says what it was', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда', { updateId: 1 }), ctx);
    await handleUpdate(textUpdate('/spent 200 кофе', { updateId: 2 }), ctx);
    await handleUpdate(textUpdate('/undo', { updateId: 3 }), ctx);

    expect((await listOperations(db, 1)).map(o => o.amount)).toEqual([100]);
    expect(lastReply(ctx)[1]).toMatch(/🗑 Удалено: −200 ₽/);
  });

  it('/undo with nothing to undo says so', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/undo'), ctx);
    expect(lastReply(ctx)[1]).toBe('Операций пока нет.');
  });

  it('/deleteall asks first and only deletes after the yes button', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда'), ctx);
    await handleUpdate(textUpdate('/deleteall', { updateId: 2 }), ctx);
    expect(lastReply(ctx)[2].inline_keyboard[0].map(b => b.callback_data)).toEqual(['deleteall:yes', 'deleteall:no']);
    expect(await countOperations(db, 1)).toBe(1);

    await handleUpdate(callbackUpdate('deleteall:no', { updateId: 3 }), ctx);
    expect(await countOperations(db, 1)).toBe(1);

    await handleUpdate(callbackUpdate('deleteall:yes', { updateId: 4 }), ctx);
    expect(await countOperations(db, 1)).toBe(0);
    expect(await getUser(db, 1)).toBeNull();
    expect(lastReply(ctx)[1]).toBe('Все данные удалены.');
  });
});

describe('undo button', () => {
  it('removes exactly that operation, clears the button and is harmless on a second tap', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда'), ctx);
    const [stored] = await listOperations(db, 1);

    await handleUpdate(callbackUpdate(`undo:${stored.id}`, { updateId: 10, messageId: 5 }), ctx);
    expect(await countOperations(db, 1)).toBe(0);
    expect(ctx.tg.answerCallback).toHaveBeenLastCalledWith('cb10', 'Отменено');
    expect(ctx.tg.clearButtons).toHaveBeenLastCalledWith(1, 5);

    await handleUpdate(callbackUpdate(`undo:${stored.id}`, { updateId: 11 }), ctx);
    expect(ctx.tg.answerCallback).toHaveBeenLastCalledWith('cb11', 'Уже удалено');
  });

  it('cannot delete another user\'s operation', async () => {
    await seedOperation(db, 2, { id: 'theirs', type: 'expense', amount: 5, category: 'Еда', date: '2026-10-10T12:00:00.000Z' });
    const ctx = makeCtx(db);
    await handleUpdate(callbackUpdate('undo:theirs', { userId: 1 }), ctx);
    expect(await countOperations(db, 2)).toBe(1);
    expect(ctx.tg.answerCallback).toHaveBeenLastCalledWith('cb1000', 'Уже удалено');
  });

  it('ignores malformed callback data', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(callbackUpdate('undo:../../x'), ctx);
    await handleUpdate(callbackUpdate('weird'), ctx);
    expect(ctx.tg.answerCallback).toHaveBeenCalledTimes(2);
    expect(ctx.tg.clearButtons).not.toHaveBeenCalled();
  });

  it('refuses users outside the allowlist', async () => {
    const ctx = makeCtx(db, { allowlist: '999' });
    await seedOperation(db, 1, { id: 'mine', type: 'expense', amount: 5, category: 'Еда', date: '2026-10-10T12:00:00.000Z' }, NOW);
    await handleUpdate(callbackUpdate('undo:mine'), ctx);
    expect(await countOperations(db, 1)).toBe(1);
  });
});
