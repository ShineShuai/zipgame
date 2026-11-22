// Tests of the closed-surface and ball boards: the tetrahedron and cube graph
// (core/surface/topology.js), the puzzle model, rules and text format (puzzle.js), the solver
// (solve.js, checked against a plain brute-force search and against path counts computed with an
// independent C++ program) and the generator (gen.js); the generated ball catalog
// (core/solid/ball-catalog.js, regenerate and check it with node tools/ball-catalog.mjs --check),
// the graph built from it and which boards can be played; the ball view (view/ball.js) and its
// drawing (apps/design/surface-board.js); the 3D puzzles of the play app and what the design app
// shares with them (view/solid-nav.js, the palettes, icons, texts, the menu card in
// apps/play/solid.js); and the fast solver and path search against the plain versions of v0.14.0,
// which are kept here as the oracle. Set SURFACE_SLOW=1 for the oracle counts that take several
// seconds.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST, SLOW } from '../harness.js';
import {
  surfaceTopology,
  edgeBetween,
  cellCentroid,
  SURFACE_SIZES,
  SLOTS,
  BALL_KIND,
  ballEntry,
  surfaceCellCount,
} from '../../src/core/surface/topology.js';
import { SIZED_SOLIDS, SOLID_KINDS as CORE_SOLID_KINDS } from '../../src/core/solid/kinds.js';
import {
  makeSurfacePuzzle,
  cloneSurfacePuzzle,
  validateSurface,
  isSolved,
  canStep,
  serializeSurface,
  parseSurface,
  maxNumber,
  wallEdges,
  step,
  nextNumber,
  looksLikeSurface,
  canPush,
  topologyOf,
} from '../../src/core/surface/puzzle.js';
import {
  solveSurface,
  countHamiltonianPaths,
  makePrunes,
  openSlots,
  narrowOpen,
} from '../../src/core/surface/solve.js';
import {
  generateSurface,
  generateSurfaceSteps,
  generateSurfaceWithin,
  minimizeSurfaceWalls,
  randomHamiltonianPath,
  numberAlongPath,
  defaultK,
  pickSurfaceK,
  GEN_CFG,
} from '../../src/core/surface/gen.js';
import { makeRng, shuffle } from '../../src/core/rng.js';
import { oracle, topologyMoves } from '../oracle.js';
import { runSync } from '../../src/core/run.js';
import { commentTimes } from '../../src/core/format.js';
import {
  buildNet,
  cellAt,
  pickSide,
  routePieces,
  routeCrossings,
  slotBetween,
} from '../../src/view/surface-net.js';
import {
  IDENTITY,
  buildView,
  cellDirection,
  cellNormal,
  faceFrame,
  facing,
  orbit,
  overview,
  turn,
  turnToward,
} from '../../src/view/proj.js';
import * as designBoard from '../../src/apps/design/surface-board.js';
import { surfaceSvg, netFrame } from '../../src/apps/design/surface-board.js';
import { BALL_CATALOG } from '../../src/core/solid/ball-catalog.js';
import { registerBalls } from '../../src/core/solid/ball-registry.js';
import {
  ballsByComposition,
  compositionLabel,
  pickBall,
  playableBalls,
  PLAY_MAX_CELLS,
  PLAY_MIN_CELLS,
  loadBalls,
} from '../../src/core/solid/balls.js';
import { kRange } from '../../src/core/gen/pick-k.js';
import { congruentByType, kis, meshOf, seeds } from '../../tools/polyhedra.mjs';
import { behind, buildBallView, directionCell, frontOf } from '../../src/view/ball.js';
import { PENTAGON_KIND } from '../../src/core/pentagon.js';
import { computeHint } from '../../src/features/hints.js';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  surfaceSvg as viewSurfaceSvg,
} from '../../src/view/surface-board.js';
import {
  ARROW_TURN,
  FOLLOW_DONE,
  FOLLOW_EDGE,
  createTurner,
  crossedCut,
  headTurnedAway,
} from '../../src/view/solid-nav.js';
import { SOLID_KINDS, createSolidPlay, isSolidKind } from '../../src/apps/play/solid.js';
import { variantIcon, cardIcon } from '../../src/apps/play/icons.js';
import { releaseDays } from '../../src/features/solid-release.js';
import { EN, ZH, t as translate } from '../../src/ui/i18n.js';

// ---- the closed surfaces: graph, model, solver, generator

const slow = typeof process !== 'undefined' && Boolean(process.env.SURFACE_SLOW);

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// Every Hamiltonian path that obeys the rules, by plain search with no pruning at all
// (test/oracle.js).
function brute(p) {
  const top = surfaceTopology(p.kind, p.n);
  return oracle(p, {
    moves: topologyMoves(p, top, SLOTS),
    total: top.T,
    keep: false,
  }).count;
}

// A random puzzle: numbers on random cells, walls on a share of the sides.
function randomPuzzle(kind, n, seed, wallShare) {
  const rnd = makeRng(seed);
  const p = makeSurfacePuzzle(kind, n);
  const top = surfaceTopology(kind, n);
  const K = 2 + Math.floor(rnd() * 4);
  const cells = shuffle([...Array(top.T).keys()], rnd).slice(0, K);
  cells.forEach((cell, i) => {
    p.cp[cell] = i + 1;
  });
  for (let edge = 0; edge < top.E; edge++) {
    p.walls[edge] = rnd() < wallShare ? 1 : 0;
  }
  return p;
}

// A puzzle that has a solution: numbers laid along a random Hamiltonian path, walls only on the
// sides the path does not use.
function solvablePuzzle(kind, n, seed, wallShare) {
  const rnd = makeRng(seed);
  const top = surfaceTopology(kind, n);
  const path = randomHamiltonianPath(top, rnd);
  const p = makeSurfacePuzzle(kind, n);
  numberAlongPath(p, path, 2 + Math.floor(rnd() * 4), rnd);
  const used = new Set();
  for (let i = 0; i + 1 < path.length; i++) {
    used.add(edgeBetween(top, path[i], path[i + 1]));
  }
  for (let edge = 0; edge < top.E; edge++) {
    p.walls[edge] = !used.has(edge) && rnd() < wallShare ? 1 : 0;
  }
  return { p, path };
}

test(
  'surface topology: counts, closed surface, Euler characteristic, sizes on offer',
  FAST,
  () => {
    for (const kind of SIZED_SOLIDS) {
      const degree = kind === 'tetra' ? 3 : 4;
      for (let n = 1; n <= 5; n++) {
        const top = surfaceTopology(kind, n);
        const T = (kind === 'tetra' ? 4 : 6) * n * n;
        assert.deepStrictEqual(top.T, T, `${kind} ${n} cells`);
        assert.deepStrictEqual(top.E, (T * degree) / 2, `${kind} ${n} edges`);
        assert.deepStrictEqual(
          top.V,
          top.E - top.T + 2,
          `${kind} ${n} corners (Euler: V - E + F = 2)`,
        );
        assert.deepStrictEqual(top.V - top.E + top.T, 2);
        for (let cell = 0; cell < T; cell++) {
          assert.deepStrictEqual(top.deg[cell], degree);
        }
        assert.deepStrictEqual(
          top.bipartite,
          false,
          'three cells meet at every corner and all touch',
        );
        assert.ok(surfaceTopology(kind, n) === top, 'built once');
      }
      for (const n of SURFACE_SIZES[kind]) {
        assert.ok(surfaceTopology(kind, n).T <= 110, `${kind} ${n} stays small enough`);
      }
    }
    assert.ok(threw(() => surfaceTopology('sphere', 3)));
    assert.ok(threw(() => surfaceTopology('cube', 0)));
    assert.ok(threw(() => surfaceTopology('cube', 13)));
    assert.ok(threw(() => surfaceTopology('cube', 2.5)));
  },
);

test('surface topology: neighbours, sides and edges agree with each other', FAST, () => {
  for (const kind of SIZED_SOLIDS) {
    for (const n of [1, 2, 3, 4]) {
      const top = surfaceTopology(kind, n);
      const timesSeen = new Int32Array(top.E);
      for (let cell = 0; cell < top.T; cell++) {
        for (let k = 0; k < top.deg[cell]; k++) {
          const other = top.nb[cell * SLOTS + k];
          const back = top.rev[cell * SLOTS + k];
          assert.ok(other >= 0 && other !== cell);
          assert.deepStrictEqual(top.nb[other * SLOTS + back], cell, 'the neighbour points back');
          assert.deepStrictEqual(top.rev[other * SLOTS + back], k);
          const edge = top.edgeAt[cell * SLOTS + k];
          assert.deepStrictEqual(
            top.edgeAt[other * SLOTS + back],
            edge,
            'both sides name the same edge',
          );
          const ends = [top.ends[edge * 2], top.ends[edge * 2 + 1]];
          assert.deepStrictEqual(ends, [Math.min(cell, other), Math.max(cell, other)]);
          assert.deepStrictEqual(edgeBetween(top, cell, other), edge);
          timesSeen[edge]++;
        }
        for (let k = top.deg[cell]; k < SLOTS; k++) {
          assert.deepStrictEqual(top.nb[cell * SLOTS + k], -1, 'unused slot');
        }
      }
      assert.ok(
        timesSeen.every(count => count === 2),
        'every edge belongs to exactly two cells',
      );
      assert.deepStrictEqual(edgeBetween(top, 0, 0), -1);
    }
  }
});

test('surface topology: distances, face numbering, and cells face outwards', FAST, () => {
  for (const kind of SIZED_SOLIDS) {
    const top = surfaceTopology(kind, 3);
    const n2 = 9;
    for (let a = 0; a < top.T; a++) {
      assert.deepStrictEqual(top.dist[a * top.T + a], 0);
      for (let b = 0; b < top.T; b++) {
        assert.deepStrictEqual(top.dist[a * top.T + b], top.dist[b * top.T + a]);
        assert.deepStrictEqual(top.dist[a * top.T + b] === 1, edgeBetween(top, a, b) >= 0);
      }
      assert.deepStrictEqual(top.faceOf[a], Math.floor(a / n2), 'face * n^2 + k');
      // The ring is counter-clockwise seen from outside: its normal points away from the middle.
      const c = cellCentroid(top, a);
      const [p0, p1, p2] = [0, 1, 2].map(k => {
        const corner = top.ring[a * SLOTS + k];
        return [0, 1, 2].map(axis => top.verts[corner * 3 + axis]);
      });
      const u = [0, 1, 2].map(axis => p1[axis] - p0[axis]);
      const v = [0, 1, 2].map(axis => p2[axis] - p0[axis]);
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const outward = normal[0] * c[0] + normal[1] * c[1] + normal[2] * c[2];
      assert.ok(outward > 1e-9, `${kind} cell ${a} faces outwards`);
      const face = top.faceOf[a];
      if (kind === 'cube') {
        assert.deepStrictEqual(
          c[face >> 1] * (face & 1 ? -1 : 1) > 0.999,
          true,
          'cube face f is +x -x +y -y +z -z',
        );
      } else {
        const corner = [
          [1, 1, 1],
          [1, -1, -1],
          [-1, 1, -1],
          [-1, -1, 1],
        ][face];
        const dot = corner[0] * c[0] + corner[1] * c[1] + corner[2] * c[2];
        assert.ok(Math.abs(dot + 1) < 1e-9, 'tetra face f is the one opposite corner f');
      }
    }
  }
  assert.deepStrictEqual(surfaceTopology('cube', 3).dist[0 * 54 + 53] > 0, true);
  const diameters = { tetra: [1, 4, 7], cube: [2, 5, 8] };
  for (const kind of SIZED_SOLIDS) {
    [1, 2, 3].forEach((n, i) => {
      assert.deepStrictEqual(Math.max(...surfaceTopology(kind, n).dist), diameters[kind][i]);
    });
  }
});

test('surface solver: Hamiltonian path counts match an independent program (C++)', SLOW, () => {
  const counts = [
    ['tetra', 1, 24],
    ['tetra', 2, 768],
    ['tetra', 3, 27552],
    ['cube', 1, 240],
  ];
  if (slow) {
    counts.push(['cube', 2, 1967808]);
  }
  for (const [kind, n, expected] of counts) {
    const result = countHamiltonianPaths(surfaceTopology(kind, n));
    assert.deepStrictEqual(result.count, expected, `${kind} ${n}`);
    assert.ok(!result.capped);
  }
  assert.ok(countHamiltonianPaths(surfaceTopology('tetra', 3), { nodeCap: 1000 }).capped);
});

test('surface solver: same number of solutions as brute force on random puzzles', FAST, () => {
  const boards = [
    ['tetra', 2, 0.15],
    ['cube', 1, 0.1],
    ['cube', 2, 0.5],
  ];
  for (const [kind, n, share] of boards) {
    for (let seed = 1; seed <= 40; seed++) {
      const p = randomPuzzle(kind, n, seed, share);
      const solved = solveSurface(p, { limit: 1e9 });
      assert.deepStrictEqual(solved.count, brute(p), `${kind} ${n} random seed ${seed}`);
      const made = solvablePuzzle(kind, n, seed, share).p;
      const again = solveSurface(made, { limit: 1e9 });
      assert.deepStrictEqual(again.count, brute(made), `${kind} ${n} solvable seed ${seed}`);
      assert.ok(again.count >= 1, 'the intended path is among the solutions');
      assert.ok(isSolved(made, again.path));
    }
  }
});

