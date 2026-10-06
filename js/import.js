// ===== Импорт банковских выписок (CSV / Excel / PDF) =====
// Т-Банк — CSV/XLSX, Яндекс Банк и Озон Банк — PDF. Разбор эвристический:
// перед сохранением пользователь видит предпросмотр и может всё поправить.

const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку. Проверь интернет.'));
    document.head.append(s);
  });
}

// ----- Автокатегории -----
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

const OWN_TRANSFER = /между своими|сво(й|его|ими) сч[её]т|собственн|внутренн.*перевод|перевод.*на (накопит|вклад)|пополнение (накопит|вклада|копилк)|с накопит/i;

function guessCategory(type, text) {
  for (const [cat, re] of RULES[type]) if (re.test(text)) return cat;
  return settings.categories[type].includes('Прочее') ? 'Прочее' : settings.categories[type][0];
}

// ----- Разбор значений -----
const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DATE_RE = /(\d{2})\.(\d{2})\.(\d{2,4})|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*\s+(\d{4})/i;
const AMOUNT_RE = /([+\-−–]\s?)?(\d{1,3}(?:[\s  ]\d{3})+|\d+)([.,]\d{1,2})?\s*(₽|руб\.?|rub|р\.)?/gi;

function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const m = String(v).match(DATE_RE);
  if (!m) return null;
  if (m[1]) return new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), m[2] - 1, +m[1], 12);
  if (m[4]) return new Date(+m[4], m[5] - 1, +m[6], 12);
  const mon = MONTH_NAMES.findIndex(p => m[8].toLowerCase().startsWith(p));
  return new Date(+m[9], mon, +m[7], 12);
}

