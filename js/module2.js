/*
 * module2.js — First-order frequency response
 *   M = 1/sqrt(1 + (w*tau)^2),  phi = -atan(w*tau),  delta = M - 1
 * Shows: input and output sines on one plot, amplitude ratio, phase lag,
 * a Bode plot with the cut-off at w = 1/tau, and a dynamic-error calculator.
 */
(function () {
  'use strict';
  const M = DynMath, C = UI.C;

  /* ---------------- controls ---------------- */
  const ctl = document.getElementById('m2-controls');
  const tau = UI.slider(ctl, {
    label: 'Time constant τ', min: 0.0001, max: 10, value: 0.2, unit: 's', log: true,
    tip: 'The same τ as in Module 1. Logarithmic slider from 0.1 ms to 10 s; type an exact value in the box.'
  });
  const w = UI.slider(ctl, {
    label: 'Input frequency ω', min: 0.01, max: 100000, value: 2, unit: 'rad/s', log: true,
    tip: 'Angular frequency of the input sine. f = ω/2π in hertz is shown below the slider.'
  });
  const fHint = UI.el('div', { class: 'ctl-hint', id: 'm2-fhint' });
  w.root.appendChild(fHint);
  const A = UI.slider(ctl, {
    label: 'Input amplitude A', min: 0.1, max: 10, step: 0.1, value: 1, unit: 'units',
    tip: 'Peak value of the input sine, in input units.'
  });
  const transient = UI.checkbox(ctl, {
    label: 'Include the start-up transient', checked: false,
    hint: 'Off: only the settled (steady-state) sine. On: the sensor starts from rest at t = 0.'
  });

  /* ---------------- calculation ---------------- */
  function compute() {
    const p = { tau: tau.get(), w: w.get(), A: A.get(), tr: transient.get() };
    p.M = M.magnitudeRatio(p.w, p.tau);
    p.phi = M.phaseDeg(p.w, p.tau);
    p.lagDeg = -p.phi;
    p.dt = (p.lagDeg * M.DEG2RAD) / p.w;            // time lag between peaks
    p.delta = M.dynamicError(p.w, p.tau);
    p.wc = M.cutoffRad(p.tau);
    p.fc = M.cutoffHz(p.tau);
    p.period = M.TWO_PI / p.w;

    // time window: 4 periods, or long enough to see the transient settle
    let nPer = 4;
    if (p.tr) nPer = Math.min(40, Math.max(4, Math.ceil(6 * p.tau / p.period) + 2));
    p.tEnd = nPer * p.period;
    const n = Math.min(8000, Math.max(1200, nPer * 80));
    p.t = M.linspace(0, p.tEnd, n + 1);
    p.x = p.t.map(function (ti) { return p.A * Math.sin(p.w * ti); });
    // output divided by K so it can be compared with the input directly
    p.y = p.t.map(function (ti) { return M.firstOrderSine(ti, 1, p.tau, p.A, p.w, p.tr); });

    // measure amplitude ratio and phase off the simulated curves (last 2 whole periods)
    const i0 = Math.round((nPer - 2) / nPer * n);
    const ts = p.t.slice(i0), xs = p.x.slice(i0), ys = p.y.slice(i0);
    const mx = M.measureSinusoid(ts, xs, p.w), my = M.measureSinusoid(ts, ys, p.w);
    p.measRatio = my.amplitude / mx.amplitude;
    p.measLag = -(my.phase - mx.phase) * M.RAD2DEG;
    if (p.measLag < -180) p.measLag += 360;
    if (p.measLag > 180) p.measLag -= 360;
    return p;
  }

  /* ---------------- drawing ---------------- */
  function readout(label, value, unit, sub, key) {
    return '<div class="readout' + (key ? ' key' : '') + '"><span class="r-label">' + label + '</span>' +
      '<span class="r-value">' + value + (unit ? ' <small>' + unit + '</small>' : '') + '</span>' +
      (sub ? '<span class="r-sub">' + sub + '</span>' : '') + '</div>';
  }

  function drawReadouts(p) {
    let h = '';
    h += readout('Amplitude ratio M', UI.fix(p.M, 4), '', UI.fix(M.toDecibel(p.M), 2) + ' dB; measured on curve ' + UI.fix(p.measRatio, 4), true);
    h += readout('Phase lag |φ|', UI.fix(p.lagDeg, 2), '°', 'φ = −tan⁻¹(ωτ); measured ' + UI.fix(p.measLag, 2) + '°', true);
    h += readout('Dynamic error δ = M − 1', UI.fix(100 * p.delta, 2), '%', 'output amplitude is ' + UI.fix(100 * p.M, 1) + '% of the input');
    h += readout('Time lag Δt = |φ|/ω', UI.fmt(p.dt, 3), 's', 'output peaks this long after the input');
    h += readout('Cut-off ω_c = 1/τ', UI.fmt(p.wc, 4), 'rad/s', 'f_c = ' + UI.fmt(p.fc, 4) + ' Hz');
    h += readout('ωτ = ω/ω_c', UI.fmt(p.w * p.tau, 4), '', p.w * p.tau < 1 ? 'below the cut-off' : (p.w * p.tau > 1 ? 'above the cut-off' : 'at the cut-off'));
    document.getElementById('m2-readouts').innerHTML = h;
    fHint.textContent = 'f = ω/2π = ' + UI.fmt(p.w / M.TWO_PI, 4) + ' Hz, period T = ' + UI.fmt(p.period, 4) + ' s';
  }

  function drawTime(p) {
    const shapes = [], ann = [], traces = [];
    traces.push({ x: p.t, y: p.x, name: 'Input x(t) = A sin ωt', mode: 'lines', line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.4g}' });
    traces.push({ x: p.t, y: p.y, name: 'Output y(t)/K', mode: 'lines', line: { color: C.out, width: 2.5 }, hovertemplate: '%{y:.4g}' });

    // one input peak and the matching output peak, in the settled part of the window
    const kPeak = p.tr ? Math.max(0, Math.floor(p.tEnd / p.period) - 2) : 1;
    const tIn = (0.25 + kPeak) * p.period;
    const tOut = tIn + p.dt;
    const yOut = p.A * p.M;
    traces.push({ x: [tIn, tOut], y: [p.A, yOut], mode: 'markers', name: 'Peaks used for the lag',
      marker: { color: C.mark, size: 9, line: { color: '#fff', width: 2 } }, hovertemplate: '%{y:.4g}' });
    shapes.push({ type: 'line', x0: tIn, x1: tOut, y0: p.A * 1.12, y1: p.A * 1.12, xref: 'x', yref: 'y', line: { color: C.mark, width: 2 } });
    shapes.push({ type: 'line', x0: tIn, x1: tIn, y0: p.A, y1: p.A * 1.16, xref: 'x', yref: 'y', line: { color: C.mark, width: 1, dash: 'dot' } });
    shapes.push({ type: 'line', x0: tOut, x1: tOut, y0: yOut, y1: p.A * 1.16, xref: 'x', yref: 'y', line: { color: C.mark, width: 1, dash: 'dot' } });
    shapes.push({ type: 'line', x0: 0, x1: p.tEnd, y0: yOut, y1: yOut, xref: 'x', yref: 'y', line: { color: C.out, width: 1, dash: 'dot' } });
    ann.push({ x: (tIn + tOut) / 2, y: p.A * 1.12, text: 'Δt = ' + UI.fmt(p.dt, 3) + ' s  (' + UI.fix(p.lagDeg, 1) + '°)', showarrow: false,
      yanchor: 'bottom', yshift: 3, font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
    ann.push({ xref: 'paper', x: 1, y: yOut, text: 'A·M = ' + UI.fmt(yOut, 3), showarrow: false, xanchor: 'right', yanchor: 'bottom',
      font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });

    UI.plot('m2-time', traces, UI.layout({
      xaxis: UI.axis('Time t (s)', { range: [0, p.tEnd] }),
      yaxis: UI.axis('Signal (input units)', { range: [-1.35 * p.A, 1.4 * p.A] }),
      shapes: shapes, annotations: ann
    }));
    document.getElementById('m2-time-caption').textContent = p.tr
      ? 'The sensor starts from rest at t = 0. The output drifts first, then settles into a sine that is A·M high and Δt late. M and φ are measured on the last two periods.'
      : 'Settled (steady-state) response. Dashed: the input. Solid: the output divided by K, so its height can be compared with the input directly.';
  }

  function drawBode(p) {
    const lo = Math.min(0.01 * p.wc, p.w / 3), hi = Math.max(100 * p.wc, 3 * p.w);
    const ws = M.logspace(lo, hi, 400);
    const mag = ws.map(function (wi) { return M.toDecibel(M.magnitudeRatio(wi, p.tau)); });
    const ph = ws.map(function (wi) { return M.phaseDeg(wi, p.tau); });
    const asym = ws.map(function (wi) { return wi <= p.wc ? 0 : -20 * Math.log10(wi / p.wc); });
    const traces = [
      { x: ws, y: mag, name: 'Magnitude 20 log₁₀ M', mode: 'lines', line: { color: C.out, width: 2.5 }, xaxis: 'x', yaxis: 'y', hovertemplate: '%{y:.3g} dB' },
      { x: ws, y: asym, name: 'Asymptotes (0 dB, −20 dB/decade)', mode: 'lines', line: { color: C.inp, width: 1.5, dash: 'dot' }, xaxis: 'x', yaxis: 'y', hoverinfo: 'skip' },
      { x: ws, y: ph, name: 'Phase φ', mode: 'lines', line: { color: C.third, width: 2.5 }, xaxis: 'x', yaxis: 'y2', hovertemplate: '%{y:.3g}°' },
      { x: [p.w], y: [M.toDecibel(p.M)], name: 'Selected ω', mode: 'markers', marker: { color: C.mark, size: 11, line: { color: '#fff', width: 2 } }, xaxis: 'x', yaxis: 'y', hovertemplate: '%{y:.3g} dB' },
      { x: [p.w], y: [p.phi], showlegend: false, mode: 'markers', marker: { color: C.mark, size: 11, line: { color: '#fff', width: 2 } }, xaxis: 'x', yaxis: 'y2', hovertemplate: '%{y:.3g}°' }
    ];
    const minMag = Math.min.apply(null, mag);
    UI.plot('m2-bode', traces, UI.layout({
      grid: { rows: 2, columns: 1, subplots: [['xy'], ['xy2']], roworder: 'top to bottom', ygap: 0.12 },
      hovermode: 'x unified',
      xaxis: UI.axis('Frequency ω (rad/s), log scale', { type: 'log', exponentformat: 'power', range: [Math.log10(lo), Math.log10(hi)] }),
      yaxis: UI.axis('Magnitude (dB)', { range: [Math.max(minMag, -60) - 3, 5] }),
      yaxis2: UI.axis('Phase (°)', { range: [-95, 5], dtick: 15 }),
      shapes: [
        { type: 'line', x0: p.wc, x1: p.wc, y0: 0, y1: 1, xref: 'x', yref: 'paper', line: { color: C.text, width: 1.2, dash: 'dot' } },
        { type: 'line', x0: lo, x1: hi, y0: -3.0103, y1: -3.0103, xref: 'x', yref: 'y', line: { color: C.inp, width: 1, dash: 'dash' } },
        { type: 'line', x0: lo, x1: hi, y0: -45, y1: -45, xref: 'x', yref: 'y2', line: { color: C.inp, width: 1, dash: 'dash' } }
      ],
      annotations: [
        { x: Math.log10(p.wc), y: 1, xref: 'x', yref: 'paper', text: 'ω_c = 1/τ = ' + UI.fmt(p.wc, 3) + ' rad/s: −3 dB, −45°', showarrow: false,
          xanchor: 'left', yanchor: 'top', xshift: 6, font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.9)' }
      ],
      legend: { orientation: 'h', x: 0, y: 1.04, yanchor: 'bottom', font: { size: 11.5 } },
      margin: { l: 58, r: 16, t: 30, b: 46 }
    }));
  }

  function update() {
    const p = compute();
    drawReadouts(p);
    drawTime(p);
    drawBode(p);
  }
  const redraw = UI.throttle(update);
  [tau, w, A, transient].forEach(function (c) { c.onChange(redraw); });

  function setAll(t, om) { tau.set(t, true); w.set(om, true); update(); }
  document.getElementById('m2-v2').addEventListener('click', function () { setAll(0.2, 2); });
  document.getElementById('m2-cut').addEventListener('click', function () { setAll(tau.get(), 1 / tau.get()); });
  document.getElementById('m2-v3').addEventListener('click', function () { setAll(M.tauMaxForDynamicError(0.05, 100), M.TWO_PI * 50); });

  /* ---------------- dynamic-error calculator ---------------- */
  function num(id) { return parseFloat(document.getElementById(id).value); }
  function rows(list) {
    return list.map(function (r) { return '<tr><th scope="row">' + r[0] + '</th><td class="v">' + r[1] + '</td></tr>'; }).join('');
  }
  function calc1() {
    const t = num('c1-tau'), om = num('c1-w');
    const msg = document.getElementById('c1-msg'), out = document.getElementById('c1-out');
    if (!(t > 0) || !(om > 0)) { msg.textContent = 'Enter a positive τ and a positive ω.'; out.innerHTML = ''; return; }
    msg.textContent = '';
    const Mag = M.magnitudeRatio(om, t), d = M.dynamicError(om, t);
    out.innerHTML = rows([
      ['ωτ', UI.fmt(om * t, 4)],
      ['Amplitude ratio M', UI.fix(Mag, 4) + ' (' + UI.fix(M.toDecibel(Mag), 2) + ' dB)'],
      ['Dynamic error δ = M − 1', UI.fix(100 * d, 2) + ' %'],
      ['Phase lag', UI.fix(-M.phaseDeg(om, t), 2) + '°'],
      ['Signal frequency f', UI.fmt(om / M.TWO_PI, 4) + ' Hz']
    ]);
  }
  let design = null;
  function calc2() {
    const f = num('c2-f'), d = num('c2-d') / 100, fc = num('c2-fc');
    const msg = document.getElementById('c2-msg'), out = document.getElementById('c2-out');
    if (!(f > 0) || !(d > 0 && d < 1) || !(fc > 0)) {
      msg.textContent = 'Enter a positive frequency, a dynamic error between 0 and 100 %, and a positive check frequency.';
      out.innerHTML = ''; design = null; return;
    }
    msg.textContent = '';
    const tmax = M.tauMaxForDynamicError(d, f);
    const wcheck = M.TWO_PI * fc;
    design = { tau: tmax, w: wcheck };
    out.innerHTML = rows([
      ['Largest time constant τ<sub>max</sub>', UI.fmt(tmax * 1000, 4) + ' ms'],
      ['Its cut-off frequency f<sub>c</sub>', UI.fmt(M.cutoffHz(tmax), 4) + ' Hz'],
      ['M at f<sub>max</sub> (check)', UI.fix(M.magnitudeRatio(M.TWO_PI * f, tmax), 4)],
      ['Phase lag at ' + UI.fmt(fc, 4) + ' Hz', UI.fix(-M.phaseDeg(wcheck, tmax), 2) + '°'],
      ['M at ' + UI.fmt(fc, 4) + ' Hz', UI.fix(M.magnitudeRatio(wcheck, tmax), 4)]
    ]);
  }
  ['c1-tau', 'c1-w'].forEach(function (id) { document.getElementById(id).addEventListener('input', calc1); });
  ['c2-f', 'c2-d', 'c2-fc'].forEach(function (id) { document.getElementById(id).addEventListener('input', calc2); });
  document.getElementById('c2-load').addEventListener('click', function () {
    if (design) { setAll(design.tau, design.w); document.getElementById('m2-readouts').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  /* ---------------- predict, then check ---------------- */
  UI.predictBox(document.getElementById('m2-predict'), [
    {
      prompt: 'Set the input frequency exactly at the cut-off, \\(\\omega = 1/\\tau\\). What is the amplitude ratio M?',
      kind: 'number', unit: '', tol: { abs: 0.01 },
      answer: function () { return M.magnitudeRatio(1 / tau.get(), tau.get()); },
      format: function (v) { return UI.fix(v, 3); },
      explain: function () { return 'At \\(\\omega\\tau = 1\\): \\(M = 1/\\sqrt{1+1} = 0.707\\), which is −3 dB, and the phase is −45°. This is why \\(1/\\tau\\) is called the cut-off (or corner) frequency.'; },
      apply: function () { setAll(tau.get(), 1 / tau.get()); }
    },
    {
      prompt: 'A first-order sensor has \\(\\tau = 0.2\\) s and the input is \\(\\sin 2t\\). What fraction of the input amplitude appears at the output?',
      kind: 'number', unit: '', tol: { abs: 0.01 },
      answer: function () { return M.magnitudeRatio(2, 0.2); },
      format: function (v) { return UI.fix(v, 3); },
      explain: function (a) { return '\\(\\omega\\tau = 2\\times0.2 = 0.4\\), so \\(M = 1/\\sqrt{1.16} = ' + UI.fix(a, 3) + '\\), about 0.93. The output is 7% too small.'; },
      apply: function () { setAll(0.2, 2); }
    },
    {
      prompt: 'Same sensor (\\(\\tau = 0.2\\) s, input \\(\\sin 2t\\)). By how many degrees does the output lag the input?',
      kind: 'number', unit: '°', tol: { abs: 0.5 },
      answer: function () { return -M.phaseDeg(2, 0.2); },
      format: function (v) { return UI.fix(v, 1); },
      explain: function (a) { return '\\(\\phi = -\\tan^{-1}(0.4) = -' + UI.fix(a, 1) + '^\\circ\\). In time that is \\(\\Delta t = 0.3805/2 = ' + UI.fmt(a * M.DEG2RAD / 2, 3) + '\\) s.'; },
      apply: function () { setAll(0.2, 2); }
    },
    {
      prompt: 'Well above the cut-off (from \\(\\omega = 10/\\tau\\) to \\(100/\\tau\\)), the input frequency is multiplied by 10. By what factor is the output amplitude multiplied?',
      kind: 'number', unit: '×', tol: { abs: 0.01 },
      answer: function () { const t = tau.get(); return M.magnitudeRatio(100 / t, t) / M.magnitudeRatio(10 / t, t); },
      format: function (v) { return UI.fix(v, 3); },
      explain: function (a) { return 'Far above the cut-off \\(M \\approx 1/(\\omega\\tau)\\), so 10× the frequency gives about 1/10 the amplitude (' + UI.fix(a, 3) + '). That is the −20 dB per decade slope on the Bode plot.'; },
      apply: function () { setAll(tau.get(), 100 / tau.get()); }
    },
    {
      prompt: 'What is the largest phase lag a first-order sensor can ever produce, at any frequency?',
      kind: 'choice',
      choices: [{ value: '45', label: '45°' }, { value: '90', label: '90°' }, { value: '180', label: '180°' }],
      answer: function () {
        const lag = -M.phaseDeg(1e9, 1);
        return Math.abs(lag - 90) < 0.01 ? '90' : (Math.abs(lag - 45) < 0.01 ? '45' : '180');
      },
      explain: function () { return '\\(\\tan^{-1}(\\omega\\tau)\\) approaches 90° as \\(\\omega\\tau \\to \\infty\\) and never passes it. 45° is reached at the cut-off. 180° needs at least a second-order system.'; },
      apply: function () { setAll(tau.get(), Math.min(100000, 1000 / tau.get())); }
    },
    {
      prompt: 'A sensor must measure signals up to 100 Hz with at most 5% dynamic error. What is the largest time constant it may have, in milliseconds?',
      kind: 'number', unit: 'ms', tol: { rel: 0.03 },
      answer: function () { return 1000 * M.tauMaxForDynamicError(0.05, 100); },
      format: function (v) { return UI.fix(v, 3); },
      explain: function (a) { return 'Set \\(M = 0.95\\) at 100 Hz: \\((\\omega\\tau)^2 = 1/0.95^2 - 1 = 0.108\\), so \\(\\omega\\tau = 0.329\\) and \\(\\tau = 0.329/(2\\pi\\cdot100) = ' + UI.fix(a, 3) + '\\) ms.'; },
      apply: function () { setAll(M.tauMaxForDynamicError(0.05, 100), M.TWO_PI * 100); }
    }
  ]);

  DynValidation.render(document.getElementById('m2-validation'), [2, 3]);
  calc1();
  calc2();
  update();
})();