test('surface solver: the dead-end and connectivity prunes see a cut-off cell', FAST, () => {
  const top = surfaceTopology('tetra', 2);
  const prunes = makePrunes(top, openSlots(top, null));
  const x = 0;
  const around = [0, 1, 2].map(k => top.nb[x * SLOTS + k]);
  const far = [...Array(top.T).keys()].find(
    c => c !== x && !around.includes(c) && edgeBetween(top, x, c) < 0,
  );
  const vis = new Uint8Array(top.T);
  around.forEach(c => {
    vis[c] = 1;
  });
  // Head on one neighbour of x: x still has a way in (from the head), the rest is reachable.
  assert.deepStrictEqual(prunes.connected(vis, around[0], top.T - 3), true);
  assert.deepStrictEqual(
    prunes.deadEnds(vis, around[0], x),
    true,
    'x may be the last cell of the path',
  );
  assert.deepStrictEqual(
    prunes.deadEnds(vis, around[0], far),
    false,
    'x would be a dead end in the middle',
  );
  assert.deepStrictEqual(
    prunes.deadEnds(vis, around[0], -1),
    true,
    'one dead end is allowed when the end is free',
  );
  // Head elsewhere: all three neighbours of x are used up, so x is cut off.
  vis[far] = 1;
  assert.deepStrictEqual(prunes.connected(vis, far, top.T - 4), false);
  assert.deepStrictEqual(prunes.deadEnds(vis, far, x), false);
  assert.deepStrictEqual(prunes.deadEnds(vis, far, -1), false);
  // Two cells that can only end the path: allowed with a fixed end only for that end.
  const walls = new Uint8Array(top.E);
  for (let k = 0; k < 2; k++) {
    walls[top.edgeAt[x * SLOTS + k]] = 1;
  }
  const walled = makePrunes(top, openSlots(top, walls));
  const none = new Uint8Array(top.T);
  none[far] = 1;
  assert.deepStrictEqual(
    walled.deadEnds(none, far, x),
    true,
    'x has one open side: only the end may',
  );
  assert.deepStrictEqual(walled.deadEnds(none, far, far), false);
});

test('surface solver: limit, second solution, node cap', FAST, () => {
  const { p } = solvablePuzzle('tetra', 3, 5, 0);
  const two = solveSurface(p);
  assert.deepStrictEqual(two.count, 2, 'stops at the limit');
  assert.ok(isSolved(p, two.path) && isSolved(p, two.second));
  assert.ok(two.path.join() !== two.second.join());
  assert.deepStrictEqual(solveSurface(p, { limit: 1 }).count, 1);
  const capped = solveSurface(p, { nodeCap: 3 });
  assert.deepStrictEqual(capped.capped, true);
  assert.ok(capped.nodes <= 4);
  const bad = makeSurfacePuzzle('cube', 2);
  assert.ok(
    threw(() => solveSurface(bad)),
    'no numbers: invalid',
  );
});

test('surface puzzle: validate, canStep and isSolved', FAST, () => {
  const p = makeSurfacePuzzle('cube', 2);
  assert.deepStrictEqual(validateSurface(p).ok, false);
  p.cp[0] = 1;
  assert.ok(validateSurface(p).msg.includes('at least 2'), 'a single number is not enough');
  p.cp[5] = 3;
  assert.ok(validateSurface(p).msg.includes('number 2 is missing'));
  p.cp[5] = 2;
  assert.deepStrictEqual(validateSurface(p), { ok: true, max: 2 });
  p.cp[7] = 2;
  assert.ok(validateSurface(p).msg.includes('duplicate'));
  const q = makeSurfacePuzzle('cube', 2);
  q.cp[0] = 2;
  q.cp[1] = 3;
  assert.ok(validateSurface(q).msg.includes('missing checkpoint 1'));
  const short = makeSurfacePuzzle('cube', 2);
  short.walls = new Uint8Array(3);
  assert.ok(validateSurface(short).msg.includes('do not match'));

  const { p: puzzle, path } = solvablePuzzle('cube', 2, 3, 0.5);
  assert.ok(isSolved(puzzle, path));
  assert.ok(!isSolved(puzzle, path.slice(0, -1)), 'too short');
  assert.ok(!isSolved(puzzle, path.slice().reverse()), 'starts on the wrong cell');
  const swapped = path.slice();
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  assert.ok(!isSolved(puzzle, swapped), 'not a path any more');
  const repeated = path.slice();
  repeated[5] = repeated[4];
  assert.ok(!isSolved(puzzle, repeated));
  const top = surfaceTopology('cube', 2);
  const edge = edgeBetween(top, path[1], path[2]);
  const walled = cloneSurfacePuzzle(puzzle);
  walled.walls[edge] = 1;
  assert.ok(!canStep(walled, path[1], path[2]) && canStep(puzzle, path[1], path[2]));
  assert.ok(!isSolved(walled, path), 'crosses a wall');
  assert.ok(!canStep(puzzle, path[0], path[0]), 'a cell does not touch itself');
});

test('surface puzzle: plain text round trip and errors', FAST, () => {
  const { p, path } = solvablePuzzle('tetra', 3, 2, 0.5);
  const text = serializeSurface(p, { path });
  const back = parseSurface(text);
  assert.deepStrictEqual(back.kind, 'tetra');
  assert.deepStrictEqual(back.n, 3);
  assert.deepStrictEqual(Array.from(back.cp), Array.from(p.cp));
  assert.deepStrictEqual(Array.from(back.walls), Array.from(p.walls));
  assert.deepStrictEqual(back.path, path);
  assert.deepStrictEqual(serializeSurface(back, { path: back.path }), text);
  assert.deepStrictEqual(parseSurface('# note\n\nsurface cube 2\ncheckpoints 0=1 5=2\n').cp[5], 2);
  assert.deepStrictEqual(serializeSurface(makeSurfacePuzzle('cube', 2)), 'surface cube 2\n');
  const bad = [
    '',
    'size 3',
    'surface cube',
    'surface sphere 3',
    'surface cube x',
    'surface cube 2\ncheckpoints 99=1',
    'surface cube 2\ncheckpoints 1=1 1=2',
    'surface cube 2\ncheckpoints 1',
    'surface cube 2\nwalls 99',
    'surface cube 2\nwalls a',
    'surface cube 2\npath 0 0',
    'surface cube 2\npath 0 23',
    'surface cube 2\nfoo',
  ];
  for (const text of bad) {
    assert.ok(
      threw(() => parseSurface(text)),
      `should reject: ${JSON.stringify(text)}`,
    );
  }
  const top = surfaceTopology('cube', 2);
  const wall = edgeBetween(top, 0, top.nb[0]);
  const throughWall = `surface cube 2\nwalls ${wall}\npath 0 ${top.nb[0]}`;
  assert.ok(
    threw(() => parseSurface(throughWall)),
    'path through a wall',
  );
});

test('surface generator: random Hamiltonian path on every board size', FAST, () => {
  for (const kind of SIZED_SOLIDS) {
    for (const n of [1, 2, 3, ...SURFACE_SIZES[kind]]) {
      const top = surfaceTopology(kind, n);
      const path = randomHamiltonianPath(top, makeRng(n + 10));
      assert.ok(path !== null, `${kind} ${n}: a path was found`);
      assert.deepStrictEqual(new Set(path).size, top.T);
      for (let i = 1; i < path.length; i++) {
        assert.ok(edgeBetween(top, path[i - 1], path[i]) >= 0, 'consecutive cells touch');
      }
    }
  }
  const starved = { pathNodeCap: 1, pathTries: 2 };
  assert.ok(randomHamiltonianPath(surfaceTopology('cube', 4), makeRng(1), starved) === null);
  assert.deepStrictEqual(defaultK('tetra', 3), 7);
  assert.deepStrictEqual(defaultK('cube', 3), 8);
});

test('surface generator: unique, solved by its path, minimal walls, repeatable', FAST, () => {
  const cases = [
    ['tetra', 3, 1],
    ['tetra', 3, 2],
    ['tetra', 4, 1],
    ['cube', 2, 1],
    ['cube', 2, 2],
    ['cube', 3, 1],
  ];
  for (const [kind, n, seed] of cases) {
    const label = `${kind} ${n} seed ${seed}`;
    const g = generateSurface(kind, n, seed);
    assert.deepStrictEqual(validateSurface(g.puzzle).ok, true, label);
    assert.deepStrictEqual(maxNumber(g.puzzle), g.K, label);
    assert.ok(isSolved(g.puzzle, g.path), `${label}: its own path solves it`);
    const solved = solveSurface(g.puzzle);
    assert.deepStrictEqual(solved.count, 1, label);
    assert.deepStrictEqual(solved.path, g.path, label);
    assert.deepStrictEqual(solved.nodes, g.nodes, label);
    const top = surfaceTopology(kind, n);
    for (let i = 0; i + 1 < g.path.length; i++) {
      const onPath = edgeBetween(top, g.path[i], g.path[i + 1]);
      assert.deepStrictEqual(g.puzzle.walls[onPath], 0, `${label}: no wall on the path`);
    }
    assert.deepStrictEqual(g.walls, wallEdges(g.puzzle).length, label);
    for (const edge of wallEdges(g.puzzle)) {
      const without = cloneSurfacePuzzle(g.puzzle);
      without.walls[edge] = 0;
      const result = solveSurface(without, { limit: 2, nodeCap: GEN_CFG.checkNodeCap });
      assert.ok(result.capped || result.count === 2, `${label}: wall ${edge} is needed`);
    }
    const again = generateSurface(kind, n, seed);
    assert.deepStrictEqual(
      serializeSurface(again.puzzle),
      serializeSurface(g.puzzle),
      `${label}: repeatable`,
    );
  }
  assert.deepStrictEqual(generateSurface('tetra', 3, 1, { K: 5 }).K, 5);
  assert.deepStrictEqual(maxNumber(generateSurface('tetra', 3, 1, { K: 36 }).puzzle), 36);
});

test(
  'surface generator: the play app draws K like the square boards (pickK), after the path',
  SLOW,
  () => {
    // the range: from the square root of the cells to a quarter of them, mean at 30% of the way
    const cases = [
      ['tetra', 3, 36],
      ['tetra', 5, 100],
      ['cube', 2, 24],
      ['cube', 4, 96],
    ];
    for (const [kind, n, cells] of cases) {
      const min = Math.max(4, Math.round(Math.sqrt(cells)));
      const max = Math.max(min + 1, Math.round(cells / 4));
      const rnd = makeRng(5);
      const draws = Array.from({ length: 4000 }, () => pickSurfaceK(kind, n, rnd));
      assert.ok(
        draws.every(K => K >= min && K <= max),
        `${kind} ${n}: within [${min}, ${max}]`,
      );
      const mean = draws.reduce((sum, K) => sum + K, 0) / draws.length;
      assert.ok(Math.abs(mean - (min + 0.3 * (max - min))) < 0.4, `${kind} ${n}: mean ${mean}`);
      assert.ok(new Set(draws).size > 1, `${kind} ${n}: K varies`);
    }
    // without opts.K the generator draws it; with it the stream (and so the numbers) is as before
    const drawn = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      drawn.add(generateSurface('cube', 3, seed).K);
    }
    assert.ok(drawn.size > 1, 'K differs between seeds');
    const [a, b] = [generateSurface('tetra', 3, 1), generateSurface('tetra', 3, 1, { K: 9 })];
    assert.deepStrictEqual(a.path, b.path, 'the path of a seed does not depend on K');
    assert.deepStrictEqual(b.K, 9);
  },
);

test(
  'surface generator: pinned puzzles (change only with a deliberate generator change)',
  FAST,
  () => {
    const tetra = generateSurface('tetra', 3, 1);
    assert.deepStrictEqual(
      serializeSurface(tetra.puzzle, { path: tetra.path }),
      'surface tetra 3\ncheckpoints 8=1 14=2 20=3 2=4 22=5 15=6\n' +
        'path 8 17 31 30 29 14 10 11 20 21 25 2 1 0 35 26 24 23 19 18 9 27 28 32 33 34 5 6 7 3 ' +
        '4 22 13 12 16 15\n',
    );
    assert.deepStrictEqual(tetra.nodes, 400);
    const cube = generateSurface('cube', 2, 1);
    assert.deepStrictEqual(
      serializeSurface(cube.puzzle, { path: cube.path }),
      'surface cube 2\ncheckpoints 5=1 21=2 20=3 11=4 4=5\nwalls 4,8,17,18,20,38\n' +
        'path 5 16 17 7 6 21 20 22 13 0 2 23 9 8 10 11 3 19 18 1 15 14 12 4\n',
    );
    assert.deepStrictEqual(cube.nodes, 382);
  },
);

