/*
 * p4.js — P4: tuning challenge.
 * The hidden plant comes from PIDSim.randomPlant (the Homework 1 Module 4 model).
 * PIDSim.makeChallenge searches for a reference controller first, so the
 * specification is known to be achievable. The plant parameters are kept in this
 * closure and are not written into the page until the player reveals them.
 */
(function () {
  'use strict';
  const P = PIDSim, M = DynMath, C = UI.C;
  const $ = function (id) { return document.getElementById(id); };
  const STORE = 'dct-p4-session';
  const DEFAULT_GAINS = { Kp: 1, Ki: 0, Kd: 0 };

  let challenge = null, roundNo = 0, best = 0, revealed = false, ended = false;
  let session = { rounds: 0, total: 0, full: 0 };
  try { const s = JSON.parse(sessionStorage.getItem(STORE)); if (s && typeof s.rounds === 'number') session = s; } catch (e) { /* storage unavailable */ }

  /* ---------------- controls ---------------- */
  const gains = CUI.gainControls($('p4-gains'), {
    Kp: { max: P.GAIN_LIMITS.Kp, step: P.GAIN_STEPS.Kp, value: DEFAULT_GAINS.Kp },
    Ki: { max: P.GAIN_LIMITS.Ki, step: P.GAIN_STEPS.Ki, value: DEFAULT_GAINS.Ki },
    Kd: { max: P.GAIN_LIMITS.Kd, step: P.GAIN_STEPS.Kd, value: DEFAULT_GAINS.Kd }
  });
  const tools = UI.checkbox($('p4-tools'), { label: 'Show the open-loop step test (u = 1)', checked: false,
    hint: 'Use it to estimate K and τ, as in Homework 1, Module 4.' });

  /* ---------------- helpers ---------------- */
  function cfgOf(g) { return { plant: challenge.plant, gains: g || gains.get(), r: 1 }; }

  function statusCell(pass) {
    return pass ? '<span class="status status-pass"><span aria-hidden="true">✓</span> PASS</span>'
      : '<span class="status status-fail"><span aria-hidden="true">✗</span> FAIL</span>';
  }

  function drawOpenLoop() {
    $('p4-ol-card').hidden = !tools.get();
    if (!tools.get()) return;
    const cfg = { plant: challenge.plant, gains: { Kp: 0, Ki: 0, Kd: 0 }, r: 1, openLoop: true, uOpen: 1 };
    const T = 8 * P.timeScale(cfg);
    const s = P.simulate(cfg, T);
    UI.plot('p4-ol', [
      { x: s.t, y: s.y, name: 'Output y(t) for u = 1', mode: 'lines', line: { color: C.out, width: 3 }, hovertemplate: '%{y:.4g}' }
    ], UI.layout({
      margin: { l: 62, r: 16, t: 40, b: 46 },
      xaxis: UI.axis('Time t (s)', { range: [0, T] }), yaxis: UI.axis('Output y', { rangemode: 'tozero' }),
      uirevision: String(roundNo)
    }));
  }

  function updateSession() {
    const avg = session.rounds ? session.total / session.rounds : null;
    UI.set('p4-session',
      '<div><span class="r-label">Current round</span><span class="r-value">' + roundNo + '</span></div>' +
      '<div><span class="r-label">Best score this round</span><span class="r-value">' + best + '</span></div>' +
      '<div><span class="r-label">Rounds finished</span><span class="r-value">' + session.rounds + '</span></div>' +
      '<div><span class="r-label">Average best score</span><span class="r-value">' + (avg === null ? '—' : UI.fix(avg, 1)) + '</span></div>' +
      '<div><span class="r-label">Rounds with 100</span><span class="r-value">' + session.full + '</span></div>');
  }

  function finishRound() {
    if (ended || !challenge) return;
    ended = true;
    session.rounds += 1; session.total += best; if (best >= 100) session.full += 1;
    try { sessionStorage.setItem(STORE, JSON.stringify(session)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------------- evaluate and draw ---------------- */
  function update() {
    if (!challenge) return;
    const spec = challenge.spec;
    const cfg = cfgOf();
    const shapes = [{ type: 'line', xref: 'x', x0: spec.settlingMax, x1: spec.settlingMax, yref: 'paper', y0: 0, y1: 1, line: { color: C.third, width: 1.6, dash: 'dot' } },
      { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 1 + spec.overshootMaxPct / 100, y1: 1 + spec.overshootMaxPct / 100, line: { color: C.mark, width: 1.6, dash: 'dot' } }];
    const ann = [{ x: spec.settlingMax, yref: 'paper', y: 0.02, text: 'settling limit', showarrow: false, xanchor: 'left', xshift: 4, font: { size: 11.5, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' },
      { xref: 'paper', x: 1, y: 1 + spec.overshootMaxPct / 100, text: 'overshoot limit', showarrow: false, xanchor: 'right', yanchor: 'bottom', font: { size: 11.5, color: C.text } }];
    const a = CUI.render(cfg, { ids: { status: 'p4-status', resp: 'p4-resp', ctrl: 'p4-ctrl' }, respShapes: shapes, respAnnotations: ann,
      minPlot: 1.8 * spec.settlingMax });
    if (!a) return;
    const m = a.metrics;
    const ev = P.evaluateSpec(m, spec);

    const fin = m.status !== 'diverged' && m.status !== 'no-response';
    const cells = ev.checks.map(function (ch) {
      let val;
      if (ch.value === null) val = fin && ch.key === 'overshoot' ? '—' : (m.status === 'no-response' ? 'no response' : (m.status === 'diverged' ? 'unstable' : 'does not settle'));
      else val = UI.fix(ch.value, ch.key === 'settling' ? 2 : (ch.value < 10 ? 2 : 1)) + ' ' + ch.unit;
      const lim = (ch.key === 'ess' ? '≈ 0 (≤ ' : '≤ ') + UI.fmt(ch.limit, 3) + ' ' + ch.unit + (ch.key === 'ess' ? ')' : '');
      return '<tr><th scope="row">' + ch.label + '</th><td>' + lim + '</td><td class="v">' + val + '</td><td>' + statusCell(ch.pass) + '</td></tr>';
    }).join('');
    UI.set('p4-spec', cells);
    $('p4-score').textContent = String(ev.score);
    if (!ended) best = Math.max(best, ev.score);       // after the round has ended (reveal) the score no longer counts
    UI.set('p4-verdict', ev.allPass
      ? '<div class="note-box good" role="status"><strong>All three requirements pass: 100 / 100.</strong> Press “New challenge” for another plant.</div>'
      : '<div class="note-box" role="status">' + ev.checks.filter(function (c) { return !c.pass; }).map(function (c) { return c.label; }).join(', ') + ' still failing.</div>');
    updateSession();
    drawOpenLoop();
  }
  const redraw = UI.throttle(update);
  gains.onChange(redraw);
  tools.onChange(redraw);

  /* ---------------- rounds ---------------- */
  function newChallenge() {
    finishRound();
    challenge = P.makeChallenge();
    roundNo = session.rounds + 1;
    best = 0; revealed = false; ended = false;
    $('p4-reveal-card').hidden = true;
    $('p4-reveal').disabled = false;
    gains.set(DEFAULT_GAINS);
    $('p4-id').textContent = 'Challenge ' + roundNo + ' · hidden plant · overshoot ≤ ' + challenge.spec.overshootMaxPct + '%, settling ≤ ' + UI.fmt(challenge.spec.settlingMax, 3) + ' s, steady-state error ≈ 0';
    update();
  }
  $('p4-new').addEventListener('click', newChallenge);
  $('p4-reset').addEventListener('click', function () { gains.set(DEFAULT_GAINS); update(); });
  $('p4-reveal').addEventListener('click', function () {
    if (revealed) return;
    revealed = true;
    $('p4-reveal').disabled = true;
    finishRound();
    const p = challenge.plant, g = challenge.reference.gains;
    const body = p.type === 'first'
      ? 'First-order plant: K = <strong>' + UI.fmt(p.K, 3) + '</strong>, τ = <strong>' + UI.fmt(p.tau, 3) + '</strong> s.'
      : 'Second-order plant: K = <strong>' + UI.fmt(p.K, 3) + '</strong>, ζ = <strong>' + UI.fmt(p.zeta, 3) + '</strong>, ωn = <strong>' + UI.fmt(p.wn, 3) + '</strong> rad/s.';
    $('p4-reveal-body').innerHTML = '<p>' + body + '</p><p>A controller that meets the specification: Kp = <strong>' + UI.fmt(g.Kp, 3) + '</strong>, Ki = <strong>' + UI.fmt(g.Ki, 3) +
      '</strong>, Kd = <strong>' + UI.fmt(g.Kd, 3) + '</strong> (found by the page’s own search; others exist). Press “Reset gains” and type them in to see it pass.</p>';
    $('p4-reveal-card').hidden = false;
    updateSession();
  });

  /* ---------------- Predict, then check ---------------- */
  // Answers use the hidden plant of the current challenge, so each check is about the plant you are tuning.
  function mx(g) { return P.analyze({ plant: challenge.plant, gains: g, r: 1 }).metrics; }
  CUI.predict($('p4-predict'), [
    {
      prompt: 'Before tuning: which term of the controller is the one that can drive the steady-state error of <em>this</em> plant to zero?',
      kind: 'choice',
      choices: [{ value: 'P', label: 'Proportional (Kp)' }, { value: 'I', label: 'Integral (Ki)' }, { value: 'D', label: 'Derivative (Kd)' }],
      answer: function () {
        const p = Math.abs(mx({ Kp: 8, Ki: 0, Kd: 0 }).essPct), i = Math.abs(mx({ Kp: 2, Ki: 1, Kd: 0 }).essPct), d = Math.abs(mx({ Kp: 2, Ki: 0, Kd: 1 }).essPct);
        return (i < 0.5 && p > 0.5 && d > 0.5) ? 'I' : (p <= 0.5 ? 'P' : 'D');
      },
      explain: function () { return 'Only the integral term keeps changing u as long as any error is left, so the loop can only rest where the error is zero. With P alone the output settles where Kp·e is just enough to hold it, which needs e ≠ 0. D reacts to motion, so it is zero at rest. (This was checked on the hidden plant.)'; }
    },
    {
      prompt: 'Take Kp = 2, Ki = 1, Kd = 0 on the hidden plant. You double the integral gain to Ki = 2. What happens to the overshoot?',
      kind: 'choice',
      choices: [{ value: 'up', label: 'It rises' }, { value: 'down', label: 'It falls' }, { value: 'same', label: 'It stays about the same' }],
      answer: function () {
        const a = mx({ Kp: 2, Ki: 1, Kd: 0 }).overshootPct, b = mx({ Kp: 2, Ki: 2, Kd: 0 }).overshootPct;
        return b > a + 1 ? 'up' : (b < a - 1 ? 'down' : 'same');
      },
      explain: function () {
        const a = mx({ Kp: 2, Ki: 1, Kd: 0 }), b = mx({ Kp: 2, Ki: 2, Kd: 0 });
        return 'On this plant the overshoot goes from ' + UI.fix(a.overshootPct, 1) + '% to ' + UI.fix(b.overshootPct, 1) + '%. A larger Ki accumulates error faster and still pushes when the output has arrived. It also removes the steady-state error faster.';
      },
      apply: function () { gains.set({ Kp: 2, Ki: 2, Kd: 0 }); update(); }
    },
    {
      prompt: 'With Kp = 2 and Ki = 1 fixed, you add derivative action, Kd = 0.5. Does the overshoot of <em>this</em> plant go down?',
      kind: 'choice',
      choices: [{ value: 'down', label: 'Yes, it goes down' }, { value: 'up', label: 'No, it goes up' }, { value: 'same', label: 'It does not change' }],
      answer: function () {
        const a = mx({ Kp: 2, Ki: 1, Kd: 0 }).overshootPct, b = mx({ Kp: 2, Ki: 1, Kd: 0.5 }).overshootPct;
        return b < a - 0.5 ? 'down' : (b > a + 0.5 ? 'up' : 'same');
      },
      explain: function () {
        const a = mx({ Kp: 2, Ki: 1, Kd: 0 }), b = mx({ Kp: 2, Ki: 1, Kd: 0.5 });
        return 'Overshoot goes from ' + UI.fix(a.overshootPct, 1) + '% to ' + UI.fix(b.overshootPct, 1) + '%. D adds damping only to a plant that rings on its own. On a smooth first-order plant it behaves like extra inertia and can make things worse. If D helped here, the plant rings.';
      },
      apply: function () { gains.set({ Kp: 2, Ki: 1, Kd: 0.5 }); update(); }
    }
  ]);

  newChallenge();
})();
