// 記一筆：新增收支紀錄；網址帶 ?id=rec... 時為編輯模式，可修改或刪除

import { initPage, showToast, handleApiError } from './common.js';
import {
  listCategories,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
} from './airtable.js';

const TYPE_LABELS = { Income: '收入', Expense: '支出' };
const PAYMENT_METHODS = ['現金', '信用卡', '行動支付', '轉帳', '悠遊卡'];

const pageTitle = document.getElementById('pageTitle');
const loadingEl = document.getElementById('loading');
const alertArea = document.getElementById('alertArea');
const form = document.getElementById('recordForm');
const dateInput = document.getElementById('dateInput');
const amountInput = document.getElementById('amountInput');
const categorySelect = document.getElementById('categorySelect');
const paymentSelect = document.getElementById('paymentSelect');
const noteInput = document.getElementById('noteInput');
const submitBtn = document.getElementById('submitBtn');
const deleteBtn = document.getElementById('deleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const deleteModalEl = document.getElementById('deleteModal');
const deleteModal = bootstrap.Modal.getOrCreateInstance(deleteModalEl);
const errorEls = {
  date: document.getElementById('dateError'),
  amount: document.getElementById('amountError'),
  category: document.getElementById('categoryError'),
};
const fieldInputs = { date: dateInput, amount: amountInput, category: categorySelect };

const editId = new URLSearchParams(location.search).get('id');
let categories = [];
let original = null; // 編輯模式下，目前儲存在 Airtable 的紀錄
let busy = false;

// ---------- 工具 ----------

// 今天的日期（本機時區），格式 YYYY-MM-DD
function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function getType() {
  return form.elements.type.value;
}

function setError(field, message) {
  fieldInputs[field].classList.toggle('is-invalid', Boolean(message));
  errorEls[field].textContent = message;
}

function clearErrors() {
  for (const field of Object.keys(errorEls)) {
    setError(field, '');
  }
}

// 執行會呼叫 API 的操作：期間鎖住按鈕，避免重複送出
async function runBusy(task) {
  if (busy) {
    return false;
  }
  busy = true;
  document.querySelectorAll('[data-busy-lock]').forEach((el) => { el.disabled = true; });
  try {
    await task();
    return true;
  } catch (error) {
    handleApiError(error);
    return false;
  } finally {
    busy = false;
    document.querySelectorAll('[data-busy-lock]').forEach((el) => { el.disabled = false; });
  }
}

// ---------- 下拉選單 ----------

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

// 分類下拉選單只顯示該類型且啟用中的分類，依 SortOrder 排序；
// 編輯舊紀錄時，若它的分類已停用，仍保留該選項以免遺失
function populateCategories(selectedId = '') {
  const type = getType();
  const options = categories
    .filter((c) => c.type === type && (c.isActive || c.id === selectedId))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  categorySelect.replaceChildren(
    createOption('', options.length > 0 ? '請選擇分類' : '此類型沒有可用的分類'),
    ...options.map((c) => createOption(c.id, c.isActive ? c.name : `${c.name}（已停用）`)),
  );
  categorySelect.value = options.some((c) => c.id === selectedId) ? selectedId : '';
}

function populatePayments() {
  paymentSelect.replaceChildren(
    createOption('', '不指定'),
    ...PAYMENT_METHODS.map((method) => createOption(method, method)),
  );
}

// ---------- 驗證與送出 ----------

// 驗證欄位並回傳整理後的資料；有錯誤時回傳 null，錯誤訊息顯示在欄位下方
function readAndValidate() {
  const type = getType();
  const date = dateInput.value;
  const amountText = amountInput.value.trim();
  const categoryId = categorySelect.value;
  let valid = true;

  clearErrors();

  if (!date || Number.isNaN(Date.parse(date))) {
    setError('date', '請選擇日期');
    valid = false;
  }

  const amount = Number(amountText);
  if (!amountText) {
    setError('amount', '請輸入金額');
    valid = false;
  } else if (!Number.isSafeInteger(amount)) {
    setError('amount', '金額必須是整數');
    valid = false;
  } else if (amount <= 0) {
    setError('amount', '金額必須大於 0');
    valid = false;
  }

  if (!categoryId) {
    const hasOptions = categorySelect.options.length > 1;
    setError('category', hasOptions ? '請選擇分類' : '此類型沒有啟用中的分類，請先到「分類」頁新增或啟用');
    valid = false;
  }

  if (!valid) {
    return null;
  }
  return {
    type,
    date,
    amount,
    categoryId,
    paymentMethod: paymentSelect.value,
    note: noteInput.value.trim(),
  };
}

// 新增時，空的選填欄位不傳送（單選欄位傳空字串會被 Airtable 拒絕）
function buildCreateFields(data) {
  const fields = {
    Date: data.date,
    Type: data.type,
    Amount: data.amount,
    Category: [data.categoryId],
  };
  if (data.paymentMethod) {
    fields.PaymentMethod = data.paymentMethod;
  }
  if (data.note) {
    fields.Note = data.note;
  }
  return fields;
}

// 修改時只傳送有變更的欄位；清除付款方式要傳 null
function buildChangedFields(data) {
  const fields = {};
  if (data.date !== original.date) {
    fields.Date = data.date;
  }
  if (data.type !== original.type) {
    fields.Type = data.type;
  }
  if (data.amount !== original.amount) {
    fields.Amount = data.amount;
  }
  if (data.categoryId !== original.categoryId) {
    fields.Category = [data.categoryId];
  }
  if (data.paymentMethod !== original.paymentMethod) {
    fields.PaymentMethod = data.paymentMethod || null;
  }
  if (data.note !== original.note) {
    fields.Note = data.note;
  }
  return fields;
}

async function createNew(data) {
  const ok = await runBusy(async () => {
    await createRecord(buildCreateFields(data));
  });
  if (ok) {
    // 保留日期、類型、分類與付款方式，方便連續記帳
    amountInput.value = '';
    noteInput.value = '';
    clearErrors();
    showToast(`已新增${TYPE_LABELS[data.type]}紀錄`);
    amountInput.focus();
  }
}

async function saveChanges(data) {
  const fields = buildChangedFields(data);
  if (Object.keys(fields).length === 0) {
    showToast('沒有任何變更');
    return;
  }
  const ok = await runBusy(async () => {
    original = await updateRecord(original.id, fields);
  });
  if (ok) {
    showToast('已儲存修改');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) {
    return;
  }
  const data = readAndValidate();
  if (!data) {
    return;
  }
  if (editId) {
    saveChanges(data);
  } else {
    createNew(data);
  }
});

