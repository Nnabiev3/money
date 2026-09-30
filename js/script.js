const operations = JSON.parse(localStorage.getItem('operations') || '[]');

function save() {
  localStorage.setItem('operations', JSON.stringify(operations));
}

function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';

  if (operations.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Пока нет операций. Добавь первую.';
    empty.style.color = 'var(--text-muted)';
    empty.style.justifyContent = 'center';
    list.appendChild(empty);
    updateSummary();
    save();
    return;
  }

  operations.forEach((op, index) => {
    const li = document.createElement('li');

    const info = document.createElement('span');
    info.textContent = `${op.name} — ${op.amount.toLocaleString('ru-RU')} ₽ (${op.type === 'income' ? 'доход' : 'расход'})`;
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
}

const GOAL = 1_000_000;

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

  operations.push({ name, amount, type });

  opName.value = '';
  opAmount.value = '';
  opName.focus();

  render();
};

opAmount.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
})