test('surface step: push, pop, truncate, order of the numbers, walls', FAST, () => {
  const p = makeSurfacePuzzle('tetra', 1); // 4 cells, every two touch
  p.cp[0] = 1;
  p.cp[1] = 2;
  p.cp[3] = 3;
  const path = [];
  assert.deepStrictEqual(step(p, path, 1), null, 'the path starts on 1');
  assert.deepStrictEqual(step(p, path, 0), 'push');
  assert.deepStrictEqual(step(p, path, 1), 'push');
  assert.deepStrictEqual(step(p, path, 0), 'pop', 'the cell before the head: one step back');
  assert.deepStrictEqual(path, [0]);
  assert.deepStrictEqual(step(p, path, 3, { strictOrder: true }), null, '3 before 2 is refused');
  assert.deepStrictEqual(step(p, path, 3), 'push', 'but allowed when the order is not enforced');
  assert.deepStrictEqual(step(p, path, 2), 'push');
  assert.deepStrictEqual(step(p, path, 0), null, 'a visited cell is not entered again');
  assert.deepStrictEqual(step(p, path, 0, { truncate: true }), 'trunc');
  assert.deepStrictEqual(path, [0]);
  assert.deepStrictEqual(step(p, path, 1, { strictOrder: true }), 'push');
  assert.deepStrictEqual(step(p, path, 3, { strictOrder: true }), 'push');
  assert.deepStrictEqual(
    step(p, path, 2, { strictOrder: true }),
    null,
    'nothing follows the highest number',
  );
  assert.deepStrictEqual(step(p, path, 2), 'push');
  assert.deepStrictEqual(nextNumber(p, [0]), 2);
  assert.deepStrictEqual(nextNumber(p, [0, 1]), 3);
  assert.deepStrictEqual(nextNumber(p, [0, 1, 3]), 0, 'no number is left');
  const top = surfaceTopology('tetra', 1);
  const walled = makeSurfacePuzzle('tetra', 1);
  walled.cp[0] = 1;
  walled.cp[3] = 2;
  const side = top.nb[0];
  walled.walls[top.edgeAt[0]] = 1;
  assert.deepStrictEqual(step(walled, [0], side), null, 'a wall stops the step');
  walled.walls[top.edgeAt[0]] = 0;
  assert.deepStrictEqual(step(walled, [0], side), 'push');
});

test(
  'surface step: walking a generated solution is accepted all the way and solves it',
  FAST,
  () => {
    for (const [kind, n, seed] of [
      ['tetra', 3, 1],
      ['tetra', 4, 2],
      ['cube', 2, 1],
    ]) {
      const g = generateSurface(kind, n, seed);
      const path = [];
      for (const cell of g.path) {
        assert.ok(
          step(g.puzzle, path, cell, { strictOrder: true }) === 'push',
          `${kind} ${n}: ${cell}`,
        );
      }
      assert.ok(isSolved(g.puzzle, path), `${kind} ${n}: solved`);
    }
  },
);

test('surface text: looksLikeSurface, times as comments, empty path left out', FAST, () => {
  assert.ok(looksLikeSurface('surface tetra 3\n'));
  assert.ok(looksLikeSurface('# tetra 3 seed 1\n\n  surface cube 2\ncheckpoints 0=1 5=2\n'));
  assert.ok(!looksLikeSurface('size 5\ncheckpoints 0,0=1\n'));
  assert.ok(!looksLikeSurface('# surface\nsize 5\n'));
  const g = generateSurface('tetra', 3, 1);
  const text = serializeSurface(g.puzzle, {
    path: g.path,
    times: { generateMs: 12.34, solveMs: 0.5, playS: 7 },
  });
  assert.deepStrictEqual(commentTimes(text), { generateMs: 12.3, solveMs: 0.5, playS: 7 });
  assert.deepStrictEqual(
    serializeSurface(parseSurface(text)),
    serializeSurface(g.puzzle),
    'comments are skipped',
  );
  assert.deepStrictEqual(parseSurface(text).path, g.path);
  assert.ok(!/^path/m.test(serializeSurface(g.puzzle, { path: [] })), 'an empty path is no line');
  assert.deepStrictEqual(serializeSurface(g.puzzle, { times: {} }), serializeSurface(g.puzzle));
});

test('surface generator: the generator yields progress and gives the same puzzles', FAST, () => {
  const events = [];
  const made = runSync(generateSurfaceSteps('tetra', 3, 1), e => events.push(e));
  assert.deepStrictEqual(events[0].phase, 'path');
  const checks = events.filter(e => e.phase === 'walls');
  assert.ok(checks.length > 0, 'a check for every wall of the start');
  assert.deepStrictEqual(
    checks.map(e => e.done),
    checks.map((_, i) => i + 1),
  );
  assert.deepStrictEqual(checks[0].total, checks.length);
  assert.deepStrictEqual(made.walls, 0);
  const cube = [];
  const second = runSync(generateSurfaceSteps('cube', 2, 1), e => cube.push(e));
  assert.ok(cube.some(e => e.phase === 'walls'));
  assert.deepStrictEqual(
    serializeSurface(made.puzzle),
    serializeSurface(generateSurface('tetra', 3, 1).puzzle),
  );
  assert.deepStrictEqual(
    serializeSurface(second.puzzle),
    serializeSurface(generateSurface('cube', 2, 1).puzzle),
  );
  assert.deepStrictEqual(second.undecided, 0);
});

test(
  'surface generator: generateSurfaceWithin stops at the first puzzle within the limit',
  FAST,
  () => {
    const plain = generateSurface('cube', 2, 1);
    const same = runSync(generateSurfaceWithin('cube', 2, 1, { maxWalls: 99, tries: 5 }));
    assert.deepStrictEqual(serializeSurface(same.puzzle), serializeSurface(plain.puzzle));
    assert.deepStrictEqual([same.attempts, same.hit], [1, true]);
    const none = runSync(generateSurfaceWithin('cube', 2, 1, { maxWalls: 0, tries: 3, K: 4 }));
    assert.deepStrictEqual([none.attempts, none.hit], [3, false]);
    const walls = [0, 1, 2].map(i => generateSurface('cube', 2, 1 + i, { K: 4 }).walls);
    assert.deepStrictEqual(none.walls, Math.min(...walls), 'the one with the fewest walls');
    const flat = { maxWalls: 0, tries: 20, K: 5 };
    const reached = runSync(generateSurfaceWithin('tetra', 3, 3, flat));
    assert.deepStrictEqual([reached.hit, reached.walls], [true, 0]);
    assert.deepStrictEqual(
      runSync(generateSurfaceWithin('tetra', 3, 1)).attempts,
      1,
      'one try by default',
    );
  },
);

test('surface minimize: takes unneeded walls away, stays unique, every wall needed', FAST, () => {
  const g = generateSurface('tetra', 3, 1);
  const top = surfaceTopology('tetra', 3);
  const loaded = cloneSurfacePuzzle(g.puzzle);
  const onPath = new Set();
  for (let i = 0; i + 1 < g.path.length; i++) {
    onPath.add(edgeBetween(top, g.path[i], g.path[i + 1]));
  }
  for (let edge = 0; edge < top.E; edge++) {
    loaded.walls[edge] = onPath.has(edge) ? 0 : 1;
  }
  assert.deepStrictEqual(solveSurface(loaded).count, 1);
  const events = [];
  const done = runSync(minimizeSurfaceWalls(loaded, makeRng(5), 50000), e => events.push(e));
  assert.deepStrictEqual(done.removed + done.kept, top.E - g.path.length + 1);
  assert.deepStrictEqual(events.length, done.removed + done.kept);
  assert.deepStrictEqual(solveSurface(loaded).count, 1, 'still unique');
  assert.deepStrictEqual(wallEdges(loaded).length, done.kept);
  for (const edge of wallEdges(loaded)) {
    const without = cloneSurfacePuzzle(loaded);
    without.walls[edge] = 0;
    assert.deepStrictEqual(solveSurface(without).count, 2, `wall ${edge} is needed`);
  }
  const capped = cloneSurfacePuzzle(g.puzzle);
  const tight = runSync(minimizeSurfaceWalls(loaded, makeRng(5), 1));
  assert.deepStrictEqual(tight.removed, 0, 'a check that hits the cap keeps the wall');
  assert.deepStrictEqual(tight.undecided, tight.kept);
  assert.deepStrictEqual(capped.walls.length, g.puzzle.walls.length);
});

test('surface net: every cell has its sides of one length, no two cells overlap', FAST, () => {
  for (const [kind, sizes] of [
    ['tetra', [1, 2, 3, 4, 5]],
    ['cube', [1, 2, 3, 4]],
  ]) {
    for (const n of sizes) {
      const top = surfaceTopology(kind, n);
      const net = buildNet(top);
      assert.deepStrictEqual(buildNet(top), net, 'cached');
      for (let cell = 0; cell < top.T; cell++) {
        const poly = net.polys[cell];
        assert.deepStrictEqual(poly.length, top.deg[cell]);
        for (let k = 0; k < poly.length; k++) {
          const [a, b] = [poly[k], poly[(k + 1) % poly.length]];
          const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
          assert.ok(Math.abs(length - net.side) < 1e-9, `${kind} ${n} side`);
        }
        assert.deepStrictEqual(
          cellAt(net, ...net.centers[cell]),
          cell,
          `${kind} ${n}: centre of ${cell}`,
        );
      }
    }
  }
});

test(
  'surface net: the cuts, their letters, and sides glued the same from both cells',
  FAST,
  () => {
    const cases = [
      ['tetra', 3, 3],
      ['tetra', 5, 3],
      ['cube', 2, 7],
      ['cube', 4, 7],
    ];
    for (const [kind, n, cuts] of cases) {
      const top = surfaceTopology(kind, n);
      const net = buildNet(top);
      assert.deepStrictEqual(net.cuts.length, cuts, `${kind} ${n} cuts`);
      assert.deepStrictEqual(
        net.cuts.map(c => c.letter),
        [...'ABCDEFG'].slice(0, cuts),
      );
      for (const cut of net.cuts) {
        assert.deepStrictEqual(cut.copies.size, 2, 'two copies of a cut');
        for (const sides of cut.copies.values()) {
          assert.deepStrictEqual(sides.length, n, `${kind} ${n} ${cut.letter}: n sides per copy`);
        }
      }
      assert.deepStrictEqual(net.tags.length, 2 * cuts);
      let unglued = 0;
      for (let cell = 0; cell < top.T; cell++) {
        for (let k = 0; k < top.deg[cell]; k++) {
          const other = top.nb[cell * SLOTS + k];
          const back = top.rev[cell * SLOTS + k];
          assert.deepStrictEqual(
            net.glued[cell * SLOTS + k],
            net.glued[other * SLOTS + back],
            'both cells agree',
          );
          unglued += net.glued[cell * SLOTS + k] ? 0 : 1;
        }
      }
      assert.deepStrictEqual(unglued, 2 * n * cuts);
    }
  },
);

test('surface net: pickSide gives the side nearest to a point in the cell', FAST, () => {
  for (const [kind, n] of [
    ['tetra', 3],
    ['cube', 3],
  ]) {
    const top = surfaceTopology(kind, n);
    const net = buildNet(top);
    for (let cell = 0; cell < top.T; cell++) {
      for (let k = 0; k < top.deg[cell]; k++) {
        const poly = net.polys[cell];
        const [a, b] = [poly[k], poly[(k + 1) % poly.length]];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const [cx, cy] = net.centers[cell];
        const point = [mid[0] + (cx - mid[0]) * 0.2, mid[1] + (cy - mid[1]) * 0.2];
        assert.deepStrictEqual(pickSide(net, cell, ...point), k, `${kind} cell ${cell} side ${k}`);
      }
    }
  }
});

test('surface net: a route is one line beside the fold and two stubs over a cut', FAST, () => {
  const top = surfaceTopology('cube', 3);
  const net = buildNet(top);
  let glued = null;
  let cut = null;
  for (let cell = 0; cell < top.T && !(glued && cut); cell++) {
    for (let k = 0; k < 4; k++) {
      const target = net.glued[cell * SLOTS + k] ? 'glued' : 'cut';
      if (target === 'glued' && !glued) {
        glued = [cell, top.nb[cell * SLOTS + k]];
      } else if (target === 'cut' && !cut) {
        cut = [cell, top.nb[cell * SLOTS + k]];
      }
    }
  }
  assert.deepStrictEqual(routePieces(net, glued), [
    [net.centers[glued[0]], net.centers[glued[1]]],
  ]);
  const pieces = routePieces(net, cut);
  assert.deepStrictEqual(pieces.length, 2);
  assert.deepStrictEqual(pieces[0][0], net.centers[cut[0]]);
  assert.deepStrictEqual(pieces[1][1], net.centers[cut[1]]);
  const slot = slotBetween(top, cut[0], cut[1]);
  const side = [net.polys[cut[0]][slot], net.polys[cut[0]][(slot + 1) % 4]];
  assert.deepStrictEqual(pieces[0][1], [
    (side[0][0] + side[1][0]) / 2,
    (side[0][1] + side[1][1]) / 2,
  ]);
  assert.deepStrictEqual(routePieces(net, [5]), [[net.centers[5]]]);
  assert.deepStrictEqual(routePieces(net, []), []);
  assert.deepStrictEqual(slotBetween(top, 0, 53), -1);
});

