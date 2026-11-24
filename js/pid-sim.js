/*
 * pid-sim.js
 * Closed-loop PID simulation engine for Homework 2 (the "Control" section).
 *
 * What it does
 *   - Steps a feedback loop forward in time with RK4 (4th-order Runge-Kutta).
 *     No closed-form response is used anywhere in the loop simulation.
 *   - Plants:   first order  tau*y' + y = K*u            (Homework 1, Module 1)
 *               second order y'' + 2*zeta*wn*y' + wn^2*y = K*wn^2*u   (Module 3)
 *   - Optional first-order SENSOR in the feedback path (P2) and an optional
 *     first-order ACTUATOR lag (only used by the Ziegler-Nichols bonus page).
 *   - Controller: continuous PID (P1, P2, P4, bonus) or DIGITAL PID (P3) that
 *     runs only at the sampling instants and holds u between them.
 *   - Actuator saturation [umin, umax] and conditional-integration anti-windup.
 *   - Performance metrics read off the simulated curve.
 *   - Arduino code generator for the digital controller.
 *   - Helpers for the tuning challenge, the project motor and Ziegler-Nichols.
 *
 * Works in the browser (window.PIDSim) and in Node (module.exports), so the same
 * code is unit-tested with `npm test`.
 *
 * ---------------------------------------------------------------------------
 * Definitions used everywhere (same as Homework 1 stepMetrics)
 *   y_ss        mean of the true output over the last 10% of the simulation
 *   rise time   10% -> 90% of y_ss (0%->100% selectable)
 *   overshoot   100*(y_peak - y_ss)/y_ss, never negative
 *   settling    last time |y - y_ss| > 2% of y_ss (band selectable)
 *   e_ss        r - y_ss  (also given as % of r)
 *   If the output has not settled (it still oscillates or is still moving) the
 *   page says so instead of printing numbers that would be misleading; in that
 *   case the overshoot is measured against the setpoint r.
 * ---------------------------------------------------------------------------
 * Continuous PID used by the simulator
 *   u = Kp*e + Ki*Int(e) + D,    e = r - y_measured
 *   D = -Kd * d(y_measured)/dt   (derivative ON THE MEASUREMENT, first-order
 *   filtered). For a constant setpoint this equals Kd*de/dt, but a setpoint
 *   step does not create an infinite spike ("derivative kick").
 * Digital PID (P3) uses the assignment formula exactly, derivative on the error:
 *   u[k] = Kp e[k] + Ki Ts sum_{j<=k} e[j] + Kd (e[k]-e[k-1])/Ts,  e[-1] = 0
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const M = isNode ? require('./dyn-math.js') : root.DynMath;
  const lib = factory(M);
  if (isNode) module.exports = lib; else root.PIDSim = lib;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const TWO_PI = 2 * Math.PI;
  const MAX_STEPS = 400000;       // hard cap on integration steps per simulation
  const DIVERGE_LIMIT = 1e8;      // |y| beyond this (relative to the setpoint) = diverged

  /* ------------------------------------------------------------------ */
  /* Configuration                                                       */
  /* ------------------------------------------------------------------ */

  function num(v, dflt) { return (typeof v === 'number' && isFinite(v)) ? v : dflt; }
  function lim(v, dflt) { return (typeof v === 'number' && !isNaN(v)) ? v : dflt; }   // allows +/-Infinity

  /**
   * Turn a user configuration into a flat, safe object (clamps bad values and
   * records a warning for each one so the page can tell the user).
   *
   * cfg = {
   *   plant: {type:'first', K, tau} | {type:'second', K, zeta, wn},
   *   gains: {Kp, Ki, Kd},   r (setpoint step size),
   *   umin, umax (control limits, default +/-Infinity), antiWindup (default true),
   *   sensorTau (0 = ideal sensor), actuatorTau (0 = ideal actuator),
   *   mode: 'continuous' | 'digital', Ts (digital sampling time), dFilter (D filter time constant)
   * }
   */
  function normalize(cfg) {
    const w = [];
    const p = cfg.plant || {};
    const g = cfg.gains || {};
    const c = { warnings: w };
    c.first = p.type !== 'second';
    c.K = num(p.K, 1);
    if (c.first) {
      c.tau = num(p.tau, 1);
      if (!(c.tau >= 1e-4)) { w.push('Time constant tau was too small or invalid; using 0.0001 s.'); c.tau = 1e-4; }
    } else {
      c.zeta = num(p.zeta, 0.5);
      c.wn = num(p.wn, 1);
      if (c.zeta < 0) { w.push('Damping ratio must not be negative; using 0.'); c.zeta = 0; }
      if (!(c.wn >= 1e-3)) { w.push('Natural frequency was too small or invalid; using 0.001 rad/s.'); c.wn = 1e-3; }
    }
    c.Kp = num(g.Kp, 0); c.Ki = num(g.Ki, 0); c.Kd = num(g.Kd, 0);
    c.r = num(cfg.r, 1);
    c.umin = lim(cfg.umin, -Infinity); c.umax = lim(cfg.umax, Infinity);
    if (c.umin > c.umax) { w.push('Lower control limit was above the upper limit; swapped.'); const t = c.umin; c.umin = c.umax; c.umax = t; }
    c.aw = cfg.antiWindup !== false;
    c.tauS = Math.max(0, num(cfg.sensorTau, 0));
    if (c.tauS < 1e-6) c.tauS = 0;
    c.tauA = Math.max(0, num(cfg.actuatorTau, 0));
    if (c.tauA < 1e-6) c.tauA = 0;
    c.openU = cfg.openLoop ? num(cfg.uOpen, 1) : null;     // open-loop test: constant u, controller bypassed
    c.digital = cfg.mode === 'digital';
    c.Ts = num(cfg.Ts, 0.05);
    if (c.digital && !(c.Ts >= 1e-4)) { w.push('Sampling time was too small or invalid; using 0.0001 s.'); c.Ts = 1e-4; }
    const tFast = Math.min(c.first ? c.tau : 1 / c.wn, c.tauS > 0 ? c.tauS : Infinity, c.tauA > 0 ? c.tauA : Infinity);
    c.Tf = num(cfg.dFilter, 0) > 0 ? cfg.dFilter : 0.05 * tFast;     // derivative filter time constant
    return c;
  }

  /** Fastest rate (1/s) of the plant alone. */
  function fastRate(c) {
    if (c.first) return 1 / c.tau;
    return c.zeta > 1 ? c.wn * (c.zeta + Math.sqrt(c.zeta * c.zeta - 1)) : c.wn;
  }

  /** Slowest plant/sensor/actuator time scale: used to choose the simulation length. */
  function timeScale(c) {
    let s;
    if (c.first) s = c.tau;
    else if (c.zeta < 1) s = 1 / (Math.max(c.zeta, 0.05) * c.wn);
    else s = 1 / (c.wn * (c.zeta - Math.sqrt(c.zeta * c.zeta - 1)));
    return Math.max(s, c.tauS, c.tauA);
  }

  /** Rate (1/s) that limits the RK4 step: stiffest part of the closed loop (estimate, deliberately generous). */
  function loopRate(c) {
    const fr = fastRate(c);
    const aK = Math.abs(c.K);
    let lam;
    if (c.digital) {
      lam = fr;
    } else if (c.first) {
      lam = fr * (1 + aK * Math.abs(c.Kp));
      lam = Math.max(lam, Math.sqrt(aK * Math.abs(c.Ki) * fr));
      if (c.Kd !== 0) lam = Math.max(lam, (1 + aK * Math.abs(c.Kd) * fr) / c.Tf);
    } else {
      lam = fr + c.wn * Math.sqrt(aK * Math.abs(c.Kp)) + aK * Math.abs(c.Kd) * c.wn * c.wn;
      lam = Math.max(lam, Math.sqrt(aK * Math.abs(c.Ki) * fr));
      if (c.Kd !== 0) lam = Math.max(lam, (1 + aK * Math.abs(c.Kd) * fr) / c.Tf);
    }
    if (c.tauS > 0) lam = Math.max(lam, 1 / c.tauS);
    if (c.tauA > 0) lam = Math.max(lam, 1 / c.tauA);
    return lam;
  }

  /* ------------------------------------------------------------------ */
  /* The simulator                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Simulate the closed loop from rest for T seconds with a setpoint step of
   * size r applied at t = 0.
   *
   * State vector x:  0 y (true output) | 1 v = dy/dt (second order only) |
   *                  2 ym (sensor output) | 3 I (integral of error) |
   *                  4 xf (derivative-filter state) | 5 xa (actuator lag)
   *
   * Returns {t, y, ym, u, uRaw, e, r, diverged, h, steps, warnings,
   *          stair, samples}. `stair` and `samples` exist only in digital mode.
   *   u     : control signal actually applied (after saturation)
   *   uRaw  : controller output before saturation
   */
  function simulate(cfg, T, options) {
    const o = options || {};
    const c = normalize(cfg);
    if (!(T > 0) || !isFinite(T)) throw new Error('Simulation time must be a positive number.');
    const maxPoints = o.maxPoints || 6000;
    const K = c.K, r = c.r;
    const hasS = c.tauS > 0, hasA = c.tauA > 0;
    const wn2 = c.first ? 0 : c.wn * c.wn;
    const zw2 = c.first ? 0 : 2 * c.zeta * c.wn;

    // ----- choose the integration step h (independent of the sampling time) -----
    const lam = loopRate(c);
    // RK4 is accurate (local error ~ (h*lam)^5/120) and stable for h*lam < 2.7; 0.25 keeps a wide margin.
    let h = Math.min(0.25 / lam, T / 2000);
    let nSub = 1;                         // integration sub-steps per controller sample (digital)
    if (c.digital) {
      h = Math.min(h, c.Ts);
      nSub = Math.max(1, Math.ceil(c.Ts / h - 1e-9));
      h = c.Ts / nSub;
    }
    let totalSteps = c.digital ? Math.ceil(T / c.Ts - 1e-9) * nSub : Math.ceil(T / h);
    if (totalSteps > MAX_STEPS) {
      c.warnings.push('The simulation was very stiff; the integration step was enlarged, so accuracy is reduced.');
      if (c.digital) { nSub = Math.max(1, Math.floor(MAX_STEPS / Math.ceil(T / c.Ts))); h = c.Ts / nSub; totalSteps = Math.ceil(T / c.Ts) * nSub; }
      else { h = T / MAX_STEPS; totalSteps = MAX_STEPS; }
    }
    const stride = Math.max(1, Math.ceil(totalSteps / maxPoints));

    // ----- state and derivative buffers -----
    const x = new Float64Array(6), k1 = new Float64Array(6), k2 = new Float64Array(6),
      k3 = new Float64Array(6), k4 = new Float64Array(6), tmp = new Float64Array(6);
    let uHeld = 0;                         // digital: the held control value

    /** Controller output at state s (continuous mode). Writes ctl.uRaw, ctl.u, ctl.e. */
    const ctl = { uRaw: 0, u: 0, e: 0, p: 0, i: 0, d: 0 };
    function controller(s) {
      const ym = hasS ? s[2] : s[0];
      const e = r - ym;
      if (c.openU !== null) { ctl.e = e; ctl.p = ctl.i = ctl.d = 0; ctl.uRaw = ctl.u = c.openU; return; }
      const D = c.Kd !== 0 ? -c.Kd * (ym - s[4]) / c.Tf : 0;
      const uRaw = c.Kp * e + c.Ki * s[3] + D;
      ctl.e = e; ctl.uRaw = uRaw; ctl.p = c.Kp * e; ctl.i = c.Ki * s[3]; ctl.d = D;
      ctl.u = uRaw > c.umax ? c.umax : (uRaw < c.umin ? c.umin : uRaw);
    }

    /** dx = f(x): plant + sensor + (continuous) controller dynamics. */
    function f(s, dx) {
      let u;
      if (c.digital) {
        u = uHeld; dx[3] = 0; dx[4] = 0;
      } else {
        controller(s);
        u = ctl.u;
        const pushing = (ctl.uRaw > c.umax && ctl.e > 0) || (ctl.uRaw < c.umin && ctl.e < 0);
        dx[3] = (c.aw && pushing) ? 0 : ctl.e;           // conditional integration (anti-windup)
        const ym = hasS ? s[2] : s[0];
        dx[4] = c.Kd !== 0 ? (ym - s[4]) / c.Tf : 0;
      }
      const up = hasA ? s[5] : u;                         // what the plant actually receives
      dx[5] = hasA ? (u - s[5]) / c.tauA : 0;
      if (c.first) { dx[0] = (-s[0] + K * up) / c.tau; dx[1] = 0; }
      else { dx[0] = s[1]; dx[1] = wn2 * (K * up - s[0]) - zw2 * s[1]; }
      dx[2] = hasS ? (s[0] - s[2]) / c.tauS : 0;
    }

    function rk4(hh) {
      f(x, k1);
      for (let i = 0; i < 6; i++) tmp[i] = x[i] + 0.5 * hh * k1[i];
      f(tmp, k2);
      for (let i = 0; i < 6; i++) tmp[i] = x[i] + 0.5 * hh * k2[i];
      f(tmp, k3);
      for (let i = 0; i < 6; i++) tmp[i] = x[i] + hh * k3[i];
      f(tmp, k4);
      for (let i = 0; i < 6; i++) x[i] += hh / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }

    const out = { t: [], y: [], ym: [], u: [], uRaw: [], e: [], pTerm: [], iTerm: [], dTerm: [], r: r, diverged: false, h: h, steps: 0,
      warnings: c.warnings, stair: null, samples: null, cfg: c };
    const limitY = DIVERGE_LIMIT * Math.max(1, Math.abs(r));

    // last digital controller update: the P, I and D parts of uRaw
    let lastRaw = 0, lastP = 0, lastI = 0, lastD = 0;
    function record(t) {
      const ym = hasS ? x[2] : x[0];
      out.t.push(t); out.y.push(x[0]); out.ym.push(ym);
      if (c.digital) {
        out.u.push(uHeld); out.uRaw.push(lastRaw); out.e.push(r - ym);
        out.pTerm.push(lastP); out.iTerm.push(lastI); out.dTerm.push(lastD);
      } else {
        controller(x);
        out.u.push(ctl.u); out.uRaw.push(ctl.uRaw); out.e.push(ctl.e);
        out.pTerm.push(ctl.p); out.iTerm.push(ctl.i); out.dTerm.push(ctl.d);
      }
    }
    function bad() { return !isFinite(x[0]) || !isFinite(x[2]) || Math.abs(x[0]) > limitY; }

    if (!c.digital) {
      record(0);
      const n = totalSteps;
      for (let i = 1; i <= n; i++) {
        rk4(h);
        if (bad()) { out.diverged = true; break; }
        if (i % stride === 0 || i === n) record(i === n ? T : i * h);
      }
      out.steps = Math.min(totalSteps, out.t.length * stride);
    } else {
      const Ts = c.Ts;
      const N = Math.ceil(T / Ts - 1e-9);
      let sum = 0, prevE = 0;
      out.stair = { t: [], u: [] };
      out.samples = { t: [], ym: [], e: [], uRaw: [], u: [], pTerm: [], iTerm: [], dTerm: [] };
      let step = 0;
      uHeld = 0; lastRaw = 0;
      record(0);
      let stopped = false;
      for (let k = 0; k < N && !stopped; k++) {
        const tk = k * Ts;
        // ---- controller update (this is what the Arduino loop() does once per Ts) ----
        const ym = hasS ? x[2] : x[0];
        const e = r - ym;
        let pT = c.Kp * e, iT = c.Ki * Ts * (sum + e), dT = c.Kd * (e - prevE) / Ts;
        let uRaw = pT + iT + dT;
        let u = uRaw > c.umax ? c.umax : (uRaw < c.umin ? c.umin : uRaw);
        if (c.openU !== null) { pT = iT = dT = 0; uRaw = u = c.openU; }
        const pushing = (uRaw > c.umax && e > 0) || (uRaw < c.umin && e < 0);
        if (!(c.aw && pushing)) sum += e;
        prevE = e;
        uHeld = u; lastRaw = uRaw; lastP = pT; lastI = iT; lastD = dT;
        out.samples.t.push(tk); out.samples.ym.push(ym); out.samples.e.push(e);
        out.samples.uRaw.push(uRaw); out.samples.u.push(u);
        out.samples.pTerm.push(pT); out.samples.iTerm.push(iT); out.samples.dTerm.push(dT);
        out.stair.t.push(tk, tk + Ts); out.stair.u.push(u, u);
        // ---- plant runs with u held constant for one sampling period ----
        for (let j = 1; j <= nSub; j++) {
          rk4(h);
          step++;
          if (bad()) { out.diverged = true; stopped = true; break; }
          if (step % stride === 0 || (k === N - 1 && j === nSub)) record(Math.min(T, tk + j * h));
        }
      }
      out.steps = step;
      // the final sample may overshoot T slightly; keep the time axis honest
      if (out.t.length && out.t[out.t.length - 1] > T) out.t[out.t.length - 1] = T;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Metrics                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Performance metrics from a simulated output y(t) for a setpoint step r.
   * status: 'settled' | 'oscillating' | 'growing' | 'slow' | 'diverged' | 'no-response'
   */
  function closedLoopMetrics(t, y, r, options) {
    const o = options || {};
    const band = o.band || 0.02;
    const riseDef = o.riseDef || '10-90';
    const n = t.length;
    const res = { status: 'settled', settled: false, ySS: null, essAbs: null, essPct: null,
      riseTime: null, overshootPct: 0, settlingTime: null, peakValue: null, peakTime: null, band: band, riseDef: riseDef };
    for (let i = 0; i < n; i++) {
      if (!isFinite(y[i])) { res.status = 'diverged'; return res; }
    }
    if (o.diverged) { res.status = 'diverged'; return res; }
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(n * 0.9)));
    let sum = 0, lo = Infinity, hi = -Infinity, cnt = 0;
    for (let i = i0; i < n; i++) { sum += y[i]; lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); cnt++; }
    const ySS = sum / cnt;
    const spread = hi - lo;
    const scale = Math.max(Math.abs(r), 1e-12);
    res.ySS = ySS;
    if (Math.abs(ySS) < 1e-3 * scale && spread < 1e-3 * scale) {
      res.status = 'no-response'; res.essAbs = r; res.essPct = 100; return res;
    }
    const tailSteady = spread <= band * Math.abs(ySS) * 0.5 + 1e-12;
    const yRef = tailSteady ? ySS : r;
    const m = M.stepMetrics(t, y, yRef, { band: band, riseDef: riseDef });
    res.riseTime = m.riseTime;
    res.overshootPct = Math.max(0, m.overshootPct);
    res.peakValue = m.maxValue; res.peakTime = m.peakTime;
    if (tailSteady && m.settled) {
      res.settled = true; res.settlingTime = m.settlingTime;
      res.essAbs = r - ySS; res.essPct = 100 * (r - ySS) / scale * Math.sign(r || 1);
      return res;
    }
    // not settled: tell oscillation from growth from slow drift
    const mean = ySS;
    let cross = 0;
    for (let i = Math.max(i0, 1); i < n; i++) if ((y[i - 1] - mean) * (y[i] - mean) < 0) cross++;
    function amp(a, b) {
      let mx = 0; const s = Math.floor(n * a), e = Math.max(s + 1, Math.floor(n * b));
      let mean2 = 0; for (let i = s; i < e; i++) mean2 += y[i]; mean2 /= (e - s);
      for (let i = s; i < e; i++) mx = Math.max(mx, Math.abs(y[i] - mean2));
      return mx;
    }
    const aLast = amp(0.75, 1), aPrev = amp(0.5, 0.75);
    if (cross >= 3 && aLast > 0.02 * scale) res.status = aLast > 1.15 * aPrev ? 'growing' : 'oscillating';
    else res.status = 'slow';
    res.riseTime = (res.status === 'slow') ? res.riseTime : res.riseTime;
    res.settlingTime = null;
    return res;
  }

  /** Cut a simulation to t <= tMax (keeps arrays aligned). */
  function crop(sim, tMax) {
    let n = sim.t.length;
    for (let i = 0; i < sim.t.length; i++) if (sim.t[i] > tMax) { n = i + 1; break; }
    const out = Object.assign({}, sim);
    ['t', 'y', 'ym', 'u', 'uRaw', 'e', 'pTerm', 'iTerm', 'dTerm'].forEach(function (k) { out[k] = sim[k].slice(0, n); });
    if (sim.stair) {
      let m = sim.stair.t.length;
      for (let i = 0; i < sim.stair.t.length; i++) if (sim.stair.t[i] > tMax) { m = i + 1; break; }
      out.stair = { t: sim.stair.t.slice(0, m), u: sim.stair.u.slice(0, m) };
      if (out.stair.t.length) out.stair.t[out.stair.t.length - 1] = Math.min(out.stair.t[out.stair.t.length - 1], tMax);
    }
    if (sim.samples) {
      let m = sim.samples.t.length;
      for (let i = 0; i < sim.samples.t.length; i++) if (sim.samples.t[i] > tMax) { m = i; break; }
      out.samples = {};
      Object.keys(sim.samples).forEach(function (k) { out.samples[k] = sim.samples[k].slice(0, m); });
    }
    return out;
  }

  /**
   * Simulate with an automatically chosen time window, then measure.
   * Starts at 15 time scales and doubles (up to 3 times) until the response has
   * settled. For display, the window is cropped to a sensible length and the
   * curve is re-simulated densely so the metrics read off the plot are accurate.
   * options: {T (manual window), band, riseDef}
   * Returns {sim, metrics, T, tPlot, auto, scale}
   */
  function analyze(cfg, options) {
    const o = options || {};
    const c = normalize(cfg);
    const scale = timeScale(c);
    const mo = { band: o.band, riseDef: o.riseDef };
    const manual = o.T > 0;
    const minPlot = o.minPlot || 0;          // optional: make sure the plotted window is at least this long
    let T = manual ? o.T : Math.max(15 * scale, c.digital ? 40 * c.Ts : 0, 1.6 * minPlot);
    let sim = null, m = null;
    const tries = manual ? 0 : 3;
    for (let i = 0; i <= tries; i++) {
      sim = simulate(cfg, T);
      mo.diverged = sim.diverged;
      m = closedLoopMetrics(sim.t, sim.y, sim.r, mo);
      if (sim.diverged || m.status === 'no-response') break;
      if (m.status === 'settled' && m.settlingTime <= 0.5 * T) break;
      if (i < tries) T *= 2;
    }
    let tPlot = T, display = sim;
    if (!manual && !sim.diverged) {
      if (m.status === 'settled') tPlot = Math.min(T, Math.max(2.5 * m.settlingTime, 0.8 * scale, c.digital ? 12 * c.Ts : 0, minPlot));
      else if (m.status === 'oscillating' || m.status === 'growing') tPlot = Math.min(T, Math.max(20 * scale, minPlot));
      if (tPlot < 0.6 * T) {
        const fine = simulate(cfg, tPlot, { maxPoints: 6000 });
        display = fine;
        if (m.status === 'settled') {
          // rise/overshoot/settling from the dense curve; steady value from the long run
          const m2 = M.stepMetrics(fine.t, fine.y, m.ySS, { band: m.band, riseDef: m.riseDef });
          m.riseTime = m2.riseTime; m.overshootPct = Math.max(0, m2.overshootPct);
          m.peakValue = m2.maxValue; m.peakTime = m2.peakTime;
          if (m2.settled) m.settlingTime = m2.settlingTime;
        }
      }
    }
    m.umax = Math.max.apply(null, display.u); m.umin = Math.min.apply(null, display.u);
    m.saturated = display.u.some(function (v, i) { return display.uRaw[i] !== v; });
    return { sim: display, metrics: m, T: T, tPlot: tPlot, auto: !manual, scale: scale };
  }

  /** Quick screening run used for parameter sweeps (fixed window, no re-simulation). */
  function quickMetrics(cfg, T, options) {
    const sim = simulate(cfg, T, { maxPoints: 2500 });
    const m = closedLoopMetrics(sim.t, sim.y, sim.r, Object.assign({ diverged: sim.diverged }, options || {}));
    return { sim: sim, metrics: m };
  }

  /* ------------------------------------------------------------------ */
  /* Theory helpers (used for explanations and for the validation page)  */
  /* ------------------------------------------------------------------ */

  /**
   * First-order plant K/(tau s+1) with an ideal PID (D acting on the measurement):
   *   (tau + K Kd) s^2 + (1 + K Kp) s + K Ki = 0
   * P only (Ki = Kd = 0):  closed-loop time constant tau/(1+K Kp), steady-state error 1/(1+K Kp).
   */
  function firstOrderLoopTheory(K, tau, Kp, Ki, Kd) {
    const a2 = tau + K * (Kd || 0), a1 = 1 + K * Kp, a0 = K * (Ki || 0);
    const out = { a2: a2, a1: a1, a0: a0, tauCL: null, essFrac: null, wn: null, zeta: null, poles: null };
    if (!(Ki > 0) && !(Kd > 0)) { out.tauCL = tau / (1 + K * Kp); out.essFrac = 1 / (1 + K * Kp); }
    if (a0 > 0 && a2 > 0) {
      out.wn = Math.sqrt(a0 / a2);
      out.zeta = a1 / (2 * Math.sqrt(a2 * a0));
      out.poles = M.quadraticRoots(a2, a1, a0);
    }
    return out;
  }

  /** PI design for a first-order plant from a target zeta and wn: Kp = (2 zeta tau wn - 1)/K, Ki = tau wn^2/K. */
  function designPI(K, tau, zeta, wn) {
    return { Kp: (2 * zeta * tau * wn - 1) / K, Ki: tau * wn * wn / K };
  }

  /** Estimate wn from a target 2% settling time: ts ~ 4/(zeta wn). */
  function wnFromSettling(ts, zeta) { return 4 / (zeta * ts); }

  /* ------------------------------------------------------------------ */
  /* Identification of K and tau from a step test (My System page)        */
  /* ------------------------------------------------------------------ */

  /**
   * Estimate a first-order model from a logged step test.
   *   t, y   : time (s) and measured output (e.g. encoder speed)
   *   uStep  : size of the input step (e.g. PWM percentage points)
   *   tStep  : time at which the step was applied (default: t[0])
   * K   = (final value - initial value) / uStep
   * tau = time to reach 63.2% of the total change (also a log-fit estimate
   *       from ln(1 - y/y_final), whose slope is -1/tau).
   */
  function identifyFirstOrder(t, y, uStep, tStep) {
    const n = t.length;
    if (n < 8) throw new Error('Need at least 8 samples.');
    if (!(uStep > 0)) throw new Error('The input step must be a positive number.');
    const ts = (tStep === undefined || tStep === null || !isFinite(tStep)) ? t[0] : tStep;
    // initial value: mean of samples before the step (or the first sample)
    let y0 = y[0], c0 = 0, s0 = 0;
    for (let i = 0; i < n; i++) if (t[i] < ts) { s0 += y[i]; c0++; }
    if (c0 >= 1) y0 = s0 / c0;
    // final value: mean of the last 10% of samples
    const i1 = Math.floor(n * 0.9);
    let sf = 0; for (let i = i1; i < n; i++) sf += y[i];
    const yf = sf / (n - i1);
    const dy = yf - y0;
    if (!(Math.abs(dy) > 0)) throw new Error('The output did not change during the test.');
    const tt = [], yy = [];
    for (let i = 0; i < n; i++) if (t[i] >= ts) { tt.push(t[i] - ts); yy.push((y[i] - y0) / dy); }
    const t63 = M.crossingTime(tt, yy, 0.632);
    // log fit on 10%..90% of the change
    const lx = [], ly = [];
    for (let i = 0; i < tt.length; i++) if (yy[i] > 0.1 && yy[i] < 0.9) { lx.push(tt[i]); ly.push(Math.log(1 - yy[i])); }
    let tauFit = null, r2 = null;
    if (lx.length >= 4) { const f = M.linearFit(lx, ly); if (f.slope < 0) { tauFit = -1 / f.slope; r2 = f.r2; } }
    return { K: dy / uStep, tau63: t63, tauFit: tauFit, r2: r2, y0: y0, yFinal: yf, dy: dy };
  }

  /* ------------------------------------------------------------------ */
  /* Digital PID: Arduino code generator                                 */
  /* ------------------------------------------------------------------ */

  function cnum(v) {
    if (!isFinite(v)) return '0.0f';
    let s = String(Number(v.toPrecision(7)));
    if (/e/i.test(s)) s = v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0');
    if (s.indexOf('.') < 0) s += '.0';
    return s + 'f';
  }

  /**
   * Arduino sketch for the digital PID that P3 simulates.
   * opts: {Kp, Ki, Kd, Ts, umin, umax, antiWindup, setpoint, header (array of comment lines),
   *        measurementName, actuatorName, sensorPin, actuatorPin, outputUnit}
   * The controller itself is `pidStep()`; it is the same arithmetic as
   * simulate() in digital mode, and the unit tests run this text against it.
   */
  function arduinoCode(opts) {
    const o = Object.assign({ antiWindup: true, setpoint: 1, sensorPin: 'A0', actuatorPin: '9', header: [], outputUnit: 'u' }, opts);
    const tsUs = Math.max(1, Math.round(o.Ts * 1e6));
    const L = [];
    L.push('// PID speed/position loop, generated by the ENCS4380 PID toolkit (Homework 2).');
    o.header.forEach(function (h) { L.push('// ' + h); });
    L.push('//');
    L.push('// Control law, run once every Ts (same equation as the simulation on the page):');
    L.push('//   u[k] = Kp*e[k] + Ki*Ts*sum(e[0..k]) + Kd*(e[k] - e[k-1])/Ts');
    L.push('');
    L.push('// ---- Controller settings (from the page) ----');
    const decl = function (code, comment) { return code + new Array(Math.max(2, 44 - code.length)).join(' ') + (comment ? '// ' + comment : ''); };
    L.push(decl('const float Kp = ' + cnum(o.Kp) + ';', 'proportional gain'));
    L.push(decl('const float Ki = ' + cnum(o.Ki) + ';', 'integral gain'));
    L.push(decl('const float Kd = ' + cnum(o.Kd) + ';', 'derivative gain'));
    L.push(decl('const float Ts = ' + cnum(o.Ts) + ';', 'sampling time in seconds'));
    L.push(decl('const unsigned long TS_US = ' + tsUs + 'UL;', 'the same Ts in microseconds'));
    L.push(decl('const float U_MIN = ' + cnum(o.umin) + ';', 'lowest allowed control value (' + o.outputUnit + ')'));
    L.push(decl('const float U_MAX = ' + cnum(o.umax) + ';', 'highest allowed control value (' + o.outputUnit + ')'));
    L.push(decl('const bool ANTI_WINDUP = ' + (o.antiWindup ? 'true' : 'false') + ';', 'stop integrating while saturated'));
    L.push(decl('float setpoint = ' + cnum(o.setpoint) + ';', 'target for the measurement'));
    L.push('');
    L.push('// ---- Hardware: adapt these three lines and two functions to your robot ----');
    L.push(decl('const int SENSOR_PIN = ' + o.sensorPin + ';', 'measurement input'));
    L.push(decl('const int ACTUATOR_PIN = ' + o.actuatorPin + ';', 'PWM output'));
    L.push(decl('const float SENSOR_SCALE = 1.0f;', 'measurement units per ADC count'));
    L.push('');
    L.push('// ---- Controller state ----');
    L.push(decl('float sumError = 0.0f;', 'running sum of e[j]'));
    L.push(decl('float prevError = 0.0f;', 'e[k-1], starts at 0'));
    L.push('unsigned long nextTick;');
    L.push('');
    (o.readComment || []).forEach(function (t) { L.push('// ' + t); });
    L.push('float readMeasurement() {');
    L.push('  return analogRead(SENSOR_PIN) * SENSOR_SCALE;');
    L.push('}');
    L.push('');
    (o.writeComment || []).forEach(function (t) { L.push('// ' + t); });
    L.push('void writeActuator(float u) {');
    L.push('  // map U_MIN..U_MAX onto the 8-bit PWM range 0..255');
    L.push('  int duty = (int)((u - U_MIN) * 255.0f / (U_MAX - U_MIN) + 0.5f);');
    L.push('  analogWrite(ACTUATOR_PIN, constrain(duty, 0, 255));');
    L.push('}');
    L.push('');
    L.push('// One controller update. Call it exactly once per sampling period.');
    L.push('float pidStep(float measurement) {');
    L.push('  float error = setpoint - measurement;');
    L.push('  float uRaw = Kp * error + Ki * Ts * (sumError + error) + Kd * (error - prevError) / Ts;');
    L.push('  float u = constrain(uRaw, U_MIN, U_MAX);');
    L.push('  bool pushing = (uRaw > U_MAX && error > 0.0f) || (uRaw < U_MIN && error < 0.0f);');
    L.push('  if (!(ANTI_WINDUP && pushing)) sumError += error;');
    L.push('  prevError = error;');
    L.push('  return u;');
    L.push('}');
    L.push('');
    L.push('void setup() {');
    L.push('  pinMode(ACTUATOR_PIN, OUTPUT);');
    L.push('  nextTick = micros() + TS_US;');
    L.push('}');
    L.push('');
    L.push('void loop() {');
    L.push('  if ((long)(micros() - nextTick) < 0) return;   // wait for the next sampling instant');
    L.push('  nextTick += TS_US;');
    L.push('  float u = pidStep(readMeasurement());');
    L.push('  writeActuator(u);                               // u is held until the next sample');
    L.push('}');
    return L.join('\n') + '\n';
  }

  /* ------------------------------------------------------------------ */
  /* Ziegler-Nichols (bonus)                                             */
  /* ------------------------------------------------------------------ */

  /** Open-loop (plant x sensor x actuator) magnitude and phase at angular frequency w, K excluded sign. */
  function openLoopGain(c, w) {
    let mag, ph;
    if (c.first) {
      mag = 1 / Math.sqrt(1 + w * w * c.tau * c.tau);
      ph = -Math.atan(w * c.tau);
    } else {
      const a = c.wn * c.wn - w * w, b = 2 * c.zeta * c.wn * w;
      mag = c.wn * c.wn / Math.hypot(a, b);
      ph = -Math.atan2(b, a);
    }
    if (c.tauS > 0) { mag /= Math.sqrt(1 + w * w * c.tauS * c.tauS); ph -= Math.atan(w * c.tauS); }
    if (c.tauA > 0) { mag /= Math.sqrt(1 + w * w * c.tauA * c.tauA); ph -= Math.atan(w * c.tauA); }
    return { mag: Math.abs(c.K) * mag, phase: ph };
  }

  /**
   * Ultimate gain from the frequency response: at the frequency wu where the
   * open-loop phase is -180 degrees, Ku = 1/|G(j wu)|. Returns null when the
   * phase never reaches -180 degrees (first/second order alone: P control
   * never produces sustained oscillation).
   */
  function ultimateFromFrequency(cfg) {
    const c = normalize(Object.assign({}, cfg, { gains: { Kp: 0, Ki: 0, Kd: 0 } }));
    if (!(c.K > 0)) return null;
    let lo = 1e-6, hi = 1e6 * fastRate(c);
    if (openLoopGain(c, hi).phase > -Math.PI - 1e-6) return null;
    for (let i = 0; i < 200; i++) {
      const mid = Math.sqrt(lo * hi);
      if (openLoopGain(c, mid).phase > -Math.PI) lo = mid; else hi = mid;
    }
    const wu = Math.sqrt(lo * hi);
    return { Ku: 1 / openLoopGain(c, wu).mag, wu: wu, Pu: TWO_PI / wu };
  }

  /** Peaks (local maxima) of d(t): returns {t, v}. */
  function localMaxima(t, d) {
    const pt = [], pv = [];
    for (let i = 1; i < d.length - 1; i++) if (d[i] > d[i - 1] && d[i] >= d[i + 1] && d[i] > 0) { pt.push(t[i]); pv.push(d[i]); }
    return { t: pt, v: pv };
  }

  /**
   * Does the proportional-only loop with gain Kp oscillate with growing,
   * constant, or decaying amplitude? Pure time-domain test on the RK4 simulation
   * (linear loop: no saturation). Returns {growth: ratio of last to first peak,
   * period, peaks}.
   */
  function oscillationTest(cfg, Kp) {
    const base = Object.assign({}, cfg, { gains: { Kp: Kp, Ki: 0, Kd: 0 }, umin: -Infinity, umax: Infinity, mode: 'continuous' });
    const c = normalize(base);
    const scale = timeScale(c);
    let T = 40 * scale;
    for (let attempt = 0; attempt < 4; attempt++) {
      const sim = simulate(base, T, { maxPoints: 20000 });
      if (sim.diverged) return { growth: Infinity, period: null, peaks: 0, diverged: true };
      const yss = c.K * Kp / (1 + c.K * Kp) * c.r;
      const d = sim.y.map(function (v) { return v - yss; });
      const pk = localMaxima(sim.t, d);
      if (pk.v.length >= 8) {
        const a = pk.v.slice(2);              // skip the start-up transient
        const ratio = a[a.length - 1] / a[0];
        let per = 0;
        for (let i = 1; i < pk.t.length; i++) per += pk.t[i] - pk.t[i - 1];
        per /= (pk.t.length - 1);
        return { growth: ratio, period: per, peaks: pk.v.length, diverged: false };
      }
      T *= 2;
    }
    return { growth: 0, period: null, peaks: 0, diverged: false };
  }

  /**
   * Find the ultimate gain Ku (the Kp at which a proportional-only loop just
   * oscillates forever) and the oscillation period Pu by bisection on the
   * time-domain simulation. Returns null if no gain up to Kmax makes the loop
   * oscillate (low-order plants).
   */
  function ultimateFromSimulation(cfg, Kmax) {
    const c = normalize(cfg);
    const kMax = Kmax || 5000;
    let lo = 0, hi = 0.5 / Math.max(Math.abs(c.K), 1e-9);
    let found = false;
    for (let i = 0; i < 30; i++) {
      if (oscillationTest(cfg, hi).growth >= 1) { found = true; break; }
      lo = hi; hi *= 2;
      if (hi > kMax) break;
    }
    if (!found) return null;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (oscillationTest(cfg, mid).growth >= 1) hi = mid; else lo = mid;
      if ((hi - lo) / hi < 1e-4) break;
    }
    const Ku = 0.5 * (lo + hi);
    const test = oscillationTest(cfg, lo);
    return { Ku: Ku, Pu: test.period };
  }

  /** Classic Ziegler-Nichols closed-loop rules from Ku and Pu. Ki = Kp/Ti, Kd = Kp*Td. */
  function zieglerNichols(Ku, Pu) {
    return {
      P: { Kp: 0.5 * Ku, Ki: 0, Kd: 0 },
      PI: { Kp: 0.45 * Ku, Ki: 0.45 * Ku / (Pu / 1.2), Kd: 0 },
      PID: { Kp: 0.6 * Ku, Ki: 0.6 * Ku / (Pu / 2), Kd: 0.6 * Ku * Pu / 8 }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Tuning challenge (P4)                                                */
  /* ------------------------------------------------------------------ */

  const GAIN_LIMITS = { Kp: 20, Ki: 20, Kd: 5 };      // slider maxima on the challenge page
  const GAIN_STEPS = { Kp: 0.05, Ki: 0.05, Kd: 0.01 };

  /** Hidden plant: the Homework 1 Module 4 random sensor model (first order K, tau; or second order K, zeta, wn). */
  function randomPlant(rng) {
    const s = M.randomSensor(rng);
    if (s.order === 1) return { type: 'first', K: s.K, tau: s.tau };
    return { type: 'second', K: s.K, zeta: s.zeta, wn: s.wn };
  }

  function stepRound(v, step) { return Math.round(v / step) * step; }
  function logU(rng, a, b) { return Math.exp(Math.log(a) + rng() * (Math.log(b) - Math.log(a))); }
  function nice2(v) { return M.roundSig(v, 2); }

  /**
   * Make a challenge: a random hidden plant plus a specification that is known
   * to be achievable. A random search over the same gain ranges the player has
   * finds a reference controller; the spec is set with margin around it.
   * Returns {plant, spec, reference:{gains, metrics}}.
   */
  function makeChallenge(rng) {
    const r = rng || Math.random;
    for (let attempt = 0; attempt < 40; attempt++) {
      const plant = randomPlant(r);
      let best = null;
      // The reference controller is searched in a comfortable part of the slider range
      // (Kp, Ki up to 6, Kd up to 1.5) so the spec does not force the player to max out every slider.
      const tSearch = 12 * timeScale(normalize({ plant: plant }));   // fixed window: cheap screening only
      for (let i = 0; i < 110; i++) {
        const Kp = stepRound(logU(r, 0.1, 6), GAIN_STEPS.Kp);
        const Ki = stepRound(logU(r, 0.05, 6), GAIN_STEPS.Ki);
        const Kd = r() < 0.4 ? 0 : stepRound(logU(r, 0.02, 1.5), GAIN_STEPS.Kd);
        const sim = simulate({ plant: plant, gains: { Kp: Kp, Ki: Ki, Kd: Kd }, r: 1 }, tSearch, { maxPoints: 2000 });
        if (sim.diverged) continue;
        const m = closedLoopMetrics(sim.t, sim.y, sim.r, {});
        if (m.status !== 'settled' || !m.settled) continue;
        if (Math.abs(m.essPct) > 0.5 || m.overshootPct > 5) continue;
        if (!best || m.settlingTime < best.metrics.settlingTime) best = { gains: { Kp: Kp, Ki: Ki, Kd: Kd }, metrics: m };
      }
      if (!best) continue;
      // verify the winner with the full analysis (the one the page uses to judge the player)
      const full = analyze({ plant: plant, gains: best.gains, r: 1 }).metrics;
      if (full.status !== 'settled' || Math.abs(full.essPct) > 0.5 || full.overshootPct > 5) continue;
      best.metrics = full;
      const osMax = [10, 15, 20][Math.floor(r() * 3)];
      const tsMax = nice2(best.metrics.settlingTime * 1.6);
      return {
        plant: plant,
        spec: { overshootMaxPct: osMax, settlingMax: tsMax, essMaxPct: 1, band: 0.02 },
        reference: best
      };
    }
    throw new Error('Could not build an achievable challenge.');
  }

  /** Score a gain set against a spec. Weights: overshoot 30, settling time 40, steady-state error 30. */
  function evaluateSpec(metrics, spec) {
    const settled = metrics.status === 'settled' && metrics.settled;
    const fin = metrics.status !== 'diverged' && metrics.status !== 'no-response';
    const checks = [
      { key: 'overshoot', label: 'Overshoot', limit: spec.overshootMaxPct, unit: '%', weight: 30,
        value: fin ? metrics.overshootPct : null, pass: fin && metrics.overshootPct <= spec.overshootMaxPct },
      { key: 'settling', label: 'Settling time (±2%)', limit: spec.settlingMax, unit: 's', weight: 40,
        value: settled ? metrics.settlingTime : null, pass: settled && metrics.settlingTime <= spec.settlingMax },
      { key: 'ess', label: 'Steady-state error', limit: spec.essMaxPct, unit: '%', weight: 30,
        value: settled ? Math.abs(metrics.essPct) : null, pass: settled && Math.abs(metrics.essPct) <= spec.essMaxPct }
    ];
    const score = checks.reduce(function (s, ch) { return s + (ch.pass ? ch.weight : 0); }, 0);
    return { checks: checks, score: score, allPass: checks.every(function (ch) { return ch.pass; }) };
  }

  return {
    normalize: normalize, simulate: simulate, closedLoopMetrics: closedLoopMetrics, analyze: analyze, crop: crop,
    quickMetrics: quickMetrics,
    timeScale: function (cfg) { return timeScale(normalize(cfg)); },
    firstOrderLoopTheory: firstOrderLoopTheory, designPI: designPI, wnFromSettling: wnFromSettling,
    identifyFirstOrder: identifyFirstOrder, arduinoCode: arduinoCode,
    openLoopGain: openLoopGain, ultimateFromFrequency: ultimateFromFrequency,
    ultimateFromSimulation: ultimateFromSimulation, oscillationTest: oscillationTest, zieglerNichols: zieglerNichols,
    randomPlant: randomPlant, makeChallenge: makeChallenge, evaluateSpec: evaluateSpec,
    GAIN_LIMITS: GAIN_LIMITS, GAIN_STEPS: GAIN_STEPS
  };
});
