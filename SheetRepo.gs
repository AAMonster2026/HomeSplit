/**
 * HomeSplit 資料層。
 * 全部紀錄放在「同一個」Google 試算表，分四個工作表：
 *   設定、月份、支出、明細
 * 支出一筆一列。寫入時用 LockService 把讀改寫鎖成一次，
 * 所以兩人同時新增不同帳單不會互相蓋掉。
 */

var SHEET_SETTINGS = '設定';
var SHEET_MONTHS = '月份';
var SHEET_EXPENSES = '支出';
var SHEET_DETAIL = '明細';

var CATEGORIES = ['膳食', '日常用品', '月費', '其他'];
var CURRENCIES = ['HKD', 'TWD', 'CNY', 'USD', 'EUR', 'JPY'];

var SETTINGS_KEYS = [
  '已完成設定',
  '已初始化',
  '名稱',
  '貨幣',
  '參與者A',
  '參與者B',
  '目前月份編號',
  '修訂',
  '更新時間',
  '明細修訂'
];

var MONTH_COLUMNS = [
  ['id', '月份編號'],
  ['label', '月份'],
  ['income', '家庭收入'],
  ['pool', '夾錢'],
  ['status', '狀態'],
  ['settledAt', '結算時間'],
  ['spentA', '參與者A支出'],
  ['spentB', '參與者B支出'],
  ['totalSpent', '總支出'],
  ['poolRemain', '夾錢剩餘'],
  ['net', '淨收支'],
  ['fairShare', '每人應負擔'],
  ['debtor', '應付方編號'],
  ['creditor', '應收方編號'],
  ['oweAmount', '應付金額'],
  ['createdAt', '建立時間']
];

var EXPENSE_COLUMNS = [
  ['id', '支出編號'],
  ['monthId', '月份編號'],
  ['amount', '金額'],
  ['category', '分類'],
  ['payer', '付款人編號'],
  ['payerName', '付款人'],
  ['date', '日期'],
  ['note', '說明'],
  ['createdAt', '建立時間'],
  ['updatedAt', '更新時間'],
  ['deleted', '已刪除']
];

var LEGACY_MONTH_ID = 'id_msyss6vb_9wuif8';
var LEGACY_UPDATED_AT = '2026-10-12T04:39:07.051Z';

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function num(v) {
  if (typeof v === 'number') return isFinite(v) ? round2(v) : 0;
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? round2(n) : 0;
}

