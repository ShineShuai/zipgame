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
// The grade is a small ridge model over [trapMax, trapTop3, altFrac] fitted to hand ratings (see
// TRAP_MODEL). 54 labels, features picked on the same sample: treat it as a hypothesis to keep testing
// via the design app's rating log, and refit with tools/fit-trap.mjs as ratings accumulate.
import { solve } from './solver/solve.js';
import { buildNeighbors } from './solver/prune.js';
import { isSolved } from './rules.js';
import { REF_FLAGS } from './difficulty.js';

export const TRAP_CFG = { cap: 1000, obvious: 3, shallow: 30, points: [0, 1, 3, 5] };

// Ridge fit (lambda 10) on 54 hand-rated puzzles (tools/ratings-54.json, tools/fit-trap.mjs).
// pred = b + sum w[k] * (x[k]-mean[k])/sd[k] is on the human 0-5 scale, so grade = clamp(round(pred), 0, 5):
// no quantile buckets. Fitted on sizes 6-11 only; leave-one-out rho 0.65, mean abs error 0.66 grades.
// The fit rarely leaves 0.6..3.4, so grades 0, 4 and 5 are seldom produced (few hard labels so far).
export const TRAP_MODEL = {
  features: ['trapMax', 'trapTop3', 'altFrac'],
  mean: { trapMax: 5.9815, trapTop3: 13.0741, altFrac: 0.5816 },
  sd: { trapMax: 3.2914, trapTop3: 6.2148, altFrac: 0.0834 },
  w: { trapMax: 0.2923, trapTop3: 0.2296, altFrac: -0.4116 },
  b: 1.7222,
};

export function trapPredict(m, model = TRAP_MODEL) {
  let s = model.b;
  for (const k of model.features) s += model.w[k] * (m[k] - model.mean[k]) / model.sd[k];
  return s;
}
export const trapGradeOf = pred => Math.max(0, Math.min(5, Math.round(pred)));

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
  const T = p.n * p.n, { nb } = buildNeighbors(p);
  const seen = new Uint8Array(T), out = [];
  let nonUnique = false;
  for (let i = 0; i < T - 1; i++) {
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

const alternativePoints = (w, cfg) => w.capped ? cfg.points[3] : w.sub <= cfg.obvious ? cfg.points[0] : w.sub <= cfg.shallow ? cfg.points[1] : cfg.points[2];

// All trap metrics from a profile. `steps` = per-step scores, worst first.
export function trapMetricsFromProfile(p, path, profile, cfg = TRAP_CFG) {
  const T = p.n * p.n, byStep = new Map();
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
  m.predicted = trapPredict(m);
  m.grade = trapGradeOf(m.predicted);
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
