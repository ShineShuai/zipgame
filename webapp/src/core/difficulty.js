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
// reference metric because its O(K^2) cost profile differs enough
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
