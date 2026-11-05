// Step-level model of wrong turns (see tools/step-fit.mjs for the story and the acceptance rule).
//
// Data: a game that logged its wrong turns (row version 1, `ev`) tells, for every step of the
// solution, how many times the player left it there. The puzzle tells which wrong moves exist at
// that step and how deep each one is refuted (trapProfile): the four buckets of the trap grade
// (obvious / shallow / deep / capped). A player who arrives at step i takes a wrong move m_i times
// before the right one: m_i is geometric with mean h_i, P(m) = h^m / (1 + h)^(m + 1), and h_i is
// the sum over the wrong moves at that step of a rate that depends on the move's bucket:
//   h_i = exp(gamma * skill) * sum_b n_ib * lambda_b          (the "free" model)
// Two models stand beside it, to see what the data add:
//   uniform  every wrong move has the same rate (the traps do not matter)
//   hand     the cells a wrong move wastes are proportional to the hand-set trap points 0/1/3/5
//            (TRAP_CFG.points) plus a small floor f: rate_b * D_b = c * (points_b + f), D_b = the
//            cells the players walk on before taking a wrong turn of that bucket back (measured on
//            the training games). That is what the production grade assumes: a point is a unit of
//            trouble. The floor is fitted but kept in (0, FLOOR_MAX]: with a free floor the family
//            would reach "every wrong move costs the same" and hide what the data say against the
//            points (0 points for the obvious moves cannot be fitted at all: they are taken too).
// The event of a step is the step of the player's path where it left the solution, minus 1: the
// path had i + 1 cells right and the next one was wrong (trapProfile's step i).
import { parse } from '../src/core/format.js';
import { cellCount } from '../src/core/model.js';
import { solutionPath, trapProfile, TRAP_CFG } from '../src/core/trap.js';
import { invert } from '../src/core/gotd-model.js';
import { EV_MAX_EVENTS } from '../src/core/behaviour.js';
import { sum, mean, spearman, resampleClusters, interval } from './stats-lib.mjs';
import { makeRng, shuffle } from '../src/core/rng.js';

export const BUCKETS = ['obvious', 'shallow', 'deep', 'capped'];
export const bucketOf = (w, cfg = TRAP_CFG) =>
  (w.capped ? 3 : w.sub <= cfg.obvious ? 0 : w.sub <= cfg.shallow ? 1 : 2);

// The acceptance rule (written in full in step-fit.mjs).
export const RULE = { minGames: 200, minPuzzles: 40, minDeltaRho: 0.05, confirmGames: 800 };

// ---------- puzzles and games ----------
// { n, T, steps: [{ i, c: [obvious, shallow, deep, capped] }] }: the wrong moves of a puzzle by
// step of its solution; null when it has none (no solution within the budget, a variant).
export function stepsOfPuzzle(text, pathCap) {
  const p = parse(text);
  if (p.holes || p.split || p.arrows) return null;
  const path = solutionPath(p, pathCap);
  if (!path) return null;
  const by = new Map();
  for (const w of trapProfile(p, path)) {
    const s = by.get(w.i) || { i: w.i, c: [0, 0, 0, 0] };
    s.c[bucketOf(w)]++;
    by.set(w.i, s);
  }
  return { n: p.n, T: cellCount(p), steps: [...by.values()].sort((a, b) => a.i - b.i) };
}

const skillTerm = r => (r.skill == null || r.skill === 15 ? 0 : (r.skill - 7) / 3);

