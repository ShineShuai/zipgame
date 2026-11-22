// Tests of the wrap-around (torus) puzzle: the core (the edges that join across the borders, the
// distance and neighbour rules, moves, the solver checked against a plain brute-force search of
// test/oracle.js, the plain-text format), the generator (paths, checkpoint gaps, walls,
// generate / generateUnique) and the variant in the play app and the shared code around it (view
// geometry over a seam, board markup, icon, registry entry, share code and record, grade).
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST, SLOW } from '../harness.js';
import { makePuzzle, validate, maxNumber } from '../../src/core/model.js';
import {
  edgeId,
  edgeCells,
  allEdges,
  setWallId,
  wallIds,
  pathEdgeIds,
  hasWallId,
} from '../../src/core/edges.js';
import { canStep, step, isSolved } from '../../src/core/rules.js';
import { serialize, parse } from '../../src/core/format.js';
import { solve } from '../../src/core/solver/solve.js';
import { buildNeighbors } from '../../src/core/solver/prune.js';
import { neighbourCell, gridDist, bipartite } from '../../src/core/geom.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { solutionKeys as bruteKeys } from '../oracle.js';
import { backbite, warnsdorff } from '../../src/core/gen/hampath.js';
import { gapCheckpoints } from '../../src/core/gen/checkpoints.js';
import { makeUnique } from '../../src/core/gen/walls.js';
import {
  generate,
  generateUnique,
  randomPathPuzzle,
  WRAP_CANDIDATES,
  PLAY_SIZES,
} from '../../src/core/gen/generate.js';
import {
  cellAtPoint,
  pathD,
  wallSegments,
  seamMarks,
  WRAP_PAD,
  SEAM_STUB,
} from '../../src/view/geometry.js';
import { boardSvg, seamMarksSvg, CELL } from '../../src/apps/play/board.js';
import { createUnlock } from '../../src/features/unlock.js';
import { sizesFor, luckyDefs } from '../../src/apps/play/variants.js';
import { encodeShare, decodeShare } from '../../src/core/share-code.js';
import { makeShareRecord, shareStatus } from '../../src/features/share.js';
import { made } from '../fixtures/made.js';

// ---- the core: edges, rules, solver, format