test(
  'surface net: crossings of a route give an out and an in mark with the cut letter',
  FAST,
  () => {
    const top = surfaceTopology('cube', 3);
    const net = buildNet(top);
    for (let cell = 0; cell < top.T; cell++) {
      for (let k = 0; k < 4; k++) {
        const letter = net.letterAt.get(cell * SLOTS + k);
        assert.deepStrictEqual(
          letter === undefined,
          net.glued[cell * SLOTS + k] === 1,
          'a letter on every cut side',
        );
        if (letter !== undefined) {
          const other = top.nb[cell * SLOTS + k];
          const back = top.rev[cell * SLOTS + k];
          assert.deepStrictEqual(net.letterAt.get(other * SLOTS + back), letter, 'same both ways');
        }
      }
    }
    let glued = null;
    let cut = null;
    for (let cell = 0; cell < top.T; cell++) {
      for (let k = 0; k < 4; k++) {
        const pair = [cell, top.nb[cell * SLOTS + k]];
        glued = glued || (net.glued[cell * SLOTS + k] ? pair : null);
        cut = cut || (net.glued[cell * SLOTS + k] ? null : pair);
      }
    }
    assert.deepStrictEqual(routeCrossings(net, glued), [], 'no mark beside a fold');
    assert.deepStrictEqual(routeCrossings(net, [cut[0]]), []);
    const marks = routeCrossings(net, cut);
    const slot = slotBetween(top, cut[0], cut[1]);
    assert.deepStrictEqual(
      marks.map(m => m.kind),
      ['out', 'in'],
    );
    assert.deepStrictEqual(marks[0], {
      kind: 'out',
      cell: cut[0],
      slot,
      letter: net.letterAt.get(cut[0] * SLOTS + slot),
    });
    assert.deepStrictEqual(marks[1].cell, cut[1]);
    assert.deepStrictEqual(marks[1].slot, top.rev[cut[0] * SLOTS + slot]);
    assert.deepStrictEqual(marks[1].letter, marks[0].letter);
    const hidden = { ...net, hidden: top.faceOf.map(face => face === top.faceOf[cut[1]]) };
    assert.deepStrictEqual(
      routeCrossings(hidden, cut).map(m => m.kind),
      ['out'],
      'a hidden cell has no mark',
    );
    assert.deepStrictEqual(routePieces(hidden, cut).length, 1, 'and no piece');
    assert.deepStrictEqual(routePieces(hidden, [cut[1], cut[0]]).length, 1);
    assert.deepStrictEqual(
      routePieces(hidden, [cut[1], cut[1]]),
      [],
      'nothing of cells that are all hidden',
    );
  },
);

