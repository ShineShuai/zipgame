// Generator for puzzles on a closed surface (see puzzle.js). Same recipe as the flat board:
//   1. a random Hamiltonian path of the board is the intended solution
//   2. K numbers are laid along it: 1 on the first cell, K on the last, the rest spread at random
//   3. every side the path does not use is closed (a wall), which makes the solution unique
//   4. walls are taken away again, in random order, while the solution stays the only one
// What is left is a puzzle with a unique solution and few walls. The fewer numbers, the more
// walls are needed; K is the knob (defaultK gives a starting point).
import { makeRng, shuffle } from '../rng.js';
import { runSync } from '../run.js';
import { SLOTS, PENTAGON_KIND, surfaceTopology } from './topology.js';
import { makeSurfacePuzzle, wallCount, wallEdges } from './puzzle.js';
import { makeLinker, openSlots, solveSurface } from './solve.js';

export const GEN_CFG = {
  pathNodeCap: 20000, // steps one try of the path search may take before it starts over
  pathTries: 200,
  // Steps one uniqueness check may take; a capped check counts as "not unique".
  checkNodeCap: 50000,
};

// Roughly the share of the cells that carry a number: tetra needs fewer than a cube, whose
// numbers would otherwise have to be replaced by walls. A ball is like a tetra: its cells have
// 3 to 5 neighbours, and the many triangles force the path by themselves. A Pentagon cell has 5
// neighbours, one more than a square: it takes 40% of the cells to keep the walls few.
export const defaultK = (kind, n) => {
  const cells = surfaceTopology(kind, n).T;
  const share = kind === 'cube' ? 0.15 : kind === PENTAGON_KIND ? 0.4 : 0.2;
  return Math.max(3, Math.round(cells * share));
};

// A random Hamiltonian path (list of cells), or null when none was found within the budget.
// Depth-first, with the dead-end and connectivity prunes of solve.js done incrementally (see its
// header): free[x] is the number of sides of an unvisited cell x that lead to an unvisited cell or
// to the head, singles the number of unvisited cells with a single one (at most one may end the
// path), and a step only changes the cells next to the cell the head leaves.
export function randomHamiltonianPath(top, rnd, cfg = GEN_CFG) {
  const { T, nb, deg } = top;
  const open = openSlots(top, null);
  const vis = new Uint8Array(T);
  const linked = makeLinker(top, open, vis);
  const free = new Int32Array(T);
  let singles = 0;
  const path = [];
  let nodes = 0;
  const bump = (cell, by) => {
    if (free[cell] === 1) {
      singles--;
    }
    free[cell] += by;
    if (free[cell] === 1) {
      singles++;
    }
  };
  // The head leaves `from` for a cell that is visited now: false when an unvisited cell is cut
  // off, or when two are left with a single side. Take back with giveBack().
  const takeAway = from => {
    let alive = true;
    for (let k = 0; k < SLOTS; k++) {
      const cell = nb[from * SLOTS + k];
      if (open[from * SLOTS + k] && !vis[cell]) {
        bump(cell, -1);
        if (free[cell] === 0) {
          alive = false;
        }
      }
    }
    return alive && singles <= 1;
  };
  const giveBack = from => {
    for (let k = 0; k < SLOTS; k++) {
      const cell = nb[from * SLOTS + k];
      if (open[from * SLOTS + k] && !vis[cell]) {
        bump(cell, 1);
      }
    }
  };
  const extend = head => {
    if (path.length === T) {
      return true;
    }
    if (++nodes > cfg.pathNodeCap) {
      return false;
    }
    const around = [];
    for (let k = 0; k < deg[head]; k++) {
      if (nb[head * SLOTS + k] >= 0) {
        around.push(nb[head * SLOTS + k]);
      }
    }
    for (const cell of shuffle(around, rnd)) {
      if (vis[cell]) {
        continue;
      }
      vis[cell] = 1;
      path.push(cell);
      if (free[cell] === 1) {
        singles--;
      }
      let found = path.length === T;
      if (!found) {
        const alive = takeAway(head);
        found = alive && linked(head, cell) && extend(cell);
        if (!found) {
          giveBack(head);
        }
      }
      if (found) {
        return true;
      }
      if (free[cell] === 1) {
        singles++;
      }
      path.pop();
      vis[cell] = 0;
      if (nodes > cfg.pathNodeCap) {
        return false;
      }
    }
    return false;
  };
  for (let attempt = 0; attempt < cfg.pathTries; attempt++) {
    vis.fill(0);
    path.length = 0;
    nodes = 0;
    singles = 0;
    for (let cell = 0; cell < T; cell++) {
      free[cell] = 0;
      for (let k = 0; k < SLOTS; k++) {
        free[cell] += open[cell * SLOTS + k];
      }
      if (free[cell] === 1) {
        singles++;
      }
    }
    const first = Math.floor(rnd() * T);
    vis[first] = 1;
    if (free[first] === 1) {
      singles--;
    }
    path.push(first);
    if (extend(first)) {
      return path.slice();
    }
  }
  return null;
}