function yes(v) {
  return v === true || v === '是' || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function plainText(value) {
  return String(value || '').replace(/^\u200B+/, '');
}

function sheetText(value, max) {
  var text = clip(plainText(value), max || 120);
  if (/^[=+\-@]/.test(text)) text = '\u200B' + text;
  return text;
}

function asDateString(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    var y = value.getFullYear();
    var m = String(value.getMonth() + 1).padStart(2, '0');
    var d = String(value.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  var matched = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return matched ? matched[1] : '';
}

function monthLabelNow() {
  try {
    return Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM');
  } catch (err) {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
}

function nextLabel(label) {
  var matched = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!matched) return monthLabelNow();
  var year = Number(matched[1]);
  var month = Number(matched[2]) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return year + '-' + String(month).padStart(2, '0');
}

function formatPlain(amount, currency) {
  var digits = currency === 'JPY' ? 0 : 2;
  return String(currency || 'HKD') + ' ' + (Number(amount) || 0).toFixed(digits);
}

function personName(state, id) {
  var people = state && state.people ? state.people : [];
  for (var i = 0; i < people.length; i++) {
    if (people[i].id === id) return people[i].name;
  }
  return id === 'b' ? '另一半' : '你';
}

function computeSummary(month) {
  var expenses = (month && month.expenses) || [];
  var spentA = 0;
  var spentB = 0;
  var byCat = {};
  CATEGORIES.forEach(function (category) { byCat[category] = 0; });

  expenses.forEach(function (expense) {
    var amount = Number(expense.amount) || 0;
    if (expense.payer === 'b') spentB += amount;
    else spentA += amount;
    if (byCat[expense.category] !== undefined) byCat[expense.category] += amount;
    else byCat['其他'] += amount;
  });

  spentA = round2(spentA);
  spentB = round2(spentB);
  CATEGORIES.forEach(function (category) { byCat[category] = round2(byCat[category]); });

  var totalSpent = round2(spentA + spentB);
  var income = round2(month && month.income || 0);
  var pool = round2(month && month.pool || 0);
  var poolRemain = round2(pool - totalSpent);
  var net = round2(income - totalSpent);
  var fairShare = round2(totalSpent / 2);
  var balance = round2(spentA - fairShare);
  var debtor = null;
  var creditor = null;
  var oweAmount = 0;
  if (balance > 0.004) {
    debtor = 'b';
    creditor = 'a';
    oweAmount = balance;
  } else if (balance < -0.004) {
    debtor = 'a';
    creditor = 'b';
    oweAmount = Math.abs(balance);
  }

  return {
    spentA: spentA,
    spentB: spentB,
    totalSpent: totalSpent,
    byCat: byCat,
    income: income,
    pool: pool,
    poolRemain: poolRemain,
    net: net,
    fairShare: fairShare,
    balance: balance,
    debtor: debtor,
    creditor: creditor,
    oweAmount: round2(oweAmount)
  };
}

function settlementText(summary, state) {
  if (!summary || !summary.debtor) return '兩人支出剛好平衡，無需轉帳。';
  return personName(state, summary.debtor) + ' 應支付 ' +
    formatPlain(summary.oweAmount, state.currency) + ' 給 ' +
    personName(state, summary.creditor);
}

function getSpreadsheetUnlocked() {
  var props = PropertiesService.getScriptProperties();
  var active = null;
  try {
    active = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    active = null;
  }
  if (active) {
    ensureSchema(active);
    seedIfNeeded(active);
    return active;
  }

  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      var opened = SpreadsheetApp.openById(id);
      ensureSchema(opened);
      seedIfNeeded(opened);
      return opened;
    } catch (err) {
      props.deleteProperty('SPREADSHEET_ID');
      props.deleteProperty('SPREADSHEET_URL');
    }
  }

  var created = SpreadsheetApp.create('HomeSplit 家庭收支');
  props.setProperty('SPREADSHEET_ID', created.getId());
  props.setProperty('SPREADSHEET_URL', created.getUrl());
  ensureSchema(created);
  removeDefaultSheet(created);
  seedIfNeeded(created);
  return created;
}

function removeDefaultSheet(ss) {
  var leftovers = ss.getSheets().filter(function (sheet) {
    var name = sheet.getName();
    return name === '工作表1' || name === 'Sheet1';
  });
  leftovers.forEach(function (sheet) {
    if (ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}

function ensureSchema(ss) {
  ensureSheet(ss, SHEET_SETTINGS);
  ensureSheet(ss, SHEET_MONTHS);
  ensureSheet(ss, SHEET_EXPENSES);
  ensureSheet(ss, SHEET_DETAIL);
  ensureHeader(ss, SHEET_SETTINGS, ['鍵', '值']);
  ensureHeader(ss, SHEET_MONTHS, MONTH_COLUMNS.map(function (col) { return col[1]; }));
  ensureHeader(ss, SHEET_EXPENSES, EXPENSE_COLUMNS.map(function (col) { return col[1]; }));
}

function ensureSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureHeader(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader(sheet, headers.length);
    return;
  }
  var width = Math.max(sheet.getLastColumn(), headers.length);
  var current = sheet.getRange(1, 1, 1, width).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(current[i] || '') !== headers[i]) {
      throw new Error('工作表「' + name + '」的標題列與程式不符（預期「' + headers[i] + '」）。請勿改標題。');
    }
  }
}

function styleHeader(sheet, cols) {
  if (!sheet.getRange) return;
  var range = sheet.getRange(1, 1, 1, cols);
  if (range.setFontWeight) range.setFontWeight('bold');
  if (range.setBackground) range.setBackground('#ccfbf1');
  if (sheet.setFrozenRows) sheet.setFrozenRows(1);
}

function readSettings(ss) {
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  var last = sheet.getLastRow();
  var map = {};
  if (last < 2) return map;
  var values = sheet.getRange(2, 1, last - 1, 2).getValues();
  values.forEach(function (row) {
    if (!row[0]) return;
    map[String(row[0])] = row[1];
  });
  return map;
}

function writeSettings(ss, patch) {
  var map = readSettings(ss);
  Object.keys(patch).forEach(function (key) {
    map[key] = patch[key];
  });
  var keys = SETTINGS_KEYS.filter(function (key) {
    return map[key] !== undefined;
  });
  var rows = [['鍵', '值']];
  keys.forEach(function (key) {
    rows.push([key, map[key] === undefined || map[key] === null ? '' : map[key]]);
  });
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  styleHeader(sheet, 2);
}

