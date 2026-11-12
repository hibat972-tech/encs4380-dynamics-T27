/*
 * Unit tests for js/dyn-math.js and js/validation.js.
 * Run with:  node tests/dyn-math.test.js   (or: npm test)
 * No dependencies: uses Node's built-in assert module.
 */
'use strict';
const assert = require('assert');
const M = require('../js/dyn-math.js');
const V = require('../js/validation.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function close(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ', got ' + a + ' (tol ' + tol + ')');
}
// central finite-difference derivatives
function d1(f, t, h) { return (f(t + h) - f(t - h)) / (2 * h); }
function d2(f, t, h) { return (f(t + h) - 2 * f(t) + f(t - h)) / (h * h); }

console.log('\nFirst-order time response');
test('step response satisfies tau*y\' + y = K*A', function () {
  const K = 1.7, tau = 0.6, A = 3;
  const f = function (t) { return M.firstOrderStep(t, K, tau, A); };
  [0.1, 0.5, 1, 2.5].forEach(function (t) { close(tau * d1(f, t, 1e-5) + f(t), K * A, 1e-6); });
});
test('ramp response satisfies tau*y\' + y = K*R*t', function () {
  const K = 2, tau = 1.3, R = 0.7;
  const f = function (t) { return M.firstOrderRamp(t, K, tau, R); };
  [0.2, 1, 4].forEach(function (t) { close(tau * d1(f, t, 1e-5) + f(t), K * R * t, 1e-6); });
});
test('63.2% at tau and 95.0% at 3 tau for any K, A, tau', function () {
  [[1, 1, 1], [3, 0.4, 7], [0.2, 12, 0.05]].forEach(function (p) {
    close(M.firstOrderStep(p[2], p[0], p[2], p[1]) / (p[0] * p[1]), 1 - Math.exp(-1), 1e-12);
    close(M.firstOrderStep(3 * p[2], p[0], p[2], p[1]) / (p[0] * p[1]), 0.950213, 1e-6);
  });
});
test('ramp lag measured off the curve equals tau', function () {
  const K = 2, tau = 1.5, R = 3;
  const t = M.linspace(0, 12 * tau, 12001);
  const y = t.map(function (ti) { return M.firstOrderRamp(ti, K, tau, R); });
  close(M.measureRampLag(t, y, K, R, 8 * tau), tau, 2e-3);
});
test('ramp steady-state error = R*tau (input units)', function () {
  const K = 2, tau = 1.5, R = 3;
  close(M.firstOrderMeasurementError(40 * tau, K, tau, 'ramp', R), R * tau, 1e-9);
  assert.strictEqual(M.firstOrderSteadyStateError(tau, 'ramp', R), R * tau);
  assert.strictEqual(M.firstOrderSteadyStateError(tau, 'step', R), 0);
});
test('ln(error fraction) is a line with slope -1/tau', function () {
  const K = 1, tau = 0.75, A = 2;
  const t = M.linspace(0, 4 * tau, 400);
  const y = t.map(function (ti) { return M.firstOrderStep(ti, K, tau, A); });
  const Em = M.errorFraction(y, K * A, 0);
  const fit = M.linearFit(t, Em.map(Math.log));
  close(fit.slope, -1 / tau, 1e-9);
  close(fit.r2, 1, 1e-12);
});

console.log('\nFirst-order frequency response');
test('M(1/tau) = 0.7071 (-3 dB) and phase = -45 deg at cut-off', function () {
  const tau = 0.37;
  close(M.magnitudeRatio(1 / tau, tau), Math.SQRT1_2, 1e-12);
  close(M.toDecibel(M.magnitudeRatio(1 / tau, tau)), -3.0103, 1e-4);
  close(M.phaseDeg(1 / tau, tau), -45, 1e-12);
});
test('sine response with transient starts at y(0)=0 and satisfies the ODE', function () {
  const K = 1.4, tau = 0.3, A = 2, w = 5;
  const f = function (t) { return M.firstOrderSine(t, K, tau, A, w, true); };
  close(f(0), 0, 1e-12);
  [0.05, 0.4, 1.7].forEach(function (t) { close(tau * d1(f, t, 1e-6) + f(t), K * A * Math.sin(w * t), 1e-5); });
});
test('lock-in measurement recovers amplitude and phase', function () {
  const w = 3, t = M.linspace(0, 4 * M.TWO_PI / w, 4001);
  const s = t.map(function (ti) { return 0.8 * Math.sin(w * ti - 0.6); });
  const r = M.measureSinusoid(t, s, w);
  close(r.amplitude, 0.8, 1e-5); close(r.phase, -0.6, 1e-5);
});
test('tau_max for 5% at 100 Hz gives M = 0.95 exactly at 100 Hz', function () {
  const tau = M.tauMaxForDynamicError(0.05, 100);
  close(M.magnitudeRatio(M.TWO_PI * 100, tau), 0.95, 1e-12);
  close(tau * 1000, 0.5231, 1e-4);
});

