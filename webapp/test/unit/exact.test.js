// Tests of the Exact puzzle (Hidato style: the number of a cell is its step on the path): the core
// (model, rules, plain-text format, and the exact-aware solver checked against a plain
// brute-force search), the generator (gen/exact.js) and the variant in the play app, in what is
// pure in it (variants.js, icons.js, board.js, the share link, the legs of the colour strip, the
// grade model).
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  makePuzzle,
  clonePuzzle,
  validate,
  cellCount,
  labelCount,
  numberedCells,
  checkpointCells,
  exactRanks,
  exactLegProblem,
  startCell,
  endCell,
  labelRanks,
} from '../../src/core/model.js';
import { isSolved, step, canStep } from '../../src/core/rules.js';
import { serialize, parse } from '../../src/core/format.js';
import { solve } from '../../src/core/solver/solve.js';
import { allEdges, setWallId, pathEdgeIds, setArrowId } from '../../src/core/edges.js';
import { backbite } from '../../src/core/gen/hampath.js';
import { FAST, sampled, SLOW } from '../harness.js';
import { oracle, ruleMoves } from '../oracle.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import {
  generateExact,
  generateTargetedExact,
  fullExactPuzzle,
  tryRemoveLabel,
  minimizeLabels,
  refineLabels,
  shiftNumber,
  climbNumbers,
  easeNumbers,
  exactScore,
  EXACT_SIZES,
  EXACT_CANDIDATES,
  EXACT_REFINE_CAP_X,
  EXACT_TARGET_TRIES,
  EXACT_CLIMB_PROPOSALS,
} from '../../src/core/gen/exact.js';
import { trapGradeOf, EXACT_MODEL } from '../../src/core/trap.js';
import { targetBand, maxTargetGrade } from '../../src/core/gen/target.js';
import { runSync } from '../../src/core/run.js';
import {
  variantOf,
  variantById,
  sizesFor,
  nearestSize,
  PLAY_VARIANTS,
} from '../../src/apps/play/variants.js';
import { variantIcon } from '../../src/apps/play/icons.js';
import { boardSvg, badgeColors, stepWrong, COLORS } from '../../src/apps/play/board.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { encodeShare, decodeShare } from '../../src/core/share-code.js';
import { makeShareRecord, legsUndo, legLevels, shareText } from '../../src/features/share.js';
import { solutionOf, maxHints } from '../../src/features/hints.js';
import { made } from '../fixtures/made.js';

// ---- the core: model, rules, format, solver

// An Exact puzzle with `numbers` = { cell: step }.
function exactPuzzle(n, numbers) {
  const p = makePuzzle(n);
  p.exact = true;
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[+cell] = number;
  }
  return p;
}

// The 5x5 example of the design notes: four numbers, no walls, one solution.
// Cells are row * 5 + column.
const EXAMPLE = { 14: 1, 17: 12, 11: 20, 16: 25 };
const EXAMPLE_PATH = [
  14, 9, 4, 3, 8, 13, 18, 19, 24, 23, 22, 17, 12, 7, 2, 1, 0, 5, 6, 11, 10, 15, 20, 21, 16,
];

// Every path that covers all cells, follows canStep, starts on number 1 and puts each number on
// its own step. The plain definition of the rule, with none of the solver's pruning
// (test/oracle.js). -> { count, first }.
function bruteExact(p) {
  const { count, paths } = oracle(p, { moves: ruleMoves(p), numbers: 'step' });
  return { count, first: paths[0] ?? null };
}

// A random puzzle that has at least one solution: random Hamiltonian path, `extra` numbers besides
// 1 and the cell count, walls on edges the path does not use.
function randomExact(seed, n, extra, wallFrac = 0) {
  const rnd = makeRng(seed);
  const path = backbite(n, rnd);
  const p = makePuzzle(n);
  p.exact = true;
  const steps = shuffle(
    [...Array(n * n - 2).keys()].map(i => i + 2),
    rnd,
  ).slice(0, extra);
  for (const s of [1, n * n, ...steps]) {
    p.cp[path[s - 1]] = s;
  }
  const used = new Set(pathEdgeIds(n, path));
  for (const e of allEdges(n)) {
    if (!used.has(e) && rnd() < wallFrac) setWallId(p.walls, e, true);
  }
  p.path = path;
  return p;
}

const FLAG_SETS = [
  {},
  { prop: true, parity: true },
  { prop: true, parity: true, prune2: true, seg: 'all', pocket: true, legCollide: true },
];

