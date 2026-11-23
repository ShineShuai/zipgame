// Tests of the Loop puzzle: the path closes into a ring, so the last cell touches cell 1 and the
// numbers 1..K are met in cyclic order. The play app's "ring is not closed" indicator
// (apps/play/board.js loopOpen / loopOpenMarks), the core (model, rules, plain-text format, and
// the solver checked against bruteLoop of test/oracle.js), the generator (gen/hampath.js
// ringPath, gen/checkpoints.js loopCheckpoints, gen/loop.js generateLoop) and the variant in the
// play app: the closed ring on the board, the icon, the registry entry, the share code and
// record, the grade, a whole game and the lucky game.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePuzzle, clonePuzzle, validate, maxNumber, labelCount } from '../../src/core/model.js';
import { setWallId, edgeId, allEdges } from '../../src/core/edges.js';
import { isSolved, step, canStep, gridAdjacent } from '../../src/core/rules.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { ringPath } from '../../src/core/gen/hampath.js';
import { loopOpen, loopOpenMarks, CELL, boardSvg, routeCells } from '../../src/apps/play/board.js';
import { EN, ZH } from '../../src/ui/i18n.js';
import { serialize, parse } from '../../src/core/format.js';
import { solve } from '../../src/core/solver/solve.js';
import { loopClosers } from '../../src/core/solver/solve-loop.js';
import { neighbourCell } from '../../src/core/geom.js';
import { bruteLoop } from '../oracle.js';
import { loopCheckpoints, LOOP_TAIL } from '../../src/core/gen/checkpoints.js';
import { generateLoop } from '../../src/core/gen/loop.js';
import { generate, PLAY_SIZES } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { sampled } from '../harness.js';
import { createUnlock } from '../../src/features/unlock.js';
import { luckyDefs } from '../../src/apps/play/variants.js';
import { encodeShare } from '../../src/core/share-code.js';
import { makeShareRecord } from '../../src/features/share.js';
import { made } from '../fixtures/made.js';
import { REFUSED } from '../errors.js';

// ---- the ring-not-closed indicator

// A 4x4 loop puzzle with the numbers 1, 2, 3 at the 1st, 6th and 10th cell of `path`.
function loopOn(path) {
  const p = makePuzzle(4);
  p.loop = true;
  [0, 5, 9].forEach((at, i) => {
    p.cp[path[at]] = i + 1;
  });
  return p;
}
// a snake: it covers the board, but its last cell is 3 rows from its first
const SNAKE = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];

test('loopOpen: a full path that does not close is open, a closed ring, a partial path and other puzzles are not', () => {
  const snake = loopOn(SNAKE);
  assert.ok(loopOpen(snake, SNAKE), 'covers every cell, ends far from cell 1');
  assert.ok(!isSolved(snake, SNAKE));
  assert.ok(!loopOpen(snake, SNAKE.slice(0, 15)), 'one cell short: still being drawn');
  assert.ok(!loopOpen(snake, []), 'nothing drawn');

  const ring = ringPath(4, makeRng(2));
  const closed = loopOn(ring);
  assert.ok(isSolved(closed, ring), 'a ring through the numbers in order is solved');
  assert.ok(!loopOpen(closed, ring), 'closed: nothing to report');

  const standard = makePuzzle(4);
  standard.cp[0] = 1;
  standard.cp[12] = 2;
  assert.ok(!loopOpen(standard, SNAKE), 'only Loop puzzles have a ring');
});

test('loopOpen: a wall on the closing edge keeps a ring open', () => {
  const ring = ringPath(4, makeRng(2));
  const walled = loopOn(ring);
  setWallId(walled.walls, edgeId(4, ring[ring.length - 1], ring[0]), true);
  assert.ok(!isSolved(walled, ring));
  assert.ok(loopOpen(walled, ring));
});

test('loopOpenMarks: nothing unless open; then a ring on the last cell and one on cell 1', () => {
  const snake = loopOn(SNAKE);
  assert.deepStrictEqual(loopOpenMarks(snake, SNAKE.slice(0, 15)), '');
  const marks = loopOpenMarks(snake, SNAKE);
  assert.deepStrictEqual((marks.match(/<circle/g) || []).length, 2);
  // cell 12 (row 3, column 0) is the head, cell 0 the start
  assert.ok(marks.includes(`cx="${CELL * 0.5}" cy="${CELL * 3.5}"`), 'on the last cell');
  assert.ok(marks.includes(`cx="${CELL * 0.5}" cy="${CELL * 0.5}"`), 'on cell 1');
  assert.deepStrictEqual(loopOpenMarks(makePuzzle(4), SNAKE), '', 'not a Loop puzzle');
});

