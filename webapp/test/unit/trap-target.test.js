// Unit tests of the trap model, the ladder and targeted generation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { makePuzzle, clonePuzzle, validate, maxNumber, cellCount } from '../../src/core/model.js';
import { setWallId, wallIds } from '../../src/core/edges.js';
import { serialize, parse } from '../../src/core/format.js';
import { makeRng } from '../../src/core/rng.js';
import { solve } from '../../src/core/solver/solve.js';
import { isSolved } from '../../src/core/rules.js';
import { generate, randomPathPuzzle } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { difficultyDevHtml } from '../../src/apps/play/game-view.js';
import { S as playState } from '../../src/apps/play/state.js';
import fs from 'node:fs';
import { REF_FLAGS } from '../../src/core/difficulty.js';
import { playGradesFor } from '../../src/core/grades.js';
import { ladder as ladderRun } from '../../src/core/ladder.js';
import {
  trapProfile,
  trapMetrics,
  trapGradeOf,
  trapPredict,
  capGradeBySize,
  SIZE_GRADE_CAP,
  ladderTrials,
  TRAP_CFG,
  TRAP_MODEL,
  ARROWS_MODEL,
  modelFor,
} from '../../src/core/trap.js';
import { generateArrows } from '../../src/core/gen/arrows.js';
import { buildMoves } from '../../src/core/solver/solve-dir.js';
import {
  generateTargeted,
  targetBand,
  maxTargetGrade,
  missOf,
  proposalBudget,
  TARGET_CFG,
} from '../../src/core/gen/target.js';
import { mountDifficultyPanel } from '../../src/apps/design/difficulty-panel.js';
import { generateCutout, CUTOUT_MODEL } from '../../src/core/gen/cutout.js';
import { FAST, SLOW } from '../harness.js';
import { cachedSamples } from './helpers.js';

test('trap: metrics are deterministic, in range, and consistent with the profile', FAST, () => {
  for (const p of cachedSamples()) {
    const a = trapMetrics(p),
      b = trapMetrics(p);
    assert.ok(a.ok, 'solvable');
    assert.deepStrictEqual(a.trapMax, b.trapMax);
    assert.deepStrictEqual(a.trapTop3, b.trapTop3);
    assert.deepStrictEqual(a.altFrac, b.altFrac);
    assert.deepStrictEqual(a.grade, b.grade);
    assert.ok(a.altFrac >= 0 && a.altFrac <= 1, 'altFrac is a fraction of steps');
    assert.ok(a.trapTop3 >= a.trapMax, 'top-3 sum includes the max');
    assert.ok(Number.isInteger(a.grade) && a.grade >= 0 && a.grade <= 5, 'grade 0..5');
    assert.deepStrictEqual(a.steps[0].score, a.trapMax);
    assert.ok(
      a.steps.every((s, i) => i === 0 || a.steps[i - 1].score >= s.score),
      'steps sorted worst first',
    );
    assert.deepStrictEqual(
      trapMetrics(p, TRAP_CFG, a.path).trapMax,
      a.trapMax,
      'passing the path in skips the solve but gives the same answer',
    );
  }
});

test(
  'trap: trapSum = the scores of all steps per cell; scales with the points; not in the grade',
  FAST,
  () => {
    const file = new URL('../../tools/ratings.json', import.meta.url);
    const rated = JSON.parse(fs.readFileSync(file, 'utf8'));
    const p = parse(rated.find(r => parse(r.key).n === 7).key),
      a = trapMetrics(p);
    assert.ok(a.ok, 'the test puzzle has a solution');
    const total = a.steps.reduce((sum, x) => sum + x.score, 0);
    assert.deepStrictEqual(a.trapSum, total / cellCount(p));
    assert.ok(a.trapSum * cellCount(p) >= a.trapTop3 - 1e-9, 'the sum is at least the top-3 sum');
    assert.ok(a.trapTop3 >= a.trapMax, 'and that at least the max');
    assert.deepStrictEqual(
      trapMetrics(p, { ...TRAP_CFG, points: [0, 0, 0, 0] }).trapSum,
      0,
      'no points, no sum',
    );
    const twice = trapMetrics(p, { ...TRAP_CFG, points: TRAP_CFG.points.map(v => 2 * v) });
    assert.ok(Math.abs(twice.trapSum - 2 * a.trapSum) < 1e-9, 'twice the points, twice the sum');
    assert.ok(!TRAP_MODEL.features.includes('trapSum'), 'the grade model does not use it yet');
  },
);