test('exact: validate (gaps ok; 1 and the cell count needed; legs must fit), clone', FAST, () => {
  const p = exactPuzzle(4, { 0: 1, 5: 3, 14: 16 });
  assert.deepStrictEqual(validate(p), { ok: true, max: 3 });
  assert.deepStrictEqual(
    [labelCount(p), numberedCells(p), checkpointCells(p)],
    [3, [0, 5, 14], [0, 5, 14]],
  );
  assert.deepStrictEqual(clonePuzzle(p).exact, true);
  assert.deepStrictEqual(
    clonePuzzle(makePuzzle(4)).exact,
    undefined,
    'a standard puzzle stays standard',
  );
  const ranks = exactRanks(exactPuzzle(4, { 14: 16, 0: 1, 5: 3 }));
  assert.deepStrictEqual(
    [ranks.rank[0], ranks.rank[5], ranks.rank[14], ranks.rank[1]],
    [1, 2, 3, 0],
  );
  assert.deepStrictEqual([...ranks.steps], [0, 1, 3, 16, 0]);
  const bad = (numbers, message) => {
    const v = validate(exactPuzzle(4, numbers));
    assert.ok(!v.ok && v.msg.includes(message), `${JSON.stringify(numbers)}: ${v.msg}`);
  };
  bad({ 0: 2, 15: 16 }, 'missing checkpoint 1');
  bad({ 0: 1, 5: 3 }, 'last number must be 16');
  bad({ 0: 1, 15: 17 }, 'last number must be 16');
  bad({ 0: 1, 1: 1, 15: 16 }, 'duplicate');
  // (0,0) -> (1,1) needs 2 steps
  bad({ 0: 1, 5: 2, 15: 16 }, '2 cells apart, but only 1 step lie');
  // neighbours are 1, 3, 5.. steps apart
  bad({ 0: 1, 1: 3, 15: 16 }, 'need an odd number of steps');
  // 5 -> 16 is 11 steps, between cells 2 apart
  bad({ 0: 1, 10: 5, 15: 16 }, 'need an even number of steps');
  const arrows = exactPuzzle(4, { 0: 1, 15: 16 });
  arrows.arrows = new Uint8Array(16);
  setArrowId(arrows.arrows, 0, 1);
  assert.ok(!validate(arrows).ok && validate(arrows).msg.includes('arrows'), 'no one-way arrows');
  const holes = exactPuzzle(4, { 0: 1, 15: 15 });
  holes.holes = new Uint8Array(16);
  holes.holes[5] = 1;
  assert.deepStrictEqual(
    [cellCount(holes), validate(holes).ok],
    [15, true],
    'the last number counts the holes out',
  );
  assert.deepStrictEqual(exactLegProblem(p), null);
  const parity = exactLegProblem(exactPuzzle(4, { 0: 1, 2: 3, 3: 5 }));
  assert.ok(parity !== null, '3 -> 5: neighbours, 2 steps');
  assert.deepStrictEqual(validate(makePuzzle(3)).ok, false);
  const standard = makePuzzle(3);
  standard.cp[0] = 1;
  standard.cp[8] = 4;
  assert.ok(!validate(standard).ok, 'a gap is still an error in a standard puzzle');
});

test(
  'exact: isSolved wants each number on its step; strictOrder refuses it off its step',
  FAST,
  () => {
    const snake = [0, 1, 2, 5, 4, 3, 6, 7, 8];
    const columns = [0, 3, 6, 7, 4, 1, 2, 5, 8];
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    assert.deepStrictEqual(
      [isSolved(p, snake), isSolved(p, columns)],
      [true, false],
      '3 is on step 3 or on step 7',
    );
    // the same cells as a standard puzzle 1, 2, 3: only the order of the checkpoints counts there
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[2] = 2;
    standard.cp[8] = 3;
    assert.deepStrictEqual([isSolved(standard, snake), isSolved(standard, columns)], [true, true]);
    assert.deepStrictEqual(isSolved(p, snake.slice(0, 8)), false, 'incomplete');
    assert.deepStrictEqual(isSolved(p, [...snake].reverse()), false, 'wrong start and end');
    const early = [0, 1, 4, 3, 6, 7, 8, 5, 2];
    assert.deepStrictEqual(
      isSolved(exactPuzzle(3, { 0: 1, 4: 3, 2: 9 }), early),
      true,
      'the centre is step 3',
    );
    assert.deepStrictEqual(
      isSolved(exactPuzzle(3, { 0: 1, 4: 5, 2: 9 }), early),
      false,
      'the centre is not step 5',
    );
    const S = { strictOrder: true };
    const q = exactPuzzle(3, { 0: 1, 3: 3, 8: 9 });
    const path = [];
    assert.deepStrictEqual(step(q, path, 0, S), 'push');
    assert.deepStrictEqual(step(q, path, 3, S), null, 'number 3 on step 2');
    assert.deepStrictEqual(step(q, path, 1, S), 'push');
    assert.deepStrictEqual(
      step(q, path, 4, S),
      null,
      'step 3 belongs to number 3: no other cell goes there',
    );
    assert.deepStrictEqual(step(q, path, 2, S), null, 'nor this one');
    assert.deepStrictEqual(step(q, path, 0, S), 'pop', 'going back is free');
    assert.deepStrictEqual(step(q, path, 3, S), null, 'still step 2');
    const free = exactPuzzle(3, { 0: 1, 1: 2, 8: 9 });
    const open = [0];
    const walked = [1, 2, 5].map(cell => step(free, open, cell, S));
    assert.deepStrictEqual(walked, ['push', 'push', 'push']);
    assert.deepStrictEqual(
      step(free, open, 4, S),
      'push',
      'steps without a number take any unnumbered cell',
    );
  },
);

test(
  'exact: text format keeps the `exact` line, takes no values; standard text unchanged',
  FAST,
  () => {
    const p = exactPuzzle(5, EXAMPLE);
    const text = serialize(p);
    assert.ok(/^exact$/m.test(text), 'an exact line');
    const q = parse(text);
    assert.deepStrictEqual([q.exact, [...q.cp]], [true, [...p.cp]]);
    assert.deepStrictEqual(serialize(q), text, 'round trip');
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    const plain = serialize(standard);
    assert.ok(
      !/^exact$/m.test(plain) && !plain.includes('Exact'),
      'nothing for a standard puzzle',
    );
    assert.deepStrictEqual(parse(serialize(standard)).exact, undefined);
    let message = '';
    try {
      parse('size 3\ncheckpoints 0,0=1\nexact yes');
    } catch (e) {
      message = e.message;
    }
    assert.ok(message.includes('no values'), message);
    message = '';
    try {
      parse('size 3\ncheckpoints 0,0=1\nexact\narrows');
    } catch (e) {
      message = e.message;
    }
    assert.ok(message.includes('cannot have arrows'), message);
    const withPath = parse(serialize(p, { path: EXAMPLE_PATH }));
    assert.deepStrictEqual(withPath.path, EXAMPLE_PATH);
  },
);

