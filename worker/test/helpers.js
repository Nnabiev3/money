import { vi } from 'vitest';

/** 14 октября 2026, 12:00 по Москве. */
export const NOW = Date.UTC(2026, 9, 14, 9, 0, 0);

export async function resetDb(db) {
  await db.batch(['operations', 'users', 'processed_updates', 'rate_limits'].map(table => db.prepare(`DELETE FROM ${table}`)));
}

export function fakeTelegram() {
  return {
    send: vi.fn(async () => ({ ok: true })),
    answerCallback: vi.fn(async () => ({ ok: true })),
    clearButtons: vi.fn(async () => ({ ok: true }))
  };
}

export function makeCtx(db, overrides = {}) {
  return { db, tg: fakeTelegram(), appUrl: 'https://example.github.io/money/', allowlist: '', nowMs: NOW, ...overrides };
}

export function textUpdate(text, { userId = 1, updateId = 1, chatType = 'private' } = {}) {
  return { update_id: updateId, message: { message_id: updateId, from: { id: userId }, chat: { id: userId, type: chatType }, text } };
}

export function callbackUpdate(data, { userId = 1, updateId = 1000, messageId = 5 } = {}) {
  return {
    update_id: updateId,
    callback_query: { id: `cb${updateId}`, from: { id: userId }, data, message: { message_id: messageId, chat: { id: userId, type: 'private' } } }
  };
}

/** Кладёт операцию напрямую в базу, минуя код приложения. */
export async function seedOperation(db, userId, op, nowMs = NOW) {
  await db.prepare('INSERT OR IGNORE INTO users (id, settings, month_target, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, '{}', 100000, nowMs, nowMs).run();
  await db.prepare('INSERT INTO operations (id, user_id, type, name, amount, category, date, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(op.id, userId, op.type, op.name ?? op.category, op.amount, op.category ?? null, op.date, op.source ?? null, op.createdAt ?? nowMs).run();
}

const encoder = new TextEncoder();

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Собирает подписанную строку initData так, как это делает Telegram. */
export async function signInitData(botToken, fields) {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const hash = Array.from(await hmac(secret, dataCheckString), byte => byte.toString(16).padStart(2, '0')).join('');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export function initDataFields(userId, authDateSec, extra = {}) {
  return {
    auth_date: String(authDateSec),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: userId, first_name: 'Иван', language_code: 'ru' }),
    signature: 'c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
    ...extra
  };
}
