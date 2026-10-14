import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../src/commands.js';
import { makeCtx, NOW, resetDb, seedOperation, textUpdate } from './helpers.js';

const db = env.DB;
const lastReply = ctx => ctx.tg.send.mock.calls.at(-1);

async function seedMonth() {
  const ops = [
    { id: 'a', type: 'income', amount: 120000, category: 'Зарплата', date: '2026-10-03T09:00:00.000Z', createdAt: NOW },
    { id: 'b', type: 'expense', amount: 35000, category: 'Жильё', date: '2026-10-05T09:00:00.000Z', createdAt: NOW + 1 },
    { id: 'c', type: 'expense', amount: 5520, category: 'Еда', name: 'Пятёрочка', date: '2026-10-12T09:00:00.000Z', createdAt: NOW + 2 },
    { id: 'd', type: 'income', amount: 15000, category: 'Подработка', date: '2026-09-20T09:00:00.000Z', createdAt: NOW + 3 }
  ];
  for (const op of ops) await seedOperation(db, 1, op);
}

beforeEach(() => resetDb(db));

describe('/balance', () => {
  it('shows the month, the total and the progress to both goals, with the app buttons', async () => {
    await seedMonth();
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/balance'), ctx);

    const [, text, markup] = lastReply(ctx);
    expect(text).toContain('октябрь 2026');
    expect(text).toMatch(/Остаток: 79\D480 ₽/);
    expect(text).toMatch(/Всего накоплено: 94\D480 ₽/);
    expect(text).toMatch(/\(79%\)/);
    expect(text).toMatch(/\(9%\)/);
    expect(markup.inline_keyboard).toHaveLength(2);
  });

  it('works for a user who has no data yet', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/balance'), ctx);
    expect(lastReply(ctx)[1]).toMatch(/Остаток: 0 ₽/);
  });
});

describe('/month', () => {
  it('lists this month\'s expenses by category with shares', async () => {
    await seedMonth();
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/month'), ctx);
    const [, text] = lastReply(ctx);
    expect(text).toMatch(/Всего: 40\D520 ₽/);
    expect(text).toMatch(/Жильё — 35\D000 ₽ \(86%\)/);
    expect(text).toMatch(/Еда — 5\D520 ₽ \(14%\)/);
  });

  it('says so when there are no expenses this month', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/month'), ctx);
    expect(lastReply(ctx)[1]).toBe('Расходов за октябрь 2026 нет.');
  });
});

describe('/last', () => {
  beforeEach(async () => {
    for (let i = 0; i < 7; i++) {
      await seedOperation(db, 1, { id: `op${i}`, type: 'expense', amount: 100 + i, category: 'Еда', date: '2026-10-10T09:00:00.000Z', createdAt: NOW + i });
    }
  });

  const lines = ctx => lastReply(ctx)[1].split('\n').slice(1);

  it('shows the five latest by default, newest first', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last'), ctx);
    expect(lines(ctx)).toHaveLength(5);
    expect(lines(ctx)[0]).toContain('106 ₽');
  });

  it('honours a requested count and caps it at 20', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last 2'), ctx);
    expect(lines(ctx)).toHaveLength(2);
    await handleUpdate(textUpdate('/last 99', { updateId: 2 }), ctx);
    expect(lines(ctx)).toHaveLength(7);
  });

  it('falls back to five for nonsense', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last abc'), ctx);
    expect(lines(ctx)).toHaveLength(5);
    await handleUpdate(textUpdate('/last 0', { updateId: 2 }), ctx);
    expect(lines(ctx)).toHaveLength(5);
  });

  it('says so when there is nothing to show', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last', { userId: 99 }), ctx);
    expect(lastReply(ctx)[1]).toBe('Операций пока нет.');
  });
});
