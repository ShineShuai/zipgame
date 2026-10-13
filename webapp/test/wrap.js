// Tests of the wrap-around (torus) core: the edges that join across the borders (core/edges.js),
// the distance and neighbour rules (core/geom.js), moves (core/rules.js), the solver on such
// boards (core/solver/solve.js, checked against a plain brute-force search) and the plain-text
// format (core/format.js). Registered by tests.js: wrapTests(t, ok, eq).
import { makePuzzle, validate, cellCount, startCell, endCell } from '../src/core/model.js';
import { edgeId, edgeCells, allEdges, setWallId, wallIds, pathEdgeIds } from '../src/core/edges.js';
import { canStep, step, isSolved } from '../src/core/rules.js';
import { serialize, parse } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { buildNeighbors } from '../src/core/solver/prune.js';
import { neighbourCell, gridDist, bipartite } from '../src/core/geom.js';
import { makeRng, shuffle } from '../src/core/rng.js';

const torus = n => ({ ...makePuzzle(n), wrap: true });
const threw = f => { try { f(); return false; } catch { return true; } };

// A random Hamiltonian path of the torus: depth-first search in random order, retried on a budget.
function torusPath(n, rnd) {
  const T = n * n;
  for (let attempt = 0; attempt < 300; attempt++) {
    const vis = new Uint8Array(T), path = [];
    let budget = 4000;
    const go = cell => {
      path.push(cell);
      vis[cell] = 1;
      if (path.length === T) return true;
      if (--budget >= 0) {
        const open = [0, 1, 2, 3].map(d => neighbourCell(n, true, cell, d)).filter(v => !vis[v]);
        for (const v of shuffle(open, rnd)) if (go(v)) return true;
      }
      path.pop(); // every failed branch undoes its own cell, budget or not
      vis[cell] = 0;
      return false;
    };
    if (go(Math.floor(rnd() * T))) return path;
  }
  throw new Error('no torus path found');
}

// A torus puzzle that its own path solves: K numbers spread along the path (1 first, K on the last
// cell), and walls on some of the edges the path does not use.
function torusPuzzle(n, K, rnd, wallFrac = 0.3) {
  const path = torusPath(n, rnd), p = torus(n), T = n * n;
  for (let k = 0; k < K; k++) p.cp[path[Math.round((k * (T - 1)) / (K - 1))]] = k + 1;
  const on = new Set(pathEdgeIds(n, path, true));
  for (const e of allEdges(n, null, true)) {
    if (!on.has(e) && rnd() < wallFrac) setWallId(p.walls, e, true);
  }
  return { p, path };
}

// Every solution of p by plain depth-first search (no solver code): one legal move at a time, a
// numbered cell only when its number is the next one, every cell once, ending on the last number.
function bruteKeys(p) {
  const T = p.n * p.n, total = cellCount(p), end = endCell(p), start = startCell(p);
  const keys = [], path = [start], vis = new Uint8Array(T);
  vis[start] = 1;
  const walk = (cell, next) => {
    if (path.length === total) {
      if (cell === end && isSolved(p, path)) keys.push(path.join(','));
      return;
    }
    for (let v = 0; v < T; v++) {
      if (vis[v] || !canStep(p, cell, v)) continue;
      const number = p.cp[v];
      if (number && number !== next) continue;
      vis[v] = 1;
      path.push(v);
      walk(v, number ? next + 1 : next);
      path.pop();
      vis[v] = 0;
    }
  };
  walk(start, 2);
  return keys.sort();
}

const ALL_PRUNES = {
  prune2: true, prop: true, seg: true, pocket: true, parity: true, legCollide: true,
};
const solverKeys = (p, opts = {}) => solve(p, { limit: 1e9, nodeCap: 1e9, capture: true, ...opts })
  .paths.map(q => q.join(',')).sort();

export { torusPuzzle, bruteKeys, torusPath };

