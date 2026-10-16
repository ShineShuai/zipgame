// Solver for puzzles on a closed surface (puzzle.js): depth-first search over the cell graph that
// counts solutions up to a limit. The flat-board solvers cannot be used here: they pair the
// sides of a cell as d and d ^ 1, which no consistent labelling of a cube's sides allows.
//
// Prunes, after every step (head = the cell just entered):
//   dead ends     an unvisited cell with no free neighbour is cut off, and one with a single
//                 free neighbour can only be the last cell of the path
//   connectivity  all unvisited cells must still be reachable from the head
//   distance      the steps left must reach the next number and then every later number
//                 (graph distances ignore walls, so this never rejects a real solution)
// Both boards are non-bipartite, so there is no parity prune (the flat boards have one).
import { SLOTS } from './topology.js';
import { topologyOf, maxNumber, validateSurface } from './puzzle.js';

// 1 for every slot that leads to a neighbour through an open side.
export function openSlots(top, walls) {
  const open = new Uint8Array(top.T * SLOTS);
  for (let cell = 0; cell < top.T; cell++) {
    for (let k = 0; k < top.deg[cell]; k++) {
      const edge = top.edgeAt[cell * SLOTS + k];
      open[cell * SLOTS + k] = walls && walls[edge] ? 0 : 1;
    }
  }
  return open;
}

// The dead-end and connectivity checks, with their scratch buffers allocated once.
// vis[cell] = 1 for the cells on the path so far; head is the last of them.
export function makePrunes(top, open) {
  const { T, nb } = top;
  const seen = new Int32Array(T);
  const stack = new Int32Array(T);
  let stamp = 0;
  return {
    // end >= 0: only that cell may have a single free neighbour. end < 0 (the path may end
    // anywhere): at most one cell may.
    deadEnds(vis, head, end) {
      let singles = 0;
      for (let cell = 0; cell < T; cell++) {
        if (vis[cell]) {
          continue;
        }
        let free = 0;
        for (let k = 0; k < SLOTS; k++) {
          if (!open[cell * SLOTS + k]) {
            continue;
          }
          const other = nb[cell * SLOTS + k];
          if (!vis[other] || other === head) {
            free++;
          }
        }
        if (free === 0) {
          return false;
        }
        if (free === 1) {
          if (end >= 0 ? cell !== end : ++singles > 1) {
            return false;
          }
        }
      }
      return true;
    },
    connected(vis, head, remaining) {
      stamp++;
      let top_ = 0;
      let reached = 0;
      stack[top_++] = head;
      seen[head] = stamp;
      while (top_ > 0) {
        const cell = stack[--top_];
        for (let k = 0; k < SLOTS; k++) {
          if (!open[cell * SLOTS + k]) {
            continue;
          }
          const other = nb[cell * SLOTS + k];
          if (!vis[other] && seen[other] !== stamp) {
            seen[other] = stamp;
            reached++;
            stack[top_++] = other;
          }
        }
      }
      return reached === remaining;
    },
  };
}

// Solves p, stopping after opts.limit solutions (default 2: enough to tell unique from not) or
// when more than opts.nodeCap steps were tried (0 = no cap).
// Returns { count, path, second, nodes, capped }: path and second are the first two solutions as
// cell lists; with capped the count is only a lower bound.
export function solveSurface(p, opts = {}) {
  const limit = opts.limit ?? 2;
  const nodeCap = opts.nodeCap ?? 0;
  const checked = validateSurface(p);
  if (!checked.ok) {
    throw new Error(checked.msg);
  }
  const top = topologyOf(p);
  const { T, nb, deg, dist } = top;
  const open = openSlots(top, p.walls);
  const K = maxNumber(p);
  const cellOf = new Int32Array(K + 2).fill(-1);
  for (let cell = 0; cell < T; cell++) {
    if (p.cp[cell]) {
      cellOf[p.cp[cell]] = cell;
    }
  }
  const start = cellOf[1];
  const end = cellOf[K];
  // tail[m]: the fewest steps from number m through all the later numbers.
  const tail = new Int32Array(K + 2);
  for (let m = K - 1; m >= 1; m--) {
    tail[m] = tail[m + 1] + dist[cellOf[m] * T + cellOf[m + 1]];
  }
  const prunes = makePrunes(top, open);
  const vis = new Uint8Array(T);
  const path = new Int32Array(T);
  const solutions = [];
  let nodes = 0;
  let count = 0;
  let capped = false;

  const feasible = (head, remaining, next) => {
    if (remaining === 0) {
      return true;
    }
    if (dist[head * T + cellOf[next]] + tail[next] > remaining) {
      return false;
    }
    return prunes.deadEnds(vis, head, end) && prunes.connected(vis, head, remaining);
  };

  // depth cells are on the path, the last one is head, and number `next` is wanted next.
  const search = (head, depth, next) => {
    nodes++;
    if (nodeCap && nodes > nodeCap) {
      capped = true;
      return;
    }
    if (depth === T) {
      count++;
      if (solutions.length < 2) {
        solutions.push(Array.from(path));
      }
      return;
    }
    const remaining = T - depth;
    for (let k = 0; k < deg[head]; k++) {
      if (!open[head * SLOTS + k]) {
        continue;
      }
      const cell = nb[head * SLOTS + k];
      if (vis[cell]) {
        continue;
      }
      const number = p.cp[cell];
      let wanted = next;
      if (number) {
        if (number !== next || (number === K && remaining !== 1)) {
          continue;
        }
        wanted = next + 1;
      }
      vis[cell] = 1;
      path[depth] = cell;
      if (feasible(cell, remaining - 1, wanted)) {
        search(cell, depth + 1, wanted);
      }
      vis[cell] = 0;
      if (count >= limit || capped) {
        return;
      }
    }
  };

  vis[start] = 1;
  path[0] = start;
  if (feasible(start, T - 1, 2)) {
    search(start, 1, 2);
  }
  return {
    count,
    path: solutions[0] ?? null,
    second: solutions[1] ?? null,
    nodes,
    capped,
  };
}

// Counts every Hamiltonian path of the bare board (walls ignored, no numbers), each direction
// separately: the oracle numbers of the tests. Returns { count, nodes, capped }.
export function countHamiltonianPaths(top, opts = {}) {
  const nodeCap = opts.nodeCap ?? 0;
  const open = openSlots(top, null);
  const prunes = makePrunes(top, open);
  const { T, nb, deg } = top;
  const vis = new Uint8Array(T);
  let count = 0;
  let nodes = 0;
  let capped = false;
  const search = (head, remaining) => {
    nodes++;
    if (nodeCap && nodes > nodeCap) {
      capped = true;
      return;
    }
    if (remaining === 0) {
      count++;
      return;
    }
    for (let k = 0; k < deg[head]; k++) {
      const cell = nb[head * SLOTS + k];
      if (vis[cell]) {
        continue;
      }
      vis[cell] = 1;
      if (prunes.deadEnds(vis, cell, -1) && prunes.connected(vis, cell, remaining - 1)) {
        search(cell, remaining - 1);
      }
      vis[cell] = 0;
      if (capped) {
        return;
      }
    }
  };
  for (let start = 0; start < T && !capped; start++) {
    vis[start] = 1;
    if (prunes.deadEnds(vis, start, -1) && prunes.connected(vis, start, T - 1)) {
      search(start, T - 1);
    }
    vis[start] = 0;
  }
  return { count, nodes, capped };
}
