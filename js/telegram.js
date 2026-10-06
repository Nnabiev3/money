// ===== Telegram Mini App =====
// Вне Telegram ничего не делает. Внутри — тема Telegram, полный экран,
// вибро-отклик и синхронизация данных через Telegram CloudStorage.

const tg = window.Telegram && Telegram.WebApp;
const inTelegram = !!(tg && tg.initData);

if (inTelegram) {
  document.documentElement.classList.add('tg');
  tg.ready();
  tg.expand();

  // Тема: если пользователь сам не выбирал — берём тему Telegram
  if (!localStorage.getItem('themeChosen')) {
    settings.theme = tg.colorScheme === 'light' ? 'light' : 'dark';
    applyTheme();
  }
  $('themeBtn').addEventListener('click', () => localStorage.setItem('themeChosen', '1'));
  const syncHeader = () => {
    const bg = getComputedStyle(document.body).backgroundColor;
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch (e) { /* старый клиент */ }
  };
  syncHeader();
  $('themeBtn').addEventListener('click', syncHeader);

  // Вибро-отклик на тосты (добавление, удаление, импорт)
  const origToast = toast;
  toast = text => {
    try { tg.HapticFeedback.notificationOccurred(/не |неверн|ошиб|укажи/i.test(text) ? 'error' : 'success'); } catch (e) { /* нет поддержки */ }
    origToast(text);
  };
}

// ----- Облачная синхронизация -----
// Значение в CloudStorage — до 4096 символов, поэтому данные режутся на куски
const CHUNK = 4000;
const cs = () => tg.CloudStorage;
const call = (fn, ...args) => new Promise((resolve, reject) =>
  cs()[fn](...args, (err, res) => err ? reject(err) : resolve(res)));

async function cloudRead() {
  const meta = JSON.parse((await call('getItem', 'meta')) || 'null');
  if (!meta) return null;
  const keys = Array.from({ length: meta.n }, (_, i) => 'd' + i);
  const parts = await call('getItems', keys);
  return { updatedAt: meta.updatedAt, data: JSON.parse(keys.map(k => parts[k] || '').join('')) };
}

async function cloudWrite() {
  const updatedAt = Number(localStorage.getItem('updatedAt')) || Date.now();
  const json = JSON.stringify({ operations, settings, monthTarget: getMonthTarget() });
  const n = Math.ceil(json.length / CHUNK);
  for (let i = 0; i < n; i++) await call('setItem', 'd' + i, json.slice(i * CHUNK, (i + 1) * CHUNK));
  // meta пишем последним — так при обрыве останутся прежние полные данные
  await call('setItem', 'meta', JSON.stringify({ n, updatedAt }));
  const stale = (await call('getKeys')).filter(k => /^d\d+$/.test(k) && +k.slice(1) >= n);
  if (stale.length) await call('removeItems', stale);
}

function applyCloud(data) {
  operations = data.operations || [];
  settings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (data.monthTarget) localStorage.setItem('monthTarget', data.monthTarget);
  lastSaved = JSON.stringify([operations, settings, getMonthTarget()]);
  applyTheme();
  updateCategories();
  render();
}

async function initCloudSync() {
  const localAt = Number(localStorage.getItem('updatedAt')) || 0;
  try {
    const cloud = await cloudRead();
    if (cloud && cloud.updatedAt > localAt) {
      localStorage.setItem('updatedAt', cloud.updatedAt);
      applyCloud(cloud.data);
    } else if (!cloud || cloud.updatedAt < localAt) {
      await cloudWrite();
    }
  } catch (e) {
    console.warn('CloudStorage недоступен', e);
  }

  let timer;
  document.addEventListener('money:changed', () => {
    clearTimeout(timer);
    timer = setTimeout(() => cloudWrite().catch(e => console.warn('Синхронизация не удалась', e)), 800);
  });
}

if (inTelegram && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) initCloudSync();
