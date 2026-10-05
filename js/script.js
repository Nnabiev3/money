const operations = JSON.parse(localStorage.getItem('operations') || '[]');

const CATEGORIES = {
  income: ['Такси', 'Сайты', 'Прочее'],
  expense: ['Ипотека', 'Еда', 'Транспорт', 'Развлечения', 'Прочее']
};

const addBtn = document.getElementById('addBtn');
const opName = document.getElementById('opName');
const opAmount = document.getElementById('opAmount');
const opType = document.getElementById('opType');
const list = document.getElementById('list');

const GOAL = 1_000_000;

function save() {
  localStorage.setItem('operations', JSON.stringify(operations));
}

function updateCategories() {
  const type = opType.value;
  const categories = CATEGORIES[type];

  opCategory.innerHTML = '';

  categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    opCategory.appendChild(option);
  });
}

const opCategory = document.getElementById('opCategory');

function render() {
  list.innerHTML = '';

  if (operations.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Пока нет операций. Добавь первую.';
    empty.style.color = 'var(--text-muted)';
    empty.style.justifyContent = 'center';
    list.appendChild(empty);
    updateSummary();
    save();
		renderCategories();
    return;
  }

  operations.forEach((op, index) => {
    const li = document.createElement('li');

    const info = document.createElement('span');
    info.textContent = `${op.name} — ${op.amount.toLocaleString('ru-RU')} ₽ (${op.type === 'income' ? 'доход' : 'расход'} · ${op.category || 'без категории'})`;
    info.style.color = op.type === 'income' ? 'var(--green)' : 'var(--red)';

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Удалить';
    delBtn.onclick = () => {
      operations.splice(index, 1);
      render();
    };

    li.appendChild(info);
    li.appendChild(delBtn);
    list.appendChild(li);
  });

  updateSummary();
  save();
	renderCategories();
}

function updateSummary() {
  const income = operations
    .filter(op => op.type === 'income')
    .reduce((sum, op) => sum + op.amount, 0);

  const expense = operations
    .filter(op => op.type === 'expense')
    .reduce((sum, op) => sum + op.amount, 0);

  const balance = income - expense;
  const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0;

  document.getElementById('totalIncome').textContent = income.toLocaleString('ru-RU');
  document.getElementById('totalExpense').textContent = expense.toLocaleString('ru-RU');
  document.getElementById('balance').textContent = balance.toLocaleString('ru-RU');
  document.getElementById('savingsRate').textContent = savingsRate;

  const percent = Math.min((balance / GOAL) * 100, 100);
  document.getElementById('progressFill').style.width = percent + '%';
  document.getElementById('progressText').textContent =
    `${balance.toLocaleString('ru-RU')} ₽ / ${GOAL.toLocaleString('ru-RU')} ₽ (${percent.toFixed(1)}%)`;

  const balanceEl = document.getElementById('balance');
  balanceEl.style.color = balance < 0 ? 'var(--red)' : 'var(--green)';
}

addBtn.onclick = () => {
  const name = opName.value.trim();
  const amount = Number(opAmount.value);
  const type = opType.value;

  if (!name || !amount || amount <= 0) {
    alert('Заполни название и сумму (больше 0)');
    return;
  }

  const category = opCategory.value;
operations.push({ name, amount, type, category });

  opName.value = '';
  opAmount.value = '';
  opName.focus();

  render();
};

function renderCategories() {
  const incomeList = document.getElementById('incomeByCategory');
  const expenseList = document.getElementById('expenseByCategory');

  incomeList.innerHTML = '';
  expenseList.innerHTML = '';

  const grouped = { income: {}, expense: {} };

  operations.forEach(op => {
    const cat = op.category || 'Без категории';
    if (!grouped[op.type][cat]) {
      grouped[op.type][cat] = 0;
    }
    grouped[op.type][cat] += op.amount;
  });

  const fillList = (listEl, data) => {
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'cat-empty';
      li.textContent = 'Нет операций';
      listEl.appendChild(li);
      return;
    }

    entries.forEach(([cat, sum]) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.textContent = cat;

      const value = document.createElement('span');
      value.textContent = sum.toLocaleString('ru-RU') + ' ₽';

      li.appendChild(name);
      li.appendChild(value);
      listEl.appendChild(li);
    });
  };

  fillList(incomeList, grouped.income);
  fillList(expenseList, grouped.expense);
}

opAmount.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
});

opType.addEventListener('change', updateCategories);

render();
updateCategories();