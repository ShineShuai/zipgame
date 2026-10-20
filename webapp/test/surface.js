// Tests of the closed-surface boards (tetrahedron and cube): the graph (core/surface/topology.js),
// the puzzle model, rules and text format (puzzle.js), the solver (solve.js, checked against a
// plain brute-force search and against path counts computed with an independent C++ program) and
// the generator (gen.js). Registered by tests.js: surfaceTests(t, ok, eq).
// Set SURFACE_SLOW=1 for the oracle counts that take several seconds.
import {
  surfaceTopology,
  edgeBetween,
  cellCentroid,
  SURFACE_SIZES,
  SLOTS,
} from '../src/core/surface/topology.js';
import { SIZED_SOLIDS } from '../src/core/solid/kinds.js';
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
} from '../src/core/surface/puzzle.js';
import {
  solveSurface,
  countHamiltonianPaths,
  makePrunes,
  openSlots,
} from '../src/core/surface/solve.js';
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
} from '../src/core/surface/gen.js';
import { makeRng, shuffle } from '../src/core/rng.js';
import { runSync } from '../src/core/run.js';
import { commentTimes } from '../src/core/format.js';
import {
  buildNet,
  cellAt,
  pickSide,
  routePieces,
  routeCrossings,
  slotBetween,
} from '../src/view/surface-net.js';
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
} from '../src/view/proj.js';
import { surfaceSvg, netFrame } from '../src/apps/design/surface-board.js';

const slow = typeof process !== 'undefined' && Boolean(process.env.SURFACE_SLOW);

const threw = f => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};

