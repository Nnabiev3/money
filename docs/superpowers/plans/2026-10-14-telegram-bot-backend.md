# Telegram-бот и серверная синхронизация — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот в Telegram принимает `/spent`, `/income`, `/balance` и другие команды, хранит данные на сервере и делит их с мини-аппом; кнопка «📥 Добавить выписку» в чате открывает мини-апп сразу на выборе файла.

**Architecture:** Один Cloudflare Worker с базой D1 (`worker/`): webhook Telegram, API для мини-аппа (`/api/data`, `/api/sync`) и общее ядро `addOperation`/`getReport`. Мини-апп внутри Telegram синхронизируется по разнице со снимком сервера (`js/sync-core.js` + `js/api.js`), вне Telegram работает локально, как сейчас.

**Tech Stack:** JavaScript (ES-модули, JSDoc), Cloudflare Workers + D1, Wrangler 4, Vitest 4 + `@cloudflare/vitest-plugin` (тесты воркера), `node:test` (тесты чистой логики мини-аппа). Всё проверено в песочнице: Worker, D1-миграции, WebCrypto, замер покрытия (istanbul) работают на этой машине (Windows, Node 24).

**Spec:** `docs/superpowers/specs/2026-10-14-telegram-bot-backend-design.md`

## Global Constraints

- Хостинг Cloudflare Workers + D1; код сервера на JavaScript ES-модулях с JSDoc у экспортируемых функций (как остальной проект).
- Секреты `BOT_TOKEN` и `WEBHOOK_SECRET` только в `wrangler secret`; в репозитории и в чате их нет (репозиторий публичный).
- Сумма: больше 0, не больше `999999999.99`, не больше двух знаков после запятой. Форматы `500`, `1 500`, `1500,50`, `1500.50`.
- Дата операции бота: только календарный день, «сегодня» по UTC+3 одной константой; хранится как `YYYY-MM-DDT12:00:00.000Z`.
- `/last` по умолчанию 5, максимум 20. `auth_date` у `initData` не старше 24 часов.
- Лимиты: 20 000 операций на пользователя, бот 30 сообщений в минуту, API 120 запросов в минуту (см. отклонения от спеки ниже).
- Кнопки бота: inline Web App (у кнопки-клавиатуры `initData` пустой). Адреса: `APP_URL` и `APP_URL?action=import`.
- Все тексты для пользователя на русском; весь пользовательский текст в HTML-ответах бота экранируется.
- Бот работает только в личных чатах. Необязательная переменная `ALLOWLIST` (ID через запятую) ограничивает доступ.
- Стиль: без мутации входных данных, функции до 50 строк, файлы до 800 строк, без `console.log` (логи ошибок на сервере через `console.error`), покрытие `worker/src` не ниже 80%.
- Коммиты на русском в формате `тип: описание` (`feat`, `test`, `chore`, `docs`), в конец сообщения добавляется строка авторства из системной подсказки. **`git push` без прямого разрешения пользователя не делать.**

### Отклонения от спеки (решения, принятые при планировании; спека правится в Task 16)

1. **Лимиты раздельные:** бот 30/мин, API 120/мин (колонка `scope` в `rate_limits`). Первая миграция данных требует много запросов, 30 в минуту её бы заблокировало.
2. **В одном `sync` не больше 100 операций и 100 удалений** (вместо 500): у D1 лимит 100 параметров на запрос и ограничено число запросов за вызов. Операции пишутся пачками по 10 строк, удаления по 90 id.
3. **Тексты усекаются, а не отвергаются** (`name` до 200, `category` до 40). Одна неверная операция (плохая сумма, дата, тип, id) **пропускается и попадает в список `rejected`**, а не валит весь запрос: иначе одна испорченная запись из ручного JSON-импорта блокировала бы синхронизацию навсегда.
4. **Тема (`theme`) не синхронизируется:** остаётся настройкой устройства (иначе сервер перетирал бы тему Telegram).
5. **Снимок синхронизации хранится в `localStorage`**, поэтому изменения, сделанные без сети, переживают перезапуск.

### Известные ограничения (не лечатся в этом плане)

- Бесплатный тариф Workers даёт 10 мс процессорного времени на запрос; выдача 20 000 операций одним `GET /api/data` может его превысить. Тогда нужен платный тариф ($5/мес) или `ALLOWLIST`.
- Откуда берётся «сегодня» (UTC+3) — это константа, а не настройка пользователя.

## Review Focus

Входы и условия, которые спека подразумевает, но обычные тесты задач не проверяют; каждая строка закреплена тестом в указанной задаче:

1. **HTML и разметка в описании операции** (`/spent 5 <b>x</b> & <i>`): текст в ответе бота экранируется, форматирование не ломается. Тест в Task 10.
2. **Суммы с неразрывным пробелом и «500р»:** `1 500` с обычным и неразрывным пробелом читаются, `500р` и `-5` дают подсказку, а не операцию. Тест в Task 3.
3. **Испорченные операции из ручного JSON-импорта** (нулевая сумма, неверная дата, чужой `type`): остальные операции сохраняются, неверные попадают в `rejected`, запрос не падает. Тесты в Task 8 и Task 12.
4. **Первая миграция более 100 операций с обрывом посередине:** отправка идёт пачками, снимок обновляется после каждой успешной пачки, повторный запуск досылает только остаток. Тест в Task 14.
5. **`initData` с полем `signature` и именем не на латинице:** подпись сходится (в строку проверки входят все поля, кроме `hash`). Тест в Task 7.

---

## File Structure

Новое в `worker/`:

| Файл | Ответственность |
|---|---|
| `package.json`, `wrangler.toml`, `vitest.config.js`, `.gitignore` | Сборка, конфигурация Worker и тестов |
| `migrations/0001_init.sql` | Схема D1 |
| `src/format.js` | Деньги, даты, экранирование HTML, проценты |
| `src/limits.js` | Константы лимитов, `isAllowed`, `hitRateLimit` |
| `src/parse.js` | Разбор команды и суммы |
| `src/categories.js` | Настройки по умолчанию, правила автокатегорий, `resolveCategory` |
| `src/db.js` | Все запросы к D1 |
| `src/core.js` | `addOperation`, `getReport`, `balanceSummary` (общее ядро) |
| `src/auth.js` | Проверка секрета webhook и подписи `initData` |
| `src/validate.js` | Проверка и нормализация входа `/api/sync` |
| `src/telegram.js` | Клиент Bot API и inline-клавиатуры |
| `src/messages.js` | Тексты ответов бота |
| `src/commands.js` | Диспетчер и обработчики команд и кнопок |
| `src/reports.js` | `/balance`, `/month`, `/last` |
| `src/http.js` | JSON-ответы, CORS, чтение тела |
| `src/api.js` | Обработчики `/api/*` |
| `src/webhook.js` | Обработчик `/telegram/webhook` |
| `src/index.js` | Маршрутизация |
| `src/setup.js`, `scripts/setup-telegram.js` | Настройка бота в Telegram (webhook, меню команд) |
| `test/*.test.js`, `test/helpers.js`, `test/apply-migrations.js` | Тесты |

Новое и изменяемое в мини-аппе:

| Файл | Ответственность |
|---|---|
| `js/sync-core.js` (новый) | Чистая логика синхронизации: снимок, разница, пачки, первая миграция |
| `js/config.js` (новый) | Адрес сервера (`apiUrl`) |
| `js/api.js` (новый) | Сетевая обвязка синхронизации |
| `js/telegram.js` | Убрать CloudStorage, оставить тему и вибро-отклик |
| `js/script.js` | Убрать `updatedAt` из `save()` |
| `js/import.js`, `index.html` | Окно «Выберите файл» по `?action=import`, подключение скриптов |
| `tests/sync-core.test.js` (новый) | Тесты на `node:test` |
| `README.md`, `worker/README.md` | Документация и развёртывание |

---

### Task 0: Закоммитить накопленную работу (требует согласия пользователя)

В рабочей папке лежат незакоммиченные правки: пакет A по доступности (5 файлов: `css/style.css`, `index.html`, `js/import.js`, `js/script.js`, `js/telegram.js`) и документы `docs/superpowers/`. Чтобы коммиты этого плана были чистыми, их надо зафиксировать отдельно. **Перед выполнением спросить пользователя** (он ранее сказал «пока рано» по коммиту и пушу).

**Files:**
- Modify (commit only): `css/style.css`, `index.html`, `js/import.js`, `js/script.js`, `js/telegram.js`
- Add (commit only): `docs/superpowers/specs/2026-10-14-telegram-bot-backend-design.md`, `docs/superpowers/plans/2026-10-14-telegram-bot-backend.md`

- [ ] **Step 1: Убедиться, что в рабочей папке только ожидаемое**

Run: `git status --short`
Expected: ровно перечисленные выше 5 изменённых файлов и папка `docs/` (untracked).

- [ ] **Step 2: Коммит интерфейса (после согласия пользователя)**

```bash
git add css/style.css index.html js/import.js js/script.js js/telegram.js
git commit -m "feat: доступность интерфейса — фокус, зоны касания 44px, контраст, SVG-иконки, отмена удаления"
```

- [ ] **Step 3: Коммит документов**

```bash
git add docs/superpowers
git commit -m "docs: спека и план Telegram-бота с серверной синхронизацией"
```

---

### Task 1: Каркас Worker и схема базы

**Files:**
- Create: `worker/package.json`, `worker/wrangler.toml`, `worker/vitest.config.js`, `worker/.gitignore`
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/test/apply-migrations.js`, `worker/test/schema.test.js`
- Create: `worker/src/index.js` (временная заглушка, в Task 12 заменяется)

**Interfaces:**
- Consumes: ничего.
- Produces: привязка D1 `DB`, тестовые привязки `BOT_TOKEN='test-token'`, `WEBHOOK_SECRET='test-secret'`, `APP_URL='https://example.github.io/money/'`, `ALLOWED_ORIGIN='https://example.github.io'`, `TEST_MIGRATIONS`; таблицы `users`, `operations`, `processed_updates`, `rate_limits`.

- [ ] **Step 1: Создать конфигурацию и тест (миграции ещё нет)**

`worker/package.json`:

```json
{
  "name": "money-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "setup:telegram": "node scripts/setup-telegram.js"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.4.1",
    "@vitest/coverage-istanbul": "^4.1.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.150.0"
  }
}
```

`worker/wrangler.toml` (идентификатор базы — нулевой UUID для локальной работы; настоящий подставляется в Task 16):

```toml
name = "money-bot"
main = "src/index.js"
compatibility_date = "2025-06-01"

[vars]
APP_URL = "https://nnabiev3.github.io/money/"
ALLOWED_ORIGIN = "https://nnabiev3.github.io"

[[d1_databases]]
binding = "DB"
database_name = "money-bot"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"
```

`worker/vitest.config.js`:

```js
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BOT_TOKEN: 'test-token',
            WEBHOOK_SECRET: 'test-secret',
            APP_URL: 'https://example.github.io/money/',
            ALLOWED_ORIGIN: 'https://example.github.io'
          }
        }
      };
    })
  ],
  test: {
    setupFiles: ['./test/apply-migrations.js'],
    coverage: { provider: 'istanbul', include: ['src/**'], reporter: ['text', 'text-summary'] }
  }
});
```

`worker/.gitignore`:

```
node_modules/
.wrangler/
.dev.vars
coverage/
```

`worker/test/apply-migrations.js`:

```js
import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`worker/test/schema.test.js`:

```js
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('migration creates exactly the four application tables', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'"
    ).all();
    expect(results.map(row => row.name).sort()).toEqual(['operations', 'processed_updates', 'rate_limits', 'users']);
  });
});
```

`worker/src/index.js` (заглушка, чтобы `main` из wrangler.toml существовал):

```js
export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  }
};
```

- [ ] **Step 2: Установить зависимости**

Run: `cd worker && npm install`
Expected: создан `package-lock.json` и `node_modules/`; npm может предупредить о неодобренных скриптах установки `esbuild`/`workerd` — это нормально, тесты работают (проверено).

- [ ] **Step 3: Запустить тест — должен упасть**

Run: `cd worker && npx vitest run test/schema.test.js`
Expected: FAIL (папки `migrations` ещё нет, `readD1Migrations` падает).

- [ ] **Step 4: Создать миграцию**

`worker/migrations/0001_init.sql`:

```sql
CREATE TABLE users (
  id           INTEGER PRIMARY KEY,
  settings     TEXT    NOT NULL DEFAULT '{}',
  month_target REAL    NOT NULL DEFAULT 100000,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE operations (
  id         TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  type       TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  name       TEXT    NOT NULL,
  amount     REAL    NOT NULL CHECK (amount > 0),
  category   TEXT,
  date       TEXT    NOT NULL,
  source     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_ops_user_date    ON operations (user_id, date);
CREATE INDEX idx_ops_user_created ON operations (user_id, created_at);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  user_id INTEGER NOT NULL,
  scope   TEXT    NOT NULL,
  minute  INTEGER NOT NULL,
  count   INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope, minute)
);
```

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `cd worker && npx vitest run test/schema.test.js`
Expected: PASS (1 тест).

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "chore: каркас Cloudflare Worker, схема D1 и тестовая обвязка"
```

---

### Task 2: Форматирование и даты (`format.js`)

**Files:**
- Create: `worker/src/format.js`
- Test: `worker/test/format.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces (экспорты `worker/src/format.js`):
  - `escapeHtml(text: unknown): string`
  - `formatMoney(amount: number, currency: string): string` — округляет до целых, как приложение
  - `round2(n: number): number`
  - `percent(part: number, total: number): number` — целое 0..100, при `total <= 0` даёт 0
  - `todayDate(nowMs: number): string` — `'YYYY-MM-DD'` по UTC+3
  - `dateToIso(date: string): string` — `'YYYY-MM-DDT12:00:00.000Z'`
  - `monthKey(date: string): string` — `'YYYY-MM'`
  - `monthRange(date: string): { from: string, to: string }`
  - `monthTitle(date: string): string` — `'октябрь 2026'`
  - `formatDateShort(iso: string): string` — `'13.10.2026'`

- [ ] **Step 1: Написать падающие тесты**

`worker/test/format.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  dateToIso, escapeHtml, formatDateShort, formatMoney, monthKey, monthRange, monthTitle, percent, round2, todayDate
} from '../src/format.js';

describe('escapeHtml', () => {
  it('escapes &, < and > so user text cannot inject markup', () => {
    expect(escapeHtml('<b>Tom & "Jerry"</b>')).toBe('&lt;b&gt;Tom &amp; "Jerry"&lt;/b&gt;');
  });

  it('turns non-strings into text', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('formatMoney', () => {
  it('groups thousands and appends the currency', () => {
    expect(formatMoney(94480, '₽')).toMatch(/^94\D480 ₽$/);
  });

  it('rounds to whole units like the app does', () => {
    expect(formatMoney(1499.6, '₽')).toMatch(/^1\D500 ₽$/);
  });
});

describe('round2 and percent', () => {
  it('round2 cuts floating point noise', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10.456)).toBe(10.46);
  });

  it('percent is a whole number clamped to 0..100', () => {
    expect(percent(79480, 100000)).toBe(79);
    expect(percent(-5, 100)).toBe(0);
    expect(percent(500, 100)).toBe(100);
  });

  it('percent of a zero or negative total is 0', () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(5, -1)).toBe(0);
  });
});

describe('dates', () => {
  it('todayDate uses UTC+3, so 00:30 Moscow already is the next day', () => {
    expect(todayDate(Date.UTC(2026, 9, 13, 21, 30))).toBe('2026-10-14');
    expect(todayDate(Date.UTC(2026, 9, 13, 20, 59))).toBe('2026-10-13');
  });

  it('dateToIso pins the day at noon UTC', () => {
    expect(dateToIso('2026-10-14')).toBe('2026-10-14T12:00:00.000Z');
  });

  it('monthKey, monthRange and monthTitle describe the month of a date', () => {
    expect(monthKey('2026-10-14')).toBe('2026-10');
    expect(monthRange('2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthTitle('2026-10-14')).toBe('октябрь 2026');
  });

  it('formatDateShort prints dd.mm.yyyy', () => {
    expect(formatDateShort('2026-10-13T12:00:00.000Z')).toBe('13.10.2026');
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/format.test.js`
Expected: FAIL (`../src/format.js` не найден).

- [ ] **Step 3: Реализовать**

`worker/src/format.js`:

```js
// «Сегодня» считается по UTC+3 одной константой, без настроек часового пояса
const DAY_OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** @param {unknown} text @returns {string} */
export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {number} amount @param {string} currency @returns {string} */
export function formatMoney(amount, currency) {
  return `${Math.round(amount).toLocaleString('ru-RU')} ${currency}`;
}

/** @param {number} n @returns {number} */
export const round2 = n => Math.round(n * 100) / 100;

/** Целый процент 0..100; при неположительном итоге 0. */
export function percent(part, total) {
  if (!(total > 0)) return 0;
  return Math.round(Math.max(0, Math.min((part / total) * 100, 100)));
}

/** @param {number} nowMs @returns {string} 'YYYY-MM-DD' */
export function todayDate(nowMs) {
  return new Date(nowMs + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** @param {string} date 'YYYY-MM-DD' @returns {string} */
export const dateToIso = date => `${date}T12:00:00.000Z`;

/** @param {string} date 'YYYY-MM-DD' @returns {string} 'YYYY-MM' */
export const monthKey = date => date.slice(0, 7);

/** @param {string} date 'YYYY-MM-DD' @returns {{ from: string, to: string }} */
export function monthRange(date) {
  const month = monthKey(date);
  return { from: `${month}-01`, to: `${month}-31` };
}

/** @param {string} date 'YYYY-MM-DD' @returns {string} например 'октябрь 2026' */
export function monthTitle(date) {
  const [year, month] = date.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** @param {string} iso ISO-дата @returns {string} 'dd.mm.yyyy' */
export function formatDateShort(iso) {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/format.test.js`
Expected: PASS (все тесты).

- [ ] **Step 5: Commit**

```bash
git add worker/src/format.js worker/test/format.test.js
git commit -m "feat: форматирование денег и дат для бота"
```

---

### Task 3: Лимиты, список допуска и разбор команд (`limits.js`, `parse.js`)

**Files:**
- Create: `worker/src/limits.js`, `worker/src/parse.js`
- Test: `worker/test/limits.test.js`, `worker/test/parse.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `worker/src/limits.js`: константы `MAX_AMOUNT = 999999999.99`, `MAX_OPERATIONS = 20000`, `MAX_SYNC_ITEMS = 100`, `MAX_NAME = 200`, `MAX_CATEGORY = 40`, `MAX_CATEGORIES = 50`, `MAX_BODY_BYTES = 1000000`, `BOT_RATE_PER_MINUTE = 30`, `API_RATE_PER_MINUTE = 120`; `isAllowed(allowlist: string | undefined, userId: number): boolean`. (`hitRateLimit` добавляется в Task 5.)
  - `worker/src/parse.js`: `parseCommand(text: string): { name: string, args: string } | null`; `parseAmountAndText(args: string): { ok: true, amount: number, text: string } | { ok: false, reason: 'format' | 'decimals' | 'positive' | 'too_big' }`.

- [ ] **Step 1: Написать падающие тесты**

`worker/test/limits.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { isAllowed } from '../src/limits.js';