test(
  'exact: the 5x5 example has one solution; the same cells as a standard puzzle, more',
  FAST,
  () => {
    const p = exactPuzzle(5, EXAMPLE);
    assert.deepStrictEqual(validate(p).ok, true);
    assert.deepStrictEqual(isSolved(p, EXAMPLE_PATH), true);
    const r = solve(p, { limit: 5, nodeCap: 1e6, capture: true, prop: true, parity: true });
    assert.deepStrictEqual([r.count, r.exceeded], [1, false]);
    assert.deepStrictEqual(r.paths[0], EXAMPLE_PATH);
    assert.deepStrictEqual(bruteExact(p).count, 1);
    const standard = makePuzzle(5);
    standard.cp[14] = 1;
    standard.cp[17] = 2;
    standard.cp[11] = 3;
    standard.cp[16] = 4;
    const loose = solve(standard, { limit: 2, nodeCap: 1e6 });
    assert.deepStrictEqual(loose.count, 2, 'the order alone does not fix the path');
  },
);

test('exact: solver matches brute force (n=3..5, real or shifted numbers, walls)', FAST, () => {
  let compared = 0;
  let withSolutions = 0;
  let withoutSolutions = 0;
  const seeds = sampled(Array.from({ length: 90 }, (_, i) => i + 1));
  for (const seed of seeds) {
    const n = 3 + (seed % 3);
    const extra = n === 5 ? 3 + (seed % 3) : 1 + (seed % 3);
    const real = randomExact(seed, n, extra, [0, 0.1, 0.25][seed % 3]);
    const shifted = clonePuzzle(real);
    const inner = [...shifted.cp.keys()].filter(c => shifted.cp[c] > 1 && shifted.cp[c] < n * n);
    if (inner.length) shifted.cp[inner[seed % inner.length]] += 2 * (1 + (seed % 2));
    for (const p of [real, shifted]) {
      const want = bruteExact(p).count;
      if (want) withSolutions++;
      else withoutSolutions++;
      for (const flags of FLAG_SETS) {
        const got = solve(p, { limit: 1e9, nodeCap: 1e8, ...flags });
        const tag = `seed ${seed} n=${n} ${JSON.stringify(flags)}`;
        assert.deepStrictEqual([got.count, got.exceeded], [want, false], tag);
      }
      compared++;
    }
  }
  const split = `${withSolutions} with, ${withoutSolutions} without solutions`;
  const share = seeds.length / 90; // the guards scale with the sample
  assert.ok(withSolutions >= 90 * share && withoutSolutions >= 5 * share, split);
  assert.deepStrictEqual(compared, 2 * seeds.length);
});

test(
  'exact: solver with holes; captured paths solve it; limit and forced prefix work',
  FAST,
  () => {
    const base = makePuzzle(4);
    base.holes = new Uint8Array(16);
    base.holes[5] = 1;
    base.holes[6] = 1;
    base.exact = true;
    let path = null;
    for (let start = 0; start < 16 && !path; start++) {
      if (base.holes[start]) continue;
      const probe = clonePuzzle(base);
      probe.cp[start] = 1;
      path = bruteExact(probe).first;
    }
    assert.ok(path && path.length === 14, 'a Hamiltonian path of the 14 cells exists');
    const p = clonePuzzle(base);
    for (const s of [1, 4, 9, 14]) {
      p.cp[path[s - 1]] = s;
    }
    assert.deepStrictEqual(validate(p).ok, true);
    const want = bruteExact(p).count;
    assert.ok(want >= 1);
    for (const flags of FLAG_SETS) {
      const r = solve(p, { limit: 1e9, nodeCap: 1e8, capture: true, ...flags });
      assert.deepStrictEqual([r.count, r.exceeded], [want, false], JSON.stringify(flags));
      assert.ok(
        r.paths.every(solution => isSolved(p, solution)),
        'every captured path solves it',
      );
    }
    assert.deepStrictEqual(solve(p, { limit: 1, nodeCap: 1e6 }).count, 1, 'limit 1');
    // a forced prefix of a solution leads to a solution
    const prefix = path.slice(0, 3);
    assert.deepStrictEqual(
      solve(p, { limit: 1, nodeCap: 1e6, forced: prefix, prop: true, parity: true }).count,
      1,
    );
  },
);

test(
  'exact: each wrong turn of a unique solution is refuted; no search if legs cannot fit',
  FAST,
  () => {
    const p = exactPuzzle(5, EXAMPLE);
    let wrongTurns = 0;
    for (let i = 0; i < EXAMPLE_PATH.length - 1; i++) {
      const seen = new Set(EXAMPLE_PATH.slice(0, i + 1));
      for (let next = 0; next < 25; next++) {
        const onward = next === EXAMPLE_PATH[i + 1];
        if (seen.has(next) || onward || !canStep(p, EXAMPLE_PATH[i], next)) continue;
        const forced = EXAMPLE_PATH.slice(0, i + 1).concat(next);
        const r = solve(p, { limit: 1, nodeCap: 1e6, forced, prop: true, parity: true });
        assert.deepStrictEqual([r.count, r.exceeded], [0, false], `step ${i + 1} -> ${next}`);
        wrongTurns++;
      }
    }
    assert.ok(wrongTurns >= 10, `${wrongTurns} wrong turns`);
    const prefix = EXAMPLE_PATH.slice(0, 10);
    const right = solve(p, { limit: 1, nodeCap: 1e6, forced: prefix, prop: true });
    assert.deepStrictEqual(right.count, 1, 'the true prefix leads to the solution');
    // last number not on the last step / legs that cannot fit: no search at all
    const lastEarly = exactPuzzle(5, { 14: 1, 17: 12, 11: 20 });
    const early = solve(lastEarly, { limit: 2 });
    assert.deepStrictEqual([early.count, early.exceeded, early.nodes], [0, false, 0]);
    const tooFar = exactPuzzle(5, { 0: 1, 24: 25, 4: 3 });
    const none = solve(tooFar, { limit: 2, capture: true });
    assert.deepStrictEqual([none.count, none.nodes, none.paths], [0, 0, []]);
    let message = '';
    const arrowsToo = exactPuzzle(3, { 0: 1, 8: 9 });
    arrowsToo.arrows = new Uint8Array(9);
    try {
      solve(arrowsToo);
    } catch (e) {
      message = e.message;
    }
    assert.ok(message.includes('Exact'), message);
  },
);