test(
  'play app: the hold-V reveal shows the sum of all steps per cell next to max and top3',
  FAST,
  () => {
    const { difficulty, variant, showDev } = playState,
      saved = { difficulty, variant, showDev };
    const trap = {
      predicted: 1.23,
      trapMax: 4,
      trapTop3: 10,
      trapSum: 0.4691,
      altFrac: 0.5,
      ladTrials: 3,
    };
    Object.assign(playState, { difficulty: { trap, legacy: null }, variant: null, showDev: true });
    const shown = difficultyDevHtml();
    assert.ok(shown.includes('max 4 · top3 10 · sum 0.47'), shown.slice(0, 300));
    assert.ok(shown.includes('display:inline'), 'visible while revealed');
    playState.showDev = false;
    assert.ok(difficultyDevHtml().includes('display:none'), 'hidden otherwise');
    playState.difficulty = { trap: { ...trap, trapSum: undefined }, legacy: null };
    assert.ok(
      !difficultyDevHtml().includes('· sum '),
      'metrics without it show nothing and do not throw',
    );
    Object.assign(playState, saved);
  },
);

test(
  'trap: One way arrows — wrong turns are the moves the arrows allow, no ladder, only trapMax and trapTop3 in the score; Cutout — no altFrac term; both graded by playGradesFor',
  SLOW,
  () => {
    for (const [n, seed] of [
      [6, 3],
      [7, 4],
      [8, 3],
    ]) {
      const pa = runSync(generateArrows(n, seed)),
        g = playGradesFor(pa),
        { out } = buildMoves(pa);
      assert.ok(g.trap.ok, 'graded');
      assert.deepStrictEqual(g.legacy, null, 'no old grades for a variant');
      assert.deepStrictEqual(g.trap.ladTrials, 0, 'the undirected ladder is not run');
      const prof = trapProfile(pa, pa.path);
      assert.ok(prof.length > 0 && !prof.nonUnique, 'wrong turns, none a second solution');
      assert.ok(
        prof.every(w => [0, 1, 2, 3].some(d => out[pa.path[w.i] * 4 + d] === w.cell)),
        'every wrong turn is a move the arrows allow',
      );
      const z = k => (g.trap[k] - TRAP_MODEL.mean[k]) / TRAP_MODEL.sd[k];
      assert.ok(
        Math.abs(
          g.trap.predicted -
            (TRAP_MODEL.b +
              TRAP_MODEL.w.trapMax * z('trapMax') +
              TRAP_MODEL.w.trapTop3 * z('trapTop3')),
        ) < 1e-9,
        'score = the two trap terms',
      );
      assert.deepStrictEqual(g.trap.grade, trapMetrics(pa, TRAP_CFG, pa.path, ARROWS_MODEL).grade);
      assert.deepStrictEqual(
        playGradesFor({ ...pa, path: undefined }).trap.grade,
        g.trap.grade,
        'a shared puzzle carries no path: the same grade',
      );
    }
    const pc = runSync(generateCutout(7, 5, { boards: 1, effort: 0.1 })),
      gc = playGradesFor(pc);
    assert.deepStrictEqual(gc.legacy, null);
    assert.deepStrictEqual(gc.trap.grade, trapMetrics(pc, TRAP_CFG, pc.path, CUTOUT_MODEL).grade);
    assert.deepStrictEqual(gc.trap.grade, pc.score.grade, 'the grade the generator aimed at');
    const ps = runSync(generate(5, 1));
    assert.deepStrictEqual(modelFor(ps), TRAP_MODEL);
    assert.deepStrictEqual(modelFor(pc).w.altFrac, 0);
    assert.deepStrictEqual(ARROWS_MODEL.w.lTr, 0);
    assert.ok(TRAP_MODEL.w.lTr !== 0, 'the original model is not touched');
  },
);

