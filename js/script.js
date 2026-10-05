// ===== Хранилище =====
const DEFAULT_SETTINGS = {
  goal: 1000000,
  goalName: 'Главная цель',
  currency: '₽',
  theme: 'dark',
  categories: {
    income: ['Зарплата', 'Подработка', 'Подарки', 'Прочее'],
    expense: ['Жильё', 'Еда', 'Транспорт', 'Здоровье', 'Развлечения', 'Покупки', 'Прочее']
  }
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

let operations = load('operations', []);
let settings = { ...DEFAULT_SETTINGS, ...load('settings', {}) };
settings.categories = { ...DEFAULT_SETTINGS.categories, ...settings.categories };

// Миграция старых данных: операции без id/даты
operations.forEach((op, i) => {
  if (!op.id) op.id = Date.now().toString(36) + i;
  if (!op.date) op.date = new Date().toISOString();
  const cats = settings.categories[op.type];
  if (cats && op.category && !cats.includes(op.category)) cats.push(op.category);
});

function getMonthTarget() {
  return Number(localStorage.getItem('monthTarget')) || 100000;
}

function save() {
  localStorage.setItem('operations', JSON.stringify(operations));
  localStorage.setItem('settings', JSON.stringify(settings));
}

// ===== Утилиты =====
const $ = id => document.getElementById(id);
const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const money = n => `${Math.round(n).toLocaleString('ru-RU')} ${settings.currency}`;
const monthKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const sum = arr => arr.reduce((s, op) => s + op.amount, 0);
const today = () => { const d = new Date(); return monthKey(d) + '-' + String(d.getDate()).padStart(2, '0'); };

function plural(n, forms) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function colorFor(type, cat) {
  const idx = settings.categories[type].indexOf(cat);
  return PALETTE[(idx >= 0 ? idx : settings.categories[type].length) % PALETTE.length];
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// ===== Период =====
let period = 'all';

function fillPeriods() {
  const sel = $('periodSelect');
  const keys = new Set(operations.map(op => op.date.slice(0, 7)));
  keys.add(monthKey(new Date()));
  const sorted = [...keys].sort().reverse();
  sel.innerHTML = '<option value="all">За всё время</option>' +
    sorted.map(k => {
      const [y, m] = k.split('-');
      return `<option value="${k}">${MONTHS[m - 1]} ${y}</option>`;
    }).join('');
  sel.value = sorted.includes(period) || period === 'all' ? period : 'all';
}

const inPeriod = () => period === 'all' ? operations : operations.filter(op => op.date.startsWith(period));

// ===== Рендер =====
function render() {
  save();
  fillPeriods();
  const ops = inPeriod();
  renderKpi(ops);
  renderGoals();
  renderBarChart();
  renderDonut('expense', ops);
  renderDonut('income', ops);
  renderList(ops);
}

function renderKpi(ops) {
  const inc = ops.filter(o => o.type === 'income');
  const exp = ops.filter(o => o.type === 'expense');
  const income = sum(inc), expense = sum(exp), balance = income - expense;

  $('totalIncome').textContent = money(income);
  $('totalExpense').textContent = money(expense);
  $('balance').textContent = money(balance);
  $('balance').style.color = balance < 0 ? 'var(--red)' : '';
  $('savingsRate').textContent = (income > 0 ? Math.round(balance / income * 100) : 0) + '%';
  $('incomeCount').textContent = `${inc.length} ${plural(inc.length, ['операция', 'операции', 'операций'])}`;
  $('expenseCount').textContent = `${exp.length} ${plural(exp.length, ['операция', 'операции', 'операций'])}`;
}

function renderGoals() {
  const total = sum(operations.filter(o => o.type === 'income')) - sum(operations.filter(o => o.type === 'expense'));
  const pct = settings.goal > 0 ? Math.max(0, Math.min(total / settings.goal * 100, 100)) : 0;
  $('goalTitle').textContent = settings.goalName;
  $('progressFill').style.width = pct + '%';
  $('goalPercent').textContent = pct.toFixed(1) + '%';
  $('progressText').textContent = `${money(total)} из ${money(settings.goal)}`;

  const now = new Date();
  const key = monthKey(now);
  const mOps = operations.filter(o => o.date.startsWith(key));
  const saved = sum(mOps.filter(o => o.type === 'income')) - sum(mOps.filter(o => o.type === 'expense'));
  const target = getMonthTarget();
  const mPct = target > 0 ? Math.max(0, Math.min(saved / target * 100, 100)) : 0;
  $('currentMonth').textContent = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  $('monthProgressFill').style.width = mPct + '%';
  $('monthPercent').textContent = mPct.toFixed(1) + '%';
  $('monthProgressText').textContent = `${money(saved)} из ${money(target)}`;
}

function renderBarChart() {
  const box = $('barChart');
  box.innerHTML = '';

  // Последние 6 месяцев
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKey(d);
    const mOps = operations.filter(o => o.date.startsWith(k));
    const income = sum(mOps.filter(o => o.type === 'income'));
    const expense = sum(mOps.filter(o => o.type === 'expense'));
    months.push({ label: MONTHS_SHORT[d.getMonth()], income, expense, balance: income - expense });
  }

  const W = 720, H = 260, P = { t: 16, r: 16, b: 32, l: 56 };
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense, m.balance]));
  const min = Math.min(0, ...months.map(m => m.balance));
  const y = v => P.t + (max - v) / (max - min) * (H - P.t - P.b);
  const step = (W - P.l - P.r) / months.length;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'bar-svg' });

  // Сетка
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4;
    s.append(svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid-line' }));
    const t = svg('text', { x: P.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
    t.textContent = Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v);
    s.append(t);
  }

  const bw = Math.min(22, step / 3.2);
  const points = [];
  months.forEach((m, i) => {
    const cx = P.l + step * i + step / 2;
    [['income', 'var(--green)', -bw / 2 - 2], ['expense', 'var(--red)', bw / 2 + 2]].forEach(([k, c, off]) => {
      const top = y(Math.max(m[k], 0)), base = y(0);
      const r = svg('rect', { x: cx + off - bw / 2, y: top, width: bw, height: Math.max(base - top, 0), rx: 5, fill: c, class: 'bar' });
      const title = svg('title');
      title.textContent = `${m.label}: ${k === 'income' ? 'доход' : 'расход'} ${money(m[k])}`;
      r.append(title);
      s.append(r);
    });
    points.push([cx, y(m.balance)]);
    const t = svg('text', { x: cx, y: H - 10, class: 'axis', 'text-anchor': 'middle' });
    t.textContent = m.label;
    s.append(t);
  });

  s.append(svg('polyline', { points: points.map(p => p.join(',')).join(' '), class: 'balance-line' }));
  points.forEach(([px, py], i) => {
    const c = svg('circle', { cx: px, cy: py, r: 4, class: 'balance-dot' });
    const title = svg('title');
    title.textContent = `${months[i].label}: остаток ${money(months[i].balance)}`;
    c.append(title);
    s.append(c);
  });

  box.append(s);
}

