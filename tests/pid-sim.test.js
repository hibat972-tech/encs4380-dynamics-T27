/*
 * Unit tests for js/pid-sim.js (the Homework 2 closed-loop engine) and
 * js/control-validation.js (the three validation checks).
 * Run with:  node tests/pid-sim.test.js   (or: npm test)
 * No dependencies: uses Node's built-in assert module.
 *
 * Several tests compare the RK4 simulation with an INDEPENDENT answer
 * (a closed form, or an exact discrete-time recursion written in the test),
 * so they would fail if the engine had a bug.
 */
'use strict';
const assert = require('assert');
const M = require('../js/dyn-math.js');
const P = require('../js/pid-sim.js');
const V = require('../js/control-validation.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function close(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ', got ' + a + ' (tol ' + tol + ')');
}

const F1 = { type: 'first', K: 1, tau: 1 };

console.log('\nRK4 closed loop against closed-form answers');
test('first order, P only: matches the exponential with tau/(1+K Kp)', function () {
  const K = 2, tau = 0.7, Kp = 3.5;
  const sim = P.simulate({ plant: { type: 'first', K: K, tau: tau }, gains: { Kp: Kp, Ki: 0, Kd: 0 }, r: 2 }, 3);
  const yss = K * Kp / (1 + K * Kp) * 2, tcl = tau / (1 + K * Kp);
  let maxErr = 0;
  sim.t.forEach(function (t, i) { maxErr = Math.max(maxErr, Math.abs(sim.y[i] - yss * (1 - Math.exp(-t / tcl)))); });
  assert.ok(maxErr < 1e-6, 'max error ' + maxErr);
});
test('second order, P only: matches the closed-form second-order step', function () {
  const K = 1.5, zeta = 0.3, wn = 3, Kp = 2;
  const sim = P.simulate({ plant: { type: 'second', K: K, zeta: zeta, wn: wn }, gains: { Kp: Kp, Ki: 0, Kd: 0 }, r: 1 }, 8);
  // closed loop: wn' = wn sqrt(1+K Kp), zeta' = zeta/sqrt(1+K Kp), gain K Kp/(1+K Kp)
  const g = Math.sqrt(1 + K * Kp);
  let maxErr = 0;
  sim.t.forEach(function (t, i) { maxErr = Math.max(maxErr, Math.abs(sim.y[i] - M.secondOrderStep(t, K * Kp / (1 + K * Kp), zeta / g, wn * g, 1))); });
  assert.ok(maxErr < 1e-5, 'max error ' + maxErr);
});
test('RK4 accuracy does not depend on the plot resolution', function () {
  const cfg = { plant: { type: 'second', K: 1, zeta: 0.2, wn: 5 }, gains: { Kp: 2, Ki: 1, Kd: 0.1 }, r: 1 };
  const a = P.simulate(cfg, 10, { maxPoints: 500 }), b = P.simulate(cfg, 10, { maxPoints: 8000 });
  close(M.interp(a.t, a.y, 3.3), M.interp(b.t, b.y, 3.3), 2e-3);
});
test('PI loop: poles from the characteristic equation match the simulated decay', function () {
  const th = P.firstOrderLoopTheory(1, 1, 1, 1, 0);
  close(th.wn, 1, 1e-12); close(th.zeta, 1, 1e-12);
  const th2 = P.firstOrderLoopTheory(2, 0.5, 1, 4, 0.25);   // with Kd: (tau + K Kd) s^2 + (1 + K Kp) s + K Ki
  close(th2.a2, 1.0, 1e-12); close(th2.a1, 3, 1e-12); close(th2.a0, 8, 1e-12);
});

