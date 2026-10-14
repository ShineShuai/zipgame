// Tests of the "Loop" core: the path closes into a ring, so the last cell touches cell 1 and the
// numbers 1..K are met in cyclic order. Model (core/model.js), rules (core/rules.js), plain-text
// format (core/format.js) and the solver (core/solver/solve-loop.js, checked against a plain
// brute-force search). Registered by tests.js: loopTests(t, ok, eq).
import { makePuzzle, clonePuzzle, validate, cellCount, startCell, maxNumber } from '../src/core/model.js';
import { isSolved, step, canStep } from '../src/core/rules.js';
import { serialize, parse } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { loopClosers } from '../src/core/solver/solve-loop.js';
import { allEdges, setWallId, edgeId } from '../src/core/edges.js';
import { neighbourCell } from '../src/core/geom.js';
import { makeRng, shuffle } from '../src/core/rng.js';

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// A Loop puzzle with `numbers` = { cell: number }.
export function loopPuzzle(n, numbers) {
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

// Every path that covers all cells, follows canStep, starts on number 1, meets the numbers in
// order and ends on a cell that canStep to cell 1. The plain definition of the rule, with none of
// the solver's pruning. -> every such path.
export function bruteLoop(p) {
  const total = cellCount(p);
  const start = startCell(p);
  const K = maxNumber(p);
  const visited = new Uint8Array(p.n * p.n);
  const path = [];
  const found = [];
  const walk = (cell, next) => {
    const number = p.cp[cell];
    if (number && number !== next) return;
    path.push(cell);
    visited[cell] = 1;
    if (path.length === total) {
      if (next - (number ? 0 : 1) === K && canStep(p, cell, start)) found.push(path.slice());
    } else {
      for (let d = 0; d < 4; d++) {
        const v = neighbourCell(p.n, false, cell, d);
        if (v >= 0 && !visited[v] && canStep(p, cell, v)) walk(v, number ? next + 1 : next);
      }
    }
    visited[cell] = 0;
    path.pop();
  };
  if (start >= 0) walk(start, 1);
  return found;
}

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
  shuffle([...Array(n * n).keys()], rnd).slice(0, K).forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  for (const e of allEdges(n)) {
    if (rnd() < wallFrac) setWallId(p.walls, e, true);
  }
  return p;
}

