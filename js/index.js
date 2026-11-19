// 首頁：本月收入、支出、結餘，以及最近 10 筆紀錄

import { initPage, formatAmount, handleApiError } from './common.js';
import { listCategories, listRecords, listRecentRecords } from './airtable.js';

const RECENT_COUNT = 10;

const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');
const monthLabelEl = document.getElementById('monthLabel');
const sumIncomeEl = document.getElementById('sumIncome');
const sumExpenseEl = document.getElementById('sumExpense');
const sumBalanceEl = document.getElementById('sumBalance');
const recentListEl = document.getElementById('recentList');
const emptyMessageEl = document.getElementById('emptyMessage');
const monthLinkEl = document.getElementById('monthLink');

const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});
const monthFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' });

function renderSummary(monthRecords) {
  let income = 0;
  let expense = 0;
  for (const record of monthRecords) {
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

function createRecordItem(record, categoryNames) {
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

async function init() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    // 三個請求同時送出：分類（取名稱）、本月紀錄（算小計）、最近紀錄
    const [categories, monthRecords, recentRecords] = await Promise.all([
      listCategories(),
      listRecords(month),
      listRecentRecords(RECENT_COUNT),
    ]);
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

    monthLabelEl.textContent = `${monthFormatter.format(now)}`;
    monthLinkEl.href = `./list.html?month=${month}`;
    renderSummary(monthRecords);
    recentListEl.replaceChildren(...recentRecords.map((r) => createRecordItem(r, categoryNames)));
    emptyMessageEl.classList.toggle('d-none', recentRecords.length > 0);
    contentEl.classList.remove('d-none');
  } catch (error) {
    handleApiError(error);
  } finally {
    loadingEl.classList.add('d-none');
  }
}

if (initPage('index')) {
  init();
}