describe('isAllowed', () => {
  it('lets everyone in when no allowlist is configured', () => {
    expect(isAllowed(undefined, 1)).toBe(true);
    expect(isAllowed('', 1)).toBe(true);
  });

  it('only lets listed ids in when an allowlist is set', () => {
    expect(isAllowed('10, 20 ,30', 20)).toBe(true);
    expect(isAllowed('10, 20 ,30', 99)).toBe(false);
  });

  it('compares ids as whole numbers, not prefixes', () => {
    expect(isAllowed('123', 12)).toBe(false);
  });
});
```

`worker/test/parse.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { parseAmountAndText, parseCommand } from '../src/parse.js';

describe('parseCommand', () => {
  it('splits the command name from its arguments', () => {
    expect(parseCommand('/spent 500 такси')).toEqual({ name: 'spent', args: '500 такси' });
  });

  it('accepts a command without arguments and normalises case', () => {
    expect(parseCommand('/BALANCE')).toEqual({ name: 'balance', args: '' });
  });

  it('drops the @botname suffix used in groups', () => {
    expect(parseCommand('/spent@MoneyBot 500 еда')).toEqual({ name: 'spent', args: '500 еда' });
  });

  it('returns null for plain text', () => {
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe('parseAmountAndText', () => {
  it.each([
    ['500', 500, ''],
    ['500 такси', 500, 'такси'],
    ['1 500 такси', 1500, 'такси'],
    ['1\u00a0500 кофе', 1500, 'кофе'],
    ['1500,50', 1500.5, ''],
    ['1500.50 кофе', 1500.5, 'кофе'],
    ['999999999.99', 999999999.99, ''],
    ['  300   обед в кафе ', 300, 'обед в кафе']
  ])('reads %j as amount %d and text %j', (args, amount, text) => {
    expect(parseAmountAndText(args)).toEqual({ ok: true, amount, text });
  });

  it.each([
    ['', 'format'],
    ['abc', 'format'],
    ['-5', 'format'],
    ['500р такси', 'format'],
    ['12.345', 'decimals'],
    ['0', 'positive'],
    ['0,00 x', 'positive'],
    ['1000000000', 'too_big']
  ])('rejects %j because of %s', (args, reason) => {
    expect(parseAmountAndText(args)).toEqual({ ok: false, reason });
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/limits.test.js test/parse.test.js`
Expected: FAIL (модули не найдены).

- [ ] **Step 3: Реализовать**

`worker/src/limits.js`:

```js
export const MAX_AMOUNT = 999999999.99;
export const MAX_OPERATIONS = 20000;
export const MAX_SYNC_ITEMS = 100;
export const MAX_NAME = 200;
export const MAX_CATEGORY = 40;
export const MAX_CATEGORIES = 50;
export const MAX_BODY_BYTES = 1000000;
export const BOT_RATE_PER_MINUTE = 30;
export const API_RATE_PER_MINUTE = 120;

/**
 * Аварийный «рубильник»: если список задан, работают только перечисленные ID.
 * @param {string | undefined} allowlist ID через запятую
 * @param {number} userId
 * @returns {boolean}
 */
export function isAllowed(allowlist, userId) {
  if (!allowlist) return true;
  return allowlist.split(',').map(id => id.trim()).filter(Boolean).includes(String(userId));
}
```

`worker/src/parse.js`:

```js
import { MAX_AMOUNT } from './limits.js';

const COMMAND_RE = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/;
// Сумма в начале: «1 500» (пробел или неразрывный пробел между тысячами) или «1500», дробная часть через . или ,
const AMOUNT_RE = /^(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d+))?(?=\s|$)/;

/**
 * @param {string | undefined} text
 * @returns {{ name: string, args: string } | null}
 */
export function parseCommand(text) {
  const match = COMMAND_RE.exec((text || '').trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

/**
 * @param {string} args
 * @returns {{ ok: true, amount: number, text: string } | { ok: false, reason: 'format' | 'decimals' | 'positive' | 'too_big' }}
 */
export function parseAmountAndText(args) {
  const trimmed = args.trim();
  const match = AMOUNT_RE.exec(trimmed);
  if (!match) return { ok: false, reason: 'format' };

  const whole = match[1].replace(/[ \u00a0]/g, '');
  const fraction = match[2] || '';
  if (fraction.length > 2) return { ok: false, reason: 'decimals' };

  const amount = Number(fraction ? `${whole}.${fraction}` : whole);
  if (!(amount > 0)) return { ok: false, reason: 'positive' };
  if (amount > MAX_AMOUNT) return { ok: false, reason: 'too_big' };

  return { ok: true, amount, text: trimmed.slice(match[0].length).trim() };
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/limits.test.js test/parse.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/limits.js worker/src/parse.js worker/test/limits.test.js worker/test/parse.test.js
git commit -m "feat: лимиты, список допуска и разбор команд и сумм"
```

---

### Task 4: Категории и настройки по умолчанию (`categories.js`)

**Files:**
- Create: `worker/src/categories.js`
- Test: `worker/test/categories.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `DEFAULT_SETTINGS` (`{ goal, goalName, currency, theme, categories: { income[], expense[] } }`), `DEFAULT_MONTH_TARGET = 100000`
  - `withDefaults(settings?: object): object`
  - `guessCategory(type: 'income' | 'expense', text: string): string | null`
  - `resolveCategory(type, text: string, categories: { income: string[], expense: string[] }): { category: string, name: string }`

- [ ] **Step 1: Написать падающие тесты**

`worker/test/categories.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, guessCategory, resolveCategory, withDefaults } from '../src/categories.js';

const categories = DEFAULT_SETTINGS.categories;

describe('guessCategory', () => {
  it('uses the same keyword rules as the statement import', () => {
    expect(guessCategory('expense', 'такси домой')).toBe('Транспорт');
    expect(guessCategory('expense', 'Пятёрочка')).toBe('Еда');
    expect(guessCategory('income', 'аванс за октябрь')).toBe('Зарплата');
  });

  it('returns null when nothing matches', () => {
    expect(guessCategory('expense', 'xyz')).toBeNull();
  });
});

describe('resolveCategory', () => {
  it('prefers an exact match with the user category, ignoring case', () => {
    expect(resolveCategory('expense', 'еда', categories)).toEqual({ category: 'Еда', name: 'Еда' });
  });

  it('falls back to keyword rules and keeps the typed text as the name', () => {
    expect(resolveCategory('expense', 'такси', categories)).toEqual({ category: 'Транспорт', name: 'такси' });
  });

  it('uses "Прочее" and the category as the name when there is no text', () => {
    expect(resolveCategory('expense', '', categories)).toEqual({ category: 'Прочее', name: 'Прочее' });
  });

  it('uses "Прочее" for unknown text', () => {
    expect(resolveCategory('expense', 'xyz', categories)).toEqual({ category: 'Прочее', name: 'xyz' });
  });

  it('does not use a guessed category the user has deleted', () => {
    const custom = { income: ['Зарплата'], expense: ['Дом', 'Прочее'] };
    expect(resolveCategory('expense', 'такси', custom).category).toBe('Прочее');
  });

  it('falls back to the first category when "Прочее" is missing', () => {
    const custom = { income: ['Зарплата'], expense: ['Дом'] };
    expect(resolveCategory('expense', 'xyz', custom).category).toBe('Дом');
  });

  it('resolves income the same way', () => {
    expect(resolveCategory('income', 'зарплата', categories)).toEqual({ category: 'Зарплата', name: 'Зарплата' });
    expect(resolveCategory('income', 'премия за квартал', categories)).toEqual({ category: 'Зарплата', name: 'премия за квартал' });
  });
});

describe('withDefaults', () => {
  it('fills in everything missing, including nested categories', () => {
    expect(withDefaults({})).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults({ goal: 5, categories: { income: ['X'] } })).toMatchObject({
      goal: 5,
      categories: { income: ['X'], expense: DEFAULT_SETTINGS.categories.expense }
    });
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/categories.test.js`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать**

Правила `RULES` скопированы из `js/import.js` (строки 23–36) без изменений. **Это второе место, где живут правила**: при изменении править оба.

`worker/src/categories.js`:

```js
// Настройки по умолчанию и правила автокатегорий.
// ВНИМАНИЕ: копия из js/script.js (DEFAULT_SETTINGS) и js/import.js (RULES) — при изменении править оба места.

export const DEFAULT_MONTH_TARGET = 100000;

export const DEFAULT_SETTINGS = {
  goal: 1000000,
  goalName: 'Главная цель',
  currency: '₽',
  theme: 'dark',
  categories: {
    income: ['Зарплата', 'Подработка', 'Подарки', 'Прочее'],
    expense: ['Жильё', 'Еда', 'Транспорт', 'Здоровье', 'Развлечения', 'Покупки', 'Прочее']
  }
};

const RULES = {
  expense: [
    ['Еда', /супермаркет|продукт|пят[её]рочк|магнит|перекр[её]ст|лента|ашан|вкусвилл|дикси|самокат|лавка|азбука вкуса|metro|окей|spar|спар|fix price|ресторан|кафе|фастфуд|кофе|coffee|макдон|вкусно|kfc|rostic|бургер|додо|пицц|суши|еда|eda\.|food|чижик|верный|светофор/i],
    ['Транспорт', /такси|taxi|транспорт|метро|metro\s?moscow|mosmetro|тройка|азс|топлив|бензин|лукойл|газпромнефть|роснефть|татнефть|shell|парков|каршеринг|делимобил|драйв|ситидрайв|ржд|аэрофлот|авиа|s7|победа|автобус|whoosh|юрент/i],
    ['Жильё', /жкх|коммунал|квартплат|ипотек|аренд|электроэнерг|энергосбыт|мосэнерго|водоканал|газ\b|домофон|интернет|ростелеком|мтс|билайн|мегафон|теле2|\bt2\b|связь|мобильн/i],
    ['Здоровье', /аптек|apteka|клиник|медиц|стоматол|здоров|горздрав|ригла|асна|анализ|инвитро|гемотест|врач/i],
    ['Развлечения', /кино|театр|развлеч|игр|steam|playstation|подписк|кинопоиск|\bivi\b|okko|spotify|яндекс плюс|плюс|музык|концерт|билет|боулинг|бар\b|клуб/i],
    ['Покупки', /ozon|озон|wildberries|вайлдберриз|\bwb\b|маркет|одежд|обув|dns|м\.?видео|эльдорадо|леруа|ikea|hoff|спортмастер|lamoda|золотое яблоко|aliexpress|детск|косметик|электроник|zara|gloria/i]
  ],
  income: [
    ['Зарплата', /зарплат|заработн|аванс|salary|оплата труда|премия/i],
    ['Проценты и кэшбэк', /кэшб[еэ]к|кешб[еэ]к|cashback|процент|вознагражд|бонус|начислен.*процент/i]
  ]
};

/**
 * Дополняет настройки значениями по умолчанию (как делает приложение при загрузке).
 * @param {object} [settings]
 * @returns {object}
 */
export function withDefaults(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    categories: { ...DEFAULT_SETTINGS.categories, ...settings.categories }
  };
}

/**
 * @param {'income' | 'expense'} type
 * @param {string} text
 * @returns {string | null}
 */
export function guessCategory(type, text) {
  for (const [category, pattern] of RULES[type]) {
    if (pattern.test(text)) return category;
  }
  return null;
}

/**
 * Категория и название операции: точное совпадение с категорией пользователя,
 * иначе правила, иначе «Прочее» (или первая категория).
 * @param {'income' | 'expense'} type
 * @param {string} text описание из команды
 * @param {{ income: string[], expense: string[] }} categories
 * @returns {{ category: string, name: string }}
 */
export function resolveCategory(type, text, categories) {
  const list = categories[type];
  const typed = text.trim();
  const exact = list.find(category => category.toLowerCase() === typed.toLowerCase());
  if (exact) return { category: exact, name: exact };

  const guessed = guessCategory(type, typed);
  const fallback = list.includes('Прочее') ? 'Прочее' : list[0];
  const category = guessed && list.includes(guessed) ? guessed : fallback;
  return { category, name: typed || category };
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/categories.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/categories.js worker/test/categories.test.js
git commit -m "feat: настройки по умолчанию и автокатегории для бота"
```

---

### Task 5: Слой базы данных и лимит запросов (`db.js`, `hitRateLimit`)

**Files:**
- Create: `worker/src/db.js`, `worker/test/helpers.js`
- Modify: `worker/src/limits.js` (добавить `hitRateLimit`)
- Test: `worker/test/db.test.js`, `worker/test/rate-limit.test.js`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS`, `DEFAULT_MONTH_TARGET`, `withDefaults` из `categories.js`.
- Produces:
  - Тип `Operation = { id: string, name: string, amount: number, type: 'income' | 'expense', category: string | null, date: string, source: string | null }`.
  - `worker/src/db.js` (все функции первым аргументом принимают `db: D1Database`):
    - `getUser(db, userId): Promise<{ id, settings, monthTarget } | null>`
    - `ensureUser(db, userId, nowMs): Promise<{ id, settings, monthTarget }>`
    - `saveSettingsStatement(db, userId, { settings?, monthTarget? }, nowMs): D1PreparedStatement`
    - `upsertStatements(db, userId, operations: Operation[], nowMs): D1PreparedStatement[]`
    - `removeStatements(db, userId, ids: string[]): D1PreparedStatement[]`
    - `insertOperation(db, userId, operation, nowMs): Promise<void>`
    - `insertOperationOnce(db, userId, operation, updateId, nowMs): Promise<boolean>` — `true`, если вставлено
    - `listOperations(db, userId): Promise<Operation[]>` — старые сначала
    - `listLastOperations(db, userId, limit): Promise<Operation[]>` — новые сначала
    - `getOperation(db, userId, id): Promise<Operation | null>`
    - `deleteOperation(db, userId, id): Promise<boolean>`
    - `countOperations(db, userId): Promise<number>`
    - `getTotals(db, userId, from, to): Promise<{ income: number, expense: number }>` (даты `YYYY-MM-DD`, границы включительно)
    - `categoryTotals(db, userId, type, from, to): Promise<{ category: string, total: number }[]>` — по убыванию
    - `monthlyTotals(db, userId, from, to): Promise<{ month: string, income: number, expense: number }[]>`
    - `deleteAllStatements(db, userId): D1PreparedStatement[]`
    - `purgeProcessedUpdates(db, beforeMs): Promise<void>`
  - `worker/src/limits.js`: `hitRateLimit(db, userId, scope: 'bot' | 'api', limit: number, nowMs: number): Promise<{ allowed: boolean, count: number }>`.
  - `worker/test/helpers.js`: `NOW`, `resetDb`, `fakeTelegram`, `makeCtx`, `textUpdate`, `callbackUpdate`, `seedOperation`, `signInitData`, `initDataFields` (используются в Task 6–13).

- [ ] **Step 1: Создать общие тестовые помощники**

`worker/test/helpers.js`:

```js
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
```

- [ ] **Step 2: Написать падающие тесты базы**

`worker/test/db.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MONTH_TARGET, DEFAULT_SETTINGS } from '../src/categories.js';
import {
  categoryTotals, countOperations, deleteAllStatements, deleteOperation, ensureUser, getOperation, getTotals, getUser,
  insertOperation, insertOperationOnce, listLastOperations, listOperations, monthlyTotals, purgeProcessedUpdates,
  removeStatements, saveSettingsStatement, upsertStatements
} from '../src/db.js';
import { NOW, resetDb } from './helpers.js';

const db = env.DB;
const op = (id, overrides = {}) => ({
  id, name: 'Такси', amount: 100, type: 'expense', category: 'Транспорт', date: '2026-10-10T12:00:00.000Z', source: 'bot', ...overrides
});

beforeEach(() => resetDb(db));

describe('users', () => {
  it('getUser returns null for an unknown user', async () => {
    expect(await getUser(db, 404)).toBeNull();
  });

  it('ensureUser creates default settings once and never overwrites them', async () => {
    const created = await ensureUser(db, 1, NOW);
    expect(created).toEqual({ id: 1, settings: DEFAULT_SETTINGS, monthTarget: DEFAULT_MONTH_TARGET });

    await saveSettingsStatement(db, 1, { settings: { ...DEFAULT_SETTINGS, goal: 5 }, monthTarget: 7 }, NOW).run();
    const again = await ensureUser(db, 1, NOW);
    expect(again.settings.goal).toBe(5);
    expect(again.monthTarget).toBe(7);
  });

  it('saveSettingsStatement updates only the provided fields', async () => {
    await ensureUser(db, 1, NOW);
    await saveSettingsStatement(db, 1, { monthTarget: 42 }, NOW).run();
    const user = await getUser(db, 1);
    expect(user.monthTarget).toBe(42);
    expect(user.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('writing operations', () => {
  it('inserts more rows than fit in one statement and updates on conflict, keeping created_at', async () => {
    const many = Array.from({ length: 25 }, (_, i) => op(`id${i}`, { amount: i + 1 }));
    const statements = upsertStatements(db, 1, many, NOW);
    expect(statements).toHaveLength(3);
    await db.batch(statements);
    expect(await countOperations(db, 1)).toBe(25);

    await db.batch(upsertStatements(db, 1, [op('id0', { amount: 999, name: 'Новое' })], NOW + 5000));
    expect(await getOperation(db, 1, 'id0')).toMatchObject({ amount: 999, name: 'Новое' });
    const { results } = await db.prepare('SELECT created_at FROM operations WHERE user_id = 1 AND id = ?').bind('id0').all();
    expect(results[0].created_at).toBe(NOW);
  });

  it('removes by id in chunks and only for the given user', async () => {
    const ids = Array.from({ length: 95 }, (_, i) => `id${i}`);
    await db.batch([...upsertStatements(db, 1, ids.map(id => op(id)), NOW), ...upsertStatements(db, 2, [op('id0')], NOW)]);

    const statements = removeStatements(db, 1, ids);
    expect(statements).toHaveLength(2);
    await db.batch(statements);
    expect(await countOperations(db, 1)).toBe(0);
    expect(await countOperations(db, 2)).toBe(1);
  });

  it('keeps operations of different users with the same id apart', async () => {
    await insertOperation(db, 1, op('same', { amount: 1 }), NOW);
    await insertOperation(db, 2, op('same', { amount: 2 }), NOW);
    expect((await getOperation(db, 1, 'same')).amount).toBe(1);
    expect((await getOperation(db, 2, 'same')).amount).toBe(2);
  });

  it('insertOperationOnce ignores a repeated update id', async () => {
    expect(await insertOperationOnce(db, 1, op('first'), 777, NOW)).toBe(true);
    expect(await insertOperationOnce(db, 1, op('second'), 777, NOW)).toBe(false);
    expect(await countOperations(db, 1)).toBe(1);
    expect(await getOperation(db, 1, 'second')).toBeNull();
  });

  it('purgeProcessedUpdates forgets old updates so they could be processed again', async () => {
    await insertOperationOnce(db, 1, op('first'), 777, NOW);
    await purgeProcessedUpdates(db, NOW + 1);
    expect(await insertOperationOnce(db, 1, op('second'), 777, NOW + 2)).toBe(true);
  });
});

describe('reading operations', () => {
  it('lists oldest-first and last-first', async () => {
    await insertOperation(db, 1, op('a'), NOW);
    await insertOperation(db, 1, op('b'), NOW + 1);
    await insertOperation(db, 1, op('c'), NOW + 2);
    expect((await listOperations(db, 1)).map(o => o.id)).toEqual(['a', 'b', 'c']);
    expect((await listLastOperations(db, 1, 2)).map(o => o.id)).toEqual(['c', 'b']);
  });

  it('deleteOperation reports whether something was removed and is scoped to the user', async () => {
    await insertOperation(db, 1, op('a'), NOW);
    expect(await deleteOperation(db, 2, 'a')).toBe(false);
    expect(await deleteOperation(db, 1, 'a')).toBe(true);
    expect(await deleteOperation(db, 1, 'a')).toBe(false);
  });
});

describe('totals', () => {
  beforeEach(async () => {
    await db.batch(upsertStatements(db, 1, [
      op('a', { type: 'income', amount: 1000.25, category: 'Зарплата', date: '2026-10-03T09:00:00.000Z' }),
      op('b', { amount: 300.1, category: 'Еда', date: '2026-10-05T09:00:00.000Z' }),
      op('c', { amount: 200.2, category: 'Еда', date: '2026-10-31T09:00:00.000Z' }),
      op('d', { amount: 50, category: 'Транспорт', date: '2026-09-30T09:00:00.000Z' }),
      op('e', { amount: 10, category: null, date: '2026-10-06T09:00:00.000Z' })
    ], NOW));
  });

  it('sums a date range inclusively, rounded to kopecks', async () => {
    expect(await getTotals(db, 1, '2026-10-01', '2026-10-31')).toEqual({ income: 1000.25, expense: 510.3 });
  });

  it('returns zeros for a user without operations', async () => {
    expect(await getTotals(db, 2, '2026-10-01', '2026-10-31')).toEqual({ income: 0, expense: 0 });
  });

  it('groups by category, biggest first, naming missing categories', async () => {
    expect(await categoryTotals(db, 1, 'expense', '2026-10-01', '2026-10-31')).toEqual([
      { category: 'Еда', total: 500.3 },
      { category: 'Без категории', total: 10 }
    ]);
  });

  it('groups by month', async () => {
    expect(await monthlyTotals(db, 1, '2026-09-01', '2026-10-31')).toEqual([
      { month: '2026-09', income: 0, expense: 50 },
      { month: '2026-10', income: 1000.25, expense: 510.3 }
    ]);
  });
});

describe('deleteAllStatements', () => {
  it('removes the user and every operation, leaving other users alone', async () => {
    await ensureUser(db, 1, NOW);
    await ensureUser(db, 2, NOW);
    await insertOperation(db, 1, op('a'), NOW);
    await insertOperation(db, 2, op('b'), NOW);
    await db.batch(deleteAllStatements(db, 1));
    expect(await getUser(db, 1)).toBeNull();
    expect(await countOperations(db, 1)).toBe(0);
    expect(await countOperations(db, 2)).toBe(1);
    expect(await getUser(db, 2)).not.toBeNull();
  });
});
```

`worker/test/rate-limit.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { hitRateLimit } from '../src/limits.js';
import { NOW, resetDb } from './helpers.js';

const db = env.DB;
beforeEach(() => resetDb(db));

describe('hitRateLimit', () => {
  it('counts hits and refuses once the limit is exceeded', async () => {
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await hitRateLimit(db, 1, 'bot', 2, NOW));
    expect(results).toEqual([{ allowed: true, count: 1 }, { allowed: true, count: 2 }, { allowed: false, count: 3 }]);
  });

  it('keeps users and scopes separate', async () => {
    await hitRateLimit(db, 1, 'bot', 1, NOW);
    expect(await hitRateLimit(db, 2, 'bot', 1, NOW)).toEqual({ allowed: true, count: 1 });
    expect(await hitRateLimit(db, 1, 'api', 1, NOW)).toEqual({ allowed: true, count: 1 });
  });

  it('starts a fresh window the next minute', async () => {
    await hitRateLimit(db, 1, 'bot', 1, NOW);
    expect(await hitRateLimit(db, 1, 'bot', 1, NOW + 60_000)).toEqual({ allowed: true, count: 1 });
  });

  it('forgets windows older than five minutes', async () => {
    await hitRateLimit(db, 1, 'bot', 5, NOW - 10 * 60_000);
    await hitRateLimit(db, 1, 'bot', 5, NOW);
    const { results } = await db.prepare('SELECT COUNT(*) AS n FROM rate_limits').all();
    expect(results[0].n).toBe(1);
  });
});
```

- [ ] **Step 3: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/db.test.js test/rate-limit.test.js`
Expected: FAIL (`../src/db.js` не найден; `hitRateLimit` не экспортируется).

- [ ] **Step 4: Реализовать `db.js`**

`worker/src/db.js`:

```js
import { DEFAULT_MONTH_TARGET, DEFAULT_SETTINGS, withDefaults } from './categories.js';

/**
 * @typedef {object} Operation
 * @property {string} id
 * @property {string} name
 * @property {number} amount
 * @property {'income' | 'expense'} type
 * @property {string | null} category
 * @property {string} date ISO-строка
 * @property {string | null} source
 */

const COLUMNS = 'id, name, amount, type, category, date, source';
const INSERT_COLUMNS = 'id, user_id, type, name, amount, category, date, source, created_at';
const ROWS_PER_STATEMENT = 10; // 9 параметров на строку; у D1 лимит 100 параметров на запрос
const IDS_PER_STATEMENT = 90; // плюс user_id: 91 параметр

const toOperation = row => ({
  id: row.id, name: row.name, amount: row.amount, type: row.type, category: row.category, date: row.date, source: row.source
});

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const operationParams = (userId, op, nowMs) =>
  [op.id, userId, op.type, op.name, op.amount, op.category ?? null, op.date, op.source ?? null, nowMs];

// ----- Пользователи -----

/** @returns {Promise<{ id: number, settings: object, monthTarget: number } | null>} */
export async function getUser(db, userId) {
  const row = await db.prepare('SELECT id, settings, month_target FROM users WHERE id = ?').bind(userId).first();
  if (!row) return null;
  return { id: row.id, settings: withDefaults(JSON.parse(row.settings)), monthTarget: row.month_target };
}

/** Создаёт пользователя с настройками по умолчанию, если его ещё нет. */
export async function ensureUser(db, userId, nowMs) {
  const existing = await getUser(db, userId);
  if (existing) return existing;
  await db.prepare('INSERT OR IGNORE INTO users (id, settings, month_target, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, JSON.stringify(DEFAULT_SETTINGS), DEFAULT_MONTH_TARGET, nowMs, nowMs).run();
  return getUser(db, userId);
}

/** Обновляет только переданные поля. */
export function saveSettingsStatement(db, userId, { settings, monthTarget }, nowMs) {
  const sets = ['updated_at = ?'];
  const params = [nowMs];
  if (settings !== undefined) { sets.push('settings = ?'); params.push(JSON.stringify(settings)); }
  if (monthTarget !== undefined) { sets.push('month_target = ?'); params.push(monthTarget); }
  return db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params, userId);
}

// ----- Запись операций -----

/** Пачки по 10 строк: создаёт или обновляет операции, `created_at` при обновлении не трогает. */
export function upsertStatements(db, userId, operations, nowMs) {
  return chunk(operations, ROWS_PER_STATEMENT).map(rows => {
    const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = rows.flatMap(op => operationParams(userId, op, nowMs));
    return db.prepare(
      `INSERT INTO operations (${INSERT_COLUMNS}) VALUES ${placeholders} ` +
      'ON CONFLICT (user_id, id) DO UPDATE SET type = excluded.type, name = excluded.name, amount = excluded.amount, ' +
      'category = excluded.category, date = excluded.date, source = excluded.source'
    ).bind(...params);
  });
}

export function removeStatements(db, userId, ids) {
  return chunk(ids, IDS_PER_STATEMENT).map(part =>
    db.prepare(`DELETE FROM operations WHERE user_id = ? AND id IN (${part.map(() => '?').join(', ')})`).bind(userId, ...part)
  );
}

export async function insertOperation(db, userId, operation, nowMs) {
  await upsertStatements(db, userId, [operation], nowMs)[0].run();
}

/**
 * Атомарно: вставляет операцию и запоминает update_id; повторный update_id ничего не вставляет.
 * @returns {Promise<boolean>} true, если операция вставлена
 */
export async function insertOperationOnce(db, userId, operation, updateId, nowMs) {
  const insert = db.prepare(
    `INSERT INTO operations (${INSERT_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? ` +
    'WHERE NOT EXISTS (SELECT 1 FROM processed_updates WHERE update_id = ?)'
  ).bind(...operationParams(userId, operation, nowMs), updateId);
  const claim = db.prepare('INSERT OR IGNORE INTO processed_updates (update_id, at) VALUES (?, ?)').bind(updateId, nowMs);
  const [inserted] = await db.batch([insert, claim]);
  return inserted.meta.changes > 0;
}

export async function purgeProcessedUpdates(db, beforeMs) {
  await db.prepare('DELETE FROM processed_updates WHERE at < ?').bind(beforeMs).run();
}

export async function deleteOperation(db, userId, id) {
  const result = await db.prepare('DELETE FROM operations WHERE user_id = ? AND id = ?').bind(userId, id).run();
  return result.meta.changes > 0;
}

export function deleteAllStatements(db, userId) {
  return [
    db.prepare('DELETE FROM operations WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId)
  ];
}

// ----- Чтение операций -----

/** @returns {Promise<Operation[]>} старые сначала */
export async function listOperations(db, userId) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM operations WHERE user_id = ? ORDER BY created_at ASC, rowid ASC`).bind(userId).all();
  return results.map(toOperation);
}

/** @returns {Promise<Operation[]>} новые сначала */
export async function listLastOperations(db, userId, limit) {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM operations WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`).bind(userId, limit).all();
  return results.map(toOperation);
}

/** @returns {Promise<Operation | null>} */
export async function getOperation(db, userId, id) {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM operations WHERE user_id = ? AND id = ?`).bind(userId, id).first();
  return row ? toOperation(row) : null;
}

export async function countOperations(db, userId) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM operations WHERE user_id = ?').bind(userId).first();
  return row.n;
}

// ----- Суммы (даты YYYY-MM-DD, границы включительно) -----

export async function getTotals(db, userId, from, to) {
  const { results } = await db.prepare(
    'SELECT type, ROUND(SUM(amount), 2) AS total FROM operations WHERE user_id = ? AND substr(date, 1, 10) BETWEEN ? AND ? GROUP BY type'
  ).bind(userId, from, to).all();
  const totals = { income: 0, expense: 0 };
  for (const row of results) totals[row.type] = row.total;
  return totals;
}

export async function categoryTotals(db, userId, type, from, to) {
  const { results } = await db.prepare(
    "SELECT COALESCE(category, 'Без категории') AS category, ROUND(SUM(amount), 2) AS total FROM operations " +
    'WHERE user_id = ? AND type = ? AND substr(date, 1, 10) BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC, category ASC'
  ).bind(userId, type, from, to).all();
  return results.map(row => ({ category: row.category, total: row.total }));
}

export async function monthlyTotals(db, userId, from, to) {
  const { results } = await db.prepare(
    'SELECT substr(date, 1, 7) AS month, type, ROUND(SUM(amount), 2) AS total FROM operations ' +
    'WHERE user_id = ? AND substr(date, 1, 10) BETWEEN ? AND ? GROUP BY month, type ORDER BY month'
  ).bind(userId, from, to).all();
  const byMonth = new Map();
  for (const row of results) {
    const entry = byMonth.get(row.month) ?? { month: row.month, income: 0, expense: 0 };
    byMonth.set(row.month, { ...entry, [row.type]: row.total });
  }
  return [...byMonth.values()];
}
```

- [ ] **Step 5: Добавить `hitRateLimit` в `limits.js`**

Дописать в конец `worker/src/limits.js`:

```js
const MINUTE_MS = 60_000;
const KEEP_MINUTES = 5;

/**
 * Считает обращение пользователя в текущей минуте; старые окна удаляются попутно.
 * @param {D1Database} db
 * @param {number} userId
 * @param {'bot' | 'api'} scope
 * @param {number} limit разрешённое число обращений в минуту
 * @param {number} nowMs
 * @returns {Promise<{ allowed: boolean, count: number }>}
 */
export async function hitRateLimit(db, userId, scope, limit, nowMs) {
  const minute = Math.floor(nowMs / MINUTE_MS);
  const [hit] = await db.batch([
    db.prepare(
      'INSERT INTO rate_limits (user_id, scope, minute, count) VALUES (?, ?, ?, 1) ' +
      'ON CONFLICT (user_id, scope, minute) DO UPDATE SET count = count + 1 RETURNING count'
    ).bind(userId, scope, minute),
    db.prepare('DELETE FROM rate_limits WHERE minute < ?').bind(minute - KEEP_MINUTES)
  ]);
  const count = hit.results[0].count;
  return { allowed: count <= limit, count };
}
```

- [ ] **Step 6: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/db.test.js test/rate-limit.test.js test/limits.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/src/db.js worker/src/limits.js worker/test/helpers.js worker/test/db.test.js worker/test/rate-limit.test.js
git commit -m "feat: слой базы данных D1 и лимит запросов"
```

---

### Task 6: Общее ядро (`core.js`)

**Files:**
- Create: `worker/src/core.js`
- Test: `worker/test/core.test.js`

**Interfaces:**
- Consumes: `ensureUser`, `countOperations`, `insertOperation`, `insertOperationOnce`, `getTotals`, `categoryTotals`, `monthlyTotals` из `db.js`; `resolveCategory` из `categories.js`; `todayDate`, `dateToIso`, `monthRange`, `monthTitle`, `percent`, `round2` из `format.js`; `MAX_NAME`, `MAX_OPERATIONS` из `limits.js`.
- Produces:
  - `class LimitError extends Error`
  - `addOperation(db, userId, { type, amount, text, updateId?, nowMs, maxOperations? }): Promise<{ operation: Operation, inserted: boolean, monthBalance: number, settings: object }>`
  - `getReport(db, userId, { from, to }): Promise<{ income, expense, balance, expenseCategories, incomeCategories, byMonth }>`
  - `balanceSummary(db, userId, nowMs): Promise<{ monthTitle, month: { income, expense, balance }, total: { income, expense, balance }, monthTarget, monthPct, goal, goalName, goalPct, currency }>`

- [ ] **Step 1: Написать падающие тесты**

`worker/test/core.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { addOperation, balanceSummary, getReport, LimitError } from '../src/core.js';
import { countOperations, getOperation } from '../src/db.js';
import { NOW, resetDb, seedOperation } from './helpers.js';

const db = env.DB;
beforeEach(() => resetDb(db));

describe('addOperation', () => {
  it('adds an expense with category, name, bot source and today\'s date', async () => {
    const result = await addOperation(db, 1, { type: 'expense', amount: 500, text: 'такси', nowMs: NOW });
    expect(result.inserted).toBe(true);
    expect(result.operation).toMatchObject({
      type: 'expense', amount: 500, category: 'Транспорт', name: 'такси', date: '2026-10-14T12:00:00.000Z', source: 'bot'
    });
    expect(result.operation.id).toMatch(/^[a-z0-9]{12,}$/);
    expect(await getOperation(db, 1, result.operation.id)).toEqual(result.operation);
  });

  it('uses the category as the name when no text is given', async () => {
    const { operation } = await addOperation(db, 1, { type: 'expense', amount: 10, text: '', nowMs: NOW });
    expect(operation).toMatchObject({ category: 'Прочее', name: 'Прочее' });
  });

  it('returns the month balance including the new operation', async () => {
    await addOperation(db, 1, { type: 'income', amount: 1000, text: 'зарплата', nowMs: NOW });
    const { monthBalance } = await addOperation(db, 1, { type: 'expense', amount: 300, text: 'еда', nowMs: NOW });
    expect(monthBalance).toBe(700);
  });

  it('does not insert twice for the same update id', async () => {
    const first = await addOperation(db, 1, { type: 'expense', amount: 5, text: '', updateId: 7, nowMs: NOW });
    const second = await addOperation(db, 1, { type: 'expense', amount: 5, text: '', updateId: 7, nowMs: NOW });
    expect([first.inserted, second.inserted]).toEqual([true, false]);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('refuses to exceed the operation limit', async () => {
    await addOperation(db, 1, { type: 'expense', amount: 1, text: '', nowMs: NOW, maxOperations: 1 });
    await expect(
      addOperation(db, 1, { type: 'expense', amount: 1, text: '', nowMs: NOW, maxOperations: 1 })
    ).rejects.toBeInstanceOf(LimitError);
  });

  it('truncates a very long description', async () => {
    const { operation } = await addOperation(db, 1, { type: 'expense', amount: 1, text: 'я'.repeat(500), nowMs: NOW });
    expect(operation.name).toHaveLength(200);
  });
});

describe('reports', () => {
  beforeEach(async () => {
    const op = (id, type, amount, category, date) => ({ id, type, amount, category, date: `${date}T09:00:00.000Z` });
    for (const o of [
      op('a', 'income', 120000, 'Зарплата', '2026-10-03'),
      op('b', 'expense', 35000, 'Жильё', '2026-10-05'),
      op('c', 'expense', 5520, 'Еда', '2026-10-12'),
      op('d', 'income', 15000, 'Подработка', '2026-09-20')
    ]) await seedOperation(db, 1, o);
  });

  it('getReport totals a range with category breakdown and monthly series', async () => {
    const report = await getReport(db, 1, { from: '2026-09-01', to: '2026-10-31' });
    expect(report).toMatchObject({ income: 135000, expense: 40520, balance: 94480 });
    expect(report.expenseCategories).toEqual([{ category: 'Жильё', total: 35000 }, { category: 'Еда', total: 5520 }]);
    expect(report.incomeCategories.map(c => c.category)).toEqual(['Зарплата', 'Подработка']);
    expect(report.byMonth).toEqual([
      { month: '2026-09', income: 15000, expense: 0 },
      { month: '2026-10', income: 120000, expense: 40520 }
    ]);
  });

  it('balanceSummary reports the month, all time and progress to goals', async () => {
    const summary = await balanceSummary(db, 1, NOW);
    expect(summary).toMatchObject({
      monthTitle: 'октябрь 2026',
      month: { income: 120000, expense: 40520, balance: 79480 },
      total: { income: 135000, expense: 40520, balance: 94480 },
      monthTarget: 100000, monthPct: 79,
      goal: 1000000, goalName: 'Главная цель', goalPct: 9,
      currency: '₽'
    });
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/core.test.js`
Expected: FAIL (`../src/core.js` не найден).

- [ ] **Step 3: Реализовать**

`worker/src/core.js`:

```js
import { resolveCategory } from './categories.js';
import {
  categoryTotals, countOperations, ensureUser, getTotals, insertOperation, insertOperationOnce, monthlyTotals
} from './db.js';
import { dateToIso, monthRange, monthTitle, percent, round2, todayDate } from './format.js';
import { MAX_NAME, MAX_OPERATIONS } from './limits.js';

const ALL_TIME = { from: '0000-01-01', to: '9999-12-31' };

export class LimitError extends Error {}

function newOperationId(nowMs) {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(3)), byte => byte.toString(36).padStart(2, '0')).join('');
  return nowMs.toString(36) + random;
}

/**
 * Добавляет операцию «на сегодня». Общая точка входа для команд, живой речи и ИИ.
 * @param {D1Database} db
 * @param {number} userId
 * @param {{ type: 'income' | 'expense', amount: number, text: string, updateId?: number, nowMs: number, maxOperations?: number }} input
 * @returns {Promise<{ operation: import('./db.js').Operation, inserted: boolean, monthBalance: number, settings: object }>}
 */
export async function addOperation(db, userId, { type, amount, text, updateId, nowMs, maxOperations = MAX_OPERATIONS }) {
  const user = await ensureUser(db, userId, nowMs);
  if ((await countOperations(db, userId)) >= maxOperations) throw new LimitError('operations-limit');

  const { category, name } = resolveCategory(type, text, user.settings.categories);
  const date = todayDate(nowMs);
  const operation = {
    id: newOperationId(nowMs), name: name.slice(0, MAX_NAME), amount, type, category, date: dateToIso(date), source: 'bot'
  };

  let inserted = true;
  if (updateId === undefined) await insertOperation(db, userId, operation, nowMs);
  else inserted = await insertOperationOnce(db, userId, operation, updateId, nowMs);

  const { from, to } = monthRange(date);
  const totals = await getTotals(db, userId, from, to);
  return { operation, inserted, monthBalance: round2(totals.income - totals.expense), settings: user.settings };
}

/**
 * @param {D1Database} db
 * @param {number} userId
 * @param {{ from: string, to: string }} range даты YYYY-MM-DD, включительно
 */
export async function getReport(db, userId, { from, to }) {
  const [totals, expenseCategories, incomeCategories, byMonth] = await Promise.all([
    getTotals(db, userId, from, to),
    categoryTotals(db, userId, 'expense', from, to),
    categoryTotals(db, userId, 'income', from, to),
    monthlyTotals(db, userId, from, to)
  ]);
  return { ...totals, balance: round2(totals.income - totals.expense), expenseCategories, incomeCategories, byMonth };
}

/** Данные для /balance: месяц, всё время и прогресс к целям (формулы как в приложении). */
export async function balanceSummary(db, userId, nowMs) {
  const user = await ensureUser(db, userId, nowMs);
  const date = todayDate(nowMs);
  const [month, total] = await Promise.all([
    getTotals(db, userId, monthRange(date).from, monthRange(date).to),
    getTotals(db, userId, ALL_TIME.from, ALL_TIME.to)
  ]);
  const monthBalance = round2(month.income - month.expense);
  const totalBalance = round2(total.income - total.expense);
  const { goal, goalName, currency } = user.settings;
  return {
    monthTitle: monthTitle(date),
    month: { ...month, balance: monthBalance },
    total: { ...total, balance: totalBalance },
    monthTarget: user.monthTarget,
    monthPct: percent(monthBalance, user.monthTarget),
    goal,
    goalName,
    goalPct: percent(totalBalance, goal),
    currency
  };
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/core.js worker/test/core.test.js
git commit -m "feat: общее ядро addOperation, getReport и balanceSummary"
```

---

### Task 7: Проверка секрета webhook и подписи `initData` (`auth.js`)

**Files:**
- Create: `worker/src/auth.js`
- Test: `worker/test/auth.test.js`

**Interfaces:**
- Consumes: `signInitData`, `initDataFields` из `test/helpers.js` (только в тестах).
- Produces:
  - `timingSafeEqual(a: string, b: string): boolean`
  - `verifyWebhookSecret(request: Request, secret: string | undefined): boolean`
  - `verifyInitData(initData: string, botToken: string, nowMs: number, maxAgeSec?: number): Promise<{ ok: true, userId: number } | { ok: false }>`

- [ ] **Step 1: Написать падающие тесты**

`worker/test/auth.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { timingSafeEqual, verifyInitData, verifyWebhookSecret } from '../src/auth.js';
import { initDataFields, NOW, signInitData } from './helpers.js';

const TOKEN = 'test-token';
const nowSec = Math.floor(NOW / 1000);

describe('timingSafeEqual', () => {
  it('is true only for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abc', undefined)).toBe(false);
  });
});

describe('verifyWebhookSecret', () => {
  const request = secret => new Request('https://x.test/telegram/webhook', {
    method: 'POST', headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}
  });

  it('accepts the matching secret', () => {
    expect(verifyWebhookSecret(request('s3cret'), 's3cret')).toBe(true);
  });

  it('rejects a wrong or missing secret', () => {
    expect(verifyWebhookSecret(request('other'), 's3cret')).toBe(false);
    expect(verifyWebhookSecret(request(), 's3cret')).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(verifyWebhookSecret(request(''), '')).toBe(false);
    expect(verifyWebhookSecret(request('x'), undefined)).toBe(false);
  });
});

describe('verifyInitData', () => {
  it('accepts correctly signed data, including the signature field and a non-Latin name', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: true, userId: 42 });
  });

  it('rejects data signed with another bot token', async () => {
    const initData = await signInitData('another-token', initDataFields(42, nowSec));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects a tampered user id', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec));
    const params = new URLSearchParams(initData);
    params.set('user', JSON.stringify({ id: 43 }));
    expect(await verifyInitData(params.toString(), TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects data older than 24 hours', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec - 2 * 86400));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects data from the future', async () => {
    const initData = await signInitData(TOKEN, initDataFields(42, nowSec + 3600));
    expect(await verifyInitData(initData, TOKEN, NOW)).toEqual({ ok: false });
  });

  it('rejects missing hash, empty input and non-integer ids', async () => {
    expect(await verifyInitData('auth_date=1', TOKEN, NOW)).toEqual({ ok: false });
    expect(await verifyInitData('', TOKEN, NOW)).toEqual({ ok: false });
    const badId = await signInitData(TOKEN, initDataFields(42, nowSec, { user: JSON.stringify({ id: 'abc' }) }));
    expect(await verifyInitData(badId, TOKEN, NOW)).toEqual({ ok: false });
    const noUser = await signInitData(TOKEN, initDataFields(42, nowSec, { user: 'not json' }));
    expect(await verifyInitData(noUser, TOKEN, NOW)).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/auth.test.js`
Expected: FAIL (`../src/auth.js` не найден).

- [ ] **Step 3: Реализовать**

`worker/src/auth.js`:

```js
const encoder = new TextEncoder();
const MAX_FUTURE_SKEW_SEC = 60;

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** Сравнение строк за время, не зависящее от места первого расхождения. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Заголовок X-Telegram-Bot-Api-Secret-Token должен совпасть с WEBHOOK_SECRET. */
export function verifyWebhookSecret(request, secret) {
  if (!secret) return false;
  return timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', secret);
}

/**
 * Проверяет подпись initData по схеме Telegram (HMAC-SHA256, ключ из токена бота).
 * В строку проверки входят все поля, кроме hash (signature тоже входит).
 * @param {string} initData строка запроса, полученная мини-аппом от Telegram
 * @param {string} botToken
 * @param {number} nowMs
 * @param {number} [maxAgeSec] максимальный возраст auth_date
 * @returns {Promise<{ ok: true, userId: number } | { ok: false }>}
 */
export async function verifyInitData(initData, botToken, nowMs, maxAgeSec = 86400) {
  if (!initData || !botToken) return { ok: false };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmac(encoder.encode('WebAppData'), botToken);
  if (!timingSafeEqual(toHex(await hmac(secretKey, dataCheckString)), hash)) return { ok: false };

  const age = nowMs / 1000 - Number(params.get('auth_date'));
  if (!Number.isFinite(age) || age > maxAgeSec || age < -MAX_FUTURE_SKEW_SEC) return { ok: false };

  try {
    const user = JSON.parse(params.get('user'));
    return Number.isSafeInteger(user?.id) ? { ok: true, userId: user.id } : { ok: false };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth.js worker/test/auth.test.js
git commit -m "feat: проверка секрета webhook и подписи initData"
```

---

### Task 8: Проверка входных данных синхронизации (`validate.js`)

**Files:**
- Create: `worker/src/validate.js`
- Test: `worker/test/validate.test.js`

**Interfaces:**
- Consumes: `MAX_AMOUNT`, `MAX_NAME`, `MAX_CATEGORY`, `MAX_CATEGORIES`, `MAX_SYNC_ITEMS` из `limits.js`.
- Produces:
  - `normalizeOperation(raw: unknown): { ok: true, value: Operation } | { ok: false, reason: string }`
  - `normalizeSettings(raw: unknown): { ok: true, value: object } | { ok: false, error: string }`
  - `validateSync(body: unknown): { ok: true, value: { upsert: Operation[], remove: string[], settings?: object, monthTarget?: number, rejected: { id: string | null, reason: string }[] } } | { ok: false, error: string }`

- [ ] **Step 1: Написать падающие тесты**

`worker/test/validate.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { normalizeOperation, normalizeSettings, validateSync } from '../src/validate.js';

const validOp = (overrides = {}) => ({
  id: 'abc123', name: 'Такси', amount: 500, type: 'expense', category: 'Транспорт', date: '2026-10-14T09:00:00.000Z', source: 'pdf', ...overrides
});

describe('normalizeOperation', () => {
  it('accepts a valid operation and returns exactly the known fields', () => {
    expect(normalizeOperation({ ...validOp(), extra: 'ignored' })).toEqual({ ok: true, value: validOp() });
  });

  it.each([
    [{ id: 'bad id!' }, 'bad-id'],
    [{ id: 5 }, 'bad-id'],
    [{ type: 'transfer' }, 'bad-type'],
    [{ amount: '500' }, 'bad-amount'],
    [{ amount: 0 }, 'bad-amount'],
    [{ amount: -1 }, 'bad-amount'],
    [{ amount: 0.004 }, 'bad-amount'],
    [{ amount: 1e12 }, 'bad-amount'],
    [{ amount: NaN }, 'bad-amount'],
    [{ date: 'not-a-date' }, 'bad-date'],
    [{ date: '2026-13-45T09:00:00.000Z' }, 'bad-date']
  ])('rejects %j as %s', (overrides, reason) => {
    expect(normalizeOperation(validOp(overrides))).toEqual({ ok: false, reason });
  });

  it('rejects non-objects', () => {
    expect(normalizeOperation(null)).toEqual({ ok: false, reason: 'not-object' });
  });

  it('rounds the amount to kopecks', () => {
    expect(normalizeOperation(validOp({ amount: 10.456 })).value.amount).toBe(10.46);
  });

  it('truncates long texts instead of rejecting them', () => {
    const { value } = normalizeOperation(validOp({ name: 'я'.repeat(300), category: 'к'.repeat(100), source: 'x'.repeat(50) }));
    expect([value.name.length, value.category.length, value.source.length]).toEqual([200, 40, 20]);
  });

  it('falls back to the category, then a default, when the name is missing', () => {
    expect(normalizeOperation(validOp({ name: '  ' })).value.name).toBe('Транспорт');
    expect(normalizeOperation(validOp({ name: undefined, category: null })).value.name).toBe('Операция');
  });

  it('turns an empty or missing category and source into null', () => {
    const { value } = normalizeOperation(validOp({ category: '', source: undefined }));
    expect([value.category, value.source]).toEqual([null, null]);
  });
});

describe('normalizeSettings', () => {
  const validSettings = () => ({
    goal: 1000000, goalName: 'Цель', currency: '₽', theme: 'light',
    categories: { income: ['Зарплата'], expense: ['Еда', 'Прочее'] }
  });

  it('accepts valid settings', () => {
    expect(normalizeSettings(validSettings())).toEqual({ ok: true, value: validSettings() });
  });

  it('defaults the theme and ignores unknown fields', () => {
    const { value } = normalizeSettings({ ...validSettings(), theme: undefined, extra: 1 });
    expect(value.theme).toBe('dark');
    expect(value).not.toHaveProperty('extra');
  });

  it.each([
    [{ goal: -1 }],
    [{ goal: 'много' }],
    [{ categories: undefined }],
    [{ categories: { income: [], expense: ['Еда'] } }],
    [{ categories: { income: ['A'], expense: [5] } }],
    [{ categories: { income: Array.from({ length: 51 }, (_, i) => `c${i}`), expense: ['Еда'] } }]
  ])('rejects invalid settings %j', overrides => {
    expect(normalizeSettings({ ...validSettings(), ...overrides }).ok).toBe(false);
  });

  it('truncates long names', () => {
    const { value } = normalizeSettings({ ...validSettings(), goalName: 'я'.repeat(100), categories: { income: ['к'.repeat(90)], expense: ['Еда'] } });
    expect(value.goalName).toHaveLength(60);
    expect(value.categories.income[0]).toHaveLength(40);
  });
});

describe('validateSync', () => {
  it('accepts an empty change set', () => {
    expect(validateSync({})).toEqual({ ok: true, value: { upsert: [], remove: [], settings: undefined, monthTarget: undefined, rejected: [] } });
  });

  it('rejects a body that is not an object or has non-array lists', () => {
    expect(validateSync(null).ok).toBe(false);
    expect(validateSync({ upsert: 'x' }).ok).toBe(false);
    expect(validateSync({ remove: {} }).ok).toBe(false);
  });

  it('rejects too many items at once', () => {
    const many = Array.from({ length: 101 }, (_, i) => validOp({ id: `id${i}` }));
    expect(validateSync({ upsert: many }).ok).toBe(false);
    expect(validateSync({ remove: many.map(o => o.id) }).ok).toBe(false);
  });

  it('keeps good operations and reports broken ones instead of failing the whole request', () => {
    const result = validateSync({ upsert: [validOp({ id: 'good' }), validOp({ id: 'zero', amount: 0 }), { nonsense: true }] });
    expect(result.ok).toBe(true);
    expect(result.value.upsert.map(o => o.id)).toEqual(['good']);
    expect(result.value.rejected).toEqual([{ id: 'zero', reason: 'bad-amount' }, { id: null, reason: 'bad-id' }]);
  });

  it('collapses duplicate ids and drops malformed ids to remove', () => {
    const result = validateSync({ upsert: [validOp({ id: 'a' }), validOp({ id: 'a', amount: 9 })], remove: ['x', 'x', 'bad id', 7] });
    expect(result.value.upsert).toHaveLength(1);
    expect(result.value.remove).toEqual(['x']);
  });

  it('validates settings and monthTarget when present', () => {
    expect(validateSync({ settings: { goal: -1 } }).ok).toBe(false);
    expect(validateSync({ monthTarget: -5 }).ok).toBe(false);
    expect(validateSync({ monthTarget: 'x' }).ok).toBe(false);
    expect(validateSync({ monthTarget: 150000 }).value.monthTarget).toBe(150000);
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/validate.test.js`
Expected: FAIL (`../src/validate.js` не найден).

- [ ] **Step 3: Реализовать**

`worker/src/validate.js`:

```js
import { MAX_AMOUNT, MAX_CATEGORIES, MAX_CATEGORY, MAX_NAME, MAX_SYNC_ITEMS } from './limits.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_SOURCE = 20;
const MAX_GOAL_NAME = 60;
const MAX_CURRENCY = 8;
const MAX_MONEY_SETTING = 1e12;

const cut = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Приводит операцию к виду, пригодному для записи. Тексты усекаются, неверная структура отвергается.
 * @param {unknown} raw
 * @returns {{ ok: true, value: import('./db.js').Operation } | { ok: false, reason: string }}
 */
export function normalizeOperation(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-object' };
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { ok: false, reason: 'bad-id' };
  if (raw.type !== 'income' && raw.type !== 'expense') return { ok: false, reason: 'bad-type' };

  const amount = typeof raw.amount === 'number' ? Math.round(raw.amount * 100) / 100 : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, reason: 'bad-amount' };
  if (typeof raw.date !== 'string' || !ISO_RE.test(raw.date) || Number.isNaN(Date.parse(raw.date))) {
    return { ok: false, reason: 'bad-date' };
  }

  const category = cut(raw.category, MAX_CATEGORY) || null;
  return {
    ok: true,
    value: {
      id: raw.id,
      name: cut(raw.name, MAX_NAME) || category || 'Операция',
      amount,
      type: raw.type,
      category,
      date: raw.date,
      source: cut(raw.source, MAX_SOURCE) || null
    }
  };
}

function normalizeCategoryList(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CATEGORIES) return null;
  if (!list.every(item => typeof item === 'string')) return null;
  const cleaned = [...new Set(list.map(item => cut(item, MAX_CATEGORY)).filter(Boolean))];
  return cleaned.length ? cleaned : null;
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function normalizeSettings(raw) {
  const bad = error => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('Настройки должны быть объектом');
  if (typeof raw.goal !== 'number' || !Number.isFinite(raw.goal) || raw.goal < 0 || raw.goal > MAX_MONEY_SETTING) {
    return bad('Неверная сумма цели');
  }
  const income = normalizeCategoryList(raw.categories?.income);
  const expense = normalizeCategoryList(raw.categories?.expense);
  if (!income || !expense) return bad('Неверный список категорий');

  return {
    ok: true,
    value: {
      goal: raw.goal,
      goalName: cut(raw.goalName, MAX_GOAL_NAME) || 'Главная цель',
      currency: cut(raw.currency, MAX_CURRENCY) || '₽',
      theme: raw.theme === 'light' ? 'light' : 'dark',
      categories: { income, expense }
    }
  };
}

/**
 * Проверяет тело POST /api/sync. Структурные ошибки отвергают запрос целиком,
 * отдельные испорченные операции пропускаются и возвращаются в `rejected`.
 * @param {unknown} body
 */
export function validateSync(body) {
  const fail = error => ({ ok: false, error });
  if (!body || typeof body !== 'object') return fail('Тело запроса должно быть JSON-объектом');

  const upsertRaw = body.upsert ?? [];
  const removeRaw = body.remove ?? [];
  if (!Array.isArray(upsertRaw) || !Array.isArray(removeRaw)) return fail('upsert и remove должны быть списками');
  if (upsertRaw.length > MAX_SYNC_ITEMS || removeRaw.length > MAX_SYNC_ITEMS) {
    return fail(`Не более ${MAX_SYNC_ITEMS} элементов за запрос`);
  }

  const upsert = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of upsertRaw) {
    const result = normalizeOperation(raw);
    if (!result.ok) {
      rejected.push({ id: typeof raw?.id === 'string' ? raw.id : null, reason: result.reason });
    } else if (!seen.has(result.value.id)) {
      seen.add(result.value.id);
      upsert.push(result.value);
    }
  }
  const remove = [...new Set(removeRaw.filter(id => typeof id === 'string' && ID_RE.test(id)))];

  let settings;
  if (body.settings !== undefined) {
    const result = normalizeSettings(body.settings);
    if (!result.ok) return fail(result.error);
    settings = result.value;
  }

  let monthTarget;
  if (body.monthTarget !== undefined) {
    const value = body.monthTarget;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MONEY_SETTING) {
      return fail('Неверная цель на месяц');
    }
    monthTarget = value;
  }

  return { ok: true, value: { upsert, remove, settings, monthTarget, rejected } };
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/validate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/validate.js worker/test/validate.test.js
git commit -m "feat: проверка и нормализация данных синхронизации"
```

---

### Task 9: Клиент Telegram и тексты бота (`telegram.js`, `messages.js`)

**Files:**
- Create: `worker/src/telegram.js`, `worker/src/messages.js`
- Test: `worker/test/telegram.test.js`, `worker/test/messages.test.js`

**Interfaces:**
- Consumes: `escapeHtml`, `formatMoney`, `formatDateShort` из `format.js`.
- Produces:
  - `createTelegram(botToken: string, fetchFn?: typeof fetch): { send(chatId, text, replyMarkup?), answerCallback(callbackQueryId, text?), clearButtons(chatId, messageId) }` — методы возвращают ответ Bot API или `null` при сбое (ошибки не выбрасываются, пишутся в `console.error` без токена).
  - `appKeyboard(appUrl: string)`, `undoKeyboard(operationId: string)`, `confirmDeleteKeyboard()` — объекты `reply_markup`.
  - `messages.js`: константы `HELP_TEXT`, `WELCOME_TEXT`, `UNKNOWN_TEXT`, `STATEMENT_TEXT`, `NO_OPERATIONS_TEXT`, `RATE_LIMIT_TEXT`, `BLOCKED_TEXT`, `LIMIT_TEXT`, `DELETE_CONFIRM_TEXT`, `DELETED_TEXT`; функции `usageText(command, reason)`, `addedText({ operation, monthBalance }, currency)`, `operationLine(op, currency)`, `undoneText(op, currency)`, `lastText(ops, currency)`, `balanceText(summary)`, `monthText(title, report, currency)`.

- [ ] **Step 1: Написать падающие тесты**

`worker/test/telegram.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { appKeyboard, confirmDeleteKeyboard, createTelegram, undoKeyboard } from '../src/telegram.js';

const okResponse = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

describe('createTelegram', () => {
  it('sends an HTML message to the right Bot API url', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    await createTelegram('123:ABC', fetchFn).send(77, 'Привет', { inline_keyboard: [] });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: 77, text: 'Привет', parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
  });

  it('omits reply_markup when none is given', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    await createTelegram('t', fetchFn).send(1, 'x');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).not.toHaveProperty('reply_markup');
  });

  it('answers callbacks and clears buttons', async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const tg = createTelegram('t', fetchFn);
    await tg.answerCallback('cb1', 'Готово');
    await tg.clearButtons(5, 9);
    expect(fetchFn.mock.calls[0][0]).toMatch(/answerCallbackQuery$/);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ callback_query_id: 'cb1', text: 'Готово' });
    expect(fetchFn.mock.calls[1][0]).toMatch(/editMessageReplyMarkup$/);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ chat_id: 5, message_id: 9, reply_markup: { inline_keyboard: [] } });
  });

  it('returns null instead of throwing on an HTTP error, without logging the token', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await createTelegram('SECRET-TOKEN', fetchFn).send(1, 'x')).toBeNull();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('SECRET-TOKEN');
    errorLog.mockRestore();
  });

  it('returns null when the network request fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => { throw new Error('offline'); });
    expect(await createTelegram('t', fetchFn).send(1, 'x')).toBeNull();
    errorLog.mockRestore();
  });
});

describe('keyboards', () => {
  it('appKeyboard has Web App buttons for the app and for the import screen', () => {
    const keyboard = appKeyboard('https://example.github.io/money/');
    const [[open], [statement]] = keyboard.inline_keyboard;
    expect(open).toEqual({ text: '📊 Открыть приложение', web_app: { url: 'https://example.github.io/money/' } });
    expect(statement).toEqual({ text: '📥 Добавить выписку', web_app: { url: 'https://example.github.io/money/?action=import' } });
  });

  it('undoKeyboard carries the operation id in callback_data', () => {
    expect(undoKeyboard('abc123').inline_keyboard[0][0]).toEqual({ text: '↩️ Отменить', callback_data: 'undo:abc123' });
  });

  it('confirmDeleteKeyboard offers yes and no', () => {
    const [yes, no] = confirmDeleteKeyboard().inline_keyboard[0];
    expect([yes.callback_data, no.callback_data]).toEqual(['deleteall:yes', 'deleteall:no']);
  });
});
```

`worker/test/messages.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { addedText, balanceText, lastText, monthText, operationLine, usageText } from '../src/messages.js';

const op = (overrides = {}) => ({
  id: 'a', name: 'такси', amount: 780, type: 'expense', category: 'Транспорт', date: '2026-10-13T12:00:00.000Z', source: 'bot', ...overrides
});

describe('addedText', () => {
  it('shows type, amount, category, name and the month balance', () => {
    const text = addedText({ operation: op(), monthBalance: 94480 }, '₽');
    expect(text).toMatch(/^✅ Расход 780 ₽ · Транспорт · такси\nОстаток за месяц: 94\D480 ₽$/);
  });

  it('does not repeat the name when it equals the category', () => {
    const text = addedText({ operation: op({ type: 'income', name: 'Зарплата', category: 'Зарплата' }), monthBalance: 1 }, '₽');
    expect(text).toContain('✅ Доход 780 ₽ · Зарплата\n');
  });

  it('escapes user text', () => {
    const text = addedText({ operation: op({ name: '<b>x</b> & y' }), monthBalance: 0 }, '₽');
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(text).not.toContain('<b>x</b>');
  });
});

describe('usageText', () => {
  it('explains the specific problem and gives an example', () => {
    expect(usageText('spent', 'decimals')).toContain('двух знаков');
    expect(usageText('income', 'format')).toContain('/income 500 такси');
  });
});

describe('lists', () => {
  it('operationLine prefixes income with + and expense with −', () => {
    expect(operationLine(op({ type: 'income' }), '₽')).toMatch(/^\+780 ₽ · Транспорт · такси · 13\.10\.2026$/);
    expect(operationLine(op(), '₽')).toMatch(/^−780 ₽/);
  });

  it('lastText numbers the operations', () => {
    const text = lastText([op({ id: 'a' }), op({ id: 'b', name: 'Транспорт' })], '₽');
    expect(text).toContain('1. −780 ₽ · Транспорт · такси');
    expect(text).toContain('2. −780 ₽ · Транспорт · 13.10.2026');
  });
});

describe('balanceText and monthText', () => {
  const summary = {
    monthTitle: 'октябрь 2026', currency: '₽',
    month: { income: 120000, expense: 40520, balance: 79480 },
    total: { income: 135000, expense: 40520, balance: 94480 },
    monthTarget: 100000, monthPct: 79, goal: 1000000, goalName: 'Квартира', goalPct: 9
  };

  it('balanceText covers the month, the total and both goals', () => {
    const text = balanceText(summary);
    expect(text).toContain('октябрь 2026');
    expect(text).toMatch(/Доход: 120\D000 ₽/);
    expect(text).toMatch(/Остаток: 79\D480 ₽/);
    expect(text).toMatch(/Всего накоплено: 94\D480 ₽/);
    expect(text).toMatch(/Цель на месяц: 79\D480 ₽ из 100\D000 ₽ \(79%\)/);
    expect(text).toMatch(/Квартира: 94\D480 ₽ из 1\D000\D000 ₽ \(9%\)/);
  });

  it('monthText lists categories with shares and handles an empty month', () => {
    const report = { expense: 40520, expenseCategories: [{ category: 'Жильё', total: 35000 }, { category: 'Еда', total: 5520 }] };
    const text = monthText('октябрь 2026', report, '₽');
    expect(text).toMatch(/Всего: 40\D520 ₽/);
    expect(text).toMatch(/Жильё — 35\D000 ₽ \(86%\)/);
    expect(monthText('октябрь 2026', { expense: 0, expenseCategories: [] }, '₽')).toBe('Расходов за октябрь 2026 нет.');
  });

  it('monthText shows the top ten and counts the rest', () => {
    const expenseCategories = Array.from({ length: 12 }, (_, i) => ({ category: `К${i}`, total: 100 - i }));
    expect(monthText('октябрь 2026', { expense: 1000, expenseCategories }, '₽')).toContain('и ещё 2');
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/telegram.test.js test/messages.test.js`
Expected: FAIL (модули не найдены).

- [ ] **Step 3: Реализовать `telegram.js`**

`worker/src/telegram.js`:

```js
const API = 'https://api.telegram.org';

/**
 * Клиент Bot API. Сбои сети и ответы с ошибкой не выбрасываются, а возвращают null:
 * неудавшийся ответ пользователю не должен ронять обработку уже сохранённых данных.
 * @param {string} botToken
 * @param {typeof fetch} [fetchFn]
 */
export function createTelegram(botToken, fetchFn = fetch) {
  async function call(method, payload) {
    try {
      const response = await fetchFn(`${API}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error('Ответ Telegram с ошибкой', method, response.status);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('Запрос к Telegram не удался', method, error?.message);
      return null;
    }
  }

  return {
    send: (chatId, text, replyMarkup) => call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    }),
    answerCallback: (callbackQueryId, text) => call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {})
    }),
    clearButtons: (chatId, messageId) => call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    })
  };
}

/** Кнопки Web App: главный экран и сразу выбор выписки. Inline, потому что у кнопки-клавиатуры initData пустой. */
export function appKeyboard(appUrl) {
  const importUrl = new URL(appUrl);
  importUrl.searchParams.set('action', 'import');
  return {
    inline_keyboard: [
      [{ text: '📊 Открыть приложение', web_app: { url: appUrl } }],
      [{ text: '📥 Добавить выписку', web_app: { url: importUrl.toString() } }]
    ]
  };
}

export const undoKeyboard = operationId => ({
  inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `undo:${operationId}` }]]
});

