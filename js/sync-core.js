// ===== Чистая логика синхронизации (без DOM и сети) =====
// В браузере подключается обычным скриптом, в тестах — через require.
// Снимок — то, что, по нашим сведениям, уже лежит на сервере. Разница между снимком
// и текущими данными — это то, что нужно отправить.

const SYNC_CHUNK = 100;

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// Тема остаётся настройкой устройства и на сервер не уходит
function syncableSettings(settings) {
  const { theme, ...rest } = settings;
  return rest;
}

const opKey = op => stableStringify([op.name, op.amount, op.type, op.category ?? null, op.date, op.source ?? null]);

function makeSnapshot(operations, settings, monthTarget) {
  const ops = {};
  for (const op of operations) ops[op.id] = opKey(op);
  return { ops, settings: stableStringify(syncableSettings(settings)), monthTarget };
}

function computeDiff(snapshot, operations, settings, monthTarget) {
  const seen = new Set();
  const upsert = [];
  for (const op of operations) {
    seen.add(op.id);
    if (snapshot.ops[op.id] !== opKey(op)) upsert.push(op);
  }
  const remove = Object.keys(snapshot.ops).filter(id => !seen.has(id));
  const syncable = syncableSettings(settings);
  return {
    upsert,
    remove,
    settings: stableStringify(syncable) !== snapshot.settings ? syncable : undefined,
    monthTarget: monthTarget !== snapshot.monthTarget ? monthTarget : undefined
  };
}

function isEmptyDiff(diff) {
  return !diff.upsert.length && !diff.remove.length && diff.settings === undefined && diff.monthTarget === undefined;
}

// Порции по SYNC_CHUNK; настройки и цель месяца едут с первой порцией
function splitDiff(diff, size = SYNC_CHUNK) {
  const parts = Math.max(Math.ceil(diff.upsert.length / size), Math.ceil(diff.remove.length / size));
  const payloads = [];
  for (let i = 0; i < parts; i++) {
    payloads.push({ upsert: diff.upsert.slice(i * size, (i + 1) * size), remove: diff.remove.slice(i * size, (i + 1) * size) });
  }
  const hasExtras = diff.settings !== undefined || diff.monthTarget !== undefined;
  if (hasExtras && !payloads.length) payloads.push({ upsert: [], remove: [] });
  if (hasExtras) {
    payloads[0] = { ...payloads[0], settings: diff.settings, monthTarget: diff.monthTarget };
  }
  return payloads;
}

// Снимок после успешной отправки порции
function applyToSnapshot(snapshot, payload) {
  const ops = { ...snapshot.ops };
  for (const op of payload.upsert || []) ops[op.id] = opKey(op);
  for (const id of payload.remove || []) delete ops[id];
  return {
    ops,
    settings: payload.settings !== undefined ? stableStringify(payload.settings) : snapshot.settings,
    monthTarget: payload.monthTarget !== undefined ? payload.monthTarget : snapshot.monthTarget
  };
}

// Первая синхронизация: операции объединяются по id (при совпадении побеждает сервер);
// настройки по умолчанию на сервере уступают локальным, изменённые — побеждают
function mergeFirstRun(local, server, defaults) {
  const serverIds = new Set(server.operations.map(op => op.id));
  const operations = [...server.operations, ...local.operations.filter(op => !serverIds.has(op.id))];
  const serverSettingsAreDefault = stableStringify(syncableSettings(server.settings)) === stableStringify(defaults.settings);
  return {
    operations,
    settings: serverSettingsAreDefault ? local.settings : syncableSettings(server.settings),
    monthTarget: server.monthTarget === defaults.monthTarget ? local.monthTarget : server.monthTarget
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SYNC_CHUNK, stableStringify, syncableSettings, makeSnapshot, computeDiff, isEmptyDiff, splitDiff, applyToSnapshot, mergeFirstRun
  };
}
