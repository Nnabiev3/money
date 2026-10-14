import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { hitRateLimit } from '../src/limits.js';
import { NOW, resetDb } from './helpers.js';

const db = env.DB;
beforeEach(() => resetDb(db));

describe('hitRateLimit', () => {
  it('counts hits and refuses once the limit is exceeded', async () => {
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await hitRateLimit(db, 1, 'bot', 2, NOW));
    expect(results).toEqual([{ allowed: true, count: 1 }, { allowed: true, count: 2 }, { allowed: false, count: 3 }]);
  });

  it('keeps users and scopes separate', async () => {
    await hitRateLimit(db, 1, 'bot', 1, NOW);
    expect(await hitRateLimit(db, 2, 'bot', 1, NOW)).toEqual({ allowed: true, count: 1 });
    expect(await hitRateLimit(db, 1, 'api', 1, NOW)).toEqual({ allowed: true, count: 1 });
  });

  it('starts a fresh window the next minute', async () => {
    await hitRateLimit(db, 1, 'bot', 1, NOW);
    expect(await hitRateLimit(db, 1, 'bot', 1, NOW + 60_000)).toEqual({ allowed: true, count: 1 });
  });

  it('forgets windows older than five minutes', async () => {
    await hitRateLimit(db, 1, 'bot', 5, NOW - 10 * 60_000);
    await hitRateLimit(db, 1, 'bot', 5, NOW);
    const { results } = await db.prepare('SELECT COUNT(*) AS n FROM rate_limits').all();
    expect(results[0].n).toBe(1);
  });
});