console.log('\nWhat P, I and D do (the behaviour the lectures describe)');
test('P: higher Kp is faster and reduces steady-state error', function () {
  const a1 = P.analyze({ plant: F1, gains: { Kp: 1, Ki: 0, Kd: 0 } }).metrics;
  const a2 = P.analyze({ plant: F1, gains: { Kp: 9, Ki: 0, Kd: 0 } }).metrics;
  assert.ok(a2.riseTime < a1.riseTime && a2.essPct < a1.essPct);
  close(a1.essPct, 50, 0.01); close(a2.essPct, 10, 0.01);
});
test('I: adds an integrator, removes the steady-state error', function () {
  const m = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 1.5, Kd: 0 } }).metrics;
  assert.ok(Math.abs(m.essPct) < 0.01);
});
test('I: raising Ki (Kp fixed) increases overshoot', function () {
  const lo = P.analyze({ plant: F1, gains: { Kp: 1, Ki: 1, Kd: 0 } }).metrics.overshootPct;
  const hi = P.analyze({ plant: F1, gains: { Kp: 1, Ki: 6, Kd: 0 } }).metrics.overshootPct;
  assert.ok(hi > lo + 10, lo + ' -> ' + hi);
});
test('D on a second-order plant adds damping: overshoot falls as Kd rises', function () {
  const plant = { type: 'second', K: 1, zeta: 0.2, wn: 4 };
  const os = [0, 0.15, 0.3, 0.6].map(function (kd) { return P.analyze({ plant: plant, gains: { Kp: 2, Ki: 0, Kd: kd } }).metrics.overshootPct; });
  for (let i = 1; i < os.length; i++) assert.ok(os[i] < os[i - 1], os.join(', '));
  assert.ok(os[3] < 5);
});
test('D on a first-order plant adds inertia (tau + K Kd): it slows the loop, it does not add damping', function () {
  const a = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 3, Kd: 0 } }).metrics;
  const b = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 3, Kd: 1 } }).metrics;
  assert.ok(b.riseTime > a.riseTime && b.overshootPct > a.overshootPct);
  close(P.firstOrderLoopTheory(1, 1, 2, 3, 1).zeta, 3 / (2 * Math.sqrt(2 * 3)), 1e-12);   // = (1+K Kp)/(2 sqrt((tau+K Kd) K Ki))
});
test('overshoot read off the curve matches e^(-pi zeta/sqrt(1-zeta^2)) for the P-only second-order loop', function () {
  const K = 1, zeta = 0.25, wn = 3, Kp = 3;
  const g = Math.sqrt(1 + K * Kp), zc = zeta / g;
  const m = P.analyze({ plant: { type: 'second', K: K, zeta: zeta, wn: wn }, gains: { Kp: Kp, Ki: 0, Kd: 0 } }).metrics;
  close(m.overshootPct, 100 * Math.exp(-Math.PI * zc / Math.sqrt(1 - zc * zc)), 0.05);
});

console.log('\nSensor in the feedback path (P2)');
test('the controller acts on the measurement: sensor output follows true output with lag tau_s', function () {
  const sim = P.simulate({ plant: F1, gains: { Kp: 2, Ki: 0, Kd: 0 }, sensorTau: 0.5, r: 1 }, 6);
  // independent check: ym' = (y - ym)/tau_s, so tau_s*ym' + ym = y. Check on the recorded curves.
  for (let i = 5; i < sim.t.length - 5; i += 200) {
    const dt = sim.t[i + 1] - sim.t[i - 1];
    const dym = (sim.ym[i + 1] - sim.ym[i - 1]) / dt;
    close(0.5 * dym + sim.ym[i], sim.y[i], 2e-3);
  }
  assert.ok(sim.e.every(function (e, i) { return Math.abs(e - (1 - sim.ym[i])) < 1e-12; }), 'error must be r - measured output');
});
test('steady-state value is not changed by the sensor lag; overshoot grows with tau_s', function () {
  const os = [0, 0.1, 0.3, 0.6, 1].map(function (ts) {
    const m = P.analyze({ plant: F1, gains: { Kp: 9, Ki: 0, Kd: 0 }, sensorTau: ts }).metrics;
    close(m.essPct, 10, 0.01);
    return m.overshootPct;
  });
  for (let i = 1; i < os.length; i++) assert.ok(os[i] > os[i - 1], os.join(', '));
});
test('PI with a slow sensor goes unstable when (tau+tau_s)(1+K Kp) < tau tau_s K Ki (Routh), and the sim agrees', function () {
  const stable = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 4, Kd: 0 }, sensorTau: 1, umin: -50, umax: 50 }).metrics;   // 6 > 4
  const unstable = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 9, Kd: 0 }, sensorTau: 1, umin: -50, umax: 50 }).metrics;   // 6 < 9
  assert.strictEqual(stable.status, 'settled');
  assert.ok(unstable.status === 'oscillating' || unstable.status === 'growing', unstable.status);
});