export function wrapTests(t, ok, eq) {
  t('wrap: the seam edges exist; every edge has two cells that are one move apart', () => {
    for (const n of [3, 4, 5]) {
      const es = allEdges(n, null, true);
      eq(es.length, 2 * n * n, `n=${n}: every cell has a right and a down edge`);
      for (const e of es) {
        const [a, b] = edgeCells(n, e, true);
        eq(gridDist(n, true, a, b), 1, `n=${n}: edge ${e} joins neighbours`);
        eq(edgeId(n, a, b, true), e, `n=${n}: edgeId(a, b) round trip`);
        eq(edgeId(n, b, a, true), e, `n=${n}: edgeId(b, a) round trip`);
      }
      const lastRight = (n - 1) * 2, lastDown = ((n - 1) * n) * 2 + 1;
      eq(edgeCells(n, lastRight, true)[1], 0, `n=${n}: last column joins column 0`);
      eq(edgeCells(n, lastDown, true)[1], 0, `n=${n}: last row joins row 0`);
    }
    eq(allEdges(3).length, 12, 'the classic 3 x 3 grid keeps its 12 edges');
  });

  t('wrap: neighbour table: four symmetric neighbours everywhere; grid keeps its border', () => {
    for (const n of [3, 4, 6]) {
      const { nb, T } = buildNeighbors(torus(n));
      for (let i = 0; i < T; i++) {
        const seen = new Set();
        for (let d = 0; d < 4; d++) {
          const j = nb[i * 4 + d];
          ok(j >= 0, `n=${n}: cell ${i} has a neighbour in direction ${d}`);
          eq(nb[j * 4 + (d ^ 1)], i, `n=${n}: the neighbour of ${i} sees it back`);
          seen.add(j);
        }
        eq(seen.size, 4, `n=${n}: four different neighbours`);
      }
    }
    const grid = buildNeighbors(makePuzzle(3)).nb;
    const missing = Array.from(grid).filter(v => v < 0).length;
    eq(missing, 12, 'grid 3 x 3: twelve missing neighbour slots (the border)');
  });

  t('wrap: distance takes the shorter way round; the torus of odd size is not bipartite', () => {
    eq(gridDist(5, true, 0, 4), 1, 'columns 0 and 4 of 5 are one step apart');
    eq(gridDist(5, false, 0, 4), 4, 'the grid keeps the long way');
    eq(gridDist(6, true, 0, 5), 1, 'seam on 6');
    eq(gridDist(6, true, 0, 21), 6, 'opposite corners of 6 x 6: 3 + 3');
    eq(bipartite(3, true), false, 'odd torus: odd cycles, no parity rule');
    eq(bipartite(4, true), true, 'even torus: parity rule holds');
    eq(bipartite(3, false), true, 'grid: parity rule holds');
  });

  t('wrap: moves cross the seam; a wall on a seam edge blocks it', () => {
    const p = torus(3);
    ok(canStep(p, 2, 0) && canStep(p, 0, 2) && canStep(p, 0, 6) && canStep(p, 6, 0),
      'seam moves are legal');
    setWallId(p.walls, edgeId(3, 2, 0, true), true);
    ok(!canStep(p, 2, 0) && !canStep(p, 0, 2), 'a wall on the seam blocks both ways');
    ok(canStep(p, 1, 2), 'other moves are not affected');
    const q = torus(3);
    q.cp[0] = 1;
    q.cp[7] = 2;
    const route = [0, 2, 1, 4, 3, 5, 8, 6, 7];
    const path = [];
    for (const c of route) eq(step(q, path, c), 'push', `move to ${c}`);
    ok(isSolved(q, path), 'a route that uses four seam moves solves the puzzle');
  });

  t('wrap: solver = brute force on random torus puzzles (all prunes; lconn: same nodes)', () => {
    const rnd = makeRng(20261012);
    const sizes = [[3, 2, 4, 60], [4, 3, 5, 40], [5, 6, 8, 20], [6, 8, 10, 4]];
    for (const [n, kLo, kHi, count] of sizes) {
      for (let i = 0; i < count; i++) {
        const K = kLo + Math.floor(rnd() * (kHi - kLo + 1));
        const { p, path } = torusPuzzle(n, K, rnd);
        const brute = bruteKeys(p);
        ok(brute.includes(path.join(',')), `n=${n} #${i}: the planted path is a solution`);
        eq(solverKeys(p), brute, `n=${n} #${i} K=${K}: plain search`);
        eq(solverKeys(p, ALL_PRUNES), brute, `n=${n} #${i} K=${K}: with every prune`);
        const on = solve(p, { limit: 1e9, nodeCap: 1e9, prop: true, lconn: true });
        const off = solve(p, { limit: 1e9, nodeCap: 1e9, prop: true, lconn: false });
        eq(on.nodes, off.nodes, `n=${n} #${i}: lconn visits the same nodes`);
        eq(on.count, off.count, `n=${n} #${i}: lconn finds the same count`);
      }
    }
  });

  t('wrap: a grid edge id refuses non-neighbour cells (a forgotten wrap flag)', () => {
    ok(threw(() => edgeId(3, 0, 2)), 'the seam pair 0, 2 is no grid edge');
    ok(threw(() => edgeId(3, 2, 3)), 'end of a row and start of the next: no grid edge');
    ok(threw(() => edgeId(3, 0, 4)), 'diagonal cells');
    ok(threw(() => pathEdgeIds(3, [0, 2, 1])), 'a seam step without the flag');
    eq(pathEdgeIds(3, [0, 2, 1], true), [4, 2], 'the same steps with the flag');
    eq(edgeId(3, 0, 1), 0, 'right neighbour');
    eq(edgeId(3, 4, 1), 3, 'upper neighbour, either order');
  });

  t('wrap: validate needs n >= 3 and no holes, arrows or Exact numbers', () => {
    const numbered = p => { p.cp[0] = 1; p.cp[1] = 2; return p; };
    ok(validate(numbered(torus(3))).ok, 'a 3 x 3 torus is valid');
    ok(validate(numbered(torus(5))).ok, 'odd sizes are valid');
    const small = validate(numbered(torus(2)));
    ok(!small.ok && /3 x 3/.test(small.msg), '2 x 2 is refused');
    const arrows = numbered(torus(3));
    arrows.arrows = new Uint8Array(9);
    ok(!validate(arrows).ok, 'arrows are refused');
    const holes = numbered(torus(3));
    holes.holes = new Uint8Array(9);
    holes.holes[8] = 1;
    ok(!validate(holes).ok, 'holes are refused');
    ok(validate(numbered(makePuzzle(2))).ok, 'the grid still takes 2 x 2');
  });

  t('wrap: text format: wrap line, seam walls and seam steps; the grid is unchanged', () => {
    const rnd = makeRng(7);
    const { p } = torusPuzzle(4, 3, rnd, 0.4);
    const text = serialize(p);
    ok(/^wrap$/m.test(text), 'a wrap line is written');
    const q = parse(text);
    ok(q.wrap === true, 'parse reads the wrap line');
    eq(Array.from(q.cp).join(), Array.from(p.cp).join(), 'numbers round trip');
    eq(wallIds(q).join(), wallIds(p).join(), 'walls round trip, seam walls included');
    ok(!/^wrap$/m.test(serialize(makePuzzle(3))), 'a grid puzzle has no wrap line');
    ok(threw(() => parse('size 3\nwalls V,0,2')), 'a grid cannot have a seam wall');
    eq(parse('size 3\nwrap\nwalls V,0,2').walls[2], 1, 'the seam wall is read on a torus');
    const seam = parse('size 3\nwrap\npath 0,0 0,2 0,1');
    eq(seam.path.join(','), '0,2,1', 'a seam step is a legal path step');
    ok(threw(() => parse('size 3\npath 0,0 0,2 0,1')), 'the same step is not legal on the grid');
    ok(threw(() => parse('size 2\nwrap')), 'a 2 x 2 torus is refused');
    ok(threw(() => parse('size 3\nwrap\narrows 0,0>0,1')), 'a torus cannot have arrows');
  });
}