export const confirmDeleteKeyboard = () => ({
  inline_keyboard: [[
    { text: '🗑 Да, удалить всё', callback_data: 'deleteall:yes' },
    { text: 'Отмена', callback_data: 'deleteall:no' }
  ]]
});
```

- [ ] **Step 4: Реализовать `messages.js`**

`worker/src/messages.js`:

```js
import { escapeHtml, formatDateShort, formatMoney } from './format.js';

const TOP_CATEGORIES = 10;

export const HELP_TEXT = [
  '<b>Команды</b>',
  '/spent 500 такси — добавить расход',
  '/income 50000 зарплата — добавить доход',
  '/balance — баланс и прогресс к целям',
  '/month — расходы за месяц по категориям',
  '/last 5 — последние операции',
  '/undo — удалить последнюю операцию',
  '/statement — загрузить банковскую выписку',
  '/deleteall — удалить все мои данные'
].join('\n');

export const WELCOME_TEXT = `👋 Привет! Я веду учёт доходов и расходов.\n\n${HELP_TEXT}`;
export const UNKNOWN_TEXT = 'Не понял. Список команд: /help';
export const STATEMENT_TEXT = 'Нажмите кнопку, чтобы загрузить банковскую выписку:';
export const NO_OPERATIONS_TEXT = 'Операций пока нет.';
export const RATE_LIMIT_TEXT = 'Слишком много сообщений. Подождите минуту.';
export const BLOCKED_TEXT = 'Доступ к боту закрыт.';
export const LIMIT_TEXT = 'Достигнут лимит операций. Удалите старые в приложении.';
export const DELETE_CONFIRM_TEXT = 'Удалить все ваши данные? Это нельзя отменить.';
export const DELETED_TEXT = 'Все данные удалены.';