test('proj: turns stay rotations; a drag turns the front its way; turnToward faces', FAST, () => {
  const right = turn(orbit(IDENTITY, 0.3, 0), [0, 0, 1]);
  assert.ok(right[0] > 0.29 && Math.abs(right[1]) < 1e-12, 'drag right: the front goes right');
  const down = turn(orbit(IDENTITY, 0, 0.3), [0, 0, 1]);
  assert.ok(down[1] < -0.29 && Math.abs(down[0]) < 1e-12, 'drag down: the front goes down');
  const rnd = makeRng(3);
  let R = IDENTITY;
  for (let i = 0; i < 500; i++) {
    R = orbit(R, rnd() - 0.5, rnd() - 0.5);
  }
  const rows = [R.slice(0, 3), R.slice(3, 6), R.slice(6, 9)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  rows.forEach((a, i) =>
    rows.forEach((b, j) => {
      assert.ok(Math.abs(dot(a, b) - (i === j ? 1 : 0)) < 1e-9, `rows ${i} ${j} orthonormal`);
    }),
  );
  const [a, b, c] = rows;
  const bc = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
  const triple = dot(a, bc);
  assert.ok(Math.abs(triple - 1) < 1e-9, 'a rotation, not a mirror');
  const d = [1, 2, 3];
  const unit = v => v.map(x => x / Math.hypot(...v));
  const full = turnToward(R, d);
  assert.ok(Math.abs(unit(turn(full, d))[2] - 1) < 1e-9, 'faces the viewer');
  const half = turnToward(R, d, 0.5);
  const angle = r => Math.acos(unit(turn(r, d))[2]);
  assert.ok(Math.abs(angle(half) - angle(R) / 2) < 1e-9, 'half of the way');
  assert.ok(turn(turnToward(IDENTITY, [0, 0, -1]), [0, 0, -1])[2] > 0.999, 'from the back');
  assert.deepStrictEqual(turnToward(IDENTITY, [0, 0, 1]), IDENTITY, 'already facing');
});

test(
  'proj: a mark lies in the plane of its cell, squeezed with it, as upright as possible',
  FAST,
  () => {
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cube = surfaceTopology('cube', 3);
    const front = turnToward(IDENTITY, cellDirection(cube, 4));
    assert.ok(near(faceFrame(front, cube, 4), [1, 0, 0, 1]), 'facing the viewer: as flat');
    for (const [kind, n] of [
      ['tetra', 3],
      ['cube', 3],
    ]) {
      const top = surfaceTopology(kind, n);
      let R = overview(top);
      for (const turned of [
        [0, 0],
        [0.4, 0.2],
        [1.3, -0.5],
        [2.4, 0.9],
      ]) {
        R = orbit(R, ...turned);
        const view = buildView(top, R);
        for (let cell = 0; cell < top.T; cell++) {
          if (view.hidden[cell]) {
            continue;
          }
          const [a, b, c, d] = view.frameOf(cell);
          assert.ok(
            Math.abs(a * d - b * c - view.depth[cell]) < 1e-9,
            'area seen = z of the normal',
          );
          assert.ok(d >= -1e-9, 'up does not point down the screen');
          // the two axes of the mark are unit vectors, at right angles, in the plane of the cell
          const normal = turn(R, cellNormal(top, cell));
          const right = [a, -b, -(normal[0] * a - normal[1] * b) / normal[2]];
          const up = [-c, d, -(-normal[0] * c + normal[1] * d) / normal[2]];
          assert.ok(
            near([dot(right, right), dot(up, up), dot(right, up)], [1, 1, 0]),
            'a true frame',
          );
        }
      }
    }
  },
);

test('proj view: three faces from a corner, counter-clockwise, the box never moves', FAST, () => {
  const area = poly =>
    poly.reduce((sum, [x, y], i) => {
      const [nx, ny] = poly[(i + 1) % poly.length];
      return sum + (x * ny - nx * y) / 2;
    }, 0);
  for (const [kind, n] of [
    ['tetra', 3],
    ['cube', 3],
    ['cube', 2],
  ]) {
    const top = surfaceTopology(kind, n);
    const view = buildView(top, overview(top));
    assert.deepStrictEqual(
      view.hidden.filter(h => !h).length,
      3 * n * n,
      `${kind} ${n}: three faces`,
    );
    for (let cell = 0; cell < top.T; cell++) {
      const turned = view.hidden[cell] || area(view.polys[cell]) > 0;
      assert.ok(turned, `${kind} ${n}: ${cell} counter-clockwise`);
      assert.ok(
        view.depth[cell] > -0.05 || area(view.polys[cell]) < 0,
        `${kind} ${n}: ${cell} behind`,
      );
    }
    assert.deepStrictEqual(buildView(top, orbit(overview(top), 0.7, 0.4)).box, view.box);
    assert.deepStrictEqual(view.maxSidePx, Infinity);
    assert.deepStrictEqual(view.cuts, []);
    assert.deepStrictEqual(
      facing(turnToward(overview(top), cellDirection(top, 5)), top, 5) > 0.999,
      true,
    );
  }
});

test(
  'proj view: a route is drawn where seen, with marks where it goes behind and returns',
  FAST,
  () => {
    const g = generateSurface('tetra', 4, 2);
    const top = surfaceTopology('tetra', 4);
    const view = buildView(top, overview(top));
    const marks = routeCrossings(view, g.path);
    let outs = 0;
    let ins = 0;
    let runs = 0;
    g.path.forEach((cell, i) => {
      const before = i > 0 && view.hidden[g.path[i - 1]];
      outs += i > 0 && !before && view.hidden[cell] ? 1 : 0;
      ins += i > 0 && before && !view.hidden[cell] ? 1 : 0;
      runs += !view.hidden[cell] && (i === 0 || before) ? 1 : 0;
    });
    assert.ok(outs + ins > 0, 'the route goes behind');
    assert.deepStrictEqual(marks.filter(m => m.kind === 'out').length, outs);
    assert.deepStrictEqual(marks.filter(m => m.kind === 'in').length, ins);
    assert.deepStrictEqual(
      routePieces(view, g.path).length,
      runs,
      'one piece per run of seen cells',
    );
    assert.ok(
      marks.every(m => m.letter === '' && !view.hidden[m.cell]),
      'no letters, seen cells',
    );
  },
);

test(
  'surface board: the solid shows the cells that are seen, shaded by face, without cuts',
  FAST,
  () => {
    const g = generateSurface('tetra', 3, 1);
    const top = surfaceTopology('tetra', 3);
    const view = buildView(top, overview(top));
    const state = {
      P: g.puzzle,
      selected: -1,
      buffer: '',
      playing: false,
      path: [],
      template: g.path,
      solutions: [],
      visible: [],
    };
    const { markup, frame } = surfaceSvg(view, state);
    const seen = view.hidden.filter(h => !h).length;
    assert.deepStrictEqual((markup.match(/<polygon class="sf-cell/g) || []).length, seen);
    assert.ok(!/sf-cut|sf-tag/.test(markup), 'no cuts, no letters');
    assert.deepStrictEqual(
      new Set(markup.match(/fill="rgb\([^"]+\)"/g)).size,
      3,
      'a colour for each face seen',
    );
    const numbered = g.puzzle.cp.filter((number, cell) => number && !view.hidden[cell]).length;
    assert.deepStrictEqual((markup.match(/class="sf-badge/g) || []).length, numbered);
    assert.deepStrictEqual(
      (markup.match(/<g class="sf-badge[^>]* transform="matrix\(/g) || []).length,
      numbered,
    );
    const flat = surfaceSvg(buildNet(top), state).markup;
    assert.ok(!/transform=/.test(flat), 'the net has its numbers flat');
    const head = { ...state, playing: true, path: [g.path.find(cell => !view.hidden[cell])] };
    assert.ok(
      /class="sf-head"[^>]* transform="matrix\(/.test(surfaceSvg(view, head).markup),
      'the head',
    );
    const turned = surfaceSvg(buildView(top, orbit(overview(top), 1, 1)), state).frame;
    assert.deepStrictEqual(
      [turned.width, turned.height],
      [frame.width, frame.height],
      'the picture keeps its size',
    );
  },
);

test('surface board: a polygon per cell, walls on both copies of a cut, the letters', FAST, () => {
  const g = generateSurface('cube', 2, 1);
  const net = buildNet(surfaceTopology('cube', 2));
  const view = {
    P: g.puzzle,
    selected: -1,
    buffer: '',
    playing: false,
    path: [],
    template: g.path,
    solutions: [g.path],
    visible: [true],
  };
  const { markup, frame } = surfaceSvg(net, view);
  assert.deepStrictEqual((markup.match(/<polygon class="sf-cell/g) || []).length, 24);
  assert.deepStrictEqual((markup.match(/class="sf-badge/g) || []).length, g.K);
  assert.deepStrictEqual((markup.match(/class="sf-tag"/g) || []).length, 14);
  for (const letter of 'ABCDEFG') {
    const tag = new RegExp(`class="sf-tag"><circle[^>]*/><text[^>]*>${letter}</text>`, 'g');
    assert.deepStrictEqual((markup.match(tag) || []).length, 2, letter);
  }
  const top = surfaceTopology('cube', 2);
  let expected = 0;
  for (let cell = 0; cell < top.T; cell++) {
    for (let k = 0; k < 4; k++) {
      const other = top.nb[cell * SLOTS + k];
      const shown = !net.glued[cell * SLOTS + k] || cell < other;
      expected += shown && g.puzzle.walls[top.edgeAt[cell * SLOTS + k]] ? 1 : 0;
    }
  }
  assert.deepStrictEqual((markup.match(/class="sf-wall"/g) || []).length, expected);
  assert.ok(expected > wallEdges(g.puzzle).length - 1, 'a wall on a cut is drawn twice');
  assert.ok(/class="sf-path"/.test(markup));
  const crossings = routeCrossings(net, g.path).length;
  assert.ok(crossings > 0, 'the path crosses a cut');
  assert.deepStrictEqual(
    (markup.match(/class="sf-arrow"/g) || []).length,
    2 * crossings,
    'template and solution',
  );
  assert.deepStrictEqual(
    (markup.match(/class="sf-cross"/g) || []).length,
    2 * crossings,
    'a letter beside each',
  );
  const play = surfaceSvg(net, { ...view, playing: true, path: g.path.slice(0, 3) }).markup;
  assert.ok(!/stroke-dasharray/.test(play), 'no template while playing');
  assert.deepStrictEqual((play.match(/class="sf-cell[^"]* visited"/g) || []).length, 3);
  assert.ok(/class="sf-head"/.test(play));
  const early = routeCrossings(net, g.path.slice(0, 3)).length;
  assert.deepStrictEqual((play.match(/class="sf-arrow"/g) || []).length, early);
  const [x, y] = frame.toPixels([net.box.minX, net.box.maxY]);
  const [nx, ny] = frame.toNet(x, y);
  assert.ok(
    Math.abs(nx - net.box.minX) < 0.05 && Math.abs(ny - net.box.maxY) < 0.05,
    'toNet inverts',
  );
  assert.ok(netFrame(net).width > 0);
});

// ---- the ball boards

const fnv = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

registerBalls(BALL_CATALOG);

// a copy of the registry module that has not been given the catalog
const fresh = await import('../../src/core/solid/ball-registry.js?fresh');

test('ball catalog: ids, hashes and the shape of every entry', FAST, () => {
  assert.ok(BALL_CATALOG.length >= 35, 'the catalog is not empty');
  assert.deepStrictEqual(
    new Set(BALL_CATALOG.map(entry => entry.id)).size,
    BALL_CATALOG.length,
    'ids are unique',
  );
  for (const entry of BALL_CATALOG) {
    const where = entry.id;
    assert.ok(/^[a-z][a-z0-9-]*$/.test(entry.id), `${where}: id fits a puzzle file line`);
    assert.deepStrictEqual(entry.h, fnv(JSON.stringify(entry.r)), `${where}: hash of the rings`);
    const counts = [3, 4, 5].map(k => entry.r.filter(ring => ring.length === k).length);
    assert.deepStrictEqual(entry.f, counts, `${where}: f counts the faces by number of sides`);
    assert.deepStrictEqual(
      counts[0] + counts[1] + counts[2],
      entry.r.length,
      `${where}: only 3, 4 and 5 sides`,
    );
    assert.ok(entry.r.length >= 4, `${where}: at least 4 cells`);
    assert.ok(entry.ok === true || (entry.ok === false && entry.why), `${where}: ok, or why not`);
    for (const p of entry.v) {
      assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-5, `${where}: corners are unit vectors`);
    }
  }
});

test('ball catalog: closed, convex, counter-clockwise, Euler and the corner formula', FAST, () => {
  for (const entry of BALL_CATALOG) {
    const where = entry.id;
    const top = surfaceTopology(BALL_KIND, entry.id);
    assert.deepStrictEqual(top.T, entry.r.length, `${where}: cells`);
    assert.deepStrictEqual(top.V, entry.v.length, `${where}: corners`);
    assert.deepStrictEqual(top.V - top.E + top.T, 2, `${where}: Euler`);
    let sides = 0;
    for (let cell = 0; cell < top.T; cell++) {
      assert.deepStrictEqual(top.deg[cell], entry.r[cell].length, `${where}: neighbours = sides`);
      sides += top.deg[cell];
      for (let k = 0; k < top.deg[cell]; k++) {
        const other = top.nb[cell * SLOTS + k];
        assert.deepStrictEqual(
          top.nb[other * SLOTS + top.rev[cell * SLOTS + k]],
          cell,
          `${where}: neighbours agree`,
        );
      }
      const ring = entry.r[cell].map(i => entry.v[i]);
      let centre = [0, 0, 0];
      ring.forEach((p, k) => {
        const before = ring[(k + ring.length - 1) % ring.length];
        const turn = dot(cross(before, p), ring[(k + 1) % ring.length]);
        assert.ok(
          turn > 1e-6,
          `${where}: cell ${cell} turns left at every corner (convex, outward)`,
        );
        centre = [centre[0] + p[0], centre[1] + p[1], centre[2] + p[2]];
      });
      const normal = cross(
        [ring[1][0] - ring[0][0], ring[1][1] - ring[0][1], ring[1][2] - ring[0][2]],
        [ring[2][0] - ring[0][0], ring[2][1] - ring[0][1], ring[2][2] - ring[0][2]],
      );
      assert.ok(
        dot(normal, centre) > 0,
        `${where}: cell ${cell} is counter-clockwise from outside`,
      );
    }
    assert.deepStrictEqual(sides, 2 * top.E);
    // 3 f3 + 2 f4 + f5 = 12 + 2 * sum over corners of (cells at the corner - 3)
    const at = new Array(entry.v.length).fill(0);
    for (const ring of entry.r) {
      ring.forEach(v => at[v]++);
    }
    assert.ok(
      at.every(n => n >= 3),
      `${where}: three or more cells at every corner`,
    );
    const excess = at.reduce((sum, n) => sum + n - 3, 0);
    assert.deepStrictEqual(
      3 * entry.f[0] + 2 * entry.f[1] + entry.f[2],
      12 + 2 * excess,
      `${where}: corner formula`,
    );
    assert.deepStrictEqual(
      surfaceTopology(BALL_KIND, entry.id) === top,
      true,
      `${where}: built once`,
    );
    assert.deepStrictEqual(surfaceCellCount(BALL_KIND, entry.id), top.T);
  }
  assert.ok(threw(() => surfaceTopology(BALL_KIND, 'nope')));
  assert.ok(threw(() => surfaceTopology(BALL_KIND, 12)));
  assert.ok(threw(() => ballEntry('')));
});

test(
  'ball catalog: the solids named in the design, and what no puzzle can be played on',
  FAST,
  () => {
    const f = id => ballEntry(id).f;
    assert.deepStrictEqual(f('dodeca'), [0, 0, 12], '12 pentagons');
    assert.deepStrictEqual(f('prism5'), [0, 5, 2], '5 squares + 2 pentagons');
    assert.deepStrictEqual(f('snub-dodeca'), [80, 0, 12], '80 triangles + 12 pentagons');
    assert.deepStrictEqual(f('snub-cube'), [32, 6, 0]);
    assert.deepStrictEqual(f('cuboct'), [8, 6, 0], '8 triangles + 6 squares');
    assert.deepStrictEqual(f('icosidodeca'), [20, 0, 12], '20 triangles + 12 pentagons');
    // the numbers of triangles on offer: cells of one type are congruent, so no free-form solid
    const flat = BALL_CATALOG.filter(e => e.f[1] + e.f[2] === 0 && e.ok);
    const triangles = [...new Set(flat.map(e => e.f[0]))].sort((a, b) => a - b);
    assert.deepStrictEqual(triangles, [4, 6, 8, 10, 12, 14, 16, 20, 24, 48, 60]);
    // a bipartite board can only be covered by a path when its colour classes are almost equal
    for (const id of ['cuboct', 'icosidodeca', 'rhombicuboct', 'rhombicosidodeca']) {
      const top = surfaceTopology(BALL_KIND, id);
      assert.ok(top.bipartite, `${id}: an even number of cells at every corner`);
      assert.ok(Math.abs(top.classes[0] - top.classes[1]) > 1, `${id}: classes ${top.classes}`);
      assert.deepStrictEqual(ballEntry(id).ok, false, `${id}: cannot be played`);
      assert.ok(/bipartite/.test(ballEntry(id).why));
    }
    assert.deepStrictEqual(surfaceTopology(BALL_KIND, 'cuboct').classes.slice().sort(), [6, 8]);
    assert.deepStrictEqual(
      surfaceTopology(BALL_KIND, 'icosidodeca').classes.slice().sort(),
      [12, 20],
    );
    // the oracle: no path through all 14 cells of the cuboctahedron, whatever the start
    assert.deepStrictEqual(countHamiltonianPaths(surfaceTopology(BALL_KIND, 'cuboct')).count, 0);
    const octa = surfaceTopology(BALL_KIND, 'octa');
    assert.ok(countHamiltonianPaths(octa).count > 0, 'the octahedron has paths');
  },
);

test('ball catalog: every entry marked ok has a path through all its cells', FAST, () => {
  for (const entry of BALL_CATALOG) {
    if (!entry.ok) {
      continue;
    }
    const top = surfaceTopology(BALL_KIND, entry.id);
    const cfg = { ...GEN_CFG, pathNodeCap: 50000, pathTries: 400 };
    const path = randomHamiltonianPath(top, makeRng(1), cfg);
    assert.ok(
      path && path.length === top.T && new Set(path).size === top.T,
      `${entry.id}: a path`,
    );
    for (let i = 0; i + 1 < path.length; i++) {
      let next = false;
      for (let k = 0; k < top.deg[path[i]]; k++) {
        next = next || top.nb[path[i] * SLOTS + k] === path[i + 1];
      }
      assert.ok(next, `${entry.id}: steps go to a neighbour`);
    }
  }
});

test('balls: play window, selector groups, labels', FAST, () => {
  const list = playableBalls();
  assert.ok(list.length >= 25, `${list.length} balls in the play window`);
  for (const entry of list) {
    assert.ok(entry.ok && entry.r.length >= PLAY_MIN_CELLS && entry.r.length <= PLAY_MAX_CELLS);
  }
  const cells = id => BALL_CATALOG.find(e => e.id === id).r.length;
  const has = id => list.some(e => e.id === id);
  assert.ok(has('octa') && cells('octa') === PLAY_MIN_CELLS, 'the smallest board is in');
  assert.ok(!has('cube') && cells('cube') < PLAY_MIN_CELLS, 'one below the minimum is out');
  assert.ok(
    list.every(e => e.id !== 'cuboct'),
    'unplayable boards are left out',
  );
  assert.deepStrictEqual(playableBalls(0, 1000).length, BALL_CATALOG.filter(e => e.ok).length);
  const rnd = makeRng(7);
  const picked = new Set();
  for (let i = 0; i < 400; i++) {
    picked.add(pickBall(rnd).id);
  }
  assert.ok(picked.size > list.length / 2, 'random picks spread over the list');
  assert.deepStrictEqual(pickBall(() => 0.999999).id, list[list.length - 1].id);
  assert.deepStrictEqual(compositionLabel([80, 0, 12]), '80 triangles + 12 pentagons');
  assert.deepStrictEqual(compositionLabel([0, 0, 12]), '12 pentagons');
  assert.deepStrictEqual(compositionLabel([1, 1, 1]), '1 triangle + 1 square + 1 pentagon');
  const groups = ballsByComposition();
  assert.deepStrictEqual(
    groups.reduce((sum, g) => sum + g.balls.length, 0),
    BALL_CATALOG.length,
  );
  for (let i = 1; i < groups.length; i++) {
    assert.ok(
      groups[i - 1].balls[0].r.length <= groups[i].balls[0].r.length,
      'fewest cells first',
    );
  }
  const eighty = groups.find(g => g.label === '80 triangles + 12 pentagons');
  assert.deepStrictEqual(
    eighty.balls.map(e => e.id),
    ['snub-dodeca'],
  );
});

test('ball catalog: the cells of a type are congruent; uneven balls are not offered', FAST, () => {
  for (const entry of BALL_CATALOG) {
    assert.ok(
      congruentByType(entry.v, entry.r),
      `${entry.id}: congruent triangles, squares, pentagons`,
    );
  }
  // a pyramid on every face of a square pyramid has two kinds of triangles
  const pyramid = seeds().find(([id]) => id === 'pyramid4');
  const uneven = kis(meshOf(pyramid[2]));
  const corners = uneven.verts.map(p => p.map(x => x / Math.hypot(...p)));
  assert.deepStrictEqual(congruentByType(corners, uneven.faces), false, 'kis pyramid4 is uneven');
  assert.ok(
    !BALL_CATALOG.some(entry => entry.id === 'kis-pyramid4' || entry.id.startsWith('spread')),
  );
  // the Catalan and Archimedean solids stay
  for (const id of ['snub-dodeca', 'dual-snub-dodeca', 'kis-dodeca', 'antiprism5']) {
    assert.ok(
      BALL_CATALOG.some(entry => entry.id === id),
      id,
    );
  }
});

test('ball catalog: the registry is empty until it is given the catalog', FAST, () => {
  assert.deepStrictEqual(fresh.ballsLoaded(), false);
  assert.ok(
    threw(() => fresh.ballEntry('tetra')),
    'not loaded',
  );
  fresh.registerBalls(BALL_CATALOG);
  assert.deepStrictEqual(fresh.ballsLoaded(), true);
  assert.deepStrictEqual(fresh.ballEntry('tetra').id, 'tetra');
  assert.deepStrictEqual(fresh.ballList().length, BALL_CATALOG.length);
  assert.ok(threw(() => fresh.ballEntry('nope')));
});

test('ball puzzles: generated, unique, solvable, and the text format round-trips', FAST, () => {
  for (const [id, seed] of [
    ['octa', 1],
    ['dodeca', 2],
    ['prism5', 3],
    ['snub-cube', 4],
    ['dual-snub-cube', 5],
    ['kis-cube', 6],
    ['bipyramid6', 7],
    ['snub-dodeca', 8],
  ]) {
    const top = surfaceTopology(BALL_KIND, id);
    const made = generateSurface(BALL_KIND, id, seed);
    const p = made.puzzle;
    assert.deepStrictEqual(p.kind, BALL_KIND);
    assert.deepStrictEqual(p.n, id);
    const [kMin, kMax] = kRange(top.T);
    assert.ok(made.K >= kMin && made.K <= Math.min(kMax, top.T), `${id}: checkpoints ${made.K}`);
    assert.deepStrictEqual(validateSurface(p).ok, true, `${id}: valid`);
    const solved = solveSurface(p, { limit: 2 });
    assert.deepStrictEqual(solved.count, 1, `${id}: exactly one solution`);
    assert.ok(isSolved(p, made.path), `${id}: the path it was made from solves it`);
    assert.ok(wallEdges(p).length <= top.E);
    const text = serializeSurface(p);
    assert.ok(text.includes(`surface ball ${id}\n`), `${id}: header`);
    const back = parseSurface(text);
    assert.deepStrictEqual(back.n, id);
    assert.deepStrictEqual(Array.from(back.cp), Array.from(p.cp), `${id}: numbers round-trip`);
    assert.deepStrictEqual(Array.from(back.walls), Array.from(p.walls), `${id}: walls round-trip`);
    const again = generateSurface(BALL_KIND, id, seed);
    assert.deepStrictEqual(
      Array.from(again.puzzle.cp),
      Array.from(p.cp),
      `${id}: same seed, same puzzle`,
    );
  }
  assert.ok(threw(() => makeSurfacePuzzle(BALL_KIND, 'nope')));
  assert.ok(threw(() => parseSurface('surface ball nope\n')));
  assert.ok(threw(() => parseSurface('surface ball\n')));
  assert.ok(
    threw(() => generateSurface(BALL_KIND, 'cuboct', 1)),
    'no puzzle on an unplayable board',
  );
});

// ---- the ball view and its drawing

const area = poly =>
  poly.reduce((sum, [x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    return sum + (x * ny - nx * y) / 2;
  }, 0);

const inside = ([x, y], poly) => {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      in_ = !in_;
    }
  }
  return in_;
};

const distanceToEdges = ([x, y], poly) => {
  let nearest = Infinity;
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const reach = dx || dy ? ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy) : 0;
    const along = Math.max(0, Math.min(1, reach));
    nearest = Math.min(nearest, Math.hypot(x - ax - along * dx, y - ay - along * dy));
  });
  return nearest;
};

const transpose = R => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

// A few views of a board: the first view of the app, then turned about in both directions.
const viewsOf = top => {
  const out = [];
  let R = overview(top);
  for (let i = 0; i < 5; i++) {
    R = orbit(R, 0.37 + i * 0.5, 0.21 + i * 0.3);
    out.push(R);
  }
  return [overview(top), IDENTITY, ...out];
};

registerBalls(BALL_CATALOG);

test(
  'ball view: the outlines tile the disc of the ball, in every view of every ball',
  FAST,
  () => {
    for (const entry of BALL_CATALOG) {
      const top = surfaceTopology(BALL_KIND, entry.id);
      for (const R of viewsOf(top)) {
        const view = buildBallView(top, R);
        let total = 0;
        for (let cell = 0; cell < top.T; cell++) {
          const outline = view.outlines[cell];
          if (view.drawn[cell]) {
            assert.ok(area(outline) > 0, `${entry.id}: cell ${cell} is counter-clockwise`);
            for (const [x, y] of outline) {
              assert.ok(
                Math.hypot(x, y) < 1 + 1e-9,
                `${entry.id}: cell ${cell} stays in the disc`,
              );
            }
          }
          total += outline.length >= 3 ? Math.max(0, area(outline)) : 0;
          // a cell whose centre faces the viewer is drawn and marked
          assert.deepStrictEqual(
            view.hidden[cell],
            view.depth[cell] > 0.08 ? 0 : 1,
            `${entry.id}: hidden`,
          );
          if (!view.hidden[cell]) {
            assert.ok(view.drawn[cell] === 1, `${entry.id}: cell ${cell} is seen, so it is drawn`);
          }
        }
        // the polygons are inscribed in the arcs: the disc is covered up to a small margin
        assert.ok(Math.abs(total / Math.PI - 1) < 0.01, `${entry.id}: area ${total / Math.PI}`);
      }
    }
  },
);

test('ball view: a point of the picture is in the cell the exact test finds', FAST, () => {
  const rnd = makeRng(11);
  for (const id of ['tetra', 'cube', 'snub-cube', 'snub-dodeca', 'dual-snub-cube', 'bipyramid7']) {
    const top = surfaceTopology(BALL_KIND, id);
    for (const R of viewsOf(top).slice(0, 4)) {
      const view = buildBallView(top, R);
      const back = transpose(R);
      for (let i = 0; i < 400; i++) {
        const x = rnd() * 2 - 1;
        const y = rnd() * 2 - 1;
        const r2 = x * x + y * y;
        if (r2 > 0.98) {
          continue;
        }
        const cell = directionCell(top, turn(back, [x, y, Math.sqrt(1 - r2)]));
        assert.ok(cell >= 0, `${id}: a cell for every point`);
        const hits = [];
        view.outlines.forEach((outline, k) => {
          if (outline.length >= 3 && inside([x, y], outline)) {
            hits.push(k);
          }
        });
        if (!hits.includes(cell)) {
          // only along a side, where the arc and its chord differ
          const near = distanceToEdges([x, y], view.outlines[cell]);
          assert.ok(
            near < 0.012,
            `${id}: point ${x}, ${y} is in ${cell}, drawn in ${hits} (${near})`,
          );
        }
      }
    }
  }
  for (const entry of BALL_CATALOG) {
    const top = surfaceTopology(BALL_KIND, entry.id);
    for (let cell = 0; cell < top.T; cell++) {
      assert.deepStrictEqual(
        directionCell(top, cellDirection(top, cell)),
        cell,
        `${entry.id}: centre of ${cell}`,
      );
    }
  }
});

test('ball view: the far side, the middle of a side, picking a side, marks', FAST, () => {
  for (const id of ['snub-cube', 'kis-dodeca', 'prism5', 'dual-antiprism5']) {
    const top = surfaceTopology(BALL_KIND, id);
    const R = orbit(overview(top), 0.6, 0.35);
    const front = buildBallView(top, R);
    const far = buildBallView(top, behind(R));
    for (let cell = 0; cell < top.T; cell++) {
      assert.ok(Math.abs(front.depth[cell] + far.depth[cell]) < 1e-9, `${id}: opposite depths`);
      assert.ok(front.markRadius(cell) > 0 && front.markRadius(cell) <= 0.085 + 1e-12);
      for (let slot = 0; slot < top.deg[cell]; slot++) {
        const other = top.nb[cell * SLOTS + slot];
        const back = top.rev[cell * SLOTS + slot];
        const [ax, ay] = front.sideMid(cell, slot);
        const [bx, by] = front.sideMid(other, back);
        assert.ok(
          Math.hypot(ax - bx, ay - by) < 1e-9,
          `${id}: both cells share the middle of a side`,
        );
      }
      if (front.depth[cell] > 0.6) {
        // a point just inside the middle of a side that is in front picks that side
        for (let slot = 0; slot < top.deg[cell]; slot++) {
          const ends = [slot, (slot + 1) % top.deg[cell]].map(k => {
            const id = top.ring[cell * SLOTS + k];
            return [0, 1, 2].map(axis => top.verts[id * 3 + axis]);
          });
          const mid = [0, 1, 2].map(axis => ends[0][axis] + ends[1][axis]);
          if (turn(R, mid)[2] / Math.hypot(...mid) < 0.3) {
            continue;
          }
          const [mx, my] = front.sideMid(cell, slot);
          const [cx, cy] = front.centers[cell];
          const point = [mx + (cx - mx) * 0.1, my + (cy - my) * 0.1];
          assert.deepStrictEqual(
            front.pickSide(cell, ...point),
            slot,
            `${id}: side ${slot} of ${cell}`,
          );
        }
      }
    }
    // every corner is in front or behind; the front part of a closed outline is one run
    const ring = [
      [0, 0, 1],
      [0.2, 0, 1],
      [0.2, 0.2, 1],
    ];
    assert.deepStrictEqual(frontOf(ring).length, 3);
    assert.deepStrictEqual(
      frontOf([
        [0, 0, -1],
        [1, 0, -1],
        [0, 1, -1],
      ]).length,
      0,
    );
  }
});

test('ball view: a route and the markup', FAST, () => {
  const made = generateSurface(BALL_KIND, 'snub-cube', 5, { K: 8 });
  const top = surfaceTopology(BALL_KIND, 'snub-cube');
  const puzzle = made.puzzle;
  const R = orbit(overview(top), 0.4, 0.2);
  const view = buildBallView(top, R);
  const pieces = view.routePieces(made.path);
  assert.ok(pieces.length >= 1);
  for (const piece of pieces) {
    assert.ok(piece.length > 1);
    for (const [x, y] of piece) {
      assert.ok(Math.hypot(x, y) <= 1 + 1e-9, 'a route is drawn in front');
    }
  }
  // the near half and the far half of the route together cover every step
  const flat = view.routePieces(made.path).flat();
  const seen = new Set(flat.map(p => p.map(v => v.toFixed(4)).join()));
  assert.ok(seen.size > made.path.length, 'many points in front');
  const base = {
    P: puzzle,
    selected: -1,
    buffer: '',
    playing: false,
    path: [],
    template: made.path,
    solutions: [],
    visible: [],
    idSuffix: '7',
  };
  const picture = surfaceSvg(view, base);
  assert.ok(!picture.markup.includes('NaN'), 'no NaN in the markup');
  assert.ok(picture.markup.includes('class="sf-disc"') && picture.markup.includes('sfGloss7'));
  const polygons = picture.markup.match(/<polygon class="sf-cell/g) || [];
  const inFront = view.drawn.reduce((sum, drawn) => sum + drawn, 0);
  assert.deepStrictEqual(polygons.length, inFront, 'a polygon per cell in front');
  const numbered = [];
  for (let cell = 0; cell < top.T; cell++) {
    if (puzzle.cp[cell] && !view.hidden[cell]) {
      numbered.push(cell);
    }
  }
  assert.deepStrictEqual(
    (picture.markup.match(/class="sf-badge/g) || []).length,
    numbered.length,
    'badges',
  );
  assert.ok(/<polyline class="sf-path"/.test(picture.markup), 'the template path');
  const walls = makeSurfacePuzzle(BALL_KIND, 'snub-cube');
  walls.walls.fill(1);
  const walled = surfaceSvg(view, { ...base, P: walls, template: null });
  assert.ok(
    (walled.markup.match(/<polyline class="sf-wall"/g) || []).length > 20,
    'walls are curved',
  );
  const playing = surfaceSvg(view, { ...base, playing: true, path: made.path.slice(0, 10) });
  assert.ok(
    playing.markup.includes('class="sf-head"') || view.hidden[made.path[9]] === 1,
    'the head',
  );
  // two balls on a page (the Map view) are 300 px wide at most
  const small = buildBallView(top, R, { maxWidth: 300 });
  const pair = surfaceSvg(small, base).frame;
  assert.ok(pair.width <= 300 + 2 * 60 && pair.width < picture.frame.width, `pair ${pair.width}`);
});

// ---- the 3D puzzles of the play app

// the channels of every fill="rgb(r,g,b)" in a markup
const fills = markup =>
  [...markup.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)].map(match =>
    match.slice(1).map(Number),
  );

registerBalls(BALL_CATALOG);

test('solid nav: the turn that follows the head', FAST, () => {
  const ball = surfaceTopology(BALL_KIND, 'snub-cube');
  const R = overview(ball);
  const facing = buildBallView(ball, R);
  const head = facing.depth.indexOf(Math.max(...facing.depth));
  assert.ok(!headTurnedAway(ball, facing, [head], true), 'the head faces the viewer');
  assert.ok(
    headTurnedAway(ball, buildBallView(ball, behind(R)), [head], true),
    'the head is behind',
  );
  // near the rim counts as turned away for a ball
  const rim = facing.depth.findIndex(z => z > 0 && z < FOLLOW_EDGE - 0.02);
  if (rim >= 0) {
    assert.ok(headTurnedAway(ball, facing, [rim], true), 'a cell near the rim');
  }
  const cube = surfaceTopology('cube', 3);
  const view = buildView(cube, overview(cube));
  const away = view.hidden.indexOf(1);
  assert.ok(headTurnedAway(cube, view, [away], false), 'a cell on the far side of a cube');

  // the turner runs frames until the cell faces the viewer, and stops when told to
  const frames = [];
  const saved = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  globalThis.cancelAnimationFrame = id => {
    frames[id - 1] = null;
  };
  try {
    let rotation = IDENTITY;
    let drawn = 0;
    const turner = createTurner({
      getRotation: () => rotation,
      setRotation: next => {
        rotation = next;
      },
      redraw: () => {
        drawn++;
      },
    });
    turner.toward(ball, head);
    let guard = 0;
    while (frames.length && guard++ < 200) {
      const frame = frames.shift();
      if (frame) {
        frame();
      }
    }
    assert.ok(
      turn(rotation, cellDirection(ball, head))[2] >= FOLLOW_DONE,
      'the head faces the viewer',
    );
    assert.ok(drawn > 1 || turn(IDENTITY, cellDirection(ball, head))[2] >= FOLLOW_DONE);
    // stop() ends a turn in progress
    rotation = IDENTITY;
    turner.toward(ball, head);
    const before = frames.length;
    turner.stop();
    assert.ok(before === 1 && frames.every(frame => frame === null), 'stopped');
  } finally {
    [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = saved;
  }
  assert.deepStrictEqual(Object.keys(ARROW_TURN).sort(), [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
  ]);
  const R2 = orbit(IDENTITY, ...ARROW_TURN.ArrowRight);
  assert.ok(Math.abs(turn(R2, [0, 0, 1])[0]) > 0.1, 'an arrow key turns');
});

test(
  'surface board: the palette of the picture, and the design app shares the drawing',
  FAST,
  () => {
    assert.deepStrictEqual(
      designBoard.surfaceSvg === viewSurfaceSvg,
      true,
      'one drawing for both apps',
    );
    const made = generateSurface(BALL_KIND, 'snub-cube', 3, { K: 6 });
    const top = surfaceTopology(BALL_KIND, 'snub-cube');
    const view = buildBallView(top, orbit(overview(top), 0.3, 0.2));
    const state = {
      P: made.puzzle,
      selected: -1,
      buffer: '',
      playing: true,
      path: made.path.slice(0, 12),
      template: null,
      solutions: [],
      visible: [],
    };
    const dark = viewSurfaceSvg(view, state).markup;
    const light = viewSurfaceSvg(view, { ...state, palette: LIGHT_PALETTE }).markup;
    assert.ok(
      fills(dark).every(rgb => Math.max(...rgb) < 140),
      'the default palette is dark',
    );
    assert.ok(
      fills(light).every(rgb => Math.min(...rgb) > 120),
      'the light palette is light',
    );
    assert.ok(
      dark.includes(DARK_PALETTE.play) && !light.includes(DARK_PALETTE.play),
      'path colour',
    );
    assert.ok(light.includes(LIGHT_PALETTE.play), 'the orange path of the flat game');
    assert.ok(!light.includes('NaN') && !dark.includes('NaN'));
    // the gloss of the ball takes its light and dark from the palette
    assert.ok(light.includes(`stop-opacity="${LIGHT_PALETTE.gloss.light}"`));
    assert.ok(dark.includes(`stop-opacity="${DARK_PALETTE.gloss.dark}"`));
    // tetra and cube take the palette too (a tint for each face)
    const cube = surfaceTopology('cube', 3);
    const solid = viewSurfaceSvg(buildView(cube, overview(cube)), {
      ...state,
      P: makeSurfacePuzzle('cube', 3),
      path: [],
      palette: LIGHT_PALETTE,
    }).markup;
    assert.ok(fills(solid).length > 5 && fills(solid).every(rgb => Math.min(...rgb) > 120));
  },
);

test('play app: icons and texts of the 3D puzzles', FAST, () => {
  // compat pin: the kind ids are in the saved puzzle text
  assert.deepStrictEqual(SOLID_KINDS, ['tetra', 'cube', 'ball']);
  assert.ok(isSolidKind('ball') && !isSolidKind('cutout') && !isSolidKind(undefined));
  const icons = SOLID_KINDS.map(kind => variantIcon(kind));
  SOLID_KINDS.forEach((kind, i) => {
    assert.ok(icons[i].startsWith('<svg') && icons[i].includes(`vi-${kind}`), `${kind}: an icon`);
    assert.ok(!icons[i].includes('undefined'));
  });
  assert.deepStrictEqual(new Set(icons).size, 3, 'three different icons');
  assert.ok(cardIcon('solid').includes('<path'), 'the icon of the card');
  for (const kind of SOLID_KINDS) {
    for (const key of [`mode.${kind}`, `mode.${kind}Tag`, `mode.${kind}Rules`]) {
      assert.ok(EN[key] && ZH[key], `${key} in both languages`);
    }
  }
  for (const key of [
    'gen.subSolid',
    'game.tetraTitle',
    'game.cubeTitle',
    'game.ballTitle',
    'solid.title',
    'solid.turn',
    'solid.netNote',
    'solid.mapNote',
    'solid.follow',
    'solid.followTip',
    'solid.followOn',
    'solid.followOff',
  ]) {
    assert.ok(EN[key] && ZH[key], `${key} in both languages`);
  }
  assert.deepStrictEqual(translate('solid.cells', 1), '1 cell');
  assert.deepStrictEqual(translate('solid.cells', 36), '36 cells');
});

test('play app: the card of the 3D puzzles in the menu', FAST, () => {
  const make = showDev =>
    createSolidPlay({
      S: { showDev, screen: 'menu' },
      $: () => null,
      t: translate,
      render: () => {},
      genNoticeHtml: () => '',
      paintGenerating: () => {},
      startTimer: () => {},
      stopTimer: () => {},
      randomSeed: () => 1,
    });
  const hidden = make(false).cardHtml();
  assert.ok(/id="solidCard" style="display:none"/.test(hidden), 'hidden unless V is held');
  const shown = make(true).cardHtml();
  assert.ok(/id="solidCard" style=""/.test(shown), 'shown while V is held');
  assert.deepStrictEqual(
    (shown.match(/name="solid"/g) || []).length,
    3,
    'a tile for each of the three',
  );
  assert.ok(shown.includes('id="playSolid"') && shown.includes('id="solidSel"'));
  // the default is the ball: Random, then every playable shape (never one with no solution)
  const options = [...shown.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  assert.deepStrictEqual(options[0], 'random');
  const playable = BALL_CATALOG.filter(entry => entry.ok).map(entry => entry.id);
  assert.deepStrictEqual(options.slice(1).sort(), playable.slice().sort(), 'the playable balls');
  assert.ok(!options.includes('cuboct') && !options.includes('icosidodeca'));
  assert.ok(shown.includes('<optgroup label="80 triangles + 12 pentagons · 92 cells">'));
});

test('solid nav: leaving the head over a cut of a net steps to the cell across it', FAST, () => {
  const top = surfaceTopology('tetra', 3);
  const net = buildNet(top);
  let cut = null;
  let glued = null;
  for (let cell = 0; cell < top.T && !(cut && glued); cell++) {
    for (let slot = 0; slot < top.deg[cell]; slot++) {
      if (!net.glued[cell * SLOTS + slot]) {
        cut = cut || [cell, slot];
      } else {
        glued = glued || [cell, slot];
      }
    }
  }
  const through = ([cell, slot]) => {
    const poly = net.polys[cell];
    const [a, b] = [poly[slot], poly[(slot + 1) % poly.length]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [cx, cy] = net.centers[cell];
    return {
      from: [cx, cy],
      past: [mid[0] + (mid[0] - cx) * 0.5, mid[1] + (mid[1] - cy) * 0.5],
      mid,
    };
  };
  const out = through(cut);
  const across = top.nb[cut[0] * SLOTS + cut[1]];
  assert.deepStrictEqual(
    crossedCut(top, net, cut[0], out.from, out.past),
    across,
    'out over a cut: the cell across',
  );
  const [cx, cy] = net.centers[cut[0]];
  const inside = [(cx + out.mid[0]) / 2, (cy + out.mid[1]) / 2];
  assert.deepStrictEqual(crossedCut(top, net, cut[0], [cx, cy], inside), -1, 'inside the cell');
  const inner = through(glued);
  assert.deepStrictEqual(
    crossedCut(top, net, glued[0], inner.from, inner.past),
    -1,
    'over a side that is not cut',
  );
});

test('surface board: the way on over a cut, and the hint rings', FAST, () => {
  const made = generateSurface('tetra', 3, 2);
  const top = surfaceTopology('tetra', 3);
  const net = buildNet(top);
  // the first cell of the path with a cut side that the path can go on over
  let at = -1;
  for (let i = 0; i < made.path.length - 1 && at < 0; i++) {
    for (let slot = 0; slot < top.deg[made.path[i]]; slot++) {
      const cell = made.path[i];
      const next = top.nb[cell * SLOTS + slot];
      if (!net.glued[cell * SLOTS + slot] && next === made.path[i + 1]) {
        at = i;
      }
    }
  }
  assert.ok(at >= 0, 'the path crosses a cut');
  const path = made.path.slice(0, at + 1);
  const state = {
    P: made.puzzle,
    selected: -1,
    buffer: '',
    playing: true,
    path,
    template: null,
    solutions: [],
    visible: [],
    palette: LIGHT_PALETTE,
    continues: (_from, to) => canPush(made.puzzle, path, to, { strictOrder: true }),
  };
  const count = (markup, name) => (markup.match(new RegExp(`class="${name}"`, 'g')) || []).length;
  const shown = viewSurfaceSvg(net, state).markup;
  assert.ok(count(shown, 'sf-land') >= 1 && count(shown, 'sf-arrow') >= 2, 'arrows and a pulse');
  const none = viewSurfaceSvg(net, { ...state, continues: () => false }).markup;
  assert.deepStrictEqual(count(none, 'sf-land'), 0, 'nothing to show when the path may not go on');
  // a path that has just come in over a cut: the cell it came in by pulses
  const came = made.path.slice(0, at + 2);
  const arrived = viewSurfaceSvg(net, { ...state, path: came, continues: () => false });
  assert.ok(count(arrived.markup, 'sf-land') === 1, 'the cell the path came in by');
  const ringed = viewSurfaceSvg(net, {
    ...state,
    hintCell: made.path[at + 1],
    hintWrongCell: 0,
  }).markup;
  assert.deepStrictEqual(count(ringed, 'sf-hint'), 1, 'the hinted cell');
  assert.deepStrictEqual(count(ringed, 'sf-wrong'), 1, 'the wrong cell');
  assert.deepStrictEqual(
    count(viewSurfaceSvg(net, state).markup, 'sf-hint'),
    0,
    'no hint, no ring',
  );
  // the hint of the flat game works on a path of a surface puzzle: the next cell, or the wrong one
  assert.deepStrictEqual(computeHint(made.path, []).correctCell, made.path[0]);
  const wrong = made.path.slice(0, 3).concat([made.path[5]]);
  const hint = computeHint(made.path, wrong);
  assert.deepStrictEqual([hint.correctCell, hint.wrongCell], [made.path[3], made.path[5]]);
});

test('play app: the card lists only Random until the ball catalog is loaded', FAST, () => {
  const make = () =>
    createSolidPlay({
      S: { showDev: true, screen: 'menu' },
      $: () => null,
      t: translate,
      render: () => {},
      genNoticeHtml: () => '',
      paintGenerating: () => {},
      startTimer: () => {},
      stopTimer: () => {},
      randomSeed: () => 1,
      openExport: () => {},
    });
  registerBalls([]);
  try {
    const options = [
      ...make()
        .cardHtml()
        .matchAll(/<option value="([^"]+)"/g),
    ].map(m => m[1]);
    assert.deepStrictEqual(options, ['random'], 'no catalog, no balls yet');
  } finally {
    registerBalls(BALL_CATALOG);
  }
  assert.ok(loadBalls() instanceof Promise, 'loading is a promise');
});

test('play app: the card of the 3D puzzles follows the release dates', FAST, () => {
  const rel = releaseDays({ first: 20261201, tetra: 7, cube: 21, ball: 35 });
  const make = (day, { unlocked = () => false, showDev = false, release = rel } = {}) =>
    createSolidPlay({
      S: { showDev, screen: 'menu' },
      $: () => null,
      t: translate,
      render: () => {},
      genNoticeHtml: () => '',
      paintGenerating: () => {},
      startTimer: () => {},
      stopTimer: () => {},
      randomSeed: () => 1,
      release,
      today: () => day,
      unlocked,
    }).cardHtml();
  const tiles = html =>
    [...html.matchAll(/id="solidOpt-(\w+)"( style="display:none")?/g)]
      .filter(match => !match[2])
      .map(match => match[1]);
  const sizes = html =>
    [...html.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  const locked = html => (html.match(/variant-locked/g) || []).length;
  const hiddenCard = /id="solidCard" style="display:none"/;
  const first = rel.first;

  assert.ok(hiddenCard.test(make(first - 1)), 'hidden before the first day');
  assert.ok(hiddenCard.test(make(first, { release: null })), 'hidden when nothing is released');
  let html = make(first);
  assert.ok(/id="solidCard" style=""/.test(html), 'shown from the first day');
  assert.deepStrictEqual(
    [tiles(html), sizes(html)],
    [['tetra'], [2]],
    'the first day: tetra of size 2 only',
  );
  assert.ok(/value="tetra"[^>]*checked/.test(html), 'and it is the picked tile');
  assert.ok(html.includes('2 (16 cells)'));
  html = make(first + 7);
  assert.deepStrictEqual(
    [tiles(html), sizes(html)],
    [['tetra'], [2, 3, 4, 5]],
    'a week later: every size',
  );
  assert.deepStrictEqual(
    tiles(make(first + 21)),
    ['tetra', 'cube'],
    'three weeks later: the cube',
  );
  assert.deepStrictEqual(
    tiles(make(first + 35)),
    ['tetra', 'cube', 'ball'],
    'five weeks later: the ball',
  );

  html = make(first, { unlocked: kind => kind === 'cube' });
  assert.deepStrictEqual(
    [tiles(html), sizes(html)],
    [['tetra', 'cube'], [2]],
    'a kind won in the lucky game',
  );

  html = make(first - 30, { showDev: true });
  assert.deepStrictEqual(
    tiles(html),
    ['tetra', 'cube', 'ball'],
    'V shows everything, before the release too',
  );
  assert.deepStrictEqual(locked(html), 3, 'the kinds nobody can play yet are marked');
  assert.deepStrictEqual(locked(make(first)), 2, 'cube and ball are marked, the tetra is not');
});

test(
  'solid: one list of the solid kinds, shared by the core and the play app; the board of a ' +
    'puzzle is its kind',
  FAST,
  () => {
    assert.deepStrictEqual(CORE_SOLID_KINDS, [...SIZED_SOLIDS, BALL_KIND]);
    assert.deepStrictEqual(
      SOLID_KINDS,
      CORE_SOLID_KINDS,
      'the play app uses the list of the core',
    );
    assert.ok(!CORE_SOLID_KINDS.includes(PENTAGON_KIND), 'the Pentagon board is not a solid');
    for (const kind of SIZED_SOLIDS) {
      const p = makeSurfacePuzzle(kind, 2);
      assert.deepStrictEqual([p.kind, p.surface], [kind, undefined], `${kind}: the field is kind`);
    }
  },
);

test('play app: a new 3D puzzle opens in the view the player chose last', FAST, async () => {
  registerBalls(BALL_CATALOG);
  // a page that does nothing: every element takes any property and any call
  const els = {};
  const calls = () => new Proxy({}, { get: () => () => null });
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const element = () =>
    new Proxy(
      { style: {}, classList: calls(), innerHTML: '' },
      {
        get: (target, key) => {
          if (key in target) {
            return target[key];
          }
          // what the zoom asks of the board: its svgs and their box
          const own = {
            querySelectorAll: () => [],
            querySelector: () => element(),
            getBoundingClientRect: () => rect,
          };
          return own[key] ?? (() => null);
        },
        set: (target, key, value) => Object.assign(target, { [key]: value }) && true,
      },
    );
  const play = createSolidPlay({
    S: { showDev: false, screen: 'menu' },
    $: id => (els[id] ??= element()),
    t: translate,
    render: () => {},
    genNoticeHtml: () => '',
    paintGenerating: () => {},
    startTimer: () => {},
    stopTimer: () => {},
    randomSeed: () => 7,
    openExport: () => {},
  });
  const label = () => /id="solidView">([^<]*)</.exec(play.screenHtml())[1];
  const toggle = () => {
    play.attach();
    els.solidView.onclick();
  };
  await play.start({ kind: 'tetra', size: 2 });
  assert.deepStrictEqual(label(), translate('solid.net'), 'the solid at first');
  toggle();
  assert.deepStrictEqual(label(), translate('solid.solid'), 'the net after the button');
  await play.start({ kind: 'tetra', size: 2 });
  assert.deepStrictEqual(label(), translate('solid.solid'), 'a new puzzle keeps the net');
  await play.start({ kind: 'cube', size: 2 });
  assert.deepStrictEqual(label(), translate('solid.solid'), 'so does another kind');
  toggle();
  assert.deepStrictEqual(label(), translate('solid.net'), 'the solid again');
  await play.start({ kind: 'tetra', size: 3 });
  assert.deepStrictEqual(label(), translate('solid.net'), 'a new puzzle keeps the solid');
});

test(
  'play app: Cancel while a 3D puzzle is made goes back to the menu without a message, and a lucky chance comes back',
  FAST,
  async () => {
    registerBalls(BALL_CATALOG);
    const S = { showDev: false, screen: 'menu' };
    let refunds = 0;
    const play = createSolidPlay({
      S,
      $: () => null,
      t: translate,
      render: () => {},
      genNoticeHtml: () => '',
      paintGenerating: () => {},
      startTimer: () => {},
      stopTimer: () => {},
      randomSeed: () => {
        S.genJob.cancel(); // the player presses Cancel while the puzzle is being made
        return 7;
      },
      luckyFailed: async () => {
        refunds++;
      },
      openExport: () => {},
    });
    await play.start({ kind: 'tetra', size: 3, lucky: true });
    assert.deepStrictEqual(S.screen, 'menu', 'back on the menu');
    assert.deepStrictEqual(S.genNotice, null, 'a cancel is not a failure: no message');
    assert.deepStrictEqual(refunds, 1, 'the unlock chance of the lucky game is given back');
    assert.deepStrictEqual(S.genJob, null, 'the job is closed');
  },
);

// ---- the fast solver and path search

// The solver of v0.14.0.
function plainSolve(p, limit, nodeCap) {
  const top = topologyOf(p);
  const { T, nb, deg, dist } = top;
  const open = openSlots(top, p.walls);
  const K = maxNumber(p);
  const cellOf = new Int32Array(K + 2).fill(-1);
  p.cp.forEach((number, cell) => {
    if (number) cellOf[number] = cell;
  });
  const start = cellOf[1];
  const end = cellOf[K];
  const tail = new Int32Array(K + 2);
  for (let m = K - 1; m >= 1; m--) {
    tail[m] = tail[m + 1] + dist[cellOf[m] * T + cellOf[m + 1]];
  }
  const prunes = makePrunes(top, open);
  const vis = new Uint8Array(T);
  const path = new Int32Array(T);
  const found = [];
  let nodes = 0;
  let count = 0;
  let capped = false;
  const feasible = (head, remaining, next) =>
    remaining === 0 ||
    (dist[head * T + cellOf[next]] + tail[next] <= remaining &&
      prunes.deadEnds(vis, head, end) &&
      prunes.connected(vis, head, remaining));
  const search = (head, depth, next) => {
    nodes++;
    if (nodeCap && nodes > nodeCap) {
      capped = true;
      return;
    }
    if (depth === T) {
      count++;
      if (found.length < 2) found.push(Array.from(path));
      return;
    }
    const remaining = T - depth;
    for (let k = 0; k < deg[head]; k++) {
      if (!open[head * SLOTS + k]) continue;
      const cell = nb[head * SLOTS + k];
      if (vis[cell]) continue;
      const number = p.cp[cell];
      let wanted = next;
      if (number) {
        if (number !== next || (number === K && remaining !== 1)) continue;
        wanted = next + 1;
      }
      vis[cell] = 1;
      path[depth] = cell;
      if (feasible(cell, remaining - 1, wanted)) search(cell, depth + 1, wanted);
      vis[cell] = 0;
      if (count >= limit || capped) return;
    }
  };
  vis[start] = 1;
  path[0] = start;
  if (feasible(start, T - 1, 2)) search(start, 1, 2);
  return { count, path: found[0] ?? null, second: found[1] ?? null, nodes, capped };
}

// The path search of v0.14.0.
function plainPath(top, rnd, cfg = GEN_CFG) {
  const { T, nb, deg } = top;
  const prunes = makePrunes(top, openSlots(top, null));
  const vis = new Uint8Array(T);
  const path = [];
  let nodes = 0;
  const extend = head => {
    if (path.length === T) return true;
    if (++nodes > cfg.pathNodeCap) return false;
    const around = [];
    for (let k = 0; k < deg[head]; k++) {
      if (nb[head * SLOTS + k] >= 0) around.push(nb[head * SLOTS + k]);
    }
    for (const cell of shuffle(around, rnd)) {
      if (vis[cell]) continue;
      vis[cell] = 1;
      path.push(cell);
      const left = T - path.length;
      if (prunes.deadEnds(vis, cell, -1) && prunes.connected(vis, cell, left) && extend(cell)) {
        return true;
      }
      path.pop();
      vis[cell] = 0;
      if (nodes > cfg.pathNodeCap) return false;
    }
    return false;
  };
  for (let attempt = 0; attempt < cfg.pathTries; attempt++) {
    vis.fill(0);
    path.length = 0;
    nodes = 0;
    const first = Math.floor(rnd() * T);
    vis[first] = 1;
    path.push(first);
    if (extend(first)) return path.slice();
  }
  return null;
}

const BOARDS = [
  ['pentagon', 4],
  ['pentagon', 6],
  ['tetra', 3],
  ['cube', 3],
  ['ball', 'snub-cube'],
];

// The puzzle with some of its numbers and walls taken away (several solutions, a real search).
function relaxed(p, rnd, keepShare) {
  const q = { ...p, cp: p.cp.slice(), walls: p.walls.slice() };
  const cells = [];
  q.cp.forEach((number, cell) => {
    if (number) cells[number - 1] = cell;
  });
  const kept = cells.filter((_cell, i) => i === 0 || i === cells.length - 1 || rnd() < keepShare);
  q.cp.fill(0);
  kept.forEach((cell, i) => {
    q.cp[cell] = i + 1;
  });
  q.walls.forEach((wall, edge) => {
    if (wall && rnd() < 0.5) q.walls[edge] = 0;
  });
  return q;
}

test(
  'surface-fast: the solver gives the solutions of the plain solver, with no more nodes, on ' +
    'puzzles as made and with numbers and walls taken away',
  SLOW,
  () => {
    const rnd = makeRng(77);
    let saved = 0;
    for (const [kind, n] of BOARDS) {
      for (let seed = 1; seed <= 4; seed++) {
        const made = generateSurface(kind, n, seed * 7).puzzle;
        const puzzles = [made, ...[0.6, 0.8, 0.4].map(share => relaxed(made, rnd, share))];
        puzzles.forEach((p, i) => {
          const plain = plainSolve(p, 2, 30000);
          const fast = solveSurface(p, { limit: 2, nodeCap: 30000 });
          if (plain.capped) return;
          const label = `${kind} ${n} seed ${seed} puzzle ${i}`;
          assert.ok(!fast.capped, `${label}: not capped`);
          assert.deepStrictEqual(
            [fast.count, fast.path, fast.second],
            [plain.count, plain.path, plain.second],
            label,
          );
          assert.ok(fast.nodes <= plain.nodes, `${label}: ${fast.nodes} <= ${plain.nodes} nodes`);
          saved += plain.nodes - fast.nodes;
        });
      }
    }
    assert.ok(saved > 0, 'the narrowing saves nodes somewhere');
  },
);

test(
  'surface-fast: narrowOpen closes only sides that no solution uses, and says so when the ' +
    'puzzle has none',
  FAST,
  () => {
    let closed = 0;
    for (const [kind, n] of BOARDS) {
      for (let seed = 1; seed <= 3; seed++) {
        const made = generateSurface(kind, n, seed * 11);
        const top = topologyOf(made.puzzle);
        const open = openSlots(top, made.puzzle.walls);
        const before = open.reduce((sum, v) => sum + v, 0);
        const K = maxNumber(made.puzzle);
        const cells = [];
        made.puzzle.cp.forEach((number, cell) => {
          if (number) cells[number] = cell;
        });
        assert.ok(
          narrowOpen(top, open, made.puzzle.cp, cells[1], cells[K]),
          'a puzzle with a solution',
        );
        closed += before - open.reduce((sum, v) => sum + v, 0);
        for (let i = 1; i < made.path.length; i++) {
          const a = made.path[i - 1];
          const slot = [...Array(SLOTS).keys()].find(k => top.nb[a * SLOTS + k] === made.path[i]);
          const side = `${a}-${made.path[i]}`;
          assert.ok(
            open[a * SLOTS + slot] === 1,
            `${kind} ${n}: the solution keeps its side ${side}`,
          );
        }
      }
    }
    assert.ok(closed > 0, 'sides were closed');
    // no solution: numbers 1 and 2 on cells that are not neighbours and a cell cut off by walls
    const p = makeSurfacePuzzle('pentagon', 4);
    const top = topologyOf(p);
    p.cp[0] = 1;
    p.cp[1] = 2;
    for (let k = 0; k < SLOTS; k++) {
      const edge = top.edgeAt[5 * SLOTS + k];
      if (edge >= 0) p.walls[edge] = 1;
    }
    assert.deepStrictEqual(solveSurface(p).count, 0, 'a cell with every side walled has no path');
  },
);

test(
  'surface-fast: the path search gives the paths of the plain search, seed for seed',
  SLOW,
  () => {
    for (const [kind, n] of [...BOARDS, ['pentagon', 8], ['cube', 4]]) {
      const top = surfaceTopology(kind, n);
      for (let seed = 1; seed <= 6; seed++) {
        const a = plainPath(top, makeRng(seed));
        const b = randomHamiltonianPath(top, makeRng(seed));
        assert.deepStrictEqual(b, a, `${kind} ${n} seed ${seed}`);
        assert.ok(b === null || new Set(b).size === top.T, 'every cell once');
      }
    }
  },
);