function readTable(ss, sheetName, columns) {
  var sheet = ss.getSheetByName(sheetName);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, columns.length).getValues();
  return values.filter(function (row) {
    return row.some(function (cell) {
      return cell !== '' && cell !== null && cell !== undefined;
    });
  }).map(function (row) {
    var obj = {};
    columns.forEach(function (col, index) {
      obj[col[0]] = row[index];
    });
    return obj;
  });
}

function writeTable(ss, sheetName, columns, objects) {
  var headers = columns.map(function (col) { return col[1]; });
  var rows = [headers];
  objects.forEach(function (obj) {
    rows.push(columns.map(function (col) {
      var value = obj[col[0]];
      return value === undefined || value === null ? '' : value;
    }));
  });
  var sheet = ss.getSheetByName(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  styleHeader(sheet, headers.length);
  return sheet;
}

function normalizeExpense(raw) {
  return {
    id: String(raw.id || ''),
    monthId: String(raw.monthId || ''),
    amount: num(raw.amount),
    category: CATEGORIES.indexOf(String(raw.category || '')) >= 0 ? String(raw.category) : '其他',
    payer: String(raw.payer) === 'b' ? 'b' : 'a',
    payerName: String(raw.payerName || ''),
    date: asDateString(raw.date),
    note: plainText(raw.note),
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    deleted: yes(raw.deleted)
  };
}

function expenseToRow(expense) {
  return {
    id: expense.id,
    monthId: expense.monthId,
    amount: expense.amount,
    category: expense.category,
    payer: expense.payer,
    payerName: expense.payerName || '',
    date: expense.date,
    note: sheetText(expense.note, 120),
    createdAt: expense.createdAt || '',
    updatedAt: expense.updatedAt || '',
    deleted: expense.deleted ? '是' : '否'
  };
}

function normalizeMonth(raw) {
  var statusText = String(raw.status || '');
  var settled = statusText === '已結算' || statusText === 'settled';
  var debtor = String(raw.debtor || '');
  var creditor = String(raw.creditor || '');
  return {
    id: String(raw.id || ''),
    label: String(raw.label || ''),
    income: num(raw.income),
    pool: num(raw.pool),
    status: settled ? 'settled' : 'current',
    settledAt: raw.settledAt ? String(raw.settledAt) : '',
    spentA: num(raw.spentA),
    spentB: num(raw.spentB),
    totalSpent: num(raw.totalSpent),
    poolRemain: num(raw.poolRemain),
    net: num(raw.net),
    fairShare: num(raw.fairShare),
    debtor: debtor === 'a' || debtor === 'b' ? debtor : '',
    creditor: creditor === 'a' || creditor === 'b' ? creditor : '',
    oweAmount: num(raw.oweAmount),
    createdAt: String(raw.createdAt || '')
  };
}

function monthToRow(month) {
  var settled = month.status === 'settled' || month.status === '已結算';
  return {
    id: month.id,
    label: month.label,
    income: month.income,
    pool: month.pool,
    status: settled ? '已結算' : '進行中',
    settledAt: settled ? (month.settledAt || '') : '',
    spentA: settled ? month.spentA : '',
    spentB: settled ? month.spentB : '',
    totalSpent: settled ? month.totalSpent : '',
    poolRemain: settled ? month.poolRemain : '',
    net: settled ? month.net : '',
    fairShare: settled ? month.fairShare : '',
    debtor: settled ? (month.debtor || '') : '',
    creditor: settled ? (month.creditor || '') : '',
    oweAmount: settled ? month.oweAmount : '',
    createdAt: month.createdAt || ''
  };
}

function readExpenses(ss) {
  return readTable(ss, SHEET_EXPENSES, EXPENSE_COLUMNS).map(normalizeExpense);
}

function writeExpenses(ss, expenses) {
  var rows = expenses.slice().sort(function (a, b) {
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.createdAt) < String(b.createdAt) ? -1 : 1;
  }).map(expenseToRow);
  writeTable(ss, SHEET_EXPENSES, EXPENSE_COLUMNS, rows);
}

function readMonths(ss) {
  return readTable(ss, SHEET_MONTHS, MONTH_COLUMNS).map(normalizeMonth);
}

