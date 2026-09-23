import { hasWall } from '../edges.js';

// Direction order R,L,D,U. Solver generation depends on this exact order for tie-breaks
// (see ALGO_VERSION in solve.js) — do not reorder.
export const DR = [0, 0, 1, -1];
export const DC = [1, -1, 0, 0];

// nb[cell * 4 + d] = neighbour of cell in direction d, or -1 for a wall / the border.
// row[cell] / col[cell] = grid coordinates. Shared by the solver and the connectivity overlay,
// so both walk the exact same adjacency.
export function buildNeighbors(p) {
  const n = p.n;
  const T = n * n;
  const nb = new Int32Array(T * 4).fill(-1);
  const row = new Int32Array(T);
  const col = new Int32Array(T);
  for (let i = 0; i < T; i++) {
    const r = (i / n) | 0;
    const c = i % n;
    row[i] = r;
    col[i] = c;
    for (let d = 0; d < 4; d++) {
      const rr = r + DR[d];
      const cc = c + DC[d];
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const j = rr * n + cc;
      if (!hasWall(p, i, j)) nb[i * 4 + d] = j;
    }
  }
  return { nb, row, col, T };
}

// The unvisited region must be one connected blob of the size still needed.
// vis: Uint8Array/Array, truthy at index i iff cell i is on the path.
// Returns a connOk(cur, remaining) closure with its flood-fill scratch space allocated once,
// so callers doing this every search node (the solver) or every UI repaint (the overlay) don't
// pay allocation cost per call.
export function makeConnOk(nb, T, vis) {
  const reach = makeReachable(nb, T, vis);
  return function connOk(cur, remaining) {
    return reach(cur, null) === remaining;
  };
}

// Flood-fill from `cur` over unvisited cells (same rule connOk uses: open edge, not on `vis`).
// Returns the count reached. If `into` is a Set, also adds each reached cell to it (cleared
// first) — used by the connectivity overlay, which needs the actual cells, not just the count.
// Shared scratch (stamped Int32Array, no per-call allocation) so this stays cheap enough for the
// solver's hot path; `into` is the only allocating option, and only the overlay passes it.
export function makeReachable(nb, T, vis) {
  const seen = new Int32Array(T);
  const stack = new Int32Array(T);
  let stamp = 0;
  return function reach(cur, into) {
    if (into) into.clear();
    stamp++;
    let sp = 0;
    let cnt = 0;
    stack[sp++] = cur;
    seen[cur] = stamp;
    while (sp > 0) {
      const u = stack[--sp];
      for (let d = 0; d < 4; d++) {
        const v = nb[u * 4 + d];
        if (v < 0 || vis[v] || seen[v] === stamp) continue;
        seen[v] = stamp;
        cnt++;
        stack[sp++] = v;
        if (into) into.add(v);
      }
    }
    return cnt;
  };
}

// An unvisited cell with fewer than 2 free neighbours can only be the end cell — and the end cell
// itself still needs at least 1 free neighbour (a fully boxed-in end can never be entered at all).
// vis: same as makeConnOk. end: the puzzle's designated end cell.
// Returns a noDeadEnd(cur) closure — only cur's own neighbours need checking, since entering cur
// is the only thing that can have changed any cell's degree since the last check.
export function makeNoDeadEnd(nb, vis, end) {
  return function noDeadEnd(cur) {
    for (let d = 0; d < 4; d++) {
      const u = nb[cur * 4 + d];
      if (u < 0 || vis[u]) continue;
      const free = freeNeighbors(nb, vis, cur, u);
      if (free === 0) return false;
      if (free === 1 && u !== end) return false;
    }
    return true;
  };
}

// Shared inner loop for both isDeadEnd and noDeadEnd: how many free (unvisited-or-head, unwalled)
// neighbours does `cell` have, counting `head` as free even though it's on the path.
function freeNeighbors(nb, vis, head, cell) {
  let free = 0;
  for (let d = 0; d < 4; d++) {
    const v = nb[cell * 4 + d];
    if (v < 0) continue;
    if (vis[v] && v !== head) continue;
    free++;
  }
  return free;
}

// Cell-level dead-end check for the overlay: is `cell` down to <=1 free neighbour? A cell this
// constrained can only ever be entered last — unless it's the end cell, which the caller excludes
// separately (see boardConnectivity), since a free-neighbour count of exactly 1 is normal and
// expected for the end.
export function isDeadEnd(nb, vis, head, cell) {
  return freeNeighbors(nb, vis, head, cell) <= 1;
}
