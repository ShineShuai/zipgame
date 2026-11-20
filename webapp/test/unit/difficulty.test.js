// Unit tests of difficulty: metrics, calibration, grades, spatial metrics.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { makePuzzle } from '../../src/core/model.js';
import { makeRng } from '../../src/core/rng.js';
import { generateUnique } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import {
  metricsFor,
  referenceSolve,
  backtrackOverhead,
  gradeOf,
  refNodeCap,
} from '../../src/core/difficulty.js';
import {
  calibrate,
  calibrateAll,
  calibrateMetric,
  generateAtDifficulty,
  DEFAULT_THRESHOLDS,
  DEFAULT_THRESHOLDS_BY_METRIC,
  GRADED_METRICS,
  QUANTILES,
} from '../../src/core/gen/calibration.js';
import {
  checkpointPositions,
  segmentCrossCount,
  segmentOverlapCount,
  spatialMetrics,
} from '../../src/core/spatial.js';
import {
  gradesFor,
  gradesFromMetrics,
  playGradesFor,
  GRADE_ORDER,
} from '../../src/core/grades.js';
import { combinedScore, COMBINED_ZSCORE } from '../../src/core/gen/calibration.js';
import { trapMetrics } from '../../src/core/trap.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';
import { cachedSamples, sampleUniquePuzzles } from './helpers.js';

t('difficulty: metricsFor matches a direct referenceSolve + backtrackOverhead computation', () => {
  for (const p of sampleUniquePuzzles()) {
    const r = referenceSolve(p);
    const m = metricsFor(p);
    eq(m.nodes, r.nodes);
    eq(m.exceeded, r.exceeded);
    eq(m.decisionNodes, r.decisionNodes || 0);
    eq(m.unique, r.count === 1 && !r.exceeded);
    eq(m.B, backtrackOverhead(r, p.n));
    ok(m.B >= -1, 'B = nodes/cells - 1 is bounded below by -1 (nodes >= 0)');
  }
});

t(
  'difficulty: a larger node cap only un-truncates — metrics that finished under the default cap are identical',
  () => {
    // Tools raise the cap (tools/lib.mjs evalCap) so every rated puzzle gets real metrics instead of lower bounds.
    for (const p of sampleUniquePuzzles()) {
      const cap = refNodeCap(p.n),
        m = metricsFor(p, cap),
        big = metricsFor(p, cap * 10);
      ok(
        !big.exceeded || m.exceeded,
        'a larger cap never turns a finished solve into a capped one',
      );
      if (!m.exceeded)
        for (const k of ['nodes', 'decisionNodes', 'maxDecisionDepth', 'B', 'unique'])
          eq(big[k], m[k]);
    }
  },
);

t(
  'difficulty: gradeOf is a pure step function — monotone, respects thresholds, unbounded top bucket',
  () => {
    const thresholds = [10, 50, 200, 1000];
    eq(gradeOf(0, thresholds), 0);
    eq(gradeOf(9, thresholds), 0);
    eq(gradeOf(10, thresholds), 1);
    eq(gradeOf(999, thresholds), 3);
    eq(gradeOf(1000, thresholds), 4);
    eq(gradeOf(1e9, thresholds), 4, 'no 6th threshold => top grade is unbounded above');
    // monotone: grade never decreases as decisionNodes increases
    let last = -1;
    for (const x of [0, 1, 10, 11, 49, 50, 51, 199, 200, 999, 1000, 5000]) {
      const g = gradeOf(x, thresholds);
      ok(g >= last, `grade decreased at x=${x}`);
      last = g;
    }
  },
);

