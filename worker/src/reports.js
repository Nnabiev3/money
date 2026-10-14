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
