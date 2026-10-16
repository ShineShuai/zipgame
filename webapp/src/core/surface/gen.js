// Generator for puzzles on a closed surface (see puzzle.js). Same recipe as the flat board:
//   1. a random Hamiltonian path of the board is the intended solution
//   2. K numbers are laid along it: 1 on the first cell, K on the last, the rest spread at random
//   3. every side the path does not use is closed (a wall), which makes the solution unique
//   4. walls are taken away again, in random order, while the solution stays the only one
// What is left is a puzzle with a unique solution and few walls. The fewer numbers, the more
// walls are needed; K is the knob (defaultK gives a starting point).
import { makeRng, shuffle } from '../rng.js';
import { SLOTS, surfaceTopology } from './topology.js';
import { makeSurfacePuzzle, wallCount } from './puzzle.js';
import { makePrunes, openSlots, solveSurface } from './solve.js';

export const GEN_CFG = {
  pathNodeCap: 20000, // steps one try of the path search may take before it starts over
  pathTries: 200,
  // Steps one uniqueness check may take; a capped check counts as "not unique".
  checkNodeCap: 50000,
};

// Roughly the share of the cells that carry a number: tetra needs fewer than a cube, whose
// numbers would otherwise have to be replaced by walls.
export const defaultK = (kind, n) => {
  const cells = surfaceTopology(kind, n).T;
  const share = kind === 'tetra' ? 0.2 : 0.15;
  return Math.max(3, Math.round(cells * share));
};

// A random Hamiltonian path (list of cells), or null when none was found within the budget.
export function randomHamiltonianPath(top, rnd, cfg = GEN_CFG) {
  const { T, nb, deg } = top;
  const prunes = makePrunes(top, openSlots(top, null));
  const vis = new Uint8Array(T);
  const path = [];
  let nodes = 0;
  const extend = head => {
    if (path.length === T) {
      return true;
    }
    if (++nodes > cfg.pathNodeCap) {
      return false;
    }
    const around = [];
    for (let k = 0; k < deg[head]; k++) {
      around.push(nb[head * SLOTS + k]);
    }
    for (const cell of shuffle(around, rnd)) {
      if (vis[cell]) {
        continue;
      }
      vis[cell] = 1;
      path.push(cell);
      const left = T - path.length;
      if (prunes.deadEnds(vis, cell, -1) && prunes.connected(vis, cell, left) && extend(cell)) {
        return true;
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
    const first = Math.floor(rnd() * T);
    vis[first] = 1;
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

const isUnique = (p, nodeCap) => {
  const result = solveSurface(p, { limit: 2, nodeCap });
  return !result.capped && result.count === 1;
};

// Returns { puzzle, path, K, walls, nodes } or throws when no Hamiltonian path was found.
// `nodes` is the cost of proving the final puzzle unique: the difficulty measure.
export function generateSurface(kind, n, seed, opts = {}) {
  const cfg = { ...GEN_CFG, ...opts.cfg };
  const top = surfaceTopology(kind, n);
  const rnd = makeRng(seed);
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
  const unused = [];
  for (let edge = 0; edge < top.E; edge++) {
    if (!used[edge]) {
      unused.push(edge);
      puzzle.walls[edge] = 1;
    }
  }
  for (const edge of shuffle(unused, rnd)) {
    puzzle.walls[edge] = 0;
    if (!isUnique(puzzle, cfg.checkNodeCap)) {
      puzzle.walls[edge] = 1;
    }
  }
  const final = solveSurface(puzzle, { limit: 2, nodeCap: 0 });
  return { puzzle, path, K, walls: wallCount(puzzle), nodes: final.nodes };
}
