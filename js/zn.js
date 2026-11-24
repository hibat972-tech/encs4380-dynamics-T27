/*
 * zn.js — Bonus: Ziegler-Nichols closed-loop tuning (simulation only).
 * Ku is found by bisection on a time-domain RK4 simulation (growing or decaying
 * peaks) and cross-checked with the -180 degree frequency crossing.
 * Plants with no Ku (first or second order with no extra lag) are reported as such.
 */
(function () {
  'use strict';
  const P = PIDSim, M = DynMath, C = UI.C;
  const $ = function (id) { return document.getElementById(id); };

  const plant = CUI.plantControls($('zn-plant'), { type: 'second', K: 1, zeta: 0.5, wn: 2, motorButton: false });
  const sensor = UI.slider($('zn-lags'), { label: 'Sensor lag τs', min: 0, max: 2, step: 0.01, value: 0.3, unit: 's', digits: 2, tip: 'First-order sensor in the feedback path (as in P2).' });
  const driver = UI.slider($('zn-lags'), { label: 'Actuator / driver lag τa', min: 0, max: 2, step: 0.01, value: 0, unit: 's', digits: 2, tip: 'A first-order lag between the controller output and the plant input.' });
  const rule = UI.segmented($('zn-rule'), { label: 'Ziegler–Nichols rule', value: 'PID', options: [{ value: 'P', label: 'P' }, { value: 'PI', label: 'PI' }, { value: 'PID', label: 'PID' }] });
  const before = CUI.gainControls($('zn-before'), { Kp: { max: 50, step: 0.01, value: 1 }, Ki: { max: 50, step: 0.01, value: 0 }, Kd: { max: 10, step: 0.001, value: 0 } });

  function loopCfg() { return { plant: plant.get(), sensorTau: sensor.get(), actuatorTau: driver.get(), r: 1 }; }

  let ult = null;
  function findUltimate() {
    const cfg = loopCfg();
    const fq = P.ultimateFromFrequency(cfg);
    const sm = fq ? P.ultimateFromSimulation(cfg, 5000) : P.ultimateFromSimulation(cfg, 300);
    return { freq: fq, sim: sm };
  }

  function drawUltimate() {
    const cfg = loopCfg();
    ult = findUltimate();
    const box = $('zn-ult');
    if (!ult.freq && !ult.sim) {
      box.innerHTML = '<h3>No ultimate gain for this plant</h3><p style="margin:0">With P control this loop is stable for <strong>every</strong> Kp: the plant plus its lags has an effective order of two or less, so its phase never reaches −180°. There is no gain at which it oscillates forever, so the Ziegler–Nichols closed-loop method cannot be applied. Add a sensor lag and a driver lag (three lags in total), or choose a second-order plant with a sensor lag.</p>';
      UI.set('zn-table', '<tr><td colspan="4">—</td></tr>'); UI.set('zn-metrics', ''); UI.set('zn-status', '');
      Plotly.purge('zn-osc'); Plotly.purge('zn-compare');
      return false;
    }
    const f = ult.freq, s = ult.sim;
    const dK = f && s ? Math.abs(s.Ku - f.Ku) / f.Ku : null;
    box.innerHTML = '<h3>Ultimate gain and period</h3><div class="readouts" style="margin-bottom:10px">' +
      '<div class="readout key"><span class="r-label">Ku (simulation, bisection)</span><span class="r-value">' + UI.fmt(s.Ku, 5) + '</span><span class="r-sub">peaks neither grow nor decay</span></div>' +
      '<div class="readout key"><span class="r-label">Pu (simulation)</span><span class="r-value">' + UI.fmt(s.Pu, 4) + ' <small>s</small></span><span class="r-sub">time between peaks</span></div>' +
      '<div class="readout"><span class="r-label">Ku (phase = −180°)</span><span class="r-value">' + UI.fmt(f.Ku, 5) + '</span><span class="r-sub">1/|G(jωu)|</span></div>' +
      '<div class="readout"><span class="r-label">Pu (phase = −180°)</span><span class="r-value">' + UI.fmt(f.Pu, 4) + ' <small>s</small></span><span class="r-sub">2π/ωu, ωu = ' + UI.fmt(f.wu, 4) + ' rad/s</span></div>' +
      '<div class="readout"><span class="r-label">Agreement</span><span class="r-value">' + (dK === null ? '—' : UI.fix(100 * dK, 3) + ' <small>%</small>') + '</span><span class="r-sub">difference in Ku</span></div></div>' +
      '<p class="ctl-hint" style="margin:0">Ku and Pu in the table below use the simulation values. They match the frequency-domain values, which is an independent check of the simulation.</p>';
    return true;
  }

  function draw() {
    if (!drawUltimate()) return;
    const cfg = loopCfg(), f = ult.freq || ult.sim, Ku = ult.sim.Ku, Pu = ult.sim.Pu;
    const zn = P.zieglerNichols(Ku, Pu);
    // table
    const row = function (name, g) { return '<tr><th scope="row">' + name + '</th><td>' + UI.fmt(g.Kp, 4) + '</td><td>' + UI.fmt(g.Ki, 4) + '</td><td>' + UI.fmt(g.Kd, 4) + '</td></tr>'; };
    UI.set('zn-table', row('P', zn.P) + row('PI', zn.PI) + row('PID', zn.PID) + '<tr><th scope="row">Ku, Pu used</th><td colspan="3">Ku = ' + UI.fmt(Ku, 5) + ', Pu = ' + UI.fmt(Pu, 4) + ' s</td></tr>');

    // oscillation demo
    const T = 14 * Pu;
    const kf = f.Ku;
    const defs = [[0.8, 'Kp = 0.8·Ku (decays)', C.third], [1, 'Kp = Ku (constant amplitude)', C.out], [1.2, 'Kp = 1.2·Ku (grows)', C.mark]];
    const traces = defs.map(function (d) {
      const sim = P.simulate(Object.assign({}, cfg, { gains: { Kp: d[0] * kf, Ki: 0, Kd: 0 }, umin: -Infinity, umax: Infinity }), T, { maxPoints: 6000 });
      return { x: sim.t, y: sim.y, name: d[1], mode: 'lines', line: { color: d[2], width: d[0] === 1 ? 3 : 2 }, hovertemplate: '%{y:.4g}' };
    });
    const ymax = Math.max.apply(null, traces.map(function (t) { return Math.max.apply(null, t.y); }));
    const ymin = Math.min.apply(null, traces.map(function (t) { return Math.min.apply(null, t.y); }));
    UI.plot('zn-osc', traces, UI.layout({
      margin: { l: 62, r: 16, t: 40, b: 46 },
      xaxis: UI.axis('Time t (s)', { range: [0, T] }), yaxis: UI.axis('Output y (setpoint step = 1)', { range: [Math.max(ymin, -6) - 0.1, Math.min(ymax, 8) + 0.1] }),
      uirevision: 'osc'
    }));

    // before / after
    const pick = zn[rule.get()];
    const Tc = Math.max(12 * Pu, 15 * P.timeScale(cfg));
    const a0 = P.analyze(Object.assign({}, cfg, { gains: before.get() }), { T: Tc });
    const a1 = P.analyze(Object.assign({}, cfg, { gains: pick }), { T: Tc });
    const tr = function (a, name, color, w) { return { x: a.sim.t, y: a.sim.y, name: name, mode: 'lines', line: { color: color, width: w }, hovertemplate: '%{y:.4g}' }; };
    const g0 = before.get();
    const lbl0 = 'Before: Kp = ' + UI.fmt(g0.Kp, 3) + ', Ki = ' + UI.fmt(g0.Ki, 3) + ', Kd = ' + UI.fmt(g0.Kd, 3);
    const lbl1 = 'After (' + rule.get() + '): Kp = ' + UI.fmt(pick.Kp, 3) + ', Ki = ' + UI.fmt(pick.Ki, 3) + ', Kd = ' + UI.fmt(pick.Kd, 3);
    const yAll = a0.sim.y.concat(a1.sim.y).filter(isFinite);
    UI.plot('zn-compare', [
      { x: [0, 0, Tc], y: [0, 1, 1], name: 'Setpoint', mode: 'lines', line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.4g}' },
      tr(a0, lbl0, '#8a96a3', 2.4), tr(a1, lbl1, C.out, 3)
    ], UI.layout({
      margin: { l: 62, r: 16, t: 56, b: 46 },
      xaxis: UI.axis('Time t (s)', { range: [0, Tc] }), yaxis: UI.axis('Output y', { range: [Math.min(0, Math.min.apply(null, yAll)) - 0.05, Math.min(Math.max(1.3, Math.max.apply(null, yAll)), 8) + 0.05] }),
      legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 10.5 } }, uirevision: 'cmp'
    }));
    const col = function (a, title) {
      const m = a.metrics;
      return '<div class="readout"><span class="r-label">' + title + '</span><span class="r-value">' + (m.settled ? UI.fix(m.overshootPct, 1) : (m.status === 'diverged' ? 'unstable' : 'oscillates')) + (m.settled ? ' <small>% overshoot</small>' : '') +
        '</span><span class="r-sub">rise ' + (m.riseTime === null ? '—' : UI.fmt(m.riseTime, 3) + ' s') + ' · settling ' + (m.settled ? UI.fmt(m.settlingTime, 3) + ' s' : 'never') + ' · e<sub>ss</sub> ' + (m.settled ? UI.fix(Math.abs(m.essPct), 2) + '%' : '—') + '</span></div>';
    };
    UI.set('zn-metrics', col(a0, 'Before') + col(a1, 'After (Ziegler–Nichols ' + rule.get() + ')'));
    const n = CUI.statusNote(a1.metrics);
    UI.set('zn-status', n ? '<div class="note-box ' + n.cls + '">' + n.html + '</div>' : '');
  }
  const redraw = UI.throttle(draw);
  [plant, sensor, driver, rule, before].forEach(function (c) { c.onChange(redraw); });

  /* ---------------- presets ---------------- */
  const PRESETS = {
    second: { plant: { type: 'second', K: 1, zeta: 0.5, wn: 2 }, ts: 0.3, ta: 0 },
    first3: { plant: { type: 'first', K: 1, tau: 1 }, ts: 0.3, ta: 0.2 },
    first: { plant: { type: 'first', K: 1, tau: 1 }, ts: 0, ta: 0 },
    motor: null
  };
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      const k = b.getAttribute('data-preset');
      let p = PRESETS[k];
      if (k === 'motor') {
        const m = CUI.store.load();
        p = { plant: { type: 'first', K: m.K, tau: m.tau }, ts: Math.max(0.01, m.tau * 0.25), ta: Math.max(0.01, m.tau * 0.15) };
      }
      plant.set(p.plant, true); sensor.set(p.ts, true); driver.set(p.ta, true);
      before.set({ Kp: p.plant.type === 'first' && k === 'motor' ? 0.1 : 1, Ki: 0, Kd: 0 });
      draw();
    });
  });

  /* ---------------- Predict, then check ---------------- */
  const REF = { plant: { type: 'second', K: 1, zeta: 0.5, wn: 2 }, sensorTau: 0.3, r: 1 };
  CUI.predict($('zn-predict'), [
    {
      prompt: 'A first-order motor model \\(K/(\\tau s+1)\\) with P control only. Is there a gain \\(K_p\\) at which the loop oscillates forever?',
      kind: 'choice',
      choices: [{ value: 'yes', label: 'Yes, at a high enough Kp' }, { value: 'no', label: 'No, it is stable for every Kp' }],
      answer: function () { return P.ultimateFromFrequency({ plant: { type: 'first', K: 1, tau: 1 } }) === null && P.ultimateFromSimulation({ plant: { type: 'first', K: 1, tau: 1 } }, 200) === null ? 'no' : 'yes'; },
      explain: function () { return 'The closed loop is \\(\\tau s+1+KK_p=0\\), a single pole at \\(-(1+KK_p)/\\tau\\). It only moves further left as Kp grows, so it never reaches the imaginary axis. The simulation also finds no growing or constant oscillation up to Kp = 200. Ziegler–Nichols needs at least three lags: try “First order + sensor + driver lag”.'; },
      apply: function () { document.querySelector('[data-preset="first"]').click(); }
    },
    {
      prompt: 'Second-order plant (\\(K=1,\\ \\zeta=0.5,\\ \\omega_n=2\\)) with a sensor lag of 0.3 s. At <strong>half</strong> the ultimate gain, \\(K_p=0.5K_u\\), what does the oscillation do?',
      kind: 'choice',
      choices: [{ value: 'decay', label: 'It dies out' }, { value: 'const', label: 'It stays at constant amplitude' }, { value: 'grow', label: 'It grows' }],
      answer: function () {
        const u = P.ultimateFromFrequency(REF);
        const g = P.oscillationTest(REF, 0.5 * u.Ku).growth;
        return g < 0.9 ? 'decay' : (g > 1.1 ? 'grow' : 'const');
      },
      explain: function () {
        const u = P.ultimateFromFrequency(REF);
        return 'Ku = ' + UI.fmt(u.Ku, 4) + ', so Kp = ' + UI.fmt(0.5 * u.Ku, 4) + ' is well inside the stable region. Successive peaks shrink: the last-to-first peak ratio is ' + UI.fix(P.oscillationTest(REF, 0.5 * u.Ku).growth, 3) + '. Only at Kp = Ku is the ratio 1.';
      },
      apply: function () { document.querySelector('[data-preset="second"]').click(); }
    }
  ]);

  draw();
})();