test('the loop notes have a text in both languages', () => {
  for (const dict of [EN, ZH]) {
    for (const key of ['game.loopHint', 'game.loopOpen', 'game.loopClosed'])
      assert.ok(dict[key], key);
  }
});

// ---- the core: model, rules, format, solver

// A Loop puzzle with `numbers` = { cell: number }.
function loopPuzzle(n, numbers) {
  const p = makePuzzle(n);
  p.loop = true;
  for (const [cell, number] of Object.entries(numbers)) {
    p.cp[+cell] = number;
  }
  return p;
}

// The 4x4 ring 0 1 2 3 7 6 5 9 10 11 15 14 13 12 8 4 (back to 0), numbered 1, 2, 3 on its
// cells 0, 3 and 10 (a cell is row * 4 + column).
const RING = [0, 1, 2, 3, 7, 6, 5, 9, 10, 11, 15, 14, 13, 12, 8, 4];

// Does the ring (the path and its closing edge) use the edge a-b?
const usesEdge = (path, a, b) => {
  const ring = [...path, path[0]];
  for (let i = 1; i < ring.length; i++) {
    const x = ring[i - 1];
    const y = ring[i];
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
};

// A random puzzle: K numbered cells, a share `wallFrac` of the edges walled.
function randomLoop(seed, n, K, wallFrac) {
  const rnd = makeRng(seed);
  const p = loopPuzzle(n, {});
  shuffle([...Array(n * n).keys()], rnd)
    .slice(0, K)
    .forEach((cell, i) => {
      p.cp[cell] = i + 1;
    });
  for (const e of allEdges(n)) {
    if (rnd() < wallFrac) setWallId(p.walls, e, true);
  }
  return p;
}

test('loop: validate — a ring needs an even board and at least 3 numbers, nothing else is added', () => {
  assert.ok(validate(loopPuzzle(4, { 0: 1, 3: 2, 10: 3 })).ok);
  assert.ok(validate(loopPuzzle(4, { 0: 1, 3: 2, 10: 3 })).max === 3);
  assert.ok(!validate(loopPuzzle(5, { 0: 1, 3: 2, 10: 3 })).ok, 'odd board');
  assert.ok(!validate(loopPuzzle(4, { 0: 1, 3: 2 })).ok, 'two numbers');
  assert.ok(!validate(loopPuzzle(4, { 0: 1, 3: 3, 10: 4 })).ok, 'a gap');
  for (const extra of [
    { wrap: true },
    { exact: true },
    { arrows: new Uint8Array(16) },
    { holes: new Uint8Array(16) },
  ]) {
    assert.ok(
      !validate({ ...loopPuzzle(4, { 0: 1, 3: 2, 10: 3 }), ...extra }).ok,
      Object.keys(extra)[0],
    );
  }
  const q = clonePuzzle(loopPuzzle(4, { 0: 1, 3: 2, 10: 3 }));
  assert.ok(q.loop === true && !clonePuzzle(makePuzzle(4)).loop);
});

test('loop: isSolved — the last cell has to touch cell 1 through an open edge; K need not be last', () => {
  const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
  assert.ok(isSolved(p, RING), 'the ring');
  assert.ok(!isSolved(p, RING.slice(0, 15)), 'not every cell');
  // a path that covers every cell but ends away from cell 1: the serpentine
  const snake = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
  assert.ok(!isSolved(p, snake), 'the end 12 does not touch cell 0');
  const walled = clonePuzzle(p);
  setWallId(walled.walls, edgeId(4, 0, 4), true);
  assert.ok(!isSolved(walled, RING), 'a wall on the closing edge');
  const swapped = loopPuzzle(4, { 0: 1, 3: 3, 10: 2 });
  assert.ok(!isSolved(swapped, RING), 'numbers out of order');
  assert.ok(
    RING.indexOf(10) > RING.indexOf(3) && RING[RING.length - 1] !== 10,
    'K = 3 sits mid-ring',
  );
});

test('loop: step with strictOrder goes on past the last number (the ring closes later)', () => {
  const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
  const path = [];
  for (const cell of RING)
    assert.ok(step(p, path, cell, { strictOrder: true }) === 'push', `cell ${cell}`);
  assert.ok(isSolved(p, path));
  const standard = clonePuzzle(p);
  delete standard.loop;
  const path2 = [];
  let refused = false;
  for (const cell of RING)
    refused = refused || step(standard, path2, cell, { strictOrder: true }) === null;
  assert.ok(refused, 'the standard rule stops on the last number');
});

test('loop: plain-text format — a `loop` line, round trip, and the errors', () => {
  const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
  setWallId(p.walls, edgeId(4, 5, 6), true);
  const text = serialize(p);
  assert.ok(/^loop$/m.test(text));
  const q = parse(text);
  assert.ok(q.loop === true);
  assert.deepStrictEqual(serialize(q), text);
  assert.ok(!parse(serialize(makePuzzle(4))).loop);
  assert.throws(
    () => parse('size 4\nloop 1\ncheckpoints 0,0=1'),
    REFUSED,
    'a value on the loop line',
  );
  assert.throws(() => parse('size 4\nloop\nwrap\ncheckpoints 0,0=1'), REFUSED, 'loop with wrap');
  assert.throws(() => parse('size 4\nloop\nexact\ncheckpoints 0,0=1'), REFUSED, 'loop with exact');
  assert.throws(
    () => parse('size 4\nloop\nholes 1,1\ncheckpoints 0,0=1'),
    REFUSED,
    'loop with holes',
  );
});

test('loop: loopClosers — the open neighbours of cell 1, in the solver order', () => {
  const p = loopPuzzle(4, { 5: 1, 0: 2, 15: 3 });
  assert.deepStrictEqual(loopClosers(p), [6, 4, 9, 1]);
  setWallId(p.walls, edgeId(4, 5, 6), true);
  assert.deepStrictEqual(loopClosers(p), [4, 9, 1]);
  assert.deepStrictEqual(loopClosers(loopPuzzle(4, { 0: 1, 3: 2, 15: 3 })), [1, 4], 'a corner');
});

test('loop: solve finds the ring, one solution, with the closing neighbour not a number', () => {
  const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
  const r = solve(p, { limit: 1e9, nodeCap: 1e9, capture: true });
  assert.ok(r.count === bruteLoop(p).length && r.count > 1, `count ${r.count}`);
  for (const path of r.paths) assert.ok(isSolved(p, path));
  // fewer than 3 numbers: nothing to find (two directions would be two solutions)
  assert.deepStrictEqual(solve(loopPuzzle(4, { 0: 1, 3: 2 }), { limit: 5 }).count, 0);
  assert.deepStrictEqual(
    solve(loopPuzzle(5, { 0: 1, 3: 2, 24: 3 }), { limit: 5 }).count,
    0,
    'odd board',
  );
});

test('loop: solve agrees with brute force on random 4x4 puzzles (counts, paths, K in the middle)', () => {
  let positive = 0;
  let middle = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const K = 3 + (seed % 4);
    const p = randomLoop(seed, 4, K, [0, 0.1, 0.2, 0.3][seed % 4]);
    const want = bruteLoop(p);
    const got = solve(p, { limit: 1e9, nodeCap: 1e9, capture: true });
    assert.deepStrictEqual(got.count, want.length, `seed ${seed}`);
    assert.deepStrictEqual(
      got.paths.map(x => x.join()).sort(),
      want.map(x => x.join()).sort(),
      `paths, seed ${seed}`,
    );
    positive += want.length ? 1 : 0;
    middle += want.some(path => path[path.length - 1] !== p.cp.indexOf(K)) ? 1 : 0;
  }
  assert.ok(positive >= 30, `solvable cases: ${positive}`);
  assert.ok(middle >= 20, `cases where the last cell is not number K: ${middle}`);
});

