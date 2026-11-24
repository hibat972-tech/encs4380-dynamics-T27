# Homework 2: demo plan, instructor questions, equation map and grading audit

ENCS4380 Interfacing Techniques, Birzeit University. Companion to the README, Part A.

---

## 1. Suggested distribution of the modules

Every member must be able to explain **their own module's code and equations**. The engine (`js/pid-sim.js`) is shared, so each owner studies the part their module uses.

| Member | Owns | Must be able to explain | Engine functions to study |
|---|---|---|---|
| 1 | **P1: PID playground** (`p1.html`, `js/p1.js`) | P, I, D effects, the metrics, saturation | `simulate()` (continuous branch), `closedLoopMetrics()`, `firstOrderLoopTheory()` |
| 2 | **P2: slow sensor** (`p2.html`, `js/p2.js`) and **Bonus Z-N** (`zn.html`, `js/zn.js`) | why a lag causes ringing and instability, Routh limit, Ku and Pu | sensor state in `simulate()`, `ultimateFromFrequency()`, `ultimateFromSimulation()`, `zieglerNichols()` |
| 3 | **P3: digital PID** (`p3.html`, `js/p3.js`) | sampling, hold, discrete stability, windup, the Arduino code | digital branch of `simulate()`, `arduinoCode()` |
| 4 | **P4: tuning challenge** (`p4.html`, `js/p4.js`) and **Validation** (`control-validation.html`, `js/control-validation.js`) | random plant and spec, scoring, how the three checks are measured | `makeChallenge()`, `evaluateSpec()`, `randomPlant()` |
| 5 (or share) | **My System** (`mysystem.html`, `js/mysystem.js`) | step test, K and τ, PI design, spec reasoning | `identifyFirstOrder()`, `designPI()` |

With four members, give "My System" to the member with the lightest load and let the whole group do the step test. With three, combine 2+5 and 4+Validation. **Fill in the real owners in the README table and in the GitHub issues.**

## 2. Ten-minute demo plan

| Time | Page | What to do and say | Who |
|---|---|---|---|
| 0:00 | `control.html` | "Same plants as Homework 1, now inside a feedback loop." Kp = 9 on the demo: faster, but stops at 0.9 | any |
| 0:30 | P1 | Press **Check 1** (Kp = 9, 10% error). Add Ki (Kp = 9, Ki = 40): error 0, overshoot appears. Switch to **Second order: add D** and change Kd. Show the P/I/D plot | M1 |
| 3:00 | P2 | Presets **Fast / Slow / Very slow sensor**. Point at the orange measured curve lagging the blue true curve. Show the sweep plot | M2 |
| 5:00 | P3 | **Ts = 0.01 s**, then **0.9 s** (breaks). **Windup OFF / ON.** Press **Copy code** | M3 |
| 7:30 | P4 | New challenge, run the open-loop step test, tune to PASS | M4 |
| 8:30 | My System | Show the source banner, the design checks (ζ, PWM 0–100%), the code. Say clearly whether the numbers are measured | M5 |
| 9:30 | Validation | Three passes, point at the deviation column | M4 |

If time is left: the Ziegler–Nichols bonus. Have the page open on a phone as well (phone-friendly is a stated rule).

## 3. Questions the instructor may ask, with short answers