test(
  'trap: cfg.pathCap is the node budget of the solve that finds the path; a puzzle carrying its path never needs it',
  FAST,
  () => {
    const p = cachedSamples()[0],
      bare = { ...p, path: null };
    assert.deepStrictEqual(
      trapMetrics(bare, { ...TRAP_CFG, pathCap: 1 }).ok,
      false,
      'a 1-node budget cannot find the path',
    );
    assert.ok(trapMetrics(bare, { ...TRAP_CFG, pathCap: 1e7 }).ok, 'a large budget does');
    assert.ok(
      trapMetrics(p, { ...TRAP_CFG, pathCap: 1 }, p.path).ok,
      'a given path skips the solve',
    );
  },
);

test(
  'trap: TRAP_MODEL carries the fit metadata the design panel displays (tools/fit-trap.mjs --write writes it)',
  FAST,
  () => {
    const f = TRAP_MODEL.fit;
    assert.ok(
      f &&
        Number.isInteger(f.n) &&
        f.n > 0 &&
        Number.isFinite(f.looRho) &&
        Number.isFinite(f.looMae) &&
        Number.isFinite(f.lambda),
      'fit = { n, lambda, looRho, looMae }',
    );
    assert.ok(
      Number.isInteger(f.of) && f.of >= f.n,
      'fit.of = size of ratings.json at fit time (>= n: unsolvable puzzles are skipped)',
    );
    for (const k of TRAP_MODEL.features)
      assert.ok(
        [TRAP_MODEL.mean[k], TRAP_MODEL.sd[k], TRAP_MODEL.w[k]].every(Number.isFinite) &&
          TRAP_MODEL.sd[k] > 0,
        `weights for ${k}`,
      );
    const c = TRAP_MODEL.cuts;
    assert.ok(
      Array.isArray(c) &&
        c.length === 5 &&
        c.every(Number.isFinite) &&
        c.every((v, i) => !i || v > c[i - 1]),
      'cuts = 5 strictly increasing score thresholds',
    );
    const a = f.looAnchors;
    assert.ok(
      a &&
        ['easy', 'hard3', 'hard4'].every(
          k => Array.isArray(a[k]) && a[k].length === 2 && a[k][0] <= a[k][1],
        ),
      'fit.looAnchors = { easy, hard3, hard4 } as [hits, total]',
    );
  },
);

test(
  'trap: grade = number of cuts reached; no cuts = the old round(); size caps apply on top',
  FAST,
  () => {
    const cuts = { cuts: [1, 2, 3, 4, 5] };
    assert.deepStrictEqual(
      [-3, 0.99, 1, 2.5, 4.99, 5, 9].map(v => trapGradeOf(v, cuts)),
      [0, 0, 1, 2, 4, 5, 5],
      'count of cuts <= score, clamped 0..5',
    );
    assert.deepStrictEqual(
      [-3, 0.4, 0.5, 2.49, 5.4, 9].map(v => trapGradeOf(v, {})),
      [0, 0, 1, 2, 5, 5],
      'a model without cuts rounds, as before',
    );
    assert.deepStrictEqual(
      [
        [5, 5],
        [5, 1],
        [6, 5],
        [6, 3],
        [7, 5],
        [11, 5],
      ].map(([n, g]) => capGradeBySize(g, n)),
      [SIZE_GRADE_CAP[5], 1, SIZE_GRADE_CAP[6], 3, 5, 5],
      '5x5 <= 2, 6x6 <= 3, larger sizes uncapped',
    );
    assert.ok(SIZE_GRADE_CAP[5] === 2 && SIZE_GRADE_CAP[6] === 3, 'the agreed caps');
  },
);

