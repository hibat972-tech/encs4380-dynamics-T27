/*
 * mysystem.js — "My System": the Micromouse drive motor as the project's first-order plant.
 *
 * Nothing on this page is a made-up measurement. K and tau are either typed in or
 * computed from a step-test log that the user pastes (PIDSim.identifyFirstOrder).
 * Until the user says the numbers are measured (or from a datasheet) and gives the
 * source, the page labels them "illustrative placeholder" everywhere.
 */
(function () {
  'use strict';
  const P = PIDSim, M = DynMath, C = UI.C;
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };

  let state = CUI.store.load();
  state = Object.assign({ osMax: 10, essMax: 1, override: false, notes: '', conditions: '', todo: {} }, state);
  let fit = null, dataSynthetic = false;
  const DEF_SRC = CUI.DEFAULT_MOTOR.source;
  let lastStatus = state.status;
  /** A real source is anything the group wrote: empty text and the built-in placeholder sentence do not count. */
  function hasSource() { const s = state.source.trim(); return s.length > 0 && s !== DEF_SRC; }

  const code = CUI.codeBox($('ms-code'), { title: 'Arduino code for the speed loop', filename: 'micromouse_speed_pid' });

  /* ---------------- fields <-> state ---------------- */
  const FIELDS = {
    K: 'ms-K', tau: 'ms-tau', units: 'ms-units', status: 'ms-status', source: 'ms-source',
    setpoint: 'ms-sp', tsTarget: 'ms-ts', osMax: 'ms-os', zeta: 'ms-zeta', Kp: 'ms-Kp', Ki: 'ms-Ki', notes: 'ms-notes'
  };
  function writeFields() {
    Object.keys(FIELDS).forEach(function (k) { $(FIELDS[k]).value = state[k] === null || state[k] === undefined ? '' : state[k]; });
    $('ms-Ts').value = Number((state.Ts * 1000).toPrecision(6));
    $('ms-override').checked = !!state.override;
  }
  function readFields() {
    ['K', 'tau', 'setpoint', 'tsTarget', 'osMax', 'zeta'].forEach(function (k) { state[k] = parseFloat($(FIELDS[k]).value); });
    state.units = $('ms-units').value.trim() || 'units';
    state.status = $('ms-status').value;
    if (state.status !== lastStatus) {
      // the placeholder sentence must not be left behind as the "source" of real numbers, and vice versa
      if (state.status !== 'illustrative' && $('ms-source').value === DEF_SRC) $('ms-source').value = '';
      if (state.status === 'illustrative' && !$('ms-source').value.trim()) $('ms-source').value = DEF_SRC;
      lastStatus = state.status;
    }
    state.source = $('ms-source').value;
    state.notes = $('ms-notes').value;
    state.Ts = parseFloat($('ms-Ts').value) / 1000;
    state.override = $('ms-override').checked;
    if (state.override) { state.Kp = parseFloat($('ms-Kp').value); state.Ki = parseFloat($('ms-Ki').value); }
  }
  function badMsg(t) { return '<div class="note-box bad">' + t + '</div>'; }

  function validate() {
    const bad = [];
    if (!(state.K > 0)) bad.push('K must be a positive number.');
    if (!(state.tau > 0)) bad.push('τ must be a positive number.');
    if (!(state.setpoint > 0)) bad.push('The cruising speed must be a positive number.');
    if (!(state.tsTarget > 0)) bad.push('The settling-time target must be a positive number.');
    if (!(state.zeta > 0)) bad.push('ζ must be a positive number.');
    if (!(state.Ts > 0)) bad.push('The sampling time must be a positive number.');
    if (!(state.osMax >= 0)) bad.push('The overshoot limit must be zero or more.');
    if (state.override && !(state.Kp >= 0 && state.Ki >= 0)) bad.push('Kp and Ki must be zero or more.');
    return bad;
  }

  /* ---------------- banner, source, to-do ---------------- */
  function banner() {
    let html = '';
    if (state.status === 'illustrative') {
      html = '<div class="big-warning" role="status"><h3>Illustrative numbers: not measured</h3><p style="margin:0">K and τ below are placeholders so that every page can be tested. They did <strong>not</strong> come from our robot. ' +
        'Run the PWM step test (section 1), enter or paste the real data, choose “Measured by our group” and write the source. Until then, do not present this page as our motor.</p></div>';
    } else if (!hasSource()) {
      html = '<div class="big-warning" role="status"><h3>Source missing</h3><p style="margin:0">The assignment asks for the source of K and τ. Describe the test (or cite the datasheet) in the “Source” box.</p></div>';
    } else {
      html = '<div class="note-box good" role="status"><strong>' + (state.status === 'measured' ? 'Measured values' : 'Datasheet values') + ':</strong> ' + esc(state.source.split('\n')[0]) + '</div>';
    }
    $('ms-banner').innerHTML = html;
    $('ms-source-msg').innerHTML = state.status !== 'illustrative' && !hasSource() ? '<div class="note-box warn">Describe how K and τ were obtained.</div>' : '';
  }

  const TODO = [
    { key: 'real', label: 'K and τ from a real PWM step test of our motor (or a cited datasheet)', auto: function () { return state.status !== 'illustrative'; } },
    { key: 'src', label: 'The source and test conditions are written in section 1', auto: function () { return state.status !== 'illustrative' && hasSource() && state.source.trim().length > 10; } },
    { key: 'spec', label: 'We reviewed the specification and wrote our own reasoning in the notes box (section 2)' },
    { key: 'hw', label: 'The gains were tried on the real robot (needed only for the hardware bonus)' },
    { key: 'readme', label: 'Final gains, screenshots and the generated code are in the README' }
  ];
  function todo() {
    $('ms-todo').innerHTML = TODO.map(function (t, i) {
      const auto = t.auto ? t.auto() : null;
      const checked = auto !== null ? auto : !!state.todo[t.key];
      return '<li><input type="checkbox" id="td-' + i + '" ' + (checked ? 'checked ' : '') + (auto !== null ? 'disabled ' : '') + 'style="margin-top:4px;width:18px;height:18px"><label for="td-' + i + '">' + t.label +
        (auto !== null ? ' <span class="chip ' + (checked ? 'good' : 'warn') + '">' + (checked ? 'done' : 'missing') + '</span>' : '') + '</label></li>';
    }).join('');
    TODO.forEach(function (t, i) {
      if (t.auto) return;
      $('td-' + i).addEventListener('change', function (ev) { state.todo[t.key] = ev.target.checked; CUI.store.save(state); });
    });
  }

  function why() {
    $('ms-why').innerHTML =
      '<li><strong>Settling ≤ ' + UI.fmt(state.tsTarget, 3) + ' s.</strong> The speed loop is the inner loop. Wall-following and turn profiles ask it for new speeds, so it has to respond several times faster than they do, and reach cruising speed quickly on a short straight.</li>' +
      '<li><strong>Overshoot ≤ ' + UI.fmt(state.osMax, 3) + '%.</strong> Speed above the plan means entering a corner too fast, with a risk of slipping or hitting a wall.</li>' +
      '<li><strong>Steady-state error ≈ 0.</strong> Distance and position come from integrating encoder speed. A permanent speed error becomes a growing distance error. This is why we need the I term.</li>' +
      '<li><strong>PWM between 0 and 100%.</strong> The motor driver cannot output more than 100% duty. If the design asks for more, the loop saturates and the theory above no longer holds.</li>' +
      '<li><strong>ζ between 0.6 and 0.8</strong> (practical range from the lecture): fast, with little ringing.</li>';
  }

  /* ---------------- step-test tool ---------------- */
  function parseLog(text) {
    const t = [], y = [];
    text.split(/\r?\n/).forEach(function (line) {
      const p = line.trim().split(/[\s,;]+/).filter(Boolean);
      if (p.length < 2) return;
      const a = parseFloat(p[0]), b = parseFloat(p[1]);
      if (Number.isFinite(a) && Number.isFinite(b) && /^[-+\d.]/.test(p[0])) { t.push(a); y.push(b); }
    });
    return { t: t, y: y };
  }

  function computeFit() {
    const log = parseLog($('ms-data').value);
    const dU = parseFloat($('ms-pwm').value);
    const tStepRaw = parseFloat($('ms-tstep').value);
    const box = $('ms-fit-msg');
    $('ms-fit-plot').hidden = true;
    fit = null;
    for (let i = 1; i < log.t.length; i++) if (!(log.t[i] > log.t[i - 1])) { box.innerHTML = badMsg('Time must increase on every line (problem near line ' + (i + 1) + ').'); return; }
    let id;
    try { id = P.identifyFirstOrder(log.t, log.y, dU, Number.isFinite(tStepRaw) ? tStepRaw : null); }
    catch (e) { box.innerHTML = badMsg(esc(e.message)); return; }
    if (!(id.K > 0) || !(id.tau63 > 0)) { box.innerHTML = badMsg('The data does not look like a rising first-order step (K or τ came out non-positive). Check the step size, the sign of the speed and the step time.'); return; }
    fit = { id: id, log: log, dU: dU, tStep: Number.isFinite(tStepRaw) ? tStepRaw : log.t[0] };
    box.innerHTML = '<div class="table-wrap"><table class="spec-table"><thead><tr><th>Quantity</th><th>Value</th><th>How</th></tr></thead><tbody>' +
      '<tr><th scope="row">Start speed y₀</th><td>' + UI.fmt(id.y0, 4) + ' ' + esc(state.units) + '</td><td>mean of the samples before the step</td></tr>' +
      '<tr><th scope="row">Final speed</th><td>' + UI.fmt(id.yFinal, 4) + ' ' + esc(state.units) + '</td><td>mean of the last 10% of samples</td></tr>' +
      '<tr><th scope="row">K = Δy / ΔU</th><td><strong>' + UI.fmt(id.K, 4) + '</strong> ' + esc(state.units) + ' per % PWM</td><td>(' + UI.fmt(id.yFinal, 4) + ' − ' + UI.fmt(id.y0, 4) + ') / ' + UI.fmt(dU, 4) + '</td></tr>' +
      '<tr><th scope="row">τ, 63.2% method</th><td><strong>' + UI.fmt(id.tau63, 4) + '</strong> s</td><td>time for the speed to cover 63.2% of its change</td></tr>' +
      '<tr><th scope="row">τ, log-slope method</th><td>' + (id.tauFit === null ? '—' : '<strong>' + UI.fmt(id.tauFit, 4) + '</strong> s (R² = ' + UI.fix(id.r2, 4) + ')') + '</td><td>−1/slope of ln(1 − y/y_final), 10% to 90% of the rise</td></tr>' +
      '</tbody></table></div>' +
      '<div class="btn-row" style="margin-top:8px"><button type="button" class="btn" id="ms-use63">Use K and τ (63.2% method)</button>' +
      (id.tauFit === null ? '' : '<button type="button" class="btn secondary" id="ms-usefit">Use K and τ (log-slope method)</button>') + '</div>' +
      (dataSynthetic ? '<div class="note-box warn" style="margin-top:8px">This is the synthetic example. Using it does not make the numbers “measured”.</div>' : '');
    $('ms-use63').addEventListener('click', function () { useFit(id.tau63); });
    if (id.tauFit !== null) $('ms-usefit').addEventListener('click', function () { useFit(id.tauFit); });
    // plot data and model
    const tt = M.linspace(0, log.t[log.t.length - 1] - fit.tStep + (log.t[0] - fit.tStep > 0 ? 0 : 0), 300);
    $('ms-fit-plot').hidden = false;
    UI.plot('ms-fit-plot', [
      { x: log.t, y: log.y, name: 'Logged speed', mode: 'markers', marker: { color: '#9aa5b1', size: 5 }, hovertemplate: '%{y:.4g}' },
      { x: tt.map(function (v) { return v + fit.tStep; }), y: tt.map(function (v) { return id.y0 + id.dy * (1 - Math.exp(-v / id.tau63)); }), name: 'First-order model (63.2% τ)', mode: 'lines', line: { color: C.out, width: 3 }, hovertemplate: '%{y:.4g}' }
    ], UI.layout({ margin: { l: 62, r: 16, t: 40, b: 46 }, xaxis: UI.axis('Time (s)'), yaxis: UI.axis('Speed (' + state.units + ')') }));
  }
  function useFit(tau) {
    state.K = fit.id.K; state.tau = tau;
    if (!dataSynthetic) {
      state.status = 'measured';
      if (!hasSource()) state.source = 'PWM step test: ΔU = ' + UI.fmt(fit.dU, 4) + '% from rest, speed in ' + state.units + ', ' + fit.log.t.length + ' samples pasted into the My System page. Add: battery voltage, load, date.';
    }
    writeFields();
    recompute();
  }
  function syntheticExample() {
    const rng = M.seededRandom(3), K = 3.6, tau = 0.095, step = 50;
    const lines = ['time_s,speed'];
    M.linspace(0, 1, 201).forEach(function (t) {
      lines.push(t.toFixed(3) + ',' + (K * step * (1 - Math.exp(-t / tau)) + 0.012 * K * step * M.gaussian(rng)).toFixed(2));
    });
    $('ms-data').value = lines.join('\n'); $('ms-pwm').value = 50; $('ms-tstep').value = 0;
    dataSynthetic = true;
    computeFit();
  }

  /* ---------------- main computation ---------------- */
  function recompute() {
    readFields();
    banner(); why(); todo();
    const errs = validate();
    if (errs.length) {
      $('ms-design-msg').innerHTML = badMsg(errs.join(' '));
      return;
    }
    // transfer function
    UI.tex('ms-tf', 'G(s)=\\dfrac{K}{\\tau s+1}=\\dfrac{' + UI.fmt(state.K, 4) + '}{' + UI.fmt(state.tau, 4) + '\\,s+1}\\ \\ \\dfrac{\\text{' + state.units.replace(/[^\w\/.\- ]/g, '') + '}}{\\%\\ \\text{PWM}}', true);

    // design
    const wn = P.wnFromSettling(state.tsTarget, state.zeta);
    const d = P.designPI(state.K, state.tau, state.zeta, wn);
    const designed = { Kp: Math.max(0, d.Kp), Ki: d.Ki };
    const notes = [];
    if (!state.override) {
      state.Kp = designed.Kp; state.Ki = designed.Ki;
      $('ms-Kp').value = Number(state.Kp.toPrecision(6)); $('ms-Ki').value = Number(state.Ki.toPrecision(6));
      if (d.Kp < 0) notes.push('The target settling time is slower than the plant itself (2ζτωn < 1), so the formula gives Kp < 0. Kp is set to 0 and the loop is a pure I controller; shorten the settling-time target.');
    }
    $('ms-Kp').disabled = !state.override; $('ms-Ki').disabled = !state.override;
    $('ms-design-msg').innerHTML = notes.map(function (n) { return '<div class="note-box warn">' + n + '</div>'; }).join('');

    const th = P.firstOrderLoopTheory(state.K, state.tau, state.Kp, state.Ki, 0);
    const base = { plant: { type: 'first', K: state.K, tau: state.tau }, gains: { Kp: state.Kp, Ki: state.Ki, Kd: 0 }, r: state.setpoint, umin: 0, umax: 100, antiWindup: true };

    // continuous controller: plots and readouts
    const ts = Math.max(state.Ts, 1e-4);
    const a = CUI.render(base, { unit: state.units, ids: { readouts: 'ms-readouts', status: 'ms-status-box', resp: 'ms-resp', ctrl: 'ms-ctrl' } });
    if (!a) return;
    const m = a.metrics;
    // digital controller at Ts (same gains): samples on the response plot, and its own metrics
    const dig = Object.assign({}, base, { mode: 'digital', Ts: ts });
    const da = P.analyze(dig);
    const ds = P.simulate(dig, a.sim.t[a.sim.t.length - 1]);
    if (ds.samples && ds.samples.t.length <= 800) {
      Plotly.addTraces('ms-resp', { x: ds.samples.t, y: ds.samples.ym, name: 'Digital controller, sampled (Ts = ' + UI.fmt(ts * 1000, 3) + ' ms)', mode: 'markers',
        marker: { color: C.third, size: 5, line: { color: '#fff', width: 0.8 } }, hovertemplate: '%{y:.4g}' });
    }

    // unsaturated demand: does the design ever ask for more than 0..100% ?
    const free = P.analyze(Object.assign({}, base, { umin: -Infinity, umax: Infinity }));
    const demandMax = Math.max.apply(null, free.sim.u), demandMin = Math.min.apply(null, free.sim.u);

    UI.set('ms-gains', [
      ['Kp', UI.fmt(state.Kp, 4), '% PWM per ' + esc(state.units)], ['Ki', UI.fmt(state.Ki, 4), '% PWM per (' + esc(state.units) + '·s)'], ['Kd', '0', 'not used'],
      ['ωn', th.wn === null ? '—' : UI.fmt(th.wn, 4) + ' rad/s', 'from the loop equation'], ['ζ', th.zeta === null ? '—' : UI.fix(th.zeta, 3), 'from the loop equation']
    ].map(function (r, i) { return '<div class="readout' + (i < 2 ? ' key' : '') + '"><span class="r-label">' + r[0] + '</span><span class="r-value">' + r[1] + '</span><span class="r-sub">' + r[2] + '</span></div>'; }).join(''));

    const reach = state.K * 100;
    const checks = [
      { name: 'Damping ratio ζ', target: '0.6 ≤ ζ ≤ 0.8', value: th.zeta === null ? '—' : UI.fix(th.zeta, 3), pass: th.zeta !== null && th.zeta >= 0.6 - 1e-9 && th.zeta <= 0.8 + 1e-9 },
      { name: 'PWM command stays within 0 to 100% (unsaturated demand)', target: '0 ≤ u ≤ 100', value: UI.fix(demandMin, 1) + ' … ' + UI.fix(demandMax, 1) + ' %', pass: demandMin >= -1e-9 && demandMax <= 100 + 1e-9 },
      { name: 'Cruising speed reachable at 100% PWM', target: 'r < 0.95·K·100 = ' + UI.fmt(0.95 * reach, 4) + ' ' + esc(state.units), value: 'r = ' + UI.fmt(state.setpoint, 4), pass: state.setpoint < 0.95 * reach },
      { name: 'Overshoot (continuous controller)', target: '≤ ' + UI.fmt(state.osMax, 3) + ' %', value: m.settled ? UI.fix(m.overshootPct, 2) + ' %' : 'does not settle', pass: m.status !== 'diverged' && m.overshootPct <= state.osMax },
      { name: 'Settling time ±2% (continuous controller)', target: '≤ ' + UI.fmt(state.tsTarget, 3) + ' s', value: m.settled ? UI.fix(m.settlingTime, 3) + ' s' : 'never', pass: m.settled && m.settlingTime <= state.tsTarget },
      { name: 'Steady-state error', target: '≈ 0 (≤ ' + state.essMax + ' %)', value: m.settled ? UI.fix(Math.abs(m.essPct), 3) + ' %' : '—', pass: m.settled && Math.abs(m.essPct) <= state.essMax },
      { name: 'Digital version, Ts = ' + UI.fmt(ts * 1000, 3) + ' ms: overshoot and settling', target: 'same limits', value: da.metrics.settled ? UI.fix(da.metrics.overshootPct, 2) + ' %, ' + UI.fix(da.metrics.settlingTime, 3) + ' s' : 'does not settle', pass: da.metrics.settled && da.metrics.overshootPct <= state.osMax && da.metrics.settlingTime <= state.tsTarget * 1.05 }
    ];
    UI.set('ms-checks', checks.map(function (c) {
      return '<tr><th scope="row">' + c.name + '</th><td>' + c.target + '</td><td class="v">' + c.value + '</td><td>' +
        (c.pass ? '<span class="status status-pass"><span aria-hidden="true">✓</span> PASS</span>' : '<span class="status status-fail"><span aria-hidden="true">✗</span> FAIL</span>') + '</td></tr>';
    }).join(''));

    // code
    const oneLine = state.source.replace(/\s+/g, ' ').trim();
    code.set(P.arduinoCode({
      Kp: state.Kp, Ki: state.Ki, Kd: 0, Ts: ts, umin: 0, umax: 100, antiWindup: true, setpoint: state.setpoint, outputUnit: '% PWM',
      header: [
        'Micromouse drive motor, speed loop. Plant: first order, K = ' + UI.fmt(state.K, 5) + ' ' + state.units + ' per % PWM, tau = ' + UI.fmt(state.tau, 5) + ' s',
        'Status of K and tau: ' + (state.status === 'illustrative' ? 'ILLUSTRATIVE PLACEHOLDER, NOT MEASURED' : state.status) + (oneLine ? '. Source: ' + oneLine : ''),
        'Design: PI, zeta = ' + UI.fmt(state.zeta, 3) + ', settling target ' + UI.fmt(state.tsTarget, 3) + ' s, speed step ' + UI.fmt(state.setpoint, 4) + ' ' + state.units
      ],
      readComment: ['Return the wheel speed in ' + state.units + ' (encoder counts per Ts times your calibration).', 'The default below reads an analog pin only so the sketch compiles; replace it with your encoder speed.'],
      writeComment: ['u is the PWM duty in percent (0 to 100). It is mapped to analogWrite 0..255.']
    }));
    CUI.store.save(state);
  }

  /* ---------------- events ---------------- */
  Object.keys(FIELDS).concat(['ms-Ts', 'ms-override']).forEach(function (k) {
    const id = FIELDS[k] || k;
    const e = $(id);
    e.addEventListener('input', recompute);
    e.addEventListener('change', recompute);
  });
  $('ms-compute').addEventListener('click', function () { computeFit(); });
  $('ms-example').addEventListener('click', syntheticExample);
  $('ms-cleardata').addEventListener('click', function () { $('ms-data').value = ''; dataSynthetic = false; fit = null; $('ms-fit-msg').innerHTML = ''; $('ms-fit-plot').hidden = true; });
  $('ms-data').addEventListener('input', function () { dataSynthetic = false; });
  $('ms-reset').addEventListener('click', function () {
    CUI.store.clear();
    state = Object.assign({ osMax: 10, essMax: 1, override: false, notes: '', conditions: '', todo: {} }, CUI.store.load());
    writeFields(); recompute();
  });

  writeFields();
  recompute();
})();
