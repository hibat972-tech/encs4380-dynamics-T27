/*
 * validation.js
 * The six validation checks from Section 3.2 of the assignment.
 *
 * Every "calculated" value comes from the same DynMath functions the modules
 * use to draw their plots. PASS/FAIL is decided by comparing that value with
 * the expected value from the assignment. Nothing is hard-coded as passing.
 *
 * Tolerance rule: half a unit of the last digit printed in the assignment
 * (e.g. 0.632 -> +/-0.0005, 21.8 deg -> +/-0.05 deg, 0.52 ms -> +/-0.005 ms).
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const M = isNode ? require('./dyn-math.js') : root.DynMath;
  const lib = factory(M);
  if (isNode) module.exports = lib; else root.DynValidation = lib;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function row(quantity, expected, calculated, tol, unit, method, digits) {
    const pass = Number.isFinite(calculated) && Math.abs(calculated - expected) <= tol + 1e-12;
    return {
      quantity: quantity, expected: expected, calculated: calculated, tol: tol,
      unit: unit || '', method: method, digits: digits === undefined ? 4 : digits, pass: pass
    };
  }

  function boolRow(quantity, expectedText, ok, calcText, method) {
    return { quantity: quantity, expectedText: expectedText, calcText: calcText, pass: !!ok, method: method, isBool: true };
  }

  /* Test 1: first-order step reaches 63.2% at tau and 95% at 3 tau. */
  function test1() {
    // arbitrary, non-trivial sensor: the ratio must not depend on K, A or tau
    const K = 2.5, A = 4, tau = 0.8;
    const t = M.linspace(0, 6 * tau, 6001);
    const y = t.map(function (ti) { return M.firstOrderStep(ti, K, tau, A); });
    const yTau = M.interp(t, y, tau) / (K * A);
    const y3Tau = M.interp(t, y, 3 * tau) / (K * A);
    return {
      id: 1, module: 1,
      title: 'First-order step: y(τ) = 0.632 KA and y(3τ) = 0.95 KA',
      setup: 'K = 2.5, A = 4, τ = 0.8 s; values read off the sampled step curve, divided by KA',
      rows: [
        row('y(τ) / KA', 0.632, yTau, 0.0005, '', 'curve', 4),
        row('y(3τ) / KA', 0.95, y3Tau, 0.005, '', 'curve', 4)
      ]
    };
  }

  /* Test 2: tau = 0.2 s, input sin(2t): amplitude ratio 0.93, lag 21.8 deg. */
  function test2() {
    const tau = 0.2, w = 2;
    const Mag = M.magnitudeRatio(w, tau);
    const lag = -M.phaseDeg(w, tau);
    // independent check: simulate the steady-state output and measure it (lock-in method)
    const period = M.TWO_PI / w;
    const t = M.linspace(0, 5 * period, 5001);
    const x = t.map(function (ti) { return Math.sin(w * ti); });
    const y = t.map(function (ti) { return M.firstOrderSine(ti, 1, tau, 1, w, false); });
    const mx = M.measureSinusoid(t, x, w), my = M.measureSinusoid(t, y, w);
    const measRatio = my.amplitude / mx.amplitude;
    const measLag = -(my.phase - mx.phase) * M.RAD2DEG;
    return {
      id: 2, module: 2,
      title: 'τ = 0.2 s, input sin 2t: amplitude 0.93 of the input, lag 21.8°',
      setup: 'ω = 2 rad/s, τ = 0.2 s, so ωτ = 0.4',
      rows: [
        row('Amplitude ratio M (formula)', 0.93, Mag, 0.005, '', 'formula', 4),
        row('Phase lag (formula)', 21.8, lag, 0.05, '°', 'formula', 3),
        row('Amplitude ratio (measured on simulated sine)', 0.93, measRatio, 0.005, '', 'curve', 4),
        row('Phase lag (measured on simulated sine)', 21.8, measLag, 0.05, '°', 'curve', 3)
      ]
    };
  }

  /* Test 3: up to 100 Hz with |delta| <= 5%: tau_max ~ 0.52 ms; lag 9.3 deg at 50 Hz. */
  function test3() {
    const tauMax = M.tauMaxForDynamicError(0.05, 100);
    const lag50 = -M.phaseDeg(M.TWO_PI * 50, tauMax);
    // cross-check: evaluate delta = M - 1 at 100 Hz with the tau we just found
    const delta100 = M.magnitudeRatio(M.TWO_PI * 100, tauMax) - 1;
    return {
      id: 3, module: 2,
      title: 'Signals up to 100 Hz, at most 5% dynamic error: τmax ≈ 0.52 ms, lag 9.3° at 50 Hz',
      setup: 'Solve 1/√(1+(ωτ)²) = 0.95 at ω = 2π·100 rad/s, then evaluate φ at 50 Hz',
      rows: [
        row('τmax', 0.52, tauMax * 1000, 0.005, ' ms', 'formula', 4),
        row('Phase lag at 50 Hz', 9.3, lag50, 0.05, '°', 'formula', 3),
        row('Dynamic error δ at 100 Hz (check)', -0.05, delta100, 0.0005, '', 'formula', 4)
      ]
    };
  }

  /* Test 4: zeta = 0.5 gives 16.3% overshoot. */
  function test4() {
    const zeta = 0.5, wn = 2;
    const m = M.secondOrderMetrics(zeta, wn, { band: 0.02 });
    const f = M.secondOrderFormulas(zeta, wn, 0.02);
    return {
      id: 4, module: 3,
      title: 'Second order with ζ = 0.5: overshoot = 16.3%',
      setup: 'ζ = 0.5, ωn = 2 rad/s (overshoot does not depend on ωn)',
      rows: [
        row('Overshoot read off the step curve', 16.3, m.overshootPct, 0.05, ' %', 'curve', 4),
        row('Overshoot from e^(−πζ/√(1−ζ²))', 16.3, f.overshootPct, 0.05, ' %', 'formula', 4)
      ]
    };
  }

  /* Test 5: zeta = 1 gives no overshoot. */
  function test5() {
    const zeta = 1, wn = 2;
    const m = M.secondOrderMetrics(zeta, wn, { band: 0.02 });
    const overshoot = 100 * (m.maxValue - 1);   // <= 0 means it never goes above the final value
    return {
      id: 5, module: 3,
      title: 'Second order with ζ = 1: no overshoot',
      setup: 'ζ = 1, ωn = 2 rad/s; largest value of the step curve compared with the final value',
      rows: [
        boolRow('Curve never exceeds the final value', 'max y ≤ y(∞)', overshoot <= 1e-9,
          'max y = ' + m.maxValue.toFixed(6) + ' × y(∞)', 'curve'),
        row('Overshoot', 0, Math.max(0, overshoot), 0.005, ' %', 'curve', 3)
      ]
    };
  }

  /* Test 6: m = 1, b = 2, k = 4: zeta 0.5, wn 2, eigenvalues -1 +/- j1.732 equal to poles. */
  function test6() {
    const m = 1, b = 2, k = 4;
    const ss = M.msdMatrices(m, b, k);
    const eig = M.eig2x2(ss.A);
    const poles = M.msdPoles(m, b, k);
    const p = M.msdToSecondOrder(m, b, k);
    const diff = M.maxRootDifference(eig, poles);
    return {
      id: 6, module: 3,
      title: 'State space, m = 1, b = 2, k = 4: eigenvalues of A = −1 ± j1.732 = poles',
      setup: 'A = [0 1; −k/m −b/m] = [0 1; −4 −2]; poles are the roots of m s² + b s + k',
      rows: [
        row('ζ = b / (2√(km))', 0.5, p.zeta, 0.0005, '', 'formula', 4),
        row('ωn = √(k/m)', 2, p.wn, 0.0005, ' rad/s', 'formula', 4),
        row('Re(λ) of A', -1, eig[0].re, 0.0005, '', 'eig(A)', 4),
        row('|Im(λ)| of A', 1.732, Math.abs(eig[0].im), 0.0005, '', 'eig(A)', 4),
        boolRow('Eigenvalues of A equal the poles of G(s)', '|λ − p| < 10⁻⁹',
          diff < 1e-9, 'max |λ − p| = ' + diff.toExponential(2), 'eig(A) vs roots')
      ]
    };
  }

  function runAll() {
    return [test1(), test2(), test3(), test4(), test5(), test6()].map(function (t) {
      t.pass = t.rows.every(function (r) { return r.pass; });
      return t;
    });
  }

  /* ------------------------------ browser rendering ------------------------------ */

  function fmt(v, digits) {
    if (!Number.isFinite(v)) return '—';
    const s = Number(v.toPrecision(digits));
    return String(s).replace('-', '−');
  }

  function badge(pass) {
    return pass
      ? '<span class="status status-pass"><span aria-hidden="true">✓</span> Pass</span>'
      : '<span class="status status-fail"><span aria-hidden="true">✗</span> Fail</span>';
  }

  /** Render the checks (all, or only those whose id is in `ids`) into `container`. */
  function render(container, ids) {
    const results = runAll().filter(function (t) { return !ids || ids.indexOf(t.id) !== -1; });
    let html = '';
    results.forEach(function (t) {
      html += '<div class="vtest">';
      html += '<div class="vtest-head"><h3>Test ' + t.id + ': ' + t.title + '</h3>' + badge(t.pass) + '</div>';
      html += '<p class="vtest-setup">' + t.setup + '</p>';
      html += '<div class="table-wrap"><table class="vtable"><thead><tr>' +
        '<th>Quantity</th><th>Expected</th><th>Calculated</th><th>Tolerance</th><th>Method</th><th>Result</th>' +
        '</tr></thead><tbody>';
      t.rows.forEach(function (r) {
        if (r.isBool) {
          html += '<tr><td>' + r.quantity + '</td><td>' + r.expectedText + '</td><td>' + r.calcText +
            '</td><td>—</td><td>' + r.method + '</td><td>' + badge(r.pass) + '</td></tr>';
        } else {
          html += '<tr><td>' + r.quantity + '</td><td>' + fmt(r.expected, 6) + r.unit + '</td><td>' +
            fmt(r.calculated, r.digits) + r.unit + '</td><td>± ' + fmt(r.tol, 2) + r.unit + '</td><td>' +
            r.method + '</td><td>' + badge(r.pass) + '</td></tr>';
        }
      });
      html += '</tbody></table></div></div>';
    });
    container.innerHTML = html;
    return results;
  }

  return { runAll: runAll, render: render };
});