1. **Why does a P controller leave a steady-state error?** To hold the output away from zero the plant needs u ≠ 0, and u = Kp·e, so e cannot be 0. For K/(τs+1): e_ss = 1/(1 + K·Kp).
2. **Why does the integral term remove it?** The integral keeps changing u as long as e ≠ 0, so the loop can only rest where e = 0.
3. **Why does I cause overshoot?** It has memory: it is still pushing when the output arrives.
4. **What does D do?** It reacts to the rate of change of the measurement and adds damping to a plant that rings (second order). On a first-order plant the closed loop is (τ + K·Kd)s² + …, so D acts like extra inertia and can increase overshoot.
5. **Why is the derivative taken on the measurement in P1/P2?** For a constant setpoint it equals de/dt, but a setpoint step does not create an infinite spike. In P3 we use the assignment equation on the error, so the first sample has a short derivative kick.
6. **Why does a slow sensor make the loop ring?** The controller acts on old information, which adds phase lag. With PI on a first-order plant the loop becomes third order and is stable only while (τ+τs)(1+K·Kp) > τ·τs·K·Ki.
7. **Euler or RK4, and why?** RK4: much more accurate for the same step. The step is chosen from the fastest rate in the loop, h = 0.25/λ (stable below 2.7/λ). The tests compare it with closed forms to about 10⁻¹².
8. **How is the integration step different from Ts?** The controller runs once per Ts and holds u; the plant is integrated with sub-steps h = Ts/n in between.
9. **What is a zero-order hold?** The DAC or PWM keeps the last computed value until the next sample.
10. **Why does a larger Ts break the loop?** The hold adds about Ts/2 delay. For P control on a first-order plant the discrete pole is e^(−Ts/τ) − K·Kp(1 − e^(−Ts/τ)); it leaves the unit circle when Ts > τ·ln((1+K·Kp)/(K·Kp−1)) = 0.223 s for K = 1, τ = 1, Kp = 9.
11. **What is windup, and how does your anti-windup work?** While u is saturated the integral keeps growing. Ours stops adding to the sum while the output is saturated and the error would push it further into the limit (conditional integration).
12. **Walk through the Arduino code.** `pidStep()` computes the error, the unlimited output, clips it with `constrain`, applies the anti-windup rule to the running sum, stores the error, returns u. `loop()` waits for `micros()` to reach the next tick, so Ts is constant.
13. **How do you find K and τ for the motor?** PWM step from rest, log encoder speed. K = Δspeed/ΔPWM; τ = time to 63.2% of the change (also the slope of ln(1 − y/y∞)).
14. **How did you design the PI gains?** Match τs² + (1 + K·Kp)s + K·Ki to s² + 2ζωn·s + ωn², with ωn = 4/(ζ·ts): Kp = (2ζτωn − 1)/K, Ki = τωn²/K.
15. **Why is the overshoot larger than the second-order formula?** PI adds a zero at −Ki/Kp to the closed loop. The simulation is the judge.
16. **Why is saturation off in validation test 1?** With Kp = 9 the first control value is 9. A 0–1 limit clips it, and the loop is no longer the linear one the formulas describe. The page shows what the clip does.
17. **How are rise time, overshoot, settling time and steady-state error measured?** Read off the simulated curve (definitions in README A8), the same way as Homework 1.
18. **How do you guarantee a tuning challenge is achievable?** A random search finds a reference controller first; the spec is set with margin around it, and the tests check the reference passes.
19. **Why can't Ziegler–Nichols be used on the first-order motor model?** With P control it is stable for every Kp, so there is no Ku. A third lag (sensor plus driver) is needed. Simulation only.
20. **What could go wrong on the real robot?** Encoder noise through D, speed estimate lag (P2), battery voltage changing K, dead zone at low PWM, saturation.

## 4. Equations and where they are in the code

| Equation | Meaning | Code |
|---|---|---|
| u = Kp e + Ki ∫e dt − Kd ẏm | continuous PID | `controller()` and `f()` inside `simulate()` |
| u[k] = Kp e[k] + Ki Ts Σe + Kd (e[k] − e[k−1])/Ts | digital PID (assignment) | digital loop in `simulate()`; `pidStep()` in `arduinoCode()` |
| τẏ = −y + Ku | first-order plant | `f()`: `dx[0]` |
| ÿ = ωn²(Ku − y) − 2ζωn ẏ | second-order plant | `f()`: `dx[0]`, `dx[1]` |
| τs ẏm = y − ym | sensor | `f()`: `dx[2]` |
| (τ + K Kd)s² + (1 + K Kp)s + K Ki = 0 | PID on a first-order plant | `firstOrderLoopTheory()` |
| ωn = √(K Ki/τ), ζ = (1 + K Kp)/(2√(τ K Ki)) | validation check 2 | same; `control-validation.js` |
| y_{k+1} = e^(−Ts/τ) y_k + K(1 − e^(−Ts/τ)) u_k | exact ZOH step of the plant | test "independent discrete-time recursion" |
| Ku = 1/|G(jωu)|, ∠G(jωu) = −180° | ultimate gain | `ultimateFromFrequency()` |
| ωn = 4/(ζ ts), Kp = (2ζτωn − 1)/K, Ki = τωn²/K | My System design | `designPI()` |

## 5. Final grading audit

Status words: **Completed** (built and checked), **Partially completed** (built, but something that only the group can supply or verify is missing), **Missing**. "Evidence" is where to look. Nothing here is a guaranteed grade.

