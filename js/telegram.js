// ===== Telegram Mini App =====
// Вне Telegram ничего не делает. Внутри — тема Telegram, полный экран и вибро-отклик.
// Синхронизация данных с сервером — в js/api.js.

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
  toast = (text, action) => {
    try { tg.HapticFeedback.notificationOccurred(/не |неверн|ошиб|укажи/i.test(text) ? 'error' : 'success'); } catch (e) { /* нет поддержки */ }
    origToast(text, action);
  };
}