const torus = n => ({ ...makePuzzle(n), wrap: true });
const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// A random Hamiltonian path of the torus: depth-first search in random order, retried on a budget.
function torusPath(n, rnd) {
  const T = n * n;
  for (let attempt = 0; attempt < 300; attempt++) {
    const vis = new Uint8Array(T),
      path = [];
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
  const path = torusPath(n, rnd),
    p = torus(n),
    T = n * n;
  for (let k = 0; k < K; k++) p.cp[path[Math.round((k * (T - 1)) / (K - 1))]] = k + 1;
  const on = new Set(pathEdgeIds(n, path, true));
  for (const e of allEdges(n, null, true)) {
    if (!on.has(e) && rnd() < wallFrac) setWallId(p.walls, e, true);
  }
  return { p, path };
}

const ALL_PRUNES = {
  prune2: true,
  prop: true,
  seg: true,
  pocket: true,
  parity: true,
  legCollide: true,
};
const solverKeys = (p, opts = {}) =>
  solve(p, { limit: 1e9, nodeCap: 1e9, capture: true, ...opts })
    .paths.map(q => q.join(','))
    .sort();

test('wrap: the seam edges exist; every edge has two cells that are one move apart', FAST, () => {
  for (const n of [3, 4, 5]) {
    const es = allEdges(n, null, true);
    assert.deepStrictEqual(es.length, 2 * n * n, `n=${n}: every cell has a right and a down edge`);
    for (const e of es) {
      const [a, b] = edgeCells(n, e, true);
      assert.deepStrictEqual(gridDist(n, true, a, b), 1, `n=${n}: edge ${e} joins neighbours`);
      assert.deepStrictEqual(edgeId(n, a, b, true), e, `n=${n}: edgeId(a, b) round trip`);
      assert.deepStrictEqual(edgeId(n, b, a, true), e, `n=${n}: edgeId(b, a) round trip`);
    }
    const lastRight = (n - 1) * 2,
      lastDown = (n - 1) * n * 2 + 1;
    assert.deepStrictEqual(
      edgeCells(n, lastRight, true)[1],
      0,
      `n=${n}: last column joins column 0`,
    );
    assert.deepStrictEqual(edgeCells(n, lastDown, true)[1], 0, `n=${n}: last row joins row 0`);
  }
  assert.deepStrictEqual(allEdges(3).length, 12, 'the classic 3 x 3 grid keeps its 12 edges');
});

test(
  'wrap: neighbour table: four symmetric neighbours everywhere; grid keeps its border',
  FAST,
  () => {
    for (const n of [3, 4, 6]) {
      const { nb, T } = buildNeighbors(torus(n));
      for (let i = 0; i < T; i++) {
        const seen = new Set();
        for (let d = 0; d < 4; d++) {
          const j = nb[i * 4 + d];
          assert.ok(j >= 0, `n=${n}: cell ${i} has a neighbour in direction ${d}`);
          assert.deepStrictEqual(
            nb[j * 4 + (d ^ 1)],
            i,
            `n=${n}: the neighbour of ${i} sees it back`,
          );
          seen.add(j);
        }
        assert.deepStrictEqual(seen.size, 4, `n=${n}: four different neighbours`);
      }
    }
    const grid = buildNeighbors(makePuzzle(3)).nb;
    const missing = Array.from(grid).filter(v => v < 0).length;
    assert.deepStrictEqual(missing, 12, 'grid 3 x 3: twelve missing neighbour slots (the border)');
  },
);

test(
  'wrap: distance takes the shorter way round; the torus of odd size is not bipartite',
  FAST,
  () => {
    assert.deepStrictEqual(gridDist(5, true, 0, 4), 1, 'columns 0 and 4 of 5 are one step apart');
    assert.deepStrictEqual(gridDist(5, false, 0, 4), 4, 'the grid keeps the long way');
    assert.deepStrictEqual(gridDist(6, true, 0, 5), 1, 'seam on 6');
    assert.deepStrictEqual(gridDist(6, true, 0, 21), 6, 'opposite corners of 6 x 6: 3 + 3');
    assert.deepStrictEqual(bipartite(3, true), false, 'odd torus: odd cycles, no parity rule');
    assert.deepStrictEqual(bipartite(4, true), true, 'even torus: parity rule holds');
    assert.deepStrictEqual(bipartite(3, false), true, 'grid: parity rule holds');
  },
);

test('wrap: moves cross the seam; a wall on a seam edge blocks it', FAST, () => {
  const p = torus(3);
  assert.ok(
    canStep(p, 2, 0) && canStep(p, 0, 2) && canStep(p, 0, 6) && canStep(p, 6, 0),
    'seam moves are legal',
  );
  setWallId(p.walls, edgeId(3, 2, 0, true), true);
  assert.ok(!canStep(p, 2, 0) && !canStep(p, 0, 2), 'a wall on the seam blocks both ways');
  assert.ok(canStep(p, 1, 2), 'other moves are not affected');
  const q = torus(3);
  q.cp[0] = 1;
  q.cp[7] = 2;
  const route = [0, 2, 1, 4, 3, 5, 8, 6, 7];
  const path = [];
  for (const c of route) assert.deepStrictEqual(step(q, path, c), 'push', `move to ${c}`);
  assert.ok(isSolved(q, path), 'a route that uses four seam moves solves the puzzle');
});

test(
  'wrap: solver = brute force on random torus puzzles (all prunes; lconn: same nodes)',
  SLOW,
  () => {
    const rnd = makeRng(20261012);
    const sizes = [
      [3, 2, 4, 60],
      [4, 3, 5, 40],
      [5, 6, 8, 20],
      [6, 8, 10, 4],
    ];
    for (const [n, kLo, kHi, count] of sizes) {
      for (let i = 0; i < count; i++) {
        const K = kLo + Math.floor(rnd() * (kHi - kLo + 1));
        const { p, path } = torusPuzzle(n, K, rnd);
        const brute = bruteKeys(p);
        assert.ok(brute.includes(path.join(',')), `n=${n} #${i}: the planted path is a solution`);
        assert.deepStrictEqual(solverKeys(p), brute, `n=${n} #${i} K=${K}: plain search`);
        assert.deepStrictEqual(
          solverKeys(p, ALL_PRUNES),
          brute,
          `n=${n} #${i} K=${K}: with every prune`,
        );
        const on = solve(p, { limit: 1e9, nodeCap: 1e9, prop: true, lconn: true });
        const off = solve(p, { limit: 1e9, nodeCap: 1e9, prop: true, lconn: false });
        assert.deepStrictEqual(on.nodes, off.nodes, `n=${n} #${i}: lconn visits the same nodes`);
        assert.deepStrictEqual(on.count, off.count, `n=${n} #${i}: lconn finds the same count`);
      }
    }
  },
);

test('wrap: a grid edge id refuses non-neighbour cells (a forgotten wrap flag)', FAST, () => {
  assert.ok(
    threw(() => edgeId(3, 0, 2)),
    'the seam pair 0, 2 is no grid edge',
  );
  assert.ok(
    threw(() => edgeId(3, 2, 3)),
    'end of a row and start of the next: no grid edge',
  );
  assert.ok(
    threw(() => edgeId(3, 0, 4)),
    'diagonal cells',
  );
  assert.ok(
    threw(() => pathEdgeIds(3, [0, 2, 1])),
    'a seam step without the flag',
  );
  assert.deepStrictEqual(pathEdgeIds(3, [0, 2, 1], true), [4, 2], 'the same steps with the flag');
  assert.deepStrictEqual(edgeId(3, 0, 1), 0, 'right neighbour');
  assert.deepStrictEqual(edgeId(3, 4, 1), 3, 'upper neighbour, either order');
});

test('wrap: validate needs n >= 3 and no holes, arrows or Exact numbers', FAST, () => {
  const numbered = p => {
    p.cp[0] = 1;
    p.cp[1] = 2;
    return p;
  };
  assert.ok(validate(numbered(torus(3))).ok, 'a 3 x 3 torus is valid');
  assert.ok(validate(numbered(torus(5))).ok, 'odd sizes are valid');
  const small = validate(numbered(torus(2)));
  assert.ok(!small.ok && /3 x 3/.test(small.msg), '2 x 2 is refused');
  const arrows = numbered(torus(3));
  arrows.arrows = new Uint8Array(9);
  assert.ok(!validate(arrows).ok, 'arrows are refused');
  const holes = numbered(torus(3));
  holes.holes = new Uint8Array(9);
  holes.holes[8] = 1;
  assert.ok(!validate(holes).ok, 'holes are refused');
  assert.ok(validate(numbered(makePuzzle(2))).ok, 'the grid still takes 2 x 2');
});

test(
  'wrap: text format: wrap line, seam walls and seam steps; the grid is unchanged',
  FAST,
  () => {
    const rnd = makeRng(7);
    const { p } = torusPuzzle(4, 3, rnd, 0.4);
    const text = serialize(p);
    assert.ok(/^wrap$/m.test(text), 'a wrap line is written');
    const q = parse(text);
    assert.ok(q.wrap === true, 'parse reads the wrap line');
    assert.deepStrictEqual(Array.from(q.cp).join(), Array.from(p.cp).join(), 'numbers round trip');
    assert.deepStrictEqual(
      wallIds(q).join(),
      wallIds(p).join(),
      'walls round trip, seam walls included',
    );
    assert.ok(!/^wrap$/m.test(serialize(makePuzzle(3))), 'a grid puzzle has no wrap line');
    assert.ok(
      threw(() => parse('size 3\nwalls V,0,2')),
      'a grid cannot have a seam wall',
    );
    assert.deepStrictEqual(
      parse('size 3\nwrap\nwalls V,0,2').walls[2],
      1,
      'the seam wall is read on a torus',
    );
    const seam = parse('size 3\nwrap\npath 0,0 0,2 0,1');
    assert.deepStrictEqual(seam.path.join(','), '0,2,1', 'a seam step is a legal path step');
    assert.ok(
      threw(() => parse('size 3\npath 0,0 0,2 0,1')),
      'the same step is not legal on the grid',
    );
    assert.ok(
      threw(() => parse('size 2\nwrap')),
      'a 2 x 2 torus is refused',
    );
    assert.ok(
      threw(() => parse('size 3\nwrap\narrows 0,0>0,1')),
      'a torus cannot have arrows',
    );
  },
);

// ---- the generator

const run = g => {
  let step = g.next();
  while (!step.done) step = g.next();
  return step.value;
};
const walls = p => allEdges(p.n, null, true).filter(e => hasWallId(p.walls, e));
// An edge across the seam: the right edge of the last column or the down edge of the last row.
const seamEdge = (n, e) => ((e & 1) === 0 ? (e >> 1) % n === n - 1 : e >> 1 >= n * (n - 1));
// A path of the wrap-around board: every cell once, every step one move (seams included).
const isTorusPath = (n, path) =>
  path.length === n * n &&
  new Set(path).size === n * n &&
  path.every((c, i) => i === 0 || gridDist(n, true, path[i - 1], c) === 1);
const onGrid = (n, path) =>
  path.every((c, i) => i === 0 || gridDist(n, false, path[i - 1], c) === 1);

test(
  'wrap-gen: backbite and warnsdorff cover the torus, use the seams; grid unchanged',
  FAST,
  () => {
    let seam = 0;
    for (const n of [3, 4, 5, 6]) {
      for (let s = 1; s <= 25; s++) {
        const path = backbite(n, makeRng(s), true);
        assert.ok(isTorusPath(n, path), `backbite n=${n} seed ${s}`);
        seam += path.filter((c, i) => i > 0 && gridDist(n, false, path[i - 1], c) !== 1).length;
        const w = warnsdorff(n, makeRng(s), true);
        assert.ok(w === null || isTorusPath(n, w), `warnsdorff n=${n} seed ${s}`);
      }
    }
    assert.ok(seam > 100, `backbite steps across the seams (${seam})`);
    for (const n of [4, 5, 7]) {
      const g = backbite(n, makeRng(3));
      assert.ok(onGrid(n, g), `grid backbite n=${n} stays on the grid`);
      assert.deepStrictEqual(
        backbite(n, makeRng(3), false),
        g,
        `an explicit wrap = false changes nothing (n=${n})`,
      );
      assert.deepStrictEqual(
        warnsdorff(n, makeRng(3), false),
        warnsdorff(n, makeRng(3)),
        `warnsdorff (n=${n})`,
      );
    }
  },
);

test('wrap-gen: gapCheckpoints on a torus: valid, and it uses the wrap distances', FAST, () => {
  let differs = 0;
  for (const n of [4, 5, 6]) {
    for (let s = 1; s <= 10; s++) {
      const path = backbite(n, makeRng(s), true),
        K = n + 1;
      const pos = gapCheckpoints(n, path, K, true);
      const tag = `n=${n} seed ${s}`;
      assert.ok(
        pos && pos.length === K && pos[0] === 0 && pos[K - 1] === n * n - 1,
        `${tag}: ends`,
      );
      for (let i = 1; i < K; i++) {
        const gap = gridDist(n, true, path[pos[i - 1]], path[pos[i]]);
        assert.ok(
          pos[i] > pos[i - 1] && gap <= pos[i] - pos[i - 1],
          `${tag}: ascending, reachable`,
        );
      }
      const grid = gapCheckpoints(n, path, K, false);
      if (!grid || grid.join() !== pos.join()) differs++;
    }
  }
  assert.ok(differs > 0, `the wrap distances change some placements (${differs} of 30)`);
});

test(
  'wrap-gen: generate(wrap): unique torus puzzles (brute force n 3, 4; plain search 5)',
  SLOW,
  () => {
    for (const [n, count] of [
      [3, 12],
      [4, 12],
      [5, 6],
    ]) {
      for (let s = 1; s <= count; s++) {
        const p = run(generate(n, s, { wrap: true }));
        const tag = `n=${n} seed ${s}`;
        assert.ok(p.wrap === true, `${tag}: wrap flag`);
        assert.ok(validate(p).ok, `${tag}: valid`);
        assert.ok(isSolved(p, p.path), `${tag}: the planted path solves it`);
        const planted = new Set(pathEdgeIds(n, p.path, true));
        assert.ok(
          walls(p).every(e => !planted.has(e)),
          `${tag}: no wall on the planted path`,
        );
        const plain = solve(p, { limit: 2, nodeCap: 1e9, capture: true });
        assert.deepStrictEqual(plain.count, 1, `${tag}: one solution (plain search)`);
        assert.deepStrictEqual(
          plain.paths[0].join(','),
          p.path.join(','),
          `${tag}: it is the planted path`,
        );
        if (n <= 4) {
          assert.deepStrictEqual(
            bruteKeys(p),
            [p.path.join(',')],
            `${tag}: brute force finds only the planted path`,
          );
        }
      }
    }
  },
);

test(
  'wrap-gen: every wall of a generated torus puzzle is needed (removing it adds one)',
  SLOW,
  () => {
    for (const n of [4, 5]) {
      for (let s = 1; s <= 8; s++) {
        const p = run(generate(n, 40 + s, { wrap: true }));
        for (const e of walls(p)) {
          setWallId(p.walls, e, false);
          const count = solve(p, { limit: 2, nodeCap: 1e9 }).count;
          assert.ok(count >= 2, `n=${n} seed ${40 + s}: wall ${e} is removable`);
          setWallId(p.walls, e, true);
        }
      }
    }
  },
);

test('wrap-gen: makeUnique may wall every seam edge off the path (seeded with all)', FAST, () => {
  for (const n of [4, 5]) {
    const path = backbite(n, makeRng(n), true);
    const p = { ...makePuzzle(n), wrap: true };
    [0, 1, 2, path.length - 1].forEach((q, i) => {
      p.cp[path[q]] = i + 1;
    });
    const cfg = { nodeCap: 1e6, wallBudget: null, seedFraction: 1, K: 4, prop: true };
    const order = run(makeUnique(p, path, makeRng(1), cfg));
    assert.ok(order !== null, `n=${n}: unique`);
    const planted = new Set(pathEdgeIds(n, path, true));
    const free = allEdges(n, null, true).filter(e => !planted.has(e));
    assert.deepStrictEqual(
      walls(p).length,
      free.length,
      `n=${n}: every edge off the path is walled`,
    );
    assert.ok(
      free.some(e => seamEdge(n, e)),
      `n=${n}: ... and some of them are seam edges`,
    );
  }
});

test(
  'wrap-gen: seam walls and steps occur; torus puzzles need more walls than grid ones',
  SLOW,
  () => {
    let seamWalls = 0,
      seamSteps = 0,
      torusWalls = 0,
      gridWalls = 0;
    const N = 20,
      n = 5;
    for (let s = 1; s <= N; s++) {
      const p = run(generate(n, s, { wrap: true }));
      seamWalls += walls(p).filter(e => seamEdge(n, e)).length;
      seamSteps += pathEdgeIds(n, p.path, true).filter(e => seamEdge(n, e)).length;
      torusWalls += walls(p).length;
      const g = run(generate(n, s));
      gridWalls += allEdges(n).filter(e => hasWallId(g.walls, e)).length;
    }
    assert.ok(seamWalls > 0, `a wall on a seam edge (${seamWalls} in ${N} puzzles)`);
    assert.ok(seamSteps > N, `the planted paths cross the seams (${seamSteps})`);
    assert.ok(
      torusWalls > 2 * gridWalls,
      `walls: torus ${torusWalls}, grid ${gridWalls} (${N} puzzles)`,
    );
  },
);

test(
  'wrap-gen: same seed, same puzzle; the text format round-trips a generated puzzle',
  SLOW,
  () => {
    for (const n of [4, 6]) {
      const a = run(generate(n, 9, { wrap: true })),
        b = run(generate(n, 9, { wrap: true }));
      assert.deepStrictEqual(Array.from(a.cp).join(), Array.from(b.cp).join(), `n=${n}: cp`);
      assert.deepStrictEqual(wallIds(a).join(), wallIds(b).join(), `n=${n}: walls`);
      const q = parse(serialize(a));
      assert.ok(q.wrap === true, `n=${n}: wrap survives the text format`);
      assert.deepStrictEqual(wallIds(q).join(), wallIds(a).join(), `n=${n}: walls survive`);
      assert.deepStrictEqual(
        solve(q, { limit: 2, nodeCap: 1e9 }).count,
        1,
        `n=${n}: the parsed puzzle is unique`,
      );
    }
    assert.ok(!run(generate(5, 9)).wrap, 'a grid puzzle has no wrap flag');
  },
);

test('wrap-gen: generateUnique and randomPathPuzzle take wrap; n < 3 is refused', FAST, () => {
  const r = run(generateUnique(5, 5, makeRng(4), { wrap: true, nodeCap: 20000 }));
  assert.ok(r.unique && r.puzzle.wrap === true, 'a unique wrap-around puzzle');
  assert.deepStrictEqual(
    solve(r.puzzle, { limit: 2, nodeCap: 1e9 }).count,
    1,
    'it has one solution',
  );
  const free = randomPathPuzzle(4, 4, makeRng(2), true);
  assert.ok(free.wrap === true && isTorusPath(4, free.path), 'randomPathPuzzle: a torus path');
  assert.ok(!randomPathPuzzle(4, 4, makeRng(2)).wrap, 'randomPathPuzzle: the grid default');
  assert.ok(
    threw(() => run(generate(2, 1, { wrap: true }))),
    'generate: 2 x 2 is refused',
  );
  assert.ok(
    threw(() => run(generateUnique(2, 2, makeRng(1), { wrap: true }))),
    'generateUnique: 2 x 2',
  );
  assert.ok(
    Object.keys(WRAP_CANDIDATES).every(k => +k >= 3),
    'candidate counts only for n >= 3',
  );
});

// ---- the variant in the play app

const wrapGame = (n, seed) => made('wrap', n, seed);
const numbers = d => d.match(/-?\d+(\.\d+)?/g).map(Number);
const record = (p, extra = {}) =>
  makeShareRecord({
    n: p.n,
    timeS: 83.4,
    legs: [0, 2, 3],
    K: maxNumber(p),
    variant: 'wrap',
    puzzle: p,
    ...extra,
  });
// The old pointer rule, kept here as the reference for boards without margin.
const oldCellAt = (n, x, y, w, h) =>
  x < 0 || y < 0 || x >= w || y >= h ? -1 : Math.floor(y / (h / n)) * n + Math.floor(x / (w / n));

test(
  'wrap-play: cellAtPoint = old rule without margin; the margin wraps on a wrap board',
  FAST,
  () => {
    for (const n of [5, 6, 7, 9]) {
      for (const size of [300, 301, 477.5]) {
        for (let x = -3; x <= size + 3; x += 7.3) {
          for (let y = -3; y <= size + 3; y += 11.1) {
            const want = oldCellAt(n, x, y, size, size);
            assert.deepStrictEqual(cellAtPoint(n, x, y, size, size), want, `n=${n} ${x},${y}`);
          }
        }
      }
    }
    // a 5 x 5 board with a margin of WRAP_PAD cells: the box is 5.8 cells wide
    const n = 5,
      unit = 100,
      box = (n + 2 * WRAP_PAD) * unit,
      at = (cx, cy, wrap = true) =>
        cellAtPoint(n, (cx + WRAP_PAD) * unit, (cy + WRAP_PAD) * unit, box, box, WRAP_PAD, wrap);
    assert.deepStrictEqual(at(0.5, 0.5), 0, 'the top left cell');
    assert.deepStrictEqual(at(4.5, 4.5), 24, 'the bottom right cell');
    assert.deepStrictEqual(
      at(-0.2, 2.5),
      2 * n + 4,
      'the left margin is the last column of the row',
    );
    assert.deepStrictEqual(at(5.2, 2.5), 2 * n, 'the right margin is the first column of the row');
    assert.deepStrictEqual(at(1.5, -0.2), 4 * n + 1, 'the top margin is the last row');
    assert.deepStrictEqual(at(1.5, 5.2), 1, 'the bottom margin is the first row');
    assert.deepStrictEqual(at(-0.2, -0.2), 24, 'a corner of the margin');
    assert.deepStrictEqual(at(-0.2, 2.5, false), -1, 'without wrap the margin is outside');
    assert.deepStrictEqual(cellAtPoint(n, -1, 5, box, box, WRAP_PAD, true), -1, 'outside the box');
  },
);

test('wrap-play: a drag out of one side and into the other is a legal step', FAST, () => {
  const n = 5,
    p = { ...makePuzzle(n), wrap: true };
  p.cp[2 * n + 4] = 1;
  p.cp[2 * n + 1] = 2;
  const unit = 100,
    box = (n + 2 * WRAP_PAD) * unit;
  const cellAt = (cx, cy) =>
    cellAtPoint(n, (cx + WRAP_PAD) * unit, (cy + WRAP_PAD) * unit, box, box, WRAP_PAD, true);
  const path = [];
  assert.deepStrictEqual(step(p, path, cellAt(4.5, 2.5)), 'push', 'start on the last column');
  assert.deepStrictEqual(
    step(p, path, cellAt(5.2, 2.5)),
    'push',
    'the margin on the right: the first column',
  );
  assert.deepStrictEqual(path, [2 * n + 4, 2 * n], 'the head is on the first column');
  assert.deepStrictEqual(
    step(p, path, cellAt(-0.2, 2.5)),
    'pop',
    'back out of the left margin undoes the step',
  );
  setWallId(p.walls, edgeId(n, 2 * n + 4, 2 * n, true), true);
  assert.deepStrictEqual(step(p, path, cellAt(5.2, 2.5)), null, 'a wall on the seam blocks it');
});

test(
  'wrap-play: pathD: grid path unchanged; a seam step is two stubs inside the margin',
  SLOW,
  () => {
    for (const n of [4, 5]) {
      const plain = [0, 1, 2, n + 2, n + 1];
      const expect = plain
        .map(
          (i, k) => (k ? 'L' : 'M') + [((i % n) + 0.5) * 60, (((i / n) | 0) + 0.5) * 60].join(' '),
        )
        .join(' ');
      assert.deepStrictEqual(pathD(n, plain, 60), expect, `n=${n}: grid path as before`);
      assert.deepStrictEqual(
        numbers(pathD(n, plain, 60, true)),
        numbers(expect),
        `n=${n}: no seam step, same points`,
      );
    }
    const n = 5,
      s = 60;
    assert.deepStrictEqual(
      pathD(n, [4, 0], s, true),
      'M270 30L315 30M-15 30L30 30',
      'right over the seam',
    );
    assert.deepStrictEqual(
      pathD(n, [0, 4], s, true),
      'M30 30L-15 30M315 30L270 30',
      'left over the seam',
    );
    assert.deepStrictEqual(
      pathD(n, [0, 20], s, true),
      'M30 30L30 -15M30 315L30 270',
      'up over the seam',
    );
    assert.deepStrictEqual(
      pathD(n, [20, 0], s, true),
      'M30 270L30 315M30 -15L30 30',
      'down over the seam',
    );
    for (let seed = 1; seed <= 12; seed++) {
      const p = wrapGame(n, seed),
        d = pathD(n, p.path, s, true);
      const nums = numbers(d),
        jumps = (d.match(/M/g) || []).length - 1;
      assert.ok(jumps > 0, `seed ${seed}: the planted path crosses a seam`);
      assert.ok(
        nums.every(v => v >= -SEAM_STUB * s - 1e-9 && v <= (n + SEAM_STUB) * s + 1e-9),
        `seed ${seed}: everything stays inside the margin`,
      );
    }
  },
);

test('wrap-play: no drawn segment of a wrap path is longer than one cell', SLOW, () => {
  const n = 6,
    s = 60;
  for (let seed = 1; seed <= 10; seed++) {
    const p = wrapGame(n, seed),
      d = pathD(n, p.path, s, true);
    const parts = d.match(/[ML]-?[\d.]+ -?[\d.]+/g);
    let prev = null;
    for (const part of parts) {
      const [x, y] = part.slice(1).split(' ').map(Number);
      if (part[0] === 'L' && prev) {
        assert.ok(
          Math.hypot(x - prev[0], y - prev[1]) <= 1.01 * s,
          `seed ${seed}: segment ${part}`,
        );
      }
      prev = [x, y];
    }
  }
});

test('wrap-play: wallSegments: a seam wall on both borders; the grid is unchanged', FAST, () => {
  const n = 4,
    s = 10,
    p = { ...makePuzzle(n), wrap: true };
  setWallId(p.walls, edgeId(n, 1, 2, true), true); // inside
  setWallId(p.walls, edgeId(n, 7, 4, true), true); // right seam, row 1
  setWallId(p.walls, edgeId(n, 13, 1, true), true); // bottom seam, column 1
  const segs = wallSegments(p, s);
  assert.deepStrictEqual(segs.length, 5, 'one plus two plus two');
  assert.ok(
    segs.some(g => g.join() === [40, 10, 40, 20].join()),
    'right border, row 1',
  );
  assert.ok(
    segs.some(g => g.join() === [0, 10, 0, 20].join()),
    'left border, row 1',
  );
  assert.ok(
    segs.some(g => g.join() === [10, 40, 20, 40].join()),
    'bottom border, column 1',
  );
  assert.ok(
    segs.some(g => g.join() === [10, 0, 20, 0].join()),
    'top border, column 1',
  );
  const grid = makePuzzle(n);
  setWallId(grid.walls, edgeId(n, 1, 2), true);
  setWallId(grid.walls, edgeId(n, 5, 9), true);
  assert.deepStrictEqual(
    wallSegments(grid, s),
    [
      [20, 0, 20, 10],
      [10, 20, 20, 20],
    ],
    'grid walls: one segment each',
  );
});

test(
  'wrap-play: boardSvg: margin, dashed outline on a wrap board; grid board as before',
  FAST,
  () => {
    const p = wrapGame(5, 2);
    const S = { puzzle: p, path: p.path.slice(0, 8), hintCell: null, hintWrongCell: null };
    const svg = boardSvg(S);
    const m = WRAP_PAD * CELL;
    const side = 5 * CELL + 2 * m;
    assert.ok(svg.includes(`viewBox="${-m} ${-m} ${side} ${side}"`), 'padded viewBox');
    assert.ok(/class="zip-svg wrap"/.test(svg), 'the wrap class');
    assert.ok(/data-role="outline"[^>]*stroke-dasharray/.test(svg), 'dashed outline');
    assert.ok(/data-role="path" d="M/.test(svg), 'the path is drawn');
    const grid = made('std', 5, 2);
    const gridSvg = boardSvg({ puzzle: grid, path: [], hintCell: null, hintWrongCell: null });
    assert.ok(
      gridSvg.includes(`viewBox="0 0 ${5 * CELL} ${5 * CELL}"`),
      'grid: viewBox without margin',
    );
    assert.ok(
      !/wrap/.test(gridSvg) && !/dasharray/.test(gridSvg),
      'grid: nothing of the wrap board',
    );
  },
);

test('wrap-play: the walls over the seam go through the share code', SLOW, () => {
  let seamWalls = 0;
  for (const n of [5, 6]) {
    for (let seed = 1; seed <= 6; seed++) {
      const p = wrapGame(n, seed),
        back = decodeShare(encodeShare(record(p)));
      assert.deepStrictEqual(
        Array.from(back.puzzle.walls),
        Array.from(p.walls),
        `n=${n} seed ${seed}: the walls`,
      );
      const seam = e => (e & 1 ? e >> 1 >= n * (n - 1) : (e >> 1) % n === n - 1);
      seamWalls += wallIds(p).filter(seam).length;
    }
  }
  assert.ok(seamWalls > 0, `a seam wall went through the code (${seamWalls})`);
});

test('wrap-play: an unsound wrap record is not encodable', FAST, () => {
  const p = wrapGame(5, 4);
  assert.ok(encodeShare(record(p)) !== null, 'the sound one is');
  const broken = change => {
    const rec = record(p);
    change(rec);
    return encodeShare(rec) === null;
  };
  assert.ok(
    broken(rec => {
      rec.puzzle.wrap = false;
    }),
    'no wrap flag',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.holes = new Uint8Array(25);
    }),
    'holes',
  );
  assert.ok(
    broken(rec => {
      rec.puzzle.cp[rec.puzzle.cp.indexOf(2)] = 9;
    }),
    'a gap in the numbers',
  );
  assert.ok(
    broken(rec => {
      rec.grade = 2;
    }),
    'a record with a grade',
  );
  const two = { ...makePuzzle(2), wrap: true };
  two.cp[0] = 1;
  two.cp[3] = 2;
  assert.ok(encodeShare(record(two)) === null, '2 x 2');
  assert.deepStrictEqual(
    record({ ...p, holes: new Uint8Array(25) }).puzzle.holes,
    undefined,
    'holes are not copied',
  );
  assert.deepStrictEqual(
    record({ ...p, wrap: false }).puzzle.wrap,
    true,
    'the variant sets the flag',
  );
  assert.deepStrictEqual(record(p, { grade: 2 }).grade, null, 'a variant record has no grade');
});

