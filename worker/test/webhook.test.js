import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listOperations } from '../src/db.js';
import { handleWebhook } from '../src/webhook.js';
import { NOW, resetDb, textUpdate } from './helpers.js';

const db = env.DB;
const config = (overrides = {}) => ({
  db, botToken: 'test-token', webhookSecret: 'test-secret', appUrl: 'https://example.github.io/money/', allowlist: '', ...overrides
});
const ctx = () => ({ waitUntil: vi.fn() });
const webhookRequest = (body, secret = 'test-secret') => new Request('https://bot.test/telegram/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

let fetchSpy;
beforeEach(async () => {
  await resetDb(db);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

describe('handleWebhook', () => {
  it('answers 401 without the secret header and does nothing', async () => {
    const response = await handleWebhook(webhookRequest(textUpdate('/help'), null), config(), ctx(), NOW);
    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 401 for a wrong secret', async () => {
    expect((await handleWebhook(webhookRequest(textUpdate('/help'), 'nope'), config(), ctx(), NOW)).status).toBe(401);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect((await handleWebhook(webhookRequest('{oops'), config(), ctx(), NOW)).status).toBe(400);
  });

  it('runs the command and replies through the Bot API using the configured token', async () => {
    const response = await handleWebhook(webhookRequest(textUpdate('/spent 500 такси')), config(), ctx(), NOW);
    expect(response.status).toBe(200);
    expect(await listOperations(db, 1)).toHaveLength(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(JSON.parse(init.body).text).toContain('✅ Расход 500 ₽');
  });

  it('still answers 200 when Telegram itself is unreachable (the data is already saved)', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async () => { throw new Error('offline'); });
    const response = await handleWebhook(webhookRequest(textUpdate('/spent 500 такси')), config(), ctx(), NOW);
    expect(response.status).toBe(200);
    expect(await listOperations(db, 1)).toHaveLength(1);
    errorLog.mockRestore();
  });
});