console.log('\nSecond-order response');
[0, 0.2, 0.5, 0.999999, 1, 1.000001, 1.6, 3].forEach(function (zeta) {
  test('step satisfies y\'\' + 2 zeta wn y\' + wn^2 y = K wn^2 A  (zeta = ' + zeta + ')', function () {
    const K = 1.3, wn = 2.5, A = 0.8;
    const f = function (t) { return M.secondOrderStep(t, K, zeta, wn, A); };
    close(f(1e-12), 0, 1e-9);
    [0.3, 1.1, 2.4].forEach(function (t) {
      const lhs = d2(f, t, 1e-4) + 2 * zeta * wn * d1(f, t, 1e-5) + wn * wn * f(t);
      close(lhs, K * wn * wn * A, 2e-4);
      close(M.secondOrderStepVelocity(t, K, zeta, wn, A), d1(f, t, 1e-6), 1e-6);
    });
  });
});
test('response is continuous across zeta = 1', function () {
  [0.2, 0.7, 1.9].forEach(function (t) {
    close(M.secondOrderStep(t, 1, 1 - 1e-7, 3, 1), M.secondOrderStep(t, 1, 1, 3, 1), 1e-6);
    close(M.secondOrderStep(t, 1, 1 + 1e-7, 3, 1), M.secondOrderStep(t, 1, 1, 3, 1), 1e-6);
  });
});
test('metrics read off the curve match the formulas for underdamped cases', function () {
  [0.1, 0.3, 0.5, 0.7, 0.9].forEach(function (zeta) {
    const wn = 3;
    const m = M.secondOrderMetrics(zeta, wn, { band: 0.02, riseDef: '0-100' });
    const f = M.secondOrderFormulas(zeta, wn, 0.02);
    close(m.overshootPct, f.overshootPct, 1e-4, 'overshoot');
    close(m.peakTime, f.tp, 1e-4, 'peak time');
    close(m.riseTime, f.tr0to100, 1e-4, 'rise time 0-100');
  });
});
test('10-90% rise time of a first-order-like case is sensible; settling inside band', function () {
  const m = M.secondOrderMetrics(0.5, 2, { band: 0.02 });
  assert.ok(m.riseTime > 0 && m.riseTime < m.peakTime);
  assert.ok(m.settled && m.settlingTime > m.peakTime);
  // check the definition directly: after ts the curve stays inside the band
  const t = M.linspace(m.settlingTime + 1e-6, m.horizon, 5000);
  t.forEach(function (ti) { assert.ok(Math.abs(M.secondOrderStep(ti, 1, 0.5, 2, 1) - 1) <= 0.02 + 1e-9); });
});
test('no overshoot for zeta >= 1', function () {
  [1, 1.5, 2.5].forEach(function (zeta) {
    const m = M.secondOrderMetrics(zeta, 4, { band: 0.02 });
    assert.strictEqual(m.overshootPct, 0); assert.strictEqual(m.peakTime, null);
    assert.ok(m.maxValue <= 1 + 1e-12);
  });
});
test('zetaFromOvershoot inverts the overshoot formula', function () {
  [0.15, 0.4, 0.65].forEach(function (z) { close(M.zetaFromOvershoot(M.secondOrderFormulas(z, 1).overshootPct), z, 1e-12); });
});

