// Unit tests of difficulty: metrics, calibration, grades, spatial metrics.
import assert from 'node:assert/strict';
import { test } from 'node:test';
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
import { FAST, SLOW } from '../harness.js';
import { cachedSamples, sampleUniquePuzzles } from './helpers.js';

test(
  'difficulty: metricsFor matches a direct referenceSolve + backtrackOverhead computation',
  FAST,
  () => {
    for (const p of sampleUniquePuzzles()) {
      const r = referenceSolve(p);
      const m = metricsFor(p);
      assert.deepStrictEqual(m.nodes, r.nodes);
      assert.deepStrictEqual(m.exceeded, r.exceeded);
      assert.deepStrictEqual(m.decisionNodes, r.decisionNodes || 0);
      assert.deepStrictEqual(m.unique, r.count === 1 && !r.exceeded);
      assert.deepStrictEqual(m.B, backtrackOverhead(r, p.n));
      assert.ok(m.B >= -1, 'B = nodes/cells - 1 is bounded below by -1 (nodes >= 0)');
    }
  },
);

test(
  'difficulty: a larger node cap only un-truncates — metrics that finished under the default cap are identical',
  FAST,
  () => {
    // Tools raise the cap (tools/lib.mjs evalCap) so every rated puzzle gets real metrics instead of lower bounds.
    for (const p of sampleUniquePuzzles()) {
      const cap = refNodeCap(p.n),
        m = metricsFor(p, cap),
        big = metricsFor(p, cap * 10);
      assert.ok(
        !big.exceeded || m.exceeded,
        'a larger cap never turns a finished solve into a capped one',
      );
      if (!m.exceeded)
        for (const k of ['nodes', 'decisionNodes', 'maxDecisionDepth', 'B', 'unique'])
          assert.deepStrictEqual(big[k], m[k]);
    }
  },
);

test(
  'difficulty: gradeOf is a pure step function — monotone, respects thresholds, unbounded top bucket',
  FAST,
  () => {
    const thresholds = [10, 50, 200, 1000];
    assert.deepStrictEqual(gradeOf(0, thresholds), 0);
    assert.deepStrictEqual(gradeOf(9, thresholds), 0);
    assert.deepStrictEqual(gradeOf(10, thresholds), 1);
    assert.deepStrictEqual(gradeOf(999, thresholds), 3);
    assert.deepStrictEqual(gradeOf(1000, thresholds), 4);
    assert.deepStrictEqual(
      gradeOf(1e9, thresholds),
      4,
      'no 6th threshold => top grade is unbounded above',
    );
    // monotone: grade never decreases as decisionNodes increases
    let last = -1;
    for (const x of [0, 1, 10, 11, 49, 50, 51, 199, 200, 999, 1000, 5000]) {
      const g = gradeOf(x, thresholds);
      assert.ok(g >= last, `grade decreased at x=${x}`);
      last = g;
    }
  },
);

test(
  'calibration: calibrate() pools across every N in range, not per-N (thresholds shared, not per-size)',
  FAST,
  () => {
    // Small/fast sample: this only checks the pooling contract (one shared threshold list, and the
    // sample count matches what was actually requested), not statistical quality — see
    // tools/calibrate.mjs for a real calibration run.
    const { thresholds, samples, n } = calibrate([5, 6], 42, 3);
    assert.deepStrictEqual(Array.isArray(thresholds), true);
    assert.deepStrictEqual(thresholds.length, QUANTILES.length);
    assert.ok(n <= 6, 'at most samplesPerN * number of sizes samples');
    assert.ok(n > 0, 'expected at least one successful sample at N=5,6 with 3 tries each');
    assert.deepStrictEqual(samples.length, n);
    // thresholds must be non-decreasing (they're quantile cuts over one sorted pooled array)
    for (let i = 1; i < thresholds.length; i++)
      assert.ok(thresholds[i] >= thresholds[i - 1], 'thresholds non-decreasing');
  },
);

