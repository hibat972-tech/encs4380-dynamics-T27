/*
 * ui.js
 * Shared user-interface helpers: sliders, toggles, Plotly wrappers,
 * KaTeX rendering, number formatting and the "Predict, then check" box.
 * Every module page uses these, so all four modules behave the same way.
 */
(function (root) {
  'use strict';

  const UI = {};

  /* Series colours (validated categorical order) and chart ink. */
  UI.C = {
    out: '#2a78d6',      // sensor output
    inp: '#6b7480',      // input / ideal value
    mark: '#eb6834',     // markers, guesses, highlights
    third: '#1baf7a',
    grid: '#e3e8ee',
    axis: '#b9c5d1',
    text: '#15273a',
    muted: '#627080'
  };

  /* ------------------------------------------------------------ */
  /* Number formatting                                             */
  /* ------------------------------------------------------------ */

  /** Format to `sig` significant figures, with a real minus sign. */
  UI.fmt = function (v, sig) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '−∞';
    const s = sig || 4;
    let out;
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) out = v.toExponential(s - 1).replace('e', '×10^');
    else out = String(Number(v.toPrecision(s)));
    out = out.replace(/×10\^([+-]?)(\d+)/, function (_, sign, d) {
      return '×10' + (sign === '-' ? '⁻' : '') + d.split('').map(function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]; }).join('');
    });
    return out.replace(/^-/, '−');
  };

  /** Fixed decimals with a real minus sign. */
  UI.fix = function (v, d) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return v.toFixed(d).replace(/^-/, '−');
  };

  /** Complex number as text, e.g. −1 ± j1.732 or −0.27, −3.73. */
  UI.complexPair = function (p, d) {
    const dd = d === undefined ? 3 : d;
    if (Math.abs(p[0].im) > 1e-12) return UI.fix(p[0].re, dd) + ' ± j' + UI.fix(Math.abs(p[0].im), dd);
    return UI.fix(p[0].re, dd) + ', ' + UI.fix(p[1].re, dd);
  };

  /* ------------------------------------------------------------ */
  /* Controls                                                       */
  /* ------------------------------------------------------------ */

  let uid = 0;
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  UI.el = el;

  /**
   * Slider + number box, kept in sync.
   * cfg: {label, min, max, step, value, unit, log, digits, tip, hint}
   * Log sliders move evenly in log10(value), useful for tau and frequency.
   * Returns {get, set, onChange, setEnabled, root}.
   */
  UI.slider = function (container, cfg) {
    const id = 'ctl-' + (++uid);
    const RES = 1000;
    const wrap = el('div', { class: 'ctl' });
    const head = el('div', { class: 'ctl-head' });
    head.appendChild(el('label', { for: id }, cfg.label));
    if (cfg.tip) head.appendChild(el('button', { type: 'button', class: 'tip', 'data-tip': cfg.tip, 'aria-label': 'About this control: ' + cfg.tip }, '?'));
    const valBox = el('span', { class: 'ctl-value' });
    const num = el('input', {
      type: 'number', min: cfg.min, max: cfg.max, step: cfg.numStep || 'any',
      'aria-label': cfg.label + ' value' + (cfg.unit ? ' in ' + cfg.unit : ''), inputmode: 'decimal'
    });
    valBox.appendChild(num);
    valBox.appendChild(el('span', { class: 'unit' }, cfg.unit || ''));
    head.appendChild(valBox);
    const range = el('input', { type: 'range', id: id, min: 0, max: cfg.log ? RES : cfg.max, step: cfg.log ? 1 : (cfg.step || 'any') });
    if (!cfg.log) range.min = cfg.min;
    wrap.appendChild(head);
    wrap.appendChild(range);
    if (cfg.hint) wrap.appendChild(el('div', { class: 'ctl-hint' }, cfg.hint));
    container.appendChild(wrap);

    const lmin = Math.log10(cfg.min), lmax = Math.log10(cfg.max);
    function toPos(v) { return cfg.log ? Math.round((Math.log10(v) - lmin) / (lmax - lmin) * RES) : v; }
    function fromPos(p) {
      if (!cfg.log) return +p;
      const v = Math.pow(10, lmin + (+p / RES) * (lmax - lmin));
      return Number(v.toPrecision(3));
    }
    function show(v) {
      const d = cfg.digits;
      num.value = d === undefined ? String(Number(v.toPrecision(4))) : v.toFixed(d);
    }

    let value = cfg.value;
    const listeners = [];
    function emit() { listeners.forEach(function (fn) { fn(value); }); }

    function set(v, silent) {
      const c = Math.min(cfg.max, Math.max(cfg.min, v));
      value = c;
      range.value = toPos(c);
      show(c);
      if (!silent) emit();
    }

    range.addEventListener('input', function () {
      value = fromPos(range.value);
      if (!cfg.log && cfg.step) value = Number((Math.round(value / cfg.step) * cfg.step).toFixed(10));
      show(value);
      emit();
    });
    num.addEventListener('input', function () {
      const v = parseFloat(num.value);
      if (Number.isFinite(v) && v >= cfg.min && v <= cfg.max) {
        value = v; range.value = toPos(v); emit();
      }
    });
    num.addEventListener('change', function () {
      const v = parseFloat(num.value);
      set(Number.isFinite(v) ? v : value);
    });

    set(cfg.value, true);
    return {
      get: function () { return value; },
      set: set,
      onChange: function (fn) { listeners.push(fn); },
      setEnabled: function (on) { range.disabled = !on; num.disabled = !on; wrap.style.opacity = on ? '' : '.55'; },
      show: function (on) { wrap.hidden = !on; },
      root: wrap
    };
  };

  /** Segmented radio control. cfg: {label, options:[{value,label}], value, tip} */
  UI.segmented = function (container, cfg) {
    const name = 'seg-' + (++uid);
    const wrap = el('div', { class: 'ctl' });
    const head = el('div', { class: 'ctl-head' });
    head.appendChild(el('span', { class: 'ctl-label', id: name + '-l' }, cfg.label));
    if (cfg.tip) head.appendChild(el('button', { type: 'button', class: 'tip', 'data-tip': cfg.tip, 'aria-label': 'About: ' + cfg.tip }, '?'));
    wrap.appendChild(head);
    const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': name + '-l' });
    const inputs = [];
    cfg.options.forEach(function (o, i) {
      const id = name + '-' + i;
      const inp = el('input', { type: 'radio', name: name, id: id, value: o.value });
      if (o.value === cfg.value) inp.checked = true;
      seg.appendChild(inp);
      seg.appendChild(el('label', { for: id }, o.label));
      inputs.push(inp);
    });
    wrap.appendChild(seg);
    container.appendChild(wrap);
    const listeners = [];
    inputs.forEach(function (inp) {
      inp.addEventListener('change', function () { if (inp.checked) listeners.forEach(function (fn) { fn(inp.value); }); });
    });
    return {
      get: function () { const c = inputs.find(function (i) { return i.checked; }); return c ? c.value : null; },
      set: function (v, silent) {
        inputs.forEach(function (i) { i.checked = i.value === v; });
        if (!silent) listeners.forEach(function (fn) { fn(v); });
      },
      onChange: function (fn) { listeners.push(fn); },
      root: wrap
    };
  };

  /** Checkbox. cfg: {label, checked} */
  UI.checkbox = function (container, cfg) {
    const id = 'chk-' + (++uid);
    const wrap = el('div', { class: 'ctl' });
    const lab = el('label', { class: 'check', for: id });
    const inp = el('input', { type: 'checkbox', id: id });
    inp.checked = !!cfg.checked;
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(cfg.label));
    wrap.appendChild(lab);
    if (cfg.hint) wrap.appendChild(el('div', { class: 'ctl-hint' }, cfg.hint));
    container.appendChild(wrap);
    const listeners = [];
    inp.addEventListener('change', function () { listeners.forEach(function (fn) { fn(inp.checked); }); });
    return {
      get: function () { return inp.checked; },
      set: function (v, silent) { inp.checked = !!v; if (!silent) listeners.forEach(function (fn) { fn(inp.checked); }); },
      onChange: function (fn) { listeners.push(fn); },
      root: wrap
    };
  };

  /** Run fn at most once per animation frame (smooth slider dragging). */
  UI.throttle = function (fn) {
    let pending = false;
    return function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; fn(); });
    };
  };

  /** Set the text of a readout element by id. */
  UI.set = function (id, html) {
    const e = document.getElementById(id);
    if (e) e.innerHTML = html;
  };

  /* ------------------------------------------------------------ */
  /* Plotly                                                         */
  /* ------------------------------------------------------------ */

  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  UI.axis = function (title, extra) {
    return Object.assign({
      title: { text: title, font: { size: 12, color: UI.C.muted } },
      gridcolor: UI.C.grid, linecolor: UI.C.axis, zerolinecolor: '#c9d3dd',
      tickfont: { size: 11, color: UI.C.muted }, automargin: true, showline: true, mirror: false
    }, extra || {});
  };

  UI.layout = function (extra) {
    return Object.assign({
      margin: { l: 58, r: 16, t: 14, b: 46 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: '#ffffff',
      font: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', size: 12, color: UI.C.text },
      legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 11.5 }, bgcolor: 'rgba(255,255,255,0)' },
      hovermode: 'x unified',
      hoverlabel: { font: { size: 12 } },
      dragmode: coarse ? false : 'zoom',
      uirevision: 'keep'
    }, extra || {});
  };

  UI.config = {
    responsive: true,
    displayModeBar: coarse ? false : 'hover',   // phones: no toolbar (zoom is off there anyway)
    displaylogo: false,
    scrollZoom: false,
    showSendToCloud: false,        // Plotly 4 shows a "Share chart" (upload to Plotly Cloud) button by default; this site stays offline
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian', 'sendChartToCloud'],
    toImageButtonOptions: { format: 'png', scale: 2 }
  };

  UI.plot = function (elOrId, traces, layout) {
    const target = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    return Plotly.react(target, traces, layout, UI.config);
  };

  /** Vertical/horizontal dashed guide line shapes. */
  UI.vline = function (x, color, y0, y1, yref) {
    return { type: 'line', x0: x, x1: x, y0: y0 === undefined ? 0 : y0, y1: y1 === undefined ? 1 : y1,
      yref: yref || 'paper', line: { color: color || UI.C.mark, width: 1.2, dash: 'dot' } };
  };
  UI.hline = function (y, color, x0, x1, xref) {
    return { type: 'line', y0: y, y1: y, x0: x0 === undefined ? 0 : x0, x1: x1 === undefined ? 1 : x1,
      xref: xref || 'paper', line: { color: color || UI.C.mark, width: 1.2, dash: 'dot' } };
  };

  /* ------------------------------------------------------------ */
  /* Maths display (KaTeX)                                          */
  /* ------------------------------------------------------------ */

  UI.tex = function (elOrId, latex, display) {
    const target = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!target) return;
    if (root.katex) root.katex.render(latex, target, { displayMode: !!display, throwOnError: false });
    else target.textContent = latex;
  };

  UI.renderMath = function (scope) {
    if (root.renderMathInElement) {
      root.renderMathInElement(scope || document.body, {
        delimiters: [
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }
  };

  /* ------------------------------------------------------------ */
  /* "Predict, then check"                                          */
  /* ------------------------------------------------------------ */

  /**
   * questions: [{
   *   prompt: HTML (may contain \( \) maths),
   *   kind: 'number' | 'choice',
   *   unit, choices: [{value, label}],
   *   answer: function returning the model's answer (computed with DynMath),
   *   tol: {rel} or {abs}   (number questions),
   *   format: function(value) -> text,
   *   explain: function(answer) -> HTML,
   *   apply: function() that moves the sliders to this case
   * }]
   */
  UI.predictBox = function (container, questions) {
    let index = 0;
    const box = el('section', { class: 'predict', 'aria-labelledby': 'predict-title-' + (++uid) });
    const titleId = 'predict-title-' + uid;
    box.innerHTML =
      '<div class="predict-head"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#c4621f" stroke-width="2"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.2.9-1.2 1.8v.6" fill="none" stroke="#c4621f" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.2" fill="#c4621f"/></svg>' +
      '<h2 id="' + titleId + '">Predict, then check</h2><span class="predict-count"></span></div>' +
      '<p class="ctl-hint" style="margin:0 0 8px">Write down what you expect <em>before</em> you touch the sliders. Then check it: the page computes the answer and moves the sliders so you can see it on the plot.</p>' +
      '<div class="predict-q"></div><div class="predict-body"></div>' +
      '<div class="btn-row" style="margin-top:10px"><button type="button" class="btn p-check">Check my prediction</button>' +
      '<button type="button" class="btn secondary p-next">Next question</button></div>' +
      '<div class="predict-msg" role="alert"></div>' +
      '<div class="predict-result" hidden aria-live="polite"></div>';
    container.appendChild(box);

    const qEl = box.querySelector('.predict-q');
    const bodyEl = box.querySelector('.predict-body');
    const countEl = box.querySelector('.predict-count');
    const resEl = box.querySelector('.predict-result');
    const msgEl = box.querySelector('.predict-msg');
    const checkBtn = box.querySelector('.p-check');

    function show() {
      const q = questions[index];
      countEl.textContent = 'Question ' + (index + 1) + ' of ' + questions.length;
      qEl.innerHTML = q.prompt;
      msgEl.textContent = '';
      resEl.hidden = true;
      checkBtn.disabled = false;
      if (q.kind === 'choice') {
        const name = 'pc-' + (++uid);
        bodyEl.innerHTML = '<div class="predict-choices">' + q.choices.map(function (c, i) {
          return '<label><input type="radio" name="' + name + '" value="' + c.value + '" id="' + name + i + '"> <span>' + c.label + '</span></label>';
        }).join('') + '</div>';
      } else {
        const id = 'pn-' + (++uid);
        bodyEl.innerHTML = '<div class="predict-input"><label for="' + id + '">My prediction:</label>' +
          '<input type="number" step="any" id="' + id + '" inputmode="decimal"> <span class="unit">' + (q.unit || '') + '</span></div>';
      }
      UI.renderMath(box);
    }

    checkBtn.addEventListener('click', function () {
      const q = questions[index];
      const ans = q.answer();
      let verdict, guessText;
      if (q.kind === 'choice') {
        const sel = bodyEl.querySelector('input:checked');
        if (!sel) { msgEl.textContent = 'Pick one answer first.'; return; }
        const chosen = q.choices.find(function (c) { return c.value === sel.value; });
        const correct = q.choices.find(function (c) { return c.value === ans; });
        verdict = sel.value === ans;
        guessText = 'You picked: <strong>' + chosen.label + '</strong>. The model says: <strong>' + correct.label + '</strong>.';
      } else {
        const v = parseFloat(bodyEl.querySelector('input').value);
        if (!Number.isFinite(v)) { msgEl.textContent = 'Type a number first, then check it.'; return; }
        const tol = q.tol && q.tol.abs !== undefined ? q.tol.abs : Math.abs(ans) * (q.tol ? q.tol.rel : 0.03);
        verdict = Math.abs(v - ans) <= tol;
        const f = q.format || function (x) { return UI.fmt(x, 4); };
        guessText = 'Your prediction: <strong>' + f(v) + ' ' + (q.unit || '') + '</strong>. The model gives: <strong>' +
          f(ans) + ' ' + (q.unit || '') + '</strong> (accepted within ± ' + f(tol) + ').';
      }
      msgEl.textContent = '';
      resEl.innerHTML =
        (verdict ? '<span class="status status-pass"><span aria-hidden="true">✓</span> Good prediction</span>'
                 : '<span class="status status-fail"><span aria-hidden="true">✗</span> Not quite</span>') +
        '<p style="margin:8px 0 6px">' + guessText + '</p>' +
        '<p style="margin:0">' + q.explain(ans) + '</p>' +
        (q.apply ? '<p class="ctl-hint" style="margin:6px 0 0">The sliders now show this case. Look at the plot to confirm it.</p>' : '');
      resEl.hidden = false;
      if (q.apply) q.apply();
      UI.renderMath(resEl);
    });

    box.querySelector('.p-next').addEventListener('click', function () {
      index = (index + 1) % questions.length;
      show();
    });

    show();
    return box;
  };

  /* ------------------------------------------------------------ */
  /* Footer: link to the source repository when served from GitHub Pages */
  /* ------------------------------------------------------------ */

  UI.footer = function () {
    const slot = document.getElementById('repo-link');
    if (!slot) return;
    const host = location.hostname;
    const m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (m) {
      const seg = location.pathname.split('/').filter(Boolean)[0];
      const repo = seg && !/\.html$/.test(seg) ? seg : host;
      slot.innerHTML = '<a href="https://github.com/' + m[1] + '/' + repo + '">Source code on GitHub</a>';
    } else {
      slot.textContent = 'Static site: open index.html or deploy with GitHub Pages';
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    UI.renderMath(document.body);
    UI.footer();
    // on narrow screens start with the theory folded, so the plots are near the top
    if (window.innerWidth < 700) document.querySelectorAll('details.theory[open]').forEach(function (d) { d.open = false; });
  });

  root.UI = UI;
})(typeof self !== 'undefined' ? self : this);