test(
  'exact: the step of the next number bounds the search: fewer solutions and nodes',
  FAST,
  () => {
    const n = 5;
    const path = backbite(n, makeRng(11));
    const numbers = { [path[0]]: 1, [path[5]]: 6, [path[24]]: 25 };
    const p = exactPuzzle(n, numbers);
    const flags = { prop: true, parity: true, prune2: true };
    const exact = solve(p, { limit: 1e9, nodeCap: 1e8, capture: true, ...flags });
    assert.ok(!exact.exceeded && exact.count >= 1);
    assert.ok(
      exact.paths.every(solution => solution[5] === path[5]),
      '6 is on step 6 in every solution',
    );
    assert.deepStrictEqual(exact.count, bruteExact(p).count);
    const standard = makePuzzle(n);
    standard.cp[path[0]] = 1;
    standard.cp[path[5]] = 2;
    standard.cp[path[24]] = 3;
    const wide = solve(standard, { limit: 1e9, nodeCap: 1e8, ...flags });
    assert.ok(wide.count > exact.count, `${wide.count} standard solutions vs ${exact.count}`);
    assert.ok(wide.nodes > exact.nodes, `${wide.nodes} standard nodes vs ${exact.nodes}`);
  },
);

// ---- the generator

const CHECK = { limit: 2, nodeCap: 5e6, prop: true, parity: true };
const HIT_SEEDS = 6; // seeds tried from a base seed before a target test calls the generator broken

// The interior numbers of p (not 1, not the cell count): their cells.
const interior = p => [...p.cp.keys()].filter(c => p.cp[c] > 1 && p.cp[c] < cellCount(p));

test(
  'exact gen: puzzles are valid, unique, wall-free, solved by their path, 1 and the end',
  SLOW,
  () => {
    for (const [n, seed] of [
      [5, 1],
      [5, 2],
      [6, 3],
      [6, 4],
      [7, 5],
      [7, 6],
      [8, 7],
      [8, 8],
    ]) {
      const p = runSync(generateExact(n, seed));
      const tag = `n=${n} seed=${seed}`;
      assert.deepStrictEqual(validate(p).ok, true, tag);
      const plain = [p.exact, p.seed, p.walls.some(Boolean), !!p.holes, !!p.arrows];
      assert.deepStrictEqual(plain, [true, seed, false, false, false], tag);
      const r = solve(p, CHECK);
      assert.deepStrictEqual([r.count, r.exceeded], [1, false], tag);
      assert.deepStrictEqual(isSolved(p, p.path), true, tag);
      const ends = [p.cp[startCell(p)], p.cp[endCell(p)], endCell(p) === p.path[n * n - 1]];
      assert.deepStrictEqual(ends, [1, n * n, true], tag);
      assert.ok(
        labelCount(p) >= 2 && labelCount(p) < (n * n) / 2,
        `${tag}: ${labelCount(p)} numbers`,
      );
    }
  },
);

test(
  'exact gen: no number can be taken off (each interior number is needed), 5x5 to 7x7',
  FAST,
  () => {
    const cases = [
      [5, 11],
      [5, 12],
      [6, 13],
      [6, 14],
      [7, 15],
      [7, 16],
    ];
    for (const [n, seed] of sampled(cases)) {
      const p = runSync(generateExact(n, seed));
      for (const cell of interior(p)) {
        const step = p.cp[cell];
        p.cp[cell] = 0;
        const r = solve(p, CHECK);
        p.cp[cell] = step;
        assert.deepStrictEqual(
          [r.count, r.exceeded],
          [2, false],
          `n=${n} seed=${seed} number ${step}`,
        );
      }
    }
  },
);

test(
  'exact gen: same seed, same puzzle; other seeds, other ones; the floor adds numbers',
  FAST,
  () => {
    const a = runSync(generateExact(6, 21));
    const b = runSync(generateExact(6, 21));
    assert.deepStrictEqual([...a.cp], [...b.cp]);
    assert.deepStrictEqual(a.path, b.path);
    const others = [22, 23, 24].map(seed => [...runSync(generateExact(6, seed)).cp].join());
    assert.ok(
      others.some(cp => cp !== [...a.cp].join()),
      'seeds differ',
    );
    const floored = runSync(generateExact(6, 21, { floor: labelCount(a) + 3 }));
    assert.deepStrictEqual(labelCount(floored), labelCount(a) + 3, 'stops at the floor');
    const r = solve(floored, CHECK);
    assert.deepStrictEqual([r.count, r.exceeded, validate(floored).ok], [1, false, true]);
    const big = runSync(generateExact(5, 21, { floor: 99 }));
    assert.deepStrictEqual(labelCount(big), 25, 'a floor above the cell count keeps every number');
  },
);