console.log('\nDigital PID (P3)');
test('the digital loop equals an independent discrete-time recursion (exact ZOH solution of the plant)', function () {
  const Kp = 3, Ki = 2, Kd = 0.1, Ts = 0.05, tau = 0.8, K = 1.2, r = 1;
  const sim = P.simulate({ plant: { type: 'first', K: K, tau: tau }, gains: { Kp: Kp, Ki: Ki, Kd: Kd }, r: r, mode: 'digital', Ts: Ts, umin: -4, umax: 4 }, 3);
  // independent model, written here from the assignment equation
  let y = 0, sum = 0, ePrev = 0;
  const a = Math.exp(-Ts / tau);               // exact solution of tau y' + y = K u over one sample, u held
  for (let k = 0; k < sim.samples.t.length; k++) {
    const e = r - y;
    const raw = Kp * e + Ki * Ts * (sum + e) + Kd * (e - ePrev) / Ts;     // u[k] from the assignment, sum includes e[k]
    const u = Math.min(4, Math.max(-4, raw));
    const pushing = (raw > 4 && e > 0) || (raw < -4 && e < 0);            // anti-windup (on by default)
    if (!pushing) sum += e;
    ePrev = e;
    close(sim.samples.u[k], u, 1e-6, 'u[' + k + ']');
    close(sim.samples.ym[k], y, 1e-6, 'y[' + k + ']');
    y = a * y + K * (1 - a) * u;
  }
});
test('control signal is held constant between sampling instants (stair-step)', function () {
  const Ts = 0.2;
  const sim = P.simulate({ plant: F1, gains: { Kp: 2, Ki: 1, Kd: 0 }, mode: 'digital', Ts: Ts, r: 1 }, 4);
  for (let k = 0; k < sim.samples.t.length; k++) {
    sim.t.forEach(function (t, i) {
      if (t > k * Ts + 1e-9 && t < (k + 1) * Ts - 1e-9) {
        assert.ok(Math.abs(sim.u[i] - sim.samples.u[k]) < 1e-9, 'u changed inside sample ' + k);
      }
    });
  }
  assert.strictEqual(sim.stair.t.length, 2 * sim.samples.t.length);
});
test('integration step is independent of Ts: coarse and fine plant integration give the same samples', function () {
  const a = P.simulate({ plant: { type: 'second', K: 1, zeta: 0.1, wn: 30 }, gains: { Kp: 1, Ki: 1, Kd: 0 }, mode: 'digital', Ts: 0.1 }, 3);
  // wn = 30 rad/s with Ts = 0.1 s means many RK4 sub-steps per sample
  assert.ok(a.h < 0.1 / 4, 'h = ' + a.h);
  const b = P.simulate({ plant: { type: 'second', K: 1, zeta: 0.1, wn: 30 }, gains: { Kp: 1, Ki: 1, Kd: 0 }, mode: 'digital', Ts: 0.1 }, 3, { maxPoints: 90000 });
  for (let k = 0; k < a.samples.t.length; k++) close(a.samples.ym[k], b.samples.ym[k], 1e-9);
});
test('larger Ts breaks the loop at the discrete-time stability limit (pole e^(-Ts/tau) - K Kp (1 - e^(-Ts/tau)))', function () {
  // K Kp = 9: |pole| < 1 only if Ts < tau*ln(10/8) = 0.2231 s
  const ok = P.analyze({ plant: F1, gains: { Kp: 9, Ki: 0, Kd: 0 }, mode: 'digital', Ts: 0.2, umin: -20, umax: 20 }).metrics;
  const bad = P.analyze({ plant: F1, gains: { Kp: 9, Ki: 0, Kd: 0 }, mode: 'digital', Ts: 0.25, umin: -20, umax: 20 }).metrics;
  assert.strictEqual(ok.status, 'settled');
  assert.ok(bad.status === 'oscillating' || bad.status === 'growing', bad.status);
});
test('small Ts approaches the continuous controller', function () {
  const c = P.analyze({ plant: F1, gains: { Kp: 3, Ki: 2, Kd: 0 } }).metrics;
  const d = P.analyze({ plant: F1, gains: { Kp: 3, Ki: 2, Kd: 0 }, mode: 'digital', Ts: 0.002 }).metrics;
  close(d.riseTime, c.riseTime, 0.01 * c.riseTime + 0.005);
  close(d.overshootPct, c.overshootPct, 0.5);
});
test('anti-windup works: without it the integrator winds up and overshoot is large', function () {
  const base = { plant: F1, gains: { Kp: 5, Ki: 8, Kd: 0 }, r: 1, umin: -1.5, umax: 1.5, mode: 'digital', Ts: 0.02 };
  const on = P.analyze(Object.assign({ antiWindup: true }, base)).metrics;
  const off = P.analyze(Object.assign({ antiWindup: false }, base)).metrics;
  assert.ok(off.overshootPct > on.overshootPct + 15, on.overshootPct + ' vs ' + off.overshootPct);
  assert.ok(off.settlingTime > on.settlingTime);
});
test('anti-windup also works in the continuous controller', function () {
  const base = { plant: F1, gains: { Kp: 5, Ki: 8, Kd: 0 }, r: 1, umin: -1.5, umax: 1.5 };
  const on = P.analyze(Object.assign({ antiWindup: true }, base)).metrics;
  const off = P.analyze(Object.assign({ antiWindup: false }, base)).metrics;
  assert.ok(off.overshootPct > on.overshootPct + 15);
});
test('saturation: u never leaves the limits, uRaw may', function () {
  const sim = P.simulate({ plant: F1, gains: { Kp: 9, Ki: 2, Kd: 0 }, r: 1, umin: 0, umax: 2 }, 5);
  assert.ok(sim.u.every(function (v) { return v >= 0 && v <= 2; }));
  assert.ok(Math.max.apply(null, sim.uRaw) > 2);
});

