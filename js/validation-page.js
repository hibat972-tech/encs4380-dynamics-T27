/*
 * validation-page.js — runs all six checks and shows a summary.
 */
(function () {
  'use strict';
  function run() {
    const results = DynValidation.render(document.getElementById('v-tests'));
    const n = results.filter(function (r) { return r.pass; }).length;
    document.getElementById('v-summary').innerHTML =
      '<span class="big">' + n + ' / ' + results.length + '</span><span>checks pass</span>' +
      (n === results.length ? '<span class="status status-pass"><span aria-hidden="true">✓</span> All pass</span>'
        : '<span class="status status-fail"><span aria-hidden="true">✗</span> ' + (results.length - n) + ' failing</span>');
    document.getElementById('v-time').textContent = 'Last run: ' + new Date().toLocaleString() + ', in this browser.';
  }
  document.getElementById('v-rerun').addEventListener('click', run);
  run();
})();