test(
  'exact gen: progress stays inside 0..1 and rises, numbers never increase, end matches',
  FAST,
  () => {
    const fracs = [];
    const counts = [];
    const gen = generateExact(7, 31);
    let step = gen.next();
    for (; !step.done; step = gen.next()) {
      fracs.push(step.value.frac);
      counts.push(step.value.labels);
    }
    assert.ok(
      fracs.every(f => f >= 0 && f <= 1),
      'frac in range',
    );
    assert.ok(
      fracs.every((f, i) => i === 0 || f >= fracs[i - 1] - 1e-9),
      'frac rises',
    );
    assert.ok(
      counts.every((c, i) => i === 0 || c <= counts[i - 1]),
      'numbers never increase',
    );
    assert.deepStrictEqual(
      [fracs[fracs.length - 1], counts[counts.length - 1]],
      [1, labelCount(step.value)],
    );
  },
);

test(
  'exact gen: tryRemoveLabel removes an unneeded number, keeps a needed one, sees caps',
  FAST,
  () => {
    const path = backbite(5, makeRng(5));
    const full = fullExactPuzzle(5, path);
    assert.deepStrictEqual([labelCount(full), full.exact, isSolved(full, path)], [25, true, true]);
    const cell = path[10];
    const r = tryRemoveLabel(full, cell, 1e6);
    assert.deepStrictEqual([r.removable, r.capped, full.cp[cell]], [true, false, 0]);
    const p = runSync(generateExact(5, 41));
    const needed = interior(p)[0];
    const step = p.cp[needed];
    const kept = tryRemoveLabel(p, needed, 1e6);
    assert.deepStrictEqual(
      [kept.removable, kept.capped, p.cp[needed]],
      [false, false, step],
      'put back',
    );
    const capped = tryRemoveLabel(p, needed, 1);
    const tiny = [capped.removable, capped.capped, p.cp[needed]];
    assert.deepStrictEqual(tiny, [false, true, step], 'a cap of 1 node decides nothing');
  },
);

test(
  'exact gen: minimizeLabels keeps a unique puzzle, honours floor and bound, keeps ends',
  FAST,
  () => {
    const rnd = makeRng(7);
    const path = backbite(6, rnd);
    const p = fullExactPuzzle(6, path);
    const r = runSync(minimizeLabels(p, path.slice(1, -1), rnd, 1e5));
    assert.deepStrictEqual(
      [r.kept, labelCount(p), r.removed],
      [labelCount(p), labelCount(p), 36 - labelCount(p)],
    );
    assert.deepStrictEqual([p.cp[path[0]], p.cp[path[35]], r.uncertain.length], [1, 36, 0]);
    assert.deepStrictEqual(solve(p, CHECK).count, 1);
    const rnd2 = makeRng(7);
    const path2 = backbite(6, rnd2);
    const q = fullExactPuzzle(6, path2);
    const f = runSync(minimizeLabels(q, path2.slice(1, -1), rnd2, 1e5, { floor: 10 }));
    assert.deepStrictEqual([f.kept, labelCount(q)], [10, 10]);
    const rnd3 = makeRng(7);
    const path3 = backbite(6, rnd3);
    const w = fullExactPuzzle(6, path3);
    const b = runSync(minimizeLabels(w, path3.slice(1, -1), rnd3, 1e5, { bound: 3 }));
    assert.deepStrictEqual([b.aborted, b.kept], [true, Infinity]);
  },
);

test(
  'exact gen: refineLabels decides what a small cap left open; the puzzle stays unique',
  FAST,
  () => {
    const rnd = makeRng(9);
    const path = backbite(7, rnd);
    const p = fullExactPuzzle(7, path);
    const first = runSync(minimizeLabels(p, path.slice(1, -1), rnd, 25));
    assert.ok(first.uncertain.length > 0, 'a cap of 25 nodes leaves numbers undecided');
    const caps = EXACT_REFINE_CAP_X.map(x => x * 2000);
    const opts = { caps, budget: 5e6, labels: first.kept };
    const second = runSync(refineLabels(p, first.uncertain, rnd, opts));
    assert.deepStrictEqual(
      [second.kept, labelCount(p)],
      [first.kept - second.removed, first.kept - second.removed],
    );
    assert.ok(second.removed > 0, 'some are decided');
    assert.deepStrictEqual([second.left.length, solve(p, CHECK).count], [0, 1]);
    const none = runSync(refineLabels(p, [], rnd, { caps, budget: 100, labels: 5 }));
    assert.deepStrictEqual([none.removed, none.nodes], [0, 0]);
  },
);

test(
  'exact gen: more candidates never leave more numbers, and often fewer (same seed)',
  SLOW,
  () => {
    let fewer = 0;
    for (let seed = 61; seed <= 70; seed++) {
      const one = labelCount(runSync(generateExact(7, seed, { candidates: 1, refineNodes: 0 })));
      const many = labelCount(runSync(generateExact(7, seed, { candidates: 8, refineNodes: 0 })));
      assert.ok(many <= one, `seed ${seed}: ${many} against ${one}`);
      if (many < one) fewer++;
    }
    assert.ok(fewer >= 3, `fewer numbers in ${fewer} of 10`);
  },
);

test('exact gen: the offered sizes and their candidate counts', FAST, () => {
  assert.ok(EXACT_SIZES.every(n => EXACT_CANDIDATES[n] > 0));
  const p = runSync(generateExact(9, 51, { candidates: 1, refineNodes: 0 }));
  assert.deepStrictEqual([validate(p).ok, solve(p, CHECK).count], [true, 1]);
});

