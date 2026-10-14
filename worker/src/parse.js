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