function renderDonut(type, ops) {
  const box = $(type + 'Donut');
  const list = $(type + 'ByCategory');
  box.innerHTML = '';
  list.innerHTML = '';

  const grouped = {};
  ops.filter(o => o.type === type).forEach(o => {
    const c = o.category || 'Без категории';
    grouped[c] = (grouped[c] || 0) + o.amount;
  });
  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);

  const R = 70, C = 2 * Math.PI * R;
  const s = svg('svg', { viewBox: '0 0 180 180' });
  s.append(svg('circle', { cx: 90, cy: 90, r: R, class: 'donut-track' }));

  let offset = 0;
  entries.forEach(([cat, val]) => {
    const len = val / total * C;
    const seg = svg('circle', {
      cx: 90, cy: 90, r: R, fill: 'none', stroke: colorFor(type, cat), 'stroke-width': 22,
      'stroke-dasharray': `${Math.max(len - 2, 0.5)} ${C}`, 'stroke-dashoffset': -offset,
      transform: 'rotate(-90 90 90)', class: 'donut-seg'
    });
    const title = svg('title');
    title.textContent = `${cat}: ${money(val)}`;
    seg.append(title);
    s.append(seg);
    offset += len;
  });

  const t1 = svg('text', { x: 90, y: 86, class: 'donut-total', 'text-anchor': 'middle' });
  t1.textContent = total >= 1e6 ? (total / 1e6).toFixed(1) + 'M' : total >= 1e4 ? Math.round(total / 1000) + 'k' : Math.round(total);
  const t2 = svg('text', { x: 90, y: 106, class: 'donut-sub', 'text-anchor': 'middle' });
  t2.textContent = settings.currency;
  s.append(t1, t2);
  box.append(s);

  if (!entries.length) {
    list.innerHTML = '<li class="empty">Нет данных за период</li>';
    return;
  }
  entries.forEach(([cat, val]) => {
    const li = document.createElement('li');
    const pct = (val / total * 100).toFixed(0);
    li.innerHTML = `<i style="background:${colorFor(type, cat)}"></i><span class="cat-name"></span><span class="cat-pct">${pct}%</span><b>${money(val)}</b>`;
    li.querySelector('.cat-name').textContent = cat;
    list.append(li);
  });
}