export function loopTests(t, ok, eq) {
  t('loop: validate — a ring needs an even board and at least 3 numbers, nothing else is added', () => {
    ok(validate(loopPuzzle(4, { 0: 1, 3: 2, 10: 3 })).ok);
    ok(validate(loopPuzzle(4, { 0: 1, 3: 2, 10: 3 })).max === 3);
    ok(!validate(loopPuzzle(5, { 0: 1, 3: 2, 10: 3 })).ok, 'odd board');
    ok(!validate(loopPuzzle(4, { 0: 1, 3: 2 })).ok, 'two numbers');
    ok(!validate(loopPuzzle(4, { 0: 1, 3: 3, 10: 4 })).ok, 'a gap');
    for (const extra of [{ wrap: true }, { exact: true }, { arrows: new Uint8Array(16) }, { holes: new Uint8Array(16) }]) {
      ok(!validate({ ...loopPuzzle(4, { 0: 1, 3: 2, 10: 3 }), ...extra }).ok, Object.keys(extra)[0]);
    }
    const q = clonePuzzle(loopPuzzle(4, { 0: 1, 3: 2, 10: 3 }));
    ok(q.loop === true && !clonePuzzle(makePuzzle(4)).loop);
  });

  t('loop: isSolved — the last cell has to touch cell 1 through an open edge; K need not be last', () => {
    const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
    ok(isSolved(p, RING), 'the ring');
    ok(!isSolved(p, RING.slice(0, 15)), 'not every cell');
    // a path that covers every cell but ends away from cell 1: the serpentine
    const snake = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
    ok(!isSolved(p, snake), 'the end 12 does not touch cell 0');
    const walled = clonePuzzle(p);
    setWallId(walled.walls, edgeId(4, 0, 4), true);
    ok(!isSolved(walled, RING), 'a wall on the closing edge');
    const swapped = loopPuzzle(4, { 0: 1, 3: 3, 10: 2 });
    ok(!isSolved(swapped, RING), 'numbers out of order');
    ok(RING.indexOf(10) > RING.indexOf(3) && RING[RING.length - 1] !== 10, 'K = 3 sits mid-ring');
  });

  t('loop: step with strictOrder goes on past the last number (the ring closes later)', () => {
    const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
    const path = [];
    for (const cell of RING) ok(step(p, path, cell, { strictOrder: true }) === 'push', `cell ${cell}`);
    ok(isSolved(p, path));
    const standard = clonePuzzle(p);
    delete standard.loop;
    const path2 = [];
    let refused = false;
    for (const cell of RING) refused = refused || step(standard, path2, cell, { strictOrder: true }) === null;
    ok(refused, 'the standard rule stops on the last number');
  });

  t('loop: plain-text format — a `loop` line, round trip, and the errors', () => {
    const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
    setWallId(p.walls, edgeId(4, 5, 6), true);
    const text = serialize(p);
    ok(/^loop$/m.test(text));
    const q = parse(text);
    ok(q.loop === true);
    eq(serialize(q), text);
    ok(!parse(serialize(makePuzzle(4))).loop);
    ok(threw(() => parse('size 4\nloop 1\ncheckpoints 0,0=1')), 'a value on the loop line');
    ok(threw(() => parse('size 4\nloop\nwrap\ncheckpoints 0,0=1')), 'loop with wrap');
    ok(threw(() => parse('size 4\nloop\nexact\ncheckpoints 0,0=1')), 'loop with exact');
    ok(threw(() => parse('size 4\nloop\nholes 1,1\ncheckpoints 0,0=1')), 'loop with holes');
  });

  t('loop: loopClosers — the open neighbours of cell 1, in the solver order', () => {
    const p = loopPuzzle(4, { 5: 1, 0: 2, 15: 3 });
    eq(loopClosers(p), [6, 4, 9, 1]);
    setWallId(p.walls, edgeId(4, 5, 6), true);
    eq(loopClosers(p), [4, 9, 1]);
    eq(loopClosers(loopPuzzle(4, { 0: 1, 3: 2, 15: 3 })), [1, 4], 'a corner');
  });

  t('loop: solve finds the ring, one solution, with the closing neighbour not a number', () => {
    const p = loopPuzzle(4, { 0: 1, 3: 2, 10: 3 });
    const r = solve(p, { limit: 1e9, nodeCap: 1e9, capture: true });
    ok(r.count === bruteLoop(p).length && r.count > 1, `count ${r.count}`);
    for (const path of r.paths) ok(isSolved(p, path));
    // fewer than 3 numbers: nothing to find (two directions would be two solutions)
    eq(solve(loopPuzzle(4, { 0: 1, 3: 2 }), { limit: 5 }).count, 0);
    eq(solve(loopPuzzle(5, { 0: 1, 3: 2, 24: 3 }), { limit: 5 }).count, 0, 'odd board');
  });

  t('loop: solve agrees with brute force on random 4x4 puzzles (counts, paths, K in the middle)', () => {
    let positive = 0;
    let middle = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const K = 3 + (seed % 4);
      const p = randomLoop(seed, 4, K, [0, 0.1, 0.2, 0.3][seed % 4]);
      const want = bruteLoop(p);
      const got = solve(p, { limit: 1e9, nodeCap: 1e9, capture: true });
      eq(got.count, want.length, `seed ${seed}`);
      eq(got.paths.map(x => x.join()).sort(), want.map(x => x.join()).sort(), `paths, seed ${seed}`);
      positive += want.length ? 1 : 0;
      middle += want.some(path => path[path.length - 1] !== p.cp.indexOf(K)) ? 1 : 0;
    }
    ok(positive >= 30, `solvable cases: ${positive}`);
    ok(middle >= 20, `cases where the last cell is not number K: ${middle}`);
  });

  t('loop: solve agrees with brute force with every prune on, and with limit and capture', () => {
    const flags = { prop: true, parity: true, pocket: true, prune2: true, seg: 'all', legCollide: true };
    for (let seed = 200; seed < 230; seed++) {
      const p = randomLoop(seed, 4, 3 + (seed % 3), 0.15);
      const want = bruteLoop(p).length;
      eq(solve(p, { limit: 1e9, nodeCap: 1e9, ...flags }).count, want, `flags, seed ${seed}`);
      eq(solve(p, { limit: 2, nodeCap: 1e9 }).count, Math.min(2, want), `limit 2, seed ${seed}`);
      eq(solve(p, { limit: 1, nodeCap: 1e9, capture: true }).paths.length, Math.min(1, want));
    }
    for (let seed = 300; seed < 306; seed++) {
      const p = randomLoop(seed, 6, 4, 0.45);
      const want = bruteLoop(p).length;
      eq(solve(p, { limit: 1e9, nodeCap: 1e9, ...flags }).count, want, `6x6, seed ${seed}`);
    }
  });

  t('loop: solve with mustUse counts the solutions that use an edge, as a step or as the closing edge', () => {
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
        closing += want.filter(path => path[path.length - 1] === b || path[path.length - 1] === a).length ? 1 : 0;
        const got = solve(p, { limit: 1e9, nodeCap: 1e9, mustUse: [a, b], prop: true });
        eq(got.count, want.length, `seed ${seed} edge ${a}-${b}`);
      }
    }
    ok(closing > 0, 'some check used the closing edge');
  });

  t('loop: a shared node cap, and nodes and subNodes are summed over the searches', () => {
    const p = randomLoop(8, 6, 4, 0.1);
    const r = solve(p, { limit: 1e9, nodeCap: 1e9 });
    ok(r.nodes > 100 && r.subNodes === r.nodes && !r.exceeded, `nodes ${r.nodes}`);
    const capped = solve(p, { limit: 1e9, nodeCap: 50 });
    ok(capped.exceeded, 'a cap of 50 nodes is not enough to refute every closing cell');
    ok(capped.nodes < r.nodes, 'and the search stops');
  });
}