test('loop: solve agrees with brute force with every prune on, and with limit and capture', () => {
  const flags = {
    prop: true,
    parity: true,
    pocket: true,
    prune2: true,
    seg: 'all',
    legCollide: true,
  };
  for (let seed = 200; seed < 230; seed++) {
    const p = randomLoop(seed, 4, 3 + (seed % 3), 0.15);
    const want = bruteLoop(p).length;
    assert.deepStrictEqual(
      solve(p, { limit: 1e9, nodeCap: 1e9, ...flags }).count,
      want,
      `flags, seed ${seed}`,
    );
    assert.deepStrictEqual(
      solve(p, { limit: 2, nodeCap: 1e9 }).count,
      Math.min(2, want),
      `limit 2, seed ${seed}`,
    );
    assert.deepStrictEqual(
      solve(p, { limit: 1, nodeCap: 1e9, capture: true }).paths.length,
      Math.min(1, want),
    );
  }
  for (let seed = 300; seed < 306; seed++) {
    const p = randomLoop(seed, 6, 4, 0.45);
    const want = bruteLoop(p).length;
    assert.deepStrictEqual(
      solve(p, { limit: 1e9, nodeCap: 1e9, ...flags }).count,
      want,
      `6x6, seed ${seed}`,
    );
  }
});