t(
  'calibration: calibrate() pools across every N in range, not per-N (thresholds shared, not per-size)',
  () => {
    // Small/fast sample: this only checks the pooling contract (one shared threshold list, and the
    // sample count matches what was actually requested), not statistical quality — see
    // tools/calibrate.mjs for a real calibration run.
    const { thresholds, samples, n } = calibrate([5, 6], 42, 3);
    eq(Array.isArray(thresholds), true);
    eq(thresholds.length, QUANTILES.length);
    ok(n <= 6, 'at most samplesPerN * number of sizes samples');
    ok(n > 0, 'expected at least one successful sample at N=5,6 with 3 tries each');
    eq(samples.length, n);
    // thresholds must be non-decreasing (they're quantile cuts over one sorted pooled array)
    for (let i = 1; i < thresholds.length; i++)
      ok(thresholds[i] >= thresholds[i - 1], 'thresholds non-decreasing');
  },
);

t('calibration: DEFAULT_THRESHOLDS is a non-decreasing array of the expected length', () => {
  eq(Array.isArray(DEFAULT_THRESHOLDS), true);
  eq(DEFAULT_THRESHOLDS.length, QUANTILES.length);
  for (let i = 1; i < DEFAULT_THRESHOLDS.length; i++)
    ok(DEFAULT_THRESHOLDS[i] >= DEFAULT_THRESHOLDS[i - 1]);
});

t(
  'calibration: every GRADED_METRICS entry has its own non-decreasing default thresholds of the expected length',
  () => {
    for (const id of Object.keys(GRADED_METRICS)) {
      const th = DEFAULT_THRESHOLDS_BY_METRIC[id];
      ok(Array.isArray(th), `${id}: missing default thresholds`);
      eq(th.length, QUANTILES.length, `${id}: threshold count`);
      for (let i = 1; i < th.length; i++)
        ok(th[i] >= th[i - 1], `${id}: thresholds must be non-decreasing`);
    }
    eq(
      DEFAULT_THRESHOLDS_BY_METRIC.decisionNodes,
      DEFAULT_THRESHOLDS,
      'decisionNodes entry must stay identical to the legacy DEFAULT_THRESHOLDS export',
    );
  },
);

t(
  'calibration: calibrateAll shares ONE generation pass across metrics — same sample count per metric, per-metric thresholds differ',
  () => {
    const res = calibrateAll([5, 6], 42, 3);
    const ids = Object.keys(GRADED_METRICS);
    eq(Object.keys(res).sort(), ids.slice().sort());
    const counts = ids.map(id => res[id].n);
    ok(
      counts.every(c => c === counts[0]),
      `every metric must be calibrated from the same puzzles (counts ${counts})`,
    );
    ok(counts[0] > 0, 'expected at least one usable sample at N=5,6');
    for (const id of ids) {
      eq(res[id].thresholds.length, QUANTILES.length);
      for (let i = 1; i < res[id].thresholds.length; i++)
        ok(res[id].thresholds[i] >= res[id].thresholds[i - 1]);
    }
    // calibrate() (legacy single-metric alias) must agree with calibrateAll's decisionNodes entry for
    // the same seed — same generation stream, same quantile cuts.
    eq(calibrate([5, 6], 42, 3).thresholds, res.decisionNodes.thresholds);
  },
);

t.slow(
  'calibration: calibrateMetric reproduces calibrateAll for the same metric/seed (single-metric path is not a different algorithm)',
  () => {
    const all = calibrateAll([5, 6], 7, 3);
    for (const id of Object.keys(GRADED_METRICS))
      eq(calibrateMetric(id, [5, 6], 7, 3).thresholds, all[id].thresholds, id);
  },
);

t(
  'calibration: generateAtDifficulty finds a matching grade across an N range, or returns null (never throws)',
  () => {
    const rnd = makeRng(555);
    const result = runSync(
      generateAtDifficulty([7, 8, 9], 2, DEFAULT_THRESHOLDS, rnd, { tries: 25 }),
    );
    if (result) {
      eq(gradeOf(result.metrics.decisionNodes, DEFAULT_THRESHOLDS), 2);
      ok([7, 8, 9].includes(result.n), 'chosen N within the requested range');
      eq(result.grade, 2);
    } // else: heuristic search legitimately found nothing in 25 tries — not itself a failure
  },
);

