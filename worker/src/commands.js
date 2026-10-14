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