test(
  'exact gen target: a puzzle of the grade (or harder): hit, unique, valid, solved',
  SLOW,
  () => {
    // The tries are bounded, and a refit moves the cuts, so no fixed seed is sure to hit: from each base seed take the first one that does.
    for (const [n, grade, base] of [
      [7, 2, 1],
      [7, 2, 2],
      [8, 3, 3],
      [8, 3, 4],
      [10, 2, 5],
    ]) {
      const generateAt = at => runSync(generateExact(n, at, { grade }));
      let seed = base;
      let p = generateAt(seed);
      while (!p.score.hit && seed < base + HIT_SEEDS - 1) {
        seed++;
        p = generateAt(seed);
      }
      const tag = `n=${n} grade ${grade} seed ${seed} (base ${base})`;
      const s = p.score;
      assert.deepStrictEqual([s.hit, s.miss, s.target, s.atLeast], [true, 0, grade, true], tag);
      assert.deepStrictEqual([s.labels, p.seed], [labelCount(p), seed], tag);
      const band = targetBand(grade, n, EXACT_MODEL);
      assert.ok(s.grade >= grade && s.predicted >= band.a, `${tag}: ${s.predicted}`);
      assert.deepStrictEqual(exactScore(p), s.predicted, `${tag}: the score is the puzzle's`);
      assert.deepStrictEqual(s.grade, trapGradeOf(s.predicted, EXACT_MODEL), tag);
      const r = solve(p, CHECK);
      assert.deepStrictEqual(
        [r.count, r.exceeded, validate(p).ok, isSolved(p, p.path)],
        [1, false, true, true],
        tag,
      );
    }
  },
);

test(
  'exact gen target: the grade only (atLeast false): easier targets add numbers back',
  FAST,
  () => {
    const minimal = labelCount(runSync(generateExact(8, 9)));
    const p = runSync(generateExact(8, 9, { grade: 1, atLeast: false }));
    assert.deepStrictEqual([p.score.hit, p.score.grade, p.score.atLeast], [true, 1, false]);
    assert.ok(labelCount(p) > minimal, `${labelCount(p)} numbers against ${minimal}`);
    assert.deepStrictEqual(solve(p, CHECK).count, 1);
    const q = runSync(generateExact(7, 4, { grade: 2, atLeast: false }));
    assert.deepStrictEqual([q.score.hit, q.score.grade], [true, 2]);
  },
);

test(
  'exact gen target: clamped to the size, deterministic, bounded by tries, events rise',
  SLOW,
  () => {
    const small = runSync(generateExact(5, 3, { grade: 5 }));
    assert.deepStrictEqual(
      small.score.target,
      maxTargetGrade(5, EXACT_MODEL),
      'a 5x5 puzzle cannot show grade 5',
    );
    const a = runSync(generateExact(7, 21, { grade: 3 }));
    const b = runSync(generateExact(7, 21, { grade: 3 }));
    assert.deepStrictEqual([[...a.cp], a.path, a.score], [[...b.cp], b.path, b.score]);
    const one = runSync(generateExact(7, 22, { grade: 4, tries: 1, proposals: 5 }));
    assert.deepStrictEqual(one.score.tries, 1);
    assert.ok(
      one.score.hit || one.score.miss > 0,
      'without a hit the closest comes back, with its miss',
    );
    assert.deepStrictEqual(solve(one, CHECK).count, 1);
    const fracs = [];
    const counts = [];
    const gen = generateTargetedExact(7, 23, { grade: 3 });
    let step = gen.next();
    for (; !step.done; step = gen.next()) {
      fracs.push(step.value.frac);
      counts.push(step.value.labels);
    }
    assert.ok(
      fracs.every(f => f >= 0 && f <= 1),
      'frac in range',
    );
    assert.ok(
      fracs.every((f, i) => !i || f >= fracs[i - 1] - 1e-9),
      'frac rises',
    );
    assert.deepStrictEqual(
      [fracs[fracs.length - 1], counts[counts.length - 1]],
      [1, labelCount(step.value)],
    );
    assert.ok(!('score' in runSync(generateExact(6, 31))), 'the default puzzle carries no score');
    for (const n of EXACT_SIZES) {
      assert.ok(EXACT_TARGET_TRIES[n] > 0 && EXACT_CLIMB_PROPOSALS[n] > 0, `budgets for ${n}`);
    }
  },
);

