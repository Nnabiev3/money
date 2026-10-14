// ===== Синхронизация с сервером (только внутри Telegram) =====
// Сервер — источник правды. Мини-апп хранит снимок «что уже на сервере» и отправляет разницу.
// Чистая логика (разница, пачки, первая миграция) — в js/sync-core.js.

const SYNC_DEBOUNCE_MS = 800;
const REQUEST_TIMEOUT_MS = 8000;
const OFFLINE_TOAST_INTERVAL_MS = 60000;
const SNAPSHOT_KEY = 'syncSnapshot';
const SYNCED_ONCE_KEY = 'syncedOnce';
const DEFAULT_MONTH_TARGET = 100000;

const syncEnabled = inTelegram && Boolean(window.MONEY_CONFIG && MONEY_CONFIG.apiUrl);

async function apiRequest(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(MONEY_CONFIG.apiUrl + path, {
      method,
      signal: controller.signal,
      headers: { Authorization: 'tma ' + tg.initData, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || !payload.success) throw new Error((payload && payload.error) || 'HTTP ' + response.status);
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

function loadSnapshot() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)); } catch (e) { return null; }
}

function saveSnapshot(snapshot) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot)); } catch (e) { /* хранилище недоступно */ }
}

const stateFingerprint = () => JSON.stringify([operations, settings, getMonthTarget()]);

// Заменяет локальные данные состоянием сервера. Тема остаётся локальной.
function applyServerState(state) {
  const theme = settings.theme;
  operations = state.operations;
  settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
    categories: { ...DEFAULT_SETTINGS.categories, ...state.settings.categories },
    theme
  };
  localStorage.setItem('monthTarget', state.monthTarget);
  lastSaved = stateFingerprint(); // чтобы render() не принял это за изменение пользователя
  updateCategories();
  render();
}

let lastOfflineToast = 0;
function notifyOffline() {
  if (Date.now() - lastOfflineToast < OFFLINE_TOAST_INTERVAL_MS) return;
  lastOfflineToast = Date.now();
  toast('Нет связи с сервером. Изменения сохранятся позже');
}

// Отправляет накопившуюся разницу порциями; снимок обновляется после каждой успешной порции
async function pushChanges() {
  let snapshot = loadSnapshot();
  if (!snapshot) return; // первой синхронизации ещё не было
  const diff = computeDiff(snapshot, operations, settings, getMonthTarget());
  if (isEmptyDiff(diff)) return;

  let rejectedCount = 0;
  for (const payload of splitDiff(diff)) {
    const result = await apiRequest('POST', '/api/sync', payload);
    snapshot = applyToSnapshot(snapshot, payload);
    saveSnapshot(snapshot);
    rejectedCount += (result.rejected || []).length;
  }
  if (rejectedCount) toast('Часть операций не принята сервером: неверные данные');
}

// Берёт состояние сервера, если пока мы ждали ответа, пользователь ничего не менял
async function pullState() {
  const before = stateFingerprint();
  const server = await apiRequest('GET', '/api/data');
  if (stateFingerprint() !== before) return;
  applyServerState(server);
  saveSnapshot(makeSnapshot(server.operations, server.settings, server.monthTarget));
}

async function firstSync() {
  const server = await apiRequest('GET', '/api/data');
  const merged = mergeFirstRun(
    { operations, settings: syncableSettings(settings), monthTarget: getMonthTarget() },
    server,
    { settings: syncableSettings(DEFAULT_SETTINGS), monthTarget: DEFAULT_MONTH_TARGET }
  );
  saveSnapshot(makeSnapshot(server.operations, server.settings, server.monthTarget));
  applyServerState({ operations: merged.operations, settings: merged.settings, monthTarget: merged.monthTarget });
  localStorage.setItem(SYNCED_ONCE_KEY, '1');
  await pushChanges(); // локальные операции и настройки, которых нет на сервере
}

// Сначала отправляем своё, потом забираем чужое (например, операции, добавленные ботом)
async function syncNow() {
  await pushChanges();
  await pullState();
}

let syncChain = Promise.resolve();
function enqueueSync(task) {
  syncChain = syncChain.then(task).catch(error => {
    console.warn('Синхронизация не удалась', error);
    notifyOffline();
  });
  return syncChain;
}

if (syncEnabled) {
  enqueueSync(() => (localStorage.getItem(SYNCED_ONCE_KEY) ? syncNow() : firstSync()));

  let debounceTimer;
  document.addEventListener('money:changed', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => enqueueSync(pushChanges), SYNC_DEBOUNCE_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') enqueueSync(syncNow);
  });
}