test(
  'calibration: DEFAULT_THRESHOLDS is a non-decreasing array of the expected length',
  FAST,
  () => {
    assert.deepStrictEqual(Array.isArray(DEFAULT_THRESHOLDS), true);
    assert.deepStrictEqual(DEFAULT_THRESHOLDS.length, QUANTILES.length);
    for (let i = 1; i < DEFAULT_THRESHOLDS.length; i++)
      assert.ok(DEFAULT_THRESHOLDS[i] >= DEFAULT_THRESHOLDS[i - 1]);
  },
);

test(
  'calibration: every GRADED_METRICS entry has its own non-decreasing default thresholds of the expected length',
  FAST,
  () => {
    for (const id of Object.keys(GRADED_METRICS)) {
      const th = DEFAULT_THRESHOLDS_BY_METRIC[id];
      assert.ok(Array.isArray(th), `${id}: missing default thresholds`);
      assert.deepStrictEqual(th.length, QUANTILES.length, `${id}: threshold count`);
      for (let i = 1; i < th.length; i++)
        assert.ok(th[i] >= th[i - 1], `${id}: thresholds must be non-decreasing`);
    }
    assert.deepStrictEqual(
      DEFAULT_THRESHOLDS_BY_METRIC.decisionNodes,
      DEFAULT_THRESHOLDS,
      'decisionNodes entry must stay identical to the legacy DEFAULT_THRESHOLDS export',
    );
  },
);

test(
  'calibration: calibrateAll shares ONE generation pass across metrics — same sample count per metric, per-metric thresholds differ',
  FAST,
  () => {
    const res = calibrateAll([5, 6], 42, 3);
    const ids = Object.keys(GRADED_METRICS);
    assert.deepStrictEqual(Object.keys(res).sort(), ids.slice().sort());
    const counts = ids.map(id => res[id].n);
    assert.ok(
      counts.every(c => c === counts[0]),
      `every metric must be calibrated from the same puzzles (counts ${counts})`,
    );
    assert.ok(counts[0] > 0, 'expected at least one usable sample at N=5,6');
    for (const id of ids) {
      assert.deepStrictEqual(res[id].thresholds.length, QUANTILES.length);
      for (let i = 1; i < res[id].thresholds.length; i++)
        assert.ok(res[id].thresholds[i] >= res[id].thresholds[i - 1]);
    }
    // calibrate() (legacy single-metric alias) must agree with calibrateAll's decisionNodes entry for
    // the same seed — same generation stream, same quantile cuts.
    assert.deepStrictEqual(calibrate([5, 6], 42, 3).thresholds, res.decisionNodes.thresholds);
  },
);

test(
  'calibration: calibrateMetric reproduces calibrateAll for the same metric/seed (single-metric path is not a different algorithm)',
  SLOW,
  () => {
    const all = calibrateAll([5, 6], 7, 3);
    for (const id of Object.keys(GRADED_METRICS))
      assert.deepStrictEqual(calibrateMetric(id, [5, 6], 7, 3).thresholds, all[id].thresholds, id);
  },
);

test(
  'calibration: generateAtDifficulty finds a matching grade across an N range, or returns null (never throws)',
  FAST,
  () => {
    const rnd = makeRng(555);
    const result = runSync(
      generateAtDifficulty([7, 8, 9], 2, DEFAULT_THRESHOLDS, rnd, { tries: 25 }),
    );
    if (result) {
      assert.deepStrictEqual(gradeOf(result.metrics.decisionNodes, DEFAULT_THRESHOLDS), 2);
      assert.ok([7, 8, 9].includes(result.n), 'chosen N within the requested range');
      assert.deepStrictEqual(result.grade, 2);
    } // else: heuristic search legitimately found nothing in 25 tries — not itself a failure
  },
);

let _gradable = null; // computed once: each check is a full reference solve, and 4 tests below share it

const gradablePuzzles = () =>
  (_gradable ||= sampleUniquePuzzles().filter(p => !metricsFor(p).exceeded));

