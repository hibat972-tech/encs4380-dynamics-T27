/*
 * p2.js — P2: a slow sensor in the feedback path.
 * The engine feeds the controller the SENSOR output y_m (tau_s*y_m' + y_m = y),
 * never the true output y. The page plots both, and sweeps tau_s to show how the
 * overshoot grows until the loop no longer settles.
 */
(function () {
  'use strict';
  const P = PIDSim, M = DynMath, C = UI.C;
  const $ = function (id) { return document.getElementById(id); };

  const FIRST = { type: 'first', K: 1, tau: 1 };
  const PI = { Kp: 2, Ki: 5, Kd: 0 };
  const SENSOR_MAX = 5;

  /* ---------------- controls ---------------- */
  const sensor = UI.slider($('p2-sensor'), { label: 'Sensor time constant τs', min: 0, max: SENSOR_MAX, step: 0.01, value: 0.4, unit: 's', digits: 2,
    tip: 'First-order sensor in the feedback path. τs = 0 is an ideal sensor. Bigger τs means a slower, laggier measurement.' });
  const plant = CUI.plantControls($('p2-plant'), { motorButton: true,
    onMotor: function (m) { gains.set({ Kp: m.Kp, Ki: m.Ki, Kd: 0 }); sp.set(m.setpoint, true); lim.set({ enabled: true, umin: m.umin, umax: m.umax }); unit = m.units; } });
  const gains = CUI.gainControls($('p2-gains'), { Kp: { max: 50, step: 0.01, value: PI.Kp }, Ki: { max: 50, step: 0.01, value: PI.Ki }, Kd: { max: 10, step: 0.001, value: 0 } });
  const sp = UI.slider($('p2-setpoint'), { label: 'Setpoint step r', min: 0.1, max: 1000, log: true, value: 1, unit: '' });
  const lim = CUI.limitControls($('p2-limits'), { on: true, umin: -20, umax: 20, aw: true });
  const time = CUI.timeControl($('p2-time'));
  let unit = '';

  function config(tauS) {
    const l = lim.get();
    return { plant: plant.get(), gains: gains.get(), r: sp.get(), umin: l.umin, umax: l.umax, antiWindup: l.antiWindup,
      sensorTau: tauS === undefined ? sensor.get() : tauS };
  }

  /* ---------------- drawing ---------------- */
  function extraReadouts(a) {
    const s = a.sim, m = a.metrics;
    let osMeas = '—';
    if (m.settled && m.ySS) {
      const pk = Math.max.apply(null, s.ym);
      osMeas = UI.fix(Math.max(0, 100 * (pk - m.ySS) / m.ySS), 2);
    }
    const tauP = plant.get().type === 'first' ? plant.get().tau : null;
    return '<div class="readout"><span class="r-label">Sensor reading overshoot</span><span class="r-value">' + osMeas + (osMeas === '—' ? '' : ' <small>%</small>') +
      '</span><span class="r-sub">of y<sub>m</sub>, what the controller sees</span></div>' +
      '<div class="readout"><span class="r-label">Sensor lag τs</span><span class="r-value">' + UI.fmt(sensor.get(), 3) + ' <small>s</small></span><span class="r-sub">' +
      (tauP ? 'τs/τ = ' + UI.fix(sensor.get() / tauP, 2) : 'second-order plant') + '</span></div>';
  }

  let sweepTimer = null;
  function drawSweep() {
    const cfg0 = config(0);
    const xs = M.linspace(0, SENSOR_MAX, 41);
    const okX = [], okY = [], badX = [], badY = [];
    let topV = 0;
    xs.forEach(function (ts) {
      const cfg = Object.assign({}, cfg0, { sensorTau: ts });
      const T = Math.min(400, Math.max(15 * P.timeScale(cfg), 10));
      let q;
      try { q = P.quickMetrics(cfg, T); } catch (e) { return; }
      const m = q.metrics;
      if (m.status === 'settled' || m.status === 'slow') { okX.push(ts); okY.push(m.overshootPct); topV = Math.max(topV, m.overshootPct); }
      else { badX.push(ts); badY.push(null); }
    });
    const top = Math.min(400, Math.max(60, topV * 1.25));
    UI.plot('p2-sweep', [
      { x: okX, y: okY, name: 'Overshoot of y (loop settles)', mode: 'lines+markers', line: { color: C.out, width: 2.4 }, marker: { size: 5 }, hovertemplate: 'τs = %{x:.2f} s: %{y:.1f}%' },
      { x: badX, y: badX.map(function () { return top * 0.94; }), name: 'Does not settle (oscillates)', mode: 'markers', marker: { color: '#b42d2d', symbol: 'x', size: 9, line: { width: 2 } }, hovertemplate: 'τs = %{x:.2f} s: no settling' }
    ], UI.layout({
      margin: { l: 62, r: 16, t: 40, b: 46 },
      xaxis: UI.axis('Sensor time constant τs (s)', { range: [0, SENSOR_MAX] }),
      yaxis: UI.axis('Overshoot of true output (%)', { range: [0, top], rangemode: 'tozero' }),
      shapes: [UI.vline(sensor.get(), C.mark)],
      uirevision: 'sweep'
    }));
  }

  function update() {
    const cfg = config(), l = lim.get();
    CUI.blockDiagram('p2-diagram', { digital: false, sensor: Math.max(cfg.sensorTau, 0), plant: cfg.plant,
      saturation: l.enabled ? UI.fmt(l.umin, 4) + ' ≤ u ≤ ' + UI.fmt(l.umax, 4) : null });
    CUI.render(cfg, { T: time.get(), unit: unit, extra: extraReadouts, ids: { readouts: 'p2-readouts', status: 'p2-status', resp: 'p2-resp', ctrl: 'p2-ctrl' } });
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(drawSweep, 140);        // the sweep is the slow part; draw it just after the main plots
  }
  const redraw = UI.throttle(update);
  [sensor, plant, gains, lim, time].forEach(function (c) { c.onChange(redraw); });
  sp.onChange(redraw);

  /* ---------------- presets ---------------- */
  function setCase(c) {
    plant.set(c.plant || FIRST, true);
    gains.set(c.gains || PI);
    sensor.set(c.tauS === undefined ? 0.4 : c.tauS, true);
    sp.set(1, true);
    lim.set({ enabled: true, umin: -20, umax: 20, antiWindup: true });
    unit = '';
    update();
  }
  const PRESETS = {
    fast: { tauS: 0.05 }, slow: { tauS: 0.7 }, vslow: { tauS: 2.5 },
    ponly: { tauS: 0.5, gains: { Kp: 9, Ki: 0, Kd: 0 } },
    reset: { tauS: 0.4 }
  };
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () { setCase(PRESETS[b.getAttribute('data-preset')]); });
  });

  /* ---------------- Predict, then check ---------------- */
  function run(tauS, g, extra) { return P.analyze(Object.assign({ plant: FIRST, gains: g || PI, r: 1, sensorTau: tauS, umin: -20, umax: 20 }, extra || {})).metrics; }
  CUI.predict($('p2-predict'), [
    {
      prompt: 'Plant \\(K=1,\\ \\tau=1\\) s with PI control, \\(K_p=2,\\ K_i=5\\). The sensor time constant changes from \\(\\tau_s=0.05\\) s to \\(\\tau_s=0.7\\) s. What happens to the overshoot of the <em>true</em> output?',
      kind: 'choice',
      choices: [{ value: 'up', label: 'It grows a lot' }, { value: 'down', label: 'It gets smaller' }, { value: 'same', label: 'It stays about the same' }],
      answer: function () { const a = run(0.05).overshootPct, b = run(0.7).overshootPct; return b > a + 5 ? 'up' : (b < a - 5 ? 'down' : 'same'); },
      explain: function () {
        return 'Overshoot goes from <strong>' + UI.fix(run(0.05).overshootPct, 1) + '%</strong> to <strong>' + UI.fix(run(0.7).overshootPct, 1) +
          '%</strong>. The controller sees the output late, so it keeps pushing after the real output has arrived. The settling time also stretches from ' +
          UI.fix(run(0.05).settlingTime, 1) + ' s to ' + UI.fix(run(0.7).settlingTime, 1) + ' s.';
      },
      apply: function () { setCase(PRESETS.slow); }
    },
    {
      prompt: 'Same plant and gains, but now \\(\\tau_s=2.5\\) s. Check the stability condition \\((\\tau+\\tau_s)(1+KK_p) > \\tau\\tau_sKK_i\\). Does the loop settle?',
      kind: 'choice',
      choices: [{ value: 'settles', label: 'Yes, it settles to the setpoint' }, { value: 'osc', label: 'No, it keeps oscillating (the amplitude grows until the limits stop it)' }],
      answer: function () { const m = run(2.5); return m.status === 'settled' ? 'settles' : 'osc'; },
      explain: function () {
        return 'Left side: \\((1+2.5)(1+2)=10.5\\). Right side: \\(1\\cdot2.5\\cdot5=12.5\\). The left side is smaller, so the third-order loop is unstable. The simulation agrees: status “' + run(2.5).status + '”. The actuator limits turn the growth into a steady swing.';
      },
      apply: function () { setCase(PRESETS.vslow); }
    },
    {
      prompt: 'The controller computes its error from…',
      kind: 'choice',
      choices: [{ value: 'meas', label: 'the sensor reading y_m (r − y_m)' }, { value: 'true', label: 'the true output y (r − y)' }],
      answer: function () {
        const s = P.simulate({ plant: FIRST, gains: PI, r: 1, sensorTau: 0.7 }, 5);
        let ok = true;
        for (let i = 0; i < s.t.length; i++) if (Math.abs(s.e[i] - (1 - s.ym[i])) > 1e-9) ok = false;
        return ok ? 'meas' : 'true';
      },
      explain: function () { return 'In the simulation, the error at every instant equals \\(r-y_m\\). That is the whole point of this page: the controller can only control what the sensor says. A sensor that lags makes the controller act on stale information.'; },
      apply: function () { setCase(PRESETS.slow); }
    },
    {
      prompt: 'P control only, \\(K_p=9\\), plant \\(K=1,\\ \\tau=1\\). With an ideal sensor the steady-state error is 10%. What is it if the sensor has \\(\\tau_s=1\\) s?',
      kind: 'number', unit: '%', tol: { abs: 0.5 },
      answer: function () { return run(1, { Kp: 9, Ki: 0, Kd: 0 }).essPct; },
      explain: function () { return 'It is still 10%. In steady state the sensor output equals the true output (\\(\\dot y_m=0\\)), so the lag changes how the loop <em>approaches</em> the final value, not the value. What it adds is ringing: the overshoot relative to the final value is ' + UI.fix(run(1, { Kp: 9, Ki: 0, Kd: 0 }).overshootPct, 0) + '%.'; },
      apply: function () { setCase({ tauS: 1, gains: { Kp: 9, Ki: 0, Kd: 0 } }); }
    }
  ]);

  update();
})();