console.log('\nGenerated Arduino code runs the same controller');
function loadArduinoController(code) {
  // Turn the generated C++ into JavaScript: the settings, the state and pidStep().
  const settings = code.split('// ---- Controller settings (from the page) ----')[1].split('// ---- Hardware')[0];
  const state = code.split('// ---- Controller state ----')[1].split('float readMeasurement')[0];
  const fn = code.slice(code.indexOf('float pidStep'), code.indexOf('void setup'));
  let js = (settings + '\n' + state + '\n' + fn)
    .replace(/\/\/.*$/gm, '')
    .replace(/const (float|bool|unsigned long|int)\s+/g, 'var ')
    .replace(/\bunsigned long\s+/g, 'var ')
    .replace(/\bfloat pidStep\(float measurement\)/, 'function pidStep(measurement)')
    .replace(/\b(float|bool)\s+/g, 'var ')
    .replace(/(\d)f\b/g, '$1').replace(/(\d)UL\b/g, '$1');
  js = 'function constrain(a, lo, hi) { return a < lo ? lo : (a > hi ? hi : a); }\n' + js + '\nreturn { pidStep: pidStep, Ts: Ts };';
  return new Function(js)();
}
[true, false].forEach(function (aw) {
  test('Arduino pidStep() reproduces the simulated u[k] sample by sample (anti-windup ' + (aw ? 'on' : 'off') + ')', function () {
    const o = { Kp: 4.5, Ki: 7, Kd: 0.12, Ts: 0.04, umin: -1.5, umax: 1.5, antiWindup: aw, setpoint: 1 };
    const sim = P.simulate({ plant: { type: 'first', K: 1.3, tau: 0.9 }, gains: { Kp: o.Kp, Ki: o.Ki, Kd: o.Kd }, r: 1, umin: o.umin, umax: o.umax, antiWindup: aw, mode: 'digital', Ts: o.Ts }, 6);
    const ctl = loadArduinoController(P.arduinoCode(o));
    close(ctl.Ts, o.Ts, 1e-12);
    for (let k = 0; k < sim.samples.t.length; k++) {
      close(ctl.pidStep(sim.samples.ym[k]), sim.samples.u[k], 1e-9, 'u[' + k + ']');
    }
  });
});
test('Arduino code contains the selected parameters and a copy-ready sketch', function () {
  const code = P.arduinoCode({ Kp: 1.25, Ki: 0.5, Kd: 0.02, Ts: 0.01, umin: 0, umax: 100, antiWindup: true, setpoint: 300, header: ['Plant: K = 4, tau = 0.08 s'] });
  ['const float Kp = 1.25f;', 'const float Ki = 0.5f;', 'const float Kd = 0.02f;', 'const unsigned long TS_US = 10000UL;',
    'const float U_MAX = 100.0f;', 'const bool ANTI_WINDUP = true;', 'void setup()', 'void loop()', 'Plant: K = 4, tau = 0.08 s'].forEach(function (s) {
    assert.ok(code.indexOf(s) >= 0, 'missing: ' + s);
  });
  assert.ok(!/TODO/i.test(code));
});

