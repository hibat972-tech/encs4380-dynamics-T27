/*
 * module1.js — First-order time response (thermometer-type sensor)
 *   tau*dy/dt + y = K*x,  G(s) = K/(tau*s + 1)
 * Shows: step and ramp responses, the 63.2% point at tau and 95% at 3*tau,
 * ramp lag = tau, steady-state error, and the error fraction on a log axis
 * (straight line with slope -1/tau).
 */
(function () {
  'use strict';
  const M = DynMath, C = UI.C;
  const N = 600;                       // samples per curve

  /* ---------------- controls ---------------- */
  const ctl = document.getElementById('m1-controls');
  const input = UI.segmented(ctl, {
    label: 'Input signal', value: 'step',
    options: [{ value: 'step', label: 'Step' }, { value: 'ramp', label: 'Ramp' }],
    tip: 'Step: the input jumps by A at t = 0. Ramp: the input rises steadily at R units per second.'
  });
  const K = UI.slider(ctl, {
    label: 'Static sensitivity K', min: 0.1, max: 5, step: 0.01, value: 1, unit: 'out/in', digits: 2,
    tip: 'Output change per unit of input once everything has settled (for example mV per °C). K scales the curve; it does not change the timing.'
  });
  const tau = UI.slider(ctl, {
    label: 'Time constant τ', min: 0.05, max: 20, value: 2, unit: 's', log: true,
    tip: 'Time to reach 63.2% of a step change. A bigger τ means a slower sensor. Logarithmic slider.'
  });
  const A = UI.slider(ctl, {
    label: 'Step size A', min: 0.1, max: 100, step: 0.1, value: 1, unit: 'units',
    tip: 'How much the input jumps at t = 0, in input units.'
  });
  const R = UI.slider(ctl, {
    label: 'Ramp rate R', min: 0.1, max: 20, step: 0.1, value: 1, unit: 'units/s',
    tip: 'How fast the input rises, in input units per second.'
  });
  const x0 = UI.slider(ctl, {
    label: 'Starting value x₀', min: -50, max: 100, step: 1, value: 0, unit: 'units', digits: 0,
    tip: 'Input level before t = 0. The sensor starts settled at y = K·x₀.'
  });
  const efMode = UI.segmented(document.getElementById('m1-ef-mode'), {
    label: 'Vertical axis', value: 'log',
    options: [{ value: 'log', label: 'Eₘ on a log axis' }, { value: 'ln', label: 'ln Eₘ on a linear axis' }]
  });

  /* ---------------- calculation ---------------- */
  function compute() {
    const p = { K: K.get(), tau: tau.get(), type: input.get(), A: A.get(), R: R.get(), x0: x0.get() };
    const amp = p.type === 'step' ? p.A : p.R;
    p.tEnd = (p.type === 'step' ? 6 : 10) * p.tau;
    p.t = M.linspace(0, p.tEnd, N + 1);
    // deviation from the settled starting point (closed-form solution of the ODE)
    const dev = p.t.map(function (ti) {
      return p.type === 'step' ? M.firstOrderStep(ti, p.K, p.tau, p.A) : M.firstOrderRamp(ti, p.K, p.tau, p.R);
    });
    p.dev = dev;
    p.y0 = p.K * p.x0;
    p.y = dev.map(function (v) { return p.y0 + v; });
    p.ideal = p.t.map(function (ti) { return p.K * (p.x0 + (p.type === 'step' ? p.A : p.R * ti)); });
    p.err = p.t.map(function (ti) { return M.firstOrderMeasurementError(ti, p.K, p.tau, p.type, amp); });
    p.ess = M.firstOrderSteadyStateError(p.tau, p.type, amp);

    // error fraction, computed from the sampled curves (t <= 5 tau so E_m stays well above zero)
    const nFit = Math.round(N * 5 / (p.tEnd / p.tau));
    p.tFit = p.t.slice(0, nFit + 1);
    if (p.type === 'step') {
      const yInf = p.K * (p.x0 + p.A);
      p.yInf = yInf;
      p.Em = M.errorFraction(p.y.slice(0, nFit + 1), yInf, p.y0);
    } else {
      p.Em = p.err.slice(0, nFit + 1).map(function (e) { return (p.ess - e) / p.ess; });
    }
    p.fit = M.linearFit(p.tFit, p.Em.map(Math.log));

    if (p.type === 'step') {
      // values read off the sampled curve
      p.yTau = M.interp(p.t, p.y, p.tau);
      p.y3Tau = M.interp(p.t, p.y, 3 * p.tau);
      p.pctTau = 100 * (p.yTau - p.y0) / (p.yInf - p.y0);
      p.pct3Tau = 100 * (p.y3Tau - p.y0) / (p.yInf - p.y0);
      p.t632 = M.crossingTime(p.t, dev, (1 - Math.exp(-1)) * p.K * p.A);   // 63.2% = 1 - e^-1
    } else {
      p.tRef = 8 * p.tau;                      // late enough that the transient (e^-t/tau) has gone
      p.lag = M.measureRampLag(p.t, dev, p.K, p.R, p.tRef);
      p.errEnd = p.err[p.err.length - 1];
    }
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
    if (p.type === 'step') {
      h += readout('Output at t = τ', UI.fmt(p.yTau, 4), '', UI.fix(p.pctTau, 1) + '% of the change (expect 63.2%)', true);
      h += readout('Output at t = 3τ', UI.fmt(p.y3Tau, 4), '', UI.fix(p.pct3Tau, 1) + '% of the change (expect 95.0%)', true);
      h += readout('Time to reach 63.2%', UI.fmt(p.t632, 4), 's', 'read off the curve; τ = ' + UI.fmt(p.tau, 4) + ' s');
      h += readout('Final value K(x₀ + A)', UI.fmt(p.yInf, 4), '', 'the output settles here');
      h += readout('Steady-state error', UI.fmt(p.ess, 3), 'units', 'step input: e(∞) = 0');
    } else {
      h += readout('Ramp lag (read off curve)', UI.fmt(p.lag, 4), 's', 'formula: lag = τ = ' + UI.fmt(p.tau, 4) + ' s', true);
      h += readout('Steady-state error e_ss = Rτ', UI.fmt(p.ess, 4), 'units', 'in output units: K·R·τ = ' + UI.fmt(p.K * p.ess, 4), true);
      h += readout('Error at t = 10τ (curve)', UI.fmt(p.errEnd, 4), 'units', UI.fix(100 * p.errEnd / p.ess, 3) + '% of Rτ: transient gone');
    }
    h += readout('Error-fraction slope (fit)', UI.fmt(p.fit.slope, 4), 's⁻¹', '−1/τ = ' + UI.fmt(-1 / p.tau, 4) + ' s⁻¹');
    document.getElementById('m1-readouts').innerHTML = h;
  }

  function drawMain(p) {
    const pre = -0.05 * p.tEnd;
    const tPlot = [pre].concat(p.t);
    const yPlot = [p.y0].concat(p.y);
    const traces = [], shapes = [], ann = [];
    if (p.type === 'step') {
      traces.push({ x: [pre, 0, 0, p.tEnd], y: [p.y0, p.y0, p.yInf, p.yInf], name: 'Ideal output K·x(t) (input × K)',
        mode: 'lines', line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.4g}' });
      traces.push({ x: tPlot, y: yPlot, name: 'Sensor output y(t)', mode: 'lines', line: { color: C.out, width: 2.5 }, hovertemplate: '%{y:.4g}' });
      traces.push({ x: [p.tau, 3 * p.tau], y: [p.yTau, p.y3Tau], name: '63.2% at τ, 95% at 3τ', mode: 'markers',
        marker: { color: C.mark, size: 10, line: { color: '#fff', width: 2 } }, hovertemplate: '%{y:.4g}' });
      [[p.tau, p.yTau, '63.2% at t = τ'], [3 * p.tau, p.y3Tau, '95.0% at t = 3τ']].forEach(function (m) {
        shapes.push({ type: 'line', x0: m[0], x1: m[0], y0: p.y0, y1: m[1], xref: 'x', yref: 'y', line: { color: C.mark, width: 1.2, dash: 'dot' } });
        shapes.push({ type: 'line', x0: 0, x1: m[0], y0: m[1], y1: m[1], xref: 'x', yref: 'y', line: { color: C.mark, width: 1.2, dash: 'dot' } });
        ann.push({ x: m[0], y: m[1], text: m[2], showarrow: false, xanchor: 'left', yanchor: 'top', xshift: 8, yshift: -4,
          font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
      });
      document.getElementById('m1-main-caption').textContent =
        'Dashed: what a perfect, instant sensor would show. Solid: the real sensor output. Orange points are read off the curve at t = τ and t = 3τ.';
    } else {
      traces.push({ x: [pre, 0].concat(p.t), y: [p.y0, p.y0].concat(p.ideal), name: 'Ideal output K·x(t) (input × K)',
        mode: 'lines', line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.4g}' });
      traces.push({ x: tPlot, y: yPlot, name: 'Sensor output y(t)', mode: 'lines', line: { color: C.out, width: 2.5 }, hovertemplate: '%{y:.4g}' });
      const target = p.K * (p.x0 + p.R * p.tRef);
      const yRef = M.interp(p.t, p.y, p.tRef);
      shapes.push({ type: 'line', x0: p.tRef, x1: p.tRef + p.lag, y0: target, y1: target, xref: 'x', yref: 'y', line: { color: C.mark, width: 2.5 } });
      shapes.push({ type: 'line', x0: p.tRef, x1: p.tRef, y0: yRef, y1: target, xref: 'x', yref: 'y', line: { color: C.mark, width: 1.5, dash: 'dot' } });
      traces.push({ x: [p.tRef, p.tRef + p.lag], y: [target, target], mode: 'markers', name: 'Lag read off the curves',
        marker: { color: C.mark, size: 9, symbol: 'line-ns-open', line: { width: 2.5, color: C.mark } }, hoverinfo: 'skip' });
      ann.push({ x: p.tRef + p.lag / 2, y: target, text: 'lag = ' + UI.fmt(p.lag, 3) + ' s', showarrow: false, yanchor: 'bottom', yshift: 6,
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
      ann.push({ x: p.tRef, y: (yRef + target) / 2, text: 'K·R·τ = ' + UI.fmt(p.K * p.ess, 3), showarrow: false, xanchor: 'right', xshift: -6,
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
      document.getElementById('m1-main-caption').textContent =
        'Dashed: ideal output K·R·t. Solid: the sensor output. After the start-up transient it runs parallel to the ideal line, shifted right by τ.';
    }
    UI.plot('m1-main', traces, UI.layout({
      xaxis: UI.axis('Time t (s)', { range: [pre, p.tEnd] }),
      yaxis: UI.axis('Output y (output units)'),
      shapes: shapes, annotations: ann
    }));
  }

  function drawError(p) {
    const label = 'e_ss = ' + UI.fmt(p.ess, 4);
    UI.plot('m1-error', [
      { x: p.t, y: p.err, name: 'Error e(t)', mode: 'lines', line: { color: C.out, width: 2.5 }, hovertemplate: '%{y:.4g}', showlegend: false }
    ], UI.layout({
      xaxis: UI.axis('Time t (s)'),
      yaxis: UI.axis('e(t) (input units)'),
      shapes: [UI.hline(p.ess, C.mark)],
      annotations: [{ xref: 'paper', x: 1, y: p.ess, text: label, showarrow: false, xanchor: 'right', yanchor: 'bottom',
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' }]
    }));
  }

  function drawErrorFraction(p) {
    const lnMode = efMode.get() === 'ln';
    const fitY = p.tFit.map(function (ti) { return p.fit.slope * ti + p.fit.intercept; });
    const data = lnMode ? p.Em.map(Math.log) : p.Em;
    const fitData = lnMode ? fitY : fitY.map(Math.exp);
    const txt = 'slope = ' + UI.fmt(p.fit.slope, 4) + ' s⁻¹  (−1/τ = ' + UI.fmt(-1 / p.tau, 4) + ')';
    UI.plot('m1-ef', [
      { x: p.tFit, y: data, name: 'Eₘ(t) from the curve', mode: 'lines', line: { color: C.out, width: 2.5 }, hovertemplate: '%{y:.4g}' },
      { x: [p.tFit[0], p.tFit[p.tFit.length - 1]], y: [fitData[0], fitData[fitData.length - 1]], name: 'Least-squares line',
        mode: 'lines', line: { color: C.mark, width: 2, dash: 'dash' }, hoverinfo: 'skip' }
    ], UI.layout({
      xaxis: UI.axis('Time t (s)'),
      yaxis: lnMode ? UI.axis('ln Eₘ') : UI.axis('Eₘ (log scale)', { type: 'log', dtick: 1, exponentformat: 'none' }),
      annotations: [{ xref: 'paper', yref: 'paper', x: 0.98, y: 0.95, text: txt, showarrow: false, xanchor: 'right',
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.9)' }]
    }));
    document.getElementById('m1-ef-caption').innerHTML = p.type === 'step'
      ? 'Eₘ = (y∞ − y)/(y∞ − y₀), plotted for 0 ≤ t ≤ 5τ. A first-order curve gives a straight line with slope −1/τ.'
      : 'For a ramp, Eₘ = (e_ss − e)/e_ss: the part of the error that is still decaying. Same straight line, slope −1/τ.';
  }

  function update() {
    const p = compute();
    A.show(p.type === 'step');
    R.show(p.type === 'ramp');
    document.getElementById('m1-main-title').textContent = p.type === 'step' ? 'Step response' : 'Ramp response';
    drawReadouts(p);
    drawMain(p);
    drawError(p);
    drawErrorFraction(p);
  }
  const redraw = UI.throttle(update);
  [K, tau, A, R, x0, input, efMode].forEach(function (c) { c.onChange(redraw); });

  function setAll(v) {
    input.set(v.type || 'step', true);
    K.set(v.K, true); tau.set(v.tau, true);
    if (v.A !== undefined) A.set(v.A, true);
    if (v.R !== undefined) R.set(v.R, true);
    x0.set(v.x0 || 0, true);
    update();
  }
  document.getElementById('m1-thermo').addEventListener('click', function () { setAll({ type: 'step', K: 1, tau: 10, A: 60, x0: 20 }); });
  document.getElementById('m1-reset').addEventListener('click', function () { setAll({ type: 'step', K: 1, tau: 2, A: 1, R: 1, x0: 0 }); });

  /* ---------------- predict, then check ---------------- */
  function slopeFor(tauValue) {
    const t = M.linspace(0, 4 * tauValue, 200);
    const em = t.map(function (ti) { return 1 - M.firstOrderStep(ti, 1, tauValue, 1); });
    return M.linearFit(t, em.map(Math.log)).slope;
  }
  function time632(k, tauValue) {
    const t = M.linspace(0, 6 * tauValue, 6001);
    const y = t.map(function (ti) { return M.firstOrderStep(ti, k, tauValue, 1); });
    return M.crossingTime(t, y, 0.632 * k);
  }

  UI.predictBox(document.getElementById('m1-predict'), [
    {
      prompt: 'A sensor with \\(\\tau = 2\\) s receives a step input. What percentage of the final change will its output have covered at \\(t = 2\\) s?',
      kind: 'number', unit: '%', tol: { abs: 1 },
      answer: function () { return 100 * M.firstOrderStep(2, 1, 2, 1); },
      format: function (v) { return UI.fix(v, 1); },
      explain: function () { return 'At \\(t=\\tau\\) the exponential term is \\(e^{-1}=0.368\\), so the output has covered \\(1-0.368 = 63.2\\%\\) of the change. K and A do not matter.'; },
      apply: function () { setAll({ type: 'step', K: 1, tau: 2, A: 1, x0: 0 }); }
    },
    {
      prompt: 'A thermometer with \\(\\tau = 10\\) s goes from room air at 20 °C into tea at 80 °C. What does it read after 30 s?',
      kind: 'number', unit: '°C', tol: { abs: 0.5 },
      answer: function () { return 20 + M.firstOrderStep(30, 1, 10, 60); },
      format: function (v) { return UI.fix(v, 1); },
      explain: function (a) {
        const r10 = 20 + M.firstOrderStep(10, 1, 10, 60);
        return '30 s is \\(3\\tau\\), so it has covered 95.0% of the 60 °C change: \\(20 + 0.950\\times 60 = ' + UI.fix(a, 1) + '\\) °C. After only 10 s it reads ' +
          UI.fix(r10, 1) + ' °C, which is ' + UI.fix(80 - r10, 1) + ' °C too low, even though the thermometer is perfectly calibrated.';
      },
      apply: function () { setAll({ type: 'step', K: 1, tau: 10, A: 60, x0: 20 }); }
    },
    {
      prompt: 'The input rises steadily at \\(R = 2\\) units/s. The sensor has \\(K = 1\\) and \\(\\tau = 1.5\\) s. Once the start-up transient has gone, how far below the true value is the reading?',
      kind: 'number', unit: 'units', tol: { rel: 0.03 },
      answer: function () { return M.firstOrderSteadyStateError(1.5, 'ramp', 2); },
      explain: function (a) { return 'The output runs \\(\\tau\\) seconds behind the input. In that time the input rises by \\(R\\tau = 2 \\times 1.5 = ' + UI.fmt(a, 3) + '\\) units. That is the steady-state error.'; },
      apply: function () { setAll({ type: 'ramp', K: 1, tau: 1.5, R: 2, x0: 0 }); }
    },
    {
      prompt: 'With \\(\\tau = 2\\) s the error-fraction line has slope \\(-0.5\\ \\mathrm{s^{-1}}\\). What will the slope be with \\(\\tau = 4\\) s?',
      kind: 'number', unit: 's⁻¹', tol: { abs: 0.01 },
      answer: function () { return slopeFor(4); },
      explain: function (a) { return 'The slope is \\(-1/\\tau\\). Doubling \\(\\tau\\) halves the slope: \\(-1/4 = ' + UI.fmt(a, 3) + '\\ \\mathrm{s^{-1}}\\). A slower sensor gives a flatter line.'; },
      apply: function () { setAll({ type: 'step', K: 1, tau: 4, A: 1, x0: 0 }); }
    },
    {
      prompt: 'Keep \\(\\tau = 2\\) s and double the sensitivity from \\(K = 1\\) to \\(K = 2\\). When does the step response now reach 63.2% of its final value?',
      kind: 'choice',
      choices: [
        { value: 'same', label: 'At the same time, t = τ' },
        { value: 'earlier', label: 'Twice as early, t = τ/2' },
        { value: 'later', label: 'Twice as late, t = 2τ' }
      ],
      answer: function () {
        const r = time632(2, 2) / time632(1, 2);
        if (Math.abs(r - 1) < 0.01) return 'same';
        return r < 1 ? 'earlier' : 'later';
      },
      explain: function () { return 'K multiplies the whole curve, including its final value, so the fraction reached at any time is unchanged. Only \\(\\tau\\) sets the timing.'; },
      apply: function () { setAll({ type: 'step', K: 2, tau: 2, A: 1, x0: 0 }); }
    }
  ]);

  DynValidation.render(document.getElementById('m1-validation'), [1]);
  update();
})();
