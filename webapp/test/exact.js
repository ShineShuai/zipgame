// Tests of the "Exact" (Hidato-style) core: the number of a cell is its step on the path. Model
// (core/model.js), rules (core/rules.js), plain-text format (core/format.js) and the exact-aware
// solver (core/solver/solve.js). Registered by tests.js: exactTests(t, ok, eq).
import {
  makePuzzle, clonePuzzle, validate, cellCount, startCell, endCell, labelCount, numberedCells,
  checkpointCells, exactRanks, exactLegProblem,
} from '../src/core/model.js';
import { isSolved, step, canStep } from '../src/core/rules.js';
import { serialize, parse } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { allEdges, setWallId, pathEdgeIds, setArrowId } from '../src/core/edges.js';
import { backbite } from '../src/core/gen/hampath.js';
import { makeRng, shuffle } from '../src/core/rng.js';

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
// its own step. The plain definition of the rule, with none of the solver's pruning.
// -> { count, first }.
function bruteExact(p) {
  const total = cellCount(p);
  const start = startCell(p);
  const claimed = new Set(p.cp.filter(Boolean));
  const visited = new Uint8Array(p.n * p.n);
  const path = [];
  let count = 0;
  let first = null;
  const walk = (cell, length) => {
    const number = p.cp[cell];
    if (number ? number !== length : claimed.has(length)) return;
    path.push(cell);
    if (length === total) {
      count++;
      first = first || path.slice();
    } else {
      visited[cell] = 1;
      for (let next = 0; next < p.n * p.n; next++) {
        if (!visited[next] && canStep(p, cell, next)) walk(next, length + 1);
      }
      visited[cell] = 0;
    }
    path.pop();
  };
  if (start >= 0) walk(start, 1);
  return { count, first };
}

