// Trap-based difficulty (candidate grade "trap"). Instead of counting how big the solver's tree is,
// ask what a human actually faces: at each step of the SOLUTION, which wrong turns exist, and how
// long does it take to see that each one is dead?
//
//   for every step i of the solution path and every legal wrong move v (unvisited neighbour, no wall,
//   not the solution's own next cell): force the prefix path[0..i] + v and let the solver refute it,
//   counting only the nodes below v (solve()'s `forced` option; nodeCap = cap).
//     refuted within OBVIOUS nodes   -> 0 pts  (any local check kills it)
//     refuted within SHALLOW nodes   -> 1 pt   (shallow trap)
//     refuted, but deeper            -> 3 pts  (deep trap)
//     survives the cap               -> 5 pts  (the solver itself struggles)
//   A step's score = sum over its wrong moves. Difficulty follows the WORST steps, not the sum over
//   all steps: on the 48 hand-rated puzzles the plain sum over every wrong turn had rho -0.14..0.00
//   (it mostly counts open, easy grids), while the max / top-3 over steps had rho 0.35..0.49.
//
// Also used: altFrac = fraction of solution steps that have ANY legal wrong move (pure geometry, no
// solve). Puzzles that are one long forced corridor are easy for humans even when the solver's tree
// is large (rho -0.54 vs human on the same sample).
//
// Also used: lTr = log(1 + ladTrials), where ladTrials = how many what-if guesses the technique ladder
// (ladder.js) needed. Its median over the hand ratings climbs with the rating (24 / 44 / 62 / 442 for
// ratings 0 / 1 / 2 / >=3.5), so it separates the easy puzzles that trapMax and altFrac cannot.
//
// The score is a small ridge model over [trapMax, trapTop3, altFrac, lTr] fitted to hand ratings (see
// TRAP_MODEL); the grade is that score cut at TRAP_MODEL.cuts (also fitted), then capped by size
// (SIZE_GRADE_CAP). Few labels, features picked on the same sample: treat it as a hypothesis to keep
// testing via the design app's rating log, and refit with tools/fit-trap.mjs as ratings accumulate.
import { solve } from './solver/solve.js';
import { ladder } from './ladder.js';
import { buildNeighbors } from './solver/prune.js';
import { isSolved } from './rules.js';
import { cellCount } from './model.js';
import { REF_FLAGS } from './difficulty.js';

// ladderWorkCap: the ladder gives up after this many edge assignments (a few hundred ms at worst; 2 of the
// 89 rated puzzles, both n >= 10, hit it). A capped run still reports the trials it made, a lower bound.
export const TRAP_CFG = { cap: 1000, obvious: 3, shallow: 30, points: [0, 1, 3, 5], ladderWorkCap: 1e5 };

// Hard ceiling of the grade by board size (a 5x5 never grades above 2, a 6x6 never above 3).
export const SIZE_GRADE_CAP = { 5: 2, 6: 3 };

// Ridge weights fitted to hand ratings. Do not edit by hand: `node tools/fit-trap.mjs <ratings.json> --write`
// rewrites everything between the two marker comments (weights + `fit` = how many ratings and how well it did).
// pred = b + sum w[k] * (x[k]-mean[k])/sd[k] is on the human 0-5 scale; grade = how many of `cuts` pred has
// reached (clamped to 0-5; no `cuts` = round(pred), the old rule). Rounding a ridge fit can never reach 0, 4
// or 5 (it shrinks toward the mean), so the cuts are fitted instead, with the anchor ratings (<= 0.5 or
// >= 3.5, the ones trusted most) weighted double. The ratings so far cover sizes 5-11 only. `fit.looRho` /
// `fit.looMae` / `fit.looAnchors` are leave-one-out figures (optimistic: the feature set was chosen on the
// same ratings).
// <TRAP_MODEL>
export const TRAP_MODEL = {
  features: ['trapMax', 'trapTop3', 'altFrac', 'lTr'],
  mean: { trapMax: 6.2455, trapTop3: 13.3839, altFrac: 0.5575, lTr: 4.6456 },
  sd: { trapMax: 3.2852, trapTop3: 6.6309, altFrac: 0.0853, lTr: 2.5464 },
  w: { trapMax: 0.1527, trapTop3: 0.287, altFrac: -0.3754, lTr: 0.1191 },
  b: 1.8036,
  cuts: [0.9454, 1.4775, 2.0095, 2.5416, 3.0736],
  fit: { n: 114, lambda: 10, looRho: 0.6, looMae: 0.9, cuts: 'anchors', looAnchors: { easy: [8,17], hard3: [12,16], hard4: [6,16] } },
};
// </TRAP_MODEL>