console.log('\nState space (mass-spring-damper)');
test('A, B, C match the assignment equation', function () {
  const ss = M.msdMatrices(2, 3, 8);
  assert.deepStrictEqual(ss.A, [[0, 1], [-4, -1.5]]);
  assert.deepStrictEqual(ss.B, [0, 0.5]);
  assert.deepStrictEqual(ss.C, [1, 0]);
});
test('eigenvalues of A equal the poles for random m, b, k', function () {
  const rng = M.seededRandom(42);
  for (let i = 0; i < 500; i++) {
    const m = 0.1 + 10 * rng(), b = 20 * rng(), k = 0.5 + 50 * rng();
    const d = M.maxRootDifference(M.eig2x2(M.msdMatrices(m, b, k).A), M.msdPoles(m, b, k));
    assert.ok(d < 1e-8 * (1 + Math.sqrt(k / m) + b / m), 'mismatch ' + d + ' at m=' + m + ' b=' + b + ' k=' + k);
  }
});
test('RK4 simulation of x\' = Ax + BF matches the closed form', function () {
  [[1, 2, 4], [1, 0.4, 9], [2, 12, 3], [0.5, 2, 2]].forEach(function (p) {
    const m = p[0], b = p[1], k = p[2], F0 = 1.5;
    const q = M.msdToSecondOrder(m, b, k);
    const T = M.settlingHorizon(q.zeta, q.wn, 0.02);
    const sim = M.simulateMSD(m, b, k, F0, T, 4000);
    let err = 0;
    for (let i = 0; i < sim.t.length; i += 7) {
      err = Math.max(err, Math.abs(sim.x1[i] - M.secondOrderStep(sim.t[i], q.K, q.zeta, q.wn, F0)));
    }
    assert.ok(err < 1e-6 * F0 / k + 1e-12, 'RK4 error ' + err);
  });
});

console.log('\nGuess the sensor');
test('random sensors stay inside their ranges', function () {
  const rng = M.seededRandom(7);
  let first = 0, second = 0, sine = 0;
  for (let i = 0; i < 2000; i++) {
    const s = M.randomSensor(rng);
    if (s.order === 1) {
      first++;
      assert.ok(s.K >= 0.5 && s.K <= 5 && s.tau >= 0.19 && s.tau <= 5.1);
      if (s.input === 'sine') { sine++; const wt = s.w * s.tau; assert.ok(wt > 0.35 && wt < 2.6); }
    } else {
      second++;
      assert.ok(s.zeta >= 0.1 && s.zeta <= 0.65 && s.wn >= 0.99 && s.wn <= 12.1);
    }
    assert.ok(s.tEnd > 0 && s.noiseSigma > 0);
  }
  assert.ok(first > 800 && second > 800 && sine > 150);
});
test('score: full marks within 10%, zero beyond 50%', function () {
  assert.strictEqual(M.scoreParameter(1.10, 1).points, 100);
  assert.strictEqual(M.scoreParameter(0.90, 1).points, 100);
  close(M.scoreParameter(1.30, 1).points, 50, 1e-9);
  assert.strictEqual(M.scoreParameter(1.6, 1).points, 0);
  assert.strictEqual(M.scoreParameter(NaN, 1).points, 0);
});
test('noisy samples scatter around the true curve', function () {
  const rng = M.seededRandom(3);
  const s = M.randomSensor(rng);
  const d = M.sampleSensor(s, 2000, rng);
  let sum = 0, sq = 0;
  d.t.forEach(function (ti, i) { const r = d.y[i] - M.sensorResponse(s, ti); sum += r; sq += r * r; });
  const sd = Math.sqrt(sq / d.t.length);
  close(sd, s.noiseSigma, 0.15 * s.noiseSigma);
  close(sum / d.t.length, 0, 4 * s.noiseSigma / Math.sqrt(d.t.length));
});

console.log('\nValidation checks (Section 3.2 of the assignment)');
V.runAll().forEach(function (t) {
  test('Test ' + t.id + ': ' + t.title, function () {
    t.rows.forEach(function (r) {
      assert.ok(r.pass, r.quantity + ': expected ' + (r.expectedText || r.expected) + ', got ' + (r.calcText || r.calculated));
    });
  });
});
V.runAll().forEach(function (t) {
  t.rows.forEach(function (r) {
    if (!r.isBool) console.log('       #' + t.id + '  ' + r.quantity + ': ' + r.calculated.toPrecision(6) + r.unit + '  (expected ' + r.expected + r.unit + ')');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
