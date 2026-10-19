(function () {
  var NAMES = [
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

  function makeRunner() {
    var ok = function () {};
    var err = function (error) { console.error(error); };
    var runner = {
      withSuccessHandler: function (fn) { ok = fn; return runner; },
      withFailureHandler: function (fn) { err = fn; return runner; }
    };
    NAMES.forEach(function (name) {
      runner[name] = function (payload) {
        var body = { fn: name };
        if (payload !== undefined) body.payload = payload;
        fetch('/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().then(function (data) {
            return { httpOk: res.ok, data: data };
          });
        }).then(function (packed) {
          if (!packed.httpOk || !packed.data || !packed.data.ok) {
            throw new Error((packed.data && packed.data.error) || '請求失敗');
          }
          ok(packed.data.result);
        }).catch(function (error) {
          err(error);
        });
      };
    });
    return runner;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', {
    configurable: true,
    get: function () { return makeRunner(); }
  });
})();
