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
import { buildMoves } from './solver/solve-dir.js';
import { isSolved } from './rules.js';
import { cellCount } from './model.js';
import { REF_FLAGS } from './difficulty.js';

// ladderWorkCap: the ladder gives up after this many edge assignments (a few hundred ms at worst; 2 of the
// 89 rated puzzles, both n >= 10, hit it). A capped run still reports the trials it made, a lower bound.
export const TRAP_CFG = { cap: 1000, obvious: 3, shallow: 30, points: [0, 1, 3, 5], ladderWorkCap: 1e5,
  pathCap: 2e6 }; // pathCap: node budget of the solve that finds the solution path when the puzzle carries none (offline tools raise it)

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
  mean: { trapMax: 6.5319, trapTop3: 13.9064, altFrac: 0.5541, lTr: 4.6696 },
  sd: { trapMax: 3.5144, trapTop3: 7.0584, altFrac: 0.0858, lTr: 2.6426 },
  w: { trapMax: 0.0804, trapTop3: 0.3117, altFrac: -0.3399, lTr: 0.1951 },
  b: 1.8223,
  cuts: [1.017, 1.5115, 2.0059, 2.5003, 2.9948],
  fit: { n: 120, of: 120, lambda: 10, looRho: 0.59, looMae: 1.02, cuts: 'anchors', looAnchors: { easy: [5,17], hard3: [10,17], hard4: [5,17] } },
};
// </TRAP_MODEL>

// The model with its altFrac term switched off (weight 0 = altFrac held at its mean), for boards the fit never saw. altFrac is
// a geometry measure: the share of solution steps that have a legal wrong move. On a board with holes the holes themselves take
// neighbours away, so it falls for a reason that has nothing to do with the clues, and the fitted negative weight reads that as
// "harder" (Cutout: +0.3..+0.5 of predicted rating against -0.5..-0.6 on standard boards of the same size). trapMax, trapTop3 and
// lTr (the ladder) look at the clues only. Same cuts, same other weights: a ranking, not a recalibrated grade.
export const withoutAltFrac = (model = TRAP_MODEL) => ({ ...model, w: { ...model.w, altFrac: 0 } });

// One way arrows: only the clue-reading terms, trapMax and trapTop3 (altFrac AND lTr held at their means). altFrac: arrows take moves
// away like holes do (not measured). lTr: ladder.js is undirected, so on an arrows puzzle it counts guesses on a different puzzle.
// Same cuts and weights, so a ranking with no hand ratings behind it: on standard puzzles this reduced score grades about 0.5-0.7 above the
// full one (the dropped terms are mostly negative for easy puzzles). Refit once arrows ratings or solve times exist.
export const withoutAltFracLadder = (model = TRAP_MODEL) => ({ ...model, w: { ...model.w, altFrac: 0, lTr: 0 } });
export const ARROWS_MODEL = withoutAltFracLadder();
// Exact: the same reduced model, for the same reasons (the ladder is about checkpoints in order,
// not steps, and altFrac is a geometry measure the fit never saw without walls) and with the same
// caveat: a ranking, no hand ratings behind it.
export const EXACT_MODEL = withoutAltFracLadder();

// The score model that fits a board: Cutout (holes) drops altFrac, One way arrows keeps trapMax and trapTop3 only, the rest TRAP_MODEL.
// The play app grades with it (grades.js playGradesFor); trapMetrics itself keeps TRAP_MODEL unless a model is passed.
export const modelFor = p => {
  if (p.arrows) return ARROWS_MODEL;
  if (p.exact) return EXACT_MODEL;
  return p.holes ? withoutAltFrac() : TRAP_MODEL;
};

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
export function solutionPath(p, cap = TRAP_CFG.pathCap) {
  if (p.path && isSolved(p, p.path)) return p.path;
  const r = solve(p, { limit: 1, nodeCap: cap, capture: true, ...REF_FLAGS });
  return r.count ? r.paths[0] : null;
}

// Every wrong turn along `path`: [{ i, cell, sub, capped }] — `sub` = nodes the solver needed below the
// wrong move (0 = a local prune already rejected it), `capped` = it survived cfg.cap nodes.
// On an arrows puzzle a wrong turn is a move the arrows allow (buildMoves().out), refuted by the directed solver.
export function trapProfile(p, path, cfg = TRAP_CFG) {
  const nb = p.arrows ? buildMoves(p).out : buildNeighbors(p).nb;
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
// `model` (optional) = the score model, TRAP_MODEL unless the board needs another (see modelFor).
// An arrows puzzle never runs the (undirected) ladder: ladTrials is 0 there, and so on an Exact
// one (steps, not checkpoints).
export function trapMetricsFromProfile(p, path, profile, cfg = TRAP_CFG, ladTrials = undefined, model = TRAP_MODEL) {
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
  m.ladTrials = ladTrials ?? (p.arrows || p.exact ? 0 : ladderTrials(p, cfg));
  m.lTr = Math.log1p(m.ladTrials);
  m.predicted = trapPredict(m, model);
  m.gradeUncapped = trapGradeOf(m.predicted, model);
  m.grade = capGradeBySize(m.gradeUncapped, p.n);
  return m;
}

// One call: { ok:false, reason } when no solution can be found, else the metrics above + path.
export function trapMetrics(p, cfg = TRAP_CFG, path = null, model = TRAP_MODEL) {
  path = path || solutionPath(p, cfg.pathCap);
  if (!path) return { ok: false, reason: 'no solution found within the search budget (pathCap)' };
  return { ok: true, path, ...trapMetricsFromProfile(p, path, trapProfile(p, path, cfg), cfg, undefined, model) };
}

// The route to display for a trap: solution up to the step, then the wrong move.
export const trapRoute = (path, step) => path.slice(0, step.i + 1).concat(step.worst.cell);