export function trapPredict(m, model = TRAP_MODEL) {
  let s = model.b;
  for (const k of model.features) s += model.w[k] * (m[k] - model.mean[k]) / model.sd[k];
  return s;
}
// Grade of a score: the number of model.cuts it has reached, or round(pred) when the model has no cuts.
export function trapGradeOf(pred, model = TRAP_MODEL) {
  const g = model.cuts ? model.cuts.filter(c => pred >= c).length : Math.round(pred);
  return Math.max(0, Math.min(5, g));
}
export const capGradeBySize = (grade, n) => Math.min(grade, SIZE_GRADE_CAP[n] ?? 5);

// The puzzle's solution path: the generator's own (p.path) when valid, else one first-solution solve.
// null when none is found within `cap` nodes.
export function solutionPath(p, cap = 2000000) {
  if (p.path && isSolved(p, p.path)) return p.path;
  const r = solve(p, { limit: 1, nodeCap: cap, capture: true, ...REF_FLAGS });
  return r.count ? r.paths[0] : null;
}

// Every wrong turn along `path`: [{ i, cell, sub, capped }] — `sub` = nodes the solver needed below the
// wrong move (0 = a local prune already rejected it), `capped` = it survived cfg.cap nodes.
export function trapProfile(p, path, cfg = TRAP_CFG) {
  const { nb } = buildNeighbors(p);
  const seen = new Uint8Array(p.n * p.n), out = [];
  let nonUnique = false;
  // path.length = the cells to cover (n*n, fewer with holes)
  for (let i = 0; i < path.length - 1; i++) {
    seen[path[i]] = 1;
    for (let d = 0; d < 4; d++) {
      const v = nb[path[i] * 4 + d];
      if (v < 0 || seen[v] || v === path[i + 1]) continue;
      const r = solve(p, { limit: 1, nodeCap: cfg.cap, forced: path.slice(0, i + 1).concat(v), ...REF_FLAGS });
      if (r.count > 0) { nonUnique = true; continue; } // a second solution, not a trap
      out.push({ i, cell: v, sub: r.subNodes, capped: r.exceeded });
    }
  }
  out.nonUnique = nonUnique;
  return out;
}

// The ladder's probe-trial count (what-if guesses), 0 for a degenerate puzzle the ladder rejects.
// `trialCap` (optional): stop the ladder after that many trials; the result is then trialCap + 1 = "more than trialCap".
export const ladderTrials = (p, cfg = TRAP_CFG, trialCap = Infinity) => ladder(p, { workCap: cfg.ladderWorkCap, trialCap }).probeTrials ?? 0;

const alternativePoints = (w, cfg) => w.capped ? cfg.points[3] : w.sub <= cfg.obvious ? cfg.points[0] : w.sub <= cfg.shallow ? cfg.points[1] : cfg.points[2];

// All trap metrics from a profile. `steps` = per-step scores, worst first.
// `ladTrials` (optional) = the ladder's probe-trial count when the caller already ran it; else it runs here.
export function trapMetricsFromProfile(p, path, profile, cfg = TRAP_CFG, ladTrials = undefined) {
  const T = cellCount(p), byStep = new Map();
  for (const w of profile) {
    const s = byStep.get(w.i) || { i: w.i, score: 0, worst: null };
    s.score += alternativePoints(w, cfg);
    if (!s.worst || (w.capped ? Infinity : w.sub) > (s.worst.capped ? Infinity : s.worst.sub)) s.worst = w;
    byStep.set(w.i, s);
  }
  const steps = [...byStep.values()].sort((a, b) => b.score - a.score || a.i - b.i);
  const m = {
    T, altFrac: byStep.size / T,
    trapMax: steps.length ? steps[0].score : 0,
    trapTop3: steps.slice(0, 3).reduce((s, x) => s + x.score, 0),
    trapDeep: steps.filter(s => s.score >= cfg.points[3]).length,
    alternatives: profile.length, nonUnique: profile.nonUnique, steps,
  };
  m.ladTrials = ladTrials ?? ladderTrials(p, cfg);
  m.lTr = Math.log1p(m.ladTrials);
  m.predicted = trapPredict(m);
  m.gradeUncapped = trapGradeOf(m.predicted);
  m.grade = capGradeBySize(m.gradeUncapped, p.n);
  return m;
}

// One call: { ok:false, reason } when no solution can be found, else the metrics above + path.
export function trapMetrics(p, cfg = TRAP_CFG, path = null) {
  path = path || solutionPath(p);
  if (!path) return { ok: false, reason: 'no solution found within the search budget' };
  return { ok: true, path, ...trapMetricsFromProfile(p, path, trapProfile(p, path, cfg), cfg) };
}

// The route to display for a trap: solution up to the step, then the wrong move.
export const trapRoute = (path, step) => path.slice(0, step.i + 1).concat(step.worst.cell);