function writeMonths(ss, months) {
  var rows = months.slice().sort(function (a, b) {
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return String(a.createdAt) < String(b.createdAt) ? -1 : 1;
  }).map(monthToRow);
  writeTable(ss, SHEET_MONTHS, MONTH_COLUMNS, rows);
}

function publicExpense(expense) {
  return {
    id: expense.id,
    amount: expense.amount,
    category: expense.category,
    payer: expense.payer,
    date: expense.date,
    note: expense.note,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt
  };
}

function publicMonth(month) {
  var settlement = null;
  if (month.status === 'settled') {
    settlement = {
      spentA: month.spentA,
      spentB: month.spentB,
      totalSpent: month.totalSpent,
      income: month.income,
      pool: month.pool,
      poolRemain: month.poolRemain,
      net: month.net,
      fairShare: month.fairShare,
      debtor: month.debtor || null,
      creditor: month.creditor || null,
      oweAmount: month.oweAmount
    };
  }
  return {
    id: month.id,
    label: month.label,
    income: month.income,
    pool: month.pool,
    expenses: month.expenses || [],
    settlement: settlement,
    settledAt: month.settledAt || null
  };
}

function blankMonth() {
  return {
    id: '',
    label: '',
    income: 0,
    pool: 0,
    status: 'current',
    settledAt: '',
    spentA: 0,
    spentB: 0,
    totalSpent: 0,
    poolRemain: 0,
    net: 0,
    fairShare: 0,
    debtor: '',
    creditor: '',
    oweAmount: 0,
    createdAt: '',
    expenses: []
  };
}

function composeState(ss) {
  var settings = readSettings(ss);
  var people = [
    { id: 'a', name: String(settings['參與者A'] || '你') },
    { id: 'b', name: String(settings['參與者B'] || '另一半') }
  ];
  var months = readMonths(ss);
  var expenses = readExpenses(ss);
  var currentId = String(settings['目前月份編號'] || '');
  var current = null;
  months.forEach(function (month) {
    if (month.status === 'current' && month.id === currentId) current = month;
  });
  if (!current) {
    months.forEach(function (month) {
      if (!current && month.status === 'current') current = month;
    });
  }
  if (!current) current = blankMonth();

  function attach(month) {
    month.expenses = expenses.filter(function (expense) {
      return expense.monthId === month.id && !expense.deleted;
    }).map(publicExpense);
    return month;
  }

  attach(current);
  var history = months.filter(function (month) { return month.status === 'settled'; });
  history.forEach(attach);

  return {
    setupDone: yes(settings['已完成設定']),
    kittyName: String(settings['名稱'] || '家庭收支'),
    currency: CURRENCIES.indexOf(String(settings['貨幣'] || '')) >= 0 ? String(settings['貨幣']) : 'HKD',
    people: people,
    current: publicMonth(current),
    history: history.map(publicMonth),
    updatedAt: String(settings['更新時間'] || ''),
    revision: Number(settings['修訂'] || 0)
  };
}

function touch(ss) {
  var revision = Number(readSettings(ss)['修訂'] || 0) + 1;
  var now = new Date().toISOString();
  writeSettings(ss, {
    '修訂': revision,
    '更新時間': now,
    '明細修訂': ''
  });
  return now;
}

function namesFromSettings(ss) {
  var settings = readSettings(ss);
  return {
    a: String(settings['參與者A'] || '你'),
    b: String(settings['參與者B'] || '另一半')
  };
}

function refreshPayerNames(ss) {
  var names = namesFromSettings(ss);
  var expenses = readExpenses(ss);
  expenses.forEach(function (expense) {
    expense.payerName = expense.payer === 'b' ? names.b : names.a;
  });
  writeExpenses(ss, expenses);
}

function finalizeState(ss) {
  var state = composeState(ss);
  var settings = readSettings(ss);
  if (String(settings['明細修訂'] || '') !== String(state.revision)) {
    rebuildDetail(ss, state);
    writeSettings(ss, { '明細修訂': state.revision });
  }
  state.spreadsheetUrl = ss.getUrl();
  var detail = ss.getSheetByName(SHEET_DETAIL);
  state.detailUrl = ss.getUrl() + '#gid=' + detail.getSheetId();
  return state;
}

function seedIfNeeded(ss) {
  var settings = readSettings(ss);
  if (yes(settings['已初始化'])) return;
  if (readMonths(ss).length) {
    writeSettings(ss, { '已初始化': '是' });
    return;
  }
  seedLegacy(ss);
}

