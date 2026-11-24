/*
 * control-hub.js — the Control landing page: a small live demo and the validation summary.
 * Demo plant: first order, K = 1, tau = 1 s (the example in the assignment).
 */
(function () {
  'use strict';
  const P = PIDSim;
  const PLANT = { type: 'first', K: 1, tau: 1 };

  const box = document.getElementById('hub-controls');
  const left = UI.el('div'), right = UI.el('div');
  box.appendChild(left); box.appendChild(right);
  const kp = UI.slider(left, { label: 'Proportional gain Kp', min: 0, max: 20, step: 0.1, value: 9, unit: '', digits: 1,
    tip: 'With K = 1, a larger Kp makes the loop faster but leaves an error of 1/(1+Kp).' });
  const ki = UI.slider(right, { label: 'Integral gain Ki', min: 0, max: 60, step: 0.5, value: 0, unit: '', digits: 1,
    tip: 'Ki removes the steady-state error. Raise it and watch the overshoot.' });

  function update() {
    CUI.render({ plant: PLANT, gains: { Kp: kp.get(), Ki: ki.get(), Kd: 0 }, r: 1, umin: -50, umax: 50 },
      { ids: { readouts: 'hub-readouts', resp: 'hub-plot' }, unit: '' });
  }
  const redraw = UI.throttle(update);
  kp.onChange(redraw); ki.onChange(redraw);
  update();

  CUI.validationSummary('hub-vsummary');
  CUI.validationSummary('hub-vsummary2');
})();
