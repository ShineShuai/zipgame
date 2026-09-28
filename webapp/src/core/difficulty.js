// Difficulty scoring for a puzzle already proven unique (see gen/generate.js). Solver-derived, not
// a generation parameter score: grid size / K / wall count are generation *inputs*, not difficulty
// itself — a puzzle's own solve is what actually determines how hard it is (see the design app's
// reasoning notes and the project's zip-puzzle-theory memory for the K-vs-walls non-monotone
// findings this is built on).
//
// Everything here is a PROXY for human difficulty, not a measurement of it: there is no human solve
// data yet. Read metricsFor()'s fields as "solver-cost signals," and treat the grade as provisional
// until real outcomes (solve time, undo count, abandon rate) can be logged and checked against it.
import { solve } from './solver/solve.js';

// Reference config every grading solve() uses, so grades are comparable across puzzles/N/callers.
// Matches the prune set the project's own ablation work was run with (deg+conn dead-end/flood-fill
// are always on in solve.js; +prop +parity here). legCollide is deliberately EXCLUDED from the
// reference metric (see legCollideDependent below) because its O(K^2) cost profile differs enough
// from the others that folding it in would skew decisionNodes for large-K puzzles independent of
// how hard they actually are.
export const REF_FLAGS = { prop: true, parity: true };

// Grading must never cost more than generation itself already risks costing: reuse the same order
// of magnitude as generate()'s own nodeCap rather than an independently-chosen "safe-sounding" large
// constant. A puzzle generation could already solve within its own cap; if grading can't confirm
// uniqueness within a comparable budget, that's itself informative (report exceeded, don't grind on).
export function refNodeCap(n) {
  return Math.round(Math.max(30000, 200 * n * n) * 0.3);
}

// The single solve() call every other metric here is derived from. Call once per puzzle graded;
// everything below is arithmetic on its result, not a further solve.
export function referenceSolve(puzzle, nodeCap = refNodeCap(puzzle.n)) {
  return solve(puzzle, { limit: 2, nodeCap, decisions: true, ...REF_FLAGS });
}

// ---- Tier 1: metrics from the one reference solve, ~free ----

// B = backtrack overhead (nodes/C - 1; B~0 = no-backtrack solve). Cheap cross-check against
// decisionNodes, not the primary grade — see decisionNodes for why.
export function backtrackOverhead(result, n) {
  return result.nodes / (n * n) - 1;
}

// Primary metric: real branch/guess points, not raw tree size. A long forced corridor contributes
// ~0 here even if it contributes hundreds to `nodes`. maxDecisionDepth (0..1, fraction of the grid
// filled before the deepest decision point) tells apart "hard up front" from "trap sprung late" —
// companion statistic to decisionNodes, not a separate axis to grade on.
export function metricsFor(puzzle, nodeCap = refNodeCap(puzzle.n)) {
  const r = referenceSolve(puzzle, nodeCap);
  return {
    nodes: r.nodes,
    exceeded: r.exceeded,
    unique: r.count === 1 && !r.exceeded,
    decisionNodes: r.decisionNodes || 0,
    maxDecisionDepth: r.maxDecisionDepth || 0,
    B: backtrackOverhead(r, puzzle.n),
  };
}

// ---- Tier 2: extra solves, for the design app's diagnostics — not the production grade ----

// naiveNodes: re-solve with the strong inferences (propagation, parity) turned off, keeping only
// the prunes solve.js always applies (dead-end, connectivity) — a rough stand-in for "cost without
// the solver's cleverest, least human-like tricks." naiveGap is the number that actually carries
// information: how much did prop+parity buy on this specific puzzle. A LARGE gap flags a puzzle
// that looks hard to a naive searcher but the strong prunes dissolve instantly — i.e. decisionNodes
// (computed WITH those prunes) likely under-reports what a human, who doesn't get that shortcut,
// would actually feel. A small gap means the strong prunes weren't doing much work here, so
// decisionNodes is probably closer to the real difficulty.
export function naiveGap(puzzle, referenceNodes, nodeCap = refNodeCap(puzzle.n)) {
  const naive = solve(puzzle, { limit: 2, nodeCap, prop: false, parity: false });
  return { naiveNodes: naive.nodes, naiveExceeded: naive.exceeded, naiveGap: naive.nodes - referenceNodes };
}

