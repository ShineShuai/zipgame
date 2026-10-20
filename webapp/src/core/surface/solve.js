// Solver for puzzles on a cell graph (puzzle.js): depth-first search over the cell graph that
// counts solutions up to a limit. The flat-board solvers cannot be used here: they pair the
// sides of a cell as d and d ^ 1, which no consistent labelling of a cube's sides allows.
//
// Before the search, reasoning on the bare graph shrinks it (narrowOpen): no side between two
// numbered cells whose numbers are not consecutive can be used, an interior cell uses exactly two
// of its sides and the first and the last cell one, so a cell left with exactly that many open
// sides uses all of them, and a cell that has all it needs closes its other sides. The distances
// that the numbers need are measured on what is left.
//
// Prunes, after every step (head = the cell just entered):
//   dead ends     an unvisited cell with no free neighbour is cut off, and one with a single
//                 free neighbour can only be the last cell of the path
//   connectivity  all unvisited cells must still be reachable from the head
//   distance      the steps left must reach the next number and then every later number
//                 (distances ignore the path so far, so this never rejects a real solution)
// There is no parity prune here, as the boards are not bipartite in general (the square boards
// have one).
//
// The search does these checks incrementally, in the work of one step instead of one pass over the
// board (about a tenth of the time at 100 cells), and prunes exactly what the checks above prune:
//   free[x]       the open sides of an unvisited cell x that lead to an unvisited cell or to the
//                 head. A step from h to c takes h off the head: only the unvisited neighbours of
//                 h lose one, so only they can become a dead end.
//   connectivity  every unvisited cell was reachable from h before the step. After it, a
//                 component of the unvisited cells that is not reached from c touches a neighbour
//                 of h (it was joined to the rest through h), so it is enough to flood from c
//                 until all unvisited neighbours of h are found.
import { SLOTS } from './topology.js';
import { topologyOf, maxNumber, validateSurface } from './puzzle.js';

// Distance to a cell that cannot be reached.
const UNREACHED = 65535;

// 1 for every slot that leads to a neighbour through an open side (a side on the border of a flat
// board has no edge and no neighbour: closed).
export function openSlots(top, walls) {
  const open = new Uint8Array(top.T * SLOTS);
  for (let cell = 0; cell < top.T; cell++) {
    for (let k = 0; k < top.deg[cell]; k++) {
      const edge = top.edgeAt[cell * SLOTS + k];
      open[cell * SLOTS + k] = edge >= 0 && !(walls && walls[edge]) ? 1 : 0;
    }
  }
  return open;
}