test(
  'trap: lTr = log(1 + ladder trials), capped by TRAP_CFG.ladderWorkCap, is part of the model and of every result',
  FAST,
  () => {
    assert.ok(TRAP_MODEL.features.includes('lTr'), 'the model uses lTr');
    const p = makePuzzle(5); // any solvable board: 1 at the start, 2 at the end
    p.cp[0] = 1;
    p.cp[24] = 2;
    const m = trapMetrics(p);
    assert.ok(m.ok && Number.isInteger(m.ladTrials) && m.ladTrials >= 0, 'ladTrials is a count');
    assert.ok(Math.abs(m.lTr - Math.log1p(m.ladTrials)) < 1e-12, 'lTr = log1p(ladTrials)');
    assert.deepStrictEqual(ladderTrials(p), m.ladTrials, 'ladderTrials() gives the same count');
    assert.ok(m.grade <= SIZE_GRADE_CAP[5], 'a 5x5 stays at or below its cap');
    assert.ok(m.gradeUncapped >= m.grade, 'the cap only lowers');
  },
);

// The design panel is DOM code, but its HTML building is plain string work: run the real "Compute diagnostics" path against a
// minimal fake element. (A missing TRAP_MODEL.fit once threw here, in the browser only, because nothing rendered the panel.)
function renderDiagnostics(p) {
  const el = {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    _html: '',
    set innerHTML(v) {
      this._html = v;
    },
    get innerHTML() {
      return this._html;
    },
    querySelectorAll: () => [],
    querySelector() {
      return {
        style: {},
        dataset: {},
        textContent: '',
        innerHTML: '',
        classList: { toggle() {}, add() {}, remove() {} },
        set onclick(_f) {},
        querySelectorAll: () => [],
      };
    },
  };
  mountDifficultyPanel(
    el,
    () => p,
    () => undefined,
  ).run();
  return el._html;
}

test(
  'target: the band of a grade is read from the model cuts; open at both ends; the size cap makes a lower grade the top one',
  FAST,
  () => {
    const m = { cuts: [1, 2, 3, 4, 5] }; // spacing 1, margin 0.15
    const b0 = targetBand(0, 9, m),
      b2 = targetBand(2, 9, m),
      b5 = targetBand(5, 9, m);
    assert.deepStrictEqual([b0.lo, b0.hi, b0.a, b0.b], [-Infinity, 1, -Infinity, 0.85]);
    assert.deepStrictEqual(
      [b2.lo, b2.hi, b2.a, b2.b].map(x => +x.toFixed(2)),
      [2, 3, 2.15, 2.85],
    );
    assert.deepStrictEqual(
      [b5.lo, b5.hi, b5.a, b5.b].map(x => +x.toFixed(2)),
      [5, Infinity, 5.15, Infinity],
    );
    assert.deepStrictEqual(
      [maxTargetGrade(5, m), maxTargetGrade(6, m), maxTargetGrade(9, m), maxTargetGrade(9, {})],
      [SIZE_GRADE_CAP[5], SIZE_GRADE_CAP[6], 5, 5],
    );
    const c5 = targetBand(5, 5, m); // a 5x5 never shows more than SIZE_GRADE_CAP[5], so that grade is open above
    assert.deepStrictEqual([c5.grade, c5.hi], [SIZE_GRADE_CAP[5], Infinity]);
    const narrow = targetBand(1, 9, { cuts: [1, 1.1, 3, 4, 5] }); // a fitted band thinner than the margin shrinks it to 30% per side
    assert.deepStrictEqual(
      [narrow.a, narrow.b].map(x => +x.toFixed(2)),
      [1.03, 1.07],
    );
    assert.deepStrictEqual(
      [missOf(0.5, b2), missOf(2.5, b2), missOf(3.4, b2)].map(x => +x.toFixed(2)),
      [1.65, 0, 0.55],
    );
  },
);

