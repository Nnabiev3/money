import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker routing', () => {
  it('answers 404 for unknown paths', async () => {
    const response = await exports.default.fetch('http://example.com/nope');
    expect(response.status).toBe(404);
  });

  it('rejects a webhook call without the secret', async () => {
    const response = await exports.default.fetch('http://example.com/telegram/webhook', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
  });

  it('answers the CORS preflight for the configured origin', async () => {
    // значение берём из окружения: оно может прийти и из wrangler.toml, и из тестовых привязок
    const response = await exports.default.fetch('http://example.com/api/sync', {
      method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN);
  });

  it('requires Telegram authentication for the API', async () => {
    const response = await exports.default.fetch('http://example.com/api/data');
    expect(response.status).toBe(401);
  });

  it('does not treat GET on the webhook path as a webhook', async () => {
    const response = await exports.default.fetch('http://example.com/telegram/webhook');
    expect(response.status).toBe(404);
  });
});