const USAGE_REASONS = {
  format: 'Не понял сумму.',
  decimals: 'В сумме не больше двух знаков после запятой.',
  positive: 'Сумма должна быть больше нуля.',
  too_big: 'Слишком большая сумма.'
};

/** @param {string} command 'spent' | 'income' @param {string} reason ключ из USAGE_REASONS */
export function usageText(command, reason) {
  return `${USAGE_REASONS[reason] ?? USAGE_REASONS.format}\nПример: <code>/${command} 500 такси</code>`;
}

const nameSuffix = op => (op.name === op.category ? '' : ` · ${escapeHtml(op.name)}`);

export function addedText({ operation, monthBalance }, currency) {
  const label = operation.type === 'income' ? 'Доход' : 'Расход';
  return `✅ ${label} ${formatMoney(operation.amount, currency)} · ${escapeHtml(operation.category)}${nameSuffix(operation)}\n` +
    `Остаток за месяц: ${formatMoney(monthBalance, currency)}`;
}

export function operationLine(op, currency) {
  const sign = op.type === 'income' ? '+' : '−';
  return `${sign}${formatMoney(op.amount, currency)} · ${escapeHtml(op.category ?? 'Без категории')}${nameSuffix(op)} · ${formatDateShort(op.date)}`;
}

export const undoneText = (op, currency) => `🗑 Удалено: ${operationLine(op, currency)}`;

