/*
 * module4.js — "Guess the sensor" challenge
 * 1. A hidden sensor is picked at random: first order (K, tau) or second order (zeta, wn).
 * 2. One noisy response is shown: a step, or for some first-order sensors a sine at a stated frequency.
 * 3. The user estimates the parameters (with optional hints and reading aids).
 * 4. The page reveals the true values, overlays the true and guessed curves, and scores the guess
 *    (full marks within 10%). A running session score is kept.
 */
(function () {
  'use strict';
  const M = DynMath, C = UI.C;
  const STORE = 'dct-m4-session';

  let sensor = null, data = null, revealed = false, hintsShown = 0, guess = null;
  let guide = { y: null, t: null };
  let tune = [];
  let session = { played: 0, total: 0, perfect: 0, last: null };
  try { const s = JSON.parse(sessionStorage.getItem(STORE)); if (s && typeof s.played === 'number') session = s; } catch (e) { /* storage unavailable */ }

  const $ = function (id) { return document.getElementById(id); };

  /* ---------------- parameter descriptions ---------------- */
  function params(s) {
    return s.order === 1
      ? [{ key: 'K', label: 'Static sensitivity K', unit: 'out/in', min: 0.1, max: 10, log: false, step: 0.01 },
         { key: 'tau', label: 'Time constant τ', unit: 's', min: 0.05, max: 20, log: true }]
      : [{ key: 'zeta', label: 'Damping ratio ζ', unit: '', min: 0.02, max: 1.5, log: false, step: 0.01 },
         { key: 'wn', label: 'Natural frequency ωn', unit: 'rad/s', min: 0.2, max: 40, log: true }];
  }

  const HINTS = {
    step1: [
      'K is the static sensitivity: the final (flat) output level divided by the step size A.',
      'τ is the time when the output reaches 63.2% of its final value. Put a guide line at y = 0.632 × (final value) and read where it meets the data.',
      'Noise makes a single point unreliable. Use the log-method view: ln(1 − y/y∞) against t is a straight line with slope −1/τ.'
    ],
    sine1: [
      'Phase lag first. Find an input peak and the next output peak; the time between them is Δt, and |φ| = ω·Δt (in radians).',
      'Then τ = tan|φ| / ω.',
      'Finally the output amplitude Y = K·A·M with M = 1/√(1 + (ωτ)²), so K = (Y/A)·√(1 + (ωτ)²).'
    ],
    step2: [
      'Overshoot depends only on ζ.',
      'Read the peak value and the final value: Mp = (peak − final)/final. Then ζ = −ln Mp / √(π² + ln² Mp).',
      'Read the time of the first peak tp. Then ωd = π/tp and ωn = ωd / √(1 − ζ²).'
    ]
  };
  function hintSet() { return sensor.order === 2 ? HINTS.step2 : (sensor.input === 'sine' ? HINTS.sine1 : HINTS.step1); }

  /* ---------------- round set-up ---------------- */
  function newSensor() {
    sensor = M.randomSensor();
    data = M.sampleSensor(sensor, sensor.input === 'sine' ? 301 : 241);
    revealed = false; hintsShown = 0; guess = null;
    guide = { y: null, t: null };
    ['g-p1', 'g-p2', 'g-gy', 'g-gt', 'g-yinf'].forEach(function (id) { $(id).value = ''; $(id).disabled = false; });
    $('g-msg').textContent = '';
    $('g-hints').innerHTML = '';
    $('g-hint').disabled = false; $('g-hint').textContent = 'Show a hint';
    $('g-submit').disabled = false;
    $('g-result').hidden = true;
    $('g-logcard').hidden = true;
    $('g-logtool').hidden = !(sensor.order === 1 && sensor.input === 'step');

    const p = params(sensor);
    $('g-p1-label').textContent = p[0].label + (p[0].unit ? ' (' + p[0].unit + ')' : '');
    $('g-p2-label').textContent = p[1].label + (p[1].unit ? ' (' + p[1].unit + ')' : '');

    let brief;
    if (sensor.order === 1 && sensor.input === 'step') {
      brief = '<strong>Hidden first-order sensor.</strong> Input: a step of A = ' + sensor.A + ' units at t = 0. Estimate K and τ.';
    } else if (sensor.order === 1) {
      brief = '<strong>Hidden first-order sensor.</strong> Input: x(t) = ' + sensor.A + '·sin(ωt) with ω = ' + UI.fmt(sensor.w, 3) +
        ' rad/s (f = ' + UI.fmt(sensor.fHz, 3) + ' Hz), shown after the transient has died out. Estimate K and τ.';
    } else {
      brief = '<strong>Hidden second-order sensor.</strong> Input: a unit step (A = 1) at t = 0. Estimate ζ and ωn. (K is not scored.)';
    }
    $('g-brief').innerHTML = brief;
    updateScore();
    draw();
  }

  /* ---------------- plotting ---------------- */
  function curve(s, n) {
    const t = M.linspace(0, s.tEnd, n || 600);
    return { t: t, y: t.map(function (ti) { return M.sensorResponse(s, ti); }) };
  }
  function guessSensor() {
    const g = Object.assign({}, sensor);
    const p = params(sensor);
    g[p[0].key] = guess[0]; g[p[1].key] = guess[1];
    return g;
  }

  function draw() {
    const s = sensor, T = s.tEnd, traces = [], shapes = [], ann = [];
    if (s.input === 'sine') {
      const ti = M.linspace(0, T, 600);
      traces.push({ x: ti, y: ti.map(function (v) { return M.sensorInput(s, v); }), name: 'Input x(t)', mode: 'lines',
        line: { color: C.inp, width: 1.8, dash: 'dash' }, hovertemplate: '%{y:.3f}' });
    } else {
      traces.push({ x: [-0.03 * T, 0, 0, T], y: [0, 0, s.A, s.A], name: 'Input x(t): step of ' + s.A, mode: 'lines',
        line: { color: C.inp, width: 1.8, dash: 'dash' }, hovertemplate: '%{y:.3f}' });
    }
    traces.push({ x: data.t, y: data.y, name: 'Measured output (noisy)', mode: 'markers',
      marker: { color: revealed ? '#9aa5b1' : C.out, size: 5, opacity: revealed ? 0.7 : 0.85 }, hovertemplate: '%{y:.3f}' });
    if (revealed) {
      const tc = curve(s), gc = curve(guessSensor());
      traces.push({ x: tc.t, y: tc.y, name: 'True sensor (no noise)', mode: 'lines', line: { color: C.out, width: 3 }, hovertemplate: '%{y:.3f}' });
      traces.push({ x: gc.t, y: gc.y, name: 'Your estimate', mode: 'lines', line: { color: C.mark, width: 2.5, dash: 'dash' }, hovertemplate: '%{y:.3f}' });
    }
    if (guide.y !== null) {
      shapes.push(UI.hline(guide.y, C.mark));
      ann.push({ xref: 'paper', x: 0, y: guide.y, text: 'y = ' + UI.fmt(guide.y, 4), showarrow: false, xanchor: 'left', yanchor: 'bottom',
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
    }
    if (guide.t !== null) {
      shapes.push(UI.vline(guide.t, C.mark));
      ann.push({ x: guide.t, yref: 'paper', y: 1, text: 't = ' + UI.fmt(guide.t, 4) + ' s', showarrow: false, xanchor: 'left', yanchor: 'top', xshift: 4,
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
    }
    UI.plot('g-plot', traces, UI.layout({
      xaxis: UI.axis('Time t (s)', { range: [s.input === 'sine' ? 0 : -0.03 * T, T] }),
      yaxis: UI.axis(s.input === 'sine' ? 'Signal (input and output units)' : 'Output y (output units)'),
      shapes: shapes, annotations: ann,
      uirevision: String(T)        // keep zoom within a round, reset it for a new sensor
    }));
    $('g-plot-title').textContent = s.input === 'sine' ? 'Measured sine response' : 'Measured step response';
    $('g-plot-caption').textContent = revealed
      ? 'Grey dots: the noisy data. Blue: the true sensor. Orange dashed: the sensor your estimate describes.'
      : 'Dots: the sensor output with measurement noise. Dashed: the input. The parameters are hidden until you submit.';
  }

  /* ---------------- reading aids ---------------- */
  function readGuides() {
    const y = parseFloat($('g-gy').value), t = parseFloat($('g-gt').value);
    guide.y = Number.isFinite(y) ? y : null;
    guide.t = Number.isFinite(t) ? t : null;
    draw();
  }
  $('g-gy').addEventListener('input', readGuides);
  $('g-gt').addEventListener('input', readGuides);
  $('g-guide-clear').addEventListener('click', function () { $('g-gy').value = ''; $('g-gt').value = ''; readGuides(); });

  function drawLog() {
    const yinf = parseFloat($('g-yinf').value);
    if (!(yinf > 0)) { $('g-log-caption').textContent = 'Type a positive final value y∞ first.'; $('g-logcard').hidden = false; Plotly.purge('g-logplot'); return; }
    const tPts = [], lnPts = [], tFit = [], lnFit = [];
    data.t.forEach(function (ti, i) {
      const em = 1 - data.y[i] / yinf;
      if (ti > 0 && em > 0) {
        tPts.push(ti); lnPts.push(Math.log(em));
        if (em > 0.15 && em < 0.9) { tFit.push(ti); lnFit.push(Math.log(em)); }   // near E_m = 0 noise dominates ln(E_m)
      }
    });
    $('g-logcard').hidden = false;
    if (tFit.length < 5) {
      $('g-log-caption').textContent = 'Too few usable points: most of the data lies above this y∞. Try a larger final value.';
      Plotly.purge('g-logplot'); return;
    }
    const fit = M.linearFit(tFit, lnFit);
    const t0 = tFit[0], t1 = tFit[tFit.length - 1];
    UI.plot('g-logplot', [
      { x: tPts, y: lnPts, mode: 'markers', name: 'ln Eₘ from the data', marker: { color: C.out, size: 5 }, hovertemplate: '%{y:.3f}' },
      { x: [t0, t1], y: [fit.slope * t0 + fit.intercept, fit.slope * t1 + fit.intercept], mode: 'lines', name: 'Least-squares line (15% < Eₘ < 90%)',
        line: { color: C.mark, width: 2.5 }, hoverinfo: 'skip' }
    ], UI.layout({ xaxis: UI.axis('Time t (s)'), yaxis: UI.axis('ln(1 − y/y∞)') }));
    $('g-log-caption').textContent = 'Fitted slope = ' + UI.fmt(fit.slope, 3) + ' s⁻¹ (R² = ' + UI.fix(fit.r2, 3) +
      '). The slope is −1/τ. If the points bend instead of lying on a line, adjust y∞.';
  }
  $('g-logbtn').addEventListener('click', drawLog);

  /* ---------------- hints ---------------- */
  $('g-hint').addEventListener('click', function () {
    const h = hintSet();
    if (hintsShown < h.length) {
      const li = document.createElement('li');
      li.textContent = h[hintsShown++];
      $('g-hints').appendChild(li);
    }
    if (hintsShown >= h.length) { $('g-hint').disabled = true; $('g-hint').textContent = 'No more hints'; }
  });

  /* ---------------- submit and reveal ---------------- */
  $('g-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (revealed) return;
    const p = params(sensor);
    const v1 = parseFloat($('g-p1').value), v2 = parseFloat($('g-p2').value);
    if (!(v1 > 0) || !(v2 > 0)) { $('g-msg').textContent = 'Enter a positive number for both ' + p[0].label + ' and ' + p[1].label + '.'; return; }
    $('g-msg').textContent = '';
    guess = [v1, v2];
    const truth = [sensor[p[0].key], sensor[p[1].key]];
    const scores = [M.scoreParameter(v1, truth[0]), M.scoreParameter(v2, truth[1])];
    const roundScore = (scores[0].points + scores[1].points) / 2;

    session.played += 1;
    session.total += roundScore;
    session.last = roundScore;
    if (roundScore >= 100 - 1e-9) session.perfect += 1;
    try { sessionStorage.setItem(STORE, JSON.stringify(session)); } catch (e) { /* storage unavailable */ }

    revealed = true;
    $('g-submit').disabled = true;
    $('g-p1').disabled = true; $('g-p2').disabled = true;

    let rows = '';
    for (let i = 0; i < 2; i++) {
      rows += '<tr><th scope="row">' + p[i].label + '</th><td class="v">' + UI.fmt(guess[i], 4) + ' ' + p[i].unit + '</td><td class="v">' +
        UI.fmt(truth[i], 4) + ' ' + p[i].unit + '</td><td>' + UI.fix(100 * scores[i].relErr, 1) + '%</td><td>' +
        (scores[i].points >= 100 ? '<span class="status status-pass"><span aria-hidden="true">✓</span> 100</span>'
          : '<span class="status status-fail"><span aria-hidden="true">✗</span> ' + Math.round(scores[i].points) + '</span>') + '</td></tr>';
    }
    let extra = '';
    if (sensor.order === 2) {
      const f = M.secondOrderFormulas(sensor.zeta, sensor.wn, 0.02);
      extra = 'For reference, the true sensor has K = ' + UI.fmt(sensor.K, 3) + ', overshoot ' + UI.fix(f.overshootPct, 1) +
        '% and peak time ' + UI.fmt(f.tp, 3) + ' s.';
    } else if (sensor.input === 'sine') {
      extra = 'For reference, the true amplitude ratio is M = ' + UI.fix(M.magnitudeRatio(sensor.w, sensor.tau), 3) + ' and the phase lag is ' +
        UI.fix(-M.phaseDeg(sensor.w, sensor.tau), 1) + '°.';
    } else {
      extra = 'For reference, the true final value is K·A = ' + UI.fmt(sensor.K * sensor.A, 4) + ' and the 63.2% level is ' + UI.fmt(0.632 * sensor.K * sensor.A, 4) + '.';
    }
    const verdict = roundScore >= 100 ? 'Full marks: both estimates are within 10%.'
      : roundScore >= 60 ? 'Close. Look at where the orange curve departs from the blue one to see which parameter is off.'
        : 'Some way off. Open a hint, then compare the two curves to see which feature you misread.';
    $('g-result-body').innerHTML =
      '<p style="font-size:1.25rem;margin:0 0 6px"><strong class="num">Round score: ' + Math.round(roundScore) + ' / 100</strong></p>' +
      '<p>' + verdict + '</p>' +
      '<div class="table-wrap"><table class="mtable"><thead><tr><th>Parameter</th><th>Your estimate</th><th>True value</th><th>Error</th><th>Points</th></tr></thead><tbody>' +
      rows + '</tbody></table></div><p class="ctl-hint" style="margin-top:8px">' + extra + '</p>';
    $('g-result').hidden = false;
    buildTune();
    updateScore();
    draw();
    $('g-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  /* live sliders after the reveal: explore how each parameter changes the fit */
  function buildTune() {
    const box = $('g-tune-sliders');
    box.innerHTML = '';
    const p = params(sensor);
    tune = p.map(function (d, i) {
      const s = UI.slider(box, { label: d.label, min: d.min, max: d.max, step: d.step, log: d.log, value: Math.min(d.max, Math.max(d.min, guess[i])), unit: d.unit });
      s.onChange(UI.throttle(function () { guess = [tune[0].get(), tune[1].get()]; draw(); rms(); }));
      return s;
    });
    rms();
  }
  function rms() {
    const tc = curve(sensor, 400), gc = curve(guessSensor(), 400);
    let sq = 0, amp = 0;
    tc.y.forEach(function (v, i) { sq += (v - gc.y[i]) * (v - gc.y[i]); amp = Math.max(amp, Math.abs(v)); });
    $('g-rms').textContent = 'RMS difference between your curve and the true curve: ' + UI.fix(100 * Math.sqrt(sq / tc.y.length) / amp, 2) + '% of the peak output.';
  }

  function updateScore() {
    $('s-round').textContent = String(session.played + (revealed ? 0 : 1));
    $('s-played').textContent = String(session.played);
    $('s-total').textContent = String(Math.round(session.total));
    $('s-avg').textContent = session.played ? UI.fix(session.total / session.played, 1) : '—';
    $('s-perfect').textContent = String(session.perfect);
    $('s-last').textContent = session.last === null ? '—' : String(Math.round(session.last));
  }

  $('g-new').addEventListener('click', newSensor);
  newSensor();
})();
