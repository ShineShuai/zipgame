// Tests of the fast solver and path search of core/surface (solve.js, gen.js): they must give what
// the plain versions give. The plain solver and path search of v0.14.0 (full scans after every
// step, no narrowing of the graph) are kept here as the oracle. Registered by tests.js:
// surfaceFastTests(t, ok, eq).
import { makeRng, shuffle } from '../src/core/rng.js';
import { SLOTS, surfaceTopology } from '../src/core/surface/topology.js';
import { topologyOf, maxNumber, makeSurfacePuzzle } from '../src/core/surface/puzzle.js';
import {
  solveSurface, narrowOpen, openSlots, makePrunes,
} from '../src/core/surface/solve.js';
import { generateSurface, randomHamiltonianPath, GEN_CFG } from '../src/core/surface/gen.js';

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
  const feasible = (head, remaining, next) => remaining === 0 || (
    dist[head * T + cellOf[next]] + tail[next] <= remaining
    && prunes.deadEnds(vis, head, end) && prunes.connected(vis, head, remaining));
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
  ['pentagon', 4], ['pentagon', 6], ['tetra', 3], ['cube', 3], ['ball', 'snub-cube'],
];

// The puzzle with some of its numbers and walls taken away (several solutions, a real search).
function relaxed(p, rnd, keepShare) {
  const q = { ...p, cp: p.cp.slice(), walls: p.walls.slice() };
  const cells = [];
  q.cp.forEach((number, cell) => {
    if (number) cells[number - 1] = cell;
  });
  const kept = cells.filter((cell, i) => i === 0 || i === cells.length - 1 || rnd() < keepShare);
  q.cp.fill(0);
  kept.forEach((cell, i) => {
    q.cp[cell] = i + 1;
  });
  q.walls.forEach((wall, edge) => {
    if (wall && rnd() < 0.5) q.walls[edge] = 0;
  });
  return q;
}

export function surfaceFastTests(t, ok, eq) {
  t('surface-fast: the solver gives the solutions of the plain solver, with no more nodes, on '
    + 'puzzles as made and with numbers and walls taken away', () => {
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
          ok(!fast.capped, `${label}: not capped`);
          eq([fast.count, fast.path, fast.second], [plain.count, plain.path, plain.second], label);
          ok(fast.nodes <= plain.nodes, `${label}: ${fast.nodes} <= ${plain.nodes} nodes`);
          saved += plain.nodes - fast.nodes;
        });
      }
    }
    ok(saved > 0, 'the narrowing saves nodes somewhere');
  });

  t('surface-fast: narrowOpen closes only sides that no solution uses, and says so when the '
    + 'puzzle has none', () => {
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
        ok(narrowOpen(top, open, made.puzzle.cp, cells[1], cells[K]), 'a puzzle with a solution');
        closed += before - open.reduce((sum, v) => sum + v, 0);
        for (let i = 1; i < made.path.length; i++) {
          const a = made.path[i - 1];
          const slot = [...Array(SLOTS).keys()].find(k => top.nb[a * SLOTS + k] === made.path[i]);
          const side = `${a}-${made.path[i]}`;
          ok(open[a * SLOTS + slot] === 1, `${kind} ${n}: the solution keeps its side ${side}`);
        }
      }
    }
    ok(closed > 0, 'sides were closed');
    // no solution: numbers 1 and 2 on cells that are not neighbours and a cell cut off by walls
    const p = makeSurfacePuzzle('pentagon', 4);
    const top = topologyOf(p);
    p.cp[0] = 1;
    p.cp[1] = 2;
    for (let k = 0; k < SLOTS; k++) {
      const edge = top.edgeAt[5 * SLOTS + k];
      if (edge >= 0) p.walls[edge] = 1;
    }
    eq(solveSurface(p).count, 0, 'a cell with every side walled has no path');
  });

  t('surface-fast: the path search gives the paths of the plain search, seed for seed', () => {
    for (const [kind, n] of [...BOARDS, ['pentagon', 8], ['cube', 4]]) {
      const top = surfaceTopology(kind, n);
      for (let seed = 1; seed <= 6; seed++) {
        const a = plainPath(top, makeRng(seed));
        const b = randomHamiltonianPath(top, makeRng(seed));
        eq(b, a, `${kind} ${n} seed ${seed}`);
        ok(b === null || new Set(b).size === top.T, 'every cell once');
      }
    }
  });
}