// Rows of the export (decoded: events, abandoned, hint, skill, key, u) -> the games the step fit
// can use, and why the others cannot. stepsFor(key) -> stepsOfPuzzle(...) or null.
// Not used: no events recorded (older page), abandoned or hint games (their steps are not all
// faced / not alone), a game that hit the event cap (the later wrong turns are missing).
export function gamesOf(rows, stepsFor, { useSkill = true } = {}) {
  const why = { rows: rows.length, noEvents: 0, abandoned: 0, hint: 0, capped: 0, noPuzzle: 0 };
  const games = [];
  let events = 0, unexplained = 0;
  for (const r of rows) {
    if (r.abandoned) { why.abandoned++; continue; }
    if (r.hint) { why.hint++; continue; }
    if (!Array.isArray(r.events)) { why.noEvents++; continue; }
    if (r.events.length >= EV_MAX_EVENTS) { why.capped++; continue; }
    const P = r.key ? stepsFor(r.key) : null;
    if (!P) { why.noPuzzle++; continue; }
    const at = new Map(P.steps.map(s => [s.i, s])), m = new Map(), depths = [];
    for (const [step, d] of r.events) {
      events++;
      const st = at.get(step - 1);
      if (!st) { unexplained++; continue; } // a wrong turn the profile does not list
      m.set(st.i, (m.get(st.i) || 0) + 1);
      depths.push([st, d]);
    }
    games.push({ key: r.key, P, m, depths, s: useSkill ? skillTerm(r) : 0, u: r.u, deep: r.deep });
  }
  return { games, why, events, unexplained };
}

// ---------- the models ----------
// hu(theta, c, s, u): h of one step (c = counts per bucket, s = the game's skill term) and its
// gradient wrt theta in u. theta holds log-rates and gamma (the skill effect) last.
const POINTS = TRAP_CFG.points, FLOOR_MAX = 0.5;
export const MODELS = {
  uniform: {
    k: 2,
    hu(th, c, s, u) {
      const h = Math.exp(th[0] + th[1] * s) * (c[0] + c[1] + c[2] + c[3]);
      u[0] = h; u[1] = s * h;
      return h;
    },
    rates: th => [0, 1, 2, 3].map(() => Math.exp(th[0])),
    init: r => [Math.log(r.rate), 0],
  },
  free: {
    k: 5,
    hu(th, c, s, u) {
      const g = Math.exp(th[4] * s);
      let h = 0;
      for (let b = 0; b < 4; b++) { u[b] = g * c[b] * Math.exp(th[b]); h += u[b]; }
      u[4] = s * h;
      return h;
    },
    rates: th => th.slice(0, 4).map(Math.exp),
    init: r => [Math.log(r.rate), Math.log(r.rate), Math.log(r.rate), Math.log(r.rate), 0],
  },
};

// The hand-set shape as a model, for walk lengths D (per bucket). th[1] is the floor on a logistic
// scale: f = FLOOR_MAX / (1 + exp(-th[1])).
const floorOf = t => FLOOR_MAX / (1 + Math.exp(-t));
export const handModel = D => ({
  k: 3,
  hu(th, c, s, u) {
    const f = floorOf(th[1]), g = Math.exp(th[0] + th[2] * s);
    let h = 0, n = 0;
    for (let b = 0; b < 4; b++) { h += c[b] * (POINTS[b] + f) / D[b]; n += c[b] / D[b]; }
    h *= g; u[0] = h; u[1] = g * n * f * (1 - f / FLOOR_MAX); u[2] = s * h;
    return h;
  },
  rates: th => POINTS.map((p, b) => Math.exp(th[0]) * (p + floorOf(th[1])) / D[b]),
  init: r => [Math.log(r.rate / (r.meanPoints + FLOOR_MAX / 2)), 0, 0],
});

// Crude figures of a set of games, to start the fits from: the rate of wrong turns per wrong move.
function crude(games) {
  let ev = 0, alt = 0, pts = 0;
  for (const G of games) {
    ev += sum([...G.m.values()]);
    for (const st of G.P.steps) {
      alt += sum(st.c);
      for (let b = 0; b < 4; b++) pts += st.c[b] * POINTS[b];
    }
  }
  return { rate: Math.max(1e-4, ev / Math.max(1, alt)), meanPoints: alt ? pts / alt : 1 };
}

// log-likelihood (and, with `grad`, its gradient g and Fisher information I) of games at theta.
function evaluate(model, th, games, grad) {
  const k = th.length, u = new Array(k).fill(0);
  const g = new Array(k).fill(0), I = Array.from({ length: k }, () => new Array(k).fill(0));
  let ll = 0;
  for (const G of games) {
    for (const st of G.P.steps) {
      const m = G.m.get(st.i) || 0, h = model.hu(th, st.c, G.s, u);
      ll += m * Math.log(h) - (m + 1) * Math.log1p(h);
      if (!grad) continue;
      const w = 1 / (h * (1 + h)), a = (m - h) * w;
      for (let j = 0; j < k; j++) {
        g[j] += a * u[j];
        for (let l = 0; l < k; l++) I[j][l] += w * u[j] * u[l];
      }
    }
  }
  return { ll, g, I };
}
export const logLik = (model, th, games) => evaluate(model, th, games, false).ll;