export const lastText = (ops, currency) =>
  ['<b>Последние операции</b>', ...ops.map((op, i) => `${i + 1}. ${operationLine(op, currency)}`)].join('\n');

export function balanceText(s) {
  return [
    `📊 <b>${escapeHtml(s.monthTitle)}</b>`,
    `Доход: ${formatMoney(s.month.income, s.currency)}`,
    `Расход: ${formatMoney(s.month.expense, s.currency)}`,
    `Остаток: ${formatMoney(s.month.balance, s.currency)}`,
    '',
    `Всего накоплено: ${formatMoney(s.total.balance, s.currency)}`,
    `Цель на месяц: ${formatMoney(s.month.balance, s.currency)} из ${formatMoney(s.monthTarget, s.currency)} (${s.monthPct}%)`,
    `${escapeHtml(s.goalName)}: ${formatMoney(s.total.balance, s.currency)} из ${formatMoney(s.goal, s.currency)} (${s.goalPct}%)`
  ].join('\n');
}

export function monthText(title, report, currency) {
  if (!(report.expense > 0)) return `Расходов за ${title} нет.`;
  const top = report.expenseCategories.slice(0, TOP_CATEGORIES);
  const share = total => Math.round((total / report.expense) * 100);
  const lines = top.map(c => `• ${escapeHtml(c.category)} — ${formatMoney(c.total, currency)} (${share(c.total)}%)`);
  const rest = report.expenseCategories.length - top.length;
  return [
    `📅 <b>Расходы · ${escapeHtml(title)}</b>`,
    `Всего: ${formatMoney(report.expense, currency)}`,
    ...lines,
    ...(rest > 0 ? [`и ещё ${rest}`] : [])
  ].join('\n');
}
```

- [ ] **Step 5: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/telegram.test.js test/messages.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/telegram.js worker/src/messages.js worker/test/telegram.test.js worker/test/messages.test.js
git commit -m "feat: клиент Telegram, inline-кнопки и тексты ответов бота"
```

---

### Task 10: Команды бота — добавление, отмена, удаление (`commands.js`)

**Files:**
- Create: `worker/src/commands.js`
- Test: `worker/test/commands.test.js`

**Interfaces:**
- Consumes: `addOperation`, `LimitError` (core); `deleteAllStatements`, `deleteOperation`, `ensureUser`, `listLastOperations` (db); `BOT_RATE_PER_MINUTE`, `hitRateLimit`, `isAllowed` (limits); `parseAmountAndText`, `parseCommand` (parse); `appKeyboard`, `confirmDeleteKeyboard`, `undoKeyboard` (telegram); тексты из `messages.js`; помощники из `test/helpers.js`.
- Produces: `handleUpdate(update: object, ctx: Ctx): Promise<void>`, где `Ctx = { db, tg, appUrl: string, allowlist: string, nowMs: number }`; обработчикам команд передаётся расширенный `ctx` с `userId`, `chatId`, `updateId`, `args`. Таблица `COMMANDS` (в Task 11 в неё добавляются `balance`, `month`, `last`).

- [ ] **Step 1: Написать падающие тесты**

`worker/test/commands.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../src/commands.js';
import { countOperations, getUser, listOperations } from '../src/db.js';
import { callbackUpdate, makeCtx, NOW, resetDb, seedOperation, textUpdate } from './helpers.js';

const db = env.DB;
beforeEach(() => resetDb(db));

const lastReply = ctx => ctx.tg.send.mock.calls.at(-1);

describe('/start, /help, /statement', () => {
  it('/start creates the user and shows both Web App buttons', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/start'), ctx);

    expect(await getUser(db, 1)).not.toBeNull();
    const [chatId, text, markup] = lastReply(ctx);
    expect(chatId).toBe(1);
    expect(text).toContain('/spent');
    expect(markup.inline_keyboard.flat().map(b => b.web_app.url)).toEqual([
      'https://example.github.io/money/', 'https://example.github.io/money/?action=import'
    ]);
  });

  it('/help and /statement both carry the buttons', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/help'), ctx);
    expect(lastReply(ctx)[2].inline_keyboard).toHaveLength(2);
    await handleUpdate(textUpdate('/statement', { updateId: 2 }), ctx);
    expect(lastReply(ctx)[1]).toContain('выписку');
    expect(lastReply(ctx)[2].inline_keyboard[1][0].text).toBe('📥 Добавить выписку');
  });
});

describe('/spent and /income', () => {
  it('/spent 500 такси stores an expense and answers with an undo button', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 500 такси'), ctx);

    const [stored] = await listOperations(db, 1);
    expect(stored).toMatchObject({
      type: 'expense', amount: 500, category: 'Транспорт', name: 'такси', date: '2026-10-14T12:00:00.000Z', source: 'bot'
    });
    const [, text, markup] = lastReply(ctx);
    expect(text).toContain('✅ Расход 500 ₽ · Транспорт · такси');
    expect(markup.inline_keyboard[0][0].callback_data).toBe(`undo:${stored.id}`);
  });

  it('/income 50000 зарплата stores an income in the matching category', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/income 50000 зарплата'), ctx);
    expect((await listOperations(db, 1))[0]).toMatchObject({ type: 'income', amount: 50000, category: 'Зарплата', name: 'Зарплата' });
    expect(lastReply(ctx)[1]).toContain('✅ Доход');
  });

  it('answers a bad amount with a usage hint and stores nothing', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent много'), ctx);
    await handleUpdate(textUpdate('/spent 12.345', { updateId: 2 }), ctx);
    expect(ctx.tg.send.mock.calls[0][1]).toContain('Пример: <code>/spent 500 такси</code>');
    expect(ctx.tg.send.mock.calls[1][1]).toContain('двух знаков');
    expect(await countOperations(db, 1)).toBe(0);
  });

  it('escapes markup in the description so the reply cannot be broken', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 5 <b>x</b> & <i>'), ctx);
    const [, text] = lastReply(ctx);
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &lt;i&gt;');
    expect(text).not.toContain('<b>x</b>');
  });

  it('processes a repeated update id only once and answers only once', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда', { updateId: 55 }), ctx);
    await handleUpdate(textUpdate('/spent 100 еда', { updateId: 55 }), ctx);
    expect(await countOperations(db, 1)).toBe(1);
    expect(ctx.tg.send).toHaveBeenCalledTimes(1);
  });
});

describe('access rules', () => {
  it('ignores group chats and messages without a sender', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 1', { chatType: 'group' }), ctx);
    await handleUpdate({ update_id: 3, message: { chat: { id: 1, type: 'private' }, text: '/help' } }, ctx);
    await handleUpdate({ update_id: 4 }, ctx);
    expect(ctx.tg.send).not.toHaveBeenCalled();
  });

  it('refuses users outside the allowlist', async () => {
    const ctx = makeCtx(db, { allowlist: '999' });
    await handleUpdate(textUpdate('/spent 100'), ctx);
    expect(lastReply(ctx)[1]).toBe('Доступ к боту закрыт.');
    expect(await countOperations(db, 1)).toBe(0);
  });

  it('answers the first 30 messages in a minute and warns once about the rest', async () => {
    const ctx = makeCtx(db);
    for (let i = 1; i <= 33; i++) await handleUpdate(textUpdate('/help', { updateId: i }), ctx);
    expect(ctx.tg.send).toHaveBeenCalledTimes(31);
    expect(lastReply(ctx)[1]).toContain('Слишком много');
  });

  it('hints at /help for unknown commands and plain text', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/nope'), ctx);
    await handleUpdate(textUpdate('просто текст', { updateId: 2 }), ctx);
    expect(ctx.tg.send.mock.calls.map(c => c[1])).toEqual(['Не понял. Список команд: /help', 'Не понял. Список команд: /help']);
  });
});

describe('/undo and /deleteall', () => {
  it('/undo removes the most recently added operation and says what it was', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда', { updateId: 1 }), ctx);
    await handleUpdate(textUpdate('/spent 200 кофе', { updateId: 2 }), ctx);
    await handleUpdate(textUpdate('/undo', { updateId: 3 }), ctx);

    expect((await listOperations(db, 1)).map(o => o.amount)).toEqual([100]);
    expect(lastReply(ctx)[1]).toMatch(/🗑 Удалено: −200 ₽/);
  });

  it('/undo with nothing to undo says so', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/undo'), ctx);
    expect(lastReply(ctx)[1]).toBe('Операций пока нет.');
  });

  it('/deleteall asks first and only deletes after the yes button', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда'), ctx);
    await handleUpdate(textUpdate('/deleteall', { updateId: 2 }), ctx);
    expect(lastReply(ctx)[2].inline_keyboard[0].map(b => b.callback_data)).toEqual(['deleteall:yes', 'deleteall:no']);
    expect(await countOperations(db, 1)).toBe(1);

    await handleUpdate(callbackUpdate('deleteall:no', { updateId: 3 }), ctx);
    expect(await countOperations(db, 1)).toBe(1);

    await handleUpdate(callbackUpdate('deleteall:yes', { updateId: 4 }), ctx);
    expect(await countOperations(db, 1)).toBe(0);
    expect(await getUser(db, 1)).toBeNull();
    expect(lastReply(ctx)[1]).toBe('Все данные удалены.');
  });
});

describe('undo button', () => {
  it('removes exactly that operation, clears the button and is harmless on a second tap', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/spent 100 еда'), ctx);
    const [stored] = await listOperations(db, 1);

    await handleUpdate(callbackUpdate(`undo:${stored.id}`, { updateId: 10, messageId: 5 }), ctx);
    expect(await countOperations(db, 1)).toBe(0);
    expect(ctx.tg.answerCallback).toHaveBeenLastCalledWith('cb10', 'Отменено');
    expect(ctx.tg.clearButtons).toHaveBeenLastCalledWith(1, 5);

    await handleUpdate(callbackUpdate(`undo:${stored.id}`, { updateId: 11 }), ctx);
    expect(ctx.tg.answerCallback).toHaveBeenLastCalledWith('cb11', 'Уже удалено');
  });

  it('cannot delete another user\'s operation', async () => {
    await seedOperation(db, 2, { id: 'theirs', type: 'expense', amount: 5, category: 'Еда', date: '2026-10-10T12:00:00.000Z' });
    const ctx = makeCtx(db);
    await handleUpdate(callbackUpdate('undo:theirs', { userId: 1 }), ctx);
    expect(await countOperations(db, 2)).toBe(1);
    expect(ctx.tg.answerCallback).toHaveBeenLastCalledWith('cb1000', 'Уже удалено');
  });

  it('ignores malformed callback data', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(callbackUpdate('undo:../../x'), ctx);
    await handleUpdate(callbackUpdate('weird'), ctx);
    expect(ctx.tg.answerCallback).toHaveBeenCalledTimes(2);
    expect(ctx.tg.clearButtons).not.toHaveBeenCalled();
  });

  it('refuses users outside the allowlist', async () => {
    const ctx = makeCtx(db, { allowlist: '999' });
    await seedOperation(db, 1, { id: 'mine', type: 'expense', amount: 5, category: 'Еда', date: '2026-10-10T12:00:00.000Z' }, NOW);
    await handleUpdate(callbackUpdate('undo:mine'), ctx);
    expect(await countOperations(db, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/commands.test.js`
