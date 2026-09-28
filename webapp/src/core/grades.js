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

// Order the grades are shown in. The first is the one the play app always displays; the next two
// are revealed by hold-V; the design app shows all of them.
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