// A random puzzle that has at least one solution: random Hamiltonian path, `extra` numbers besides
// 1 and the cell count, walls on edges the path does not use.
function randomExact(seed, n, extra, wallFrac = 0) {
  const rnd = makeRng(seed);
  const path = backbite(n, rnd);
  const p = makePuzzle(n);
  p.exact = true;
  const steps = shuffle([...Array(n * n - 2).keys()].map(i => i + 2), rnd).slice(0, extra);
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

export function exactTests(t, ok, eq) {
  t('exact: validate (gaps ok; 1 and the cell count needed; legs must fit), clone', () => {
    const p = exactPuzzle(4, { 0: 1, 5: 3, 14: 16 });
    eq(validate(p), { ok: true, max: 3 });
    eq([labelCount(p), numberedCells(p), checkpointCells(p)], [3, [0, 5, 14], [0, 5, 14]]);
    eq(clonePuzzle(p).exact, true);
    eq(clonePuzzle(makePuzzle(4)).exact, undefined, 'a standard puzzle stays standard');
    const ranks = exactRanks(exactPuzzle(4, { 14: 16, 0: 1, 5: 3 }));
    eq([ranks.rank[0], ranks.rank[5], ranks.rank[14], ranks.rank[1]], [1, 2, 3, 0]);
    eq([...ranks.steps], [0, 1, 3, 16, 0]);
    const bad = (numbers, message) => {
      const v = validate(exactPuzzle(4, numbers));
      ok(!v.ok && v.msg.includes(message), `${JSON.stringify(numbers)}: ${v.msg}`);
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
    ok(!validate(arrows).ok && validate(arrows).msg.includes('arrows'), 'no one-way arrows');
    const holes = exactPuzzle(4, { 0: 1, 15: 15 });
    holes.holes = new Uint8Array(16);
    holes.holes[5] = 1;
    eq([cellCount(holes), validate(holes).ok], [15, true], 'the last number counts the holes out');
    eq(exactLegProblem(p), null);
    const parity = exactLegProblem(exactPuzzle(4, { 0: 1, 2: 3, 3: 5 }));
    ok(parity !== null, '3 -> 5: neighbours, 2 steps');
    eq(validate(makePuzzle(3)).ok, false);
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 4;
    ok(!validate(standard).ok, 'a gap is still an error in a standard puzzle');
  });

  t('exact: isSolved wants each number on its step; strictOrder refuses it off its step', () => {
    const snake = [0, 1, 2, 5, 4, 3, 6, 7, 8];
    const columns = [0, 3, 6, 7, 4, 1, 2, 5, 8];
    const p = exactPuzzle(3, { 0: 1, 2: 3, 8: 9 });
    eq([isSolved(p, snake), isSolved(p, columns)], [true, false], '3 is on step 3 or on step 7');
    // the same cells as a standard puzzle 1, 2, 3: only the order of the checkpoints counts there
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[2] = 2;
    standard.cp[8] = 3;
    eq([isSolved(standard, snake), isSolved(standard, columns)], [true, true]);
    eq(isSolved(p, snake.slice(0, 8)), false, 'incomplete');
    eq(isSolved(p, [...snake].reverse()), false, 'wrong start and end');
    const early = [0, 1, 4, 3, 6, 7, 8, 5, 2];
    eq(isSolved(exactPuzzle(3, { 0: 1, 4: 3, 2: 9 }), early), true, 'the centre is step 3');
    eq(isSolved(exactPuzzle(3, { 0: 1, 4: 5, 2: 9 }), early), false, 'the centre is not step 5');
    const S = { strictOrder: true };
    const q = exactPuzzle(3, { 0: 1, 3: 3, 8: 9 });
    const path = [];
    eq(step(q, path, 0, S), 'push');
    eq(step(q, path, 3, S), null, 'number 3 on step 2');
    eq(step(q, path, 1, S), 'push');
    eq(step(q, path, 4, S), null, 'step 3 belongs to number 3: no other cell goes there');
    eq(step(q, path, 2, S), null, 'nor this one');
    eq(step(q, path, 0, S), 'pop', 'going back is free');
    eq(step(q, path, 3, S), null, 'still step 2');
    const free = exactPuzzle(3, { 0: 1, 1: 2, 8: 9 });
    const open = [0];
    const walked = [1, 2, 5].map(cell => step(free, open, cell, S));
    eq(walked, ['push', 'push', 'push']);
    eq(step(free, open, 4, S), 'push', 'steps without a number take any unnumbered cell');
  });

  t('exact: text format keeps the `exact` line, takes no values; standard text unchanged', () => {
    const p = exactPuzzle(5, EXAMPLE);
    const text = serialize(p);
    ok(/^exact$/m.test(text), 'an exact line');
    const q = parse(text);
    eq([q.exact, [...q.cp]], [true, [...p.cp]]);
    eq(serialize(q), text, 'round trip');
    const standard = makePuzzle(3);
    standard.cp[0] = 1;
    standard.cp[8] = 2;
    const plain = serialize(standard);
    ok(!/^exact$/m.test(plain) && !plain.includes('Exact'), 'nothing for a standard puzzle');
    eq(parse(serialize(standard)).exact, undefined);
    let message = '';
    try {
      parse('size 3\ncheckpoints 0,0=1\nexact yes');
    } catch (e) {
      message = e.message;
    }
    ok(message.includes('no values'), message);
    message = '';
    try {
      parse('size 3\ncheckpoints 0,0=1\nexact\narrows');
    } catch (e) {
      message = e.message;
    }
    ok(message.includes('cannot have arrows'), message);
    const withPath = parse(serialize(p, { path: EXAMPLE_PATH }));
    eq(withPath.path, EXAMPLE_PATH);
  });

  t('exact: the 5x5 example has one solution; the same cells as a standard puzzle, more', () => {
    const p = exactPuzzle(5, EXAMPLE);
    eq(validate(p).ok, true);
    eq(isSolved(p, EXAMPLE_PATH), true);
    const r = solve(p, { limit: 5, nodeCap: 1e6, capture: true, prop: true, parity: true });
    eq([r.count, r.exceeded], [1, false]);
    eq(r.paths[0], EXAMPLE_PATH);
    eq(bruteExact(p).count, 1);
    const standard = makePuzzle(5);
    standard.cp[14] = 1;
    standard.cp[17] = 2;
    standard.cp[11] = 3;
    standard.cp[16] = 4;
    const loose = solve(standard, { limit: 2, nodeCap: 1e6 });
    eq(loose.count, 2, 'the order alone does not fix the path');
  });

  t('exact: solver matches brute force (n=3..5, real or shifted numbers, walls)', () => {
    let compared = 0;
    let withSolutions = 0;
    let withoutSolutions = 0;
    for (let seed = 1; seed <= 90; seed++) {
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
          eq([got.count, got.exceeded], [want, false], tag);
        }
        compared++;
      }
    }
    const split = `${withSolutions} with, ${withoutSolutions} without solutions`;
    ok(withSolutions >= 90 && withoutSolutions >= 5, split);
    eq(compared, 180);
  });

  t('exact: solver with holes; captured paths solve it; limit and forced prefix work', () => {
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
    ok(path && path.length === 14, 'a Hamiltonian path of the 14 cells exists');
    const p = clonePuzzle(base);
    for (const s of [1, 4, 9, 14]) {
      p.cp[path[s - 1]] = s;
    }
    eq(validate(p).ok, true);
    const want = bruteExact(p).count;
    ok(want >= 1);
    for (const flags of FLAG_SETS) {
      const r = solve(p, { limit: 1e9, nodeCap: 1e8, capture: true, ...flags });
      eq([r.count, r.exceeded], [want, false], JSON.stringify(flags));
      ok(r.paths.every(solution => isSolved(p, solution)), 'every captured path solves it');
    }
    eq(solve(p, { limit: 1, nodeCap: 1e6 }).count, 1, 'limit 1');
    // a forced prefix of a solution leads to a solution
    const prefix = path.slice(0, 3);
    eq(solve(p, { limit: 1, nodeCap: 1e6, forced: prefix, prop: true, parity: true }).count, 1);
  });

  t('exact: each wrong turn of a unique solution is refuted; no search if legs cannot fit', () => {
    const p = exactPuzzle(5, EXAMPLE);
    let wrongTurns = 0;
    for (let i = 0; i < EXAMPLE_PATH.length - 1; i++) {
      const seen = new Set(EXAMPLE_PATH.slice(0, i + 1));
      for (let next = 0; next < 25; next++) {
        const onward = next === EXAMPLE_PATH[i + 1];
        if (seen.has(next) || onward || !canStep(p, EXAMPLE_PATH[i], next)) continue;
        const forced = EXAMPLE_PATH.slice(0, i + 1).concat(next);
        const r = solve(p, { limit: 1, nodeCap: 1e6, forced, prop: true, parity: true });
        eq([r.count, r.exceeded], [0, false], `step ${i + 1} -> ${next}`);
        wrongTurns++;
      }
    }
    ok(wrongTurns >= 10, `${wrongTurns} wrong turns`);
    const prefix = EXAMPLE_PATH.slice(0, 10);
    const right = solve(p, { limit: 1, nodeCap: 1e6, forced: prefix, prop: true });
    eq(right.count, 1, 'the true prefix leads to the solution');
    // last number not on the last step / legs that cannot fit: no search at all
    const lastEarly = exactPuzzle(5, { 14: 1, 17: 12, 11: 20 });
    const early = solve(lastEarly, { limit: 2 });
    eq([early.count, early.exceeded, early.nodes], [0, false, 0]);
    const tooFar = exactPuzzle(5, { 0: 1, 24: 25, 4: 3 });
    const none = solve(tooFar, { limit: 2, capture: true });
    eq([none.count, none.nodes, none.paths], [0, 0, []]);
    let message = '';
    const arrowsToo = exactPuzzle(3, { 0: 1, 8: 9 });
    arrowsToo.arrows = new Uint8Array(9);
    try {
      solve(arrowsToo);
    } catch (e) {
      message = e.message;
    }
    ok(message.includes('Exact'), message);
  });

  t('exact: the step of the next number bounds the search: fewer solutions and nodes', () => {
    const n = 5;
    const path = backbite(n, makeRng(11));
    const numbers = { [path[0]]: 1, [path[5]]: 6, [path[24]]: 25 };
    const p = exactPuzzle(n, numbers);
    const flags = { prop: true, parity: true, prune2: true };
    const exact = solve(p, { limit: 1e9, nodeCap: 1e8, capture: true, ...flags });
    ok(!exact.exceeded && exact.count >= 1);
    ok(exact.paths.every(solution => solution[5] === path[5]), '6 is on step 6 in every solution');
    eq(exact.count, bruteExact(p).count);
    const standard = makePuzzle(n);
    standard.cp[path[0]] = 1;
    standard.cp[path[5]] = 2;
    standard.cp[path[24]] = 3;
    const wide = solve(standard, { limit: 1e9, nodeCap: 1e8, ...flags });
    ok(wide.count > exact.count, `${wide.count} standard solutions vs ${exact.count}`);
    ok(wide.nodes > exact.nodes, `${wide.nodes} standard nodes vs ${exact.nodes}`);
  });
}