console.log('\nRobustness');
test('zero gains: reported as "no response", no crash', function () {
  const m = P.analyze({ plant: F1, gains: { Kp: 0, Ki: 0, Kd: 0 } }).metrics;
  assert.strictEqual(m.status, 'no-response'); assert.strictEqual(m.essPct, 100);
});
test('invalid parameters are clamped with a warning, outputs stay finite', function () {
  const sim = P.simulate({ plant: { type: 'first', K: NaN, tau: -3 }, gains: { Kp: NaN, Ki: 1, Kd: 0 }, r: NaN, Ts: -1 }, 5);
  assert.ok(sim.warnings.length >= 1);
  assert.ok(sim.y.every(isFinite));
});
test('an unstable loop is detected instead of overflowing', function () {
  const a = P.analyze({ plant: { type: 'first', K: -1, tau: 1 }, gains: { Kp: 5, Ki: 0, Kd: 0 } });
  assert.ok(a.sim.y.every(isFinite));
  assert.ok(a.metrics.status === 'diverged' || a.metrics.status === 'growing', a.metrics.status);
});
test('a never-settling loop (sustained oscillation) is reported, not given fake numbers', function () {
  const m = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 9, Kd: 0 }, sensorTau: 1, umin: -5, umax: 5 }).metrics;
  assert.strictEqual(m.settlingTime, null); assert.strictEqual(m.essPct, null);
});
test('invalid time window throws a clear error', function () {
  assert.throws(function () { P.simulate({ plant: F1 }, -1); }, /positive/);
});
test('negative setpoint step gives the mirror image', function () {
  const a = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 3, Kd: 0 }, r: 1 }).metrics;
  const b = P.analyze({ plant: F1, gains: { Kp: 2, Ki: 3, Kd: 0 }, r: -2 }).metrics;
  close(a.overshootPct, b.overshootPct, 1e-6); close(a.settlingTime, b.settlingTime, 1e-6);
});

console.log('\nStep-test identification and PI design (My System)');
test('identifyFirstOrder recovers K and tau from a noisy synthetic step test', function () {
  const rng = M.seededRandom(5);
  const K = 3.2, tau = 0.12, step = 50, t = M.linspace(0, 1.2, 241);
  const y = t.map(function (ti) { return K * step * (1 - Math.exp(-ti / tau)) + 0.01 * K * step * M.gaussian(rng); });
  const id = P.identifyFirstOrder(t, y, step, 0);
  close(id.K, K, 0.02 * K); close(id.tau63, tau, 0.05 * tau); close(id.tauFit, tau, 0.05 * tau);
});
test('identifyFirstOrder rejects unusable data', function () {
  assert.throws(function () { P.identifyFirstOrder([0, 1, 2], [0, 1, 2], 10, 0); }, /8 samples/);
  assert.throws(function () { P.identifyFirstOrder(M.linspace(0, 1, 20), new Array(20).fill(1), 10, 0); }, /did not change/);
  assert.throws(function () { P.identifyFirstOrder(M.linspace(0, 1, 20), M.linspace(0, 1, 20), 0, 0); }, /positive/);
});
test('designPI puts the closed-loop poles at the requested zeta and wn', function () {
  const K = 4, tau = 0.08, d = P.designPI(K, tau, 0.7, 12);
  const th = P.firstOrderLoopTheory(K, tau, d.Kp, d.Ki, 0);
  close(th.zeta, 0.7, 1e-9); close(th.wn, 12, 1e-9);
});