test(
  'grades: gradesFor returns one 0..5 integer grade per GRADE_ORDER metric, plus the raw value it bucketed',
  FAST,
  () => {
    assert.ok(
      gradablePuzzles().length > 0,
      'expected at least one sample puzzle within the grading budget',
    );
    for (const p of gradablePuzzles()) {
      const g = gradesFor(p);
      assert.ok(g, 'expected a grade for a puzzle whose reference solve fit the cap');
      assert.deepStrictEqual(Object.keys(g.grades), GRADE_ORDER);
      assert.deepStrictEqual(Object.keys(g.raw), GRADE_ORDER);
      for (const id of GRADE_ORDER) {
        assert.ok(
          Number.isInteger(g.grades[id]) && g.grades[id] >= 0 && g.grades[id] <= 5,
          `${id}: grade ${g.grades[id]} out of 0..5`,
        );
        assert.ok(Number.isFinite(g.raw[id]), `${id}: raw value must be finite`);
      }
    }
  },
);

test(
  'grades: each metric is bucketed with ITS OWN thresholds (same raw value gives different grades for different metrics)',
  FAST,
  () => {
    const p = gradablePuzzles()[0];
    const g = gradesFor(p);
    // Feed one identical raw value through every metric's own cutpoints: they must not all agree,
    // otherwise the thresholds were shared/reused across metrics (the bug per-metric calibration avoids).
    const same = GRADE_ORDER.map(id => gradeOf(1, DEFAULT_THRESHOLDS_BY_METRIC[id]));
    assert.ok(
      new Set(same).size > 1,
      `identical raw value graded identically by every metric: ${same}`,
    );
    assert.deepStrictEqual(
      gradesFromMetrics(g.metrics, g.spatial).grades,
      g.grades,
      'gradesFromMetrics must reproduce gradesFor for the same solve results',
    );
  },
);

test(
  'grades: gradesFor returns null (no grade) when the reference solve cannot confirm uniqueness within the cap',
  FAST,
  () => {
    const p = gradablePuzzles()[0];
    assert.ok(gradesFor(p), 'sanity: gradable within the normal cap');
    assert.deepStrictEqual(
      gradesFor(p, 1),
      null,
      'a 1-node cap cannot confirm uniqueness => no grade, never a made-up one',
    );
  },
);

test(
  'grades: decisionNodes and B are size-normalized (per cell / per N), not raw counts',
  FAST,
  () => {
    const p = gradablePuzzles()[0];
    const g = gradesFor(p);
    assert.deepStrictEqual(g.raw.decisionNodes, g.metrics.decisionNodes / (p.n * p.n));
    assert.deepStrictEqual(g.raw.B, g.metrics.B / p.n);
  },
);

test(
  "grades: combinedScore is a pure function of the puzzle's own metrics (z of B/N + z of crossPerSeg)",
  FAST,
  () => {
    const m = { B: 10, n: 5 },
      s = { crossPerSeg: 0.2 };
    const want =
      (10 / 5 - COMBINED_ZSCORE.BperN.mean) / COMBINED_ZSCORE.BperN.sd +
      (0.2 - COMBINED_ZSCORE.cross.mean) / COMBINED_ZSCORE.cross.sd;
    assert.ok(Math.abs(combinedScore(m, s) - want) < 1e-12);
    assert.deepStrictEqual(
      combinedScore(m, s),
      combinedScore({ ...m }, { ...s }),
      'same inputs => same score, independent of any other puzzle',
    );
  },
);

test(
  'grades: hold-V still reveals the previous badge grade (decisionNodes) then B and crossPerSeg — order contract the UI relies on',
  FAST,
  () => {
    assert.deepStrictEqual(GRADE_ORDER.slice(0, 3), ['decisionNodes', 'B', 'crossPerSeg']);
  },
);

