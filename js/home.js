/*
 * home.js — Home page: live thermometer demo and validation summary.
 * Thermometer (first order, K = 1): from 20 °C into tea at 80 °C at t = 0.
 */
(function () {
  'use strict';
  const M = DynMath, C = UI.C;
  const T0 = 20, T1 = 80;

  const box = document.getElementById('home-controls');
  const left = UI.el('div'), right = UI.el('div');
  box.appendChild(left); box.appendChild(right);
  const tau = UI.slider(left, { label: 'Time constant τ', min: 1, max: 40, step: 0.5, value: 10, unit: 's', digits: 1,
    tip: 'Bigger bulb or thicker glass: bigger τ, slower thermometer.' });
  const tr = UI.slider(right, { label: 'Read it at t', min: 0, max: 120, step: 0.5, value: 10, unit: 's', digits: 1,
    tip: 'The moment you look at the thermometer after dipping it in.' });

  function update() {
    const ta = tau.get(), tRead = tr.get();
    const tEnd = Math.max(5 * ta, tRead * 1.1, 30);
    const t = M.linspace(0, tEnd, 500);
    const y = t.map(function (ti) { return T0 + M.firstOrderStep(ti, 1, ta, T1 - T0); });
    const yRead = T0 + M.firstOrderStep(tRead, 1, ta, T1 - T0);
    const err = T1 - yRead;
    const pct = 100 * (yRead - T0) / (T1 - T0);

    document.getElementById('home-readouts').innerHTML =
      '<div class="readout key"><span class="r-label">Thermometer reads</span><span class="r-value">' + UI.fix(yRead, 1) + ' <small>°C</small></span><span class="r-sub">true tea temperature 80 °C</span></div>' +
      '<div class="readout"><span class="r-label">Dynamic error</span><span class="r-value">' + UI.fix(err, 1) + ' <small>°C</small></span><span class="r-sub">' + UI.fix(pct, 1) + '% of the change done</span></div>' +
      '<div class="readout"><span class="r-label">Reading time in τ</span><span class="r-value">' + UI.fix(tRead / ta, 2) + ' <small>τ</small></span><span class="r-sub">1τ: 63.2%, 3τ: 95%</span></div>';

    UI.plot('home-plot', [
      { x: [-0.05 * tEnd, 0, 0, tEnd], y: [T0, T0, T1, T1], name: 'True temperature (input)', mode: 'lines', line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.1f} °C' },
      { x: [-0.05 * tEnd].concat(t), y: [T0].concat(y), name: 'Thermometer reading (output)', mode: 'lines', line: { color: C.out, width: 3 }, hovertemplate: '%{y:.1f} °C' },
      { x: [tRead], y: [yRead], name: 'Your reading', mode: 'markers', marker: { color: C.mark, size: 11, line: { color: '#fff', width: 2 } }, hovertemplate: '%{y:.1f} °C' }
    ], UI.layout({
      xaxis: UI.axis('Time after dipping t (s)', { range: [-0.05 * tEnd, tEnd] }),
      yaxis: UI.axis('Temperature (°C)', { range: [15, 86] }),
      shapes: [{ type: 'line', x0: tRead, x1: tRead, y0: yRead, y1: T1, xref: 'x', yref: 'y', line: { color: C.mark, width: 2 } }],
      annotations: [{ x: tRead, y: (yRead + T1) / 2, text: 'error ' + UI.fix(err, 1) + ' °C', showarrow: false, xanchor: 'left', xshift: 6,
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' }],
      margin: { l: 50, r: 12, t: 10, b: 44 }
    }));
  }
  const redraw = UI.throttle(update);
  tau.onChange(redraw); tr.onChange(redraw);
  update();

  // validation summary
  const res = DynValidation.runAll();
  const n = res.filter(function (r) { return r.pass; }).length;
  document.getElementById('home-vsummary').innerHTML =
    '<span class="big">' + n + ' / ' + res.length + '</span>' +
    (n === res.length ? '<span class="status status-pass"><span aria-hidden="true">✓</span> All checks pass</span>'
      : '<span class="status status-fail"><span aria-hidden="true">✗</span> ' + (res.length - n) + ' check(s) fail</span>');
})();