test(
  'target: generateTargeted is deterministic and returns a unique puzzle whose reported grade is its trap grade',
  SLOW,
  () => {
    for (const [n, g, seed] of [
      [6, 1, 1],
      [7, 3, 2],
    ]) {
      const a = runSync(generateTargeted(n, g, seed)),
        b = runSync(generateTargeted(n, g, seed));
      assert.ok(a.puzzle && a.unique, 'a puzzle');
      assert.deepStrictEqual(
        serialize(a.puzzle),
        serialize(b.puzzle),
        'same seed + target = same puzzle',
      );
      const r = solve(a.puzzle, { limit: 2, nodeCap: 300000, ...REF_FLAGS });
      assert.ok(r.count === 1 && !r.exceeded, 'unique');
      assert.ok(isSolved(a.puzzle, a.puzzle.path), 'its path is the solution');
      const m = trapMetrics(a.puzzle);
      assert.deepStrictEqual(m.grade, a.grade, 'reported grade = the Play badge grade');
      assert.ok(Math.abs(m.predicted - a.pred) < 1e-9, 'reported score = trapPredicted');
      assert.deepStrictEqual(a.hit, a.grade === a.target);
      assert.deepStrictEqual(a.puzzle.seed, seed);
      const Kmin = Math.max(4, n),
        Kmax = Math.max(Kmin + 1, Math.round((n * n) / 4));
      assert.ok(
        a.K >= Kmin && a.K <= Kmax && a.K === maxNumber(a.puzzle),
        `K ${a.K} stays in generate()'s range ${Kmin}..${Kmax}`,
      );
    }
  },
);

test(
  'target: every grade the generator can show is reachable (this is what to look at after a refit: node tools/target-eval.mjs)',
  SLOW,
  () => {
    let hit = 0,
      total = 0;
    for (const g of [0, 1, 2, 3])
      for (const seed of [1, 2]) {
        const r = runSync(generateTargeted(7, g, seed * 31 + g));
        total++;
        if (r.hit) hit++;
      }
    assert.ok(hit >= 0.75 * total, `${hit}/${total} targets hit at 7x7, grades 0-3`);
  },
);

test(
  'target: wall-minimal mode keeps only needed walls and the reported grade is the grade of that puzzle; the retry cap stops the search and returns the closest puzzle',
  SLOW,
  () => {
    const r = runSync(generateTargeted(7, 3, 4)),
      p = r.puzzle;
    assert.ok(r.minimal === true, 'minimal by default');
    for (const w of wallIds(p)) {
      // dropping any single wall must give a second solution (or an undecided check): the wall is needed
      const q = clonePuzzle(p);
      setWallId(q.walls, w, false);
      assert.ok(
        solve(q, { limit: 2, nodeCap: 300000, ...REF_FLAGS }).count !== 1,
        'a wall of the result is not needed',
      );
    }
    assert.deepStrictEqual(trapMetrics(p).grade, r.grade, 'grade read on the stripped puzzle');
    const off = runSync(generateTargeted(7, 3, 4, { minimize: false }));
    assert.ok(
      off.minimal === false && validate(off.puzzle).ok,
      'minimize:false = the first version',
    );
    const c = runSync(generateTargeted(8, 5, 3, { retries: 1, effort: 0.2 }));
    assert.ok(
      c.puzzle &&
        validate(c.puzzle).ok &&
        c.tries === 1 &&
        c.proposals <= proposalBudget(8, 0.2) + 2,
      'one try of little depth ends the run and returns the closest puzzle',
    );
  },
);

