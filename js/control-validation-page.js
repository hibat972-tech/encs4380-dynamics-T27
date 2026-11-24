/*
 * control-validation-page.js — renders the three Homework 2 validation checks
 * (expected, actual, deviation, tolerance, pass/fail) and a plot for each.
 */
(function () {
  'use strict';
  const C = UI.C, M = DynMath;
  const $ = function (id) { return document.getElementById(id); };

  function badge(pass) {
    return pass ? '<span class="status status-pass"><span aria-hidden="true">✓</span> Pass</span>'
      : '<span class="status status-fail"><span aria-hidden="true">✗</span> Fail</span>';
  }
  function f(v, d) {
    if (!Number.isFinite(v)) return '—';
    if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2).replace('-', '−');
    return String(Number(v.toPrecision(d))).replace('-', '−');
  }

  function render(results) {
    let html = '';
    results.forEach(function (t) {
      html += '<div class="vtest"><div class="vtest-head"><h3>Test ' + t.id + ': ' + t.title + '</h3>' + badge(t.pass) + '</div>';
      html += '<p class="vtest-setup">' + t.setup + '</p>';
      html += '<div class="table-wrap"><table class="vtable"><thead><tr><th>Quantity</th><th>Expected</th><th>Actual (simulation)</th><th>Deviation</th><th>Tolerance</th><th>Method</th><th>Result</th></tr></thead><tbody>';
      t.rows.forEach(function (r) {
        if (r.isInfo) html += '<tr><td>' + r.quantity + '</td><td colspan="5" class="deviation">' + r.infoText + '</td><td><span class="chip">info</span></td></tr>';
        else if (r.isBool) html += '<tr><td>' + r.quantity + '</td><td>' + r.expectedText + '</td><td>' + r.actualText + '</td><td>—</td><td>—</td><td>' + r.method + '</td><td>' + badge(r.pass) + '</td></tr>';
        else html += '<tr><td>' + r.quantity + '</td><td>' + f(r.expected, 6) + r.unit + '</td><td>' + f(r.actual, r.digits) + r.unit + '</td><td class="deviation">' + f(r.deviation, 2) + '</td><td>± ' + f(r.tol, 2) + '</td><td>' + r.method + '</td><td>' + badge(r.pass) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      html += '<div class="plot small" id="cv-plot-' + t.id + '" role="img" aria-label="Simulated response for validation test ' + t.id + '"></div></div>';
    });
    $('cv-tests').innerHTML = html;
    results.forEach(function (t) {
      const traces = t.curves.map(function (c, i) {
        return { x: c.t, y: c.y, name: c.name, mode: 'lines', line: { width: i === 0 ? 3 : 2, color: [C.out, C.mark, C.third, '#8a5ac8', '#c4621f'][i % 5] }, hovertemplate: '%{y:.5g}' };
      });
      if (t.ref) {
        const tt = t.curves[0].t;
        traces.push({ x: tt, y: tt.map(t.ref.y), name: t.ref.name, mode: 'lines', line: { color: '#111', width: 1.6, dash: 'dot' }, hovertemplate: '%{y:.5g}' });
      }
      UI.plot('cv-plot-' + t.id, traces, UI.layout({
        margin: { l: 62, r: 16, t: 56, b: 46 },
        xaxis: UI.axis('Time t (s)'), yaxis: UI.axis(t.normalized ? 'Output / setpoint' : 'Output y(t)', { rangemode: 'tozero' }),
        legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 10.5 } }
      }));
    });
    UI.renderMath($('cv-tests'));
  }

  function run() {
    const results = ControlValidation.runAll();
    render(results);
    const n = results.filter(function (r) { return r.pass; }).length;
    UI.set('cv-summary', '<span class="big">' + n + ' / ' + results.length + '</span><span>checks pass</span>' +
      (n === results.length ? '<span class="status status-pass"><span aria-hidden="true">✓</span> All pass</span>'
        : '<span class="status status-fail"><span aria-hidden="true">✗</span> ' + (results.length - n) + ' failing</span>'));
    $('cv-time').textContent = 'Last run: ' + new Date().toLocaleString() + ', in this browser.';
  }
  $('cv-rerun').addEventListener('click', run);
  run();
})();
