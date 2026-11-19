// MoneyBook 的 Airtable 存取：所有 Airtable 呼叫都集中在這個檔案
// Token 與 Base ID 從 localStorage 讀取，不會出現在程式碼、畫面或 console

import { getToken, getBaseId } from './common.js';

const API_ROOT = 'https://api.airtable.com/v0';
const CATEGORIES_TABLE = 'Categories';
const RECORDS_TABLE = 'Records';
const BATCH_SIZE = 10; // Airtable 一次最多更新 10 筆

// 帶有 HTTP 狀態碼的錯誤，message 為可直接顯示給使用者的文字
export class AirtableError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AirtableError';
    this.status = status;
  }
}

// 依狀態碼回傳要顯示的訊息
function messageForStatus(status) {
  if (status === 429) {
    return '操作太頻繁，請 30 秒後再試';
  }
  if (status === 401 || status === 403) {
    return 'Token 無效或權限不足';
  }
  if (status === 404) {
    return '找不到這筆資料';
  }
  if (status === 422) {
    return '資料格式或欄位名稱錯誤，詳情請查看 console';
  }
  return `Airtable 回應錯誤（${status}）`;
}

// 共用的請求函式：加上驗證標頭、轉換錯誤訊息；recordId 有值時，網址會加上該筆記錄 ID
async function request(table, { method = 'GET', recordId, params, body } = {}) {
  const token = getToken();
  const baseId = getBaseId();
  if (!token || !baseId) {
    throw new AirtableError(401, 'Token 無效或權限不足');
  }

  let url = `${API_ROOT}/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;
  if (recordId) {
    url += `/${encodeURIComponent(recordId)}`;
  }
  if (params) {
    url += `?${params.toString()}`;
  }

  const headers = { Authorization: `Bearer ${token}` };
  const options = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new AirtableError(0, '無法連線到 Airtable，請檢查網路');
  }

  if (!response.ok) {
    if (response.status === 422) {
      // 422 把 Airtable 回傳的錯誤訊息輸出到 console，方便排查欄位問題
      const detail = await response.json().catch(() => null);
      console.error('Airtable 422：', detail?.error?.message ?? detail);
    }
    throw new AirtableError(response.status, messageForStatus(response.status));
  }
  return response.json();
}

// 將 Airtable 記錄轉成程式內使用的分類物件；未勾選的 Checkbox 欄位不會出現在回應中
function toCategory(record) {
  const fields = record.fields;
  return {
    id: record.id,
    name: fields.Name ?? '',
    type: fields.Type ?? '',
    sortOrder: fields.SortOrder ?? 0,
    isActive: Boolean(fields.IsActive),
  };
}

// 讀取全部分類（含停用），依 SortOrder 由小到大；有 offset 時持續讀取直到沒有為止
export async function listCategories() {
  const categories = [];
  let offset;
  do {
    const params = new URLSearchParams();
    for (const field of ['Name', 'Type', 'SortOrder', 'IsActive']) {
      params.append('fields[]', field);
    }
    params.set('sort[0][field]', 'SortOrder');
    params.set('sort[0][direction]', 'asc');
    if (offset) {
      params.set('offset', offset);
    }
    const data = await request(CATEGORIES_TABLE, { params });
    categories.push(...data.records.map(toCategory));
    offset = data.offset;
  } while (offset);
  return categories;
}

// 新增一筆分類，回傳新增後的分類物件
export async function createCategory({ name, type, sortOrder }) {
  const data = await request(CATEGORIES_TABLE, {
    method: 'POST',
    body: {
      records: [{ fields: { Name: name, Type: type, SortOrder: sortOrder, IsActive: true } }],
    },
  });
  return toCategory(data.records[0]);
}

// 批次更新分類；updates 為 [{ id, fields }]，只需傳送有變更的欄位，超過 10 筆會分批送出
export async function updateCategories(updates) {
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await request(CATEGORIES_TABLE, {
      method: 'PATCH',
      body: { records: batch.map(({ id, fields }) => ({ id, fields })) },
    });
  }
}

// 將 Airtable 記錄轉成程式內使用的收支紀錄物件；Category 是只連結一筆的 Link 欄位
function toRecord(record) {
  const fields = record.fields;
  return {
    id: record.id,
    date: fields.Date ?? '',
    type: fields.Type ?? '',
    amount: fields.Amount ?? 0,
    categoryId: fields.Category?.[0] ?? '',
    paymentMethod: fields.PaymentMethod ?? '',
    note: fields.Note ?? '',
  };
}

// 讀取某個月份（YYYY-MM）的全部收支紀錄，日期由新到舊、同日再依建立時間由新到舊
export async function listRecords(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`月份格式錯誤：${month}`);
  }
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    for (const field of ['Date', 'Type', 'Amount', 'Category', 'PaymentMethod', 'Note']) {
      params.append('fields[]', field);
    }
    params.set('filterByFormula', `DATETIME_FORMAT({Date}, 'YYYY-MM') = '${month}'`);
    params.set('sort[0][field]', 'Date');
    params.set('sort[0][direction]', 'desc');
    params.set('sort[1][field]', 'CreatedAt');
    params.set('sort[1][direction]', 'desc');
    if (offset) {
      params.set('offset', offset);
    }
    const data = await request(RECORDS_TABLE, { params });
    records.push(...data.records.map(toRecord));
    offset = data.offset;
  } while (offset);
  return records;
}

// 讀取 startMonth 到 endMonth（含，格式 YYYY-MM）之間的收支紀錄，供統計使用，只取統計需要的欄位
// 一次請求讀完整個區間，避免逐月呼叫而超過每秒 5 次的速率限制
export async function listRecordsInRange(startMonth, endMonth) {
  const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!monthPattern.test(startMonth) || !monthPattern.test(endMonth)) {
    throw new Error(`月份格式錯誤：${startMonth} ~ ${endMonth}`);
  }
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    for (const field of ['Date', 'Type', 'Amount', 'Category']) {
      params.append('fields[]', field);
    }
    params.set(
      'filterByFormula',
      `AND(DATETIME_FORMAT({Date}, 'YYYY-MM') >= '${startMonth}', DATETIME_FORMAT({Date}, 'YYYY-MM') <= '${endMonth}')`,
    );
    if (offset) {
      params.set('offset', offset);
    }
    const data = await request(RECORDS_TABLE, { params });
    records.push(...data.records.map(toRecord));
    offset = data.offset;
  } while (offset);
  return records;
}

// 讀取最近的收支紀錄（不限月份），日期由新到舊、同日再依建立時間由新到舊；limit 最多 100
export async function listRecentRecords(limit = 10) {
  const params = new URLSearchParams();
  for (const field of ['Date', 'Type', 'Amount', 'Category', 'PaymentMethod', 'Note']) {
    params.append('fields[]', field);
  }
  params.set('maxRecords', String(Math.min(Math.max(1, limit), 100)));
  params.set('sort[0][field]', 'Date');
  params.set('sort[0][direction]', 'desc');
  params.set('sort[1][field]', 'CreatedAt');
  params.set('sort[1][direction]', 'desc');
  const data = await request(RECORDS_TABLE, { params });
  return data.records.map(toRecord);
}

// 讀取單筆收支紀錄
export async function getRecord(id) {
  return toRecord(await request(RECORDS_TABLE, { recordId: id }));
}

// 新增收支紀錄；fields 使用 Airtable 欄位名稱（Date、Type、Amount、Category、PaymentMethod、Note）
// 選填欄位沒有值時請不要傳入；CreatedAt 由 Airtable 自動產生，不可寫入
export async function createRecord(fields) {
  const data = await request(RECORDS_TABLE, {
    method: 'POST',
    body: { records: [{ fields }] },
  });
  return toRecord(data.records[0]);
}

// 修改收支紀錄，只傳送有變更的欄位；要清除單選欄位（如 PaymentMethod）時傳入 null
export async function updateRecord(id, fields) {
  return toRecord(await request(RECORDS_TABLE, {
    method: 'PATCH',
    recordId: id,
    body: { fields },
  }));
}

// 刪除收支紀錄
export async function deleteRecord(id) {
  await request(RECORDS_TABLE, { method: 'DELETE', recordId: id });
}