// Fisher scoring with a weak ridge towards the crude start (tau: it only matters for a bucket
// with no data) and step halving. -> { th, ll, iters }
export function fitModel(model, games, { tau = 0.5, maxIter = 60 } = {}) {
  const th0 = model.init(crude(games));
  let th = th0.slice();
  const pen = t => -0.5 * tau * sum(t.map((v, j) => (v - th0[j]) ** 2));
  let cur = evaluate(model, th, games, true), iters = 0;
  for (; iters < maxIter; iters++) {
    const k = th.length, g = cur.g.map((v, j) => v - tau * (th[j] - th0[j]));
    const I = cur.I.map((row, j) => row.map((v, l) => v + (j === l ? tau : 0)));
    const inv = invert(I), d = inv.map(row => sum(row.map((v, j) => v * g[j])));
    let t = 1, next = null;
    for (let tries = 0; tries < 20; tries++, t /= 2) {
      const cand = th.map((v, j) => v + t * d[j]);
      const e = evaluate(model, cand, games, false);
      if (e.ll + pen(cand) >= cur.ll + pen(th) - 1e-9) { next = cand; break; }
    }
    if (!next) break;
    const move = Math.max(...next.map((v, j) => Math.abs(v - th[j])));
    th = next;
    cur = evaluate(model, th, games, true);
    if (move < 1e-7 || k === 0) break;
  }
  return { th, ll: cur.ll, iters };
}

// ---------- from rates to a score ----------
// Mean depth (cells walked before the player took the wrong turn back) per bucket, from the steps
// whose wrong moves are all of one bucket (then the bucket of the move taken is known); a bucket
// with few such events leans on the overall mean (5 pseudo-events).
export function depthMeans(games) {
  const s = [0, 0, 0, 0], n = [0, 0, 0, 0];
  let all = 0, cnt = 0;
  for (const G of games) {
    for (const [st, d] of G.depths) {
      all += d; cnt++;
      const used = st.c.map((v, b) => (v ? b : -1)).filter(b => b >= 0);
      if (used.length === 1) { s[used[0]] += d; n[used[0]]++; }
    }
  }
  const overall = cnt ? all / cnt : 1;
  return s.map((v, b) => (v + 5 * overall) / (n[b] + 5));
}
// What a reference player (skill term 0) is expected to waste per cell of the board: for every
// wrong
// move, its rate times the cells walked before it is taken back, summed over the puzzle.
export const puzzleScore = (P, lambda, D) => {
  let w = 0;
  for (const st of P.steps) for (let b = 0; b < 4; b++) w += st.c[b] * lambda[b] * D[b];
  return w / P.T;
};

// ---------- cross-validation by puzzle ----------
// For every game of a held-out fold (the folds hold whole puzzles): its log-likelihood under each
// model fitted on the other folds, and the puzzle's new score. -> [{ key, T, ll: {..}, score,
// alts, u }]
export function crossValidate(games, { folds = 5, seed = 1 } = {}) {
  const keys = [...new Set(games.map(g => g.key))];
  shuffle(keys, makeRng(seed));
  const fold = new Map(keys.map((k, i) => [k, i % folds]));
  const out = [];
  for (let f = 0; f < folds; f++) {
    const train = games.filter(g => fold.get(g.key) !== f);
    const test = games.filter(g => fold.get(g.key) === f);
    if (!train.length || !test.length) continue;
    const D = depthMeans(train), model = { ...MODELS, hand: handModel(D) }, th = {};
    for (const name of Object.keys(model)) th[name] = fitModel(model[name], train).th;
    const lambda = MODELS.free.rates(th.free);
    for (const G of test) {
      const ll = {};
      for (const name of Object.keys(model)) ll[name] = logLik(model[name], th[name], [G]);
      out.push({
        key: G.key, T: G.P.T, ll, score: puzzleScore(G.P, lambda, D), u: G.u,
        alts: sum(G.P.steps.map(s => sum(s.c))) / G.P.T,
      });
    }
  }
  return out;
}

