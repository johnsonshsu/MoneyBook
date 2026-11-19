// 統計：當月支出／收入分類圓餅圖（附金額與占比表格），以及近 6 個月收支長條圖

import { initPage, formatAmount, handleApiError } from './common.js';
import { listCategories, listRecordsInRange } from './airtable.js';

const TREND_MONTHS = 6;
const PALETTE = [
  '#0d6efd', '#fd7e14', '#198754', '#6f42c1', '#d63384',
  '#20c997', '#ffc107', '#6c757d', '#0dcaf0', '#dc3545',
];
const INCOME_COLOR = '#198754';
const EXPENSE_COLOR = '#dc3545';

const monthInput = document.getElementById('monthInput');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');

// 兩張圓餅圖的元素設定
const breakdowns = {
  Expense: {
    chart: document.getElementById('expenseChart'),
    rows: document.getElementById('expenseRows'),
    body: document.getElementById('expenseBody'),
    empty: document.getElementById('expenseEmpty'),
  },
  Income: {
    chart: document.getElementById('incomeChart'),
    rows: document.getElementById('incomeRows'),
    body: document.getElementById('incomeBody'),
    empty: document.getElementById('incomeEmpty'),
  },
};
const trend = {
  chart: document.getElementById('trendChart'),
  body: document.getElementById('trendBody'),
  empty: document.getElementById('trendEmpty'),
};

const percentFormatter = new Intl.NumberFormat('zh-TW', {
  style: 'percent',
  maximumFractionDigits: 1,
});

let categoryNames = new Map(); // 分類記錄 ID → 名稱（含已停用的分類）
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

// 以 month 為最後一個月，往前共 count 個月，由舊到新
function monthsEndingAt(month, count) {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - (count - 1)));
}

// ---------- 圖表 ----------

// 重畫圖表前先銷毀舊的，避免重疊
function resetChart(canvas) {
  Chart.getChart(canvas)?.destroy();
}

function renderBreakdown(type, monthRecords) {
  const { chart, rows, body, empty } = breakdowns[type];
  resetChart(chart);

  const totals = new Map();
  for (const record of monthRecords) {
    if (record.type === type) {
      totals.set(record.categoryId, (totals.get(record.categoryId) ?? 0) + record.amount);
    }
  }
  const entries = [...totals.entries()]
    .map(([categoryId, amount]) => ({ name: categoryNames.get(categoryId) ?? '（未分類）', amount }))
    .sort((a, b) => b.amount - a.amount);

  const hasData = entries.length > 0;
  body.classList.toggle('d-none', !hasData);
  empty.classList.toggle('d-none', hasData);
  if (!hasData) {
    rows.replaceChildren();
    return;
  }

  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  const colors = entries.map((_, i) => PALETTE[i % PALETTE.length]);

  rows.replaceChildren(...entries.map((entry, i) => {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    const swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = colors[i];
    nameCell.append(swatch, entry.name);

    const amountCell = document.createElement('td');
    amountCell.className = 'text-end';
    amountCell.textContent = formatAmount(entry.amount);

    const percentCell = document.createElement('td');
    percentCell.className = 'text-end';
    percentCell.textContent = percentFormatter.format(entry.amount / total);

    tr.append(nameCell, amountCell, percentCell);
    return tr;
  }));

  new Chart(chart, {
    type: 'pie',
    data: {
      labels: entries.map((e) => e.name),
      datasets: [{ data: entries.map((e) => e.amount), backgroundColor: colors }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }, // 下方表格已有顏色與名稱對照
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}：${formatAmount(ctx.parsed)}（${percentFormatter.format(ctx.parsed / total)}）`,
          },
        },
      },
    },
  });
}

function renderTrend(months, rangeRecords) {
  resetChart(trend.chart);

  const income = new Map(months.map((m) => [m, 0]));
  const expense = new Map(months.map((m) => [m, 0]));
  for (const record of rangeRecords) {
    const target = record.type === 'Income' ? income : expense;
    const key = record.date.slice(0, 7);
    if (target.has(key)) {
      target.set(key, target.get(key) + record.amount);
    }
  }

  const hasData = rangeRecords.length > 0;
  trend.body.classList.toggle('d-none', !hasData);
  trend.empty.classList.toggle('d-none', hasData);
  if (!hasData) {
    return;
  }

  new Chart(trend.chart, {
    type: 'bar',
    data: {
      labels: months.map((m) => m.replace('-', '/')),
      datasets: [
        { label: '收入', data: months.map((m) => income.get(m)), backgroundColor: INCOME_COLOR },
        { label: '支出', data: months.map((m) => expense.get(m)), backgroundColor: EXPENSE_COLOR },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { callback: (value) => formatAmount(value) } },
      },
      plugins: {
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}：${formatAmount(ctx.parsed.y)}` },
        },
      },
    },
  });
}

// ---------- 載入 ----------

async function loadMonth(month) {
  currentMonth = month;
  monthInput.value = month;
  history.replaceState(null, '', `?month=${month}`);

  const seq = ++loadSeq;
  loadingEl.classList.remove('d-none');
  contentEl.classList.add('d-none');

  const months = monthsEndingAt(month, TREND_MONTHS);
  try {
    // 一次讀取近 6 個月，當月的圓餅圖資料直接從中篩出
    const rangeRecords = await listRecordsInRange(months[0], month);
    if (seq !== loadSeq) {
      return;
    }
    const monthRecords = rangeRecords.filter((r) => r.date.startsWith(month));
    renderBreakdown('Expense', monthRecords);
    renderBreakdown('Income', monthRecords);
    renderTrend(months, rangeRecords);
    contentEl.classList.remove('d-none');
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

// ---------- 初始化 ----------

async function init() {
  const queryMonth = new URLSearchParams(location.search).get('month');
  const month = isValidMonth(queryMonth) ? queryMonth : currentMonthString();

  try {
    const categories = await listCategories();
    categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  } catch (error) {
    loadingEl.classList.add('d-none');
    handleApiError(error);
    return;
  }
  await loadMonth(month);
}

if (initPage('report')) {
  init();
}
