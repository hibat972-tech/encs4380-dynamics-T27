/*
 * p1.js — P1: PID playground.
 * Reads the sliders, builds one closed-loop configuration, and hands it to the
 * RK4 engine (PIDSim) through CUI.render. No response is hard-coded.
 */
(function () {
  'use strict';
  const P = PIDSim;
  const $ = function (id) { return document.getElementById(id); };
  let unit = '';

  /* ---------------- controls ---------------- */
  const plant = CUI.plantControls($('p1-plant'), {
    onMotor: function (m) {
      gains.set({ Kp: m.Kp, Ki: m.Ki, Kd: 0 });
      sp.set(m.setpoint, true);
      lim.set({ enabled: true, umin: m.umin, umax: m.umax });
      unit = m.units;
    }
  });
  const gains = CUI.gainControls($('p1-gains'), { Kp: { max: 50, step: 0.01, value: 2 }, Ki: { max: 50, step: 0.01, value: 1.5 }, Kd: { max: 10, step: 0.001, value: 0 } });
  const sp = UI.slider($('p1-setpoint'), { label: 'Setpoint step r', min: 0.1, max: 1000, log: true, value: 1, unit: '',
    tip: 'The setpoint jumps from 0 to r at t = 0. Percentages (overshoot, error) do not depend on r.' });
  const lim = CUI.limitControls($('p1-limits'), { on: true, umin: -10, umax: 10, aw: true });
  const time = CUI.timeControl($('p1-time'));

  /* ---------------- drawing ---------------- */
  function config() {
    const l = lim.get();
    return { plant: plant.get(), gains: gains.get(), r: sp.get(), umin: l.umin, umax: l.umax, antiWindup: l.antiWindup };
  }

  function equations(cfg) {
    const p = cfg.plant, g = cfg.gains, K = p.K;
    let tex;
    if (p.type === 'first') {
      const th = P.firstOrderLoopTheory(K, p.tau, g.Kp, g.Ki, g.Kd);
      tex = '(\\tau+KK_d)s^2+(1+KK_p)s+KK_i=0 \\;\\Rightarrow\\; ' + UI.fmt(th.a2, 4) + '\\,s^2+' + UI.fmt(th.a1, 4) + '\\,s+' + UI.fmt(th.a0, 4) + '=0';
      if (th.tauCL !== null) tex += '\\qquad \\tau_{cl}=' + UI.fmt(th.tauCL, 4) + '\\text{ s},\\; e_{ss}=' + UI.fmt(100 * th.essFrac, 4) + '\\%';
      else if (th.wn !== null) tex += '\\qquad \\omega_n=' + UI.fmt(th.wn, 4) + '\\text{ rad/s},\\; \\zeta=' + UI.fmt(th.zeta, 4);
    } else {
      const c3 = 2 * p.zeta * p.wn + K * p.wn * p.wn * g.Kd, c2 = p.wn * p.wn * (1 + K * g.Kp), c1 = K * p.wn * p.wn * g.Ki;
      tex = 's^3+(2\\zeta\\omega_n+K\\omega_n^2K_d)s^2+\\omega_n^2(1+KK_p)s+K\\omega_n^2K_i=0 \\;\\Rightarrow\\; s^3+' +
        UI.fmt(c3, 4) + '\\,s^2+' + UI.fmt(c2, 4) + '\\,s+' + UI.fmt(c1, 4) + '=0';
      if (g.Ki === 0 && g.Kd === 0) {
        const f = Math.sqrt(1 + K * g.Kp);
        tex += '\\qquad (\\text{P only: } \\omega_n\'=' + UI.fmt(p.wn * f, 4) + ',\\; \\zeta\'=' + UI.fmt(p.zeta / f, 4) + ')';
      }
    }
    UI.tex('p1-eq', tex, true);
  }

  function update() {
    const cfg = config(), l = lim.get();
    CUI.blockDiagram('p1-diagram', { digital: false, sensor: 0, plant: cfg.plant,
      saturation: l.enabled ? UI.fmt(l.umin, 4) + ' ≤ u ≤ ' + UI.fmt(l.umax, 4) : null });
    CUI.render(cfg, { T: time.get(), unit: unit, ids: { readouts: 'p1-readouts', status: 'p1-status', resp: 'p1-resp', ctrl: 'p1-ctrl', terms: 'p1-terms' } });
    equations(cfg);
  }
  const redraw = UI.throttle(update);
  [plant, gains, lim, time].forEach(function (c) { c.onChange(redraw); });
  sp.onChange(redraw);

  /* ---------------- presets ---------------- */
  function setCase(c) {
    if (c.plant) plant.set(c.plant, true);
    if (c.gains) gains.set(c.gains);
    sp.set(c.r === undefined ? 1 : c.r, true);
    lim.set(c.lim || { enabled: true, umin: -10, umax: 10, antiWindup: true });
    unit = '';
    update();
  }
  const FIRST = { type: 'first', K: 1, tau: 1 };
  const SECOND = { type: 'second', K: 1, zeta: 0.2, wn: 4 };
  const PRESETS = {
    v1: { plant: FIRST, gains: { Kp: 9, Ki: 0, Kd: 0 } },
    v2: { plant: FIRST, gains: { Kp: 1, Ki: 1, Kd: 0 } },
    poi: { plant: FIRST, gains: { Kp: 9, Ki: 40, Kd: 0 } },
    d2: { plant: SECOND, gains: { Kp: 2, Ki: 0, Kd: 0.3 } },
    reset: { plant: FIRST, gains: { Kp: 2, Ki: 1.5, Kd: 0 } }
  };
  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () { setCase(PRESETS[b.getAttribute('data-preset')]); });
  });

  /* ---------------- Predict, then check ---------------- */
  // Every answer below is computed with the same engine that draws the plots.
  function mx(plantCfg, g, extra) {
    return P.analyze(Object.assign({ plant: plantCfg, gains: g, r: 1 }, extra || {})).metrics;
  }
  CUI.predict($('p1-predict'), [
    {
      prompt: 'First-order plant with \\(K=1\\) and \\(\\tau=1\\) s, <strong>P control only</strong>, \\(K_p=9\\). What steady-state error (as a % of the setpoint) will the loop have?',
      kind: 'number', unit: '%', tol: { abs: 0.5 },
      answer: function () { return mx(FIRST, { Kp: 9, Ki: 0, Kd: 0 }).essPct; },
      explain: function () { return 'With P only, \\(e_{ss}=1/(1+KK_p)=1/10\\). The loop is also ten times faster than the plant (\\(\\tau_{cl}=0.1\\) s), but it never reaches the setpoint.'; },
      apply: function () { setCase(PRESETS.v1); }
    },
    {
      prompt: 'Keep \\(K_p=9\\) and add integral action, \\(K_i=40\\). What happens?',
      kind: 'choice',
      choices: [
        { value: 'a', label: 'The error goes to zero, but the output now overshoots the setpoint' },
        { value: 'b', label: 'The error goes to zero and there is still no overshoot' },
        { value: 'c', label: 'The error stays at 10%' }
      ],
      answer: function () {
        const m = mx(FIRST, { Kp: 9, Ki: 40, Kd: 0 });
        if (Math.abs(m.essPct) > 0.5) return 'c';
        return m.overshootPct > 1 ? 'a' : 'b';
      },
      explain: function () {
        const m = mx(FIRST, { Kp: 9, Ki: 40, Kd: 0 });
        return 'The integral keeps adding to u until the error is exactly zero, so \\(e_{ss}=0\\). But it is still pushing when the output arrives, so the loop overshoots: here \\(\\zeta=(1+KK_p)/(2\\sqrt{\\tau KK_i})\\approx0.79\\) and the measured overshoot is <strong>' + UI.fix(m.overshootPct, 1) + '%</strong>.';
      },
      apply: function () { setCase(PRESETS.poi); }
    },
    {
      prompt: 'Second-order plant with \\(\\zeta=0.2\\), \\(\\omega_n=4\\) rad/s, P control \\(K_p=2\\). You now add derivative action, \\(K_d=0.3\\). What happens to the overshoot?',
      kind: 'choice',
      choices: [
        { value: 'down', label: 'It falls: D adds damping' },
        { value: 'up', label: 'It rises' },
        { value: 'same', label: 'It stays the same' }
      ],
      answer: function () {
        const a = mx(SECOND, { Kp: 2, Ki: 0, Kd: 0 }).overshootPct, b = mx(SECOND, { Kp: 2, Ki: 0, Kd: 0.3 }).overshootPct;
        return b < a - 1 ? 'down' : (b > a + 1 ? 'up' : 'same');
      },
      explain: function () {
        const a = mx(SECOND, { Kp: 2, Ki: 0, Kd: 0 }).overshootPct, b = mx(SECOND, { Kp: 2, Ki: 0, Kd: 0.3 }).overshootPct;
        return 'D adds \\(K\\omega_n^2K_d\\) to the damping term of the loop. The overshoot goes from <strong>' + UI.fix(a, 1) + '%</strong> to <strong>' + UI.fix(b, 1) + '%</strong>. The steady-state error does not change, because D is zero once the output stops moving.';
      },
      apply: function () { setCase({ plant: SECOND, gains: { Kp: 2, Ki: 0, Kd: 0.3 } }); }
    },
    {
      prompt: 'Back to the first-order plant (\\(K=1,\\ \\tau=1\\)) with PI, \\(K_p=2\\), \\(K_i=3\\). You add \\(K_d=1\\). What happens to the rise time?',
      kind: 'choice',
      choices: [
        { value: 'slower', label: 'It gets longer: D makes the response slower' },
        { value: 'faster', label: 'It gets shorter' },
        { value: 'same', label: 'It does not change' }
      ],
      answer: function () {
        const a = mx(FIRST, { Kp: 2, Ki: 3, Kd: 0 }).riseTime, b = mx(FIRST, { Kp: 2, Ki: 3, Kd: 1 }).riseTime;
        return b > a * 1.03 ? 'slower' : (b < a * 0.97 ? 'faster' : 'same');
      },
      explain: function () {
        const a = mx(FIRST, { Kp: 2, Ki: 3, Kd: 0 }), b = mx(FIRST, { Kp: 2, Ki: 3, Kd: 1 });
        return 'The loop equation is \\((\\tau+KK_d)s^2+(1+KK_p)s+KK_i=0\\). D enlarges the first coefficient, as if the plant had a larger time constant. Rise time goes from <strong>' + UI.fmt(a.riseTime, 3) + ' s</strong> to <strong>' + UI.fmt(b.riseTime, 3) +
          ' s</strong> and overshoot from ' + UI.fix(a.overshootPct, 1) + '% to ' + UI.fix(b.overshootPct, 1) + '%. D helps a plant that rings, not one that is already smooth.';
      },
      apply: function () { setCase({ plant: FIRST, gains: { Kp: 2, Ki: 3, Kd: 1 } }); }
    }
  ]);

  update();
})();
