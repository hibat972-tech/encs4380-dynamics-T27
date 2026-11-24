/*
 * control-ui.js
 * Shared helpers for the Homework 2 "Control" pages (P1-P4, My System, Z-N, validation).
 * Builds on the Homework 1 helpers in ui.js (sliders, segmented controls, Plotly wrappers,
 * "Predict, then check") and on the closed-loop engine in pid-sim.js.
 *
 *   CUI.mountHeader(active)       top navigation bar
 *   CUI.store                      the project motor saved by the "My System" page (localStorage)
 *   CUI.plantControls / gainControls / limitControls / timeControl    control panels
 *   CUI.blockDiagram               SVG block diagram of the loop being simulated
 *   CUI.render                     simulate + draw output, control signal, readouts, status
 *   CUI.codeBox                    code viewer with a Copy button
 */
(function (root) {
  'use strict';
  const P = root.PIDSim, M = root.DynMath;
  const CUI = {};
  const C = UI.C;
  const el = UI.el;

  /* ------------------------------------------------------------ */
  /* Header                                                         */
  /* ------------------------------------------------------------ */

  const NAV = [
    ['control', 'control.html', null, 'Control'],
    ['p1', 'p1.html', 'P1', 'PID playground'],
    ['p2', 'p2.html', 'P2', 'Slow sensor'],
    ['p3', 'p3.html', 'P3', 'Digital PID'],
    ['p4', 'p4.html', 'P4', 'Tuning challenge'],
    ['mysystem', 'mysystem.html', null, 'My System'],
    ['validation', 'control-validation.html', null, 'Validation'],
    ['zn', 'zn.html', null, 'Bonus: Z-N']
  ];

  CUI.mountHeader = function (active) {
    const h = document.getElementById('site-header');
    if (!h) return;
    h.className = 'topbar';
    let links = '<a href="index.html">Home</a>';
    NAV.forEach(function (n) {
      links += '<a href="' + n[1] + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' +
        (n[2] ? '<span class="nav-num nav-p">' + n[2] + '</span>' : '') + n[3] + '</a>';
    });
    links += '<a href="module1.html">Homework 1</a>';
    h.innerHTML = '<div class="topbar-inner"><a class="brand" href="index.html" aria-label="Dynamic Characteristics Toolkit, home">' +
      '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="5" fill="#1d4f86"/><path d="M4 20 H7 V7 H22" fill="none" stroke="#9fb6cf" stroke-width="1.6" stroke-dasharray="2 2"/><path d="M7 20 C10 10, 14 8, 22 7.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>' +
      '<span class="brand-text">Dynamic Characteristics Toolkit</span></a>' +
      '<nav class="nav" aria-label="Control section">' + links + '</nav></div>';
  };

  /* ------------------------------------------------------------ */
  /* The project motor (saved by My System, loaded by P1-P3)        */
  /* ------------------------------------------------------------ */

  const STORE_KEY = 'dct-hw2-motor';
  CUI.DEFAULT_MOTOR = {
    K: 4, tau: 0.08, units: 'mm/s', setpoint: 300, umin: 0, umax: 100,
    zeta: 0.7, tsTarget: 0.5, Ts: 0.01,
    status: 'illustrative',
    source: 'Illustrative placeholder values for testing the pages. They were NOT measured on our robot.',
    Kp: null, Ki: null, Kd: 0
  };
  CUI.store = {
    load: function () {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* storage unavailable */ }
      const m = Object.assign({}, CUI.DEFAULT_MOTOR, saved || {});
      if (!(m.Kp !== null && m.Ki !== null && isFinite(m.Kp) && isFinite(m.Ki))) {
        const d = P.designPI(m.K, m.tau, m.zeta, P.wnFromSettling(m.tsTarget, m.zeta));
        m.Kp = Math.max(0, d.Kp); m.Ki = d.Ki;
      }
      return m;
    },
    save: function (m) { try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch (e) { /* storage unavailable */ } },
    clear: function () { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------------------------------------ */
  /* Control panels                                                 */
  /* ------------------------------------------------------------ */

  /**
   * Plant selector: first order (Module 1) or second order (Module 3), with their sliders.
   * o: {type, K, tau, zeta, wn, motorButton (default true), onMotor(motor)}
   * Returns {get, set, onChange}. get() -> {type, K, tau} | {type, K, zeta, wn}
   */
  CUI.plantControls = function (container, o) {
    const d = Object.assign({ type: 'first', K: 1, tau: 1, zeta: 0.3, wn: 4, motorButton: true }, o || {});
    const seg = UI.segmented(container, { label: 'Plant', value: d.type,
      options: [{ value: 'first', label: 'First order' }, { value: 'second', label: 'Second order' }],
      tip: 'First order: Module 1, K/(τs+1). Second order: Module 3, Kωn²/(s²+2ζωn s+ωn²).' });
    const K = UI.slider(container, { label: 'Plant gain K', min: 0.05, max: 20, log: true, value: d.K, unit: 'out/in',
      tip: 'Steady-state output per unit of control signal u.' });
    const tau = UI.slider(container, { label: 'Time constant τ', min: 0.01, max: 20, log: true, value: d.tau, unit: 's',
      tip: 'The open-loop plant reaches 63.2% of its final value after τ seconds.' });
    const zeta = UI.slider(container, { label: 'Damping ratio ζ', min: 0.05, max: 2, step: 0.01, value: d.zeta, unit: '', digits: 2,
      tip: 'ζ < 1 rings (overshoots) on its own. ζ ≥ 1 does not.' });
    const wn = UI.slider(container, { label: 'Natural frequency ωn', min: 0.2, max: 50, log: true, value: d.wn, unit: 'rad/s',
      tip: 'Speed of the second-order plant. All its times scale with 1/ωn.' });
    const listeners = [];
    function fire() { listeners.forEach(function (fn) { fn(); }); }
    function layout() {
      const first = seg.get() === 'first';
      tau.show(first); zeta.show(!first); wn.show(!first);
    }
    seg.onChange(function () { layout(); fire(); });
    [K, tau, zeta, wn].forEach(function (s) { s.onChange(fire); });
    layout();
    const api = {
      get: function () {
        return seg.get() === 'first' ? { type: 'first', K: K.get(), tau: tau.get() } : { type: 'second', K: K.get(), zeta: zeta.get(), wn: wn.get() };
      },
      set: function (p, silent) {
        seg.set(p.type, true);
        K.set(p.K, true);
        if (p.type === 'first') tau.set(p.tau, true); else { zeta.set(p.zeta, true); wn.set(p.wn, true); }
        layout();
        if (!silent) fire();
      },
      onChange: function (fn) { listeners.push(fn); }
    };
    if (d.motorButton) {
      const row = el('div', { class: 'ctl' });
      row.innerHTML = '<button type="button" class="btn ghost motor-btn">Use my project motor (My System page)</button>' +
        '<div class="ctl-hint motor-hint"></div>';
      container.appendChild(row);
      row.querySelector('button').addEventListener('click', function () {
        const m = CUI.store.load();
        api.set({ type: 'first', K: m.K, tau: m.tau }, true);
        row.querySelector('.motor-hint').textContent = 'Loaded K = ' + UI.fmt(m.K, 4) + ' ' + m.units + ' per %, τ = ' + UI.fmt(m.tau, 4) + ' s (' +
          (m.status === 'illustrative' ? 'illustrative placeholder values' : m.status) + ').';
        if (d.onMotor) d.onMotor(m);
        fire();
      });
    }
    return api;
  };

  /** Kp, Ki, Kd sliders. r: {Kp:{max,step,value}, Ki:{...}, Kd:{...}} */
  CUI.gainControls = function (container, r) {
    const d = Object.assign({
      Kp: { max: 50, step: 0.01, value: 1 }, Ki: { max: 50, step: 0.01, value: 0 }, Kd: { max: 10, step: 0.001, value: 0 }
    }, r || {});
    const sl = {
      Kp: UI.slider(container, { label: 'Proportional gain Kp', min: 0, max: d.Kp.max, step: d.Kp.step, value: d.Kp.value, unit: 'u/e',
        tip: 'Acts on the present error. Raises speed, leaves a steady-state error if used alone.' }),
      Ki: UI.slider(container, { label: 'Integral gain Ki', min: 0, max: d.Ki.max, step: d.Ki.step, value: d.Ki.value, unit: 'u/(e·s)',
        tip: 'Acts on the accumulated error. Removes the steady-state error but can add overshoot.' }),
      Kd: UI.slider(container, { label: 'Derivative gain Kd', min: 0, max: d.Kd.max, step: d.Kd.step, value: d.Kd.value, unit: 'u·s/e',
        tip: 'Acts on the rate of change of the measurement. Adds damping to a second-order plant.' })
    };
    return {
      get: function () { return { Kp: sl.Kp.get(), Ki: sl.Ki.get(), Kd: sl.Kd.get() }; },
      /** Move the sliders (no redraw: the caller redraws once afterwards). */
      set: function (g) { ['Kp', 'Ki', 'Kd'].forEach(function (k) { if (g[k] !== undefined) sl[k].set(g[k], true); }); },
      onChange: function (fn) { ['Kp', 'Ki', 'Kd'].forEach(function (k) { sl[k].onChange(fn); }); },
      sliders: sl
    };
  };

  /**
   * Control-signal limits and anti-windup.
   * o: {on, umin, umax, aw, allowOff (default true), unit}
   */
  CUI.limitControls = function (container, o) {
    const d = Object.assign({ on: true, umin: -10, umax: 10, aw: true, allowOff: true, unit: 'u', showAW: true }, o || {});
    const on = d.allowOff ? UI.checkbox(container, { label: 'Limit the control signal (actuator saturation)', checked: d.on }) : null;
    const lo = UI.slider(container, { label: 'Lower limit umin', min: -200, max: 100, step: 0.5, value: d.umin, unit: d.unit,
      tip: 'The actuator cannot push below this (for example 0% PWM).' });
    const hi = UI.slider(container, { label: 'Upper limit umax', min: -100, max: 200, step: 0.5, value: d.umax, unit: d.unit,
      tip: 'The actuator cannot push above this (for example 100% PWM).' });
    const aw = d.showAW ? UI.checkbox(container, { label: 'Anti-windup (stop integrating while saturated)', checked: d.aw }) : null;
    function sync() { const e = !on || on.get(); lo.setEnabled(e); hi.setEnabled(e); }
    if (on) on.onChange(sync);
    sync();
    return {
      get: function () {
        const e = !on || on.get();
        return { umin: e ? lo.get() : -Infinity, umax: e ? hi.get() : Infinity, antiWindup: aw ? aw.get() : true, enabled: e };
      },
      set: function (v, silent) {
        if (on && v.enabled !== undefined) on.set(v.enabled, true);
        if (v.umin !== undefined) lo.set(v.umin, true);
        if (v.umax !== undefined) hi.set(v.umax, true);
        if (aw && v.antiWindup !== undefined) aw.set(v.antiWindup, true);
        sync();
      },
      onChange: function (fn) { if (on) on.onChange(fn); lo.onChange(fn); hi.onChange(fn); if (aw) aw.onChange(fn); }
    };
  };

  /** Automatic or manual simulation window. get() returns undefined for "automatic". */
  CUI.timeControl = function (container) {
    const auto = UI.checkbox(container, { label: 'Choose the time window automatically', checked: true });
    const T = UI.slider(container, { label: 'Time window T', min: 0.05, max: 500, log: true, value: 10, unit: 's' });
    T.setEnabled(false);
    auto.onChange(function (v) { T.setEnabled(!v); });
    return {
      get: function () { return auto.get() ? undefined : T.get(); },
      onChange: function (fn) { auto.onChange(fn); T.onChange(fn); }
    };
  };

  /* ------------------------------------------------------------ */
  /* Block diagram                                                  */
  /* ------------------------------------------------------------ */

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  /**
   * SVG block diagram of the simulated loop.
   * o: {digital, sensor (tau_s or 0), saturation: 'umin … umax' text or null, plant: {type, ...}, Ts}
   */
  CUI.blockDiagram = function (target, o) {
    const node = typeof target === 'string' ? document.getElementById(target) : target;
    const p = o.plant || { type: 'first' };
    const plantSub = p.type === 'second' ? 'Kωn² / (s² + 2ζωn s + ωn²)' : 'K / (τs + 1)';
    const blocks = [];
    if (o.digital) blocks.push({ t: 'Sampler', s: 'every Ts', w: 92 });
    blocks.push({ t: 'PID controller', s: o.digital ? 'u[k] = Kp e + Ki Ts Σe + Kd Δe/Ts' : 'Kp + Ki/s + Kd s', w: o.digital ? 236 : 168 });
    blocks.push({ t: 'Saturation', s: o.saturation || 'no limit', w: 130, cls: 'sat' });
    if (o.digital) blocks.push({ t: 'Hold (ZOH)', s: 'u constant for Ts', w: 130 });
    blocks.push({ t: 'Plant', s: plantSub, w: 190 });
    const gap = 40, top = 74, h = 54;
    let x = 150;
    const pos = blocks.map(function (b) { const r = { x: x, w: b.w }; x += b.w + gap; return r; });
    const outX = x - gap + 50;       // end of the forward path
    const tapX = outX - 36;           // where the measurement is taken
    const W = outX + 70, H = o.sensor ? 232 : 196;
    const fbY = o.sensor ? 190 : 168;
    const cy = top + h / 2;
    const stroke = '#1d4f86', ink = '#15273a', grey = '#3d4c5c';
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="min-width:' + Math.min(W, 760) + 'px" role="img" aria-label="Block diagram of the closed loop">' +
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + grey + '"/></marker></defs>' +
      '<g font-family="system-ui, sans-serif" font-size="13" fill="' + ink + '">';
    // reference in, summing junction
    s += '<text x="10" y="' + (cy - 8) + '" font-style="italic">r(t)</text><text x="10" y="' + (cy + 8) + '" font-size="11" fill="' + grey + '">setpoint</text>';
    s += '<line x1="58" y1="' + cy + '" x2="94" y2="' + cy + '" stroke="' + grey + '" stroke-width="1.6" marker-end="url(#arr)"/>';
    s += '<circle cx="110" cy="' + cy + '" r="16" fill="#fff" stroke="' + stroke + '" stroke-width="1.6"/>';
    s += '<text x="110" y="' + (cy + 4) + '" text-anchor="middle" font-weight="700">Σ</text>';
    s += '<text x="92" y="' + (cy - 20) + '" font-size="13" font-weight="700">+</text><text x="116" y="' + (cy + 34) + '" font-size="15" font-weight="700">−</text>';
    // forward path
    let prev = 126;
    blocks.forEach(function (b, i) {
      const q = pos[i];
      s += '<line x1="' + prev + '" y1="' + cy + '" x2="' + (q.x - 2) + '" y2="' + cy + '" stroke="' + grey + '" stroke-width="1.6" marker-end="url(#arr)"/>';
      s += '<rect x="' + q.x + '" y="' + top + '" width="' + q.w + '" height="' + h + '" rx="7" fill="' + (b.cls === 'sat' ? '#fff6ec' : '#eef4fb') + '" stroke="' + (b.cls === 'sat' ? '#c4621f' : stroke) + '" stroke-width="1.5"/>';
      s += '<text x="' + (q.x + q.w / 2) + '" y="' + (top + 22) + '" text-anchor="middle" font-weight="700">' + esc(b.t) + '</text>';
      s += '<text x="' + (q.x + q.w / 2) + '" y="' + (top + 41) + '" text-anchor="middle" font-size="11.5" fill="' + grey + '">' + esc(b.s) + '</text>';
      prev = q.x + q.w;
    });
    s += '<line x1="' + prev + '" y1="' + cy + '" x2="' + outX + '" y2="' + cy + '" stroke="' + grey + '" stroke-width="1.6" marker-end="url(#arr)"/>';
    s += '<text x="' + (outX + 6) + '" y="' + (cy - 8) + '" font-style="italic">y(t)</text><text x="' + (outX + 6) + '" y="' + (cy + 9) + '" font-size="11" fill="' + grey + '">true output</text>';
    // labels on the signals
    s += '<text x="' + (126 + 6) + '" y="' + (cy - 8) + '" font-style="italic" font-size="12">e</text>';
    const uX = pos[o.digital ? 2 : 1].x - 28;
    s += '<text x="' + uX + '" y="' + (cy - 8) + '" font-style="italic" font-size="12">u*</text>';
    const uX2 = pos[blocks.length - 1].x - 22;
    s += '<text x="' + uX2 + '" y="' + (cy - 8) + '" font-style="italic" font-size="12">u</text>';
    // feedback path
    s += '<circle cx="' + tapX + '" cy="' + cy + '" r="3.2" fill="' + grey + '"/>';
    if (o.sensor) {
      const sw = 200, sx = (110 + tapX) / 2 - sw / 2;
      s += '<polyline points="' + tapX + ',' + cy + ' ' + tapX + ',' + fbY + ' ' + (sx + sw + 2) + ',' + fbY + '" fill="none" stroke="' + grey + '" stroke-width="1.6" marker-end="url(#arr)"/>';
      s += '<rect x="' + sx + '" y="' + (fbY - 27) + '" width="' + sw + '" height="54" rx="7" fill="#fff6ec" stroke="#c4621f" stroke-width="1.5"/>';
      s += '<text x="' + (sx + sw / 2) + '" y="' + (fbY - 5) + '" text-anchor="middle" font-weight="700">Sensor</text>';
      s += '<text x="' + (sx + sw / 2) + '" y="' + (fbY + 14) + '" text-anchor="middle" font-size="11.5" fill="' + grey + '">1 / (τs·s + 1)   τs = ' + esc(UI.fmt(o.sensor, 3)) + ' s</text>';
      s += '<polyline points="' + sx + ',' + fbY + ' 110,' + fbY + ' 110,' + (cy + 17) + '" fill="none" stroke="' + grey + '" stroke-width="1.6" marker-end="url(#arr)"/>';
      s += '<text x="' + (tapX - 118) + '" y="' + (fbY - 32) + '" font-style="italic" font-size="12" fill="#c4621f">y_m (what the controller sees)</text>';
    } else {
      s += '<polyline points="' + tapX + ',' + cy + ' ' + tapX + ',' + fbY + ' 110,' + fbY + ' 110,' + (cy + 17) + '" fill="none" stroke="' + grey + '" stroke-width="1.6" marker-end="url(#arr)"/>';
      s += '<text x="' + (tapX - 190) + '" y="' + (fbY - 8) + '" font-style="italic" font-size="12">y_m = y (ideal sensor)</text>';
    }
    s += '</g></svg>';
    node.innerHTML = s;
  };

  /* ------------------------------------------------------------ */
  /* Readouts and status                                            */
  /* ------------------------------------------------------------ */

  function readout(label, value, unit, sub, key) {
    return '<div class="readout' + (key ? ' key' : '') + '"><span class="r-label">' + label + '</span><span class="r-value">' + value +
      (unit ? ' <small>' + unit + '</small>' : '') + '</span><span class="r-sub">' + (sub || '') + '</span></div>';
  }

  /** The four required metrics, plus supporting values. */
  CUI.readoutsHTML = function (m, r, o) {
    const opt = o || {};
    const unit = opt.unit || '';
    const bad = m.status === 'diverged' || m.status === 'no-response';
    const settled = m.settled;
    const pc = function (v) { return UI.fix(Math.abs(v) < 0.005 ? 0 : v, Math.abs(v) < 10 ? 2 : 1); };   // never print "−0.00"
    let html = '';
    html += readout('Rise time (10→90%)', m.riseTime === null || bad ? '—' : UI.fmt(m.riseTime, 3), 's',
      m.riseTime === null ? 'output never reaches 90%' : 'tr, read off the curve', true);
    html += readout('Overshoot', bad ? '—' : pc(m.overshootPct), '%', settled ? 'peak above the final value' : (bad ? '' : 'against the setpoint (not settled)'), true);
    html += readout('Settling time (±' + Math.round(m.band * 100) + '%)', settled ? UI.fmt(m.settlingTime, 3) : (bad ? '—' : 'never'), settled ? 's' : '',
      settled ? 'last time outside the band' : (bad ? '' : 'output does not settle'), true);
    html += readout('Steady-state error', settled ? pc(m.essPct) : '—', settled ? '%' : '',
      settled ? 'r − y∞ = ' + UI.fmt(m.essAbs, 3) + (unit ? ' ' + unit : '') : (m.status === 'no-response' ? 'output stays at 0' : 'needs a settled output'), true);
    if (m.ySS !== null && settled) html += readout('Final value y∞', UI.fmt(m.ySS, 4), unit, 'setpoint r = ' + UI.fmt(r, 4));
    if (opt.showU !== false && isFinite(m.umax)) {
      html += readout('Control signal range', UI.fmt(m.umin, 3) + ' … ' + UI.fmt(m.umax, 3), '', m.saturated ? 'the limit was reached (saturation)' : 'inside the limits');
    }
    return html;
  };

  CUI.statusNote = function (m) {
    switch (m.status) {
      case 'settled': return null;
      case 'oscillating': return { cls: 'warn', html: '<strong>The output keeps oscillating and never settles.</strong> Settling time and steady-state error are not defined, so they are not shown. The overshoot is measured against the setpoint.' };
      case 'growing': return { cls: 'bad', html: '<strong>Unstable: the oscillation grows.</strong> The loop is gaining energy each cycle. (If a control limit is set, the output ends up in a steady limit cycle instead.)' };
      case 'diverged': return { cls: 'bad', html: '<strong>Unstable: the output blew up.</strong> The simulation was stopped when |y| became enormous. Lower the gains.' };
      case 'slow': return { cls: 'warn', html: '<strong>Still moving at the end of the window.</strong> The response is very slow (for example a tiny Ki). Increase the gains or the time window.' };
      case 'no-response': return { cls: 'warn', html: '<strong>No control action.</strong> With every gain at zero, u = 0 and the output stays at 0. Raise Kp.' };
      default: return null;
    }
  };

  /* ------------------------------------------------------------ */
  /* Plots                                                          */
  /* ------------------------------------------------------------ */

  /** Robust y-range: clip wild values (unstable loops) and pad. */
  function range(arrays, lo0, hi0, clip) {
    let lo = lo0, hi = hi0;
    arrays.forEach(function (a) { a.forEach(function (v) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); });
    if (isFinite(clip)) { hi = Math.min(hi, clip); lo = Math.max(lo, -clip); }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = 0.07 * (hi - lo);
    return [lo - pad, hi + pad];
  }

  function hlineShape(y, color, dash) {
    return { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: y, y1: y, line: { color: color, width: 1.4, dash: dash || 'dash' } };
  }

  /**
   * Run the closed loop and draw everything.
   * cfg: engine config. o: {T, ids:{readouts, status, resp, ctrl, terms}, unit, riseDef, band, showSamples}
   * Returns the analysis result.
   */
  CUI.render = function (cfg, o) {
    let a;
    try {
      a = P.analyze(cfg, { T: o.T, band: o.band, riseDef: o.riseDef, minPlot: o.minPlot });
    } catch (err) {
      if (o.ids.status) UI.set(o.ids.status, '<div class="note-box bad">' + esc(err.message) + '</div>');
      return null;
    }
    const s = a.sim, m = a.metrics, r = s.r, ids = o.ids;
    const tMax = s.t[s.t.length - 1];
    const hasSensor = s.cfg.tauS > 0;
    const unit = o.unit || '';

    if (ids.readouts) UI.set(ids.readouts, CUI.readoutsHTML(m, r, { unit: unit }) + (o.extra ? o.extra(a) : ''));
    if (ids.status) {
      const n = CUI.statusNote(m);
      const warn = s.warnings.length ? '<div class="note-box warn">' + s.warnings.map(esc).join(' ') + '</div>' : '';
      UI.set(ids.status, (n ? '<div class="note-box ' + n.cls + '" role="status">' + n.html + '</div>' : '') + warn);
    }

    // ---- output plot ----
    if (ids.resp) {
      const clip = 12 * Math.max(Math.abs(r), 1e-9);
      const yr = range([s.y, s.ym], Math.min(0, r), Math.max(0, r), clip);
      const traces = [
        { x: [0, 0, tMax], y: [0, r, r], name: 'Setpoint r', mode: 'lines', line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.4g}' },
        { x: s.t, y: s.y, name: hasSensor ? 'True output y(t)' : 'Output y(t)', mode: 'lines', line: { color: C.out, width: 3 }, hovertemplate: '%{y:.4g}' }
      ];
      if (hasSensor) traces.push({ x: s.t, y: s.ym, name: 'Sensor reading y_m(t)', mode: 'lines', line: { color: C.mark, width: 2.2 }, hovertemplate: '%{y:.4g}' });
      if (o.showSamples && s.samples && s.samples.t.length <= 600) {
        traces.push({ x: s.samples.t, y: s.samples.ym, name: 'Sampled measurement', mode: 'markers', marker: { color: C.third, size: 6, line: { color: '#fff', width: 1 } }, hovertemplate: '%{y:.4g}' });
      }
      const shapes = (o.respShapes || []).slice(), ann = (o.respAnnotations || []).slice();
      if (m.settled) {
        shapes.push({ type: 'rect', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: m.ySS * (1 - m.band), y1: m.ySS * (1 + m.band), fillcolor: 'rgba(42,120,214,0.09)', line: { width: 0 } });
        if (m.settlingTime !== null && m.settlingTime < tMax) {
          shapes.push({ type: 'line', xref: 'x', x0: m.settlingTime, x1: m.settlingTime, yref: 'paper', y0: 0, y1: 1, line: { color: C.third, width: 1.4, dash: 'dot' } });
          ann.push({ x: m.settlingTime, yref: 'paper', y: 0.02, text: 'ts', showarrow: false, xanchor: 'left', xshift: 4, font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
        }
      }
      UI.plot(ids.resp, traces, UI.layout({
        margin: { l: 62, r: 16, t: 40, b: 46 },
        xaxis: UI.axis('Time t (s)', { range: [0, tMax] }),
        yaxis: UI.axis('Output' + (unit ? ' (' + unit + ')' : ''), { range: yr }),
        shapes: shapes, annotations: ann,
        uirevision: o.keepZoom ? 'keep' : String(Math.round(tMax * 1000))
      }));
    }

    // ---- control-signal plot ----
    if (ids.ctrl) {
      const stair = s.stair;
      const ux = stair ? stair.t : s.t, uy = stair ? stair.u : s.u;
      const lims = [];
      if (isFinite(s.cfg.umax)) lims.push(s.cfg.umax);
      if (isFinite(s.cfg.umin)) lims.push(s.cfg.umin);
      // only an exploding (unstable, unlimited) control signal needs clipping for display
      const uClip = m.status === 'diverged' ? 20 * Math.max(1, Math.abs(r)) : Infinity;
      const ur = range([uy, lims], 0, 0, uClip);
      const traces = [];
      const showRaw = s.uRaw.some(function (v, i) { return v !== s.u[i]; }) && !stair;
      if (showRaw) traces.push({ x: s.t, y: s.uRaw, name: 'Controller output before the limit', mode: 'lines', line: { color: '#9aa5b1', width: 1.4, dash: 'dot' }, hovertemplate: '%{y:.4g}' });
      traces.push({ x: ux, y: uy, name: stair ? 'Control signal u[k] (held between samples)' : 'Control signal u(t)', mode: 'lines', line: { color: C.mark, width: 2.6 }, hovertemplate: '%{y:.4g}' });
      const shapes = [], ann = [];
      if (isFinite(s.cfg.umax)) { shapes.push(hlineShape(s.cfg.umax, '#b42d2d')); ann.push({ xref: 'paper', x: 1, y: s.cfg.umax, text: 'umax = ' + UI.fmt(s.cfg.umax, 4), showarrow: false, xanchor: 'right', yanchor: 'bottom', font: { size: 11.5, color: '#b42d2d' } }); }
      if (isFinite(s.cfg.umin)) { shapes.push(hlineShape(s.cfg.umin, '#b42d2d')); ann.push({ xref: 'paper', x: 1, y: s.cfg.umin, text: 'umin = ' + UI.fmt(s.cfg.umin, 4), showarrow: false, xanchor: 'right', yanchor: 'top', font: { size: 11.5, color: '#b42d2d' } }); }
      UI.plot(ids.ctrl, traces, UI.layout({
        margin: { l: 62, r: 16, t: 40, b: 46 },
        xaxis: UI.axis('Time t (s)', { range: [0, tMax] }),
        yaxis: UI.axis('Control signal u', { range: ur }),
        shapes: shapes, annotations: ann,
        uirevision: o.keepZoom ? 'keep' : String(Math.round(tMax * 1000))
      }));
    }

    // ---- P, I, D contributions ----
    if (ids.terms) {
      const tt = s.t;
      const pr = range([s.pTerm, s.iTerm, s.dTerm], 0, 0, m.status === 'diverged' ? 20 * Math.max(1, Math.abs(r)) : Infinity);
      UI.plot(ids.terms, [
        { x: tt, y: s.pTerm, name: 'P part: Kp·e', mode: 'lines', line: { color: C.out, width: 2.2, shape: 'linear' }, hovertemplate: '%{y:.4g}' },
        { x: tt, y: s.iTerm, name: 'I part: Ki·∫e dt', mode: 'lines', line: { color: C.third, width: 2.2 }, hovertemplate: '%{y:.4g}' },
        { x: tt, y: s.dTerm, name: 'D part: −Kd·dy/dt', mode: 'lines', line: { color: C.mark, width: 2.2 }, hovertemplate: '%{y:.4g}' }
      ], UI.layout({
        margin: { l: 62, r: 16, t: 40, b: 46 },
        xaxis: UI.axis('Time t (s)', { range: [0, tMax] }),
        yaxis: UI.axis('Contribution to u', { range: pr }),
        uirevision: o.keepZoom ? 'keep' : String(Math.round(tMax * 1000))
      }));
    }
    return a;
  };

  /* ------------------------------------------------------------ */
  /* Code box                                                       */
  /* ------------------------------------------------------------ */

  CUI.codeBox = function (container, o) {
    const box = el('div', { class: 'codebox' });
    box.innerHTML = '<div class="codebox-head"><h3>' + (o.title || 'Arduino code') + '</h3>' +
      '<div class="btn-row"><button type="button" class="btn secondary" data-act="copy">Copy code</button>' +
      '<button type="button" class="btn ghost" data-act="dl">Download .ino</button></div></div>' +
      '<pre tabindex="0" aria-label="Generated Arduino code"><code></code></pre><div class="copy-msg" role="status" aria-live="polite"></div>';
    container.appendChild(box);
    const code = box.querySelector('code'), msg = box.querySelector('.copy-msg');
    let text = '';
    function say(t) { msg.textContent = t; clearTimeout(say.t); say.t = setTimeout(function () { msg.textContent = ''; }, 3000); }
    box.querySelector('[data-act="copy"]').addEventListener('click', function () {
      function fallback() {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        say(ok ? 'Copied to the clipboard.' : 'Copy failed. Select the code and press Ctrl+C.');
      }
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { say('Copied to the clipboard.'); }, fallback);
      } else fallback();
    });
    box.querySelector('[data-act="dl"]').addEventListener('click', function () {
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = (o.filename || 'pid_controller') + '.ino';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    return { set: function (t) { text = t; code.textContent = t; }, get: function () { return text; } };
  };

  /**
   * "Predict, then check" box (Homework 1 helper) with the answer options in random
   * order, so the right answer is not always in the same place. "Same / unchanged"
   * options stay last because that reads naturally.
   */
  CUI.predict = function (container, questions) {
    questions.forEach(function (q) {
      if (q.kind !== 'choice') return;
      const keep = q.choices.filter(function (c) { return c.value === 'same' || c.value === 'eq'; });
      const move = q.choices.filter(function (c) { return keep.indexOf(c) < 0; });
      for (let i = move.length - 1; i > 0; i--) {         // Fisher-Yates shuffle
        const j = Math.floor(Math.random() * (i + 1));
        const t = move[i]; move[i] = move[j]; move[j] = t;
      }
      q.choices = move.concat(keep);
    });
    return UI.predictBox(container, questions);
  };

  /** Compact table of the three validation checks and the pass/fail summary (used on the control hub). */
  CUI.validationSummary = function (target) {
    const res = root.ControlValidation.runAll();
    const n = res.filter(function (r) { return r.pass; }).length;
    UI.set(target, '<span class="big">' + n + ' / ' + res.length + '</span>' +
      (n === res.length ? '<span class="status status-pass"><span aria-hidden="true">✓</span> All checks pass</span>'
        : '<span class="status status-fail"><span aria-hidden="true">✗</span> ' + (res.length - n) + ' check(s) fail</span>'));
  };

  document.addEventListener('DOMContentLoaded', function () {
    const h = document.getElementById('site-header');
    if (h) CUI.mountHeader(h.getAttribute('data-active'));
  });

  root.CUI = CUI;
})(typeof self !== 'undefined' ? self : this);
