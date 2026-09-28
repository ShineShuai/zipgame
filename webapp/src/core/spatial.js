// Checkpoint-geometry difficulty candidates: unlike difficulty.js's solver-derived metrics, these
// come from checkpoint POSITIONS alone (what's visually perceivable before solving), not from
// running the solver at all — near-zero marginal cost.
//
// STATUS, please read before using any number here: tested against a 17-puzzle hand-labeled sample
// (N=7-11). Best result was crossPerSeg at r=0.36 — weak, and with n=17 not distinguishable from
// noise (95% CI roughly [-0.15, 0.72]). Every solver-derived metric in difficulty.js scored r<0.3 or
// negative on the SAME sample, including the one (p14, human grade 5) that every metric here and
// there failed to separate from the easiest-rated puzzles (human grade 0). This is not "needs
// threshold tuning" — it's "the thing being measured may not be the thing driving human difficulty
// for at least some puzzles." Treat every export here as a candidate to keep testing, not a grade.
import { maxNumber } from './model.js';

// [r,c] for checkpoint 1..K, in sequence order (1-indexed value -> 0-indexed array position).
export function checkpointPositions(p) {
  const K = maxNumber(p);
  const pts = new Array(K + 1);
  for (let i = 0; i < p.cp.length; i++) if (p.cp[i]) pts[p.cp[i]] = [(i / p.n) | 0, i % p.n];
  return pts.slice(1);
}

function segsCross(a1, a2, b1, b2) {
  const ccw = (A, B, C) => (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}

// Count of NON-ADJACENT checkpoint-to-checkpoint straight-line segments that geometrically cross —
// adjacent segments (sharing a checkpoint endpoint) are excluded since they always "touch" trivially
// and that's not a tangle. The best-correlating candidate found so far (r=0.36 on the 17-puzzle
// sample) — still weak, see module comment.
export function segmentCrossCount(pts) {
  let count = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      if (segsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) count++;
    }
  }
  return count;
}

// Looser than segmentCrossCount: counts non-adjacent segment PAIRS whose bounding boxes overlap in
// both axes, not just ones that actually cross. A cheaper, noisier version of the same idea (r=0.34
// on the sample) — kept alongside the true-crossing count so both are inspectable, not because it's
// known to add anything segmentCrossCount doesn't already capture.
export function segmentOverlapCount(pts) {
  const boxes = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [r1, c1] = pts[i], [r2, c2] = pts[i + 1];
    boxes.push([Math.min(r1, r2), Math.max(r1, r2), Math.min(c1, c2), Math.max(c1, c2)]);
  }
  let count = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 2; j < boxes.length; j++) {
      const [r1a, r1b, c1a, c1b] = boxes[i], [r2a, r2b, c2a, c2b] = boxes[j];
      if (r1a <= r2b && r2a <= r1b && c1a <= c2b && c2a <= c1b) count++;
    }
  }
  return count;
}

// Every spatial candidate at once, plus the per-segment normalized forms actually tested (raw counts
// scale with K, so the /seg forms are the ones worth comparing across puzzles of different K).
export function spatialMetrics(p) {
  const pts = checkpointPositions(p);
  const segs = Math.max(1, pts.length - 1);
  const cross = segmentCrossCount(pts);
  const overlap = segmentOverlapCount(pts);
  return {
    K: pts.length,
    segmentCrossCount: cross, crossPerSeg: cross / segs,
    segmentOverlapCount: overlap, overlapPerSeg: overlap / segs,
  };
}
