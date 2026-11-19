// 設定頁：輸入、儲存與清除 Token 與 Base ID

import {
  initPage,
  getToken,
  getBaseId,
  hasSettings,
  saveSettings,
  clearSettings,
  showToast,
} from './common.js';

initPage('settings');

const form = document.getElementById('settingsForm');
const tokenInput = document.getElementById('tokenInput');
const baseIdInput = document.getElementById('baseIdInput');
const tokenError = document.getElementById('tokenError');
const baseIdError = document.getElementById('baseIdError');
const setupAlert = document.getElementById('setupAlert');
const clearBtn = document.getElementById('clearBtn');
const confirmClearBtn = document.getElementById('confirmClearBtn');
const clearModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('clearModal'));

// 依目前儲存狀態更新畫面；不會把 Token 放進輸入欄位
function refreshView() {
  const tokenSaved = Boolean(getToken());
  tokenInput.value = '';
  tokenInput.placeholder = tokenSaved ? '已設定（留空表示不變更）' : 'pat...';
  baseIdInput.value = getBaseId();
  setupAlert.classList.toggle('d-none', hasSettings());
  clearBtn.disabled = !tokenSaved && !getBaseId();
}

function setFieldError(input, errorEl, message) {
  input.classList.toggle('is-invalid', Boolean(message));
  errorEl.textContent = message;
}

// 驗證欄位，回傳是否通過；錯誤訊息顯示在欄位下方
function validate() {
  const token = tokenInput.value.trim();
  const baseId = baseIdInput.value.trim();
  let valid = true;

  if (!token && !getToken()) {
    setFieldError(tokenInput, tokenError, '請輸入 Token');
    valid = false;
  } else if (/\s/.test(token)) {
    setFieldError(tokenInput, tokenError, 'Token 不可包含空白');
    valid = false;
  } else {
    setFieldError(tokenInput, tokenError, '');
  }

  if (!baseId) {
    setFieldError(baseIdInput, baseIdError, '請輸入 Base ID');
    valid = false;
  } else if (!/^app[A-Za-z0-9]+$/.test(baseId)) {
    setFieldError(baseIdInput, baseIdError, 'Base ID 必須以 app 開頭，且只含英文字母與數字');
    valid = false;
  } else {
    setFieldError(baseIdInput, baseIdError, '');
  }

  return valid;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validate()) {
    return;
  }
  try {
    const token = tokenInput.value.trim();
    // Token 欄位留空代表沿用已儲存的 Token
    saveSettings({ token: token || null, baseId: baseIdInput.value.trim() });
    refreshView();
    showToast('設定已儲存');
  } catch {
    showToast('儲存失敗，瀏覽器可能封鎖了本機儲存空間', 'danger');
  }
});

clearBtn.addEventListener('click', () => clearModal.show());

confirmClearBtn.addEventListener('click', () => {
  try {
    clearSettings();
    clearModal.hide();
    setFieldError(tokenInput, tokenError, '');
    setFieldError(baseIdInput, baseIdError, '');
    refreshView();
    showToast('設定已清除');
  } catch {
    showToast('清除失敗，請稍後再試', 'danger');
  }
});

refreshView();