Expected: FAIL (`../src/commands.js` не найден).

- [ ] **Step 3: Реализовать**

`worker/src/commands.js`:

```js
import { addOperation, LimitError } from './core.js';
import { deleteAllStatements, deleteOperation, ensureUser, listLastOperations } from './db.js';
import { BOT_RATE_PER_MINUTE, hitRateLimit, isAllowed } from './limits.js';
import {
  addedText, BLOCKED_TEXT, DELETE_CONFIRM_TEXT, DELETED_TEXT, HELP_TEXT, LIMIT_TEXT, NO_OPERATIONS_TEXT,
  RATE_LIMIT_TEXT, STATEMENT_TEXT, UNKNOWN_TEXT, undoneText, usageText, WELCOME_TEXT
} from './messages.js';
import { parseAmountAndText, parseCommand } from './parse.js';
import { appKeyboard, confirmDeleteKeyboard, undoKeyboard } from './telegram.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @typedef {object} Ctx
 * @property {D1Database} db
 * @property {ReturnType<typeof import('./telegram.js').createTelegram>} tg
 * @property {string} appUrl
 * @property {string} [allowlist]
 * @property {number} nowMs
 */

// ----- Команды (ctx дополнен: userId, chatId, updateId, args) -----

const start = async ctx => {
  await ensureUser(ctx.db, ctx.userId, ctx.nowMs);
  await ctx.tg.send(ctx.chatId, WELCOME_TEXT, appKeyboard(ctx.appUrl));
};

const help = ctx => ctx.tg.send(ctx.chatId, HELP_TEXT, appKeyboard(ctx.appUrl));

const statement = ctx => ctx.tg.send(ctx.chatId, STATEMENT_TEXT, appKeyboard(ctx.appUrl));

const addByCommand = (type, command) => async ctx => {
  const parsed = parseAmountAndText(ctx.args);
  if (!parsed.ok) {
    await ctx.tg.send(ctx.chatId, usageText(command, parsed.reason));
    return;
  }
  try {
    const result = await addOperation(ctx.db, ctx.userId, {
      type, amount: parsed.amount, text: parsed.text, updateId: ctx.updateId, nowMs: ctx.nowMs
    });
    if (!result.inserted) return; // повтор того же обновления: уже обработано и отвечено
    await ctx.tg.send(ctx.chatId, addedText(result, result.settings.currency), undoKeyboard(result.operation.id));
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    await ctx.tg.send(ctx.chatId, LIMIT_TEXT);
  }
};

const undo = async ctx => {
  const [last] = await listLastOperations(ctx.db, ctx.userId, 1);
  if (!last) {
    await ctx.tg.send(ctx.chatId, NO_OPERATIONS_TEXT);
    return;
  }
  await deleteOperation(ctx.db, ctx.userId, last.id);
  const { settings } = await ensureUser(ctx.db, ctx.userId, ctx.nowMs);
  await ctx.tg.send(ctx.chatId, undoneText(last, settings.currency));
};

const deleteAll = ctx => ctx.tg.send(ctx.chatId, DELETE_CONFIRM_TEXT, confirmDeleteKeyboard());

const COMMANDS = {
  start,
  help,
  statement,
  spent: addByCommand('expense', 'spent'),
  income: addByCommand('income', 'income'),
  undo,
  deleteall: deleteAll
};

// ----- Нажатия на кнопки -----

async function undoOperation(query, ctx, { userId, chatId, messageId }, operationId) {
  const removed = await deleteOperation(ctx.db, userId, operationId);
  await ctx.tg.answerCallback(query.id, removed ? 'Отменено' : 'Уже удалено');
  await ctx.tg.clearButtons(chatId, messageId);
}

async function answerDeleteAll(query, ctx, { userId, chatId, messageId }, answer) {
  if (answer !== 'yes') {
    await ctx.tg.answerCallback(query.id, 'Отменено');
    await ctx.tg.clearButtons(chatId, messageId);
    return;
  }
  await ctx.db.batch(deleteAllStatements(ctx.db, userId));
  await ctx.tg.answerCallback(query.id, 'Удалено');
  await ctx.tg.clearButtons(chatId, messageId);
  await ctx.tg.send(chatId, DELETED_TEXT);
}

async function handleCallback(query, ctx) {
  const userId = query.from?.id;
  const chatId = query.message?.chat?.id;
  if (!userId || !chatId || !isAllowed(ctx.allowlist, userId)) {
    await ctx.tg.answerCallback(query.id);
    return;
  }
  const limit = await hitRateLimit(ctx.db, userId, 'bot', BOT_RATE_PER_MINUTE, ctx.nowMs);
  if (!limit.allowed) {
    await ctx.tg.answerCallback(query.id, RATE_LIMIT_TEXT);
    return;
  }

  const target = { userId, chatId, messageId: query.message.message_id };
  const [action, argument = ''] = String(query.data || '').split(':');
  if (action === 'undo' && ID_RE.test(argument)) await undoOperation(query, ctx, target, argument);
  else if (action === 'deleteall') await answerDeleteAll(query, ctx, target, argument);
  else await ctx.tg.answerCallback(query.id);
}

// ----- Вход -----

/**
 * Обрабатывает одно обновление Telegram: сообщение с командой или нажатие кнопки.
 * @param {object} update
 * @param {Ctx} ctx
 */
export async function handleUpdate(update, ctx) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, ctx);
    return;
  }
  const message = update.message;
  if (!message || !message.from || message.chat?.type !== 'private') return;

  const userId = message.from.id;
  const chatId = message.chat.id;
  if (!isAllowed(ctx.allowlist, userId)) {
    await ctx.tg.send(chatId, BLOCKED_TEXT);
    return;
  }
  const limit = await hitRateLimit(ctx.db, userId, 'bot', BOT_RATE_PER_MINUTE, ctx.nowMs);
  if (!limit.allowed) {
    // предупреждаем один раз за окно, чтобы бот сам не превращался в источник спама
    if (limit.count === BOT_RATE_PER_MINUTE + 1) await ctx.tg.send(chatId, RATE_LIMIT_TEXT);
    return;
  }

  const command = parseCommand(message.text);
  const handler = command && COMMANDS[command.name];
  if (!handler) {
    await ctx.tg.send(chatId, UNKNOWN_TEXT);
    return;
  }
  await handler({ ...ctx, userId, chatId, updateId: update.update_id, args: command.args });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/commands.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/commands.js worker/test/commands.test.js
git commit -m "feat: команды бота /start, /spent, /income, /undo, /deleteall и кнопки"
```

---

### Task 11: Отчёты в боте — `/balance`, `/month`, `/last` (`reports.js`)

**Files:**
- Create: `worker/src/reports.js`
- Modify: `worker/src/commands.js` (подключить три команды)
- Test: `worker/test/reports.test.js`

**Interfaces:**
- Consumes: `balanceSummary`, `getReport` (core); `ensureUser`, `listLastOperations` (db); `balanceText`, `lastText`, `monthText`, `NO_OPERATIONS_TEXT` (messages); `appKeyboard` (telegram); `monthRange`, `monthTitle`, `todayDate` (format); `handleUpdate` (commands) в тестах.
- Produces: `balanceCommand(ctx)`, `monthCommand(ctx)`, `lastCommand(ctx)` — обработчики с тем же `ctx`, что в Task 10.

- [ ] **Step 1: Написать падающие тесты**

`worker/test/reports.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate } from '../src/commands.js';
import { makeCtx, NOW, resetDb, seedOperation, textUpdate } from './helpers.js';

const db = env.DB;
const lastReply = ctx => ctx.tg.send.mock.calls.at(-1);

async function seedMonth() {
  const ops = [
    { id: 'a', type: 'income', amount: 120000, category: 'Зарплата', date: '2026-10-03T09:00:00.000Z', createdAt: NOW },
    { id: 'b', type: 'expense', amount: 35000, category: 'Жильё', date: '2026-10-05T09:00:00.000Z', createdAt: NOW + 1 },
    { id: 'c', type: 'expense', amount: 5520, category: 'Еда', name: 'Пятёрочка', date: '2026-10-12T09:00:00.000Z', createdAt: NOW + 2 },
    { id: 'd', type: 'income', amount: 15000, category: 'Подработка', date: '2026-09-20T09:00:00.000Z', createdAt: NOW + 3 }
  ];
  for (const op of ops) await seedOperation(db, 1, op);
}

beforeEach(() => resetDb(db));

describe('/balance', () => {
  it('shows the month, the total and the progress to both goals, with the app buttons', async () => {
    await seedMonth();
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/balance'), ctx);

    const [, text, markup] = lastReply(ctx);
    expect(text).toContain('октябрь 2026');
    expect(text).toMatch(/Остаток: 79\D480 ₽/);
    expect(text).toMatch(/Всего накоплено: 94\D480 ₽/);
    expect(text).toMatch(/\(79%\)/);
    expect(text).toMatch(/\(9%\)/);
    expect(markup.inline_keyboard).toHaveLength(2);
  });

  it('works for a user who has no data yet', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/balance'), ctx);
    expect(lastReply(ctx)[1]).toMatch(/Остаток: 0 ₽/);
  });
});

describe('/month', () => {
  it('lists this month\'s expenses by category with shares', async () => {
    await seedMonth();
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/month'), ctx);
    const [, text] = lastReply(ctx);
    expect(text).toMatch(/Всего: 40\D520 ₽/);
    expect(text).toMatch(/Жильё — 35\D000 ₽ \(86%\)/);
    expect(text).toMatch(/Еда — 5\D520 ₽ \(14%\)/);
  });

  it('says so when there are no expenses this month', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/month'), ctx);
    expect(lastReply(ctx)[1]).toBe('Расходов за октябрь 2026 нет.');
  });
});

describe('/last', () => {
  beforeEach(async () => {
    for (let i = 0; i < 7; i++) {
      await seedOperation(db, 1, { id: `op${i}`, type: 'expense', amount: 100 + i, category: 'Еда', date: '2026-10-10T09:00:00.000Z', createdAt: NOW + i });
    }
  });

  const lines = ctx => lastReply(ctx)[1].split('\n').slice(1);

  it('shows the five latest by default, newest first', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last'), ctx);
    expect(lines(ctx)).toHaveLength(5);
    expect(lines(ctx)[0]).toContain('106 ₽');
  });

  it('honours a requested count and caps it at 20', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last 2'), ctx);
    expect(lines(ctx)).toHaveLength(2);
    await handleUpdate(textUpdate('/last 99', { updateId: 2 }), ctx);
    expect(lines(ctx)).toHaveLength(7);
  });

  it('falls back to five for nonsense', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last abc'), ctx);
    expect(lines(ctx)).toHaveLength(5);
    await handleUpdate(textUpdate('/last 0', { updateId: 2 }), ctx);
    expect(lines(ctx)).toHaveLength(5);
  });

  it('says so when there is nothing to show', async () => {
    const ctx = makeCtx(db);
    await handleUpdate(textUpdate('/last', { userId: 99 }), ctx);
    expect(lastReply(ctx)[1]).toBe('Операций пока нет.');
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/reports.test.js`
Expected: FAIL (команды `balance`, `month`, `last` отвечают «Не понял»).

- [ ] **Step 3: Реализовать `reports.js`**

`worker/src/reports.js`:

```js
import { balanceSummary, getReport } from './core.js';
import { ensureUser, listLastOperations } from './db.js';
import { monthRange, monthTitle, todayDate } from './format.js';
import { balanceText, lastText, monthText, NO_OPERATIONS_TEXT } from './messages.js';
import { appKeyboard } from './telegram.js';

const DEFAULT_LAST = 5;
const MAX_LAST = 20;

function parseLimit(args) {
  const requested = Number.parseInt(args, 10);
  return Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LAST) : DEFAULT_LAST;
}

export async function balanceCommand(ctx) {
  const summary = await balanceSummary(ctx.db, ctx.userId, ctx.nowMs);
  await ctx.tg.send(ctx.chatId, balanceText(summary), appKeyboard(ctx.appUrl));
}

export async function monthCommand(ctx) {
  const date = todayDate(ctx.nowMs);
  const { settings } = await ensureUser(ctx.db, ctx.userId, ctx.nowMs);
  const report = await getReport(ctx.db, ctx.userId, monthRange(date));
  await ctx.tg.send(ctx.chatId, monthText(monthTitle(date), report, settings.currency));
}

export async function lastCommand(ctx) {
  const operations = await listLastOperations(ctx.db, ctx.userId, parseLimit(ctx.args));
  if (!operations.length) {
    await ctx.tg.send(ctx.chatId, NO_OPERATIONS_TEXT);
    return;
  }
  const { settings } = await ensureUser(ctx.db, ctx.userId, ctx.nowMs);
  await ctx.tg.send(ctx.chatId, lastText(operations, settings.currency));
}
```

- [ ] **Step 4: Подключить команды в `commands.js`**

В `worker/src/commands.js` добавить импорт после импорта из `./parse.js`:

```js
import { balanceCommand, lastCommand, monthCommand } from './reports.js';
```

и заменить таблицу `COMMANDS`:

```js
const COMMANDS = {
  start,
  help,
  statement,
  spent: addByCommand('expense', 'spent'),
  income: addByCommand('income', 'income'),
  balance: balanceCommand,
  month: monthCommand,
  last: lastCommand,
  undo,
  deleteall: deleteAll
};
```

- [ ] **Step 5: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/reports.test.js test/commands.test.js`
Expected: PASS (новые и прежние).

- [ ] **Step 6: Commit**

```bash
git add worker/src/reports.js worker/src/commands.js worker/test/reports.test.js
git commit -m "feat: команды /balance, /month и /last"
```

---

### Task 12: HTTP-слой — API мини-аппа, webhook, маршрутизация

**Files:**
- Create: `worker/src/http.js`, `worker/src/api.js`, `worker/src/webhook.js`
- Modify: `worker/src/index.js` (заменить заглушку)
- Test: `worker/test/http.test.js`, `worker/test/api.test.js`, `worker/test/webhook.test.js`, `worker/test/index.test.js`

**Interfaces:**
- Consumes: `verifyInitData`, `verifyWebhookSecret` (auth); `validateSync` (validate); `ensureUser`, `countOperations`, `deleteAllStatements`, `listOperations`, `removeStatements`, `saveSettingsStatement`, `upsertStatements`, `purgeProcessedUpdates` (db); `API_RATE_PER_MINUTE`, `MAX_BODY_BYTES`, `MAX_OPERATIONS`, `hitRateLimit`, `isAllowed` (limits); `createTelegram` (telegram); `handleUpdate` (commands).
- Produces:
  - `http.js`: `ok(data, headers?)`, `fail(error, status, headers?)` — ответы вида `{ success, data, error }`; `corsHeaders(request, allowedOrigin)`; `readJson(request, maxBytes): Promise<{ ok: true, value } | { ok: false, status, error }>`.
  - `api.js`: `handleApi(request, config, nowMs?)`, `config = { db, botToken, allowedOrigin, allowlist, maxOperations? }` (`maxOperations` по умолчанию `MAX_OPERATIONS`, нужен тестам лимита). Маршруты: `OPTIONS *` (204), `GET /api/data`, `POST /api/sync`, `DELETE /api/data`.
  - `webhook.js`: `handleWebhook(request, config, ctx, nowMs?)`, `config = { db, botToken, webhookSecret, appUrl, allowlist }`.
  - `index.js`: `export default { fetch(request, env, ctx) }`.

- [ ] **Step 1: Написать падающие тесты**

`worker/test/http.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { corsHeaders, fail, ok, readJson } from '../src/http.js';

const ORIGIN = 'https://example.github.io';
const request = (origin, body, headers = {}) => new Request('https://x.test/api/sync', {
  method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), ...headers }, body
});

describe('response envelope', () => {
  it('ok wraps data', async () => {
    const response = ok({ n: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { n: 1 }, error: null });
  });

  it('fail wraps an error with a status and extra headers', async () => {
    const response = fail('нельзя', 429, { 'Retry-After': '60' });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toEqual({ success: false, data: null, error: 'нельзя' });
  });
});