// (that the planted path solves the puzzle is a row of variant-contract.test.js)
test('wrap-play: a whole game on a hand-made torus puzzle', FAST, () => {
  const { p, path } = torusPuzzle(5, 5, makeRng(5), 0.3),
    played = [];
  for (const cell of path) step(p, played, cell);
  assert.ok(isSolved(p, played), 'a hand-made torus puzzle');
});

test(
  'wrap-play: seamMarks: an out and an in arrowhead per seam step, in its direction',
  SLOW,
  () => {
    const n = 5,
      s = 60;
    assert.deepStrictEqual(seamMarks(n, [0, 1, 2], s), [], 'no seam step, no marks');
    const right = seamMarks(n, [4, 0], s); // right over the seam, row 0
    assert.deepStrictEqual(
      right.map(m => m.kind),
      ['out', 'in'],
      'one of each',
    );
    assert.deepStrictEqual(
      right[0],
      { kind: 'out', x: 300 + 0.17 * s, y: 30, dx: 1, dy: 0 },
      'out: right of it',
    );
    assert.deepStrictEqual(
      right[1],
      { kind: 'in', x: -0.15 * s, y: 30, dx: 1, dy: 0 },
      'in: left of the board',
    );
    const left = seamMarks(n, [0, 4], s);
    assert.deepStrictEqual(
      [left[0].x < 0, left[0].dx, left[1].x > 300, left[1].dx],
      [true, -1, true, -1],
      'left',
    );
    const upSeam = seamMarks(n, [0, 20], s);
    const [upOut, upIn] = upSeam;
    assert.deepStrictEqual(
      [upOut.y < 0, upOut.dy, upIn.y > 300, upIn.dy],
      [true, -1, true, -1],
      'up',
    );
    const downSeam = seamMarks(n, [20, 0], s);
    const [downOut, downIn] = downSeam;
    assert.deepStrictEqual(
      [downOut.y > 300, downOut.dy, downIn.y < 0, downIn.dy],
      [true, 1, true, 1],
      'down',
    );
    for (let seed = 1; seed <= 10; seed++) {
      const p = wrapGame(6, seed),
        marks = seamMarks(6, p.path, 60);
      const jumps = (pathD(6, p.path, 60, true).match(/M/g) || []).length - 1;
      assert.deepStrictEqual(marks.length, 2 * jumps, `seed ${seed}: two marks per seam step`);
      for (const m of marks) {
        const outside = m.x < 0 || m.x > 360 || m.y < 0 || m.y > 360;
        assert.ok(outside, `seed ${seed}: ${m.kind} mark in the margin`);
        const within = v => v >= -WRAP_PAD * 60 && v <= 360 + WRAP_PAD * 60;
        assert.ok(within(m.x) && within(m.y), `seed ${seed}: inside the drawn margin`);
        // out: pointing away from the board centre; in: pointing toward it
        const far = (x, y) => (x - 180) ** 2 + (y - 180) ** 2; // from the board centre
        const away = far(m.x + m.dx, m.y + m.dy) > far(m.x, m.y);
        assert.ok(m.kind === 'out' ? away : !away, `seed ${seed}: ${m.kind} direction`);
      }
    }
  },
);

