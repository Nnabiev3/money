import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('migration creates exactly the four application tables', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'"
    ).all();
    expect(results.map(row => row.name).sort()).toEqual(['operations', 'processed_updates', 'rate_limits', 'users']);
  });
});