test(
  'target: the retry cap is a count (same arguments = same puzzle), more retries only add tries, and the limits hold',
  SLOW,
  () => {
    const a = runSync(generateTargeted(7, 4, 3, { retries: 1 })),
      a2 = runSync(generateTargeted(7, 4, 3, { retries: 1 })),
      b = runSync(generateTargeted(7, 4, 3, { retries: 3 }));
    assert.deepStrictEqual(
      [serialize(a.puzzle), a.proposals],
      [serialize(a2.puzzle), a2.proposals],
      'deterministic',
    );
    assert.ok(
      b.tries <= 3 && b.tries >= a.tries && b.proposals >= a.proposals,
      'retries only add tries',
    );
    if (a.hit)
      assert.deepStrictEqual(
        serialize(b.puzzle),
        serialize(a.puzzle),
        'a run that hit in its first try is the same with more retries',
      );
    const l = runSync(
      generateTargeted(7, 3, 5, { retries: Infinity, maxWalls: 12, maxCheckpoints: 8 }),
    );
    assert.ok(l.hit && l.walls <= 12 && l.K <= 8, `limits: ${l.walls} walls, ${l.K} checkpoints`);
  },
);

test(
  'ladder: the incremental territory (distances kept per state, cut fields re-run, exact edge test skipped when nothing changed) = the from-scratch one',
  SLOW,
  () => {
    const strip = r => JSON.stringify({ ...r, ms: 0 });
    let skipped = 0;
    for (let n = 5; n <= 8; n++)
      for (let seed = 1; seed <= 3; seed++) {
        const rnd = makeRng(seed * 31 + n),
          p = randomPathPuzzle(n, [3, n, n + 2][seed - 1], rnd),
          stats = {};
        for (const o of [{ workCap: 2e4 }, { workCap: 2e4, probeDepth: 1, search: false }]) {
          assert.deepStrictEqual(
            strip(ladderRun(p, { ...o, stats })),
            strip(ladderRun(p, { ...o, incrTerritory: false })),
            `${n}x${n} seed ${seed}`,
          );
        }
        skipped += stats.skipped || 0;
      }
    assert.ok(skipped > 0, 'the territory pass was skipped when nothing had changed');
  },
);

test(
  'target: witnesses make wall stripping cheaper without changing it, guided moves and the checkpoint range work',
  SLOW,
  () => {
    for (const [n, g, seed] of [
      [6, 2, 5],
      [7, 3, 4],
      [7, 4, 3],
    ]) {
      const plain = runSync(generateTargeted(n, g, seed, { retries: 2, freedEdge: false })),
        wit = runSync(generateTargeted(n, g, seed, { retries: 2 }));
      assert.deepStrictEqual(
        [serialize(wit.puzzle), wit.proposals, wit.pred],
        [serialize(plain.puzzle), plain.proposals, plain.pred],
        `${n}x${n} g${g}: plain uniqueness checks vs freed-edge searches + witnesses`,
      );
      assert.ok(wit.stats.witnessSkips > 0, 'a witness replaced a search');
      const gd = runSync(generateTargeted(n, g, seed, { retries: 2, guided: true }));
      assert.ok(
        gd.puzzle && validate(gd.puzzle).ok,
        'guided moves keep the puzzle valid and unique',
      );
    }
    const k = runSync(
      generateTargeted(7, 3, 2, { retries: 3, minCheckpoints: 8, maxCheckpoints: 8 }),
    );
    assert.deepStrictEqual(k.K, 8, 'min = max checkpoints: exactly that many');
  },
);