test(
  'exact gen target: shiftNumber moves a number on the path; climb and ease stay unique',
  SLOW,
  () => {
    const p = runSync(generateExact(7, 41, { candidates: 1, refineNodes: 0 }));
    const rnd = makeRng(3);
    let moved = null;
    for (let i = 0; i < 50 && !moved; i++) moved = shiftNumber(p, rnd);
    assert.ok(moved, 'a shift lands somewhere');
    assert.deepStrictEqual(labelCount(moved), labelCount(p));
    const gone = [...p.cp.keys()].filter(c => p.cp[c] && !moved.cp[c]);
    const came = [...moved.cp.keys()].filter(c => moved.cp[c] && !p.cp[c]);
    assert.deepStrictEqual([gone.length, came.length], [1, 1]);
    assert.deepStrictEqual(
      moved.cp[came[0]],
      moved.path.indexOf(came[0]) + 1,
      'the number is the step of its cell',
    );
    assert.ok(Math.abs(moved.cp[came[0]] - p.cp[gone[0]]) <= 3, 'at most 3 steps');
    assert.ok(p.cp[gone[0]] > 1 && p.cp[gone[0]] < 49, 'never the start or the end');
    assert.deepStrictEqual(
      [...p.cp].filter(Boolean).length,
      labelCount(p),
      'the original is not touched',
    );
    const band = targetBand(4, 7, EXACT_MODEL);
    const start = exactScore(p);
    const opts = { proposals: 60, checkCap: 1e5 };
    const climbed = runSync(climbNumbers(p, start, band, makeRng(8), opts));
    assert.ok(climbed.score >= start, `${climbed.score} from ${start}`);
    assert.deepStrictEqual(
      [solve(climbed.puzzle, CHECK).count, exactScore(climbed.puzzle)],
      [1, climbed.score],
    );
    const hard = runSync(generateExact(8, 5, { grade: 3 }));
    const gentle = targetBand(1, 8, EXACT_MODEL, 0.15, false);
    const easy = easeNumbers(hard, hard.score.predicted, gentle, makeRng(2), 64);
    assert.ok(labelCount(easy.puzzle) > labelCount(hard), 'more numbers');
    assert.ok(easy.score < hard.score.predicted, 'easier');
    assert.deepStrictEqual(solve(easy.puzzle, CHECK).count, 1);
    assert.ok(easy.score >= gentle.a && easy.score <= gentle.b, `inside the band: ${easy.score}`);
  },
);

// ---- the variant in the play app

const fast = (n, seed) => made('exact', n, seed, { candidates: 1, refineNodes: 0 });
const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: labelCount(p),
    variant: 'exact',
    puzzle: p,
    ...extra,
  });

test('play exact: registry, detect, offered sizes, generator', FAST, () => {
  const variant = variantById('exact');
  assert.deepStrictEqual(PLAY_VARIANTS.map(v => v.id).includes('exact'), true);
  const keys = [variant.countKey, variant.keys.name, variant.keys.shareHead];
  assert.deepStrictEqual(keys, ['gen.labels', 'mode.exact', 'share.headExact']);
  const puzzle = made('exact', 5, 11);
  const kinds = [variant.detect(puzzle), variantOf(puzzle), variantOf(makePuzzle(5))];
  assert.deepStrictEqual(kinds, [true, 'exact', null]);
  assert.ok(!variantOf({ ...makePuzzle(5), holes: new Uint8Array(25) }) !== 'exact');
  const all = [5, 6, 7, 8, 9, 10, 11, 12, 16];
  assert.deepStrictEqual(sizesFor('exact', all), EXACT_SIZES);
  assert.deepStrictEqual([nearestSize(16, EXACT_SIZES), nearestSize(4, EXACT_SIZES)], [12, 5]);
});

test(
  'play exact: the icon has 16 tiles and 4 step badges; both languages have the texts',
  FAST,
  () => {
    const icon = variantIcon('exact');
    assert.deepStrictEqual((icon.match(/rx="1\.6"/g) || []).length, 16);
    assert.deepStrictEqual(
      [...icon.matchAll(/class="vi-num"[^>]*>(\d+)</g)].map(m => +m[1]),
      [1, 7, 12, 16],
    );
    assert.ok(icon.includes('vi-exact'));
    assert.ok(icon !== variantIcon('standard') && icon !== variantIcon('arrows'));
    assert.ok(!variantIcon('standard').includes('vi-badge'));
    for (const dict of [EN, ZH]) {
      const keys = [
        'mode.exact',
        'mode.exactTag',
        'gen.subExact',
        'game.exactTitle',
        'game.sharedExactTitle',
        'share.exact',
        'share.headExact',
        'game.step',
      ];
      for (const key of keys) assert.ok(dict[key], key);
      assert.ok(dict['gen.labels'](3).includes('3') && dict['gen.labels'](1).includes('1'));
    }
    assert.ok(EN['game.step'].includes('{0}') && EN['game.step'].includes('{1}'));
    assert.ok(ZH['game.step'].includes('{0}') && ZH['game.step'].includes('{1}'));
  },
);

test('play exact: the step number 256 of a 16 x 16 board fits the code', FAST, () => {
  const big = exactPuzzle(16, { 0: 1, 240: 256 });
  assert.deepStrictEqual(validate(big).ok, true);
  const bigBack = decodeShare(encodeShare(record(big, { legs: [] })));
  assert.deepStrictEqual(
    [bigBack.puzzle.cp[0], bigBack.puzzle.cp[240]],
    [1, 256],
    'step 256 fits the 8 bits',
  );
});

test(
  'play exact: an unsound record is refused (flag, walls, holes, arrows, ends, legs)',
  FAST,
  () => {
    const good = fast(6, 7);
    assert.ok(encodeShare(record(good)) !== null);
    const refused = changes => {
      const q = { ...good, cp: good.cp.slice(), walls: good.walls.slice(), ...changes };
      const rec = {
        kind: 'local',
        variant: 'exact',
        n: 6,
        grade: null,
        timeS: 5,
        levels: [],
        puzzle: q,
      };
      return encodeShare(rec) === null;
    };
    const cells = [...good.cp.keys()].filter(c => good.cp[c]);
    assert.deepStrictEqual(refused({ exact: undefined }), true, 'no exact flag');
    assert.deepStrictEqual(refused({ holes: new Uint8Array(36) }), true, 'holes');
    assert.deepStrictEqual(refused({ arrows: new Uint8Array(36) }), true, 'arrows');
    const walled = good.walls.slice();
    walled[0] = 1;
    assert.deepStrictEqual(refused({ walls: walled }), true, 'a wall');
    const last = good.cp.slice();
    last[cells[cells.length - 1]] = 35;
    assert.deepStrictEqual(refused({ cp: last }), true, 'the last number is not the cell count');
    const lonely = new Uint16Array(36);
    lonely[cells[0]] = 1;
    assert.deepStrictEqual(refused({ cp: lonely }), true, 'a single number');
    const far = good.cp.slice();
    far[cells[1]] += 1;
    assert.deepStrictEqual(refused({ cp: far }), true, 'a leg of the wrong parity');
  },
);

