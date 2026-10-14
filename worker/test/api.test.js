import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../src/api.js';
import { countOperations } from '../src/db.js';
import { initDataFields, NOW, resetDb, signInitData } from './helpers.js';

const db = env.DB;
const TOKEN = 'test-token';
const ORIGIN = 'https://example.github.io';
const config = (overrides = {}) => ({ db, botToken: TOKEN, allowedOrigin: ORIGIN, allowlist: '', ...overrides });
const nowSec = Math.floor(NOW / 1000);

async function call(method, path, { userId = 1, body, headers = {}, cfg = config(), authDate = nowSec } = {}) {
  const auth = `tma ${await signInitData(TOKEN, initDataFields(userId, authDate))}`;
  const request = new Request(`https://api.test${path}`, {
    method,
    headers: { Authorization: auth, Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const response = await handleApi(request, cfg, NOW);
  return { response, json: await response.json().catch(() => null) };
}

const op = (id, overrides = {}) => ({
  id, name: 'Такси', amount: 100, type: 'expense', category: 'Транспорт', date: '2026-10-10T09:00:00.000Z', source: null, ...overrides
});

beforeEach(() => resetDb(db));

describe('authentication and access', () => {
  it('answers 401 without a header, with a bad signature and with expired data', async () => {
    const noHeader = await handleApi(new Request('https://api.test/api/data', { headers: { Origin: ORIGIN } }), config(), NOW);
    expect(noHeader.status).toBe(401);

    const forged = await handleApi(new Request('https://api.test/api/data', { headers: { Authorization: 'tma auth_date=1&hash=00' } }), config(), NOW);
    expect(forged.status).toBe(401);

    const expired = await call('GET', '/api/data', { authDate: nowSec - 2 * 86400 });
    expect(expired.response.status).toBe(401);
  });

  it('answers 403 to users outside the allowlist', async () => {
    const { response } = await call('GET', '/api/data', { cfg: config({ allowlist: '999' }) });
    expect(response.status).toBe(403);
  });

  it('answers 429 once the per-minute limit is used up', async () => {
    const minute = Math.floor(NOW / 60_000);
    await db.prepare("INSERT INTO rate_limits (user_id, scope, minute, count) VALUES (1, 'api', ?, 120)").bind(minute).run();
    const { response } = await call('GET', '/api/data');
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('handles the CORS preflight without authentication', async () => {
    const response = await handleApi(new Request('https://api.test/api/sync', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), config(), NOW);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('adds CORS headers to answers only for the allowed origin', async () => {
    const allowed = await call('GET', '/api/data');
    expect(allowed.response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const foreign = await call('GET', '/api/data', { headers: { Origin: 'https://evil.example' } });
    expect(foreign.response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers 404 for unknown routes', async () => {
    expect((await call('GET', '/api/nope')).response.status).toBe(404);
  });
});

describe('GET /api/data', () => {
  it('creates a new user with defaults and no operations', async () => {
    const { json } = await call('GET', '/api/data');
    expect(json.success).toBe(true);
    expect(json.data.operations).toEqual([]);
    expect(json.data.monthTarget).toBe(100000);
    expect(json.data.settings.currency).toBe('₽');
  });
});

describe('POST /api/sync', () => {
  it('stores operations, settings and the month target, and returns them on the next read', async () => {
    const settings = { goal: 5, goalName: 'Цель', currency: '$', categories: { income: ['Зарплата'], expense: ['Еда'] } };
    const sync = await call('POST', '/api/sync', { body: { upsert: [op('a'), op('b', { amount: 7 })], settings, monthTarget: 150000 } });
    expect(sync.json.data).toEqual({ applied: 2, removed: 0, rejected: [] });

    const { json } = await call('GET', '/api/data');
    expect(json.data.operations.map(o => [o.id, o.amount])).toEqual([['a', 100], ['b', 7]]);
    expect(json.data.monthTarget).toBe(150000);
    expect(json.data.settings).toMatchObject({ goal: 5, currency: '$', categories: { expense: ['Еда'] } });
  });

  it('is idempotent: sending the same change twice leaves one copy', async () => {
    await call('POST', '/api/sync', { body: { upsert: [op('a')] } });
    await call('POST', '/api/sync', { body: { upsert: [op('a', { amount: 250 })] } });
    const { json } = await call('GET', '/api/data');
    expect(json.data.operations).toHaveLength(1);
    expect(json.data.operations[0].amount).toBe(250);
  });

  it('removes operations by id', async () => {
    await call('POST', '/api/sync', { body: { upsert: [op('a'), op('b')] } });
    const { json } = await call('POST', '/api/sync', { body: { remove: ['a'] } });
    expect(json.data.removed).toBe(1);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('keeps the good operations and reports the broken ones', async () => {
    const { json } = await call('POST', '/api/sync', { body: { upsert: [op('good'), op('zero', { amount: 0 }), op('baddate', { date: 'yesterday' })] } });
    expect(json.success).toBe(true);
    expect(json.data.applied).toBe(1);
    expect(json.data.rejected).toEqual([{ id: 'zero', reason: 'bad-amount' }, { id: 'baddate', reason: 'bad-date' }]);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('answers 400 for broken JSON, a bad shape and oversized batches', async () => {
    const broken = await handleApi(new Request('https://api.test/api/sync', {
      method: 'POST', body: '{oops',
      headers: { Authorization: `tma ${await signInitData(TOKEN, initDataFields(1, nowSec))}` }
    }), config(), NOW);
    expect(broken.status).toBe(400);

    expect((await call('POST', '/api/sync', { body: { upsert: 'x' } })).response.status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => op(`id${i}`));
    expect((await call('POST', '/api/sync', { body: { upsert: many } })).response.status).toBe(400);
  });

  it('answers 413 for a body over the size limit', async () => {
    const { response } = await call('POST', '/api/sync', { body: { upsert: [op('a', { name: 'я'.repeat(1_100_000) })] } });
    expect(response.status).toBe(413);
  });

  it('answers 409 when the sync would push the user over the operation limit', async () => {
    const tight = config({ maxOperations: 1 });
    await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('first')] } });
    const { response } = await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('second')] } });
    expect(response.status).toBe(409);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('still lets a user at the limit swap an operation (remove one, add one)', async () => {
    const tight = config({ maxOperations: 1 });
    await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('first')] } });
    const { response } = await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('second')], remove: ['first'] } });
    expect(response.status).toBe(200);
    expect(await countOperations(db, 1)).toBe(1);
  });
});

describe('data isolation and deletion', () => {
  it('never shows one user\'s data to another', async () => {
    await call('POST', '/api/sync', { userId: 1, body: { upsert: [op('mine')] } });
    const { json } = await call('GET', '/api/data', { userId: 2 });
    expect(json.data.operations).toEqual([]);
  });

  it('one user cannot remove another user\'s operation', async () => {
    await call('POST', '/api/sync', { userId: 1, body: { upsert: [op('mine')] } });
    await call('POST', '/api/sync', { userId: 2, body: { remove: ['mine'] } });
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('DELETE /api/data wipes the caller\'s data only', async () => {
    await call('POST', '/api/sync', { userId: 1, body: { upsert: [op('a')] } });
    await call('POST', '/api/sync', { userId: 2, body: { upsert: [op('b')] } });
    const { json } = await call('DELETE', '/api/data', { userId: 1 });
    expect(json.data).toEqual({ deleted: true });
    expect(await countOperations(db, 1)).toBe(0);
    expect(await countOperations(db, 2)).toBe(1);
  });
});