test(
  'target: the prefilter and the score cache change the time, never the result; the ladder trial cap is a lower bound',
  SLOW,
  () => {
    for (const [n, g, seed] of [
      [6, 2, 5],
      [7, 3, 4],
      [7, 4, 3],
    ]) {
      const slow = runSync(
          generateTargeted(n, g, seed, { retries: 2, prefilter: false, cache: false }),
        ),
        fast = runSync(generateTargeted(n, g, seed, { retries: 2 }));
      assert.deepStrictEqual(
        [serialize(fast.puzzle), fast.proposals, fast.pred, fast.grade],
        [serialize(slow.puzzle), slow.proposals, slow.pred, slow.grade],
        `${n}x${n} g${g}`,
      );
      assert.ok(fast.stats.cacheHits + fast.stats.uniqueHits > 0, 'the cache is used');
    }
    const p = runSync(generateTargeted(7, 3, 4)).puzzle,
      full = ladderTrials(p);
    assert.ok(full > 3, 'the sample ladder makes some trials');
    assert.deepStrictEqual(
      [
        ladderTrials(p, TRAP_CFG, 3),
        ladderTrials(p, TRAP_CFG, full),
        ladderTrials(p, TRAP_CFG, full + 50),
      ],
      [4, full, full],
      'a cap below the count stops at cap + 1, a cap at or above it changes nothing',
    );
  },
);

test(
  'target: a grade the size cannot show is clamped (5x5 <= its cap), the budget scales with effort, events report progress',
  FAST,
  () => {
    const events = [],
      r = runSync(generateTargeted(5, 5, 7, { effort: 0.5 }), e => events.push(e));
    assert.deepStrictEqual([r.requested, r.target], [5, SIZE_GRADE_CAP[5]]);
    assert.ok(r.grade <= SIZE_GRADE_CAP[5], 'capped grade');
    assert.ok(
      r.tries <= TARGET_CFG.retries &&
        r.proposals <= TARGET_CFG.retries * (proposalBudget(5, 0.5) + 1),
      'stays within retries x depth',
    );
    assert.ok(
      proposalBudget(7, 2) > proposalBudget(7, 1) && proposalBudget(7, 1) > proposalBudget(5, 1),
      'budget grows with effort and size',
    );
    assert.ok(
      events.length > 0 && events.every(e => e.frac >= 0 && e.frac <= 1 && e.target === r.target),
      'events: frac in 0..1, target',
    );
    assert.ok(
      events.every((e, i) => i === 0 || e.frac >= events[i - 1].frac),
      'progress never goes back',
    );
  },
);

test(
  'design panel: Compute diagnostics renders trap + ladder sections without NaN/undefined',
  FAST,
  () => {
    const html = renderDiagnostics(cachedSamples()[0]);
    assert.ok(
      html.includes('Trap grade (candidate)') && html.includes('Technique ladder (candidate)'),
      'both sections',
    );
    assert.ok(!/NaN|undefined/.test(html), 'no NaN/undefined in the panel');
    assert.ok(
      html.includes(`fit to ${TRAP_MODEL.fit.n} hand ratings`),
      'fit size comes from TRAP_MODEL.fit',
    );
  },
);

test(
  'design panel: still renders when TRAP_MODEL has no fit metadata (older trap.js)',
  FAST,
  () => {
    const saved = TRAP_MODEL.fit;
    delete TRAP_MODEL.fit;
    try {
      assert.ok(
        renderDiagnostics(cachedSamples()[0]).includes('Trap grade (candidate)'),
        'renders',
      );
    } finally {
      TRAP_MODEL.fit = saved;
    }
  },
);

test(
  'trap: no solution -> { ok:false } instead of a made-up grade; grade clamps to 0..5',
  FAST,
  () => {
    const p = makePuzzle(4);
    p.cp[0] = 1;
    p.cp[15] = 2;
    p.cp[5] = 3; // 1 -> 2 -> 3 order cannot be a Hamiltonian path here
    const r = trapMetrics(p);
    assert.ok(!r.ok && typeof r.reason === 'string', 'unsolvable puzzle reports why');
    assert.deepStrictEqual(
      trapPredict(
        { trapMax: 0, trapTop3: 0, altFrac: 0 },
        {
          features: ['trapMax'],
          mean: { trapMax: 0 },
          sd: { trapMax: 2 },
          w: { trapMax: 1 },
          b: 1,
        },
      ),
      1,
    );
  },
);