// legCollideDependent: does this puzzle's uniqueness actually rely on the cross-leg collision
// check? Re-check uniqueness with legCollide off; if a second solution appears (or the search can no
// longer confirm uniqueness within budget), the puzzle's only-one-answer property depends on a
// non-local inference a human essentially never makes proactively — they'd discover the collision
// by getting stuck later, not by reasoning it out. This is a FLAG to be suspicious of the numeric
// grade, not a number to blend into it (no fitted weight exists yet to combine it with — see
// regressionScore below).
export function legCollideDependent(puzzle, nodeCap = refNodeCap(puzzle.n)) {
  const without = solve(puzzle, { limit: 2, nodeCap, ...REF_FLAGS, legCollide: false });
  return without.count !== 1 || without.exceeded;
}

// First-solution cost vs. uniqueness-proof cost (limit:1 vs limit:2 on the same flags). Separate
// call because it needs its own solve() (limit changes DFS's stopping point, not just bookkeeping).
// Only worth computing where a real gap is plausible: the design app surfaces it, but it hasn't
// been validated against anything and shouldn't be assumed meaningful yet.
export function firstSolutionGap(puzzle, referenceNodes, nodeCap = refNodeCap(puzzle.n)) {
  const first = solve(puzzle, { limit: 1, nodeCap, ...REF_FLAGS });
  return { firstNodes: first.nodes, firstGap: referenceNodes - first.nodes };
}

// Every diagnostic metric at once — for the design app. 4 solve() calls total (reference, naive,
// no-legCollide, first-solution) — fine for one puzzle at a time in a design tool, NOT something to
// run per-puzzle in a batch/generation hot path (see generateAtDifficulty, which uses metricsFor
// alone: one call).
export function fullDiagnostics(puzzle, nodeCap = refNodeCap(puzzle.n)) {
  const base = metricsFor(puzzle, nodeCap);
  const gap = naiveGap(puzzle, base.nodes, nodeCap);
  const legDep = legCollideDependent(puzzle, nodeCap);
  const first = firstSolutionGap(puzzle, base.nodes, nodeCap);
  return {
    ...base, ...gap, ...first,
    legCollideDependent: legDep,
    regression: regressionScore(base, gap),
  };
}

// ---- Provisional (UNFITTED) log-linear regression ----
//
// Weights below are placeholders, not fit to any data — there is no human-outcome log yet to fit
// against (see the module comment). This exists so the design app has a formula to inspect and
// compare against decisionNodes/B while that log is being built up, NOT as a candidate production
// grade. Once real outcomes (solve time, undo count, abandon rate) are logged per puzzle, refit
// a/b/c/d against them before trusting this for anything beyond "does the shape look plausible."
export const REGRESSION_WEIGHTS = { a: 1, b: 0.8, c: 2, d: 0.3 };

export function regressionScore(base, gap, weights = REGRESSION_WEIGHTS) {
  const { a, b, c, d } = weights;
  const naiveRatio = (gap.naiveNodes + 1) / (base.nodes + 1);
  return a
    + b * Math.log(base.decisionNodes + 1)
    + c * base.maxDecisionDepth
    + d * Math.log(naiveRatio + 1);
}

// ---- Grade bucketing (0-5) ----
//
// Thresholds are cutpoints over decisionNodes, pooled ACROSS the full N range a picker offers (not
// per-N — see calibration.js for why: difficulty is non-monotone in N, so per-N quantiles would let
// "grade 4 at N=7" and "grade 4 at N=11" mean incomparable things). gradeOf is pure: it takes
// thresholds in rather than importing calibration data, so tests and the design app can pass a
// smaller/synthetic set without recomputing a real calibration.
export function gradeOf(decisionNodes, thresholds) {
  for (let g = 0; g < thresholds.length; g++) {
    if (decisionNodes < thresholds[g]) return g;
  }
  return thresholds.length; // >= the last threshold = the top grade
}