let _gradable = null; // computed once: each check is a full reference solve, and 4 tests below share it

const gradablePuzzles = () =>
  (_gradable ||= sampleUniquePuzzles().filter(p => !metricsFor(p).exceeded));

t(
  'grades: gradesFor returns one 0..5 integer grade per GRADE_ORDER metric, plus the raw value it bucketed',
  () => {
    ok(
      gradablePuzzles().length > 0,
      'expected at least one sample puzzle within the grading budget',
    );
    for (const p of gradablePuzzles()) {
      const g = gradesFor(p);
      ok(g, 'expected a grade for a puzzle whose reference solve fit the cap');
      eq(Object.keys(g.grades), GRADE_ORDER);
      eq(Object.keys(g.raw), GRADE_ORDER);
      for (const id of GRADE_ORDER) {
        ok(
          Number.isInteger(g.grades[id]) && g.grades[id] >= 0 && g.grades[id] <= 5,
          `${id}: grade ${g.grades[id]} out of 0..5`,
        );
        ok(Number.isFinite(g.raw[id]), `${id}: raw value must be finite`);
      }
    }
  },
);

t(
  'grades: each metric is bucketed with ITS OWN thresholds (same raw value gives different grades for different metrics)',
  () => {
    const p = gradablePuzzles()[0];
    const g = gradesFor(p);
    // Feed one identical raw value through every metric's own cutpoints: they must not all agree,
    // otherwise the thresholds were shared/reused across metrics (the bug per-metric calibration avoids).
    const same = GRADE_ORDER.map(id => gradeOf(1, DEFAULT_THRESHOLDS_BY_METRIC[id]));
    ok(new Set(same).size > 1, `identical raw value graded identically by every metric: ${same}`);
    eq(
      gradesFromMetrics(g.metrics, g.spatial).grades,
      g.grades,
      'gradesFromMetrics must reproduce gradesFor for the same solve results',
    );
  },
);

t(
  'grades: gradesFor returns null (no grade) when the reference solve cannot confirm uniqueness within the cap',
  () => {
    const p = gradablePuzzles()[0];
    ok(gradesFor(p), 'sanity: gradable within the normal cap');
    eq(
      gradesFor(p, 1),
      null,
      'a 1-node cap cannot confirm uniqueness => no grade, never a made-up one',
    );
  },
);

t('grades: decisionNodes and B are size-normalized (per cell / per N), not raw counts', () => {
  const p = gradablePuzzles()[0];
  const g = gradesFor(p);
  eq(g.raw.decisionNodes, g.metrics.decisionNodes / (p.n * p.n));
  eq(g.raw.B, g.metrics.B / p.n);
});

t(
  "grades: combinedScore is a pure function of the puzzle's own metrics (z of B/N + z of crossPerSeg)",
  () => {
    const m = { B: 10, n: 5 },
      s = { crossPerSeg: 0.2 };
    const want =
      (10 / 5 - COMBINED_ZSCORE.BperN.mean) / COMBINED_ZSCORE.BperN.sd +
      (0.2 - COMBINED_ZSCORE.cross.mean) / COMBINED_ZSCORE.cross.sd;
    ok(Math.abs(combinedScore(m, s) - want) < 1e-12);
    eq(
      combinedScore(m, s),
      combinedScore({ ...m }, { ...s }),
      'same inputs => same score, independent of any other puzzle',
    );
  },
);

t(
  'grades: hold-V still reveals the previous badge grade (decisionNodes) then B and crossPerSeg — order contract the UI relies on',
  () => {
    eq(GRADE_ORDER.slice(0, 3), ['decisionNodes', 'B', 'crossPerSeg']);
    eq(GRADE_ORDER.length, 5, 'design app shows all five');
  },
);