test('grades: playGradesFor = trap grade (badge) + unchanged legacy grades (hold-V)', FAST, () => {
  const p = cachedSamples()[0],
    pg = playGradesFor(p);
  assert.ok(
    pg.trap.ok && Number.isInteger(pg.trap.grade) && pg.trap.grade >= 0 && pg.trap.grade <= 5,
    'trap grade 0..5',
  );
  assert.deepStrictEqual(pg.trap.grade, trapMetrics(p).grade, 'badge grade is the trap grade');
  assert.deepStrictEqual(
    pg.legacy.grades,
    gradesFor(p).grades,
    'legacy grades are exactly what gradesFor gave before',
  );
  assert.deepStrictEqual(
    playGradesFor(p, undefined).trap.predicted,
    pg.trap.predicted,
    'deterministic',
  );
});

test(
  'grades: trap grade exists even when the reference solve is capped (legacy grades then null)',
  FAST,
  () => {
    const p = cachedSamples()[0];
    assert.deepStrictEqual(gradesFor(p, 1), null, 'sanity: 1-node cap cannot confirm uniqueness');
    assert.ok(trapMetrics(p).ok, 'trap grade needs only a solution path');
  },
);

test(
  'spatial: checkpointPositions returns [r,c] in checkpoint-number order, 1-indexed input',
  FAST,
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 2;
    p.cp[8] = 1;
    p.cp[4] = 3; // (0,0)=2 (2,2)=1 (1,1)=3
    assert.deepStrictEqual(checkpointPositions(p), [
      [2, 2],
      [0, 0],
      [1, 1],
    ]); // index 0 = checkpoint "1", etc.
  },
);

test(
  'spatial: segmentCrossCount finds an X-crossing between two non-adjacent segments, misses a non-crossing one',
  FAST,
  () => {
    // 4 checkpoints forming an X between segments (1->2) and (3->4): definitely crosses.
    const crossing = [
      [0, 0],
      [2, 2],
      [0, 2],
      [2, 0],
    ];
    assert.deepStrictEqual(segmentCrossCount(crossing), 1);
    // Same 4 points, reordered so consecutive segments don't cross (a simple loop-ish path instead).
    const notCrossing = [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
    ];
    assert.deepStrictEqual(segmentCrossCount(notCrossing), 0);
  },
);

test(
  'spatial: segmentCrossCount and segmentOverlapCount ignore adjacent (shared-endpoint) segments',
  FAST,
  () => {
    // 3 collinear points: segments (1->2),(2->3) share checkpoint 2 and always "touch" there — must
    // not be counted as a cross/overlap (there's no j>=i+2 pair to even test with only 3 points).
    const pts = [
      [0, 0],
      [0, 5],
      [0, 10],
    ];
    assert.deepStrictEqual(segmentCrossCount(pts), 0);
    assert.deepStrictEqual(segmentOverlapCount(pts), 0);
  },
);

test(
  'spatial: segmentOverlapCount is >= segmentCrossCount for the same points (bbox overlap is a looser test)',
  FAST,
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
      assert.ok(
        segmentOverlapCount(pts) >= segmentCrossCount(pts),
        `overlap (${segmentOverlapCount(pts)}) should be >= cross (${segmentCrossCount(pts)})`,
      );
    }
  },
);

test(
  'spatial: spatialMetrics on a real generated puzzle returns finite, non-negative, K-consistent fields',
  FAST,
  () => {
    const p = runSync(generateUnique(8, 10, makeRng(9), { tries: 15 })).puzzle;
    const m = spatialMetrics(p);
    assert.deepStrictEqual(m.K, 10);
    assert.ok(Number.isInteger(m.segmentCrossCount) && m.segmentCrossCount >= 0);
    assert.ok(Number.isInteger(m.segmentOverlapCount) && m.segmentOverlapCount >= 0);
    assert.ok(m.segmentOverlapCount >= m.segmentCrossCount);
    assert.ok(m.crossPerSeg >= 0 && m.overlapPerSeg >= 0);
    assert.deepStrictEqual(m.crossPerSeg, m.segmentCrossCount / (m.K - 1));
  },
);
