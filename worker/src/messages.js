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