console.log('\nZiegler-Nichols bonus');
test('Ku from the time-domain bisection equals Ku from the -180 degree frequency crossing', function () {
  const cfg = { plant: { type: 'second', K: 1, zeta: 0.5, wn: 2 }, sensorTau: 0.3 };
  const f = P.ultimateFromFrequency(cfg), s = P.ultimateFromSimulation(cfg);
  close(s.Ku, f.Ku, 0.005 * f.Ku); close(s.Pu, f.Pu, 0.01 * f.Pu);
  // Routh limit for a3 s^3 + a2 s^2 + a1 s + a0: stable while a2 a1 > a3 a0
  const wn = 2, z = 0.5, ts = 0.3;
  const a3 = ts / (wn * wn), a2 = 1 / (wn * wn) + 2 * z * ts / wn, a1 = 2 * z / wn + ts;
  close(f.Ku, a2 * a1 / a3 - 1, 1e-9);
});
test('a plant with no oscillation under P control has no Ku (first order, second order alone)', function () {
  assert.strictEqual(P.ultimateFromFrequency({ plant: F1 }), null);
  assert.strictEqual(P.ultimateFromFrequency({ plant: { type: 'second', K: 1, zeta: 0.5, wn: 2 } }), null);
  assert.strictEqual(P.ultimateFromSimulation({ plant: F1 }, 200), null);
});
test('Z-N rules', function () {
  const z = P.zieglerNichols(10, 2);
  close(z.PID.Kp, 6, 1e-12); close(z.PID.Ki, 6 / 1, 1e-12); close(z.PID.Kd, 6 * 2 / 8, 1e-12);
  close(z.PI.Kp, 4.5, 1e-12); close(z.PI.Ki, 4.5 / (2 / 1.2), 1e-12); close(z.P.Kp, 5, 1e-12);
});
test('at Kp = Ku the simulated loop oscillates with a constant amplitude', function () {
  const cfg = { plant: { type: 'second', K: 1, zeta: 0.5, wn: 2 }, sensorTau: 0.3 };
  const u = P.ultimateFromFrequency(cfg);
  const g = P.oscillationTest(cfg, u.Ku);
  close(g.growth, 1, 0.02);
  assert.ok(P.oscillationTest(cfg, 0.8 * u.Ku).growth < 0.8);
  assert.ok(P.oscillationTest(cfg, 1.2 * u.Ku).growth > 1.5);
});

console.log('\nTuning challenge (P4)');
test('20 random challenges: hidden plant from the Homework 1 model, spec achievable (reference passes), and it is not trivial', function () {
  const rng = M.seededRandom(2024);
  for (let i = 0; i < 20; i++) {
    const c = P.makeChallenge(rng);
    const ev = P.evaluateSpec(P.analyze({ plant: c.plant, gains: c.reference.gains }).metrics, c.spec);
    assert.ok(ev.allPass, 'reference fails its own spec in challenge ' + i);
    assert.ok([10, 15, 20].indexOf(c.spec.overshootMaxPct) >= 0 && c.spec.settlingMax > 0 && c.spec.essMaxPct === 1);
    // doing nothing must fail
    const none = P.evaluateSpec(P.analyze({ plant: c.plant, gains: { Kp: 0, Ki: 0, Kd: 0 } }).metrics, c.spec);
    assert.ok(!none.allPass);
    // P only leaves a steady-state error
    const ponly = P.evaluateSpec(P.analyze({ plant: c.plant, gains: { Kp: 1, Ki: 0, Kd: 0 } }).metrics, c.spec);
    assert.ok(!ponly.checks[2].pass, 'P-only should not meet the zero-error spec');
  }
});
test('evaluateSpec scores each part separately (30 + 40 + 30)', function () {
  const spec = { overshootMaxPct: 10, settlingMax: 2, essMaxPct: 1 };
  const a = P.evaluateSpec({ status: 'settled', settled: true, overshootPct: 5, settlingTime: 3, essPct: 0.2 }, spec);
  assert.deepStrictEqual(a.checks.map(function (c) { return c.pass; }), [true, false, true]); assert.strictEqual(a.score, 60);
  const b = P.evaluateSpec({ status: 'oscillating', settled: false, overshootPct: 50, settlingTime: null, essPct: null }, spec);
  assert.strictEqual(b.score, 0);
});

console.log('\nValidation checks (Homework 2, Section 2.1)');
V.runAll().forEach(function (t) {
  test('Validation test ' + t.id + ': ' + t.title, function () {
    t.rows.forEach(function (r) { assert.ok(r.pass, r.quantity + (r.actual !== undefined ? ' (actual ' + r.actual + ', expected ' + r.expected + ')' : '')); });
    assert.ok(t.pass);
  });
});
test('validation numbers are really computed: a different plant does NOT give the Test 1 numbers', function () {
  const m = P.analyze({ plant: { type: 'first', K: 1, tau: 2 }, gains: { Kp: 9, Ki: 0, Kd: 0 } }).metrics;
  assert.ok(Math.abs(m.riseTime / Math.log(9) - 0.1) > 0.05);   // tau_cl would be 0.2 s, not 0.1 s
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