t('grades: playGradesFor = trap grade (badge) + unchanged legacy grades (hold-V)', () => {
  const p = cachedSamples()[0],
    pg = playGradesFor(p);
  ok(
    pg.trap.ok && Number.isInteger(pg.trap.grade) && pg.trap.grade >= 0 && pg.trap.grade <= 5,
    'trap grade 0..5',
  );
  eq(pg.trap.grade, trapMetrics(p).grade, 'badge grade is the trap grade');
  eq(
    pg.legacy.grades,
    gradesFor(p).grades,
    'legacy grades are exactly what gradesFor gave before',
  );
  eq(playGradesFor(p, undefined).trap.predicted, pg.trap.predicted, 'deterministic');
});

t(
  'grades: trap grade exists even when the reference solve is capped (legacy grades then null)',
  () => {
    const p = cachedSamples()[0];
    eq(gradesFor(p, 1), null, 'sanity: 1-node cap cannot confirm uniqueness');
    ok(trapMetrics(p).ok, 'trap grade needs only a solution path');
  },
);

t('spatial: checkpointPositions returns [r,c] in checkpoint-number order, 1-indexed input', () => {
  const p = makePuzzle(3);
  p.cp[0] = 2;
  p.cp[8] = 1;
  p.cp[4] = 3; // (0,0)=2 (2,2)=1 (1,1)=3
  eq(checkpointPositions(p), [
    [2, 2],
    [0, 0],
    [1, 1],
  ]); // index 0 = checkpoint "1", etc.
});

t(
  'spatial: segmentCrossCount finds an X-crossing between two non-adjacent segments, misses a non-crossing one',
  () => {
    // 4 checkpoints forming an X between segments (1->2) and (3->4): definitely crosses.
    const crossing = [
      [0, 0],
      [2, 2],
      [0, 2],
      [2, 0],
    ];
    eq(segmentCrossCount(crossing), 1);
    // Same 4 points, reordered so consecutive segments don't cross (a simple loop-ish path instead).
    const notCrossing = [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
    ];
    eq(segmentCrossCount(notCrossing), 0);
  },
);

t(
  'spatial: segmentCrossCount and segmentOverlapCount ignore adjacent (shared-endpoint) segments',
  () => {
    // 3 collinear points: segments (1->2),(2->3) share checkpoint 2 and always "touch" there — must
    // not be counted as a cross/overlap (there's no j>=i+2 pair to even test with only 3 points).
    const pts = [
      [0, 0],
      [0, 5],
      [0, 10],
    ];
    eq(segmentCrossCount(pts), 0);
    eq(segmentOverlapCount(pts), 0);
  },
);

t(
  'spatial: segmentOverlapCount is >= segmentCrossCount for the same points (bbox overlap is a looser test)',
  () => {
    for (const pts of [
      [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
      ],
      [
        [0, 0],
        [0, 5],
        [5, 5],
        [5, 0],
        [2, 2],
      ],
      [
        [1, 1],
        [4, 4],
        [1, 4],
        [4, 1],
        [0, 0],
      ],
    ]) {
      ok(
        segmentOverlapCount(pts) >= segmentCrossCount(pts),
        `overlap (${segmentOverlapCount(pts)}) should be >= cross (${segmentCrossCount(pts)})`,
      );
    }
  },
);

t(
  'spatial: spatialMetrics on a real generated puzzle returns finite, non-negative, K-consistent fields',
  () => {
    const p = runSync(generateUnique(8, 10, makeRng(9), { tries: 15 })).puzzle;
    const m = spatialMetrics(p);
    eq(m.K, 10);
    ok(Number.isInteger(m.segmentCrossCount) && m.segmentCrossCount >= 0);
    ok(Number.isInteger(m.segmentOverlapCount) && m.segmentOverlapCount >= 0);
    ok(m.segmentOverlapCount >= m.segmentCrossCount);
    ok(m.crossPerSeg >= 0 && m.overlapPerSeg >= 0);
    eq(m.crossPerSeg, m.segmentCrossCount / (m.K - 1));
  },
);

registerAsyncTests();