function renderList(ops) {
  const list = $('list');
  list.innerHTML = '';
  const q = $('searchInput').value.trim().toLowerCase();
  const ft = $('filterType').value;

  const shown = ops
    .filter(o => ft === 'all' || o.type === ft)
    .filter(o => !q || o.name.toLowerCase().includes(q) || (o.category || '').toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!shown.length) {
    list.innerHTML = `<li class="empty">${operations.length ? 'Ничего не найдено' : 'Пока нет операций. Добавь первую 👆'}</li>`;
    return;
  }

  shown.forEach(op => {
    const li = document.createElement('li');
    const color = colorFor(op.type, op.category);
    const d = new Date(op.date);
    li.innerHTML = `
      <span class="op-icon" style="background:${color}22;color:${color}">${(op.category || '?')[0]}</span>
      <div class="op-info"><b class="op-name"></b><small class="op-meta"></small></div>
      <span class="op-amount ${op.type}">${op.type === 'income' ? '+' : '−'}${money(op.amount)}</span>
      <button class="del-btn" title="Удалить">✕</button>`;
    li.querySelector('.op-name').textContent = op.name;
    li.querySelector('.op-meta').textContent = `${op.category || 'Без категории'} · ${d.toLocaleDateString('ru-RU')}`;
    li.querySelector('.del-btn').onclick = () => {
      operations = operations.filter(o => o.id !== op.id);
      render();
      toast('Операция удалена');
    };
    list.append(li);
  });
}

// ===== Форма =====
const currentType = () => document.querySelector('input[name="opType"]:checked').value;

function updateCategories() {
  const sel = $('opCategory');
  sel.innerHTML = '';
  settings.categories[currentType()].forEach(cat => {
    const o = document.createElement('option');
    o.value = o.textContent = cat;
    sel.append(o);
  });
}

$('opForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('opName').value.trim();
  const amount = Number($('opAmount').value);
  if (!name || !(amount > 0)) {
    toast('Заполни название и сумму больше 0');
    return;
  }
  const dateVal = $('opDate').value || today();
  const date = new Date(dateVal + 'T12:00:00').toISOString();
  operations.push({ id: Date.now().toString(36), name, amount, type: currentType(), category: $('opCategory').value, date });
  $('opName').value = '';
  $('opAmount').value = '';
  $('opName').focus();
  render();
  toast('Операция добавлена ✓');
});

document.querySelectorAll('input[name="opType"]').forEach(r => r.addEventListener('change', updateCategories));
$('searchInput').addEventListener('input', () => renderList(inPeriod()));
$('filterType').addEventListener('change', () => renderList(inPeriod()));
$('periodSelect').addEventListener('change', e => { period = e.target.value; render(); });

// ===== Тема =====
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}
$('themeBtn').onclick = () => {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  save();
};

// ===== Настройки =====
function renderTags() {
  ['income', 'expense'].forEach(type => {
    const box = $(type + 'Tags');
    box.innerHTML = '';
    settings.categories[type].forEach(cat => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.style.borderColor = colorFor(type, cat);
      tag.textContent = cat;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.onclick = () => {
        if (settings.categories[type].length <= 1) return toast('Нужна хотя бы одна категория');
        settings.categories[type] = settings.categories[type].filter(c => c !== cat);
        renderTags(); updateCategories(); render();
      };
      tag.append(x);
      box.append(tag);
    });
  });
}

document.querySelectorAll('[data-add]').forEach(btn => {
  btn.onclick = () => {
    const type = btn.dataset.add;
    const input = $(type === 'income' ? 'newIncomeCat' : 'newExpenseCat');
    const val = input.value.trim();
    if (!val || settings.categories[type].includes(val)) return;
    settings.categories[type].push(val);
    input.value = '';
    renderTags(); updateCategories(); render();
  };
});

$('settingsBtn').onclick = () => {
  $('setGoalName').value = settings.goalName;
  $('setGoal').value = settings.goal;
  $('monthTargetInput').value = getMonthTarget();
  $('setCurrency').value = settings.currency;
  renderTags();
  $('settingsDialog').showModal();
};

$('setGoalName').oninput = e => { settings.goalName = e.target.value || 'Главная цель'; render(); };
$('setGoal').oninput = e => { const v = Number(e.target.value); if (v >= 0) { settings.goal = v; render(); } };
$('setCurrency').onchange = e => { settings.currency = e.target.value; render(); };
$('monthTargetInput').oninput = e => {
  const v = Number(e.target.value);
  if (v >= 0) { localStorage.setItem('monthTarget', v); render(); }
};

$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ operations, settings, monthTarget: getMonthTarget() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `money-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$('importInput').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.operations)) throw new Error();
    operations = data.operations;
    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (data.monthTarget) localStorage.setItem('monthTarget', data.monthTarget);
    applyTheme(); updateCategories(); renderTags(); render();
    toast('Данные импортированы ✓');
  } catch (e) {
    toast('Неверный файл');
  }
  e.target.value = '';
};

$('clearBtn').onclick = () => {
  const btn = $('clearBtn');
  if (!btn.dataset.confirm) {
    btn.dataset.confirm = '1';
    btn.textContent = 'Точно? Нажми ещё раз';
    setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'Удалить все данные'; }, 3000);
    return;
  }
  operations = [];
  render();
  $('settingsDialog').close();
  toast('Все операции удалены');
};

// ===== Старт =====
$('opDate').value = today();
applyTheme();
updateCategories();
render();