// 切換類型時重建分類選單；若原本選的分類仍屬於新類型則保留
form.addEventListener('change', (event) => {
  if (event.target.name === 'type') {
    populateCategories(editId && original ? original.categoryId : '');
    setError('category', '');
  }
});

for (const [field, input] of Object.entries(fieldInputs)) {
  input.addEventListener('input', () => setError(field, ''));
}

// ---------- 刪除（編輯模式） ----------

deleteBtn.addEventListener('click', () => deleteModal.show());

confirmDeleteBtn.addEventListener('click', async () => {
  const ok = await runBusy(async () => {
    await deleteRecord(original.id);
  });
  deleteModal.hide();
  if (ok) {
    location.href = './list.html';
  }
});

// ---------- 初始化 ----------

function showNotFound() {
  const alert = document.createElement('div');
  alert.className = 'alert alert-warning';
  alert.setAttribute('role', 'alert');
  const link = document.createElement('a');
  link.className = 'alert-link';
  link.href = './list.html';
  link.textContent = '回到月明細';
  alert.append('找不到這筆紀錄，', link);
  alertArea.replaceChildren(alert);
}

function fillForm(record) {
  form.elements.type.value = record.type;
  dateInput.value = record.date;
  amountInput.value = String(record.amount);
  paymentSelect.value = record.paymentMethod;
  noteInput.value = record.note;
}

async function init() {
  if (editId && !/^rec[A-Za-z0-9]+$/.test(editId)) {
    loadingEl.classList.add('d-none');
    showNotFound();
    return;
  }

  try {
    const [loadedCategories, record] = await Promise.all([
      listCategories(),
      editId ? getRecord(editId) : null,
    ]);
    categories = loadedCategories;
    populatePayments();

    if (record) {
      original = record;
      pageTitle.textContent = '編輯紀錄';
      document.title = '編輯紀錄 - MoneyBook';
      submitBtn.textContent = '儲存修改';
      deleteBtn.classList.remove('d-none');
      fillForm(record);
      populateCategories(record.categoryId);
    } else {
      dateInput.value = todayString();
      populateCategories();
    }
    form.classList.remove('d-none');
  } catch (error) {
    if (error.status === 404) {
      showNotFound();
    } else {
      handleApiError(error);
    }
  } finally {
    loadingEl.classList.add('d-none');
  }
}

if (initPage('record')) {
  init();
}
