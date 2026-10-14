# Money bot — Cloudflare Worker

Бот Telegram и API синхронизации для мини-аппа «Money». Данные хранятся в Cloudflare D1.

## Разработка

```bash
cd worker
npm install
npm test                 # тесты
npm run test:coverage    # тесты с покрытием (цель ≥ 80%)
```

## Первичное развёртывание

Нужны: аккаунт Cloudflare и бот от @BotFather.

```bash
cd worker
npx wrangler login
npx wrangler d1 create money-bot            # скопируйте database_id в wrangler.toml
npx wrangler d1 migrations apply money-bot --remote
npx wrangler secret put BOT_TOKEN           # вставьте токен бота (вводится в терминале, нигде не сохраняется в файлах)
npx wrangler secret put WEBHOOK_SECRET      # придумайте длинную случайную строку: буквы, цифры, _ и -
npx wrangler deploy                         # в конце покажет адрес https://money-bot.<аккаунт>.workers.dev
```

Дальше:

1. Впишите адрес Worker в `js/config.js` (`apiUrl`), закоммитьте и запушьте — сайт на GitHub Pages обновится.
2. Один раз настройте бота (webhook, меню команд, кнопка меню):

```bash
BOT_TOKEN=... WORKER_URL=https://money-bot.<аккаунт>.workers.dev WEBHOOK_SECRET=... APP_URL=https://nnabiev3.github.io/money/ npm run setup:telegram
```

Токен и секрет в файлы и репозиторий не попадают.

## Переменные

| Имя | Где | Назначение |
|---|---|---|
| `BOT_TOKEN` | секрет | Токен бота |
| `WEBHOOK_SECRET` | секрет | Проверка, что вебхук вызывает именно Telegram |
| `APP_URL` | `wrangler.toml` | Адрес мини-аппа (для кнопок бота) |
| `ALLOWED_ORIGIN` | `wrangler.toml` | Сайт, которому разрешён CORS (без пути) |
| `ALLOWLIST` | необязательная | ID через запятую: если задана, бот работает только для них |

## Если бесплатные квоты кончаются

Включите `ALLOWLIST`: `npx wrangler secret put ALLOWLIST` (значение вида `123456,789012`) и `npx wrangler deploy`.
