/*
 * p3.js — P3: digital PID.
 * The engine runs the controller only at t = k*Ts (the assignment equation),
 * holds u between samples, and integrates the plant with a separate, much
 * smaller RK4 step. The Arduino sketch shown is produced from the same numbers
 * (PIDSim.arduinoCode); tests/pid-sim.test.js runs that sketch against the
 * simulated controller sample by sample.
 */
(function () {
  'use strict';
  const P = PIDSim, M = DynMath, C = UI.C;
  const $ = function (id) { return document.getElementById(id); };
  const FIRST = { type: 'first', K: 1, tau: 1 };
  const G0 = { Kp: 3, Ki: 2, Kd: 0 };
  let unit = '';

  /* ---------------- controls ---------------- */
  const ts = UI.slider($('p3-ts'), { label: 'Sampling time Ts', min: 0.001, max: 2, log: true, value: 0.05, unit: 's',
    tip: 'The controller runs once every Ts seconds. The Arduino equivalent is TS_US = Ts in microseconds.' });
  const plant = CUI.plantControls($('p3-plant'), {
    onMotor: function (m) { gains.set({ Kp: m.Kp, Ki: m.Ki, Kd: 0 }); sp.set(m.setpoint, true); lim.set({ enabled: true, umin: m.umin, umax: m.umax }); ts.set(m.Ts || 0.01, true); unit = m.units; } });
  const gains = CUI.gainControls($('p3-gains'), { Kp: { max: 50, step: 0.01, value: G0.Kp }, Ki: { max: 50, step: 0.01, value: G0.Ki }, Kd: { max: 10, step: 0.001, value: 0 } });
  const sp = UI.slider($('p3-setpoint'), { label: 'Setpoint step r', min: 0.1, max: 1000, log: true, value: 1, unit: '' });
  const lim = CUI.limitControls($('p3-limits'), { on: true, umin: -5, umax: 5, aw: true, allowOff: false });
  const time = CUI.timeControl($('p3-time'));
  const code = CUI.codeBox($('p3-code'), { title: 'Arduino loop for the current settings', filename: 'pid_loop' });

  function config(Ts) {
    const l = lim.get();
    return { plant: plant.get(), gains: gains.get(), r: sp.get(), umin: l.umin, umax: l.umax, antiWindup: l.antiWindup,
      mode: 'digital', Ts: Ts === undefined ? ts.get() : Ts };
  }

  /* ---------------- drawing ---------------- */
  function extra(a) {
    const n = a.sim.samples ? a.sim.samples.t.length : 0;
    return '<div class="readout"><span class="r-label">Sampling rate</span><span class="r-value">' + UI.fmt(1 / ts.get(), 4) + ' <small>Hz</small></span><span class="r-sub">Ts = ' + UI.fmt(ts.get() * 1000, 4) + ' ms</span></div>' +
      '<div class="readout"><span class="r-label">Controller updates shown</span><span class="r-value">' + n + '</span><span class="r-sub">one per Ts in the plotted window</span></div>';
  }

  function plantText(p) {
    return p.type === 'first' ? 'first order, K = ' + UI.fmt(p.K, 4) + ', tau = ' + UI.fmt(p.tau, 4) + ' s'
      : 'second order, K = ' + UI.fmt(p.K, 4) + ', zeta = ' + UI.fmt(p.zeta, 3) + ', wn = ' + UI.fmt(p.wn, 4) + ' rad/s';
  }

  function updateCode() {
    const cfg = config();
    if (!(cfg.umax > cfg.umin)) { code.set('// Set the upper limit above the lower limit to generate code.\n'); return; }
    code.set(P.arduinoCode({
      Kp: cfg.gains.Kp, Ki: cfg.gains.Ki, Kd: cfg.gains.Kd, Ts: cfg.Ts, umin: cfg.umin, umax: cfg.umax,
      antiWindup: cfg.antiWindup, setpoint: cfg.r,
      header: ['Plant simulated on the page: ' + plantText(cfg.plant), 'Setpoint step: ' + UI.fmt(cfg.r, 4)]
    }));
  }

  let sweepTimer = null;
  function drawSweep() {
    const cfg0 = config(0.01);
    const scale = P.timeScale(cfg0);
    const lo = Math.max(0.001, 0.004 * scale), hi = Math.min(30, 3 * scale);
    const xs = M.logspace(lo, hi, 26);
    const ox = [], oy = [], sx = [], sy = [], bx = [];
    xs.forEach(function (Ts) {
      const cfg = Object.assign({}, cfg0, { Ts: Ts });
      const T = Math.min(300, Math.max(15 * scale, 40 * Ts));
      let q;
      try { q = P.quickMetrics(cfg, T); } catch (e) { return; }
      const m = q.metrics;
      if (m.status === 'settled') { ox.push(Ts); oy.push(m.overshootPct); sx.push(Ts); sy.push(m.settlingTime); }
      else if (m.status === 'slow') { ox.push(Ts); oy.push(m.overshootPct); }
      else bx.push(Ts);
    });
    const topO = Math.min(300, Math.max(30, Math.max.apply(null, oy.concat([0])) * 1.3));
    const topS = Math.max(1, Math.max.apply(null, sy.concat([0])) * 1.3);
    const lay = function (title, top) {
      return UI.layout({
        margin: { l: 62, r: 16, t: 40, b: 46 },
        xaxis: UI.axis('Sampling time Ts (s)', { type: 'log' }),
        yaxis: UI.axis(title, { range: [0, top] }),
        shapes: [UI.vline(ts.get(), C.mark)], uirevision: 'sweep'
      });
    };
    const bad = function (top) {
      return { x: bx, y: bx.map(function () { return top * 0.94; }), name: 'Does not settle', mode: 'markers', marker: { color: '#b42d2d', symbol: 'x', size: 9, line: { width: 2 } }, hovertemplate: 'Ts = %{x:.3g} s: does not settle' };
    };
    UI.plot('p3-sweep-os', [{ x: ox, y: oy, name: 'Overshoot', mode: 'lines+markers', line: { color: C.out, width: 2.4 }, marker: { size: 5 }, hovertemplate: 'Ts = %{x:.3g} s: %{y:.1f}%' }, bad(topO)], lay('Overshoot (%)', topO));
    UI.plot('p3-sweep-ts', [{ x: sx, y: sy, name: 'Settling time (±2%)', mode: 'lines+markers', line: { color: C.third, width: 2.4 }, marker: { size: 5 }, hovertemplate: 'Ts = %{x:.3g} s: %{y:.2f} s' }, bad(topS)], lay('Settling time (s)', topS));
  }

  function update() {
    const cfg = config(), l = lim.get();
    CUI.blockDiagram('p3-diagram', { digital: true, sensor: 0, plant: cfg.plant, saturation: UI.fmt(l.umin, 4) + ' ≤ u ≤ ' + UI.fmt(l.umax, 4) });
    CUI.render(cfg, { T: time.get(), unit: unit, extra: extra, showSamples: true,
      ids: { readouts: 'p3-readouts', status: 'p3-status', resp: 'p3-resp', ctrl: 'p3-ctrl', terms: 'p3-terms' } });
    updateCode();
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(drawSweep, 160);
  }
  const redraw = UI.throttle(update);
  [ts, plant, gains, lim, time].forEach(function (c) { c.onChange(redraw); });
  sp.onChange(redraw);

  /* ---------------- presets ---------------- */
  function setCase(c) {
    plant.set(c.plant || FIRST, true);
    gains.set(c.gains || G0);
    ts.set(c.Ts === undefined ? 0.05 : c.Ts, true);
    sp.set(c.r === undefined ? 1 : c.r, true);
    lim.set(c.lim || { umin: -5, umax: 5, antiWindup: true });
    unit = '';
    update();
  }
  const WIND = { gains: { Kp: 3, Ki: 6, Kd: 0 }, Ts: 0.02, r: 1 };
  const PRESETS = {
    'ts-small': { Ts: 0.01 }, 'ts-mid': { Ts: 0.3 }, 'ts-big': { Ts: 0.9 },
    'wind-off': Object.assign({}, WIND, { lim: { umin: 0, umax: 1.2, antiWindup: false } }),
    'wind-on': Object.assign({}, WIND, { lim: { umin: 0, umax: 1.2, antiWindup: true } }),
    reset: {}
  };
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () { setCase(PRESETS[b.getAttribute('data-preset')]); });
  });

  /* ---------------- Predict, then check ---------------- */
  function run(extra) { return P.analyze(Object.assign({ plant: FIRST, gains: G0, r: 1, umin: -5, umax: 5, mode: 'digital', Ts: 0.05 }, extra)).metrics; }
  const WCFG = { gains: WIND.gains, Ts: WIND.Ts, umin: 0, umax: 1.2 };
  CUI.predict($('p3-predict'), [
    {
      prompt: 'PI controller (\\(K_p=3,\\ K_i=2\\)) on the plant \\(K=1,\\ \\tau=1\\) s, limits ±5. You raise the sampling time from \\(T_s=0.05\\) s to \\(T_s=0.5\\) s. What happens to the <em>settling time</em>?',
      kind: 'choice',
      choices: [{ value: 'longer', label: 'It gets longer (or the loop stops settling)' }, { value: 'shorter', label: 'It gets shorter' }, { value: 'same', label: 'It does not change' }],
      answer: function () {
        const a = run({ Ts: 0.05 }), b = run({ Ts: 0.5 });
        if (b.status !== 'settled') return 'longer';
        return b.overshootPct > a.overshootPct + 5 || b.settlingTime > a.settlingTime * 1.15 ? 'longer' : (b.settlingTime < a.settlingTime * 0.87 ? 'shorter' : 'same');
      },
      explain: function () {
        const a = run({ Ts: 0.05 }), b = run({ Ts: 0.5 });
        return 'At Ts = 0.05 s: settling ' + UI.fix(a.settlingTime, 2) + ' s, overshoot ' + UI.fix(a.overshootPct, 1) + '%. At Ts = 0.5 s: ' +
          (b.settlingTime === null ? 'it never settles' : 'settling ' + UI.fix(b.settlingTime, 2) + ' s, overshoot ' + UI.fix(b.overshootPct, 1) + '%') +
          '. The hold delays the correction by about Ts/2, so the same gains act on older information.';
      },
      apply: function () { setCase({ Ts: 0.5 }); }
    },
    {
      prompt: 'P control only, \\(K_p=9\\), plant \\(K=1,\\ \\tau=1\\) s. The stability limit is \\(T_s<\\tau\\ln\\frac{1+KK_p}{KK_p-1}=0.223\\) s. Is the loop stable at \\(T_s=0.3\\) s?',
      kind: 'choice',
      choices: [{ value: 'stable', label: 'Yes, it settles (at 0.9 of the setpoint)' }, { value: 'unstable', label: 'No, u flips between the limits and the output oscillates' }],
      answer: function () { return P.analyze({ plant: FIRST, gains: { Kp: 9, Ki: 0, Kd: 0 }, r: 1, umin: -20, umax: 20, mode: 'digital', Ts: 0.3 }).metrics.status === 'settled' ? 'stable' : 'unstable'; },
      explain: function () { return 'The discrete pole is \\(e^{-0.3}-9(1-e^{-0.3})=-1.6\\). Its magnitude is above 1, so each sample overshoots by more than the last. The same gain was perfectly stable at Ts = 0.1 s (pole −0.7).'; },
      apply: function () { setCase({ gains: { Kp: 9, Ki: 0, Kd: 0 }, Ts: 0.3, lim: { umin: -20, umax: 20, antiWindup: true } }); }
    },
    {
      prompt: 'The windup preset: PI (\\(K_p=3,\\ K_i=6\\)), limits 0 to 1.2, setpoint 1. Which run overshoots more?',
      kind: 'choice',
      choices: [{ value: 'off', label: 'Anti-windup OFF' }, { value: 'on', label: 'Anti-windup ON' }, { value: 'eq', label: 'They are the same' }],
      answer: function () {
        const a = P.analyze(Object.assign({ plant: FIRST, r: 1, mode: 'digital', antiWindup: true }, WCFG)).metrics.overshootPct;
        const b = P.analyze(Object.assign({ plant: FIRST, r: 1, mode: 'digital', antiWindup: false }, WCFG)).metrics.overshootPct;
        return b > a + 1 ? 'off' : (a > b + 1 ? 'on' : 'eq');
      },
      explain: function () {
        const a = P.analyze(Object.assign({ plant: FIRST, r: 1, mode: 'digital', antiWindup: true }, WCFG)).metrics;
        const b = P.analyze(Object.assign({ plant: FIRST, r: 1, mode: 'digital', antiWindup: false }, WCFG)).metrics;
        return 'Without anti-windup the sum keeps growing while u is stuck at 1.2, so the output overshoots by <strong>' + UI.fix(b.overshootPct, 1) + '%</strong> and takes ' + UI.fix(b.settlingTime, 2) + ' s to settle. With it: <strong>' +
          UI.fix(a.overshootPct, 1) + '%</strong> and ' + UI.fix(a.settlingTime, 2) + ' s.';
      },
      apply: function () { setCase(PRESETS['wind-off']); }
    },
    {
      prompt: 'With \\(T_s=0.04\\) s, how many times does the controller compute a new u in the first second (\\(0\\le t<1\\) s)?',
      kind: 'number', unit: 'updates', tol: { abs: 0.5 },
      answer: function () {
        const s = P.simulate({ plant: FIRST, gains: G0, r: 1, umin: -5, umax: 5, mode: 'digital', Ts: 0.04 }, 2);
        return s.samples.t.filter(function (t) { return t < 1 - 1e-9; }).length;
      },
      explain: function () { return 'One update per sampling period: \\(1/T_s=1/0.04=25\\). Between them the output is held, so the control signal is a staircase of 25 steps in that second.'; },
      apply: function () { setCase({ Ts: 0.04 }); }
    }
  ]);

  update();
})();
