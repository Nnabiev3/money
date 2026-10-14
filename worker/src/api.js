import { verifyInitData } from './auth.js';
import {
  countOperations, deleteAllStatements, ensureUser, listOperations, removeStatements, saveSettingsStatement, upsertStatements
} from './db.js';
import { corsHeaders, fail, ok, readJson } from './http.js';
import { API_RATE_PER_MINUTE, hitRateLimit, isAllowed, MAX_BODY_BYTES, MAX_OPERATIONS } from './limits.js';
import { validateSync } from './validate.js';

async function authenticate(request, botToken, nowMs) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('tma ')) return { ok: false };
  return verifyInitData(header.slice(4), botToken, nowMs);
}

async function getData(db, userId, nowMs, cors) {
  const user = await ensureUser(db, userId, nowMs);
  const operations = await listOperations(db, userId);
  return ok({ operations, settings: user.settings, monthTarget: user.monthTarget }, cors);
}

async function postSync(request, db, userId, nowMs, cors, maxOperations) {
  const body = await readJson(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.error, body.status, cors);
  const checked = validateSync(body.value);
  if (!checked.ok) return fail(checked.error, 400, cors);

  const { upsert, remove, settings, monthTarget, rejected } = checked.value;
  await ensureUser(db, userId, nowMs);
  if ((await countOperations(db, userId)) - remove.length + upsert.length > maxOperations) {
    return fail('Достигнут лимит операций', 409, cors);
  }

  const statements = [...upsertStatements(db, userId, upsert, nowMs), ...removeStatements(db, userId, remove)];
  if (settings !== undefined || monthTarget !== undefined) {
    statements.push(saveSettingsStatement(db, userId, { settings, monthTarget }, nowMs));
  }
  if (statements.length) await db.batch(statements);
  return ok({ applied: upsert.length, removed: remove.length, rejected }, cors);
}

async function deleteData(db, userId, cors) {
  await db.batch(deleteAllStatements(db, userId));
  return ok({ deleted: true }, cors);
}

/**
 * Обработчик /api/*: проверка подписи Telegram, допуск, лимит запросов, маршруты.
 * @param {Request} request
 * @param {{ db: D1Database, botToken: string, allowedOrigin?: string, allowlist?: string, maxOperations?: number }} config
 * @param {number} [nowMs]
 */
export async function handleApi(request, config, nowMs = Date.now()) {
  const cors = corsHeaders(request, config.allowedOrigin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const auth = await authenticate(request, config.botToken, nowMs);
  if (!auth.ok) return fail('Нужна авторизация через Telegram', 401, cors);
  if (!isAllowed(config.allowlist, auth.userId)) return fail('Доступ закрыт', 403, cors);

  const limit = await hitRateLimit(config.db, auth.userId, 'api', API_RATE_PER_MINUTE, nowMs);
  if (!limit.allowed) return fail('Слишком много запросов. Подождите минуту.', 429, { ...cors, 'Retry-After': '60' });

  const route = `${request.method} ${new URL(request.url).pathname}`;
  if (route === 'GET /api/data') return getData(config.db, auth.userId, nowMs, cors);
  if (route === 'POST /api/sync') {
    return postSync(request, config.db, auth.userId, nowMs, cors, config.maxOperations ?? MAX_OPERATIONS);
  }
  if (route === 'DELETE /api/data') return deleteData(config.db, auth.userId, cors);
  return fail('Не найдено', 404, cors);
}
