const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

export const COMMAND_MENU = [
  { command: 'spent', description: 'Добавить расход: /spent 500 такси' },
  { command: 'income', description: 'Добавить доход: /income 50000 зарплата' },
  { command: 'balance', description: 'Баланс и прогресс к целям' },
  { command: 'month', description: 'Расходы за месяц по категориям' },
  { command: 'last', description: 'Последние операции' },
  { command: 'undo', description: 'Удалить последнюю операцию' },
  { command: 'statement', description: 'Загрузить банковскую выписку' },
  { command: 'deleteall', description: 'Удалить все мои данные' },
  { command: 'help', description: 'Список команд' }
];

function requireHttps(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name}: неверный адрес`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} должен начинаться с https://`);
  return url;
}

/**
 * Запросы Bot API для первичной настройки бота.
 * @param {{ workerUrl: string, appUrl: string, secret: string }} input
 * @returns {{ method: string, payload: object }[]}
 */
export function buildSetupRequests({ workerUrl, appUrl, secret }) {
  if (!SECRET_RE.test(secret || '')) throw new Error('WEBHOOK_SECRET: допустимы буквы, цифры, _ и -, длина 1–256');
  const worker = requireHttps(workerUrl, 'WORKER_URL');
  requireHttps(appUrl, 'APP_URL');

  return [
    {
      method: 'setWebhook',
      payload: {
        url: `${worker.origin}/telegram/webhook`,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query']
      }
    },
    { method: 'setMyCommands', payload: { commands: COMMAND_MENU } },
    {
      method: 'setChatMenuButton',
      payload: { menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: appUrl } } }
    }
  ];
}