function seedLegacy(ss) {
  var names = { a: 'Tong', b: 'Momo' };
  writeSettings(ss, {
    '已完成設定': '是',
    '已初始化': '是',
    '名稱': '家庭收支',
    '貨幣': 'HKD',
    '參與者A': names.a,
    '參與者B': names.b,
    '目前月份編號': LEGACY_MONTH_ID,
    '修訂': 1,
    '更新時間': LEGACY_UPDATED_AT,
    '明細修訂': ''
  });
  writeMonths(ss, [{
    id: LEGACY_MONTH_ID,
    label: '2026-08',
    income: 0,
    pool: 11000,
    status: 'current',
    settledAt: '',
    createdAt: LEGACY_UPDATED_AT
  }]);
  writeExpenses(ss, legacyExpenses().map(function (row) {
    row.payerName = row.payer === 'b' ? names.b : names.a;
    return row;
  }));
  var state = composeState(ss);
  rebuildDetail(ss, state);
  writeSettings(ss, { '明細修訂': 1 });
}

function legacyExpenses() {
  var rows = [
    ['id_msyst3dh_qpdxhr', 580, '日常用品', 'b', '2026-08-17', 'Francfranc餐具'],
    ['id_msyt6b6l_6ebx60', 1300, '日常用品', 'b', '2026-08-18', 'SaraHome'],
    ['id_mt4883wd_23dtah', 73, '膳食', 'a', '2026-08-22', 'Aeon晚飯'],
    ['id_mt56akap_nmdjb8', 92, '膳食', 'a', '2026-08-23', 'Breakfast'],
    ['id_mtcx80uh_yojtrz', 160, '膳食', 'a', '2026-08-28', '一田dinner'],
    ['id_mtdvuvqa_ygkdj6', 156, '日常用品', 'a', '2026-08-29', '無印良品廚房用具'],
    ['id_mtp79drm_fdst1a', 130, '膳食', 'a', '2026-09-05', 'Cook dinner'],
    ['id_mtp79w82_5z42bi', 90, '膳食', 'a', '2026-09-06', 'Breakfast novowalk'],
    ['id_mtz7yin8_ggjm2g', 184, '膳食', 'a', '2026-09-12', 'Dinner+榴連'],
    ['id_mtz7ytom_jaavmi', 88, '膳食', 'a', '2026-09-13', '早餐'],
    ['id_muhrp6f0_oix7sn', 90, '膳食', 'a', '2026-09-20', '早餐意樂'],
    ['id_mukmkokl_u72rvv', 89, '膳食', 'a', '2026-09-26', '早餐mac 意樂'],
    ['id_mukmo6cu_li1o2s', 160, '膳食', 'a', '2026-09-26', '一田/Aeon 晚餐'],
    ['id_mukmot31_lcsqao', 89, '膳食', 'a', '2026-09-27', '早餐意樂'],
    ['id_mv1ndn7n_n9wig0', 70, '膳食', 'a', '2026-10-09', 'Dinner惠康'],
    ['id_mv1ndzft_78vbaz', 91, '膳食', 'a', '2026-10-10', '早餐'],
    ['id_mv1nev2f_e98w7q', 467, '月費', 'a', '2026-10-10', '電費7-9月']
  ];
  return rows.map(function (row) {
    return {
      id: row[0],
      monthId: LEGACY_MONTH_ID,
      amount: row[1],
      category: row[2],
      payer: row[3],
      payerName: '',
      date: row[4],
      note: row[5],
      createdAt: LEGACY_UPDATED_AT,
      updatedAt: LEGACY_UPDATED_AT,
      deleted: false
    };
  });
}

function currentMonthId(ss) {
  return String(readSettings(ss)['目前月份編號'] || '');
}

function requireCurrentMonth(ss) {
  var months = readMonths(ss);
  var id = currentMonthId(ss);
  for (var i = 0; i < months.length; i++) {
    if (months[i].id === id && months[i].status === 'current') return months;
  }
  throw new Error('尚未建立進行中的月份');
}

function validateExpenseInput(input) {
  var amount = num(input.amount);
  if (!(amount > 0) || amount > 99999999) throw new Error('請輸入有效金額');
  var category = String(input.category || '');
  if (CATEGORIES.indexOf(category) < 0) throw new Error('分類不正確');
  var payer = String(input.payer || '');
  if (payer !== 'a' && payer !== 'b') throw new Error('付款人不正確');
  var date = asDateString(input.date);
  if (!date) throw new Error('請輸入日期');
  return {
    amount: amount,
    category: category,
    payer: payer,
    date: date,
    note: clip(plainText(input.note), 120)
  };
}

