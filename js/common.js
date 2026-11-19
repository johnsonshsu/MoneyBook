// MoneyBook 共用函式：導覽列、設定存取、頁面初始化、Toast 提示

const TOKEN_KEY = 'MoneyBook.token';
const BASE_ID_KEY = 'MoneyBook.baseId';

// 導覽列項目，順序依 PRD：首頁、記一筆、月明細、統計、分類、設定
const NAV_ITEMS = [
  { key: 'index', file: 'index.html', name: '首頁' },
  { key: 'record', file: 'record.html', name: '記一筆' },
  { key: 'list', file: 'list.html', name: '月明細' },
  { key: 'report', file: 'report.html', name: '統計' },
  { key: 'categories', file: 'categories.html', name: '分類' },
  { key: 'settings', file: 'settings.html', name: '設定' },
];

// ---------- 設定（localStorage）----------

// 讀取 localStorage，無法使用時（例如被瀏覽器封鎖）回傳空字串
function readStorage(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function getToken() {
  return readStorage(TOKEN_KEY);
}

export function getBaseId() {
  return readStorage(BASE_ID_KEY);
}

export function hasSettings() {
  return Boolean(getToken() && getBaseId());
}

// 儲存設定；token 為 null 表示不變更既有的 Token
export function saveSettings({ token, baseId }) {
  if (token !== null) {
    localStorage.setItem(TOKEN_KEY, token);
  }
  localStorage.setItem(BASE_ID_KEY, baseId);
}

export function clearSettings() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BASE_ID_KEY);
}

// 尚未設定 Token 或 Base ID 時，導向設定頁
export function requireSettings() {
  if (hasSettings()) {
    return true;
  }
  location.replace('./settings.html');
  return false;
}

// ---------- 導覽列 ----------

export function renderNavbar(activeKey) {
  const host = document.getElementById('navbar');
  if (!host) {
    return;
  }

  const nav = document.createElement('nav');
  nav.className = 'navbar navbar-expand-md bg-body-tertiary border-bottom';

  const container = document.createElement('div');
  container.className = 'container';

  const brand = document.createElement('a');
  brand.className = 'navbar-brand';
  brand.href = './index.html';
  brand.textContent = 'MoneyBook';

  const toggler = document.createElement('button');
  toggler.className = 'navbar-toggler';
  toggler.type = 'button';
  toggler.dataset.bsToggle = 'collapse';
  toggler.dataset.bsTarget = '#navMenu';
  toggler.setAttribute('aria-controls', 'navMenu');
  toggler.setAttribute('aria-expanded', 'false');
  toggler.setAttribute('aria-label', '切換導覽選單');
  const togglerIcon = document.createElement('span');
  togglerIcon.className = 'navbar-toggler-icon';
  toggler.append(togglerIcon);

  const menu = document.createElement('div');
  menu.className = 'collapse navbar-collapse';
  menu.id = 'navMenu';

  const list = document.createElement('ul');
  list.className = 'navbar-nav ms-auto';

  for (const item of NAV_ITEMS) {
    const li = document.createElement('li');
    li.className = 'nav-item';
    const link = document.createElement('a');
    link.className = 'nav-link';
    link.href = `./${item.file}`;
    link.textContent = item.name;
    if (item.key === activeKey) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    li.append(link);
    list.append(li);
  }

  menu.append(list);
  container.append(brand, toggler, menu);
  nav.append(container);
  host.replaceChildren(nav);
}

// ---------- Toast 提示 ----------

function getToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    document.body.append(container);
  }
  return container;
}

// type：success 或 danger
export function showToast(message, type = 'success') {
  const toastEl = document.createElement('div');
  toastEl.className = `toast align-items-center text-bg-${type} border-0`;
  toastEl.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  toastEl.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite');
  toastEl.setAttribute('aria-atomic', 'true');

  const wrapper = document.createElement('div');
  wrapper.className = 'd-flex';

  const body = document.createElement('div');
  body.className = 'toast-body';
  body.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-close btn-close-white me-2 m-auto';
  closeBtn.dataset.bsDismiss = 'toast';
  closeBtn.setAttribute('aria-label', '關閉');

  wrapper.append(body, closeBtn);
  toastEl.append(wrapper);
  getToastContainer().append(toastEl);

  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// ---------- 格式化 ----------

const currencyFormatter = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  maximumFractionDigits: 0,
});

// 新台幣金額，例如 $1,234
export function formatAmount(amount) {
  return currencyFormatter.format(amount);
}

// ---------- API 錯誤處理 ----------

// 顯示 API 錯誤：Token 無效或權限不足時，在 #alertArea 顯示含設定頁連結的 Alert；其餘用 Toast
export function handleApiError(error) {
  const area = document.getElementById('alertArea');
  if ((error.status === 401 || error.status === 403) && area) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.setAttribute('role', 'alert');
    const link = document.createElement('a');
    link.className = 'alert-link';
    link.href = './settings.html';
    link.textContent = '前往設定';
    alert.append(`${error.message}，`, link);
    area.replaceChildren(alert);
    return;
  }
  showToast(error.message || '發生未預期的錯誤', 'danger');
}

// ---------- 頁面初始化 ----------

// 每個頁面載入時呼叫：畫出導覽列，並檢查是否已設定 Token（設定頁本身除外）
// 回傳 false 表示已導向設定頁，頁面程式不需繼續執行
export function initPage(pageKey) {
  renderNavbar(pageKey);
  if (pageKey === 'settings') {
    return true;
  }
  return requireSettings();
}