| Criterion | Pts | Status | Evidence | Gap |
|---|---:|---|---|---|
| P1: PID playground | 20 | **Completed** | `p1.html`. Plant, gains, setpoint, limits, anti-windup; block diagram; output vs setpoint; u with limits; P/I/D parts; four live metrics. Tests "What P, I and D do" | Note: on a first-order plant D increases overshoot (explained on the page) |
| P2: slow sensor | 15 | **Completed** | `p2.html`. True and measured output on one plot; controller error is r − ym (tested); sweep to oscillation; presets | |
| P3: digital PID | 15 | **Completed**, one item unverified | `p3.html`. Stair-step u, Ts sweeps, anti-windup and windup presets, Copy button (clicked with a real mouse: "Copied"); code transpiled and run against the simulation sample by sample | The sketch was **not compiled in the Arduino IDE**. Compile it once before the demo. The clipboard content was not read back (browser blocks it) |
| P4: tuning challenge | 10 | **Completed** | `p4.html`. Random hidden plant from Homework 1's model; spec; PASS/FAIL per part; score; new challenge; reset; hidden parameters not shown until "reveal". 20 random challenges tested | |
| My System | 15 | **Partially completed** | `mysystem.html`: parameter entry, step-test tool, transfer function, source field, spec with reasons, PI design, ζ 0.6–0.8 check, PWM 0–100% check, response, PWM plot, Arduino code, reuse in P1–P3 | **No real motor measurement is included.** The shown K and τ are labelled placeholders. The group must run the step test and fill in the source (README A6) |
| Validation checks | 5 | **Completed** | `control-validation.html`, `npm test`: three checks with expected, actual, deviation, tolerance, pass/fail | |
| Teaching value and GitHub practice | 10 | **Partially completed** | "Predict, then check" on every module (computed answers, shuffled options); README updated with modules; issue texts and commit workflow written | Issues, assignments and every member's commits **must be done by the group** in GitHub. This folder is not a git repository, so none were created |
| Demo and individual questions | 10 | **Not applicable to the code** | Section 2 (demo plan), Section 3 (questions) | Each member must prepare their own module |
| Bonus (up to +10): Ziegler–Nichols | +10 | **Completed (simulation only)** | `zn.html`: Ku and Pu by time-domain bisection and by frequency crossing (agree to 0.002%), rules, before/after, limitations; says clearly when a plant has no Ku | No hardware results. The hardware bonus is not attempted |

Technical rules from Section 4 of the PDF:

| Rule | Status | Evidence |
|---|---|---|
| "Control" section linked from the landing page | Completed | `index.html` nav, hero button and section |
| Own closed-loop simulation with Euler or RK4 | Completed | `PIDSim.simulate()` (RK4) |
| One GitHub Issue per module, assigned to its owner | **Not done** (needs GitHub) | README A7 has the texts |
| README updated with new modules and owners | Completed, owners blank | README A1 |
| Release tagged v2.0 and Pages link on the course page | **Not done** (needs the group's approval) | README A7 |
| GitHub Pages, no server, phone-friendly, every member's commits visible | Pages-ready, phone layout checked at 375 px; commits must be made by members | |

## 6. Submission readiness checklist

- [ ] Run `npm test`: 35 + 43 tests pass.
- [ ] Open `control-validation.html`: 3 of 3 pass.
- [ ] Run the PWM step test, paste the log into **My System**, press "Use K and τ", choose "Measured by our group", write the source and conditions.
- [ ] Review the spec and the notes box on My System; copy the final gains and the generated code into the README.
- [ ] Compile the generated Arduino code in the Arduino IDE once.
- [ ] Fill in owners (README A1), team table (Part B) and the AI-use paragraph (README A9).
- [ ] Create the issues, assign the owners, commit each module from its owner's account, close the issues with Pull Requests.
- [ ] Push to GitHub, check the Pages link on a laptop and a phone, test every page there.
- [ ] Tag `v2.0` only after the checklist above and with the group's agreement; post the Pages link on the course page.
- [ ] Each member rehearses their own module (Sections 2 and 3).
- [ ] Note: the PDF gives **Monday 23 November 2026** as the due date for release v2.0 and **24 November** for the first demos. If that date has passed, ask the instructor how late work is handled before tagging.
