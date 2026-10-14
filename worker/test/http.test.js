import { describe, expect, it } from 'vitest';
import { corsHeaders, fail, ok, readJson } from '../src/http.js';

const ORIGIN = 'https://example.github.io';
const request = (origin, body, headers = {}) => new Request('https://x.test/api/sync', {
  method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), ...headers }, body
});

describe('response envelope', () => {
  it('ok wraps data', async () => {
    const response = ok({ n: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { n: 1 }, error: null });
  });

  it('fail wraps an error with a status and extra headers', async () => {
    const response = fail('нельзя', 429, { 'Retry-After': '60' });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ success: false, data: null, error: 'нельзя' });
  });
});

describe('corsHeaders', () => {
  it('allows only the configured origin', () => {
    const headers = corsHeaders(request(ORIGIN), ORIGIN);
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(corsHeaders(request('https://evil.example'), ORIGIN)).toEqual({});
    expect(corsHeaders(request(null), ORIGIN)).toEqual({});
  });

  it('never answers with a wildcard, even if no origin is configured', () => {
    expect(corsHeaders(request(ORIGIN), undefined)).toEqual({});
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    expect(await readJson(request(null, '{"a":1}'), 1000)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects broken JSON with 400', async () => {
    expect(await readJson(request(null, '{oops'), 1000)).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a body larger than the limit with 413, by header and by content', async () => {
    expect(await readJson(request(null, 'x', { 'Content-Length': '5000' }), 1000)).toMatchObject({ ok: false, status: 413 });
    expect(await readJson(request(null, JSON.stringify({ a: 'x'.repeat(2000) })), 1000)).toMatchObject({ ok: false, status: 413 });
  });
});
