/*
 * module3.js — Second-order response and the state-space panel
 *   G(s) = K*wn^2 / (s^2 + 2*zeta*wn*s + wn^2)
 *   Mass-spring-damper: x' = [0 1; -k/m -b/m] x + [0; 1/m] F,  y = [1 0] x
 * Shows: the three damping cases, rise/peak/overshoot/settling read off the
 * curve (with formula values for comparison), poles in the s-plane, live A and B,
 * eigenvalues next to poles, the phase-plane path, and an RK4 simulation.
 */
(function () {
  'use strict';
  const M = DynMath, C = UI.C;
  const REF_COLORS = { 0.2: '#eb6834', 1: '#1baf7a', 2: '#6250d6' };   // fixed categorical slots 2, 3, 7
  const REF_DASH = { 0.2: 'dash', 1: 'dot', 2: 'dashdot' };

  /* ================= Part A: second-order step response ================= */
  const ctl = document.getElementById('m3-controls');
  const zeta = UI.slider(ctl, {
    label: 'Damping ratio ζ', min: 0, max: 2.5, step: 0.01, value: 0.5, unit: '', digits: 2,
    tip: 'Sets the shape of the response. Below 1 it overshoots and rings; 1 is critically damped; above 1 it creeps up slowly.'
  });
  const wn = UI.slider(ctl, {
    label: 'Natural frequency ωn', min: 0.5, max: 50, value: 2, unit: 'rad/s', log: true,
    tip: 'Sets the speed. Every time on the plot scales with 1/ωn. Logarithmic slider.'
  });
  const K = UI.slider(ctl, {
    label: 'Static sensitivity K', min: 0.1, max: 5, step: 0.01, value: 1, unit: 'out/in', digits: 2,
    tip: 'Final output for a unit step input. It scales the curve but changes none of the metrics.'
  });
  const riseDef = UI.segmented(ctl, {
    label: 'Rise-time definition', value: '10-90',
    options: [{ value: '10-90', label: '10% → 90%' }, { value: '0-100', label: '0% → 100%' }],
    tip: '10–90% works for every damping case. 0–100% (first time the curve reaches the final value) only exists for underdamped responses.'
  });
  const band = UI.segmented(ctl, {
    label: 'Settling band', value: '0.02',
    options: [{ value: '0.02', label: '±2%' }, { value: '0.05', label: '±5%' }],
    tip: 'Settling time is the last time the response is outside this band around the final value.'
  });
  const compare = UI.checkbox(ctl, {
    label: 'Overlay the three damping cases (ζ = 0.2, 1, 2)', checked: false,
    hint: 'Same ωn and K, so only the damping differs.'
  });

  function computeA() {
    const p = { z: zeta.get(), wn: wn.get(), K: K.get(), riseDef: riseDef.get(), band: parseFloat(band.get()), cmp: compare.get() };
    p.cls = M.dampingClass(p.z);
    p.metrics = M.secondOrderMetrics(p.z, p.wn, { band: p.band, riseDef: p.riseDef });   // read off a dense sampled curve
    p.f = M.secondOrderFormulas(p.z, p.wn, p.band);
    p.poles = M.secondOrderPoles(p.z, p.wn);
    let T = M.plotWindow(p.z, p.wn);
    if (p.metrics.settlingTime) T = Math.max(T, 1.15 * p.metrics.settlingTime);
    if (p.cmp) [0.2, 1, 2].forEach(function (z) { T = Math.max(T, M.plotWindow(z, p.wn)); });
    p.T = T;
    p.t = M.linspace(0, T, 900);
    p.y = p.t.map(function (ti) { return M.secondOrderStep(ti, p.K, p.z, p.wn, 1); });
    return p;
  }

  function readout(label, value, unit, sub, key) {
    return '<div class="readout' + (key ? ' key' : '') + '"><span class="r-label">' + label + '</span>' +
      '<span class="r-value">' + value + (unit ? ' <small>' + unit + '</small>' : '') + '</span>' +
      (sub ? '<span class="r-sub">' + sub + '</span>' : '') + '</div>';
  }

  function drawReadoutsA(p) {
    const m = p.metrics, f = p.f, under = p.z < 1 - 1e-9;
    const clsName = p.cls.charAt(0).toUpperCase() + p.cls.slice(1);
    const clsSub = p.z === 0 ? 'ζ = 0: poles on the imaginary axis' : under ? '0 < ζ < 1: complex poles' :
      p.cls === 'critically damped' ? 'ζ = 1: double real pole' : 'ζ > 1: two real poles';
    let h = readout('Damping case', clsName, '', clsSub, true);
    h += readout('Rise time (' + (p.riseDef === '10-90' ? '10→90%' : '0→100%') + ')', UI.fmt(m.riseTime, 4), m.riseTime === null ? '' : 's',
      p.riseDef === '0-100' ? (under ? 'formula (π − cos⁻¹ζ)/ωd = ' + UI.fmt(f.tr0to100, 4) + ' s' : 'never reaches 100%: use 10→90%')
        : 'read off the curve (no exact formula)');
    h += readout('Peak time t_p', m.peakTime === null ? 'none' : UI.fmt(m.peakTime, 4), m.peakTime === null ? '' : 's',
      under ? 'formula π/ωd = ' + UI.fmt(f.tp, 4) + ' s' : 'no peak: the curve never overshoots');
    h += readout('Maximum overshoot', UI.fix(m.overshootPct, 2), '%',
      under ? 'formula e^(−πζ/√(1−ζ²)) = ' + UI.fix(f.overshootPct, 2) + '%' : 'ζ ≥ 1: no overshoot', true);
    let ts;
    if (p.z === 0) ts = readout('Settling time (±' + (100 * p.band) + '%)', 'never', '', 'undamped: it oscillates forever');
    else ts = readout('Settling time (±' + (100 * p.band) + '%)', UI.fmt(m.settlingTime, 4), 's',
      under ? 'approx. ' + (p.band <= 0.02 ? '4' : '3') + '/(ζωn) = ' + UI.fmt(f.tsApprox, 4) + ' s' : 'read off the curve');
    h += ts;
    h += readout('Damped frequency ωd', under ? UI.fmt(f.wd, 4) : '—', under ? 'rad/s' : '', under ? 'ωn√(1−ζ²); ring period ' + UI.fmt(M.TWO_PI / f.wd, 3) + ' s' : 'no oscillation');
    document.getElementById('m3-readouts').innerHTML = h;
  }

  function drawStep(p) {
    const m = p.metrics, yf = p.K;
    const traces = [], shapes = [], ann = [];
    traces.push({ x: [-0.04 * p.T, 0, 0, p.T], y: [0, 0, yf, yf], name: 'Input × K (unit step)', mode: 'lines',
      line: { color: C.inp, width: 2, dash: 'dash' }, hovertemplate: '%{y:.4g}' });
    if (p.cmp) {
      [0.2, 1, 2].forEach(function (z) {
        traces.push({ x: p.t, y: p.t.map(function (ti) { return M.secondOrderStep(ti, p.K, z, p.wn, 1); }),
          name: 'ζ = ' + z + ' (' + M.dampingClass(z) + ')', mode: 'lines',
          line: { color: REF_COLORS[z], width: 2, dash: REF_DASH[z] }, hovertemplate: '%{y:.4g}' });
      });
    }
    traces.push({ x: [-0.04 * p.T].concat(p.t), y: [0].concat(p.y), name: 'Output y(t), ζ = ' + UI.fix(p.z, 2), mode: 'lines',
      line: { color: C.out, width: 3 }, hovertemplate: '%{y:.4g}' });

    // settling band
    shapes.push({ type: 'rect', x0: 0, x1: p.T, y0: yf * (1 - p.band), y1: yf * (1 + p.band), xref: 'x', yref: 'y',
      fillcolor: 'rgba(42,120,214,0.08)', line: { width: 0 } });
    const mx = [], my = [], mt = [];
    if (m.riseTime !== null) {
      const t1 = m.riseStart, t2 = m.riseEnd;
      const lv1 = p.riseDef === '0-100' ? 0 : 0.1, lv2 = p.riseDef === '0-100' ? 1 : 0.9;
      mx.push(t1, t2); my.push(lv1 * yf, lv2 * yf); mt.push('rise start', 'rise end');
      shapes.push({ type: 'line', x0: t1, x1: t2, y0: lv2 * yf, y1: lv2 * yf, xref: 'x', yref: 'y', line: { color: C.mark, width: 2 } });
      shapes.push({ type: 'line', x0: t1, x1: t1, y0: lv1 * yf, y1: lv2 * yf, xref: 'x', yref: 'y', line: { color: C.mark, width: 1, dash: 'dot' } });
      ann.push({ x: (t1 + t2) / 2, y: lv2 * yf, text: 't_r = ' + UI.fmt(m.riseTime, 3) + ' s', showarrow: false, yanchor: 'top', yshift: -4,
        xanchor: 'left', font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
    }
    if (m.peakTime !== null) {
      mx.push(m.peakTime); my.push(m.peakValue * p.K); mt.push('peak');
      shapes.push({ type: 'line', x0: m.peakTime, x1: m.peakTime, y0: 0, y1: m.peakValue * p.K, xref: 'x', yref: 'y', line: { color: C.mark, width: 1, dash: 'dot' } });
      ann.push({ x: m.peakTime, y: m.peakValue * p.K, text: 'M_p = ' + UI.fix(m.overshootPct, 1) + '% at t_p = ' + UI.fmt(m.peakTime, 3) + ' s',
        showarrow: false, xanchor: 'left', yanchor: 'bottom', xshift: 6, font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
    }
    if (m.settlingTime !== null && p.z > 0) {
      shapes.push({ type: 'line', x0: m.settlingTime, x1: m.settlingTime, y0: 0, y1: 1, xref: 'x', yref: 'paper', line: { color: C.text, width: 1.2, dash: 'dash' } });
      ann.push({ x: m.settlingTime, y: 0.04, yref: 'paper', text: 't_s = ' + UI.fmt(m.settlingTime, 3) + ' s', showarrow: false, xanchor: 'left', xshift: 4,
        font: { size: 12, color: C.text }, bgcolor: 'rgba(255,255,255,.85)' });
    }
    traces.push({ x: mx, y: my, text: mt, mode: 'markers', name: 'Points read off the curve',
      marker: { color: C.mark, size: 9, line: { color: '#fff', width: 2 } }, hovertemplate: '%{text}: %{y:.4g}' });

    const yMax = Math.max(1.12 * yf, (p.z === 0 ? 2.05 : 1 + m.overshootPct / 100) * yf * 1.08, p.cmp ? 1.62 * 1.08 * yf : 0);
    UI.plot('m3-step', traces, UI.layout({
      xaxis: UI.axis('Time t (s)', { range: [-0.04 * p.T, p.T] }),
      yaxis: UI.axis('Output y (output units)', { range: [-0.05 * yf, yMax] }),
      shapes: shapes, annotations: ann
    }));
    document.getElementById('m3-step-caption').textContent =
      'Shaded strip: the ±' + (100 * p.band) + '% settling band around the final value K. Orange points and labels are measured on the curve itself.';
  }

  /** s-plane plot shared by both panels. sets: [{roots, name, symbol, color, size}] */
  function drawSPlane(id, sets, wnValue, zetaValue) {
    const all = [];
    sets.forEach(function (s) { s.roots.forEach(function (r) { all.push(r); }); });
    let R = 0;
    all.forEach(function (r) { R = Math.max(R, Math.abs(r.re), Math.abs(r.im)); });
    R = Math.max(R, wnValue) * 1.25;
    const traces = [], shapes = [];
    // circle of radius wn and the zeta line
    const th = M.linspace(Math.PI / 2, 3 * Math.PI / 2, 120);
    traces.push({ x: th.map(function (a) { return wnValue * Math.cos(a); }), y: th.map(function (a) { return wnValue * Math.sin(a); }),
      mode: 'lines', name: '|s| = ωn', line: { color: C.inp, width: 1, dash: 'dot' }, hoverinfo: 'skip' });
    const cx = sets[0].roots[0];
    if (Math.abs(cx.im) > 1e-12) {
      [1, -1].forEach(function (sg) {
        shapes.push({ type: 'line', x0: 0, y0: 0, x1: cx.re, y1: sg * Math.abs(cx.im), xref: 'x', yref: 'y', line: { color: C.inp, width: 1, dash: 'dash' } });
      });
    }
    sets.forEach(function (s) {
      traces.push({ x: s.roots.map(function (r) { return r.re; }), y: s.roots.map(function (r) { return r.im; }),
        mode: 'markers', name: s.name,
        text: s.roots.map(function (r) { return UI.fix(r.re, 3) + (r.im >= 0 ? ' + j' : ' − j') + UI.fix(Math.abs(r.im), 3); }),
        hovertemplate: '%{text}<extra>' + s.name + '</extra>',
        marker: { symbol: s.symbol, size: s.size, color: s.color, line: { width: s.symbol === 'circle-open' ? 2.5 : 2, color: s.color } } });
    });
    const ann = [];
    if (zetaValue !== undefined && Math.abs(cx.im) > 1e-12) {
      ann.push({ x: cx.re / 2, y: Math.abs(cx.im) / 2, text: 'cos⁻¹ζ = ' + UI.fix(Math.acos(Math.min(1, zetaValue)) * M.RAD2DEG, 1) + '°',
        showarrow: false, xanchor: 'right', xshift: -4, font: { size: 11, color: C.muted } });
    }
    ann.push({ xref: 'paper', yref: 'paper', x: 1, y: 1, text: 'stable side: Re(s) &lt; 0', showarrow: false, xanchor: 'right', yanchor: 'top',
      font: { size: 11, color: C.muted } });
    UI.plot(id, traces, UI.layout({
      hovermode: 'closest',
      xaxis: UI.axis('Real part σ (1/s)', { range: [-R, 0.3 * R], zeroline: true, zerolinecolor: '#7d8a98', zerolinewidth: 1.5 }),
      yaxis: UI.axis('Imaginary part jω (rad/s)', { range: [-R, R], zeroline: true, zerolinecolor: '#7d8a98', zerolinewidth: 1.5, scaleanchor: 'x', scaleratio: 1 }),
      shapes: shapes, annotations: ann
    }));
  }

  function updateA() {
    const p = computeA();
    drawReadoutsA(p);
    drawStep(p);
    drawSPlane('m3-splane', [{ roots: p.poles, name: 'Poles of G(s)', symbol: 'x', color: C.out, size: 14 }], p.wn, p.z);
  }
  const redrawA = UI.throttle(updateA);
  [zeta, wn, K, riseDef, band, compare].forEach(function (c) { c.onChange(redrawA); });
  document.querySelectorAll('[data-zeta]').forEach(function (btn) {
    btn.addEventListener('click', function () { zeta.set(parseFloat(btn.getAttribute('data-zeta'))); });
  });

  /* ================= Part B: state-space panel ================= */
  const sctl = document.getElementById('ss-controls');
  const mS = UI.slider(sctl, { label: 'Mass m', min: 0.1, max: 10, step: 0.1, value: 1, unit: 'kg', digits: 1,
    tip: 'The moving (proof) mass. More mass: slower, lower ωn.' });
  const bS = UI.slider(sctl, { label: 'Damping b', min: 0, max: 20, step: 0.05, value: 2, unit: 'N·s/m', digits: 2,
    tip: 'Viscous damping coefficient: force per unit velocity. Sets ζ together with m and k.' });
  const kS = UI.slider(sctl, { label: 'Spring stiffness k', min: 0.5, max: 50, step: 0.1, value: 4, unit: 'N/m', digits: 1,
    tip: 'Spring constant. Stiffer spring: higher ωn and a smaller static deflection 1/k per newton.' });
  const F0 = UI.slider(sctl, { label: 'Step force F₀', min: 0.1, max: 10, step: 0.1, value: 1, unit: 'N', digits: 1,
    tip: 'Size of the force step applied at t = 0. The mass settles at x = F₀/k.' });

  function mat(rows) {
    return '\\begin{bmatrix}' + rows.map(function (r) { return r.join(' & '); }).join(' \\\\ ') + '\\end{bmatrix}';
  }
  function n4(v) { const s = UI.fmt(v, 4).replace('−', '-'); return s.indexOf('×') >= 0 ? v.toPrecision(3) : s; }

  function updateB() {
    const m = mS.get(), b = bS.get(), k = kS.get(), F = F0.get();
    const ss = M.msdMatrices(m, b, k);
    const eq = M.msdToSecondOrder(m, b, k);
    const eig = M.eig2x2(ss.A);
    const poles = M.msdPoles(m, b, k);

    UI.tex('ss-A', '\\mathbf A=' + mat([['0', '1'], ['-k/m', '-b/m']]) + '=' + mat([[n4(ss.A[0][0]), n4(ss.A[0][1])], [n4(ss.A[1][0]), n4(ss.A[1][1])]]), true);
    UI.tex('ss-B', '\\mathbf B=' + mat([['0'], ['1/m']]) + '=' + mat([[n4(ss.B[0])], [n4(ss.B[1])]]), true);
    UI.tex('ss-C', '\\mathbf C=' + mat([[n4(ss.C[0]), n4(ss.C[1])]]) + ',\\; D = 0', true);
    UI.tex('ss-char', '\\det(\\lambda\\mathbf I-\\mathbf A)=\\lambda^2+\\tfrac{b}{m}\\lambda+\\tfrac{k}{m}=\\lambda^2+' + n4(b / m) + '\\lambda+' + n4(k / m), true);

    const cls = M.dampingClass(eq.zeta);
    let h = '';
    h += readout('Natural frequency ωn = √(k/m)', UI.fmt(eq.wn, 4), 'rad/s', '', true);
    h += readout('Damping ratio ζ = b/(2√(km))', UI.fmt(eq.zeta, 4), '', cls, true);
    h += readout('Static gain 1/k', UI.fmt(eq.K, 4), 'm/N', 'equivalent K of G(s)');
    h += readout('Final displacement F₀/k', UI.fmt(F / k, 4), 'm', 'equilibrium (F₀/k, 0)');
    const eigTxt = Math.abs(eig[0].im) > 1e-12 ? UI.fmt(eig[0].re, 4) + ' ± j' + UI.fmt(Math.abs(eig[0].im), 4) : UI.fmt(eig[0].re, 3) + ', ' + UI.fmt(eig[1].re, 3);
    h += readout('Eigenvalues of A', eigTxt, '', 'units 1/s; same as the poles');
    document.getElementById('ss-readouts').innerHTML = h;

    // eigenvalues vs poles, compared root by root
    const sortFn = function (u, v) { return (v.im - u.im) || (v.re - u.re); };
    const e = eig.slice().sort(sortFn), q = poles.slice().sort(sortFn);
    let rows = '';
    for (let i = 0; i < 2; i++) {
      const d = M.cAbs({ re: e[i].re - q[i].re, im: e[i].im - q[i].im });
      const same = d < 1e-9 * (1 + M.cAbs(q[i]));
      const txt = function (r) { return UI.fix(r.re, 4) + (r.im >= 0 ? ' + j' : ' − j') + UI.fix(Math.abs(r.im), 4); };
      rows += '<tr><td>λ' + (i + 1) + '</td><td class="v">' + txt(e[i]) + '</td><td class="v">' + txt(q[i]) + '</td><td>' +
        d.toExponential(1).replace('-', '−') + '</td><td>' +
        (same ? '<span class="status status-pass"><span aria-hidden="true">✓</span> Equal</span>' : '<span class="status status-fail"><span aria-hidden="true">✗</span> Different</span>') + '</td></tr>';
    }
    document.getElementById('ss-eig').innerHTML = rows;

    drawSPlane('ss-splane', [
      { roots: poles, name: 'Poles of G(s)', symbol: 'x', color: C.out, size: 12 },
      { roots: eig, name: 'Eigenvalues of A', symbol: 'circle-open', color: C.mark, size: 20 }
    ], eq.wn);

    // simulate the state equation with RK4, and the closed form for comparison
    const T = Math.min(M.settlingHorizon(eq.zeta, eq.wn, 0.02), 400);
    const sim = M.simulateMSD(m, b, k, F, T, 3000);
    const keep = 1500;
    const ts = M.downsample(sim.t, keep), x1 = M.downsample(sim.x1, keep), x2 = M.downsample(sim.x2, keep);
    let maxErr = 0;
    const x1cf = ts.map(function (ti, i) {
      const v = M.secondOrderStep(ti, eq.K, eq.zeta, eq.wn, F);
      maxErr = Math.max(maxErr, Math.abs(v - x1[i]));
      return v;
    });

    // phase plane, with arrows showing the direction of travel
    // place arrows evenly along the path length (scaled by each axis' span), not evenly in time
    const sx = (Math.max.apply(null, x1) - Math.min.apply(null, x1)) || 1;
    const sy = (Math.max.apply(null, x2) - Math.min.apply(null, x2)) || 1;
    const arc = [0];
    for (let i = 1; i < ts.length; i++) arc.push(arc[i - 1] + Math.hypot((x1[i] - x1[i - 1]) / sx, (x2[i] - x2[i - 1]) / sy));
    const total = arc[arc.length - 1], arrowIdx = [];
    for (let f = 0.07; f < 0.95; f += 0.11) {
      let i = 1; while (i < arc.length - 1 && arc[i] < f * total) i++;
      arrowIdx.push(i);
    }
    UI.plot('ss-phase', [
      { x: x1, y: x2, mode: 'lines', name: 'Trajectory (RK4)', line: { color: C.out, width: 2.2 }, hovertemplate: 'x₁ = %{x:.4g} m<br>x₂ = %{y:.4g} m/s<extra></extra>' },
      { x: arrowIdx.map(function (i) { return x1[i]; }), y: arrowIdx.map(function (i) { return x2[i]; }), mode: 'markers', showlegend: false, hoverinfo: 'skip',
        marker: { symbol: 'arrow', angleref: 'previous', size: 11, color: C.out } },
      { x: [0], y: [0], mode: 'markers', name: 'Start (0, 0)', marker: { color: C.inp, size: 10, symbol: 'circle-open', line: { width: 2.5 } }, hoverinfo: 'name' },
      { x: [F / k], y: [0], mode: 'markers', name: 'Equilibrium (F₀/k, 0)', marker: { color: C.mark, size: 13, symbol: 'x-thin', line: { width: 3, color: C.mark } }, hoverinfo: 'name' }
    ], UI.layout({
      hovermode: 'closest',
      xaxis: UI.axis('x₁ = displacement (m)', { zeroline: true }),
      yaxis: UI.axis('x₂ = velocity (m/s)', { zeroline: true })
    }));
    document.getElementById('ss-pp-caption').textContent = eq.zeta === 0
      ? 'b = 0 (ζ = 0): a closed ellipse. The mass never stops oscillating around F₀/k.'
      : eq.zeta < 1 - 1e-9
        ? 'Underdamped (ζ = ' + UI.fix(eq.zeta, 3) + '): the path spirals into the equilibrium (F₀/k, 0). Each loop is one oscillation.'
        : 'ζ = ' + UI.fix(eq.zeta, 3) + ' ≥ 1: no spiral. Velocity rises then falls, and the mass creeps into the equilibrium without passing it.';

    const tShow = Math.min(T, M.plotWindow(eq.zeta, eq.wn) * 1.1);
    UI.plot('ss-x1', [
      { x: ts, y: x1cf, mode: 'lines', name: 'Closed form x₁(t) = F₀·step response', line: { color: C.inp, width: 5 }, opacity: 0.45, hovertemplate: '%{y:.5g}' },
      { x: ts, y: x1, mode: 'lines', name: 'RK4 simulation of ẋ = Ax + BF', line: { color: C.out, width: 2 }, hovertemplate: '%{y:.5g}' }
    ], UI.layout({
      xaxis: UI.axis('Time t (s)', { range: [0, tShow] }),
      yaxis: UI.axis('x₁ (m)'),
      shapes: [UI.hline(F / k, C.mark, 0, tShow, 'x')]
    }));
    document.getElementById('ss-x1-caption').textContent =
      'Bonus: our own RK4 solver integrates the state equation using A and B directly. Largest difference from the closed-form solution: ' +
      maxErr.toExponential(2) + ' m. The dotted line is the final value F₀/k.';
  }
  const redrawB = UI.throttle(updateB);
  [mS, bS, kS, F0].forEach(function (c) { c.onChange(redrawB); });
  document.getElementById('ss-v6').addEventListener('click', function () {
    mS.set(1, true); bS.set(2, true); kS.set(4, true); updateB();
  });
  document.getElementById('ss-send').addEventListener('click', function () {
    const eq = M.msdToSecondOrder(mS.get(), bS.get(), kS.get());
    zeta.set(eq.zeta, true); wn.set(eq.wn, true); K.set(1, true);
    updateA();
    document.getElementById('resp-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ================= Predict, then check ================= */
  function setA(z, w) { zeta.set(z, true); if (w !== undefined) wn.set(w, true); updateA(); }
  UI.predictBox(document.getElementById('m3-predict'), [
    {
      prompt: 'A second-order sensor has \\(\\zeta = 0.5\\). By what percentage will its step response overshoot the final value?',
      kind: 'number', unit: '%', tol: { abs: 1 },
      answer: function () { return M.secondOrderMetrics(0.5, wn.get(), { band: 0.02 }).overshootPct; },
      format: function (v) { return UI.fix(v, 1); },
      explain: function (a) { return '\\(M_p = e^{-\\pi(0.5)/\\sqrt{1-0.25}} = e^{-1.814} = ' + UI.fix(a / 100, 3) + '\\), so ' + UI.fix(a, 1) + '%. The value is read off the curve and matches the formula.'; },
      apply: function () { setA(0.5); }
    },
    {
      prompt: 'Keep \\(\\zeta = 0.5\\) and double \\(\\omega_n\\). What happens to the overshoot?',
      kind: 'choice',
      choices: [{ value: 'same', label: 'It stays the same' }, { value: 'up', label: 'It doubles' }, { value: 'down', label: 'It halves' }],
      answer: function () {
        const a = M.secondOrderMetrics(0.5, 2, {}).overshootPct, b = M.secondOrderMetrics(0.5, 4, {}).overshootPct;
        return Math.abs(a - b) < 0.01 ? 'same' : (b > a ? 'up' : 'down');
      },
      explain: function () { return 'Overshoot depends only on \\(\\zeta\\). Doubling \\(\\omega_n\\) makes the response twice as fast (every time halves), but the shape and the overshoot are unchanged.'; },
      apply: function () { setA(0.5, Math.min(50, 2 * wn.get())); }
    },
    {
      prompt: 'With \\(\\zeta = 0.5\\) and \\(\\omega_n = 2\\) rad/s, at what time does the first peak occur?',
      kind: 'number', unit: 's', tol: { rel: 0.03 },
      answer: function () { return M.secondOrderMetrics(0.5, 2, {}).peakTime; },
      format: function (v) { return UI.fix(v, 3); },
      explain: function (a) { return '\\(\\omega_d = 2\\sqrt{1-0.25} = 1.732\\) rad/s, so \\(t_p = \\pi/\\omega_d = ' + UI.fix(a, 3) + '\\) s.'; },
      apply: function () { setA(0.5, 2); }
    },
    {
      prompt: 'Now set \\(\\zeta = 1\\). How much overshoot will the step response have?',
      kind: 'number', unit: '%', tol: { abs: 0.5 },
      answer: function () { return M.secondOrderMetrics(1, wn.get(), {}).overshootPct; },
      format: function (v) { return UI.fix(v, 2); },
      explain: function () { return 'None. With \\(\\zeta = 1\\) both poles sit at \\(-\\omega_n\\) on the real axis, so there is nothing to oscillate with. This is the fastest response that never overshoots.'; },
      apply: function () { setA(1); }
    },
    {
      prompt: 'Which damping ratio gets into the ±2% band (and stays there) soonest, for the same \\(\\omega_n\\)?',
      kind: 'choice',
      choices: [{ value: '0.3', label: 'ζ = 0.3' }, { value: '0.7', label: 'ζ = 0.7' }, { value: '1.5', label: 'ζ = 1.5' }],
      answer: function () {
        const opts = ['0.3', '0.7', '1.5'];
        let best = null, bestT = Infinity;
        opts.forEach(function (z) {
          const ts = M.secondOrderMetrics(parseFloat(z), 2, { band: 0.02 }).settlingTime;
          if (ts < bestT) { bestT = ts; best = z; }
        });
        return best;
      },
      explain: function () {
        const t = ['0.3', '0.7', '1.5'].map(function (z) { return UI.fmt(M.secondOrderMetrics(parseFloat(z), 2, { band: 0.02 }).settlingTime, 3); });
        return 'At \\(\\omega_n = 2\\) rad/s the settling times read off the curves are ' + t[0] + ' s, ' + t[1] + ' s and ' + t[2] + ' s. Too little damping keeps ringing; too much creeps. The quickest settling sits in between: near \\(\\zeta = 0.7\\) for a ±5% band and near 0.8 for ±2%.';
      },
      apply: function () { setA(0.7, 2); }
    },
    {
      prompt: 'In the state-space panel, \\(m = 1\\) kg, \\(b = 2\\) N·s/m, \\(k = 4\\) N/m. What is the imaginary part of the eigenvalues of A (the positive one)?',
      kind: 'number', unit: 'rad/s', tol: { abs: 0.01 },
      answer: function () { return Math.abs(M.eig2x2(M.msdMatrices(1, 2, 4).A)[0].im); },
      format: function (v) { return UI.fix(v, 3); },
      explain: function (a) { return '\\(\\lambda^2 + 2\\lambda + 4 = 0\\) gives \\(\\lambda = -1 \\pm j\\sqrt{3} = -1 \\pm j' + UI.fix(a, 3) + '\\). This equals \\(\\omega_d = \\omega_n\\sqrt{1-\\zeta^2}\\) with \\(\\omega_n = 2\\) and \\(\\zeta = 0.5\\).'; },
      apply: function () { mS.set(1, true); bS.set(2, true); kS.set(4, true); updateB(); }
    }
  ]);

  DynValidation.render(document.getElementById('m3-validation'), [4, 5, 6]);
  updateA();
  updateB();
})();