function parseAmount(v) {
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[\s  ]/g, '').replace(/[−–]/g, '-').replace(',', '.').replace(/[^\d.+-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ----- Таблицы (CSV / XLSX) -----
function decodeText(buf) {
  const utf = new TextDecoder('utf-8').decode(buf);
  return utf.includes('�') ? new TextDecoder('windows-1251').decode(buf) : utf;
}

function parseCSV(text) {
  const firstLine = text.split(/\r?\n/)[0];
  const sep = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

function rowsToOps(rows) {
  const headerIdx = rows.findIndex(r => r.some(c => /дата/i.test(c)) && r.some(c => /сумма|приход|расход|списан|зачисл/i.test(c)));
  if (headerIdx < 0) throw new Error('Не нашёл в файле колонки «Дата» и «Сумма»');
  const head = rows[headerIdx].map(c => String(c).trim().toLowerCase());
  const col = (...res) => {
    for (const re of res) { const i = head.findIndex(h => re.test(h)); if (i >= 0) return i; }
    return -1;
  };
  const cDate = col(/дата операции/, /^дата$/, /дата/);
  const cAmount = col(/сумма платежа/, /сумма в валюте (счета|карты)/, /сумма операции$/, /^сумма/, /сумма/);
  const cIn = col(/приход|зачислен|поступлен|кредит/);
  const cOut = col(/расход|списан|дебет/);
  const cDesc = col(/описание/, /назначение/, /контрагент|получатель|отправитель/, /детали|комментар/);
  const cCat = col(/категория/);
  const cStatus = col(/статус/);

  const ops = [];
  rows.slice(headerIdx + 1).forEach(r => {
    if (cStatus >= 0 && /fail|отклон|отмен/i.test(r[cStatus])) return;
    const date = parseDate(r[cDate]);
    if (!date) return;
    let amount = null;
    if (cAmount >= 0) amount = parseAmount(r[cAmount]);
    if ((amount === null || amount === 0) && (cIn >= 0 || cOut >= 0)) {
      const inc = parseAmount(r[cIn]) || 0, out = parseAmount(r[cOut]) || 0;
      amount = inc ? Math.abs(inc) : -Math.abs(out);
    }
    if (!amount) return;
    const desc = [r[cDesc], r[cCat]].filter(Boolean).join(' ').trim();
    ops.push({ date, amount, desc: String(r[cDesc] || r[cCat] || '').trim(), hint: desc });
  });
  return ops;
}

// ----- PDF -----
async function pdfLines(buf) {
  await loadScript(LIBS.pdf);
  // Воркер с другого домена браузер не запустит — подключаем его скриптом,
  // тогда pdf.js работает в основном потоке (для выписок этого достаточно)
  await loadScript(LIBS.pdfWorker);
  pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const byY = new Map();
    items.forEach(it => {
      if (!it.str.trim()) return;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(it);
    });
    [...byY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => {
      lines.push(its.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str.trim()).join(' '));
    });
  }
  return lines;
}

function linesToOps(lines) {
  // Группируем строки в блоки: новый блок начинается со строки, где есть дата
  const blocks = [];
  lines.forEach(l => {
    if (DATE_RE.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
  });

  const ops = [];
  blocks.forEach(block => {
    const first = block[0];
    if (/период|выписк|остаток на|баланс на|итого|сформирован|дата\s+(операции|списания)/i.test(first)) return;
    const date = parseDate(first);
    const text = block.slice(0, 3).join(' ');
    const clean = text.replace(new RegExp(DATE_RE.source, 'gi'), ' ').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');

    // Берём сумму с явным знаком или валютой, иначе — с копейками
    const amounts = [...clean.matchAll(AMOUNT_RE)].filter(m => m[1] || m[3] || m[4]);
    if (!date || !amounts.length) return;
    const pick = amounts.find(m => m[1]) || amounts.find(m => m[4]) || amounts[0];
    let amount = parseAmount((pick[1] || '') + pick[2] + (pick[3] || ''));
    if (!amount) return;
    const isIncome = /^\s*\+/.test(pick[1] || '') || /зачислен|пополнен|поступлен|возврат|кэшб|cashback|процент|входящ|получен/i.test(clean);
    if (!pick[1]) amount = isIncome ? Math.abs(amount) : -Math.abs(amount);

    const desc = clean.replace(AMOUNT_RE, ' ').replace(/[*•|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    ops.push({ date, amount, desc, hint: clean });
  });
  return ops;
}

// ----- Общая точка входа -----
async function parseStatement(file) {
  const buf = await file.arrayBuffer();
  const ext = file.name.split('.').pop().toLowerCase();
  let raw;
  if (ext === 'pdf') {
    raw = linesToOps(await pdfLines(buf));
  } else if (ext === 'xlsx' || ext === 'xls') {
    await loadScript(LIBS.xlsx);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    raw = rowsToOps(rows);
  } else {
    raw = rowsToOps(parseCSV(decodeText(buf)));
  }
  if (!raw.length) throw new Error('Не нашёл операций в файле');

  const existing = new Set(operations.map(importKey));
  return raw.map(r => {
    const type = r.amount > 0 ? 'income' : 'expense';
    const op = {
      name: (r.desc || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      amount: Math.round(Math.abs(r.amount) * 100) / 100,
      type,
      category: guessCategory(type, r.hint),
      date: r.date.toISOString(),
      source: file.name
    };
    if (!op.name) op.name = op.category;
    op.duplicate = existing.has(importKey(op));
    op.own = OWN_TRANSFER.test(r.hint);
    op.checked = !op.duplicate && !op.own;
    return op;
  });
}

function importKey(op) {
  const d = new Date(op.date);
  return [monthKey(d), d.getDate(), op.type, op.amount, (op.name || '').toLowerCase().replace(/\s+/g, '').slice(0, 20)].join('|');
}

// ----- Предпросмотр -----
let pending = [];

function renderPreview() {
  const list = $('importList');
  list.innerHTML = '';
  pending.forEach((op, i) => {
    const li = document.createElement('li');
    li.className = op.checked ? '' : 'off';
    const cats = [...new Set([...settings.categories[op.type], op.category])];
    li.innerHTML = `
      <input type="checkbox" ${op.checked ? 'checked' : ''}>
      <div class="imp-info">
        <b class="imp-name"></b>
        <small>${new Date(op.date).toLocaleDateString('ru-RU')}${op.duplicate ? ' · <em>уже есть</em>' : ''}${op.own ? ' · <em>свой перевод</em>' : ''}</small>
      </div>
      <select class="imp-cat">${cats.map(c => `<option${c === op.category ? ' selected' : ''}></option>`).join('')}</select>
      <span class="op-amount ${op.type}">${op.type === 'income' ? '+' : '−'}${money(op.amount)}</span>`;
    li.querySelector('.imp-name').textContent = op.name;
    li.querySelectorAll('option').forEach((o, j) => { o.value = o.textContent = cats[j]; });
    li.querySelector('input').onchange = e => { op.checked = e.target.checked; renderPreview(); };
    li.querySelector('select').onchange = e => { op.category = e.target.value; };
    list.append(li);
  });
  const n = pending.filter(o => o.checked).length;
  const skipped = pending.filter(o => o.duplicate).length;
  $('importSummary').textContent = `Найдено операций: ${pending.length}` + (skipped ? ` · дублей пропущено: ${skipped}` : '');
  $('importConfirm').textContent = `Импортировать ${n}`;
  $('importConfirm').disabled = !n;
}

async function importFile(file) {
  toast('Читаю выписку…');
  try {
    pending = await parseStatement(file);
    $('importFileName').textContent = file.name;
    renderPreview();
    if (!$('importDialog').open) $('importDialog').showModal();
  } catch (err) {
    toast(err.message || 'Не удалось прочитать файл');
  }
}

$('statementInput').onchange = e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importFile(file);
};

$('importAll').onclick = () => {
  const allOn = pending.every(o => o.checked);
  pending.forEach(o => { o.checked = !allOn; });
  renderPreview();
};

$('importCancel').onclick = () => { pending = []; $('importDialog').close(); };

$('importConfirm').onclick = () => {
  const chosen = pending.filter(o => o.checked);
  chosen.forEach((o, i) => {
    if (!settings.categories[o.type].includes(o.category)) settings.categories[o.type].push(o.category);
    operations.push({ id: Date.now().toString(36) + i, name: o.name, amount: o.amount, type: o.type, category: o.category, date: o.date, source: o.source });
  });
  pending = [];
  $('importDialog').close();
  updateCategories();
  render();
  toast(`Импортировано операций: ${chosen.length} ✓`);
};