test('loop: solve with mustUse counts the solutions that use an edge, as a step or as the closing edge', () => {
  let closing = 0;
  for (let seed = 400; seed < 440; seed++) {
    const p = randomLoop(seed, 4, 3 + (seed % 3), 0.1);
    const all = bruteLoop(p);
    const rnd = makeRng(seed);
    for (let i = 0; i < 6; i++) {
      const a = Math.floor(rnd() * 16);
      const b = neighbourCell(4, false, a, Math.floor(rnd() * 4));
      if (b < 0 || !canStep(p, a, b)) continue;
      const want = all.filter(path => usesEdge(path, a, b));
      closing += want.filter(path => path[path.length - 1] === b || path[path.length - 1] === a)
        .length
        ? 1
        : 0;
      const got = solve(p, { limit: 1e9, nodeCap: 1e9, mustUse: [a, b], prop: true });
      assert.deepStrictEqual(got.count, want.length, `seed ${seed} edge ${a}-${b}`);
    }
  }
  assert.ok(closing > 0, 'some check used the closing edge');
});

test('loop: a shared node cap, and nodes and subNodes are summed over the searches', () => {
  const p = randomLoop(8, 6, 4, 0.1);
  const r = solve(p, { limit: 1e9, nodeCap: 1e9 });
  assert.ok(r.nodes > 100 && r.subNodes === r.nodes && !r.exceeded, `nodes ${r.nodes}`);
  const capped = solve(p, { limit: 1e9, nodeCap: 50 });
  assert.ok(capped.exceeded, 'a cap of 50 nodes is not enough to refute every closing cell');
  assert.ok(capped.nodes < r.nodes, 'and the search stops');
});

// ---- the generator

const isRing = (n, ring) => {
  if (ring.length !== n * n || new Set(ring).size !== n * n) return false;
  for (let i = 0; i < ring.length; i++) {
    if (!gridAdjacent(n, ring[i], ring[(i + 1) % ring.length])) return false;
  }
  return true;
};

test('loop-gen: ringPath is a Hamiltonian cycle of the grid, seeded, even sizes only', () => {
  for (const n of [2, 4, 6, 8, 12, 16]) {
    for (let seed = 1; seed <= 5; seed++) {
      const ring = ringPath(n, makeRng(seed));
      assert.ok(isRing(n, ring), `n ${n} seed ${seed}`);
      assert.deepStrictEqual(ringPath(n, makeRng(seed)), ring, 'same seed, same ring');
    }
  }
  assert.ok(ringPath(8, makeRng(1)).join() !== ringPath(8, makeRng(2)).join(), 'seeds differ');
  let threw = false;
  try {
    ringPath(5, makeRng(1));
  } catch {
    threw = true;
  }
  assert.ok(threw, 'odd size');
});

test('loop-gen: loopCheckpoints — cell 1 first, number K short of the way round, a tail between K and cell 1', () => {
  for (const n of [4, 6, 8, 10]) {
    for (let seed = 1; seed <= 6; seed++) {
      const rnd = makeRng(seed);
      const ring = ringPath(n, rnd);
      const K = Math.max(4, n);
      const placed = loopCheckpoints(n, ring, K, rnd);
      if (!placed) continue;
      const { path, positions } = placed;
      const T = n * n;
      assert.ok(
        isRing(n, path) && positions.length === K && positions[0] === 0,
        `n ${n} seed ${seed}`,
      );
      assert.ok(
        positions.every((q, i) => i === 0 || q > positions[i - 1]),
        'ascending',
      );
      const tail = T - 1 - positions[K - 1];
      assert.ok(
        tail >= Math.round(T * LOOP_TAIL[0]) - 1 && tail <= Math.round(T * LOOP_TAIL[1]) - 1,
        `tail ${tail} of ${T}`,
      );
    }
  }
});

