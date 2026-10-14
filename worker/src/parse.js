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

const FREE_TEXT_MAX_LENGTH = 120;
// Число в любом месте фразы: необязательный знак, сумма, необязательная валюта («р», «руб», «₽»)
const FREE_NUMBER_RE = /(?<![\p{L}\d.,])([+\-−]?)(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d+))?(\s?(?:р\.?|руб\.?|рубл(?:ь|я|ей)|₽)(?![\p{L}]))?/giu;
const BEFORE_MARKER_RE = /(?:^|\s)(?:на|за)\s*$/iu;
const AFTER_MARKER_RE = /^\s*(?:на|за)(?=\s|$)/iu;
const FILLER_VERBS_RE = /(?<![\p{L}])(?:потратил[аи]?|заплатил[аи]?|отдал[аи]?|купил[аи]?|ушло|получил[аи]?|пришл[аои]|заработал[аи]?)(?![\p{L}])/giu;
const INCOME_WORDS_RE = /(?<![\p{L}])(?:получил[аи]?|пришл[аои]|заработал[аи]?|зарплат\p{L}*|аванс\p{L}*|доход\p{L}*|подработк\p{L}*|премию|премия|кэшб\p{L}*|подарил\p{L}*|перевели)(?![\p{L}])/iu;
const EAT_VERB_ONLY_RE = /^(?:покуш\p{L}*|поел\p{L}*|пообедал\p{L}*|позавтракал\p{L}*|поужинал\p{L}*|перекусил\p{L}*)$/iu;
const FOOD_CATEGORY = 'Еда';

/**
 * Разбирает обычную фразу вроде «200 такси», «покушал на 300» или «+5000 зарплата».
 * По умолчанию это расход; доходом считается фраза со знаком «+» или словами о доходе.
 * Если чисел несколько, берётся число после «на»/«за», с валютой или со знаком; иначе просим уточнить.
 * @param {string | undefined} message
 * @returns {{ ok: true, type: 'income' | 'expense', amount: number, text: string }
 *   | { ok: false, reason: 'format' | 'ambiguous' | 'decimals' | 'positive' | 'too_big' }}
 */
export function parseFreeText(message) {
  const source = (message || '').trim();
  if (!source || source.length > FREE_TEXT_MAX_LENGTH) return { ok: false, reason: 'format' };

  const candidates = [...source.matchAll(FREE_NUMBER_RE)];
  if (candidates.length === 0) return { ok: false, reason: 'format' };

  const isMarked = match =>
    Boolean(match[1] || match[4]) || BEFORE_MARKER_RE.test(source.slice(0, match.index + match[1].length));
  const marked = candidates.filter(isMarked);
  const chosen = candidates.length === 1 ? candidates[0] : marked.length === 1 ? marked[0] : null;
  if (!chosen) return { ok: false, reason: 'ambiguous' };

  const amountText = `${chosen[2]}${chosen[3] ? `.${chosen[3]}` : ''}`;
  const amount = parseAmountAndText(amountText);
  if (!amount.ok) return amount;

  const before = source.slice(0, chosen.index).replace(BEFORE_MARKER_RE, ' ');
  const after = source.slice(chosen.index + chosen[0].length).replace(AFTER_MARKER_RE, ' ');
  const text = `${before} ${after}`
    .replace(FILLER_VERBS_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;!-]+|[\s,.:;!-]+$/gu, '');

  const type = chosen[1] === '+' || INCOME_WORDS_RE.test(source) ? 'income' : 'expense';
  return { ok: true, type, amount: amount.amount, text: type === 'expense' && EAT_VERB_ONLY_RE.test(text) ? FOOD_CATEGORY : text };
}