describe('corsHeaders', () => {
  it('allows only the configured origin', () => {
    const headers = corsHeaders(request(ORIGIN), ORIGIN);
    expect(headers['Access-Control-Allow-Origin']).toBe(ORIGIN);
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(corsHeaders(request('https://evil.example'), ORIGIN)).toEqual({});
    expect(corsHeaders(request(null), ORIGIN)).toEqual({});
  });

  it('never answers with a wildcard, even if no origin is configured', () => {
    expect(corsHeaders(request(ORIGIN), undefined)).toEqual({});
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    expect(await readJson(request(null, '{"a":1}'), 1000)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects broken JSON with 400', async () => {
    expect(await readJson(request(null, '{oops'), 1000)).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a body larger than the limit with 413, by header and by content', async () => {
    expect(await readJson(request(null, 'x', { 'Content-Length': '5000' }), 1000)).toMatchObject({ ok: false, status: 413 });
    expect(await readJson(request(null, JSON.stringify({ a: 'x'.repeat(2000) })), 1000)).toMatchObject({ ok: false, status: 413 });
  });
});
```

`worker/test/api.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../src/api.js';
import { countOperations } from '../src/db.js';
import { initDataFields, NOW, resetDb, signInitData } from './helpers.js';

const db = env.DB;
const TOKEN = 'test-token';
const ORIGIN = 'https://example.github.io';
const config = (overrides = {}) => ({ db, botToken: TOKEN, allowedOrigin: ORIGIN, allowlist: '', ...overrides });
const nowSec = Math.floor(NOW / 1000);

async function call(method, path, { userId = 1, body, headers = {}, cfg = config(), authDate = nowSec } = {}) {
  const auth = `tma ${await signInitData(TOKEN, initDataFields(userId, authDate))}`;
  const request = new Request(`https://api.test${path}`, {
    method,
    headers: { Authorization: auth, Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const response = await handleApi(request, cfg, NOW);
  return { response, json: await response.json().catch(() => null) };
}

const op = (id, overrides = {}) => ({
  id, name: 'Такси', amount: 100, type: 'expense', category: 'Транспорт', date: '2026-10-10T09:00:00.000Z', source: null, ...overrides
});

beforeEach(() => resetDb(db));

describe('authentication and access', () => {
  it('answers 401 without a header, with a bad signature and with expired data', async () => {
    const noHeader = await handleApi(new Request('https://api.test/api/data', { headers: { Origin: ORIGIN } }), config(), NOW);
    expect(noHeader.status).toBe(401);

    const forged = await handleApi(new Request('https://api.test/api/data', { headers: { Authorization: 'tma auth_date=1&hash=00' } }), config(), NOW);
    expect(forged.status).toBe(401);

    const expired = await call('GET', '/api/data', { authDate: nowSec - 2 * 86400 });
    expect(expired.response.status).toBe(401);
  });

  it('answers 403 to users outside the allowlist', async () => {
    const { response } = await call('GET', '/api/data', { cfg: config({ allowlist: '999' }) });
    expect(response.status).toBe(403);
  });

  it('answers 429 once the per-minute limit is used up', async () => {
    const minute = Math.floor(NOW / 60_000);
    await db.prepare("INSERT INTO rate_limits (user_id, scope, minute, count) VALUES (1, 'api', ?, 120)").bind(minute).run();
    const { response } = await call('GET', '/api/data');
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('handles the CORS preflight without authentication', async () => {
    const response = await handleApi(new Request('https://api.test/api/sync', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), config(), NOW);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('adds CORS headers to answers only for the allowed origin', async () => {
    const allowed = await call('GET', '/api/data');
    expect(allowed.response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const foreign = await call('GET', '/api/data', { headers: { Origin: 'https://evil.example' } });
    expect(foreign.response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers 404 for unknown routes', async () => {
    expect((await call('GET', '/api/nope')).response.status).toBe(404);
  });
});

describe('GET /api/data', () => {
  it('creates a new user with defaults and no operations', async () => {
    const { json } = await call('GET', '/api/data');
    expect(json.success).toBe(true);
    expect(json.data.operations).toEqual([]);
    expect(json.data.monthTarget).toBe(100000);
    expect(json.data.settings.currency).toBe('₽');
  });
});

describe('POST /api/sync', () => {
  it('stores operations, settings and the month target, and returns them on the next read', async () => {
    const settings = { goal: 5, goalName: 'Цель', currency: '$', categories: { income: ['Зарплата'], expense: ['Еда'] } };
    const sync = await call('POST', '/api/sync', { body: { upsert: [op('a'), op('b', { amount: 7 })], settings, monthTarget: 150000 } });
    expect(sync.json.data).toEqual({ applied: 2, removed: 0, rejected: [] });

    const { json } = await call('GET', '/api/data');
    expect(json.data.operations.map(o => [o.id, o.amount])).toEqual([['a', 100], ['b', 7]]);
    expect(json.data.monthTarget).toBe(150000);
    expect(json.data.settings).toMatchObject({ goal: 5, currency: '$', categories: { expense: ['Еда'] } });
  });

  it('is idempotent: sending the same change twice leaves one copy', async () => {
    await call('POST', '/api/sync', { body: { upsert: [op('a')] } });
    await call('POST', '/api/sync', { body: { upsert: [op('a', { amount: 250 })] } });
    const { json } = await call('GET', '/api/data');
    expect(json.data.operations).toHaveLength(1);
    expect(json.data.operations[0].amount).toBe(250);
  });

  it('removes operations by id', async () => {
    await call('POST', '/api/sync', { body: { upsert: [op('a'), op('b')] } });
    const { json } = await call('POST', '/api/sync', { body: { remove: ['a'] } });
    expect(json.data.removed).toBe(1);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('keeps the good operations and reports the broken ones', async () => {
    const { json } = await call('POST', '/api/sync', { body: { upsert: [op('good'), op('zero', { amount: 0 }), op('baddate', { date: 'yesterday' })] } });
    expect(json.success).toBe(true);
    expect(json.data.applied).toBe(1);
    expect(json.data.rejected).toEqual([{ id: 'zero', reason: 'bad-amount' }, { id: 'baddate', reason: 'bad-date' }]);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('answers 400 for broken JSON, a bad shape and oversized batches', async () => {
    const broken = await handleApi(new Request('https://api.test/api/sync', {
      method: 'POST', body: '{oops',
      headers: { Authorization: `tma ${await signInitData(TOKEN, initDataFields(1, nowSec))}` }
    }), config(), NOW);
    expect(broken.status).toBe(400);

    expect((await call('POST', '/api/sync', { body: { upsert: 'x' } })).response.status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => op(`id${i}`));
    expect((await call('POST', '/api/sync', { body: { upsert: many } })).response.status).toBe(400);
  });

  it('answers 413 for a body over the size limit', async () => {
    const { response } = await call('POST', '/api/sync', { body: { upsert: [op('a', { name: 'я'.repeat(1_100_000) })] } });
    expect(response.status).toBe(413);
  });

  it('answers 409 when the sync would push the user over the operation limit', async () => {
    const tight = config({ maxOperations: 1 });
    await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('first')] } });
    const { response } = await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('second')] } });
    expect(response.status).toBe(409);
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('still lets a user at the limit swap an operation (remove one, add one)', async () => {
    const tight = config({ maxOperations: 1 });
    await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('first')] } });
    const { response } = await call('POST', '/api/sync', { cfg: tight, body: { upsert: [op('second')], remove: ['first'] } });
    expect(response.status).toBe(200);
    expect(await countOperations(db, 1)).toBe(1);
  });
});

describe('data isolation and deletion', () => {
  it('never shows one user\'s data to another', async () => {
    await call('POST', '/api/sync', { userId: 1, body: { upsert: [op('mine')] } });
    const { json } = await call('GET', '/api/data', { userId: 2 });
    expect(json.data.operations).toEqual([]);
  });

  it('one user cannot remove another user\'s operation', async () => {
    await call('POST', '/api/sync', { userId: 1, body: { upsert: [op('mine')] } });
    await call('POST', '/api/sync', { userId: 2, body: { remove: ['mine'] } });
    expect(await countOperations(db, 1)).toBe(1);
  });

  it('DELETE /api/data wipes the caller\'s data only', async () => {
    await call('POST', '/api/sync', { userId: 1, body: { upsert: [op('a')] } });
    await call('POST', '/api/sync', { userId: 2, body: { upsert: [op('b')] } });
    const { json } = await call('DELETE', '/api/data', { userId: 1 });
    expect(json.data).toEqual({ deleted: true });
    expect(await countOperations(db, 1)).toBe(0);
    expect(await countOperations(db, 2)).toBe(1);
  });
});
```

`worker/test/webhook.test.js`:

```js
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listOperations } from '../src/db.js';
import { handleWebhook } from '../src/webhook.js';
import { NOW, resetDb, textUpdate } from './helpers.js';

const db = env.DB;
const config = (overrides = {}) => ({
  db, botToken: 'test-token', webhookSecret: 'test-secret', appUrl: 'https://example.github.io/money/', allowlist: '', ...overrides
});
const ctx = () => ({ waitUntil: vi.fn() });
const webhookRequest = (body, secret = 'test-secret') => new Request('https://bot.test/telegram/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

let fetchSpy;
beforeEach(async () => {
  await resetDb(db);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
});

describe('handleWebhook', () => {
  it('answers 401 without the secret header and does nothing', async () => {
    const response = await handleWebhook(webhookRequest(textUpdate('/help'), null), config(), ctx(), NOW);
    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 401 for a wrong secret', async () => {
    expect((await handleWebhook(webhookRequest(textUpdate('/help'), 'nope'), config(), ctx(), NOW)).status).toBe(401);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect((await handleWebhook(webhookRequest('{oops'), config(), ctx(), NOW)).status).toBe(400);
  });

  it('runs the command and replies through the Bot API using the configured token', async () => {
    const response = await handleWebhook(webhookRequest(textUpdate('/spent 500 такси')), config(), ctx(), NOW);
    expect(response.status).toBe(200);
    expect(await listOperations(db, 1)).toHaveLength(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(JSON.parse(init.body).text).toContain('✅ Расход 500 ₽');
  });

  it('still answers 200 when Telegram itself is unreachable (the data is already saved)', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async () => { throw new Error('offline'); });
    const response = await handleWebhook(webhookRequest(textUpdate('/spent 500 такси')), config(), ctx(), NOW);
    expect(response.status).toBe(200);
    expect(await listOperations(db, 1)).toHaveLength(1);
    errorLog.mockRestore();
  });
});
```

`worker/test/index.test.js`:

```js
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker routing', () => {
  it('answers 404 for unknown paths', async () => {
    const response = await exports.default.fetch('http://example.com/nope');
    expect(response.status).toBe(404);
  });

  it('rejects a webhook call without the secret', async () => {
    const response = await exports.default.fetch('http://example.com/telegram/webhook', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
  });

  it('answers the CORS preflight for the configured origin', async () => {
    // значение берём из окружения: оно может прийти и из wrangler.toml, и из тестовых привязок
    const response = await exports.default.fetch('http://example.com/api/sync', {
      method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN);
  });

  it('requires Telegram authentication for the API', async () => {
    const response = await exports.default.fetch('http://example.com/api/data');
    expect(response.status).toBe(401);
  });

  it('does not treat GET on the webhook path as a webhook', async () => {
    const response = await exports.default.fetch('http://example.com/telegram/webhook');
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `cd worker && npx vitest run test/http.test.js test/api.test.js test/webhook.test.js test/index.test.js`
Expected: FAIL (модули не найдены).

- [ ] **Step 3: Реализовать `http.js`**

`worker/src/http.js`:

```js
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

const respond = (payload, status, headers) =>
  new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...headers } });

/** @param {unknown} data @param {Record<string, string>} [headers] */
export const ok = (data, headers = {}) => respond({ success: true, data, error: null }, 200, headers);

/** @param {string} error @param {number} status @param {Record<string, string>} [headers] */
export const fail = (error, status, headers = {}) => respond({ success: false, data: null, error }, status, headers);

/** CORS только для сайта на GitHub Pages; без настроенного адреса и для чужих адресов заголовков нет. */
export function corsHeaders(request, allowedOrigin) {
  const origin = request.headers.get('Origin');
  if (!allowedOrigin || origin !== allowedOrigin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Читает JSON-тело с ограничением размера.
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, status: number, error: string }>}
 */
export async function readJson(request, maxBytes) {
  const tooLarge = { ok: false, status: 413, error: 'Слишком большой запрос' };
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) return tooLarge;
  const text = await request.text();
  if (text.length > maxBytes) return tooLarge;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'Некорректный JSON' };
  }
}
```

- [ ] **Step 4: Реализовать `api.js`**

`worker/src/api.js`:

```js
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
```

- [ ] **Step 5: Реализовать `webhook.js` и `index.js`**

`worker/src/webhook.js`:

```js
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
```

`worker/src/index.js` (заменить заглушку):

```js
import { handleApi } from './api.js';
import { handleWebhook } from './webhook.js';

function configFrom(env) {
  return {
    db: env.DB,
    botToken: env.BOT_TOKEN,
    webhookSecret: env.WEBHOOK_SECRET,
    appUrl: env.APP_URL,
    allowedOrigin: env.ALLOWED_ORIGIN,
    allowlist: env.ALLOWLIST
  };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/telegram/webhook' && request.method === 'POST') {
        return await handleWebhook(request, configFrom(env), ctx);
      }
      if (pathname.startsWith('/api/')) return await handleApi(request, configFrom(env));
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Необработанная ошибка', error);
      return new Response('Internal error', { status: 500 });
    }
  }
};
```

- [ ] **Step 6: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run`
Expected: PASS (все тесты воркера).

- [ ] **Step 7: Commit**

```bash
git add worker/src/http.js worker/src/api.js worker/src/webhook.js worker/src/index.js worker/test/http.test.js worker/test/api.test.js worker/test/webhook.test.js worker/test/index.test.js
git commit -m "feat: API мини-аппа, webhook Telegram и маршрутизация Worker"
```

---

### Task 13: Настройка бота в Telegram (`setup.js`, `scripts/setup-telegram.js`)

**Files:**
- Create: `worker/src/setup.js`, `worker/scripts/setup-telegram.js`
- Test: `worker/test/setup.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `COMMAND_MENU: { command: string, description: string }[]`
  - `buildSetupRequests({ workerUrl, appUrl, secret }): { method: string, payload: object }[]` — запросы `setWebhook`, `setMyCommands`, `setChatMenuButton`; бросает `Error` при неверном секрете или адресах.
  - Скрипт `npm run setup:telegram` (читает `BOT_TOKEN`, `WORKER_URL`, `WEBHOOK_SECRET`, `APP_URL` из переменных окружения; токен не печатает).

- [ ] **Step 1: Написать падающие тесты**

`worker/test/setup.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildSetupRequests, COMMAND_MENU } from '../src/setup.js';

const input = { workerUrl: 'https://money-bot.example.workers.dev/', appUrl: 'https://example.github.io/money/', secret: 'abc_DEF-123' };

describe('buildSetupRequests', () => {
  it('registers the webhook with the secret, without a double slash', () => {
    const [webhook] = buildSetupRequests(input);
    expect(webhook).toEqual({
      method: 'setWebhook',
      payload: {
        url: 'https://money-bot.example.workers.dev/telegram/webhook',
        secret_token: 'abc_DEF-123',
        allowed_updates: ['message', 'callback_query']
      }
    });
  });

  it('publishes the command menu and the Web App menu button', () => {
    const [, commands, menu] = buildSetupRequests(input);
    expect(commands).toEqual({ method: 'setMyCommands', payload: { commands: COMMAND_MENU } });
    expect(menu).toEqual({
      method: 'setChatMenuButton',
      payload: { menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: 'https://example.github.io/money/' } } }
    });
  });

  it('the command menu covers every bot command with a Russian description', () => {
    expect(COMMAND_MENU.map(c => c.command)).toEqual(['spent', 'income', 'balance', 'month', 'last', 'undo', 'statement', 'deleteall', 'help']);
    for (const { command, description } of COMMAND_MENU) {
      expect(command).toMatch(/^[a-z_]{1,32}$/);
      expect(description.length).toBeGreaterThan(3);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  it.each([
    [{ ...input, secret: '' }],
    [{ ...input, secret: 'has space' }],
    [{ ...input, secret: 'x'.repeat(257) }],
    [{ ...input, workerUrl: 'http://insecure.example' }],
    [{ ...input, appUrl: 'not a url' }]
  ])('refuses unusable input %j', bad => {
    expect(() => buildSetupRequests(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `cd worker && npx vitest run test/setup.test.js`
Expected: FAIL (`../src/setup.js` не найден).

- [ ] **Step 3: Реализовать `setup.js`**

`worker/src/setup.js`:

```js
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
```

- [ ] **Step 4: Создать запускающий скрипт**

`worker/scripts/setup-telegram.js`:

```js
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
```

- [ ] **Step 5: Запустить тесты — должны пройти**

Run: `cd worker && npx vitest run test/setup.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/setup.js worker/scripts/setup-telegram.js worker/test/setup.test.js
git commit -m "feat: скрипт первичной настройки бота (webhook, меню команд, кнопка)"
```

---

### Task 14: Чистая логика синхронизации мини-аппа (`js/sync-core.js`)

**Files:**
- Create: `js/sync-core.js`, `tests/sync-core.test.js`

**Interfaces:**
- Consumes: ничего (чистые функции, без DOM и сети).
- Produces (глобально в браузере и через `module.exports` в Node):
  - `stableStringify(value): string` — JSON с отсортированными ключами
  - `syncableSettings(settings): object` — настройки без `theme`
  - `makeSnapshot(operations, settings, monthTarget): Snapshot`, где `Snapshot = { ops: { [id]: string }, settings: string, monthTarget: number }`
  - `computeDiff(snapshot, operations, settings, monthTarget): { upsert: Operation[], remove: string[], settings?: object, monthTarget?: number }`
  - `isEmptyDiff(diff): boolean`
  - `splitDiff(diff, size = 100): { upsert, remove, settings?, monthTarget? }[]` — первая порция несёт настройки и цель месяца
  - `applyToSnapshot(snapshot, payload): Snapshot`
  - `mergeFirstRun(local, server, defaults): { operations, settings, monthTarget }`
  - Константа `SYNC_CHUNK = 100`.

- [ ] **Step 1: Написать падающие тесты**

`tests/sync-core.test.js` (запуск встроенным раннером Node, без зависимостей):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyToSnapshot, computeDiff, isEmptyDiff, makeSnapshot, mergeFirstRun, splitDiff, stableStringify, syncableSettings, SYNC_CHUNK
} = require('../js/sync-core.js');

const op = (id, overrides = {}) => ({
  id, name: 'Такси', amount: 100, type: 'expense', category: 'Транспорт', date: '2026-10-10T09:00:00.000Z', ...overrides
});
const settings = (overrides = {}) => ({
  goal: 1000000, goalName: 'Цель', currency: '₽', theme: 'dark', categories: { income: ['Зарплата'], expense: ['Еда'] }, ...overrides
});

test('stableStringify ignores key order, including nested keys', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('syncableSettings drops the per-device theme', () => {
  assert.deepEqual(syncableSettings(settings({ theme: 'light' })), syncableSettings(settings({ theme: 'dark' })));
  assert.equal('theme' in syncableSettings(settings()), false);
});

test('an unchanged state produces an empty diff', () => {
  const snapshot = makeSnapshot([op('a')], settings(), 100000);
  assert.equal(isEmptyDiff(computeDiff(snapshot, [op('a')], settings(), 100000)), true);
});

test('a theme change alone is not a diff', () => {
  const snapshot = makeSnapshot([], settings({ theme: 'dark' }), 100000);
  assert.equal(isEmptyDiff(computeDiff(snapshot, [], settings({ theme: 'light' }), 100000)), true);
});

test('new, edited and deleted operations are detected', () => {
  const snapshot = makeSnapshot([op('keep'), op('edit'), op('gone')], settings(), 100000);
  const diff = computeDiff(snapshot, [op('keep'), op('edit', { amount: 999 }), op('new')], settings(), 100000);
  assert.deepEqual(diff.upsert.map(o => o.id).sort(), ['edit', 'new']);
  assert.deepEqual(diff.remove, ['gone']);
  assert.equal(diff.settings, undefined);
  assert.equal(diff.monthTarget, undefined);
});

test('settings and month target changes are detected', () => {
  const snapshot = makeSnapshot([], settings(), 100000);
  const diff = computeDiff(snapshot, [], settings({ goal: 5 }), 150000);
  assert.equal(diff.settings.goal, 5);
  assert.equal('theme' in diff.settings, false);
  assert.equal(diff.monthTarget, 150000);
});

test('splitDiff cuts upserts and removals into chunks and puts settings only in the first', () => {
  const upsert = Array.from({ length: 250 }, (_, i) => op(`u${i}`));
  const remove = Array.from({ length: 120 }, (_, i) => `r${i}`);
  const payloads = splitDiff({ upsert, remove, settings: { goal: 1 }, monthTarget: 7 });

  assert.equal(SYNC_CHUNK, 100);
  assert.equal(payloads.length, 3);
  assert.deepEqual(payloads[0].settings, { goal: 1 });
  assert.equal(payloads[0].monthTarget, 7);
  assert.equal(payloads[1].settings, undefined);
  for (const payload of payloads) {
    assert.ok(payload.upsert.length <= 100);
    assert.ok(payload.remove.length <= 100);
  }
  assert.equal(payloads.flatMap(p => p.upsert).length, 250);
  assert.equal(payloads.flatMap(p => p.remove).length, 120);
});

test('splitDiff of an empty diff is empty, of a settings-only diff is one payload', () => {
  assert.deepEqual(splitDiff({ upsert: [], remove: [] }), []);
  assert.equal(splitDiff({ upsert: [], remove: [], monthTarget: 5 }).length, 1);
});

test('applying every payload to the snapshot leaves nothing to send', () => {
  const local = Array.from({ length: 230 }, (_, i) => op(`id${i}`));
  let snapshot = makeSnapshot([], settings(), 100000);
  const diff = computeDiff(snapshot, local, settings({ goal: 5 }), 150000);
  for (const payload of splitDiff(diff)) snapshot = applyToSnapshot(snapshot, payload);
  assert.equal(isEmptyDiff(computeDiff(snapshot, local, settings({ goal: 5 }), 150000)), true);
});

test('an interrupted upload resumes with only the part that did not go through', () => {
  const local = Array.from({ length: 250 }, (_, i) => op(`id${i}`));
  let snapshot = makeSnapshot([], settings(), 100000);
  const [first, second] = splitDiff(computeDiff(snapshot, local, settings(), 100000));
  snapshot = applyToSnapshot(snapshot, first);
  snapshot = applyToSnapshot(snapshot, second); // третья порция «не дошла»

  const rest = computeDiff(snapshot, local, settings(), 100000);
  assert.equal(rest.upsert.length, 50);
  assert.equal(rest.remove.length, 0);
});

test('applyToSnapshot does not mutate the snapshot it was given', () => {
  const snapshot = makeSnapshot([op('a')], settings(), 100000);
  const copy = JSON.stringify(snapshot);
  applyToSnapshot(snapshot, { upsert: [op('b')], remove: ['a'] });
  assert.equal(JSON.stringify(snapshot), copy);
});

const defaults = { settings: syncableSettings(settings()), monthTarget: 100000 };

test('first run: server operations plus the local ones the server does not know', () => {
  const server = { operations: [op('s1'), op('shared', { amount: 1 })], settings: syncableSettings(settings()), monthTarget: 100000 };
  const local = { operations: [op('shared', { amount: 2 }), op('l1')], settings: syncableSettings(settings({ goal: 5 })), monthTarget: 150000 };
  const merged = mergeFirstRun(local, server, defaults);

  assert.deepEqual(merged.operations.map(o => o.id), ['s1', 'shared', 'l1']);
  assert.equal(merged.operations.find(o => o.id === 'shared').amount, 1, 'the server copy wins for the same id');
});

test('first run: default server settings give way to the local ones, customised ones win', () => {
  const localSettings = syncableSettings(settings({ goal: 5 }));
  const fresh = mergeFirstRun(
    { operations: [], settings: localSettings, monthTarget: 150000 },
    { operations: [], settings: defaults.settings, monthTarget: 100000 }, defaults
  );
  assert.deepEqual(fresh.settings, localSettings);
  assert.equal(fresh.monthTarget, 150000);

  const customServer = syncableSettings(settings({ goal: 9 }));
  const kept = mergeFirstRun(
    { operations: [], settings: localSettings, monthTarget: 150000 },
    { operations: [], settings: customServer, monthTarget: 200000 }, defaults
  );
  assert.deepEqual(kept.settings, customServer);
  assert.equal(kept.monthTarget, 200000);
});
```

- [ ] **Step 2: Запустить тесты — должны упасть**

Run: `node --test tests/`
Expected: FAIL (`Cannot find module '../js/sync-core.js'`).

- [ ] **Step 3: Реализовать**

`js/sync-core.js`:

```js
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
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `node --test tests/`
Expected: PASS (все тесты).

- [ ] **Step 5: Commit**

```bash
git add js/sync-core.js tests/sync-core.test.js
git commit -m "feat: чистая логика синхронизации мини-аппа (снимок, разница, пачки, первая миграция)"
```

---

### Task 15: Сетевая обвязка и вход по кнопке «Добавить выписку» в мини-аппе

**Files:**
- Create: `js/config.js`, `js/api.js`
- Modify: `js/telegram.js` (заменить файл целиком), `js/script.js` (убрать `updatedAt`), `js/import.js` (окно по `?action=import`), `index.html` (подключение скриптов, окно «Выберите файл»)

**Interfaces:**
- Consumes: из `sync-core.js` — `computeDiff`, `splitDiff`, `makeSnapshot`, `applyToSnapshot`, `isEmptyDiff`, `mergeFirstRun`, `syncableSettings`; из `script.js` — глобальные `operations`, `settings`, `lastSaved`, `getMonthTarget`, `DEFAULT_SETTINGS`, `applyTheme`, `updateCategories`, `render`, `toast`, `$`; из `telegram.js` — `tg`, `inTelegram`.
- Produces: глобальный `window.MONEY_CONFIG = { apiUrl }`; поведение: внутри Telegram при заданном `apiUrl` мини-апп синхронизируется с сервером; по `?action=import` открывается окно «Загрузить выписку» с кнопкой «Выберите файл».

В этой задаче нет автоматических тестов браузерного кода (в проекте нет такой инфраструктуры); логика вынесена в `sync-core.js` и покрыта в Task 14. Проверка: синтаксис, проверка окна импорта в headless-браузере и ручной чек-лист в Task 16.

- [ ] **Step 1: Создать `js/config.js`**

```js
// Адрес сервера синхронизации (Cloudflare Worker), без завершающего «/».
// Пусто — синхронизация выключена, приложение работает локально, как раньше.
window.MONEY_CONFIG = { apiUrl: '' };
```

- [ ] **Step 2: Заменить `js/telegram.js` целиком**

Облачная синхронизация через CloudStorage уходит; остаются тема, полный экран и вибро-отклик.

```js
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
```

- [ ] **Step 3: Убрать `updatedAt` из `save()` в `js/script.js`**

Заменить в `js/script.js`:

```js
  // Первый вызов при загрузке — не изменение, просто запоминаем состояние
  if (lastSaved) {
    localStorage.setItem('updatedAt', Date.now());
    document.dispatchEvent(new Event('money:changed'));
  }
```

на:

```js
  // Первый вызов при загрузке — не изменение, просто запоминаем состояние
  if (lastSaved) document.dispatchEvent(new Event('money:changed'));
```

- [ ] **Step 4: Создать `js/api.js`**

```js
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
```

- [ ] **Step 5: Окно «Выберите файл» по `?action=import` в `index.html`**

Добавить перед `<div id="toast"` в `index.html`:

```html
  <!-- Вход по кнопке «Добавить выписку» из чата Telegram: сразу предлагаем выбрать файл -->
  <dialog id="importPrompt">
    <div class="settings">
      <h2>Загрузить выписку</h2>
      <p class="muted">Подойдут CSV, Excel и PDF из банка. Перед сохранением вы увидите предпросмотр операций.</p>
      <button type="button" class="btn-primary" id="importPromptChoose">Выберите файл</button>
      <button type="button" id="importPromptCancel">Отмена</button>
    </div>
  </dialog>
```

Заменить блок скриптов в конце `index.html`:

```html
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="js/script.js"></script>
  <script src="js/import.js"></script>
  <script src="js/telegram.js"></script>
```

на:

```html
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="js/script.js"></script>
  <script src="js/import.js"></script>
  <script src="js/telegram.js"></script>
  <script src="js/sync-core.js"></script>
  <script src="js/config.js"></script>
  <script src="js/api.js"></script>
```

- [ ] **Step 6: Открывать окно по `?action=import` в `js/import.js`**

Дописать в конец `js/import.js`:

```js

// Вход по кнопке «Добавить выписку» из чата бота: адрес с ?action=import.
// Выбор файла нельзя открыть без касания, поэтому показываем окно с кнопкой «Выберите файл».
$('importPromptChoose').onclick = () => {
  $('importPrompt').close();
  $('statementInput').click();
};
$('importPromptCancel').onclick = () => $('importPrompt').close();

if (new URLSearchParams(location.search).get('action') === 'import') {
  // убираем параметр, чтобы обновление страницы не открывало окно снова (hash с данными Telegram сохраняем)
  history.replaceState(null, '', location.pathname + location.hash);
  $('importPrompt').showModal();
}
```

- [ ] **Step 7: Проверить синтаксис и тесты логики**

Run: `for f in js/script.js js/import.js js/telegram.js js/sync-core.js js/config.js js/api.js; do node --check "$f" && echo "OK $f"; done && node --test tests/`
Expected: `OK` для каждого файла и PASS всех тестов `tests/`.

- [ ] **Step 8: Проверить окно импорта в headless-браузере**

Run:

```bash
E="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
mkdir -p "$TEMP/money-profile"
"$E" --headless=new --disable-gpu --user-data-dir="$TEMP/money-profile" --virtual-time-budget=4000 --dump-dom "file:///c:/Users/Раксана/Documents/GitHub/money/index.html?action=import" 2>/dev/null | grep -o '<dialog id="importPrompt"[^>]*>'
```

Expected: вывод содержит `<dialog id="importPrompt" open="">` (окно открыто). Для контроля без параметра (`index.html` без `?action=import`) окно открытым быть не должно: `grep -c 'id="importPrompt" open'` даёт `0`.

- [ ] **Step 9: Commit**

```bash
git add js/config.js js/api.js js/telegram.js js/script.js js/import.js index.html
git commit -m "feat: синхронизация мини-аппа с сервером и вход «Добавить выписку» по кнопке из чата"
```

---

### Task 16: Документация, развёртывание, правка спеки и финальная проверка

**Files:**
- Create: `worker/README.md`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-14-telegram-bot-backend-design.md`, `worker/wrangler.toml` (настоящий id базы), `js/config.js` (адрес Worker)
- Требует участия пользователя: аккаунт Cloudflare, токен бота, ввод секретов (шаги 4–8).

**Interfaces:**
- Consumes: всё, что сделано в Task 1–15.
- Produces: работающий бот и мини-апп с синхронизацией; обновлённая спека.

- [ ] **Step 1: Создать `worker/README.md`**

````markdown
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
````

- [ ] **Step 2: Обновить `README.md` в корне**

Заменить строку:

```
- Работает как Telegram Mini App: тема Telegram, вибро-отклик, синхронизация данных между устройствами через Telegram CloudStorage
```

на:

```
- Работает как Telegram Mini App: тема Telegram, вибро-отклик, синхронизация данных между устройствами через сервер
- Telegram-бот: `/spent 500 такси`, `/income 50000 зарплата`, `/balance`, `/month`, `/last`, `/undo`, кнопка «📥 Добавить выписку» (см. `worker/README.md`)
```

- [ ] **Step 3: Обновить спеку по принятым отклонениям**

В `docs/superpowers/specs/2026-10-14-telegram-bot-backend-design.md` выполнить замены (каждая строка должна совпасть точно; перед правкой прочитать файл):

1. Таблицу `rate_limits` в разделе 4: заменить

```
CREATE TABLE rate_limits (user_id INTEGER NOT NULL, minute INTEGER NOT NULL,
                          count INTEGER NOT NULL, PRIMARY KEY (user_id, minute));
```

на

```
CREATE TABLE rate_limits (user_id INTEGER NOT NULL, scope TEXT NOT NULL, minute INTEGER NOT NULL,
                          count INTEGER NOT NULL, PRIMARY KEY (user_id, scope, minute));
```

2. В разделе 6 заменить абзац «**Проверки входных данных** …» на:

```
**Проверки входных данных** (на сервере, всегда): `type` из двух значений; `amount` в допустимых пределах; `date` по шаблону ISO; `id` из букв, цифр, `_` и `-` до 64 символов; в `upsert` и в `remove` не более 100 элементов за запрос (у D1 лимит 100 параметров на запрос и ограничено число запросов за вызов); в списке категорий не более 50 штук; тело запроса не больше 1 МБ. Тексты усекаются (`name` до 200, `category` до 40 символов), а не отвергаются. Структурная ошибка (не объект, не списки, слишком много элементов, неверные настройки) даёт ответ 400 с понятным текстом. Отдельная испорченная операция пропускается и возвращается в списке `rejected` ответа, остальные сохраняются: одна неверная запись из ручного JSON-импорта не должна блокировать синхронизацию навсегда.
```

3. В разделе 7 заменить пункт «**Лимиты:** …» на:

```
- **Лимиты:** бот 30 сообщений в минуту на пользователя, API 120 запросов в минуту (раздельные счётчики; первая миграция данных требует много запросов), до 20 000 операций на пользователя, до 100 операций в одном `sync`. При превышении: понятное сообщение, операция не выполняется.
```

4. В разделе 8 заменить «загружаются пачками по 500» на «загружаются пачками по 100», а в начало пункта «**Изменения:**» добавить предложение: «Снимок сервера хранится в `localStorage`, поэтому изменения, сделанные без сети, переживают перезапуск; тема (`theme`) не синхронизируется и остаётся настройкой устройства.»

5. В разделе 12 добавить пункт:

```
- **Бесплатный тариф Workers** даёт 10 мс процессорного времени на запрос; выдача 20 000 операций одним `GET /api/data` может его превысить. Тогда нужен платный тариф или `ALLOWLIST`.
```

6. Строку «Статус: черновик на утверждение.» заменить на «Статус: утверждена, реализуется по плану `docs/superpowers/plans/2026-10-14-telegram-bot-backend.md`.»

- [ ] **Step 4: Прогнать все тесты и покрытие**

Run: `cd worker && npx vitest run --coverage && cd .. && node --test tests/`
Expected: все тесты проходят; в сводке покрытия `Statements` не ниже 80%. Если ниже — дописать тесты на непокрытые ветки (смотреть таблицу `Uncovered Line #s`) до достижения порога.

- [ ] **Step 5: Ревью кода и безопасности**

Запустить агента `ecc:code-reviewer` на всех изменениях ветки и `ecc:security-reviewer` на `worker/src/auth.js`, `worker/src/api.js`, `worker/src/webhook.js`, `worker/src/validate.js`, `worker/src/db.js` (авторизация, ввод пользователя, запросы к базе, внешние API). Исправить все замечания уровней CRITICAL и HIGH, MEDIUM — по возможности; результат ревью пересказать пользователю.

- [ ] **Step 6: Закоммитить документацию и правки спеки**

```bash
git add worker/README.md README.md docs/superpowers/specs/2026-10-14-telegram-bot-backend-design.md
git commit -m "docs: развёртывание бота и обновление спеки по итогам планирования"
```

- [ ] **Step 7: Развёртывание Worker (участвует пользователь)**

Выполнить шаги из раздела «Первичное развёртывание» `worker/README.md`: `wrangler login`, `d1 create` (записать настоящий `database_id` в `worker/wrangler.toml`), `d1 migrations apply --remote`, `secret put BOT_TOKEN`, `secret put WEBHOOK_SECRET` (**значения вводит сам пользователь**; их нельзя выводить в чат, печатать и записывать в файлы), `wrangler deploy`. Записать выданный адрес Worker.

Проверка адреса сайта: `APP_URL` и `ALLOWED_ORIGIN` в `worker/wrangler.toml` выведены из адреса репозитория (`https://nnabiev3.github.io/money/`); сверить с настройками GitHub Pages и при расхождении поправить.

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://<адрес-worker>/api/data`
Expected: `401` (сервер отвечает и требует авторизации).

- [ ] **Step 8: Подключить мини-апп и настроить бота**

1. Вписать адрес Worker в `js/config.js` (`apiUrl: 'https://money-bot.<аккаунт>.workers.dev'`).
2. Выполнить `npm run setup:telegram` с переменными окружения (см. `worker/README.md`), убедиться, что три запроса вернули `ok`.
3. Закоммитить `js/config.js` и `worker/wrangler.toml`:

```bash
git add js/config.js worker/wrangler.toml
git commit -m "chore: подключение развёрнутого Worker (адрес API и id базы)"
```

4. **Запушить `main`** только после явного разрешения пользователя (он ранее сказал «пока рано»); после пуша GitHub Pages обновится за минуту-две.

- [ ] **Step 9: Ручная проверка в Telegram (чек-лист)**

После пуша закрыть и заново открыть мини-апп (Telegram кэширует страницу):

1. `/start` → приветствие и две кнопки; `/help` тоже с кнопками.
2. `/spent 500 такси` → «✅ Расход 500 ₽ · Транспорт · такси», кнопка «↩️ Отменить» убирает операцию.
3. `/income 50000 зарплата` → «✅ Доход …».
4. `/balance`, `/month`, `/last`, `/undo` → данные совпадают с мини-аппом.
5. Открыть мини-апп: операции из бота видны; добавить операцию в аппе, вернуться в чат, `/last` её показывает.
6. Первая миграция: старые данные (из `localStorage`) появились на сервере и не задвоились после повторного запуска.
7. Кнопка «📥 Добавить выписку» в чате → мини-апп открывается на окне «Загрузить выписку»; нажать «Выберите файл» — открывается выбор файла. **Если выбор файла не открывается:** это прежняя нерешённая проблема из начала работы (гипотеза про `accept` не подтвердилась); сообщить пользователю и вернуться к диагностике отдельно.
8. Работа без сети: выключить интернет, добавить операцию в аппе (виден тост про связь), включить и убедиться, что операция дошла до сервера (`/last` в боте).
9. Если вход на сервер не проходит (в консоли ответ 401 при корректном токене), проверить подпись `initData` (поле `signature` входит в строку проверки по документации Telegram).

- [ ] **Step 10: Итог**

Сообщить пользователю: что работает, что проверено автоматически (число тестов, покрытие), что проверено вручную в Telegram, что осталось (известные ограничения из начала плана). Предложить `git push`, если ещё не сделан.