test('loop-gen: generateLoop gives a valid, unique Loop puzzle with a solving path, K not on the last cell', () => {
  const cases = [
    [4, 1],
    [4, 2],
    [4, 3],
    [4, 4],
    [6, 1],
    [6, 2],
    [6, 3],
    [6, 4],
    [8, 1],
    [8, 2],
  ];
  for (const [n, seed] of sampled(cases)) {
    const p = runSync(generateLoop(n, seed));
    const label = `n ${n} seed ${seed}`;
    assert.ok(p.loop === true && validate(p).ok, label);
    assert.ok(maxNumber(p) >= 3 && labelCount(p) === maxNumber(p), label);
    assert.ok(isSolved(p, p.path), `${label}: the stored path solves it`);
    const K = maxNumber(p);
    assert.ok(p.path[p.path.length - 1] !== p.cp.indexOf(K), `${label}: K is not the last cell`);
    const found = solve(p, {
      limit: 2,
      nodeCap: 5e6,
      capture: true,
      prop: true,
      parity: true,
    });
    assert.ok(found.count === 1 && !found.exceeded, `${label}: unique`);
    assert.deepStrictEqual(found.paths[0], p.path, `${label}: the solver finds the same ring`);
  }
});

test('loop-gen: generated puzzles are unique by brute force too (4x4 and 6x6)', () => {
  for (const [n, seeds] of [
    [4, [11, 12, 13]],
    [6, [11, 12]],
  ]) {
    for (const seed of seeds) {
      const p = runSync(generateLoop(n, seed));
      const all = bruteLoop(p);
      assert.deepStrictEqual(all.length, 1, `n ${n} seed ${seed}`);
      assert.deepStrictEqual(all[0], p.path);
    }
  }
});

test('loop-gen: same seed, same puzzle; other seeds, other puzzles; a standard puzzle is unchanged by the option', () => {
  const a = serialize(runSync(generateLoop(6, 5)));
  assert.deepStrictEqual(serialize(runSync(generateLoop(6, 5))), a);
  assert.ok(serialize(runSync(generateLoop(6, 6))) !== a);
  assert.ok(!('loop' in runSync(generate(5, 1))));
});

test('loop-gen: only even sizes; the sizes on offer', () => {
  let threw = false;
  try {
    runSync(generateLoop(7, 1));
  } catch {
    threw = true;
  }
  assert.ok(threw);
});

// ---- the variant in the play app

const loopGame = (n, seed) => made('loop', n, seed);
const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: maxNumber(p),
    variant: 'loop',
    puzzle: p,
    ...extra,
  });
// The number of line segments of an SVG path d.
const segments = d => (d.match(/[ML]/g) || []).length;
const pathOf = svg => svg.match(/data-role="path" d="([^"]*)"/)[1];

test('loop-play: routeCells closes the ring of a solved Loop puzzle only', () => {
  const p = loopGame(6, 1);
  const path = p.path.slice();
  assert.deepStrictEqual(routeCells(p, path, false), path, 'not solved yet: the line as it is');
  assert.deepStrictEqual(routeCells(p, path, true), [...path, path[0]], 'solved: back to cell 1');
  const standard = made('std', 5, 1);
  assert.deepStrictEqual(
    routeCells(standard, standard.path, true),
    standard.path,
    'a standard puzzle is not closed',
  );
  assert.deepStrictEqual(routeCells(p, [path[0]], true), [path[0]], 'a line of one cell');
});

test('loop-play: boardSvg draws one more segment when the ring is solved; other boards as before', () => {
  const p = loopGame(6, 2);
  const S = { puzzle: p, path: p.path.slice(), hintCell: null, hintWrongCell: null };
  const open = pathOf(boardSvg({ ...S, finished: false }));
  const closed = pathOf(boardSvg({ ...S, finished: true }));
  assert.deepStrictEqual(segments(closed), segments(open) + 1, 'the closing segment');
  assert.ok(closed.startsWith(open), 'the same line first');
  assert.ok(!/wrap/.test(boardSvg({ ...S, finished: true })), 'not a wrap board');
  const grid = made('std', 5, 2);
  const gridS = { puzzle: grid, path: grid.path.slice(), hintCell: null, hintWrongCell: null };
  assert.deepStrictEqual(
    pathOf(boardSvg({ ...gridS, finished: true })),
    pathOf(boardSvg({ ...gridS, finished: false })),
    'standard',
  );
});