test(
  'wrap-play: the board draws the marks for the path and none without a seam step',
  FAST,
  () => {
    const p = wrapGame(5, 2);
    const full = boardSvg({ puzzle: p, path: p.path, hintCell: null, hintWrongCell: null });
    const jumps = (pathD(5, p.path, CELL, true).match(/M/g) || []).length - 1;
    assert.deepStrictEqual((full.match(/data-mark="out"/g) || []).length, jumps, 'out marks');
    assert.deepStrictEqual((full.match(/data-mark="in"/g) || []).length, jumps, 'in marks');
    assert.ok(/<g data-role="seam">/.test(full), 'the group the input updates');
    assert.deepStrictEqual(seamMarksSvg(5, [0, 1, 2]), '', 'nothing without a seam step');
    const plain = made('std', 5, 2);
    const grid = boardSvg({ puzzle: plain, path: [], hintCell: null, hintWrongCell: null });
    assert.ok(
      !/data-role="seam"/.test(grid) && !/data-mark/.test(grid),
      'the grid board has none',
    );
  },
);

test(
  'wrap-play: a shared wrap game of size 4 is playable though the app has no size 4',
  FAST,
  () => {
    const p = wrapGame(4, 3),
      rec = record(p);
    const ctx = { sizes: PLAY_SIZES, algo: 0, sizesOf: id => sizesFor(id, PLAY_SIZES) };
    assert.deepStrictEqual(shareStatus(rec, ctx).status, 'ok', 'size 4 with the variant sizes');
    const without = shareStatus(rec, { sizes: PLAY_SIZES, algo: 0 });
    assert.deepStrictEqual(without.status, 'invalid', 'without them it is not');
    const back = decodeShare(encodeShare(rec));
    assert.ok(back && back.n === 4 && back.puzzle.wrap === true, 'the size 4 code round-trips');
    const three = { ...rec, n: 3, puzzle: { ...rec.puzzle, n: 3 } };
    assert.deepStrictEqual(
      shareStatus(three, ctx).status,
      'invalid',
      'size 3 is offered by nobody',
    );
    const standard = shareStatus({ ...rec, variant: undefined, algo: 0, n: 4 }, ctx);
    assert.deepStrictEqual(
      standard.status,
      'invalid',
      'a standard record of size 4 stays invalid',
    );
  },
);

test(
  'wrap-play: lucky game: 4 to 6 while wrap is locked, 4 to 8 once it is unlocked',
  FAST,
  async () => {
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
    const defs = luckyDefs(PLAY_SIZES),
      index = defs.findIndex(d => d.id === 'wrap');
    const MON = 20731,
      at = day => () => new Date(day * 86400000);
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
      await u.refund(); // the chance and the offer come back
    }
    assert.deepStrictEqual(seen, [4, 5, 6], 'locked: only 4 to 6');
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
    assert.deepStrictEqual(sizes, [4, 5, 6, 7, 8], 'unlocked: the sizes of free play');
  },
);