function upsertExpense(ss, input) {
  input = input || {};
  var fields = validateExpenseInput(input);
  var months = requireCurrentMonth(ss);
  var monthId = currentMonthId(ss);
  var names = namesFromSettings(ss);
  var expenses = readExpenses(ss);
  var id = clip(input.id, 80) || uid();
  var now = new Date().toISOString();
  var index = -1;
  expenses.forEach(function (expense, i) {
    if (expense.id === id) index = i;
  });

  if (index >= 0) {
    if (expenses[index].monthId !== monthId) throw new Error('已結算月份的支出不能修改');
    var expected = input.expectedUpdatedAt ? String(input.expectedUpdatedAt) : '';
    if (expected && expenses[index].updatedAt && expected !== expenses[index].updatedAt) {
      return { conflict: true, expense: publicExpense(expenses[index]) };
    }
    expenses[index].amount = fields.amount;
    expenses[index].category = fields.category;
    expenses[index].payer = fields.payer;
    expenses[index].payerName = fields.payer === 'b' ? names.b : names.a;
    expenses[index].date = fields.date;
    expenses[index].note = fields.note;
    expenses[index].updatedAt = now;
    expenses[index].deleted = false;
    if (!expenses[index].createdAt) expenses[index].createdAt = now;
  } else {
    expenses.push({
      id: id,
      monthId: monthId,
      amount: fields.amount,
      category: fields.category,
      payer: fields.payer,
      payerName: fields.payer === 'b' ? names.b : names.a,
      date: fields.date,
      note: fields.note,
      createdAt: now,
      updatedAt: now,
      deleted: false
    });
  }
  writeExpenses(ss, expenses);
  touch(ss);
  return { conflict: false, expense: { id: id } };
}

function deleteExpense(ss, input) {
  var id = String(input && input.id || '');
  if (!id) throw new Error('找不到這筆支出');
  var monthId = currentMonthId(ss);
  var expenses = readExpenses(ss);
  var found = null;
  expenses.forEach(function (expense) {
    if (expense.id === id) found = expense;
  });
  if (!found) throw new Error('找不到這筆支出');
  if (found.monthId !== monthId) throw new Error('已結算月份的支出不能刪除');
  found.deleted = true;
  found.updatedAt = new Date().toISOString();
  writeExpenses(ss, expenses);
  touch(ss);
}

function patchMonth(ss, input) {
  input = input || {};
  var months = requireCurrentMonth(ss);
  var monthId = currentMonthId(ss);
  if (input.monthId && String(input.monthId) !== monthId) {
    throw new Error('只能修改進行中的月份');
  }
  var changed = false;
  months.forEach(function (month) {
    if (month.id !== monthId) return;
    if (input.income !== undefined) {
      var income = num(input.income);
      if (income < 0) throw new Error('收入不可為負數');
      month.income = income;
      changed = true;
    }
    if (input.pool !== undefined) {
      var pool = num(input.pool);
      if (pool < 0) throw new Error('夾錢不可為負數');
      month.pool = pool;
      changed = true;
    }
  });
  if (!changed) return;
  writeMonths(ss, months);
  touch(ss);
}

function updateKitty(ss, input, creating) {
  input = input || {};
  var name = clip(input.kittyName, 60) || '家庭收支';
  var currency = CURRENCIES.indexOf(String(input.currency || '')) >= 0 ? String(input.currency) : 'HKD';
  var personA = clip(input.personA, 30) || '你';
  var personB = clip(input.personB, 30) || '另一半';
  var patch = {
    '已完成設定': '是',
    '已初始化': '是',
    '名稱': name,
    '貨幣': currency,
    '參與者A': personA,
    '參與者B': personB
  };
  if (creating || !currentMonthId(ss)) {
    var id = uid();
    var months = readMonths(ss);
    months.push({
      id: id,
      label: monthLabelNow(),
      income: 0,
      pool: 0,
      status: 'current',
      settledAt: '',
      createdAt: new Date().toISOString()
    });
    writeMonths(ss, months);
    patch['目前月份編號'] = id;
  }
  writeSettings(ss, patch);
  refreshPayerNames(ss);
  touch(ss);
}

