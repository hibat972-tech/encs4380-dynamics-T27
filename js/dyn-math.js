/*
 * dyn-math.js
 * Shared mathematical models for the Dynamic Characteristics Interactive Toolkit.
 *
 * Every number shown on the website (plots, readouts, validation checks,
 * "Predict, then check" answers and the Guess-the-sensor challenge) is
 * computed by the functions in this file. Nothing is hard-coded.
 *
 * Works in the browser (exposes window.DynMath) and in Node.js
 * (module.exports), so the same code is unit-tested with `npm test`.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  } else {
    root.DynMath = lib;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TWO_PI = 2 * Math.PI;
  const RAD2DEG = 180 / Math.PI;
  const DEG2RAD = Math.PI / 180;

  /* ------------------------------------------------------------------ */
  /* Small numeric helpers                                               */
  /* ------------------------------------------------------------------ */

  /** n evenly spaced samples from a to b (inclusive). */
  function linspace(a, b, n) {
    const out = new Array(n);
    if (n === 1) { out[0] = a; return out; }
    const h = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) out[i] = a + i * h;
    return out;
  }

  /** n samples spaced evenly on a log10 axis from a to b (a, b > 0). */
  function logspace(a, b, n) {
    const la = Math.log10(a), lb = Math.log10(b);
    return linspace(la, lb, n).map(function (v) { return Math.pow(10, v); });
  }

  /** Least-squares straight line y = slope*x + intercept, with R^2. */
  function linearFit(x, y) {
    const n = x.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sx += x[i]; sy += y[i];
      sxx += x[i] * x[i]; sxy += x[i] * y[i]; syy += y[i] * y[i];
    }
    const den = n * sxx - sx * sx;
    const slope = (n * sxy - sx * sy) / den;
    const intercept = (sy - slope * sx) / n;
    const ssTot = syy - sy * sy / n;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - (slope * x[i] + intercept);
      ssRes += r * r;
    }
    return { slope: slope, intercept: intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
  }

  /** Linear interpolation of y at xq on a sampled curve (x ascending). */
  function interp(x, y, xq) {
    if (xq <= x[0]) return y[0];
    const n = x.length;
    if (xq >= x[n - 1]) return y[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= xq) lo = mid; else hi = mid;
    }
    const f = (xq - x[lo]) / (x[hi] - x[lo]);
    return y[lo] + f * (y[hi] - y[lo]);
  }

  /**
   * First time the sampled curve y(t) crosses `level` going upward,
   * found by linear interpolation between samples. Returns null if never.
   */
  function crossingTime(t, y, level, startIndex) {
    for (let i = Math.max(1, startIndex || 1); i < t.length; i++) {
      if (y[i - 1] < level && y[i] >= level) {
        return t[i - 1] + (level - y[i - 1]) * (t[i] - t[i - 1]) / (y[i] - y[i - 1]);
      }
    }
    return null;
  }

  /** Complex number helpers (objects {re, im}). */
  function cAbs(z) { return Math.hypot(z.re, z.im); }
  function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }

  /** Seeded pseudo-random generator (mulberry32) for reproducible tests. */
  function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Normally distributed random number (Box–Muller). */
  function gaussian(rng) {
    const r = rng || Math.random;
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
  }

  /* ------------------------------------------------------------------ */
  /* Module 1: first-order time response                                 */
  /*   tau*dy/dt + y = K*x(t),   G(s) = K/(tau*s + 1)                    */
  /* ------------------------------------------------------------------ */

  /** Step input x(t) = A for t >= 0:  y(t) = K*A*(1 - e^(-t/tau)). */
  function firstOrderStep(t, K, tau, A) {
    if (t <= 0) return 0;
    return K * A * (1 - Math.exp(-t / tau));
  }

  /** Ramp input x(t) = R*t:  y(t) = K*R*(t - tau*(1 - e^(-t/tau))). */
  function firstOrderRamp(t, K, tau, R) {
    if (t <= 0) return 0;
    return K * R * (t - tau * (1 - Math.exp(-t / tau)));
  }

  /**
   * Measurement error of a first-order sensor, in INPUT units:
   *   e(t) = x(t) - y(t)/K   (true value minus indicated value).
   */
  function firstOrderMeasurementError(t, K, tau, input, amplitude) {
    if (input === 'ramp') return amplitude * t - firstOrderRamp(t, K, tau, amplitude) / K;
    return (t < 0 ? 0 : amplitude) - firstOrderStep(t, K, tau, amplitude) / K;
  }

  /**
   * Steady-state error (input units). Step: 0. Ramp: R*tau.
   * Derived from the limit of e(t) as t -> infinity of the closed form above.
   */
  function firstOrderSteadyStateError(tau, input, amplitude) {
    return input === 'ramp' ? amplitude * tau : 0;
  }

  /**
   * Error fraction computed from a sampled response:
   *   step: Em(t) = (y_final - y(t)) / (y_final - y(0))
   *   ramp: Em(t) = (e_ss - e(t)) / e_ss   (the decaying part of the ramp error)
   * Both equal e^(-t/tau) for a first-order system, so ln(Em) has slope -1/tau.
   */
  function errorFraction(y, yFinal, y0) {
    const span = yFinal - y0;
    return y.map(function (v) { return (yFinal - v) / span; });
  }

  /**
   * Ramp lag measured off the curves: the horizontal (time) distance between
   * the ideal output K*R*t and the actual output y(t) at time tRef.
   * Finds t2 with y(t2) = K*R*tRef and returns t2 - tRef.
   */
  function measureRampLag(t, y, K, R, tRef) {
    const target = K * R * tRef;
    const t2 = crossingTime(t, y, target);
    return t2 === null ? null : t2 - tRef;
  }

  /* ------------------------------------------------------------------ */
  /* Module 2: first-order frequency response                            */
  /*   M = 1/sqrt(1 + (w*tau)^2),  phi = -atan(w*tau)                    */
  /* ------------------------------------------------------------------ */

  function magnitudeRatio(w, tau) { return 1 / Math.sqrt(1 + (w * tau) * (w * tau)); }
  function phaseRad(w, tau) { return -Math.atan(w * tau); }
  function phaseDeg(w, tau) { return phaseRad(w, tau) * RAD2DEG; }
  function toDecibel(M) { return 20 * Math.log10(M); }

  /** Dynamic error delta = M - 1 (negative: the sensor under-reads the amplitude). */
  function dynamicError(w, tau) { return magnitudeRatio(w, tau) - 1; }

  /** Cut-off (corner) frequency: w_c = 1/tau rad/s, f_c = 1/(2*pi*tau) Hz. */
  function cutoffRad(tau) { return 1 / tau; }
  function cutoffHz(tau) { return 1 / (TWO_PI * tau); }

  /**
   * Largest tau that keeps |delta| <= deltaMax for every frequency up to fMaxHz.
   * |delta| grows with frequency, so the worst case is f = fMaxHz:
   *   1/sqrt(1+(w tau)^2) = 1 - deltaMax  =>  tau = sqrt(1/(1-deltaMax)^2 - 1) / w
   */
  function tauMaxForDynamicError(deltaMax, fMaxHz) {
    const w = TWO_PI * fMaxHz;
    return Math.sqrt(1 / ((1 - deltaMax) * (1 - deltaMax)) - 1) / w;
  }

  /**
   * Response to x(t) = A*sin(w t) starting from rest at t = 0.
   *   y(t) = K*A*M*sin(w t + phi) + K*A*(w tau)/(1+(w tau)^2) * e^(-t/tau)
   * The second term is the start-up transient; set includeTransient=false
   * to get only the steady-state sine.
   */
  function firstOrderSine(t, K, tau, A, w, includeTransient) {
    const M = magnitudeRatio(w, tau);
    const phi = phaseRad(w, tau);
    let y = K * A * M * Math.sin(w * t + phi);
    if (includeTransient && t >= 0) {
      const wt = w * tau;
      y += K * A * wt / (1 + wt * wt) * Math.exp(-t / tau);
    }
    return y;
  }

  /**
   * Measure amplitude and phase of a sampled sinusoid at a known frequency w
   * (single-frequency Fourier projection, the "lock-in" method).
   * Samples should cover a whole number of periods. Returns {amplitude, phase}
   * with s(t) ~= amplitude * sin(w t + phase).
   */
  function measureSinusoid(t, s, w) {
    let a = 0, b = 0;
    for (let i = 1; i < t.length; i++) {
      const dt = t[i] - t[i - 1];
      a += 0.5 * dt * (s[i] * Math.sin(w * t[i]) + s[i - 1] * Math.sin(w * t[i - 1]));
      b += 0.5 * dt * (s[i] * Math.cos(w * t[i]) + s[i - 1] * Math.cos(w * t[i - 1]));
    }
    const T = t[t.length - 1] - t[0];
    a *= 2 / T; b *= 2 / T;
    return { amplitude: Math.hypot(a, b), phase: Math.atan2(b, a) };
  }

  /* ------------------------------------------------------------------ */
  /* Module 3: second-order response                                     */
  /*   G(s) = K*wn^2 / (s^2 + 2*zeta*wn*s + wn^2)                         */
  /* ------------------------------------------------------------------ */

  function dampingClass(zeta) {
    if (zeta === 0) return 'undamped';
    if (zeta < 1 - 1e-9) return 'underdamped';
    if (zeta <= 1 + 1e-9) return 'critically damped';
    return 'overdamped';
  }

  /** Closed-form step response for a step of size A (default 1). */
  function secondOrderStep(t, K, zeta, wn, A) {
    const amp = (A === undefined ? 1 : A) * K;
    if (t <= 0) return 0;
    let y;
    if (zeta < 1 - 1e-9) {
      const s = Math.sqrt(1 - zeta * zeta);
      const wd = wn * s;
      y = 1 - Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + (zeta / s) * Math.sin(wd * t));
    } else if (zeta <= 1 + 1e-9) {
      y = 1 - Math.exp(-wn * t) * (1 + wn * t);
    } else {
      const r = Math.sqrt(zeta * zeta - 1);
      const s1 = -wn * (zeta - r);   // slow pole
      const s2 = -wn * (zeta + r);   // fast pole
      y = 1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2);
    }
    return amp * y;
  }

  /** Velocity dy/dt of the step response (used for the phase-plane check). */
  function secondOrderStepVelocity(t, K, zeta, wn, A) {
    const amp = (A === undefined ? 1 : A) * K;
    if (t <= 0) return 0;
    if (zeta < 1 - 1e-9) {
      const s = Math.sqrt(1 - zeta * zeta);
      const wd = wn * s;
      return amp * (wn / s) * Math.exp(-zeta * wn * t) * Math.sin(wd * t);
    }
    if (zeta <= 1 + 1e-9) return amp * wn * wn * t * Math.exp(-wn * t);
    const r = Math.sqrt(zeta * zeta - 1);
    const s1 = -wn * (zeta - r), s2 = -wn * (zeta + r);
    return amp * s1 * s2 * (Math.exp(s1 * t) - Math.exp(s2 * t)) / (s1 - s2);
  }

  /** Roots of a*s^2 + b*s + c = 0 as complex numbers, upper-half-plane root first. */
  function quadraticRoots(a, b, c) {
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      const re = -b / (2 * a), im = Math.sqrt(-disc) / (2 * a);
      return [{ re: re, im: Math.abs(im) }, { re: re, im: -Math.abs(im) }];
    }
    // numerically stable real roots
    const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(disc));
    let r1 = q / a, r2 = q !== 0 ? c / q : -b / (2 * a);
    if (r1 < r2) { const tmp = r1; r1 = r2; r2 = tmp; }
    return [{ re: r1, im: 0 }, { re: r2, im: 0 }];
  }

  /** Poles of G(s): roots of s^2 + 2 zeta wn s + wn^2. */
  function secondOrderPoles(zeta, wn) {
    return quadraticRoots(1, 2 * zeta * wn, wn * wn);
  }

  /**
   * Classic formula values (used next to the values read off the curve):
   *   wd = wn*sqrt(1-zeta^2),  tp = pi/wd,
   *   Mp = exp(-pi*zeta/sqrt(1-zeta^2)),
   *   tr(0-100%) = (pi - acos(zeta))/wd,
   *   ts ~= 4/(zeta*wn) (2% band) or 3/(zeta*wn) (5% band) [envelope approximation].
   */
  function secondOrderFormulas(zeta, wn, band) {
    const out = { wd: null, tp: null, overshootPct: 0, tr0to100: null, tsApprox: null };
    if (zeta < 1 - 1e-9) {
      const s = Math.sqrt(1 - zeta * zeta);
      out.wd = wn * s;
      out.tp = Math.PI / out.wd;
      out.overshootPct = 100 * Math.exp(-Math.PI * zeta / s);
      out.tr0to100 = (Math.PI - Math.acos(zeta)) / out.wd;
      if (zeta > 0) {
        const n = band <= 0.02 + 1e-12 ? 4 : 3;
        out.tsApprox = n / (zeta * wn);
      }
    }
    return out;
  }

  /** Overshoot (%) -> zeta, the inverse of the Mp formula (used in hints/tests). */
  function zetaFromOvershoot(overshootPct) {
    const L = Math.log(overshootPct / 100);
    return -L / Math.sqrt(Math.PI * Math.PI + L * L);
  }

  /**
   * A time span long enough for the response to settle inside `band`
   * (used to evaluate metrics off the curve). Undamped: 20 periods.
   */
  function settlingHorizon(zeta, wn, band) {
    const b = band || 0.02;
    if (zeta <= 0) return 20 * TWO_PI / wn;
    if (zeta < 1 - 1e-9) {
      const s = Math.sqrt(1 - zeta * zeta);
      const tEnv = -Math.log(b * s) / (zeta * wn);   // envelope inside band
      return 1.3 * tEnv + TWO_PI / (wn * s);
    }
    const pSlow = zeta <= 1 + 1e-9 ? wn : wn * (zeta - Math.sqrt(zeta * zeta - 1));
    return 1.5 * (Math.log(1 / b) + 3) / pSlow;
  }

  /** A pleasant plotting window for the step response. */
  function plotWindow(zeta, wn) {
    if (zeta <= 0) return 5 * TWO_PI / wn;
    if (zeta < 1 - 1e-9) {
      const s = Math.sqrt(1 - zeta * zeta);
      const ts = -Math.log(0.02 * s) / (zeta * wn);
      return Math.min(Math.max(1.25 * ts, 3 * Math.PI / (wn * s)), 12 * TWO_PI / (wn * s));
    }
    return settlingHorizon(zeta, wn, 0.02) / 1.5 * 1.1;
  }

  /**
   * Read step-response metrics OFF A SAMPLED CURVE (no formulas used):
   *  - rise time: 10%->90% (default) or 0%->100% of the final value
   *  - peak time and overshoot: from the maximum sample (parabolic refinement)
   *  - settling time: last time the curve is outside +/- band of the final value
   */
  function stepMetrics(t, y, yFinal, options) {
    const opts = options || {};
    const band = opts.band || 0.02;
    const riseDef = opts.riseDef || '10-90';
    const n = t.length;
    const yn = y.map(function (v) { return v / yFinal; });

    let riseTime = null, riseStart = null, riseEnd = null;
    if (riseDef === '0-100') {
      riseStart = 0;
      riseEnd = crossingTime(t, yn, 1.0);
      riseTime = riseEnd;                     // null if the curve never reaches 100%
    } else {
      riseStart = crossingTime(t, yn, 0.1);
      riseEnd = crossingTime(t, yn, 0.9);
      if (riseStart !== null && riseEnd !== null) riseTime = riseEnd - riseStart;
    }

    // maximum and overshoot
    let iMax = 0;
    for (let i = 1; i < n; i++) if (yn[i] > yn[iMax]) iMax = i;
    let peakTime = null, overshootPct = 0, peakValue = y[iMax];
    if (yn[iMax] > 1 + 1e-9 && iMax > 0 && iMax < n - 1) {
      const y0 = yn[iMax - 1], y1 = yn[iMax], y2 = yn[iMax + 1];
      const den = y0 - 2 * y1 + y2;
      const p = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
      const h = t[iMax + 1] - t[iMax];
      peakTime = t[iMax] + p * h;
      const ynPeak = y1 - 0.25 * (y0 - y2) * p;
      overshootPct = 100 * (ynPeak - 1);
      peakValue = ynPeak * yFinal;
    }

    // settling time
    let settlingTime = null, settled = true;
    let last = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(yn[i] - 1) > band) { last = i; break; }
    }
    if (last === n - 1) {
      settled = false;
    } else if (last === -1) {
      settlingTime = 0;
    } else {
      const e1 = Math.abs(yn[last] - 1), e2 = Math.abs(yn[last + 1] - 1);
      settlingTime = t[last] + (e1 - band) / (e1 - e2) * (t[last + 1] - t[last]);
    }

    return {
      riseTime: riseTime, riseStart: riseStart, riseEnd: riseEnd,
      peakTime: peakTime, peakValue: peakValue, overshootPct: overshootPct,
      maxValue: y[iMax],
      settlingTime: settlingTime, settled: settled
    };
  }

  /** Evaluate the closed-form step response on a dense grid and read the metrics off it. */
  function secondOrderMetrics(zeta, wn, options) {
    const opts = options || {};
    const band = opts.band || 0.02;
    const T = settlingHorizon(zeta, wn, band);
    const N = opts.samples || 20001;
    const t = linspace(0, T, N);
    const y = t.map(function (ti) { return secondOrderStep(ti, 1, zeta, wn, 1); });
    const m = stepMetrics(t, y, 1, { band: band, riseDef: opts.riseDef });
    m.horizon = T;
    if (zeta <= 0) { m.settlingTime = null; m.settled = false; }
    return m;
  }

  /* ------------------------------------------------------------------ */
  /* State-space: mass-spring-damper (Example 3 of the course notes)      */
  /*   x1 = displacement, x2 = velocity                                  */
  /*   x' = [0 1; -k/m -b/m] x + [0; 1/m] F(t),  y = [1 0] x              */
  /* ------------------------------------------------------------------ */

  function msdMatrices(m, b, k) {
    return {
      A: [[0, 1], [-k / m, -b / m]],
      B: [0, 1 / m],
      C: [1, 0],
      D: 0
    };
  }

  /** Equivalent second-order parameters: wn = sqrt(k/m), zeta = b/(2 sqrt(k m)), K = 1/k. */
  function msdToSecondOrder(m, b, k) {
    return { wn: Math.sqrt(k / m), zeta: b / (2 * Math.sqrt(k * m)), K: 1 / k };
  }

  /** Eigenvalues of a 2x2 matrix from its trace and determinant. */
  function eig2x2(M) {
    const tr = M[0][0] + M[1][1];
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    const disc = tr * tr / 4 - det;
    if (disc < 0) {
      const im = Math.sqrt(-disc);
      return [{ re: tr / 2, im: im }, { re: tr / 2, im: -im }];
    }
    const r = Math.sqrt(disc);
    return [{ re: tr / 2 + r, im: 0 }, { re: tr / 2 - r, im: 0 }];
  }

  /** Poles of the transfer function X(s)/F(s) = 1/(m s^2 + b s + k). */
  function msdPoles(m, b, k) { return quadraticRoots(m, b, k); }

  /** Largest distance between two pole sets after matching them in order. */
  function maxRootDifference(p, q) {
    const a = p.slice().sort(rootOrder), c = q.slice().sort(rootOrder);
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, cAbs(cSub(a[i], c[i])));
    return d;
  }
  function rootOrder(u, v) { return (v.im - u.im) || (v.re - u.re); }

  /**
   * Classic 4th-order Runge-Kutta for x' = f(t, x), x a 2-vector.
   * Returns {t, x1, x2}.
   */
  function rk4(f, x0, t0, t1, steps) {
    const h = (t1 - t0) / steps;
    const t = new Array(steps + 1), x1 = new Array(steps + 1), x2 = new Array(steps + 1);
    let x = [x0[0], x0[1]], tc = t0;
    t[0] = tc; x1[0] = x[0]; x2[0] = x[1];
    for (let i = 1; i <= steps; i++) {
      const k1 = f(tc, x);
      const k2 = f(tc + h / 2, [x[0] + h / 2 * k1[0], x[1] + h / 2 * k1[1]]);
      const k3 = f(tc + h / 2, [x[0] + h / 2 * k2[0], x[1] + h / 2 * k2[1]]);
      const k4 = f(tc + h, [x[0] + h * k3[0], x[1] + h * k3[1]]);
      x = [x[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
           x[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
      tc = t0 + i * h;
      t[i] = tc; x1[i] = x[0]; x2[i] = x[1];
    }
    return { t: t, x1: x1, x2: x2 };
  }

  /**
   * Simulate the mass-spring-damper state equation x' = A x + B F
   * for a step force F(t) = F0, starting at rest. Uses the A and B matrices
   * directly, so the plot follows the assignment's state-space equation.
   */
  function simulateMSD(m, b, k, F0, T, steps) {
    const ss = msdMatrices(m, b, k);
    const A = ss.A, B = ss.B;
    const f = function (t, x) {
      return [A[0][0] * x[0] + A[0][1] * x[1] + B[0] * F0,
              A[1][0] * x[0] + A[1][1] * x[1] + B[1] * F0];
    };
    // keep h*|lambda_max| small for accuracy and stability
    const lam = eig2x2(A);
    const lamMax = Math.max(cAbs(lam[0]), cAbs(lam[1]));
    const n = Math.min(200000, Math.max(steps || 2000, Math.ceil(T * lamMax / 0.05)));
    return rk4(f, [0, 0], 0, T, n);
  }

  /** Keep every k-th sample so plots stay light (always keeps the last point). */
  function downsample(arr, maxPoints) {
    if (arr.length <= maxPoints) return arr.slice();
    const step = Math.ceil(arr.length / maxPoints);
    const out = [];
    for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
    if ((arr.length - 1) % step !== 0) out.push(arr[arr.length - 1]);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Module 4: "Guess the sensor"                                        */
  /* ------------------------------------------------------------------ */

  function roundTo(v, digits) { const p = Math.pow(10, digits); return Math.round(v * p) / p; }
  function roundSig(v, sig) {
    if (v === 0) return 0;
    const d = sig - 1 - Math.floor(Math.log10(Math.abs(v)));
    return roundTo(v, d);
  }
  function logUniform(rng, a, b) { return Math.exp(Math.log(a) + rng() * (Math.log(b) - Math.log(a))); }

  /**
   * Pick a hidden sensor at random and produce its noisy response.
   * First order: random K and tau; step response, or (sometimes) a sine at a stated frequency.
   * Second order: random zeta (underdamped, so overshoot is visible) and wn; step response.
   * The time window is a random multiple of the time constant so its length
   * does not give the answer away.
   */
  function randomSensor(rng) {
    const r = rng || Math.random;
    const s = {};
    if (r() < 0.5) {
      s.order = 1;
      s.K = roundTo(0.5 + r() * 4.5, 2);
      s.tau = roundSig(logUniform(r, 0.2, 5), 2);
      s.input = r() < 0.35 ? 'sine' : 'step';
      if (s.input === 'step') {
        s.A = [1, 2, 5][Math.floor(r() * 3)];
        s.tEnd = roundSig(s.tau * (5 + r() * 4), 2);
        s.noiseSigma = 0.015 * s.K * s.A;
      } else {
        s.A = 1;
        const wt = 0.4 + r() * 2.1;                 // keeps phase lag between ~22 and ~68 deg
        s.w = roundSig(wt / s.tau, 2);
        s.fHz = s.w / TWO_PI;
        const period = TWO_PI / s.w;
        s.tEnd = 4 * period;                         // steady state, 4 whole periods
        s.noiseSigma = 0.015 * s.K * s.A * magnitudeRatio(s.w, s.tau);
      }
    } else {
      s.order = 2;
      s.input = 'step';
      s.K = roundTo(0.5 + r() * 2.5, 2);
      s.A = 1;
      s.zeta = roundTo(0.1 + r() * 0.55, 2);
      s.wn = roundSig(logUniform(r, 1, 12), 2);
      s.tEnd = roundSig(plotWindow(s.zeta, s.wn) * (0.8 + r() * 0.5), 2);
      s.noiseSigma = 0.012 * s.K * s.A;
    }
    return s;
  }

  /** Noise-free response of a sensor description (used for the true curve and the guess overlay). */
  function sensorResponse(s, t) {
    if (s.order === 1 && s.input === 'step') return firstOrderStep(t, s.K, s.tau, s.A);
    if (s.order === 1) return firstOrderSine(t, s.K, s.tau, s.A, s.w, false);
    return secondOrderStep(t, s.K, s.zeta, s.wn, s.A);
  }

  /** Input signal of a sensor description. */
  function sensorInput(s, t) {
    if (s.input === 'sine') return s.A * Math.sin(s.w * t);
    return t <= 0 ? 0 : s.A;
  }

  /** Noisy samples the player sees. */
  function sampleSensor(s, n, rng) {
    const r = rng || Math.random;
    const t = linspace(0, s.tEnd, n || 241);
    const y = t.map(function (ti) { return sensorResponse(s, ti) + s.noiseSigma * gaussian(r); });
    const x = t.map(function (ti) { return sensorInput(s, ti); });
    return { t: t, x: x, y: y };
  }

  /**
   * Score one estimated parameter. Full marks (100) within 10% relative error,
   * then a straight line down to 0 points at 50% error.
   */
  function scoreParameter(guess, truth) {
    const relErr = Math.abs(guess - truth) / Math.abs(truth);
    let points;
    if (!isFinite(relErr)) points = 0;
    else if (relErr <= 0.10 + 1e-12) points = 100;
    else points = Math.max(0, 100 * (1 - (relErr - 0.10) / 0.40));
    return { relErr: relErr, points: points };
  }

  return {
    TWO_PI: TWO_PI, RAD2DEG: RAD2DEG, DEG2RAD: DEG2RAD,
    linspace: linspace, logspace: logspace, linearFit: linearFit, interp: interp,
    crossingTime: crossingTime, seededRandom: seededRandom, gaussian: gaussian,
    cAbs: cAbs, downsample: downsample, roundSig: roundSig,
    // module 1
    firstOrderStep: firstOrderStep, firstOrderRamp: firstOrderRamp,
    firstOrderMeasurementError: firstOrderMeasurementError,
    firstOrderSteadyStateError: firstOrderSteadyStateError,
    errorFraction: errorFraction, measureRampLag: measureRampLag,
    // module 2
    magnitudeRatio: magnitudeRatio, phaseRad: phaseRad, phaseDeg: phaseDeg, toDecibel: toDecibel,
    dynamicError: dynamicError, cutoffRad: cutoffRad, cutoffHz: cutoffHz,
    tauMaxForDynamicError: tauMaxForDynamicError, firstOrderSine: firstOrderSine,
    measureSinusoid: measureSinusoid,
    // module 3
    dampingClass: dampingClass, secondOrderStep: secondOrderStep,
    secondOrderStepVelocity: secondOrderStepVelocity, quadraticRoots: quadraticRoots,
    secondOrderPoles: secondOrderPoles, secondOrderFormulas: secondOrderFormulas,
    zetaFromOvershoot: zetaFromOvershoot, settlingHorizon: settlingHorizon, plotWindow: plotWindow,
    stepMetrics: stepMetrics, secondOrderMetrics: secondOrderMetrics,
    // state space
    msdMatrices: msdMatrices, msdToSecondOrder: msdToSecondOrder, eig2x2: eig2x2,
    msdPoles: msdPoles, maxRootDifference: maxRootDifference, rk4: rk4, simulateMSD: simulateMSD,
    // module 4
    randomSensor: randomSensor, sensorResponse: sensorResponse, sensorInput: sensorInput,
    sampleSensor: sampleSensor, scoreParameter: scoreParameter
  };
});