test(
  'play exact: a variant record never carries a grade, so a graded game still shares',
  FAST,
  () => {
    const exact = fast(6, 3);
    const arrows = made('arrows', 5, 3, { candidates: 1, refineNodes: 0 });
    const cutout = made('cutout', 6, 8, { boards: 1, effort: 0.1 });
    for (const [variant, puzzle] of [
      ['exact', exact],
      ['arrows', arrows],
      ['cutout', cutout],
    ]) {
      const rec = makeShareRecord({
        n: puzzle.n,
        grade: 3,
        timeS: 12.3,
        legs: [],
        K: labelCount(puzzle),
        variant,
        puzzle,
      });
      assert.deepStrictEqual(rec.grade, null, variant);
      assert.ok(encodeShare(rec) !== null, `${variant}: encodes with a grade given`);
    }
    const standard = made('std', 5, 3);
    const local = makeShareRecord({
      n: 5,
      grade: 3,
      timeS: 1,
      legs: [],
      K: labelCount(standard),
      puzzle: standard,
    });
    assert.deepStrictEqual(local.grade, 3, 'a standard game keeps its grade');
    assert.ok(encodeShare(local) !== null, 'and encodes with its puzzle');
  },
);

test(
  'play exact: shareText names the variant; legs are counted by rank, not by number',
  FAST,
  () => {
    const p = fast(6, 5);
    const rec = record(p);
    const text = shareText(rec, 'https://x/?s=abc', key => EN[key]);
    assert.ok(text.startsWith('zigzag Exact'), text.split('\n')[0]);
    // 3x3, numbers 1, 5, 9 = ranks 1, 2, 3; going back from the end of the snake to length 6
    // undoes cells 7, 8, 9
    const q = exactPuzzle(3, { 0: 1, 4: 5, 8: 9 });
    const snake = [0, 1, 2, 5, 4, 3, 6, 7, 8];
    const legs = [];
    legsUndo(legs, q, snake, 6);
    assert.deepStrictEqual(
      [legs[1], legs[4], legs.length],
      [3, undefined, 2],
      'leg 2 (rank 2 -> 3), not leg 5',
    );
    assert.deepStrictEqual(
      legLevels(legs, labelCount(q)),
      [0, 2],
      '3 numbers, 2 legs; 3 cells taken back = level 2',
    );
    const ranks = labelRanks(q);
    assert.deepStrictEqual([ranks[0], ranks[4], ranks[8], ranks[1]], [1, 2, 3, 0]);
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    assert.deepStrictEqual(
      labelRanks(standard),
      standard.cp,
      'a standard puzzle: the numbers are the ranks',
    );
  },
);

test(
  'play exact: hints work on a shared puzzle (no stored solution): it is solved lazily',
  FAST,
  () => {
    const p = fast(7, 13);
    const shared = { ...decodeShare(encodeShare(record(p))).puzzle };
    assert.ok(!shared.path);
    const path = solutionOf(shared);
    assert.ok(path && isSolved(shared, path), 'the solver finds the one solution');
    assert.deepStrictEqual(maxHints(shared), Math.min(7, labelCount(p)));
  },
);

test(
  'play exact: a number on its step is blue, on another red; 3 digits: smaller font',
  FAST,
  () => {
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    const board = (puzzle, path = []) => {
      return boardSvg({ puzzle, path, hintCell: null, hintWrongCell: null });
    };
    const badge = (svg, cell) => {
      return svg.match(new RegExp(`data-num-cell="${cell}"><circle[^>]*fill="([^"]+)"`))[1];
    };
    const right = board(p, [0, 1, 2]);
    const blue = [COLORS.numberVisited, COLORS.numberVisited, COLORS.numberFill];
    assert.deepStrictEqual([badge(right, 0), badge(right, 2), badge(right, 8)], blue);
    const wrong = board(p, [0, 3, 4, 1, 2]); // number 3 reached on step 5
    assert.deepStrictEqual(
      [badge(wrong, 0), badge(wrong, 2)],
      [COLORS.numberVisited, COLORS.numberWrong],
    );
    const flags = [
      [0, 1, 2],
      [0, 3, 4, 1, 2],
    ].map(path => stepWrong(p, path, 2));
    assert.deepStrictEqual(
      [...flags, stepWrong(makePuzzle(3), [0, 1, 2], 2)],
      [false, true, false],
    );
    const idle = { fill: COLORS.numberFill, stroke: COLORS.numberRing, text: COLORS.number };
    assert.deepStrictEqual(badgeColors(false), idle);
    assert.deepStrictEqual(badgeColors(true), {
      fill: COLORS.numberVisited,
      stroke: COLORS.numberVisitedRing,
      text: COLORS.numberVisitedText,
    });
    const ink = COLORS.numberWrong;
    const red = { fill: ink, stroke: ink, text: COLORS.numberVisitedText };
    assert.deepStrictEqual(badgeColors(true, true), red);
    const font = svg => svg.match(/font-size="([\d.]+)"/g);
    const big = exactPuzzle(11, { 0: 1, 110: 121 });
    assert.deepStrictEqual(font(board(big)), ['font-size="19.2"', 'font-size="14.4"']);
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 12;
    assert.deepStrictEqual(font(board(standard)), ['font-size="19.2"', 'font-size="19.2"']);
  },
);