function settleMonth(ss, input) {
  var monthId = String(input && input.monthId || '');
  var currentId = currentMonthId(ss);
  if (!monthId || monthId !== currentId) {
    throw new Error('這個月份已經結算，或另一位剛剛完成結算');
  }
  var months = requireCurrentMonth(ss);
  var state = composeState(ss);
  var summary = computeSummary(state.current);
  var now = new Date().toISOString();
  var next = nextLabel(state.current.label);
  months.forEach(function (month) {
    if (month.label === next) throw new Error('下一個月份已存在');
  });
  months.forEach(function (month) {
    if (month.id !== monthId) return;
    month.status = 'settled';
    month.settledAt = now;
    month.spentA = summary.spentA;
    month.spentB = summary.spentB;
    month.totalSpent = summary.totalSpent;
    month.poolRemain = summary.poolRemain;
    month.net = summary.net;
    month.fairShare = summary.fairShare;
    month.debtor = summary.debtor || '';
    month.creditor = summary.creditor || '';
    month.oweAmount = summary.oweAmount;
  });
  var newId = uid();
  months.push({
    id: newId,
    label: next,
    income: 0,
    pool: 0,
    status: 'current',
    settledAt: '',
    createdAt: now
  });
  writeMonths(ss, months);
  writeSettings(ss, { '目前月份編號': newId });
  touch(ss);
  return { settledLabel: state.current.label, nextLabel: next };
}

function importState(ss, data) {
  if (!data || !data.current || !Array.isArray(data.people) || data.people.length < 2) {
    throw new Error('缺少必要欄位（people / current）');
  }
  var personA = clip(data.people[0].name, 30) || '你';
  var personB = clip(data.people[1].name, 30) || '另一半';
  var currency = CURRENCIES.indexOf(String(data.currency || '')) >= 0 ? String(data.currency) : 'HKD';
  var months = [];
  var expenses = [];

  function addMonth(source, status) {
    var id = clip(source.id, 80) || uid();
    var settlement = source.settlement || null;
    var settled = status === 'settled';
    months.push({
      id: id,
      label: clip(source.label, 20) || monthLabelNow(),
      income: Math.max(0, num(source.income)),
      pool: Math.max(0, num(source.pool)),
      status: settled ? 'settled' : 'current',
      settledAt: settled ? String(source.settledAt || new Date().toISOString()) : '',
      spentA: settled && settlement ? num(settlement.spentA) : 0,
      spentB: settled && settlement ? num(settlement.spentB) : 0,
      totalSpent: settled && settlement ? num(settlement.totalSpent) : 0,
      poolRemain: settled && settlement ? num(settlement.poolRemain) : 0,
      net: settled && settlement ? num(settlement.net) : 0,
      fairShare: settled && settlement ? num(settlement.fairShare) : 0,
      debtor: settled && settlement && (settlement.debtor === 'a' || settlement.debtor === 'b') ? settlement.debtor : '',
      creditor: settled && settlement && (settlement.creditor === 'a' || settlement.creditor === 'b') ? settlement.creditor : '',
      oweAmount: settled && settlement ? num(settlement.oweAmount) : 0,
      createdAt: String(source.settledAt || new Date().toISOString())
    });
    (source.expenses || []).forEach(function (expense) {
      var payer = expense.payer === 'b' ? 'b' : 'a';
      expenses.push({
        id: clip(expense.id, 80) || uid(),
        monthId: id,
        amount: num(expense.amount),
        category: CATEGORIES.indexOf(String(expense.category || '')) >= 0 ? String(expense.category) : '其他',
        payer: payer,
        payerName: payer === 'b' ? personB : personA,
        date: asDateString(expense.date) || asDateString(new Date()),
        note: clip(plainText(expense.note), 120),
        createdAt: String(expense.createdAt || new Date().toISOString()),
        updatedAt: String(expense.updatedAt || new Date().toISOString()),
        deleted: false
      });
    });
  }

  (data.history || []).forEach(function (month) { addMonth(month, 'settled'); });
  addMonth(data.current, 'current');
  writeMonths(ss, months);
  writeExpenses(ss, expenses);
  var current = months[months.length - 1];
  writeSettings(ss, {
    '已完成設定': '是',
    '已初始化': '是',
    '名稱': clip(data.kittyName, 60) || '家庭收支',
    '貨幣': currency,
    '參與者A': personA,
    '參與者B': personB,
    '目前月份編號': current.id
  });
  touch(ss);
}

