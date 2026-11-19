// 月明細：切換月份，列出該月所有紀錄，可依類型與分類篩選，顯示該月收入、支出、結餘小計

import { initPage, formatAmount, handleApiError } from './common.js';
import { listCategories, listRecords } from './airtable.js';

const TYPE_LABELS = { Income: '收入', Expense: '支出' };

const monthInput = document.getElementById('monthInput');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const typeFilter = document.getElementById('typeFilter');
const categoryFilter = document.getElementById('categoryFilter');
const loadingEl = document.getElementById('loading');
const recordListEl = document.getElementById('recordList');
const emptyMessageEl = document.getElementById('emptyMessage');
const sumIncomeEl = document.getElementById('sumIncome');
const sumExpenseEl = document.getElementById('sumExpense');
const sumBalanceEl = document.getElementById('sumBalance');

const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

let categories = [];
let categoryNames = new Map(); // 分類記錄 ID → 名稱（含已停用的分類）
let records = [];
let currentMonth = '';
let loadSeq = 0; // 避免快速切換月份時，舊的回應覆蓋新的畫面

// ---------- 月份 ----------

function currentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 月份加減，month 格式為 YYYY-MM
function shiftMonth(month, offset) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isValidMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '');
}

// ---------- 畫面 ----------

function renderSummary() {
  let income = 0;
  let expense = 0;
  for (const record of records) {
    if (record.type === 'Income') {
      income += record.amount;
    } else if (record.type === 'Expense') {
      expense += record.amount;
    }
  }
  const balance = income - expense;
  sumIncomeEl.textContent = formatAmount(income);
  sumExpenseEl.textContent = formatAmount(expense);
  sumBalanceEl.textContent = formatAmount(balance);
  sumBalanceEl.classList.toggle('text-danger', balance < 0);
}

// 分類篩選的選項：選了類型就只列該類型；全部類型時加註類型，避免同名分類混淆
function renderCategoryFilter() {
  const type = typeFilter.value;
  const previous = categoryFilter.value;
  const options = categories
    .filter((c) => !type || c.type === type)
    .sort((a, b) => {
      // 先依類型分組（收入在前），再依 SortOrder
      if (a.type !== b.type) {
        return a.type === 'Income' ? -1 : 1;
      }
      return a.sortOrder - b.sortOrder;
    });

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = '全部分類';
  categoryFilter.replaceChildren(allOption, ...options.map((c) => {
    const option = document.createElement('option');
    option.value = c.id;
    option.textContent = type ? c.name : `${c.name}（${TYPE_LABELS[c.type]}）`;
    return option;
  }));
  categoryFilter.value = options.some((c) => c.id === previous) ? previous : '';
}

function createRecordItem(record) {
  const item = document.createElement('a');
  item.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-start gap-3';
  item.href = `./record.html?id=${encodeURIComponent(record.id)}`;

  const left = document.createElement('div');
  left.className = 'min-w-0';
  const title = document.createElement('div');
  title.textContent = categoryNames.get(record.categoryId) ?? '（未分類）';
  const detail = document.createElement('div');
  detail.className = 'small text-secondary text-break';
  const [year, month, day] = record.date.split('-').map(Number);
  const parts = [dateFormatter.format(new Date(year, month - 1, day))];
  if (record.paymentMethod) {
    parts.push(record.paymentMethod);
  }
  if (record.note) {
    parts.push(record.note);
  }
  detail.textContent = parts.join(' · ');
  left.append(title, detail);

  const amount = document.createElement('div');
  const isIncome = record.type === 'Income';
  amount.className = `fw-bold text-nowrap ${isIncome ? 'text-success' : 'text-danger'}`;
  amount.textContent = `${isIncome ? '+' : '-'}${formatAmount(record.amount)}`;

  item.append(left, amount);
  return item;
}

function renderList() {
  const type = typeFilter.value;
  const categoryId = categoryFilter.value;
  const filtered = records.filter(
    (r) => (!type || r.type === type) && (!categoryId || r.categoryId === categoryId),
  );

  recordListEl.replaceChildren(...filtered.map(createRecordItem));
  if (filtered.length === 0) {
    emptyMessageEl.textContent = records.length === 0 ? '本月尚無紀錄' : '沒有符合條件的紀錄';
  }
  emptyMessageEl.classList.toggle('d-none', filtered.length > 0);
}

// ---------- 載入 ----------

async function loadMonth(month) {
  currentMonth = month;
  monthInput.value = month;
  history.replaceState(null, '', `?month=${month}`);

  const seq = ++loadSeq;
  loadingEl.classList.remove('d-none');
  recordListEl.replaceChildren();
  emptyMessageEl.classList.add('d-none');

  try {
    const loaded = await listRecords(month);
    if (seq !== loadSeq) {
      return;
    }
    records = loaded;
    renderSummary();
    renderList();
  } catch (error) {
    if (seq === loadSeq) {
      handleApiError(error);
    }
  } finally {
    if (seq === loadSeq) {
      loadingEl.classList.add('d-none');
    }
  }
}

// ---------- 事件 ----------

prevMonthBtn.addEventListener('click', () => loadMonth(shiftMonth(currentMonth, -1)));
nextMonthBtn.addEventListener('click', () => loadMonth(shiftMonth(currentMonth, 1)));

monthInput.addEventListener('change', () => {
  if (isValidMonth(monthInput.value)) {
    loadMonth(monthInput.value);
  } else {
    monthInput.value = currentMonth; // 清空或格式不符時，還原成目前月份
  }
});

typeFilter.addEventListener('change', () => {
  renderCategoryFilter();
  renderList();
});

categoryFilter.addEventListener('change', renderList);

// ---------- 初始化 ----------

async function init() {
  const queryMonth = new URLSearchParams(location.search).get('month');
  const month = isValidMonth(queryMonth) ? queryMonth : currentMonthString();

  try {
    categories = await listCategories();
    categoryNames = new Map(categories.map((c) => [c.id, c.name]));
    renderCategoryFilter();
  } catch (error) {
    loadingEl.classList.add('d-none');
    handleApiError(error);
    return;
  }
  await loadMonth(month);
}

if (initPage('list')) {
  init();
}
