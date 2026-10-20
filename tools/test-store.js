'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasMock } = require('./gas-mock');

const root = path.join(__dirname, '..');
const mock = createGasMock();
const context = {
  SpreadsheetApp: mock.SpreadsheetApp,
  PropertiesService: mock.PropertiesService,
  LockService: mock.LockService,
  Utilities: mock.Utilities,
  Logger: mock.Logger,
  HtmlService: mock.HtmlService,
  ScriptApp: mock.ScriptApp,
  console: console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'SheetRepo.gs'), 'utf8'), context, { filename: 'SheetRepo.gs' });
vm.runInContext(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8'), context, { filename: 'Code.gs' });

function fresh() {
  mock.reset();
  const result = context.apiGetState();
  assert.strictEqual(result.ok, true, result.error);
  return result.state;
}

function sheetValues(state, name) {
  const id = mock.state.props.SPREADSHEET_ID;
  const book = mock.SpreadsheetApp.openById(id);
  const sheet = book.getSheetByName(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

function flat(values) {
  return values.map(function (row) { return row.join(' | '); }).join('\n');
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  FAIL ' + name);
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

console.log('HomeSplit store');

test('載入既有 Kitty、Tong／Momo 與 17 筆支出', function () {
  const state = fresh();
  assert.strictEqual(state.setupDone, true);
  assert.strictEqual(state.kittyName, '家庭收支');
  assert.strictEqual(state.currency, 'HKD');
  assert.strictEqual(state.people[0].name, 'Tong');
  assert.strictEqual(state.people[1].name, 'Momo');
  assert.strictEqual(state.current.label, '2026-08');
  assert.strictEqual(state.current.pool, 11000);
  assert.strictEqual(state.current.income, 0);
  assert.strictEqual(state.current.expenses.length, 17);
  assert.ok(state.spreadsheetUrl.indexOf('docs.google.com') >= 0);
  assert.ok(state.detailUrl.indexOf('#gid=') >= 0);
});

test('分帳金額與既有帳單一致', function () {
  const state = fresh();
  const summary = context.computeSummary(state.current);
  assert.strictEqual(summary.totalSpent, 3909);
  assert.strictEqual(summary.spentA, 2029);
  assert.strictEqual(summary.spentB, 1880);
  assert.strictEqual(summary.fairShare, 1954.5);
  assert.strictEqual(summary.oweAmount, 74.5);
  assert.strictEqual(summary.debtor, 'b');
  assert.strictEqual(summary.creditor, 'a');
  assert.strictEqual(summary.poolRemain, 7091);
  assert.strictEqual(summary.net, -3909);
  assert.strictEqual(summary.byCat['膳食'], 1406);
  assert.strictEqual(summary.byCat['日常用品'], 2036);
  assert.strictEqual(summary.byCat['月費'], 467);
  assert.strictEqual(summary.byCat['其他'], 0);
});

test('明細工作表包含逐筆說明與結算句子', function () {
  const state = fresh();
  const text = flat(sheetValues(state, '明細'));
  assert.ok(text.indexOf('Francfranc餐具') >= 0);
  assert.ok(text.indexOf('電費7-9月') >= 0);
  assert.ok(text.indexOf('本月支出明細') >= 0);
  assert.ok(text.indexOf('Momo 應支付 HKD 74.50 給 Tong') >= 0);
  assert.ok(text.indexOf('分類總支出') >= 0);
  const expenseSheet = sheetValues(state, '支出');
  assert.strictEqual(expenseSheet[0][0], '支出編號');
  assert.strictEqual(expenseSheet.length, 18);
});

test('兩人各自新增帳單都會留下，不會整份覆蓋', function () {
  fresh();
  const first = context.apiUpsertExpense({
    id: 'id_user_a_bill',
    amount: 10,
    category: '膳食',
    payer: 'a',
    date: '2026-10-19',
    note: 'A的帳單'
  });
  const second = context.apiUpsertExpense({
    id: 'id_user_b_bill',
    amount: 20,
    category: '月費',
    payer: 'b',
    date: '2026-10-19',
    note: 'B的帳單'
  });
  assert.strictEqual(first.ok, true, first.error);
  assert.strictEqual(second.ok, true, second.error);
  assert.strictEqual(first.conflict, false);
  const notes = context.apiGetState().state.current.expenses.map(function (e) { return e.note; });
  assert.ok(notes.indexOf('A的帳單') >= 0);
  assert.ok(notes.indexOf('B的帳單') >= 0);
  assert.ok(notes.indexOf('Francfranc餐具') >= 0);
  assert.strictEqual(notes.length, 19);
  const detail = flat(sheetValues(null, '明細'));
  assert.ok(detail.indexOf('A的帳單') >= 0);
  assert.ok(detail.indexOf('B的帳單') >= 0);
});

test('同一筆同時修改時，後寫入的人收到衝突而不是蓋掉', function () {
  const state = fresh();
  const expense = state.current.expenses[0];
  const first = context.apiUpsertExpense({
    id: expense.id,
    amount: 600,
    category: expense.category,
    payer: expense.payer,
    date: expense.date,
    note: expense.note,
    expectedUpdatedAt: expense.updatedAt
  });
  assert.strictEqual(first.ok, true, first.error);
  assert.strictEqual(first.conflict, false);
  const stale = context.apiUpsertExpense({
    id: expense.id,
    amount: 700,
    category: expense.category,
    payer: expense.payer,
    date: expense.date,
    note: '舊畫面',
    expectedUpdatedAt: expense.updatedAt
  });
  assert.strictEqual(stale.ok, true, stale.error);
  assert.strictEqual(stale.conflict, true);
  const saved = context.apiGetState().state.current.expenses.find(function (e) { return e.id === expense.id; });
  assert.strictEqual(saved.amount, 600);
  assert.strictEqual(saved.note, expense.note);
});

test('收入與夾錢分開寫入，不會互相還原', function () {
  const state = fresh();
  const income = context.apiPatchMonth({ monthId: state.current.id, income: 5000 });
  const pool = context.apiPatchMonth({ monthId: state.current.id, pool: 12000 });
  assert.strictEqual(income.ok, true, income.error);
  assert.strictEqual(pool.ok, true, pool.error);
  const after = context.apiGetState().state.current;
  assert.strictEqual(after.income, 5000);
  assert.strictEqual(after.pool, 12000);
});

test('結算只會成功一次，歷史月份保留明細', function () {
  const state = fresh();
  const first = context.apiSettle({ monthId: state.current.id });
  assert.strictEqual(first.ok, true, first.error);
  assert.strictEqual(first.settledLabel, '2026-08');
  assert.strictEqual(first.nextLabel, '2026-09');
  assert.strictEqual(first.state.history.length, 1);
  assert.strictEqual(first.state.history[0].expenses.length, 17);
  assert.strictEqual(first.state.current.label, '2026-09');
  assert.strictEqual(first.state.current.expenses.length, 0);
  const second = context.apiSettle({ monthId: state.current.id });
  assert.strictEqual(second.ok, false);
  const after = context.apiGetState().state;
  assert.strictEqual(after.history.length, 1);
  const detail = flat(sheetValues(after, '明細'));
  assert.ok(detail.indexOf('歷史月份') >= 0);
  assert.ok(detail.indexOf('電費7-9月') >= 0);
});

test('刪除只標示已刪除，原始列仍留在試算表', function () {
  const state = fresh();
  const target = state.current.expenses.find(function (e) { return e.note === '電費7-9月'; });
  const result = context.apiDeleteExpense({ id: target.id });
  assert.strictEqual(result.ok, true, result.error);
  const notes = result.state.current.expenses.map(function (e) { return e.note; });
  assert.ok(notes.indexOf('電費7-9月') < 0);
  assert.strictEqual(result.state.current.expenses.length, 16);
  const rows = sheetValues(result.state, '支出');
  const kept = rows.filter(function (row) { return row.join(' ').indexOf('電費7-9月') >= 0; });
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0][10], '是');
});

test('以等號開頭的說明不會變成試算表公式', function () {
  fresh();
  const result = context.apiUpsertExpense({
    id: 'id_formula',
    amount: 1,
    category: '其他',
    payer: 'a',
    date: '2026-10-19',
    note: '=HYPERLINK("http://example.test")'
  });
  assert.strictEqual(result.ok, true, result.error);
  const saved = result.state.current.expenses.find(function (e) { return e.id === 'id_formula'; });
  assert.strictEqual(saved.note, '=HYPERLINK("http://example.test")');
  const rows = sheetValues(result.state, '支出');
  const cell = rows.filter(function (row) { return row[0] === 'id_formula'; })[0][7];
  assert.ok(String(cell).charCodeAt(0) === 0x200B);
});

test('清除後不會把舊帳自動種回去，重新建立會開新月份', function () {
  fresh();
  const cleared = context.apiClearAll();
  assert.strictEqual(cleared.ok, true, cleared.error);
  assert.strictEqual(cleared.state.setupDone, false);
  assert.strictEqual(cleared.state.current.expenses.length, 0);
  const again = context.apiGetState();
  assert.strictEqual(again.state.setupDone, false);
  assert.strictEqual(again.state.current.expenses.length, 0);
  const created = context.apiSetup({
    kittyName: '新的家',
    currency: 'HKD',
    personA: '甲',
    personB: '乙'
  });
  assert.strictEqual(created.ok, true, created.error);
  assert.strictEqual(created.state.kittyName, '新的家');
  assert.strictEqual(created.state.people[0].name, '甲');
  assert.strictEqual(created.state.people[1].name, '乙');
  assert.strictEqual(created.state.current.expenses.length, 0);
  assert.ok(/^\d{4}-\d{2}$/.test(created.state.current.label));
});

test('匯入會覆蓋試算表並保留兩人的支出', function () {
  fresh();
  const imported = context.apiImport({
    kittyName: '匯入測試',
    currency: 'TWD',
    people: [{ id: 'a', name: '小明' }, { id: 'b', name: '小美' }],
    current: {
      id: 'month_1',
      label: '2026-03',
      income: 100,
      pool: 50,
      expenses: [
        { id: 'e1', amount: 30, category: '膳食', payer: 'a', date: '2026-03-01', note: '午餐' },
        { id: 'e2', amount: 30, category: '月費', payer: 'b', date: '2026-03-02', note: '網路' }
      ]
    },
    history: []
  });
  assert.strictEqual(imported.ok, true, imported.error);
  assert.strictEqual(imported.state.currency, 'TWD');
  assert.strictEqual(imported.state.current.expenses.length, 2);
  assert.strictEqual(imported.state.people[1].name, '小美');
  const summary = context.computeSummary(imported.state.current);
  assert.strictEqual(summary.totalSpent, 60);
  assert.strictEqual(summary.debtor, null);
});

test('doGet 可以建立輸入頁', function () {
  const page = context.doGet();
  assert.ok(page);
  assert.strictEqual(typeof page.setTitle, 'function');
});

test('輸入頁保留記帳、結算與明細，不再依賴 GitHub', function () {
  const index = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'App.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'Styles.html'), 'utf8');
  assert.ok(index.indexOf("include('Styles')") >= 0);
  assert.ok(index.indexOf("include('App')") >= 0);
  assert.ok(index.indexOf('exp-amount') >= 0);
  assert.ok(index.indexOf('who-am-i') >= 0);
  assert.ok(index.indexOf('btn-settle') >= 0);
  ['apiGetState', 'apiUpsertExpense', 'apiDeleteExpense', 'apiSettle', 'apiPatchMonth', 'apiImport', 'apiClearAll'].forEach(function (name) {
    assert.ok(app.indexOf(name) >= 0, name);
  });
  assert.ok(app.indexOf('api.github.com') < 0);
  assert.ok(index.indexOf('setup-gh-token') < 0);
  assert.ok(styles.indexOf('.expense-item') >= 0);
  assert.ok(!fs.existsSync(path.join(root, '.github', 'workflows', 'pages.yml')));
});

if (!process.exitCode) {
  console.log(passed + ' passed');
}