// Every Hamiltonian path that obeys the rules, by plain search with no pruning at all.
function brute(p) {
  const top = surfaceTopology(p.kind, p.n);
  const K = maxNumber(p);
  const start = p.cp.indexOf(1);
  const vis = new Uint8Array(top.T);
  let count = 0;
  const go = (cell, depth, next) => {
    vis[cell] = 1;
    if (depth === top.T) {
      if (next === K + 1 && p.cp[cell] === K) {
        count++;
      }
    } else {
      for (let k = 0; k < top.deg[cell]; k++) {
        const other = top.nb[cell * SLOTS + k];
        if (vis[other] || p.walls[top.edgeAt[cell * SLOTS + k]]) {
          continue;
        }
        const number = p.cp[other];
        if (number && number !== next) {
          continue;
        }
        go(other, depth + 1, number ? next + 1 : next);
      }
    }
    vis[cell] = 0;
  };
  go(start, 1, 2);
  return count;
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

export function surfaceTests(t, ok, eq) {
  t('surface topology: counts, closed surface, Euler characteristic, sizes on offer', () => {
    for (const kind of SIZED_SOLIDS) {
      const degree = kind === 'tetra' ? 3 : 4;
      for (let n = 1; n <= 5; n++) {
        const top = surfaceTopology(kind, n);
        const T = (kind === 'tetra' ? 4 : 6) * n * n;
        eq(top.T, T, `${kind} ${n} cells`);
        eq(top.E, (T * degree) / 2, `${kind} ${n} edges`);
        eq(top.V, top.E - top.T + 2, `${kind} ${n} corners (Euler: V - E + F = 2)`);
        eq(top.V - top.E + top.T, 2);
        for (let cell = 0; cell < T; cell++) {
          eq(top.deg[cell], degree);
        }
        eq(top.bipartite, false, 'three cells meet at every corner and all touch');
        ok(surfaceTopology(kind, n) === top, 'built once');
      }
      for (const n of SURFACE_SIZES[kind]) {
        ok(surfaceTopology(kind, n).T <= 110, `${kind} ${n} stays small enough`);
      }
    }
    ok(threw(() => surfaceTopology('sphere', 3)));
    ok(threw(() => surfaceTopology('cube', 0)));
    ok(threw(() => surfaceTopology('cube', 13)));
    ok(threw(() => surfaceTopology('cube', 2.5)));
  });

  t('surface topology: neighbours, sides and edges agree with each other', () => {
    for (const kind of SIZED_SOLIDS) {
      for (const n of [1, 2, 3, 4]) {
        const top = surfaceTopology(kind, n);
        const timesSeen = new Int32Array(top.E);
        for (let cell = 0; cell < top.T; cell++) {
          for (let k = 0; k < top.deg[cell]; k++) {
            const other = top.nb[cell * SLOTS + k];
            const back = top.rev[cell * SLOTS + k];
            ok(other >= 0 && other !== cell);
            eq(top.nb[other * SLOTS + back], cell, 'the neighbour points back');
            eq(top.rev[other * SLOTS + back], k);
            const edge = top.edgeAt[cell * SLOTS + k];
            eq(top.edgeAt[other * SLOTS + back], edge, 'both sides name the same edge');
            const ends = [top.ends[edge * 2], top.ends[edge * 2 + 1]];
            eq(ends, [Math.min(cell, other), Math.max(cell, other)]);
            eq(edgeBetween(top, cell, other), edge);
            timesSeen[edge]++;
          }
          for (let k = top.deg[cell]; k < SLOTS; k++) {
            eq(top.nb[cell * SLOTS + k], -1, 'unused slot');
          }
        }
        ok(timesSeen.every(count => count === 2), 'every edge belongs to exactly two cells');
        eq(edgeBetween(top, 0, 0), -1);
      }
    }
  });

  t('surface topology: distances, face numbering, and cells face outwards', () => {
    for (const kind of SIZED_SOLIDS) {
      const top = surfaceTopology(kind, 3);
      const n2 = 9;
      for (let a = 0; a < top.T; a++) {
        eq(top.dist[a * top.T + a], 0);
        for (let b = 0; b < top.T; b++) {
          eq(top.dist[a * top.T + b], top.dist[b * top.T + a]);
          eq(top.dist[a * top.T + b] === 1, edgeBetween(top, a, b) >= 0);
        }
        eq(top.faceOf[a], Math.floor(a / n2), 'face * n^2 + k');
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
        ok(outward > 1e-9, `${kind} cell ${a} faces outwards`);
        const face = top.faceOf[a];
        if (kind === 'cube') {
          eq(c[face >> 1] * (face & 1 ? -1 : 1) > 0.999, true, 'cube face f is +x -x +y -y +z -z');
        } else {
          const corner = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]][face];
          const dot = corner[0] * c[0] + corner[1] * c[1] + corner[2] * c[2];
          ok(Math.abs(dot + 1) < 1e-9, 'tetra face f is the one opposite corner f');
        }
      }
    }
    eq(surfaceTopology('cube', 3).dist[0 * 54 + 53] > 0, true);
    const diameters = { tetra: [1, 4, 7], cube: [2, 5, 8] };
    for (const kind of SIZED_SOLIDS) {
      [1, 2, 3].forEach((n, i) => {
        eq(Math.max(...surfaceTopology(kind, n).dist), diameters[kind][i]);
      });
    }
  });

  t('surface solver: Hamiltonian path counts match an independent program (C++)', () => {
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
      eq(result.count, expected, `${kind} ${n}`);
      ok(!result.capped);
    }
    ok(countHamiltonianPaths(surfaceTopology('tetra', 3), { nodeCap: 1000 }).capped);
  });

  t('surface solver: same number of solutions as brute force on random puzzles', () => {
    const boards = [['tetra', 2, 0.15], ['cube', 1, 0.1], ['cube', 2, 0.5]];
    for (const [kind, n, share] of boards) {
      for (let seed = 1; seed <= 40; seed++) {
        const p = randomPuzzle(kind, n, seed, share);
        const solved = solveSurface(p, { limit: 1e9 });
        eq(solved.count, brute(p), `${kind} ${n} random seed ${seed}`);
        const made = solvablePuzzle(kind, n, seed, share).p;
        const again = solveSurface(made, { limit: 1e9 });
        eq(again.count, brute(made), `${kind} ${n} solvable seed ${seed}`);
        ok(again.count >= 1, 'the intended path is among the solutions');
        ok(isSolved(made, again.path));
      }
    }
  });

  t('surface solver: the dead-end and connectivity prunes see a cut-off cell', () => {
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
    eq(prunes.connected(vis, around[0], top.T - 3), true);
    eq(prunes.deadEnds(vis, around[0], x), true, 'x may be the last cell of the path');
    eq(prunes.deadEnds(vis, around[0], far), false, 'x would be a dead end in the middle');
    eq(prunes.deadEnds(vis, around[0], -1), true, 'one dead end is allowed when the end is free');
    // Head elsewhere: all three neighbours of x are used up, so x is cut off.
    vis[far] = 1;
    eq(prunes.connected(vis, far, top.T - 4), false);
    eq(prunes.deadEnds(vis, far, x), false);
    eq(prunes.deadEnds(vis, far, -1), false);
    // Two cells that can only end the path: allowed with a fixed end only for that end.
    const walls = new Uint8Array(top.E);
    for (let k = 0; k < 2; k++) {
      walls[top.edgeAt[x * SLOTS + k]] = 1;
    }
    const walled = makePrunes(top, openSlots(top, walls));
    const none = new Uint8Array(top.T);
    none[far] = 1;
    eq(walled.deadEnds(none, far, x), true, 'x has one open side: only the end may');
    eq(walled.deadEnds(none, far, far), false);
  });

  t('surface solver: limit, second solution, node cap', () => {
    const { p } = solvablePuzzle('tetra', 3, 5, 0);
    const two = solveSurface(p);
    eq(two.count, 2, 'stops at the limit');
    ok(isSolved(p, two.path) && isSolved(p, two.second));
    ok(two.path.join() !== two.second.join());
    eq(solveSurface(p, { limit: 1 }).count, 1);
    const capped = solveSurface(p, { nodeCap: 3 });
    eq(capped.capped, true);
    ok(capped.nodes <= 4);
    const bad = makeSurfacePuzzle('cube', 2);
    ok(threw(() => solveSurface(bad)), 'no numbers: invalid');
  });

  t('surface puzzle: validate, canStep and isSolved', () => {
    const p = makeSurfacePuzzle('cube', 2);
    eq(validateSurface(p).ok, false);
    p.cp[0] = 1;
    ok(validateSurface(p).msg.includes('at least 2'), 'a single number is not enough');
    p.cp[5] = 3;
    ok(validateSurface(p).msg.includes('number 2 is missing'));
    p.cp[5] = 2;
    eq(validateSurface(p), { ok: true, max: 2 });
    p.cp[7] = 2;
    ok(validateSurface(p).msg.includes('duplicate'));
    const q = makeSurfacePuzzle('cube', 2);
    q.cp[0] = 2;
    q.cp[1] = 3;
    ok(validateSurface(q).msg.includes('missing checkpoint 1'));
    const short = makeSurfacePuzzle('cube', 2);
    short.walls = new Uint8Array(3);
    ok(validateSurface(short).msg.includes('do not match'));

    const { p: puzzle, path } = solvablePuzzle('cube', 2, 3, 0.5);
    ok(isSolved(puzzle, path));
    ok(!isSolved(puzzle, path.slice(0, -1)), 'too short');
    ok(!isSolved(puzzle, path.slice().reverse()), 'starts on the wrong cell');
    const swapped = path.slice();
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    ok(!isSolved(puzzle, swapped), 'not a path any more');
    const repeated = path.slice();
    repeated[5] = repeated[4];
    ok(!isSolved(puzzle, repeated));
    const top = surfaceTopology('cube', 2);
    const edge = edgeBetween(top, path[1], path[2]);
    const walled = cloneSurfacePuzzle(puzzle);
    walled.walls[edge] = 1;
    ok(!canStep(walled, path[1], path[2]) && canStep(puzzle, path[1], path[2]));
    ok(!isSolved(walled, path), 'crosses a wall');
    ok(!canStep(puzzle, path[0], path[0]), 'a cell does not touch itself');
  });

  t('surface puzzle: plain text round trip and errors', () => {
    const { p, path } = solvablePuzzle('tetra', 3, 2, 0.5);
    const text = serializeSurface(p, { path });
    const back = parseSurface(text);
    eq(back.kind, 'tetra');
    eq(back.n, 3);
    eq(Array.from(back.cp), Array.from(p.cp));
    eq(Array.from(back.walls), Array.from(p.walls));
    eq(back.path, path);
    eq(serializeSurface(back, { path: back.path }), text);
    eq(parseSurface('# note\n\nsurface cube 2\ncheckpoints 0=1 5=2\n').cp[5], 2);
    eq(serializeSurface(makeSurfacePuzzle('cube', 2)), 'surface cube 2\n');
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
      ok(threw(() => parseSurface(text)), `should reject: ${JSON.stringify(text)}`);
    }
    const top = surfaceTopology('cube', 2);
    const wall = edgeBetween(top, 0, top.nb[0]);
    const throughWall = `surface cube 2\nwalls ${wall}\npath 0 ${top.nb[0]}`;
    ok(threw(() => parseSurface(throughWall)), 'path through a wall');
  });

  t('surface generator: random Hamiltonian path on every board size', () => {
    for (const kind of SIZED_SOLIDS) {
      for (const n of [1, 2, 3, ...SURFACE_SIZES[kind]]) {
        const top = surfaceTopology(kind, n);
        const path = randomHamiltonianPath(top, makeRng(n + 10));
        ok(path !== null, `${kind} ${n}: a path was found`);
        eq(new Set(path).size, top.T);
        for (let i = 1; i < path.length; i++) {
          ok(edgeBetween(top, path[i - 1], path[i]) >= 0, 'consecutive cells touch');
        }
      }
    }
    const starved = { pathNodeCap: 1, pathTries: 2 };
    ok(randomHamiltonianPath(surfaceTopology('cube', 4), makeRng(1), starved) === null);
    eq(defaultK('tetra', 3), 7);
    eq(defaultK('cube', 3), 8);
  });

  t('surface generator: unique, solved by its path, minimal walls, repeatable', () => {
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
      eq(validateSurface(g.puzzle).ok, true, label);
      eq(maxNumber(g.puzzle), g.K, label);
      ok(isSolved(g.puzzle, g.path), `${label}: its own path solves it`);
      const solved = solveSurface(g.puzzle);
      eq(solved.count, 1, label);
      eq(solved.path, g.path, label);
      eq(solved.nodes, g.nodes, label);
      const top = surfaceTopology(kind, n);
      for (let i = 0; i + 1 < g.path.length; i++) {
        const onPath = edgeBetween(top, g.path[i], g.path[i + 1]);
        eq(g.puzzle.walls[onPath], 0, `${label}: no wall on the path`);
      }
      eq(g.walls, wallEdges(g.puzzle).length, label);
      for (const edge of wallEdges(g.puzzle)) {
        const without = cloneSurfacePuzzle(g.puzzle);
        without.walls[edge] = 0;
        const result = solveSurface(without, { limit: 2, nodeCap: GEN_CFG.checkNodeCap });
        ok(result.capped || result.count === 2, `${label}: wall ${edge} is needed`);
      }
      const again = generateSurface(kind, n, seed);
      eq(serializeSurface(again.puzzle), serializeSurface(g.puzzle), `${label}: repeatable`);
    }
    eq(generateSurface('tetra', 3, 1, { K: 5 }).K, 5);
    eq(maxNumber(generateSurface('tetra', 3, 1, { K: 36 }).puzzle), 36);
  });

  t('surface generator: the play app draws K like the square boards (pickK), after the path', () => {
    // the range: from the square root of the cells to a quarter of them, mean at 30% of the way
    const cases = [['tetra', 3, 36], ['tetra', 5, 100], ['cube', 2, 24], ['cube', 4, 96]];
    for (const [kind, n, cells] of cases) {
      const min = Math.max(4, Math.round(Math.sqrt(cells)));
      const max = Math.max(min + 1, Math.round(cells / 4));
      const rnd = makeRng(5);
      const draws = Array.from({ length: 4000 }, () => pickSurfaceK(kind, n, rnd));
      ok(draws.every(K => K >= min && K <= max), `${kind} ${n}: within [${min}, ${max}]`);
      const mean = draws.reduce((sum, K) => sum + K, 0) / draws.length;
      ok(Math.abs(mean - (min + 0.3 * (max - min))) < 0.4, `${kind} ${n}: mean ${mean}`);
      ok(new Set(draws).size > 1, `${kind} ${n}: K varies`);
    }
    // without opts.K the generator draws it; with it the stream (and so the numbers) is as before
    const drawn = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      drawn.add(generateSurface('cube', 3, seed).K);
    }
    ok(drawn.size > 1, 'K differs between seeds');
    const [a, b] = [generateSurface('tetra', 3, 1), generateSurface('tetra', 3, 1, { K: 9 })];
    eq(a.path, b.path, 'the path of a seed does not depend on K');
    eq(b.K, 9);
  });

  t('surface generator: pinned puzzles (change only with a deliberate generator change)', () => {
    const tetra = generateSurface('tetra', 3, 1);
    eq(
      serializeSurface(tetra.puzzle, { path: tetra.path }),
      'surface tetra 3\ncheckpoints 8=1 14=2 20=3 2=4 22=5 15=6\n' +
        'path 8 17 31 30 29 14 10 11 20 21 25 2 1 0 35 26 24 23 19 18 9 27 28 32 33 34 5 6 7 3 ' +
        '4 22 13 12 16 15\n',
    );
    eq(tetra.nodes, 400);
    const cube = generateSurface('cube', 2, 1);
    eq(
      serializeSurface(cube.puzzle, { path: cube.path }),
      'surface cube 2\ncheckpoints 5=1 21=2 20=3 11=4 4=5\nwalls 4,8,17,18,20,38\n' +
        'path 5 16 17 7 6 21 20 22 13 0 2 23 9 8 10 11 3 19 18 1 15 14 12 4\n',
    );
    eq(cube.nodes, 382);
  });

  t('surface step: push, pop, truncate, order of the numbers, walls', () => {
    const p = makeSurfacePuzzle('tetra', 1); // 4 cells, every two touch
    p.cp[0] = 1;
    p.cp[1] = 2;
    p.cp[3] = 3;
    const path = [];
    eq(step(p, path, 1), null, 'the path starts on 1');
    eq(step(p, path, 0), 'push');
    eq(step(p, path, 1), 'push');
    eq(step(p, path, 0), 'pop', 'the cell before the head: one step back');
    eq(path, [0]);
    eq(step(p, path, 3, { strictOrder: true }), null, '3 before 2 is refused');
    eq(step(p, path, 3), 'push', 'but allowed when the order is not enforced');
    eq(step(p, path, 2), 'push');
    eq(step(p, path, 0), null, 'a visited cell is not entered again');
    eq(step(p, path, 0, { truncate: true }), 'trunc');
    eq(path, [0]);
    eq(step(p, path, 1, { strictOrder: true }), 'push');
    eq(step(p, path, 3, { strictOrder: true }), 'push');
    eq(step(p, path, 2, { strictOrder: true }), null, 'nothing follows the highest number');
    eq(step(p, path, 2), 'push');
    eq(nextNumber(p, [0]), 2);
    eq(nextNumber(p, [0, 1]), 3);
    eq(nextNumber(p, [0, 1, 3]), 0, 'no number is left');
    const top = surfaceTopology('tetra', 1);
    const walled = makeSurfacePuzzle('tetra', 1);
    walled.cp[0] = 1;
    walled.cp[3] = 2;
    const side = top.nb[0];
    walled.walls[top.edgeAt[0]] = 1;
    eq(step(walled, [0], side), null, 'a wall stops the step');
    walled.walls[top.edgeAt[0]] = 0;
    eq(step(walled, [0], side), 'push');
  });

  t('surface step: walking a generated solution is accepted all the way and solves it', () => {
    for (const [kind, n, seed] of [['tetra', 3, 1], ['tetra', 4, 2], ['cube', 2, 1]]) {
      const g = generateSurface(kind, n, seed);
      const path = [];
      for (const cell of g.path) {
        ok(step(g.puzzle, path, cell, { strictOrder: true }) === 'push', `${kind} ${n}: ${cell}`);
      }
      ok(isSolved(g.puzzle, path), `${kind} ${n}: solved`);
    }
  });

  t('surface text: looksLikeSurface, times as comments, empty path left out', () => {
    ok(looksLikeSurface('surface tetra 3\n'));
    ok(looksLikeSurface('# tetra 3 seed 1\n\n  surface cube 2\ncheckpoints 0=1 5=2\n'));
    ok(!looksLikeSurface('size 5\ncheckpoints 0,0=1\n'));
    ok(!looksLikeSurface('# surface\nsize 5\n'));
    const g = generateSurface('tetra', 3, 1);
    const text = serializeSurface(g.puzzle, {
      path: g.path,
      times: { generateMs: 12.34, solveMs: 0.5, playS: 7 },
    });
    eq(commentTimes(text), { generateMs: 12.3, solveMs: 0.5, playS: 7 });
    eq(serializeSurface(parseSurface(text)), serializeSurface(g.puzzle), 'comments are skipped');
    eq(parseSurface(text).path, g.path);
    ok(!/^path/m.test(serializeSurface(g.puzzle, { path: [] })), 'an empty path is no line');
    eq(serializeSurface(g.puzzle, { times: {} }), serializeSurface(g.puzzle));
  });

  t('surface generator: the generator yields progress and gives the same puzzles', () => {
    const events = [];
    const made = runSync(generateSurfaceSteps('tetra', 3, 1), e => events.push(e));
    eq(events[0].phase, 'path');
    const checks = events.filter(e => e.phase === 'walls');
    ok(checks.length > 0, 'a check for every wall of the start');
    eq(checks.map(e => e.done), checks.map((_, i) => i + 1));
    eq(checks[0].total, checks.length);
    eq(made.walls, 0);
    const cube = [];
    const second = runSync(generateSurfaceSteps('cube', 2, 1), e => cube.push(e));
    ok(cube.some(e => e.phase === 'walls'));
    eq(serializeSurface(made.puzzle), serializeSurface(generateSurface('tetra', 3, 1).puzzle));
    eq(serializeSurface(second.puzzle), serializeSurface(generateSurface('cube', 2, 1).puzzle));
    eq(second.undecided, 0);
  });

  t('surface generator: generateSurfaceWithin stops at the first puzzle within the limit', () => {
    const plain = generateSurface('cube', 2, 1);
    const same = runSync(generateSurfaceWithin('cube', 2, 1, { maxWalls: 99, tries: 5 }));
    eq(serializeSurface(same.puzzle), serializeSurface(plain.puzzle));
    eq([same.attempts, same.hit], [1, true]);
    const none = runSync(generateSurfaceWithin('cube', 2, 1, { maxWalls: 0, tries: 3, K: 4 }));
    eq([none.attempts, none.hit], [3, false]);
    const walls = [0, 1, 2].map(i => generateSurface('cube', 2, 1 + i, { K: 4 }).walls);
    eq(none.walls, Math.min(...walls), 'the one with the fewest walls');
    const flat = { maxWalls: 0, tries: 20, K: 5 };
    const reached = runSync(generateSurfaceWithin('tetra', 3, 3, flat));
    eq([reached.hit, reached.walls], [true, 0]);
    eq(runSync(generateSurfaceWithin('tetra', 3, 1)).attempts, 1, 'one try by default');
  });

  t('surface minimize: takes unneeded walls away, stays unique, every wall needed', () => {
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
    eq(solveSurface(loaded).count, 1);
    const events = [];
    const done = runSync(minimizeSurfaceWalls(loaded, makeRng(5), 50000), e => events.push(e));
    eq(done.removed + done.kept, top.E - g.path.length + 1);
    eq(events.length, done.removed + done.kept);
    eq(solveSurface(loaded).count, 1, 'still unique');
    eq(wallEdges(loaded).length, done.kept);
    for (const edge of wallEdges(loaded)) {
      const without = cloneSurfacePuzzle(loaded);
      without.walls[edge] = 0;
      eq(solveSurface(without).count, 2, `wall ${edge} is needed`);
    }
    const capped = cloneSurfacePuzzle(g.puzzle);
    const tight = runSync(minimizeSurfaceWalls(loaded, makeRng(5), 1));
    eq(tight.removed, 0, 'a check that hits the cap keeps the wall');
    eq(tight.undecided, tight.kept);
    eq(capped.walls.length, g.puzzle.walls.length);
  });

  t('surface net: every cell has its sides of one length, no two cells overlap', () => {
    for (const [kind, sizes] of [['tetra', [1, 2, 3, 4, 5]], ['cube', [1, 2, 3, 4]]]) {
      for (const n of sizes) {
        const top = surfaceTopology(kind, n);
        const net = buildNet(top);
        eq(buildNet(top), net, 'cached');
        for (let cell = 0; cell < top.T; cell++) {
          const poly = net.polys[cell];
          eq(poly.length, top.deg[cell]);
          for (let k = 0; k < poly.length; k++) {
            const [a, b] = [poly[k], poly[(k + 1) % poly.length]];
            const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
            ok(Math.abs(length - net.side) < 1e-9, `${kind} ${n} side`);
          }
          eq(cellAt(net, ...net.centers[cell]), cell, `${kind} ${n}: centre of ${cell}`);
        }
      }
    }
  });

  t('surface net: the cuts, their letters, and sides glued the same from both cells', () => {
    const cases = [['tetra', 3, 3], ['tetra', 5, 3], ['cube', 2, 7], ['cube', 4, 7]];
    for (const [kind, n, cuts] of cases) {
      const top = surfaceTopology(kind, n);
      const net = buildNet(top);
      eq(net.cuts.length, cuts, `${kind} ${n} cuts`);
      eq(net.cuts.map(c => c.letter), [...'ABCDEFG'].slice(0, cuts));
      for (const cut of net.cuts) {
        eq(cut.copies.size, 2, 'two copies of a cut');
        for (const sides of cut.copies.values()) {
          eq(sides.length, n, `${kind} ${n} ${cut.letter}: n sides per copy`);
        }
      }
      eq(net.tags.length, 2 * cuts);
      let unglued = 0;
      for (let cell = 0; cell < top.T; cell++) {
        for (let k = 0; k < top.deg[cell]; k++) {
          const other = top.nb[cell * SLOTS + k];
          const back = top.rev[cell * SLOTS + k];
          eq(net.glued[cell * SLOTS + k], net.glued[other * SLOTS + back], 'both cells agree');
          unglued += net.glued[cell * SLOTS + k] ? 0 : 1;
        }
      }
      eq(unglued, 2 * n * cuts);
    }
  });

  t('surface net: pickSide gives the side nearest to a point in the cell', () => {
    for (const [kind, n] of [['tetra', 3], ['cube', 3]]) {
      const top = surfaceTopology(kind, n);
      const net = buildNet(top);
      for (let cell = 0; cell < top.T; cell++) {
        for (let k = 0; k < top.deg[cell]; k++) {
          const poly = net.polys[cell];
          const [a, b] = [poly[k], poly[(k + 1) % poly.length]];
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const [cx, cy] = net.centers[cell];
          const point = [mid[0] + (cx - mid[0]) * 0.2, mid[1] + (cy - mid[1]) * 0.2];
          eq(pickSide(net, cell, ...point), k, `${kind} cell ${cell} side ${k}`);
        }
      }
    }
  });

  t('surface net: a route is one line beside the fold and two stubs over a cut', () => {
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
    eq(routePieces(net, glued), [[net.centers[glued[0]], net.centers[glued[1]]]]);
    const pieces = routePieces(net, cut);
    eq(pieces.length, 2);
    eq(pieces[0][0], net.centers[cut[0]]);
    eq(pieces[1][1], net.centers[cut[1]]);
    const slot = slotBetween(top, cut[0], cut[1]);
    const side = [net.polys[cut[0]][slot], net.polys[cut[0]][(slot + 1) % 4]];
    eq(pieces[0][1], [(side[0][0] + side[1][0]) / 2, (side[0][1] + side[1][1]) / 2]);
    eq(routePieces(net, [5]), [[net.centers[5]]]);
    eq(routePieces(net, []), []);
    eq(slotBetween(top, 0, 53), -1);
  });

  t('surface net: crossings of a route give an out and an in mark with the cut letter', () => {
    const top = surfaceTopology('cube', 3);
    const net = buildNet(top);
    for (let cell = 0; cell < top.T; cell++) {
      for (let k = 0; k < 4; k++) {
        const letter = net.letterAt.get(cell * SLOTS + k);
        eq(letter === undefined, net.glued[cell * SLOTS + k] === 1, 'a letter on every cut side');
        if (letter !== undefined) {
          const other = top.nb[cell * SLOTS + k];
          const back = top.rev[cell * SLOTS + k];
          eq(net.letterAt.get(other * SLOTS + back), letter, 'same both ways');
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
    eq(routeCrossings(net, glued), [], 'no mark beside a fold');
    eq(routeCrossings(net, [cut[0]]), []);
    const marks = routeCrossings(net, cut);
    const slot = slotBetween(top, cut[0], cut[1]);
    eq(marks.map(m => m.kind), ['out', 'in']);
    eq(marks[0], { kind: 'out', cell: cut[0], slot, letter: net.letterAt.get(cut[0] * SLOTS + slot) });
    eq(marks[1].cell, cut[1]);
    eq(marks[1].slot, top.rev[cut[0] * SLOTS + slot]);
    eq(marks[1].letter, marks[0].letter);
    const hidden = { ...net, hidden: top.faceOf.map(face => face === top.faceOf[cut[1]]) };
    eq(routeCrossings(hidden, cut).map(m => m.kind), ['out'], 'a hidden cell has no mark');
    eq(routePieces(hidden, cut).length, 1, 'and no piece');
    eq(routePieces(hidden, [cut[1], cut[0]]).length, 1);
    eq(routePieces(hidden, [cut[1], cut[1]]), [], 'nothing of cells that are all hidden');
  });

  t('proj: turns stay rotations; a drag turns the front its way; turnToward faces', () => {
    const right = turn(orbit(IDENTITY, 0.3, 0), [0, 0, 1]);
    ok(right[0] > 0.29 && Math.abs(right[1]) < 1e-12, 'drag right: the front goes right');
    const down = turn(orbit(IDENTITY, 0, 0.3), [0, 0, 1]);
    ok(down[1] < -0.29 && Math.abs(down[0]) < 1e-12, 'drag down: the front goes down');
    const rnd = makeRng(3);
    let R = IDENTITY;
    for (let i = 0; i < 500; i++) {
      R = orbit(R, rnd() - 0.5, rnd() - 0.5);
    }
    const rows = [R.slice(0, 3), R.slice(3, 6), R.slice(6, 9)];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    rows.forEach((a, i) => rows.forEach((b, j) => {
      ok(Math.abs(dot(a, b) - (i === j ? 1 : 0)) < 1e-9, `rows ${i} ${j} orthonormal`);
    }));
    const [a, b, c] = rows;
    const bc = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
    const triple = dot(a, bc);
    ok(Math.abs(triple - 1) < 1e-9, 'a rotation, not a mirror');
    const d = [1, 2, 3];
    const unit = v => v.map(x => x / Math.hypot(...v));
    const full = turnToward(R, d);
    ok(Math.abs(unit(turn(full, d))[2] - 1) < 1e-9, 'faces the viewer');
    const half = turnToward(R, d, 0.5);
    const angle = r => Math.acos(unit(turn(r, d))[2]);
    ok(Math.abs(angle(half) - angle(R) / 2) < 1e-9, 'half of the way');
    ok(turn(turnToward(IDENTITY, [0, 0, -1]), [0, 0, -1])[2] > 0.999, 'from the back');
    eq(turnToward(IDENTITY, [0, 0, 1]), IDENTITY, 'already facing');
  });

  t('proj: a mark lies in the plane of its cell, squeezed with it, as upright as possible', () => {
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cube = surfaceTopology('cube', 3);
    const front = turnToward(IDENTITY, cellDirection(cube, 4));
    ok(near(faceFrame(front, cube, 4), [1, 0, 0, 1]), 'facing the viewer: as flat');
    for (const [kind, n] of [['tetra', 3], ['cube', 3]]) {
      const top = surfaceTopology(kind, n);
      let R = overview(top);
      for (const turned of [[0, 0], [0.4, 0.2], [1.3, -0.5], [2.4, 0.9]]) {
        R = orbit(R, ...turned);
        const view = buildView(top, R);
        for (let cell = 0; cell < top.T; cell++) {
          if (view.hidden[cell]) {
            continue;
          }
          const [a, b, c, d] = view.frameOf(cell);
          ok(Math.abs(a * d - b * c - view.depth[cell]) < 1e-9, 'area seen = z of the normal');
          ok(d >= -1e-9, 'up does not point down the screen');
          // the two axes of the mark are unit vectors, at right angles, in the plane of the cell
          const normal = turn(R, cellNormal(top, cell));
          const right = [a, -b, -(normal[0] * a - normal[1] * b) / normal[2]];
          const up = [-c, d, -(-normal[0] * c + normal[1] * d) / normal[2]];
          ok(near([dot(right, right), dot(up, up), dot(right, up)], [1, 1, 0]), 'a true frame');
        }
      }
    }
  });

  t('proj view: three faces from a corner, counter-clockwise, the box never moves', () => {
    const area = poly => poly.reduce((sum, [x, y], i) => {
      const [nx, ny] = poly[(i + 1) % poly.length];
      return sum + (x * ny - nx * y) / 2;
    }, 0);
    for (const [kind, n] of [['tetra', 3], ['cube', 3], ['cube', 2]]) {
      const top = surfaceTopology(kind, n);
      const view = buildView(top, overview(top));
      eq(view.hidden.filter(h => !h).length, 3 * n * n, `${kind} ${n}: three faces`);
      for (let cell = 0; cell < top.T; cell++) {
        const turned = view.hidden[cell] || area(view.polys[cell]) > 0;
        ok(turned, `${kind} ${n}: ${cell} counter-clockwise`);
        ok(view.depth[cell] > -0.05 || area(view.polys[cell]) < 0, `${kind} ${n}: ${cell} behind`);
      }
      eq(buildView(top, orbit(overview(top), 0.7, 0.4)).box, view.box);
      eq(view.maxSidePx, Infinity);
      eq(view.cuts, []);
      eq(facing(turnToward(overview(top), cellDirection(top, 5)), top, 5) > 0.999, true);
    }
  });

  t('proj view: a route is drawn where seen, with marks where it goes behind and returns', () => {
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
    ok(outs + ins > 0, 'the route goes behind');
    eq(marks.filter(m => m.kind === 'out').length, outs);
    eq(marks.filter(m => m.kind === 'in').length, ins);
    eq(routePieces(view, g.path).length, runs, 'one piece per run of seen cells');
    ok(marks.every(m => m.letter === '' && !view.hidden[m.cell]), 'no letters, seen cells');
  });

  t('surface board: the solid shows the cells that are seen, shaded by face, without cuts', () => {
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
    eq((markup.match(/<polygon class="sf-cell/g) || []).length, seen);
    ok(!/sf-cut|sf-tag/.test(markup), 'no cuts, no letters');
    eq(new Set(markup.match(/fill="rgb\([^"]+\)"/g)).size, 3, 'a colour for each face seen');
    const numbered = g.puzzle.cp.filter((number, cell) => number && !view.hidden[cell]).length;
    eq((markup.match(/class="sf-badge/g) || []).length, numbered);
    eq((markup.match(/<g class="sf-badge[^>]* transform="matrix\(/g) || []).length, numbered);
    const flat = surfaceSvg(buildNet(top), state).markup;
    ok(!/transform=/.test(flat), 'the net has its numbers flat');
    const head = { ...state, playing: true, path: [g.path.find(cell => !view.hidden[cell])] };
    ok(/class="sf-head"[^>]* transform="matrix\(/.test(surfaceSvg(view, head).markup), 'the head');
    const turned = surfaceSvg(buildView(top, orbit(overview(top), 1, 1)), state).frame;
    eq([turned.width, turned.height], [frame.width, frame.height], 'the picture keeps its size');
  });

  t('surface board: a polygon per cell, walls on both copies of a cut, the letters', () => {
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
    eq((markup.match(/<polygon class="sf-cell/g) || []).length, 24);
    eq((markup.match(/class="sf-badge/g) || []).length, g.K);
    eq((markup.match(/class="sf-tag"/g) || []).length, 14);
    for (const letter of 'ABCDEFG') {
      const tag = new RegExp(`class="sf-tag"><circle[^>]*/><text[^>]*>${letter}</text>`, 'g');
      eq((markup.match(tag) || []).length, 2, letter);
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
    eq((markup.match(/class="sf-wall"/g) || []).length, expected);
    ok(expected > wallEdges(g.puzzle).length - 1, 'a wall on a cut is drawn twice');
    ok(/class="sf-path"/.test(markup));
    const crossings = routeCrossings(net, g.path).length;
    ok(crossings > 0, 'the path crosses a cut');
    eq((markup.match(/class="sf-arrow"/g) || []).length, 2 * crossings, 'template and solution');
    eq((markup.match(/class="sf-cross"/g) || []).length, 2 * crossings, 'a letter beside each');
    const play = surfaceSvg(net, { ...view, playing: true, path: g.path.slice(0, 3) }).markup;
    ok(!/stroke-dasharray/.test(play), 'no template while playing');
    eq((play.match(/class="sf-cell[^"]* visited"/g) || []).length, 3);
    ok(/class="sf-head"/.test(play));
    const early = routeCrossings(net, g.path.slice(0, 3)).length;
    eq((play.match(/class="sf-arrow"/g) || []).length, early);
    const [x, y] = frame.toPixels([net.box.minX, net.box.maxY]);
    const [nx, ny] = frame.toNet(x, y);
    ok(Math.abs(nx - net.box.minX) < 0.05 && Math.abs(ny - net.box.maxY) < 0.05, 'toNet inverts');
    ok(netFrame(net).width > 0);
  });
}