// Whether every unvisited cell next to `from` can still be reached from `head` after the step from
// `from` to `head` (which is visited by then): all that is left of the connectivity check once it
// held before the step (see the header). vis[cell] = 1 for the cells on the path.
export function makeLinker(top, open, vis) {
  const { T, nb } = top;
  const seen = new Int32Array(T);
  const goal = new Int32Array(T);
  const stack = new Int32Array(T);
  let stamp = 0;
  return (from, head) => {
    stamp++;
    let need = 0;
    for (let k = 0; k < SLOTS; k++) {
      if (open[from * SLOTS + k] && !vis[nb[from * SLOTS + k]]) {
        goal[nb[from * SLOTS + k]] = stamp;
        need++;
      }
    }
    if (need === 0) {
      return true;
    }
    let top_ = 0;
    stack[top_++] = head;
    seen[head] = stamp;
    while (top_ > 0) {
      const cell = stack[--top_];
      for (let k = 0; k < SLOTS; k++) {
        if (!open[cell * SLOTS + k]) {
          continue;
        }
        const other = nb[cell * SLOTS + k];
        if (vis[other] || seen[other] === stamp) {
          continue;
        }
        seen[other] = stamp;
        if (goal[other] === stamp && --need === 0) {
          return true;
        }
        stack[top_++] = other;
      }
    }
    return false;
  };
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

// Closes the sides no solution can use and returns false when none exists (then `open` is only
// partly narrowed). open: openSlots() of the puzzle, narrowed in place. A path covers every cell
// once from the cell of number 1 (`start`) to the cell of the last number (`end`): those two use
// one side each, every other cell two. Consecutive cells on the path that both carry a number have
// consecutive numbers.
export function narrowOpen(top, open, cp, start, end) {
  const { T, nb, deg, rev } = top;
  const need = new Uint8Array(T).fill(2);
  need[start] = 1;
  need[end] = 1;
  const free = new Int32Array(T); // open sides
  const fixed = new Int32Array(T); // open sides the path has to use
  const forced = new Uint8Array(T * SLOTS);
  const queue = [];
  const queued = new Uint8Array(T);
  const push = cell => {
    if (!queued[cell]) {
      queued[cell] = 1;
      queue.push(cell);
    }
  };
  const close = (cell, k) => {
    const other = nb[cell * SLOTS + k];
    open[cell * SLOTS + k] = 0;
    open[other * SLOTS + rev[cell * SLOTS + k]] = 0;
    free[cell]--;
    free[other]--;
    push(other);
  };
  for (let cell = 0; cell < T; cell++) {
    for (let k = 0; k < deg[cell]; k++) {
      if (!open[cell * SLOTS + k]) {
        continue;
      }
      const other = nb[cell * SLOTS + k];
      if (cp[cell] && cp[other] && Math.abs(cp[cell] - cp[other]) !== 1) {
        open[cell * SLOTS + k] = 0;
        open[other * SLOTS + rev[cell * SLOTS + k]] = 0;
      }
    }
  }
  for (let cell = 0; cell < T; cell++) {
    for (let k = 0; k < SLOTS; k++) {
      free[cell] += open[cell * SLOTS + k];
    }
    push(cell);
  }
  while (queue.length) {
    const cell = queue.pop();
    queued[cell] = 0;
    if (free[cell] < need[cell] || fixed[cell] > need[cell]) {
      return false;
    }
    if (free[cell] === need[cell] && fixed[cell] < need[cell]) {
      for (let k = 0; k < SLOTS; k++) {
        if (open[cell * SLOTS + k] && !forced[cell * SLOTS + k]) {
          const other = nb[cell * SLOTS + k];
          forced[cell * SLOTS + k] = 1;
          forced[other * SLOTS + rev[cell * SLOTS + k]] = 1;
          fixed[cell]++;
          fixed[other]++;
          push(other);
        }
      }
      if (fixed[cell] > need[cell]) {
        return false;
      }
    }
    if (fixed[cell] === need[cell] && free[cell] > need[cell]) {
      for (let k = 0; k < SLOTS; k++) {
        if (open[cell * SLOTS + k] && !forced[cell * SLOTS + k]) {
          close(cell, k);
        }
      }
    }
  }
  return true;
}

// Solves p, stopping after opts.limit solutions (default 2: enough to tell unique from not) or
// when more than opts.nodeCap steps were tried (0 = no cap).
// opts.forced: a path to start with (cell list from the cell of number 1): only solutions that
// begin with it are searched, and only the steps below its last cell are counted and capped. That
// is how a wrong turn is tried (surface/trap.js): the nodes needed below it are its cost.
// Returns { count, path, second, nodes, capped }: path and second are the first two solutions as
// cell lists; with capped the count is only a lower bound.
export function solveSurface(p, opts = {}) {
  const limit = opts.limit ?? 2;
  const nodeCap = opts.nodeCap ?? 0;
  const forced = opts.forced ?? [];
  const checked = validateSurface(p);
  if (!checked.ok) {
    throw new Error(checked.msg);
  }
  const top = topologyOf(p);
  const { T, nb, deg } = top;
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
  if (!narrowOpen(top, open, p.cp, start, end)) {
    return { count: 0, path: null, second: null, nodes: 0, capped: false };
  }
  // toNumber[m * T + cell]: the fewest steps from the cell to the cell of number m over the sides
  // that are left (walls and the sides narrowOpen closed are not counted). A row is measured when
  // the search first asks for it.
  const toNumber = new Uint16Array((K + 1) * T);
  const rowDone = new Uint8Array(K + 1);
  const queue = new Int32Array(T);
  const fillRow = m => {
    const row = m * T;
    toNumber.fill(UNREACHED, row, row + T);
    let head = 0;
    let tailAt = 0;
    toNumber[row + cellOf[m]] = 0;
    queue[tailAt++] = cellOf[m];
    while (head < tailAt) {
      const cell = queue[head++];
      for (let k = 0; k < SLOTS; k++) {
        const other = nb[cell * SLOTS + k];
        if (open[cell * SLOTS + k] && toNumber[row + other] === UNREACHED) {
          toNumber[row + other] = toNumber[row + cell] + 1;
          queue[tailAt++] = other;
        }
      }
    }
    rowDone[m] = 1;
  };
  // The fewest steps from `from` to `to`, searching only as far as `to`.
  const reached = new Int32Array(T);
  const steps = new Uint16Array(T);
  let round = 0;
  const distance = (from, to) => {
    round++;
    let head = 0;
    let tailAt = 0;
    reached[from] = round;
    steps[from] = 0;
    queue[tailAt++] = from;
    while (head < tailAt) {
      const cell = queue[head++];
      if (cell === to) {
        return steps[cell];
      }
      for (let k = 0; k < SLOTS; k++) {
        const other = nb[cell * SLOTS + k];
        if (open[cell * SLOTS + k] && reached[other] !== round) {
          reached[other] = round;
          steps[other] = steps[cell] + 1;
          queue[tailAt++] = other;
        }
      }
    }
    return UNREACHED;
  };
  // tail[m]: the fewest steps from number m through all the later numbers.
  const tail = new Int32Array(K + 2);
  for (let m = K - 1; m >= 1; m--) {
    tail[m] = tail[m + 1] + distance(cellOf[m], cellOf[m + 1]);
  }
  const prunes = makePrunes(top, open);
  const vis = new Uint8Array(T);
  const path = new Int32Array(T);
  const solutions = [];
  let nodes = 0;
  let count = 0;
  let capped = false;

  // free[x]: see the header. Before the first step every open side of x counts (the start is the
  // head).
  const free = new Int32Array(T);
  for (let cell = 0; cell < T; cell++) {
    for (let k = 0; k < SLOTS; k++) {
      free[cell] += open[cell * SLOTS + k];
    }
  }
  const linked = makeLinker(top, open, vis);

  // The head left cell `from` for `head`, which is visited now: every unvisited cell has lost the
  // side to `from` (it is no longer the head). False when one of them is now cut off, or a single
  // free side is left on a cell other than the end of the path. Always take back with giveBack().
  const takeAway = from => {
    let alive = true;
    for (let k = 0; k < SLOTS; k++) {
      if (!open[from * SLOTS + k]) {
        continue;
      }
      const cell = nb[from * SLOTS + k];
      if (!vis[cell]) {
        const left = --free[cell];
        if (left === 0 || (left === 1 && cell !== end)) {
          alive = false;
        }
      }
    }
    return alive;
  };
  const giveBack = from => {
    for (let k = 0; k < SLOTS; k++) {
      if (open[from * SLOTS + k] && !vis[nb[from * SLOTS + k]]) {
        free[nb[from * SLOTS + k]]++;
      }
    }
  };

  // The checks of the start, once, in full.
  const feasibleStart = () => {
    fillRow(2);
    if (toNumber[2 * T + start] + tail[2] > T - 1) {
      return false;
    }
    for (let cell = 0; cell < T; cell++) {
      if (!vis[cell] && (free[cell] === 0 || (free[cell] === 1 && cell !== end))) {
        return false;
      }
    }
    return prunes.connected(vis, start, T - 1);
  };

  // depth cells are on the path, the last one is head, and number `next` is wanted next.
  const search = (head, depth, next) => {
    if (depth >= forced.length) {
      nodes++;
    }
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
      if (vis[cell] || (depth < forced.length && cell !== forced[depth])) {
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
      if (remaining === 1) {
        search(cell, depth + 1, wanted);
      } else if (
        (rowDone[wanted] || (fillRow(wanted), true))
        && toNumber[wanted * T + cell] + tail[wanted] <= remaining - 1
      ) {
        const alive = takeAway(head);
        if (alive && linked(head, cell)) {
          search(cell, depth + 1, wanted);
        }
        giveBack(head);
      }
      vis[cell] = 0;
      if (count >= limit || capped) {
        return;
      }
    }
  };

  vis[start] = 1;
  path[0] = start;
  if (feasibleStart()) {
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
      if (cell < 0 || vis[cell]) {
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