// ---------- the verdict ----------
// held: crossValidate's output; current(key) -> the production score (trapPredicted) or null.
// -> estimates and 95% intervals (bootstrap over whole puzzles) for the two gates, and the
// verdict.
export function verdict(held, current, { boot = 400, seed = 1, rule = RULE } = {}) {
  const keys = [...new Set(held.map(h => h.key))], groups = keys.map(() => []);
  held.forEach((h, i) => groups[keys.indexOf(h.key)].push(i));
  const regret = held.map(h => h.u / h.T);
  const cur = held.map(h => current(h.key));
  const haveCur = cur.every(Number.isFinite);
  const stat = idx => {
    const at = f => idx.map(i => f(held[i], i));
    const dLL = mean(at(h => h.ll.free - h.ll.hand));
    const dUni = mean(at(h => h.ll.hand - h.ll.uniform));
    const y = at((h, i) => regret[i]);
    const rn = spearman(at(h => h.score), y), ra = spearman(at(h => h.alts), y);
    const rc = haveCur ? spearman(at((h, i) => cur[i]), y) : NaN;
    return { dLL, dUni, rn, rc, ra, diff: rn - rc };
  };
  const all = held.map((_, i) => i), est = stat(all), rnd = makeRng(seed + 1);
  const draws = Array.from({ length: boot }, () => stat(resampleClusters(groups, rnd)));
  const ci = k => interval(draws.map(d => d[k]), boot);
  const res = { games: held.length, puzzles: keys.length, est, ci: {} };
  for (const k of Object.keys(est)) res.ci[k] = ci(k);
  const enough = res.games >= rule.minGames && res.puzzles >= rule.minPuzzles;
  res.gate = {
    enough,
    A: res.ci.dLL[0] > 0,
    B: haveCur && res.ci.diff[0] > 0 && est.diff >= rule.minDeltaRho,
  };
  const none = !res.gate.A && !res.gate.B;
  res.verdict = !enough ? 'INCONCLUSIVE' : res.gate.A && res.gate.B ? 'ACCEPT'
    : none ? (res.games >= rule.confirmGames ? 'REJECT' : 'NO EVIDENCE YET') : 'PARTIAL';
  return res;
}

// Parameters of the free model on all games, with intervals from refits on resampled puzzles:
// lambda (wrong turns per game and wrong move), D (cells walked), w = lambda * D (cells wasted
// per wrong move), and the points that stand for TRAP_CFG.points (w relative to the shallow
// bucket).
export function parameters(games, { boot = 100, seed = 1 } = {}) {
  const describe = gs => {
    const fit = fitModel(MODELS.free, gs), lambda = MODELS.free.rates(fit.th), D = depthMeans(gs);
    const w = lambda.map((l, b) => l * D[b]);
    return { lambda, D, w, points: w.map(v => v / w[1]), gamma: fit.th[4] };
  };
  const est = describe(games);
  const keys = [...new Set(games.map(g => g.key))], groups = keys.map(() => []);
  games.forEach((g, i) => groups[keys.indexOf(g.key)].push(i));
  const rnd = makeRng(seed + 2);
  const draws = Array.from({ length: boot }, () =>
    describe(resampleClusters(groups, rnd).map(i => games[i])));
  const ci = (get, b) => interval(draws.map(d => get(d)[b]), boot);
  return {
    est,
    ci: {
      lambda: [0, 1, 2, 3].map(b => ci(d => d.lambda, b)),
      D: [0, 1, 2, 3].map(b => ci(d => d.D, b)),
      w: [0, 1, 2, 3].map(b => ci(d => d.w, b)),
      points: [0, 1, 2, 3].map(b => ci(d => d.points, b)),
      gamma: interval(draws.map(d => d.gamma), boot),
    },
  };
}

// rows -> usable games -> cross-validated comparison -> verdict, in one go.
export function analyse(rows, stepsFor, current,
  { folds = 5, boot = 400, seed = 1, useSkill = true } = {}) {
  const data = gamesOf(rows, stepsFor, { useSkill });
  const held = crossValidate(data.games, { folds, seed });
  return { data, held, res: verdict(held, current, { boot, seed }) };
}