// Numbers 1..K along the path: the first cell, the last cell and K - 2 random ones between.
export function numberAlongPath(p, path, K, rnd) {
  const between = [];
  for (let i = 1; i < path.length - 1; i++) {
    between.push(i);
  }
  const chosen = shuffle(between, rnd).slice(0, K - 2);
  const positions = [0, ...chosen.sort((a, b) => a - b), path.length - 1];
  positions.forEach((position, i) => {
    p.cp[path[position]] = i + 1;
  });
}

// Takes walls away from a uniquely solvable puzzle, in random order, as long as the solution stays
// the only one (a check that hits the node cap counts as "not unique": the wall stays).
// A generator: it yields { phase: 'walls', done, total } after every wall.
// Returns { removed, kept, undecided }: undecided = walls kept only because their check was capped
// (not proven necessary).
export function* minimizeSurfaceWalls(puzzle, rnd, nodeCap, attempt = 1) {
  const walls = shuffle(wallEdges(puzzle), rnd);
  let removed = 0;
  let undecided = 0;
  for (let i = 0; i < walls.length; i++) {
    puzzle.walls[walls[i]] = 0;
    const result = solveSurface(puzzle, { limit: 2, nodeCap });
    if (!result.capped && result.count === 1) {
      removed++;
    } else {
      puzzle.walls[walls[i]] = 1;
      if (result.capped) {
        undecided++;
      }
    }
    yield { phase: 'walls', done: i + 1, total: walls.length, attempt };
  }
  return { removed, kept: walls.length - removed, undecided };
}

// The steps of generateSurface (below) as a generator, for the time-sliced runner of the apps:
// it yields progress objects, { phase: 'path' } and then { phase: 'walls', done, total }.
// Returns { puzzle, path, K, walls, nodes, undecided } or throws when no Hamiltonian path was
// found. `nodes` is the cost of proving the final puzzle unique: the difficulty measure.
export function* generateSurfaceSteps(kind, n, seed, opts = {}) {
  const cfg = { ...GEN_CFG, ...opts.cfg };
  const attempt = opts.attempt ?? 1;
  const top = surfaceTopology(kind, n);
  const rnd = makeRng(seed);
  yield { phase: 'path', attempt };
  const path = randomHamiltonianPath(top, rnd, cfg);
  if (!path) {
    throw new Error(`no Hamiltonian path found for ${kind} ${n} (seed ${seed})`);
  }
  const K = Math.min(opts.K ?? defaultK(kind, n), top.T);
  const puzzle = makeSurfacePuzzle(kind, n);
  numberAlongPath(puzzle, path, K, rnd);
  const used = new Uint8Array(top.E);
  for (let i = 0; i + 1 < path.length; i++) {
    for (let k = 0; k < top.deg[path[i]]; k++) {
      if (top.nb[path[i] * SLOTS + k] === path[i + 1]) {
        used[top.edgeAt[path[i] * SLOTS + k]] = 1;
      }
    }
  }
  for (let edge = 0; edge < top.E; edge++) {
    puzzle.walls[edge] = used[edge] ? 0 : 1;
  }
  const { undecided } = yield* minimizeSurfaceWalls(puzzle, rnd, cfg.checkNodeCap, attempt);
  const final = solveSurface(puzzle, { limit: 2, nodeCap: 0 });
  return { puzzle, path, K, walls: wallCount(puzzle), nodes: final.nodes, undecided };
}

// Up to opts.tries puzzles (seeds seed, seed + 1, ...) until one needs at most opts.maxWalls
// walls; when none does, the one with the fewest. Returns that result of generateSurfaceSteps plus
// { attempts, hit }: the puzzles made, and whether the wall limit was met.
export function* generateSurfaceWithin(kind, n, seed, opts = {}) {
  const tries = Math.max(1, opts.tries ?? 1);
  const maxWalls = opts.maxWalls ?? Infinity;
  let best = null;
  let attempts = 0;
  while (attempts < tries) {
    const made = yield* generateSurfaceSteps(kind, n, (seed + attempts) >>> 0, {
      ...opts,
      attempt: attempts + 1,
    });
    attempts++;
    if (!best || made.walls < best.walls) {
      best = made;
    }
    if (made.walls <= maxWalls) {
      break;
    }
  }
  return { ...best, attempts, hit: best.walls <= maxWalls };
}

// Returns { puzzle, path, K, walls, nodes, undecided } or throws when no Hamiltonian path was
// found.
export const generateSurface = (kind, n, seed, opts = {}) =>
  runSync(generateSurfaceSteps(kind, n, seed, opts));