test('loop-play: an unsound loop record is not encodable', () => {
  const p = loopGame(6, 4);
  assert.ok(encodeShare(record(p)) !== null, 'the sound one is');
  const broken = change => {
    const rec = record(p);
    change(rec);
    return encodeShare(rec) === null;
  };
  assert.ok(
    broken(rec => {
      rec.puzzle.loop = false;
    }),
    'no loop flag',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.holes = new Uint8Array(36);
    }),
    'holes',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.wrap = true;
    }),
    'wrap',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 99;
    }),
    'a gap in the numbers',
  );
  assert.ok(
    broken(rec => {
      rec.grade = 2;
    }),
    'a record with a grade',
  );
  const odd = loopGame(6, 4);
  const five = { n: 5, cp: new Uint16Array(25), walls: new Uint8Array(25), loop: true };
  five.cp[0] = 1;
  five.cp[4] = 2;
  five.cp[24] = 3;
  assert.ok(encodeShare(record(five)) === null, 'an odd board');
  const two = {
    n: 6,
    cp: odd.cp.map(v => (v > 2 ? 0 : v)),
    walls: odd.walls.slice(),
    loop: true,
  };
  assert.ok(encodeShare(record(two)) === null, 'two numbers only');
  assert.deepStrictEqual(
    record({ ...p, holes: new Uint8Array(36) }).puzzle.holes,
    undefined,
    'holes are not copied',
  );
  assert.deepStrictEqual(
    record({ ...p, loop: false }).puzzle.loop,
    true,
    'the variant sets the flag',
  );
  assert.deepStrictEqual(record(p, { grade: 2 }).grade, null, 'a variant record has no grade');
});

// (that the planted ring solves the puzzle is a row of variant-contract.test.js)
test('loop-play: a cover that does not close the ring does not solve the puzzle', () => {
  // 4 x 4, numbers on three corners: the serpentine covers the board but ends 3 cells from cell 1
  const p = { n: 4, cp: new Uint16Array(16), walls: new Uint8Array(16), loop: true };
  p.cp[0] = 1;
  p.cp[3] = 2;
  p.cp[15] = 3;
  const snake = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
  const path = [];
  for (const cell of snake) step(p, path, cell, { strictOrder: true });
  assert.deepStrictEqual(path.length, 16, 'all cells are covered');
  assert.ok(!isSolved(p, path), 'but the last cell does not touch cell 1');
});

test('loop-play: lucky game: 8 and 10 while loop is locked, 6 to 12 once it is unlocked', async () => {
  const memory = () => {
    const map = new Map();
    return {
      map,
      async get(k) {
        return map.has(k) ? { value: map.get(k) } : null;
      },
      async set(k, v) {
        map.set(k, v);
      },
    };
  };
  const defs = luckyDefs(PLAY_SIZES);
  const index = defs.findIndex(d => d.id === 'loop');
  const MON = 20731;
  const at = day => () => new Date(day * 86400000);
  const pick = (...values) => {
    const q = [...values];
    return () => q.shift();
  };
  const store = memory();
  let u = createUnlock(store, defs, at(MON));
  await u.init();
  await u.addChoice();
  await u.takeChoice();
  await u.addToken();
  const seen = [];
  for (let k = 0; k < defs[index].locked.length; k++) {
    const game = await u.begin(pick(index, k));
    seen.push(game.size);
    assert.deepStrictEqual(game.isNew, true, 'a locked variant');
    await u.refund();
  }
  assert.deepStrictEqual(seen, [8, 10], 'locked: only 8 and 10');
  await u.begin(pick(index, 0));
  assert.deepStrictEqual((await u.finish(true)).newly, true, 'solved: unlocked');
  u = createUnlock(store, defs, at(20743));
  await u.init();
  const sizes = [];
  for (let k = 0; k < defs[index].pool.length; k++) {
    const game = await u.begin(pick(index, k));
    sizes.push(game.size);
    assert.deepStrictEqual(game.isNew, false, 'an unlocked variant');
    await u.refund();
  }
  assert.deepStrictEqual(sizes, [6, 8, 10, 12], 'unlocked: the sizes of free play');
});
