'use strict';

const http = require('http');
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

const APIS = [
  'apiGetState',
  'apiSetup',
  'apiUpdateKitty',
  'apiPatchMonth',
  'apiUpsertExpense',
  'apiDeleteExpense',
  'apiSettle',
  'apiImport',
  'apiClearAll',
  'apiRebuildDetail'
];

function renderPage() {
  let html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('([A-Za-z0-9_-]+)'\);\s*\?>/g, function (_, name) {
    return fs.readFileSync(path.join(root, name + '.html'), 'utf8');
  });
  return html.replace('<!--PREVIEW_SHIM-->', '<script src="/shim.js"></script>');
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const body = renderPage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/shim.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'shim.js')));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api') {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (APIS.indexOf(body.fn) < 0) throw new Error('未知函式');
        const result = body.payload === undefined ? context[body.fn]() : context[body.fn](body.payload);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, result: result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', function () {
  console.log('HomeSplit preview http://127.0.0.1:' + port);
});
