/**
 * HomeSplit 網頁入口。
 * 部署為網頁應用程式後，doGet 會把 Index.html 交給兩位用家。
 * 瀏覽器只呼叫 api*；每一筆帳單由 SheetRepo 寫進同一個試算表。
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HomeSplit — 家庭收支')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function safeApi(fn) {
  try {
    return fn();
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : String(err) };
  }
}

function apiGetState() {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiSetup(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      var creating = !yes(readSettings(ss)['已完成設定']);
      updateKitty(ss, input || {}, creating);
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiUpdateKitty(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      if (!yes(readSettings(ss)['已完成設定'])) throw new Error('請先建立家庭收支');
      updateKitty(ss, input || {}, false);
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiPatchMonth(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      patchMonth(ss, input || {});
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiUpsertExpense(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      var outcome = upsertExpense(ss, input || {});
      return {
        ok: true,
        conflict: !!outcome.conflict,
        expense: outcome.expense,
        state: finalizeState(ss)
      };
    });
  });
}

function apiDeleteExpense(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      deleteExpense(ss, input || {});
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiSettle(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      var outcome = settleMonth(ss, input || {});
      return {
        ok: true,
        settledLabel: outcome.settledLabel,
        nextLabel: outcome.nextLabel,
        state: finalizeState(ss)
      };
    });
  });
}

function apiImport(input) {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      importState(ss, input || {});
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiClearAll() {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      clearAll(ss);
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function apiRebuildDetail() {
  return safeApi(function () {
    return withLock(function () {
      var ss = getSpreadsheetUnlocked();
      var state = composeState(ss);
      rebuildDetail(ss, state);
      writeSettings(ss, { '明細修訂': state.revision });
      return { ok: true, state: finalizeState(ss) };
    });
  });
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('HomeSplit')
      .addItem('重新產生明細', 'menuRebuildDetail')
      .addItem('顯示網頁網址', 'menuShowWebAppUrl')
      .addToUi();
  } catch (err) {}
}

function menuRebuildDetail() {
  var result = apiRebuildDetail();
  try {
    SpreadsheetApp.getUi().alert(result.ok ? '明細已更新。' : ('無法更新明細：' + result.error));
  } catch (err) {}
}

function menuShowWebAppUrl() {
  var url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (err) {
    url = '';
  }
  var message = url
    ? '把這個網址交給兩人，用同一頁輸入帳單：\n' + url
    : '請先部署為網頁應用程式（執行身分選「我」），網址才會出現。';
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err2) {}
}
