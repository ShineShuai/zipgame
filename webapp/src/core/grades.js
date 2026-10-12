// All calibrated 0-5 gradings for one puzzle, computed together so the play and design apps can
// never disagree about what a puzzle's grades are. Cost: ONE reference solve() (metricsFor) plus the
// geometry-only spatialMetrics() — no extra solves per additional grade, since every grade in
// GRADED_METRICS is derived from those two shared results.
//
// Each metric is bucketed with ITS OWN thresholds (DEFAULT_THRESHOLDS_BY_METRIC), never another
// metric's: B, decisionNodes and crossPerSeg live on completely different numeric scales.
//
// None of these grades is validated against human difficulty — on a 25-puzzle hand-rated sample
// every one correlated weakly (see difficulty.js / spatial.js module comments). They exist so
// several candidate gradings can be compared side by side against real ratings.
import { metricsFor, gradeOf, refNodeCap } from './difficulty.js';
import { spatialMetrics } from './spatial.js';
import { GRADED_METRICS, DEFAULT_THRESHOLDS_BY_METRIC } from './gen/calibration.js';
import { trapMetrics, capGradeBySize } from './trap.js';

// Order the calibrated (solver/geometry) grades are shown in. The play app's badge is the median of the TRAP grade
// (core/trap.js) and the first three here (see BADGE_METRICS) — the old badge decisionNodes, then B and
// crossPerSeg, which hold-V reveals; the design app shows all of them plus the trap grade.
export const GRADE_ORDER = ['decisionNodes', 'B', 'crossPerSeg', 'overlapPerSeg', 'combined'];

// Returns null when the reference solve could not confirm uniqueness within budget (no grades then),
// otherwise { metrics, spatial, raw: {id: value}, grades: {id: 0..5} }.
export function gradesFor(puzzle, nodeCap = refNodeCap(puzzle.n), thresholdsById = DEFAULT_THRESHOLDS_BY_METRIC) {
  const metrics = { ...metricsFor(puzzle, nodeCap), n: puzzle.n };
  if (metrics.exceeded) return null;
  return gradesFromMetrics(metrics, spatialMetrics(puzzle), thresholdsById);
}

// Same, from already-computed metricsFor()/spatialMetrics() results — for callers (the design
// app's full diagnostics) that already ran the solve and must not pay for it twice.
export function gradesFromMetrics(metrics, spatial, thresholdsById = DEFAULT_THRESHOLDS_BY_METRIC) {
  const raw = {}, grades = {};
  for (const id of GRADE_ORDER) {
    raw[id] = GRADED_METRICS[id].fromMetrics(metrics, spatial);
    grades[id] = gradeOf(raw[id], thresholdsById[id]);
  }
  return { metrics, spatial, raw, grades };
}

// The reference solve's node budget for the play app's grades (nodes; the default of gradesFor, refNodeCap, is 9000 up to 12x12 and
// stops at the puzzles that are hard for the solver, which are the very puzzles the badge is about: 4 of 6 generated 8x8 and all 6 of
// 9x9 and 10x10 puzzles of the hardest target were capped). A generated play puzzle needs up to ~400k nodes at 10x10 (~0.6 s), most
// of them under 50k; 200k nodes cost at most about 0.3 s once, when the game starts.
export const PLAY_REF_CAP = 200000;

// The grades the play app computes and shows (the badge, and hold-V): the trap grade and the three old calibrated grades. None of them
// is validated well enough to be the badge alone (the trap grade is the best of them on the hand ratings but the targeted generator
// searches for exactly what it scores, so its top grades are over-claimed), so the badge is their median.
export const BADGE_METRICS = ['trap', 'decisionNodes', 'B', 'crossPerSeg'];

// Median of integer grades; with an even count the LOWER of the two middle ones (a badge that errs low, not high: on the hand-rated
// puzzles it has no bias, the upper median reads +0.5 too hard). [] -> null.
export function medianGrade(grades) {
  if (!grades.length) return null;
  const a = [...grades].sort((x, y) => x - y);
  return a[Math.ceil(a.length / 2) - 1];
}

// The play badge from the trap result, the legacy grades (null when the reference solve was capped) and the geometry-only crossPerSeg
// grade (needs no solve, so it counts even then). { grade 0..5 (size-capped like the trap grade), parts: { metric: grade } } of the
// metrics available; null when the trap grade does not exist (no solution path found).
export function badgeFrom(puzzle, trap, legacy) {
  if (!trap || !trap.ok) return null;
  const parts = { trap: trap.grade };
  if (legacy) {
    parts.decisionNodes = legacy.grades.decisionNodes;
    parts.B = legacy.grades.B;
    parts.crossPerSeg = legacy.grades.crossPerSeg;
  } else {
    parts.crossPerSeg = gradeOf(spatialMetrics(puzzle).crossPerSeg, DEFAULT_THRESHOLDS_BY_METRIC.crossPerSeg);
  }
  return { grade: capGradeBySize(medianGrade(BADGE_METRICS.filter(id => id in parts).map(id => parts[id])), puzzle.n), parts };
}

// What the play app grades a puzzle with: { trap, legacy, badge }.
//   trap   = trapMetrics() — the best single grade. It needs only a solution path (the generator's own),
//            so it exists even when the reference solve below is capped. { ok:false } if none is found.
//   legacy = gradesFor() — the previous calibrated grades (decisionNodes, B, crossPerSeg, ...), shown on hold-V;
//            null when the reference solve is capped (nodeCap, default PLAY_REF_CAP).
//   badge  = badgeFrom(): the median of the grades above (the badge the player sees); null without a trap grade.
export function playGradesFor(puzzle, nodeCap = PLAY_REF_CAP) {
  const trap = trapMetrics(puzzle), legacy = gradesFor(puzzle, nodeCap);
  return { trap, legacy, badge: badgeFrom(puzzle, trap, legacy) };
}
