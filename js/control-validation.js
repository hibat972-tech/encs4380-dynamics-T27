/*
 * control-validation.js
 * The three validation checks from Section 2.1 of Homework 2.
 *
 * Plant for all three: G(s) = K/(tau*s + 1) with K = 1 and tau = 1 s.
 *
 * Every "actual" value is measured on a closed-loop RK4 simulation made by
 * PIDSim.simulate() / PIDSim.analyze(). The "expected" values come from the
 * formulas in the assignment. PASS/FAIL is decided by comparing the two.
 * Nothing is typed in as passing.
 *
 * Control limits are switched OFF for these tests. With Kp = 9 the very first
 * control value is u(0+) = 9. A realistic 0..1 or 0..100% limit would clip it
 * and the 10% error / 0.1 s time constant would no longer be those of the
 * linear loop the formulas describe. The last rows of Test 1 and Test 3 show
 * what saturation does, as information (they are not counted as pass/fail).
 *
 * Tolerances
 *   time constant 2%, steady-state error 0.05 percentage points (and 0.1% of
 *   the setpoint for Test 3), final value 0.0005, wn and zeta 0.001, response
 *   deviation 1e-4. RK4 with h <= 0.1/lambda is far more accurate than that, so
 *   the tolerances are limits on method error plus read-off error, not slack.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const M = isNode ? require('./dyn-math.js') : root.DynMath;
  const P = isNode ? require('./pid-sim.js') : root.PIDSim;
  const lib = factory(M, P);
  if (isNode) module.exports = lib; else root.ControlValidation = lib;
})(typeof self !== 'undefined' ? self : this, function (M, P) {
  'use strict';

  const K = 1, TAU = 1;
  const PLANT = { type: 'first', K: K, tau: TAU };

  function row(quantity, expected, actual, tol, unit, method, digits) {
    const dev = actual - expected;
    return {
      quantity: quantity, expected: expected, actual: actual, deviation: dev, tol: tol,
      unit: unit || '', method: method, digits: digits === undefined ? 5 : digits,
      pass: Number.isFinite(actual) && Math.abs(dev) <= tol + 1e-12
    };
  }
  function boolRow(quantity, expectedText, ok, actualText, method) {
    return { quantity: quantity, expectedText: expectedText, actualText: actualText, pass: !!ok, method: method, isBool: true };
  }
  function infoRow(quantity, text) { return { quantity: quantity, infoText: text, isInfo: true, pass: true }; }

  /* ---------------- Test 1: P only, Kp = 9 ---------------- */
  function test1() {
    const Kp = 9;
    const cfg = { plant: PLANT, gains: { Kp: Kp, Ki: 0, Kd: 0 }, r: 1 };
    const sim = P.simulate(cfg, 2, { maxPoints: 6000 });
    const a = P.analyze(cfg);
    const ySS = a.metrics.ySS;
    // closed-loop time constant: time for y to reach 63.2% of its own final value
    const t63 = M.crossingTime(sim.t, sim.y, (1 - Math.exp(-1)) * ySS);
    // second estimate: slope of ln(1 - y/y_ss) against t (a straight line with slope -1/tau_cl)
    const lx = [], ly = [];
    for (let i = 0; i < sim.t.length; i++) {
      const f = 1 - sim.y[i] / ySS;
      if (sim.y[i] > 0.1 * ySS && f > 0.02) { lx.push(sim.t[i]); ly.push(Math.log(f)); }
    }
    const fit = M.linearFit(lx, ly);
    const tauCLtheory = TAU / (1 + K * Kp);
    const essTheory = 100 / (1 + K * Kp);
    const peakU = Math.max.apply(null, sim.u);
    // information: what a 0..1 control limit would do to the same test
    const clippedSim = P.simulate(Object.assign({}, cfg, { umin: 0, umax: 1 }), 8, { maxPoints: 8000 });
    const clippedT63 = M.crossingTime(clippedSim.t, clippedSim.y, (1 - Math.exp(-1)) * ySS);
    return {
      id: 1, title: 'P only, Kp = 9: closed-loop τ = 0.1 s, steady-state error 10%',
      setup: 'G(s) = 1/(s + 1), Kp = 9, Ki = Kd = 0, unit setpoint step, no control limit. ' +
        'Expected from the assignment: τcl = τ/(1 + K·Kp) = 0.1 s, e_ss = 1/(1 + K·Kp) = 10%, final value 0.9.',
      rows: [
        row('Closed-loop time constant (63.2% point of the curve)', tauCLtheory, t63, 0.002, ' s', 'curve', 5),
        row('Closed-loop time constant (−1/slope of ln(1 − y/y_ss))', tauCLtheory, -1 / fit.slope, 0.002, ' s', 'curve fit', 5),
        row('Steady-state error', essTheory, a.metrics.essPct, 0.05, ' %', 'curve', 4),
        row('Final output for a unit step', 1 - 1 / (1 + K * Kp), ySS, 0.0005, '', 'curve', 5),
        boolRow('Linear test: the control signal never hit a limit', 'u(0+) = Kp·r = 9, not clipped', !a.metrics.saturated && Math.abs(peakU - 9) < 0.01,
          'peak u = ' + peakU.toFixed(4), 'simulation'),
        infoRow('Information only: the same loop with 0 ≤ u ≤ 1', 'the final value is still 0.9, but u is clipped at 1 while the error is large, so the 63.2% point arrives after ' +
          (clippedT63 === null ? 'more than 8' : clippedT63.toFixed(2)) + ' s instead of 0.1 s. That is why saturation is off for this check.')
      ],
      curves: [{ name: 'y(t), Kp = 9', t: sim.t, y: sim.y }],
      ref: { y: function (t) { return (1 - 1 / (1 + K * Kp)) * (1 - Math.exp(-t / tauCLtheory)); }, name: 'Expected: 0.9·(1 − e^(−t/0.1))' }
    };
  }

  /* ---------------- Test 2: PI, Kp = 1, Ki = 1 ---------------- */
  function test2() {
    const Kp = 1, Ki = 1;
    const cfg = { plant: PLANT, gains: { Kp: Kp, Ki: Ki, Kd: 0 }, r: 1 };
    const sim = P.simulate(cfg, 12, { maxPoints: 6000 });
    const th = P.firstOrderLoopTheory(K, TAU, Kp, Ki, 0);
    // closed-loop state matrix of x = [y, integral of e]:  y' = (-(1+K Kp) y + K Ki I + K Kp r)/tau,  I' = r - y
    const A = [[-(1 + K * Kp) / TAU, K * Ki / TAU], [-1, 0]];
    const tr = A[0][0] + A[1][1], det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const wnEig = Math.sqrt(det), zetaEig = -tr / (2 * Math.sqrt(det));
    const eig = M.eig2x2(A);
    // With Kp = Ki = 1 the zero of the closed loop cancels one pole: T(s) = (s+1)/(s+1)^2 = 1/(s+1),
    // so the exact step response is 1 - e^(-t). Compare the RK4 curve with it.
    let maxDev = 0;
    for (let i = 0; i < sim.t.length; i++) maxDev = Math.max(maxDev, Math.abs(sim.y[i] - (1 - Math.exp(-sim.t[i]))));
    const peak = Math.max.apply(null, sim.y);
    return {
      id: 2, title: 'PI, Kp = 1, Ki = 1: ωn = 1 rad/s, ζ = 1',
      setup: 'G(s) = 1/(s + 1). Characteristic equation τs² + (1 + K·Kp)s + K·Ki = 0, so ωn = √(K·Ki/τ) and ζ = (1 + K·Kp)/(2√(τ·K·Ki)).',
      rows: [
        row('Characteristic equation: coefficient of s² (τ)', 1, th.a2, 1e-12, '', 'formula', 4),
        row('Characteristic equation: coefficient of s (1 + K·Kp)', 2, th.a1, 1e-12, '', 'formula', 4),
        row('Characteristic equation: constant term (K·Ki)', 1, th.a0, 1e-12, '', 'formula', 4),
        row('Natural frequency ωn', 1, th.wn, 0.001, ' rad/s', 'formula', 5),
        row('Damping ratio ζ', 1, th.zeta, 0.001, '', 'formula', 5),
        row('ωn from the eigenvalues of the closed-loop state matrix', 1, wnEig, 0.001, ' rad/s', 'eig(A)', 5),
        row('ζ from the eigenvalues of the closed-loop state matrix', 1, zetaEig, 0.001, '', 'eig(A)', 5),
        row('Both closed-loop poles (real part, double pole at −1)', -1, 0.5 * (eig[0].re + eig[1].re), 0.001, '', 'eig(A)', 5),
        row('RK4 step response vs exact 1 − e^(−t): largest deviation', 0, maxDev, 1e-4, '', 'curve', 3),
        row('Overshoot of the simulated response (ζ = 1: none)', 0, Math.max(0, 100 * (peak - 1)), 0.01, ' %', 'curve', 3)
      ],
      curves: [{ name: 'y(t), Kp = 1, Ki = 1', t: sim.t, y: sim.y }],
      ref: { y: function (t) { return 1 - Math.exp(-t); }, name: 'Expected: 1 − e^(−t)' }
    };
  }

  /* ---------------- Test 3: any stable PI controller has zero steady-state error ---------------- */
  const T3_CASES = [
    { label: 'G = 1/(s+1), PI Kp = 1, Ki = 1, r = 1', plant: PLANT, Kp: 1, Ki: 1, r: 1 },
    { label: 'G = 1/(s+1), PI Kp = 5, Ki = 3, r = 1', plant: PLANT, Kp: 5, Ki: 3, r: 1 },
    { label: 'G = 2/(0.5s+1), PI Kp = 0.5, Ki = 0.3, r = 2.5', plant: { type: 'first', K: 2, tau: 0.5 }, Kp: 0.5, Ki: 0.3, r: 2.5 },
    { label: 'G = 1/(s+1), PI Kp = 0.4, Ki = 0.15, r = −1.5 (negative step)', plant: PLANT, Kp: 0.4, Ki: 0.15, r: -1.5 },
    { label: 'Second-order G = 8/(s²+2s+4), PI Kp = 1, Ki = 1, r = 1', plant: { type: 'second', K: 2, zeta: 0.5, wn: 2 }, Kp: 1, Ki: 1, r: 1 }
  ];

  function test3() {
    const rows = [];
    const curves = [];
    T3_CASES.forEach(function (cs) {
      const cfg = { plant: cs.plant, gains: { Kp: cs.Kp, Ki: cs.Ki, Kd: 0 }, r: cs.r };
      const a = P.analyze(cfg);
      const m = a.metrics;
      const stable = m.status === 'settled';
      rows.push(boolRow(cs.label + ': loop is stable and settles', 'settles', stable, 'status: ' + m.status, 'simulation'));
      const ess = stable ? m.essPct : NaN;
      rows.push(row(cs.label + ': steady-state error', 0, ess, 0.1, ' % of r', 'curve', 4));
      curves.push({ name: cs.label, t: a.sim.t, y: a.sim.y.map(function (v) { return v / cs.r; }) });
    });
    const sat = P.analyze({ plant: PLANT, gains: { Kp: 1, Ki: 1, Kd: 0 }, r: 1, umin: -0.5, umax: 0.5 });
    rows.push(infoRow('Information only: setpoint not reachable (needs u = 1 but |u| ≤ 0.5)',
      'steady-state error ' + (sat.metrics.essPct === null ? 'not settled' : sat.metrics.essPct.toFixed(1) + ' %') +
      '. The zero-error rule needs a reachable setpoint: the integrator cannot do more than the actuator allows.'));
    return {
      id: 3, title: 'Any stable PI controller: zero steady-state error for a step',
      setup: 'Several different PI controllers and plants, each simulated until it has settled. Pass when |e_ss| ≤ 0.1% of the setpoint (final-value theorem: with an integrator, y(∞) = r).',
      rows: rows,
      curves: curves, ref: null, normalized: true
    };
  }

  function runAll() {
    return [test1(), test2(), test3()].map(function (t) {
      t.pass = t.rows.every(function (r) { return r.pass; });
      return t;
    });
  }

  return { runAll: runAll };
});
