import { describe, expect, it } from 'vitest';
import { timingSafeEqual, verifyInitData, verifyWebhookSecret } from '../src/auth.js';
import { initDataFields, NOW, signInitData } from './helpers.js';

const TOKEN = 'test-token';
const nowSec = Math.floor(NOW / 1000);

describe('timingSafeEqual', () => {
  it('is true only for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abc', undefined)).toBe(false);
  });
});

describe('verifyWebhookSecret', () => {
  const request = secret => new Request('https://x.test/telegram/webhook', {
    method: 'POST', headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}
  });

  it('accepts the matching secret', () => {
    expect(verifyWebhookSecret(request('s3cret'), 's3cret')).toBe(true);
  });

  it('rejects a wrong or missing secret', () => {
    expect(verifyWebhookSecret(request('other'), 's3cret')).toBe(false);
    expect(verifyWebhookSecret(request(), 's3cret')).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(verifyWebhookSecret(request(''), '')).toBe(false);
    expect(verifyWebhookSecret(request('x'), undefined)).toBe(false);
  });
});

describe('verifyInitData', () => {
  it('accepts correctly signed data, including the signature field and a non-Latin name', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: true, userId: 42 });
  });

  it('rejects data signed with another bot token', async () => {
    const initData = await signInitData('another-token', initDataFields(42, nowSec));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects a tampered user id', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec));
    const params = new URLSearchParams(initData);
    params.set('user', JSON.stringify({ id: 43 }));
    expect(await verifyInitData(params.toString(), TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects data older than 24 hours', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec - 2 * 86400));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects data from the future', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec + 3600));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects missing hash, empty input and non-integer ids', async () => {
    expect(await verifyInitData('auth_date=1', TOKEN, NOW)).toEqual({ ok: false });
    expect(await verifyInitData('', TOKEN, NOW)).toEqual({ ok: false });
    const badId = await signInitData(TOKEN, initDataFields(42, nowSec, { user: JSON.stringify({ id: 'abc' }) }));
    expect(await verifyInitData(badId, TOKEN, NOW)).toEqual({ ok: false });
    const noUser = await signInitData(TOKEN, initDataFields(42, nowSec, { user: 'not json' }));
    expect(await verifyInitData(noUser, TOKEN, NOW)).toEqual({ ok: false });
  });
});
