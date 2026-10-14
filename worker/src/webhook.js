import { verifyWebhookSecret } from './auth.js';
import { handleUpdate } from './commands.js';
import { purgeProcessedUpdates } from './db.js';
import { readJson } from './http.js';
import { MAX_BODY_BYTES } from './limits.js';
import { createTelegram } from './telegram.js';

const PURGE_CHANCE = 0.01;
const PROCESSED_UPDATES_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Вход Telegram: проверка секрета, разбор обновления, команда.
 * Непредвиденные ошибки базы всплывают наверх (ответ 500, Telegram повторит; повтор безопасен).
 * @param {Request} request
 * @param {{ db: D1Database, botToken: string, webhookSecret?: string, appUrl: string, allowlist?: string }} config
 * @param {{ waitUntil: (promise: Promise<unknown>) => void }} ctx
 * @param {number} [nowMs]
 */
export async function handleWebhook(request, config, ctx, nowMs = Date.now()) {
  if (!verifyWebhookSecret(request, config.webhookSecret)) return new Response('Unauthorized', { status: 401 });

  const body = await readJson(request, MAX_BODY_BYTES);
  if (!body.ok) return new Response(body.error, { status: body.status });

  await handleUpdate(body.value, {
    db: config.db,
    tg: createTelegram(config.botToken),
    appUrl: config.appUrl,
    allowlist: config.allowlist,
    nowMs
  });

  // изредка забываем старые update_id, чтобы таблица не росла
  if (Math.random() < PURGE_CHANCE) ctx.waitUntil(purgeProcessedUpdates(config.db, nowMs - PROCESSED_UPDATES_TTL_MS));
  return new Response('OK');
}
