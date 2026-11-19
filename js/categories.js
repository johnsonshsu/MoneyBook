// 分類管理：依收入、支出分組列出分類，可新增、改名、調整排序、停用／啟用（不提供刪除）

import { initPage, showToast, handleApiError } from './common.js';
import { listCategories, createCategory, updateCategories } from './airtable.js';

const TYPE_LABELS = { Income: '收入', Expense: '支出' };
const NAME_MAX_LENGTH = 30;

const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');
const addForm = document.getElementById('addForm');
const addName = document.getElementById('addName');
const addType = document.getElementById('addType');
const addNameError = document.getElementById('addNameError');
const renameForm = document.getElementById('renameForm');
const renameInput = document.getElementById('renameInput');
const renameError = document.getElementById('renameError');
const renameModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('renameModal'));
const lists = {
  Income: document.getElementById('incomeList'),
  Expense: document.getElementById('expenseList'),
};

let categories = [];
let renamingId = null;
let busy = false;

// ---------- 資料與畫面 ----------

// 取得某類型的分類，依 SortOrder 由小到大
function getGroup(type) {
  return categories.filter((c) => c.type === type).sort((a, b) => a.sortOrder - b.sortOrder);
}

function createButton(label, action, id, className, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-outline-secondary ${className ?? ''}`.trim();
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  button.dataset.busyLock = '';
  if (ariaLabel) {
    button.setAttribute('aria-label', ariaLabel);
  }
  button.disabled = busy;
  return button;
}

function renderItem(category, index, total) {
  const item = document.createElement('li');
  item.className = 'list-group-item d-flex flex-wrap align-items-center gap-2';

  const name = document.createElement('span');
  name.className = 'flex-grow-1';
  name.textContent = category.name;
  if (!category.isActive) {
    name.classList.add('text-secondary');
    const badge = document.createElement('span');
    badge.className = 'badge text-bg-secondary ms-2';
    badge.textContent = '停用';
    name.append(badge);
  }

  const group = document.createElement('div');
  group.className = 'btn-group btn-group-sm';
  const up = createButton('↑', 'up', category.id, '', `上移 ${category.name}`);
  const down = createButton('↓', 'down', category.id, '', `下移 ${category.name}`);
  up.disabled = busy || index === 0;
  down.disabled = busy || index === total - 1;
  group.append(
    up,
    down,
    createButton('改名', 'rename', category.id),
    createButton(category.isActive ? '停用' : '啟用', 'toggle', category.id),
  );

  item.append(name, group);
  return item;
}

function render() {
  for (const type of Object.keys(lists)) {
    const group = getGroup(type);
    if (group.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'list-group-item text-secondary';
      empty.textContent = `尚無${TYPE_LABELS[type]}分類`;
      lists[type].replaceChildren(empty);
    } else {
      lists[type].replaceChildren(...group.map((c, i) => renderItem(c, i, group.length)));
    }
  }
}

// 執行會呼叫 API 的操作：期間鎖住所有按鈕，避免重複送出
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
    render();
  }
}

// ---------- 驗證 ----------

// 驗證分類名稱，回傳錯誤訊息；沒有錯誤回傳空字串
function validateName(name, type, excludeId = null) {
  if (!name) {
    return '請輸入分類名稱';
  }
  if (name.length > NAME_MAX_LENGTH) {
    return `分類名稱最多 ${NAME_MAX_LENGTH} 個字`;
  }
  const duplicated = categories.some(
    (c) => c.type === type && c.id !== excludeId && c.name === name,
  );
  return duplicated ? `${TYPE_LABELS[type]}已有同名的分類` : '';
}

function setError(input, errorEl, message) {
  input.classList.toggle('is-invalid', Boolean(message));
  errorEl.textContent = message;
}

// ---------- 操作 ----------

async function addCategory() {
  const name = addName.value.trim();
  const type = addType.value;
  const message = validateName(name, type);
  setError(addName, addNameError, message);
  if (message) {
    return;
  }
  const group = getGroup(type);
  const sortOrder = group.length > 0 ? group[group.length - 1].sortOrder + 1 : 1;

  const ok = await runBusy(async () => {
    const created = await createCategory({ name, type, sortOrder });
    categories.push(created);
  });
  if (ok) {
    addName.value = '';
    showToast(`已新增${TYPE_LABELS[type]}分類「${name}」`);
  }
}

async function moveCategory(id, offset) {
  const target = categories.find((c) => c.id === id);
  const group = getGroup(target.type);
  const from = group.findIndex((c) => c.id === id);
  const to = from + offset;
  if (to < 0 || to >= group.length) {
    return;
  }
  [group[from], group[to]] = [group[to], group[from]];

  // 重新編號為 1..n，只送出順序有變的分類（也會修正原本重複或不連續的 SortOrder）
  const changes = group
    .map((c, i) => ({ category: c, sortOrder: i + 1 }))
    .filter(({ category, sortOrder }) => category.sortOrder !== sortOrder);

  await runBusy(async () => {
    await updateCategories(changes.map(({ category, sortOrder }) => ({
      id: category.id,
      fields: { SortOrder: sortOrder },
    })));
    for (const { category, sortOrder } of changes) {
      category.sortOrder = sortOrder;
    }
  });
}

async function toggleCategory(id) {
  const category = categories.find((c) => c.id === id);
  const isActive = !category.isActive;
  const ok = await runBusy(async () => {
    await updateCategories([{ id, fields: { IsActive: isActive } }]);
    category.isActive = isActive;
  });
  if (ok) {
    showToast(`已${isActive ? '啟用' : '停用'}「${category.name}」`);
  }
}

function openRename(id) {
  const category = categories.find((c) => c.id === id);
  renamingId = id;
  renameInput.value = category.name;
  setError(renameInput, renameError, '');
  renameModal.show();
}

async function submitRename() {
  const category = categories.find((c) => c.id === renamingId);
  const name = renameInput.value.trim();
  const message = validateName(name, category.type, category.id);
  setError(renameInput, renameError, message);
  if (message) {
    return;
  }
  if (name === category.name) {
    renameModal.hide();
    return;
  }
  const ok = await runBusy(async () => {
    await updateCategories([{ id: category.id, fields: { Name: name } }]);
    category.name = name;
  });
  if (ok) {
    renameModal.hide();
    showToast('分類名稱已修改');
  }
}

// ---------- 事件 ----------

addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addCategory();
});

renameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitRename();
});

document.getElementById('renameModal').addEventListener('shown.bs.modal', () => {
  renameInput.focus();
  renameInput.select();
});

contentEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy) {
    return;
  }
  const { action, id } = button.dataset;
  if (action === 'up') {
    moveCategory(id, -1);
  } else if (action === 'down') {
    moveCategory(id, 1);
  } else if (action === 'rename') {
    openRename(id);
  } else if (action === 'toggle') {
    toggleCategory(id);
  }
});

// ---------- 初始化 ----------

async function init() {
  try {
    categories = await listCategories();
    render();
    contentEl.classList.remove('d-none');
  } catch (error) {
    handleApiError(error);
  } finally {
    loadingEl.classList.add('d-none');
  }
}

if (initPage('categories')) {
  init();
}
