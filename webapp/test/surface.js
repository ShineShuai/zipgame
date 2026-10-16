// Tests of the closed-surface boards (tetrahedron and cube): the graph (core/surface/topology.js),
// the puzzle model, rules and text format (puzzle.js), the solver (solve.js, checked against a
// plain brute-force search and against path counts computed with an independent C++ program) and
// the generator (gen.js). Registered by tests.js: surfaceTests(t, ok, eq).
// Set SURFACE_SLOW=1 for the oracle counts that take several seconds.
import {
  surfaceTopology,
  edgeBetween,
  cellCentroid,
  SURFACE_KINDS,
  SURFACE_SIZES,
  SLOTS,
} from '../src/core/surface/topology.js';
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
} from '../src/core/surface/puzzle.js';
import {
  solveSurface,
  countHamiltonianPaths,
  makePrunes,
  openSlots,
} from '../src/core/surface/solve.js';
import {
  generateSurface,
  randomHamiltonianPath,
  numberAlongPath,
  defaultK,
  GEN_CFG,
} from '../src/core/surface/gen.js';
import { makeRng, shuffle } from '../src/core/rng.js';

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
  const top = surfaceTopology(p.surface, p.n);
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
    for (const kind of SURFACE_KINDS) {
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
    for (const kind of SURFACE_KINDS) {
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
    for (const kind of SURFACE_KINDS) {
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
    for (const kind of SURFACE_KINDS) {
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
    eq(back.surface, 'tetra');
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
    for (const kind of SURFACE_KINDS) {
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

  t('surface generator: pinned puzzles (change only with a deliberate generator change)', () => {
    const tetra = generateSurface('tetra', 3, 1);
    eq(
      serializeSurface(tetra.puzzle, { path: tetra.path }),
      'surface tetra 3\ncheckpoints 8=1 11=2 26=3 6=4 3=5 16=6 15=7\n' +
        'path 8 17 31 30 29 14 10 11 20 21 25 2 1 0 35 26 24 23 19 18 9 27 28 32 33 34 5 6 7 3 ' +
        '4 22 13 12 16 15\n',
    );
    eq(tetra.nodes, 394);
    const cube = generateSurface('cube', 2, 1);
    eq(
      serializeSurface(cube.puzzle, { path: cube.path }),
      'surface cube 2\ncheckpoints 5=1 1=2 14=3 4=4\nwalls 4,9,14,17,20,23,27,35,42\n' +
        'path 5 16 17 7 6 21 20 22 13 0 2 23 9 8 10 11 3 19 18 1 15 14 12 4\n',
    );
    eq(cube.nodes, 153);
  });
}
