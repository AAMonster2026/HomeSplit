/**
 * 在本機模擬 SpreadsheetApp / LockService / PropertiesService，
 * 讓 SheetRepo.gs 與 Code.gs 可以不連 Google 就跑測試與預覽。
 */
'use strict';

function createGasMock() {
  var state = {
    props: {},
    books: {},
    seq: 1,
    sheetSeq: 1,
    locked: false,
    activeId: null
  };

  function cloneValues(values) {
    return values.map(function (row) { return row.slice(); });
  }

  function Range(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  Range.prototype.getValues = function () {
    var out = [];
    for (var r = 0; r < this.numRows; r++) {
      var source = this.sheet.values[this.row - 1 + r] || [];
      var row = [];
      for (var c = 0; c < this.numCols; c++) {
        var cell = source[this.col - 1 + c];
        row.push(cell === undefined || cell === null ? '' : cell);
      }
      out.push(row);
    }
    return cloneValues(out);
  };

  Range.prototype.getValue = function () {
    return this.getValues()[0][0];
  };

  Range.prototype.setValues = function (values) {
    if (!values || values.length !== this.numRows) {
      throw new Error('setValues 列數不符，預期 ' + this.numRows + ' 實際 ' + (values && values.length));
    }
    for (var r = 0; r < values.length; r++) {
      if (values[r].length !== this.numCols) {
        throw new Error('setValues 欄數不符，預期 ' + this.numCols + ' 實際 ' + values[r].length);
      }
      var index = this.row - 1 + r;
      if (!this.sheet.values[index]) this.sheet.values[index] = [];
      for (var c = 0; c < values[r].length; c++) {
        this.sheet.values[index][this.col - 1 + c] = values[r][c];
      }
    }
    return this;
  };

  Range.prototype.setValue = function (value) {
    return this.setValues([[value]]);
  };

  Range.prototype.setFontWeight = function () { return this; };
  Range.prototype.setBackground = function () { return this; };
  Range.prototype.setWrap = function () { return this; };
  Range.prototype.setNumberFormat = function () { return this; };
  Range.prototype.setFontSize = function () { return this; };

  function Sheet(name) {
    this.name = name;
    this.values = [];
    this.frozenRows = 0;
    this.sheetId = state.sheetSeq++;
    this.widths = {};
  }

  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getSheetId = function () { return this.sheetId; };

  Sheet.prototype.getLastRow = function () {
    for (var r = this.values.length - 1; r >= 0; r--) {
      var row = this.values[r] || [];
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) return r + 1;
      }
    }
    return 0;
  };

  Sheet.prototype.getLastColumn = function () {
    var max = 0;
    this.values.forEach(function (row) {
      for (var c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) {
          if (c + 1 > max) max = c + 1;
          break;
        }
      }
    });
    return max;
  };

  Sheet.prototype.getRange = function (row, col, numRows, numCols) {
    return new Range(this, row, col, numRows === undefined ? 1 : numRows, numCols === undefined ? 1 : numCols);
  };

  Sheet.prototype.clear = function () { this.values = []; return this; };
  Sheet.prototype.clearContents = function () { this.values = []; return this; };
  Sheet.prototype.setFrozenRows = function (n) { this.frozenRows = n; return this; };
  Sheet.prototype.setColumnWidth = function (col, width) { this.widths[col] = width; return this; };

  function Spreadsheet(id, name) {
    this.id = id;
    this.name = name;
    this.sheets = [new Sheet('工作表1')];
  }

  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getName = function () { return this.name; };
  Spreadsheet.prototype.getUrl = function () {
    return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit';
  };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.getSheetByName = function (name) {
    for (var i = 0; i < this.sheets.length; i++) {
      if (this.sheets[i].getName() === name) return this.sheets[i];
    }
    return null;
  };
  Spreadsheet.prototype.insertSheet = function (name) {
    if (this.getSheetByName(name)) throw new Error('工作表已存在：' + name);
    var sheet = new Sheet(name);
    this.sheets.push(sheet);
    return sheet;
  };
  Spreadsheet.prototype.deleteSheet = function (sheet) {
    if (this.sheets.length <= 1) throw new Error('不能刪除最後一個工作表');
    var index = this.sheets.indexOf(sheet);
    if (index < 0) throw new Error('找不到工作表');
    this.sheets.splice(index, 1);
  };

  function formatDate(date, timeZone, pattern) {
    var shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var y = shifted.getUTCFullYear();
    var m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    var d = String(shifted.getUTCDate()).padStart(2, '0');
    if (pattern === 'yyyy-MM') return y + '-' + m;
    if (pattern === 'yyyy-MM-dd') return y + '-' + m + '-' + d;
    return shifted.toISOString();
  }

  var api = {
    state: state,
    SpreadsheetApp: {
      create: function (name) {
        var id = 'sheet_' + state.seq++;
        var book = new Spreadsheet(id, name);
        state.books[id] = book;
        return book;
      },
      openById: function (id) {
        if (!state.books[id]) throw new Error('找不到試算表 ' + id);
        return state.books[id];
      },
      getActiveSpreadsheet: function () {
        return state.activeId ? state.books[state.activeId] : null;
      },
      flush: function () {},
      getUi: function () {
        throw new Error('沒有使用者介面');
      }
    },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (key) {
            return Object.prototype.hasOwnProperty.call(state.props, key) ? state.props[key] : null;
          },
          setProperty: function (key, value) { state.props[key] = String(value); },
          deleteProperty: function (key) { delete state.props[key]; }
        };
      }
    },
    LockService: {
      getScriptLock: function () {
        return {
          waitLock: function () {
            if (state.locked) throw new Error('LockService 重入');
            state.locked = true;
          },
          releaseLock: function () { state.locked = false; }
        };
      }
    },
    Utilities: {
      formatDate: formatDate,
      getUuid: function () { return 'uuid-' + Math.random().toString(36).slice(2); }
    },
    Logger: { log: function () {} },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile: function () {
        return {
          evaluate: function () {
            var page = {
              setTitle: function () { return page; },
              addMetaTag: function () { return page; },
              setXFrameOptionsMode: function () { return page; }
            };
            return page;
          }
        };
      },
      createHtmlOutputFromFile: function () {
        return { getContent: function () { return ''; } };
      }
    },
    ScriptApp: {
      getService: function () {
        return { getUrl: function () { return 'https://script.google.com/macros/s/preview/exec'; } };
      }
    },
    console: console
  };

  api.reset = function () {
    state.props = {};
    state.books = {};
    state.seq = 1;
    state.sheetSeq = 1;
    state.locked = false;
    state.activeId = null;
  };

  return api;
}

module.exports = { createGasMock: createGasMock };
