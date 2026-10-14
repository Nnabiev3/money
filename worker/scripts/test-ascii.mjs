// Запуск тестов из ASCII-копии проекта.
// Рантайм workerd не стартует на Windows, если путь к проекту содержит не-ASCII символы
// (например, кириллицу в имени пользователя). Если путь «чистый», тесты идут на месте.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const isAscii = [...root].every(char => char.charCodeAt(0) < 128);
const mirror = process.env.MIRROR_DIR || 'C:/money-bot-test';
const skip = new Set(['node_modules', '.wrangler', 'coverage']);
const run = (command, args, cwd) => spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });

let cwd = root;
if (!isAscii) {
  mkdirSync(mirror, { recursive: true });
  for (const entry of readdirSync(root).filter(name => !skip.has(name))) {
    cpSync(path.join(root, entry), path.join(mirror, entry), { recursive: true });
  }
  if (!existsSync(path.join(mirror, 'node_modules'))) run('npm', ['install'], mirror);
  cwd = mirror;
}

const result = run('npx', ['vitest', 'run', ...process.argv.slice(2)], cwd);
process.exit(result.status ?? 1);
