// Однократная настройка бота: webhook, меню команд, кнопка меню.
// Запуск: BOT_TOKEN=... WORKER_URL=... WEBHOOK_SECRET=... APP_URL=... npm run setup:telegram
import { buildSetupRequests } from '../src/setup.js';

const { BOT_TOKEN, WORKER_URL, WEBHOOK_SECRET, APP_URL } = process.env;
if (!BOT_TOKEN) {
  console.error('Не задан BOT_TOKEN');
  process.exit(1);
}

let requests;
try {
  requests = buildSetupRequests({ workerUrl: WORKER_URL, appUrl: APP_URL, secret: WEBHOOK_SECRET });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

for (const { method, payload } of requests) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  console.log(`${method}: ${result.ok ? 'ok' : `ошибка ${response.status} ${result.description ?? ''}`}`);
  if (!result.ok) process.exitCode = 1;
}