function clearAll(ss) {
  writeMonths(ss, []);
  writeExpenses(ss, []);
  var revision = Number(readSettings(ss)['修訂'] || 0) + 1;
  writeSettings(ss, {
    '已完成設定': '否',
    '已初始化': '是',
    '名稱': '家庭收支',
    '貨幣': 'HKD',
    '參與者A': '你',
    '參與者B': '另一半',
    '目前月份編號': '',
    '修訂': revision,
    '更新時間': new Date().toISOString(),
    '明細修訂': ''
  });
}

function rebuildDetail(ss, state) {
  var sheet = ss.getSheetByName(SHEET_DETAIL);
  var rows = [];
  function add(a, b, c, d, e, f) {
    rows.push([
      a === undefined || a === null ? '' : a,
      b === undefined || b === null ? '' : b,
      c === undefined || c === null ? '' : c,
      d === undefined || d === null ? '' : d,
      e === undefined || e === null ? '' : e,
      f === undefined || f === null ? '' : f
    ]);
  }
  function byDate(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1;
  }

  var summary = computeSummary(state.current);
  add('HomeSplit 明細');
  add('此工作表由程式自動產生，下次寫入會覆蓋。請用網頁輸入；原始紀錄在「支出」。');
  add('');
  add('名稱', state.kittyName);
  add('貨幣', state.currency);
  add('參與者A', state.people[0].name);
  add('參與者B', state.people[1].name);
  add('月份', state.current.label);
  add('更新時間', state.updatedAt);
  add('修訂', state.revision);
  add('');
  add('摘要');
  add('家庭總收入', summary.income);
  add('共同夾錢', summary.pool);
  add('總支出', summary.totalSpent);
  add('夾錢剩餘', summary.poolRemain);
  add('本月淨收支', summary.net);
  add(state.people[0].name + ' 支出', summary.spentA);
  add(state.people[1].name + ' 支出', summary.spentB);
  add('每人應負擔', summary.fairShare);
  add('結算', settlementText(summary, state));
  add('');
  add('分類總支出');
  add('分類', '金額');
  CATEGORIES.forEach(function (category) {
    add(category, summary.byCat[category] || 0);
  });
  add('');
  add('本月支出明細');
  add('序號', '日期', '金額', '分類', '付款人', '說明');
  var currentExpenses = (state.current.expenses || []).slice().sort(byDate);
  if (!currentExpenses.length) add('（無支出）');
  currentExpenses.forEach(function (expense, index) {
    add(index + 1, expense.date, expense.amount, expense.category, personName(state, expense.payer), expense.note);
  });
  add('');
  add('歷史月份');
  add('月份', '結算日', '收入', '總支出', '淨收支', '結算');
  if (!state.history.length) add('（尚無已結算月份）');
  state.history.forEach(function (month) {
    var stored = month.settlement;
    var live = computeSummary(month);
    var used = stored ? {
      income: stored.income,
      totalSpent: stored.totalSpent,
      net: stored.net,
      debtor: stored.debtor,
      creditor: stored.creditor,
      oweAmount: stored.oweAmount
    } : live;
    add(
      month.label,
      month.settledAt ? String(month.settledAt).slice(0, 10) : '',
      used.income,
      used.totalSpent,
      used.net,
      settlementText(used, state)
    );
    (month.expenses || []).slice().sort(byDate).forEach(function (expense) {
      add('', expense.date, expense.amount, expense.category, personName(state, expense.payer), expense.note);
    });
  });

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  if (sheet.setFrozenRows) sheet.setFrozenRows(1);
  if (sheet.setColumnWidth) {
    [160, 220, 140, 120, 140, 280].forEach(function (width, index) {
      try { sheet.setColumnWidth(index + 1, width); } catch (err) {}
    });
  }
  rows.forEach(function (row, index) {
    var label = String(row[0] || '');
    var important = index === 0 ||
      label === '摘要' || label === '分類總支出' || label === '本月支出明細' ||
      label === '歷史月份' || label === '序號' || label === '分類';
    if (!important) return;
    var range = sheet.getRange(index + 1, 1, 1, 6);
    if (range.setFontWeight) range.setFontWeight('bold');
  });
  var wrap = sheet.getRange(1, 1, rows.length, 6);
  if (wrap.setWrap) wrap.setWrap(true);
}
