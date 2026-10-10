// Forced-edge propagation for puzzles with one-way arrows (see solve-dir.js, which owns the
// search). The directed counterpart of propagate.js: it deduces, from the cells still to visit,
// which moves are forced and which can never be part of a completion.
//
// Two views of the same path, run together to a fixpoint:
//   - Undirected: every unvisited cell has two path neighbours (the end one, the head one),
//     whichever way the edges are walked. A cell with exactly that many neighbours it can still
//     use must use all of them; a cell that has all it needs drops the other edges (both ways).
//   - Directed: every unvisited cell needs one move into it (the head counts as a source), every
//     unvisited cell but the end one move out of it, and the head one move out. A cell with
//     exactly one possible move out (in) forces it, and then no other cell may use the cell that
//     move enters (leave the cell that move leaves). A used edge with one direction left is that
//     move.
// A cell that can't get what it needs is a contradiction. Forced moves form chains (path pieces):
// a move from the end of a chain back to its start would close a cycle, so it is dropped; a
// forced chain from the head to the end that leaves cells uncovered is a contradiction, and the
// move that would join the head's chain to the end's chain is dropped unless that chain would
// hold every cell.
// An optional must-use move (deduce's last two arguments) is forced before the fixpoint runs.
//
// Cost per deduce() call: O(cells) (it starts from scratch at every node). Space: O(cells),
// allocated once per makeDirPropagator() call.

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
// 1 when the 4-bit mask has exactly one bit, and the direction of that bit
const ONE_BIT = [0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
const BIT_DIR = [0, 0, 1, 0, 2, 0, 0, 0, 3];

// moves: buildMoves() of solve-dir.js. end: the end cell. vis: Uint8Array, truthy at the cells on
// the path (the caller keeps it up to date). holes: optional Uint8Array, 1 = not on the board.
// Returns { av, deduce }:
//   av[u]  still-possible moves out of u (bit d = the move to out[u * 4 + d]), valid after a
//          deduce() that returned true; av[head] = the head's possible next moves.
//   deduce(head, cells, mustA = -1, mustB = -1) -> false when the position cannot be completed.
//     cells = the unvisited cells plus the head. mustA/mustB: a move (a -> b, both unvisited or
//     the head) that the rest of the path has to make.
export function makeDirPropagator(moves, end, vis, holes = null) {
  const { out, gnb, pre, preDir, T } = moves;
  const av = new Uint8Array(T);
  const used = new Uint8Array(T);    // bit d: the edge to gnb[u * 4 + d] is on the path (some way)
  const inDeg = new Uint8Array(T);   // possible moves into the cell
  const nxt = new Int32Array(T);     // forced move out of the cell (its target), -1 = none yet
  const prv = new Int32Array(T);     // forced move into the cell (its source), -1 = none yet
  // Forced moves form chains. For a chain's first cell s: tail[s] = its last cell, size[s] = its
  // cells; for its last cell e: first[e] = s. A lone cell is a chain of its own.
  const tail = new Int32Array(T);
  const first = new Int32Array(T);
  const size = new Int32Array(T);
  const work = new Int32Array(24 * T); // cells whose edges changed
  let top = 0;
  let head = -1;
  let total = 0;     // cells a head -> end chain has to hold
  let failed = false;

  // The move out of u in direction d can't be made.
  function drop(u, d) {
    if (!((av[u] >> d) & 1)) return;
    const v = out[u * 4 + d];
    if (nxt[u] === v) {
      failed = true;
      return;
    }
    av[u] &= ~(1 << d);
    inDeg[v]--;
    work[top++] = u;
    work[top++] = v;
    if ((used[u] >> d) & 1) { // the edge is on the path: the other direction has to carry it
      if ((av[v] >> (d ^ 1)) & 1) force(v, d ^ 1);
      else failed = true;
    }
  }

  // The edge between u and its neighbour in direction d can't be used, either way.
  function dropEdge(u, d) {
    if ((used[u] >> d) & 1) {
      failed = true;
      return;
    }
    drop(u, d);
    drop(gnb[u * 4 + d], d ^ 1);
  }

  // The move from `a` to `b`, if there is one, cannot be made.
  function dropBetween(a, b) {
    for (let d = 0; d < 4; d++) if (out[a * 4 + d] === b) drop(a, d);
  }

  // Joining the head's chain to the end's chain (the head's chain can't end anywhere else).
  function guardEnd() {
    const a = tail[head];
    const b = first[end];
    if (b === head) {
      if (size[head] !== total) failed = true;
      return;
    }
    if (size[head] + size[b] < total) dropBetween(a, b);
  }

  // The edge from u in direction d is on the path; with one direction left it is that move.
  function use(u, d) {
    if ((used[u] >> d) & 1) return;
    const w = gnb[u * 4 + d];
    used[u] |= 1 << d;
    used[w] |= 1 << (d ^ 1);
    work[top++] = u;
    work[top++] = w;
    const forward = (av[u] >> d) & 1;
    const back = (av[w] >> (d ^ 1)) & 1;
    if (forward && !back) force(u, d);
    else if (back && !forward) force(w, d ^ 1);
    else if (!forward && !back) failed = true;
  }

  function force(u, d) {
    const v = out[u * 4 + d];
    if (nxt[u] === v) return;
    if (nxt[u] >= 0 || prv[v] >= 0) {
      failed = true;
      return;
    }
    nxt[u] = v;
    prv[v] = u;
    use(u, d);
    for (let e = 0; e < 4; e++) if (e !== d) drop(u, e);
    for (let k = 0; k < 4; k++) {
      const w = pre[v * 4 + k];
      if (w < 0) break;
      if (w !== u) drop(w, preDir[v * 4 + k]);
    }
    const s = first[u];
    const e = tail[v];
    if (s === v) {
      failed = true; // the chain would close on itself
      return;
    }
    tail[s] = e;
    first[e] = s;
    size[s] += size[v];
    dropBetween(e, s);
    guardEnd();
  }

  function check(u) {
    if (u !== end) {
      const mask = av[u];
      if (mask === 0) {
        failed = true;
        return;
      }
      if (ONE_BIT[mask] && nxt[u] < 0) force(u, BIT_DIR[mask]);
    }
    if (failed) return;
    if (u !== head) {
      if (inDeg[u] === 0) {
        failed = true;
        return;
      }
      if (inDeg[u] === 1 && prv[u] < 0) {
        for (let k = 0; k < 4; k++) {
          const w = pre[u * 4 + k];
          if (w < 0) break;
          if ((av[w] >> preDir[u * 4 + k]) & 1) {
            force(w, preDir[u * 4 + k]);
            break;
          }
        }
      }
    }
    if (failed) return;
    // path degree: 2 for an unvisited cell, 1 for the head and the end
    const need = u === head || u === end ? 1 : 2;
    let open = 0;
    for (let d = 0; d < 4; d++) {
      const w = gnb[u * 4 + d];
      if (w >= 0 && (((av[u] >> d) & 1) || ((av[w] >> (d ^ 1)) & 1))) open |= 1 << d;
    }
    if (POP[open] < need) {
      failed = true;
      return;
    }
    if (POP[open] === need) {
      for (let d = 0; d < 4 && !failed; d++) if ((open >> d) & 1) use(u, d);
    }
    if (failed) return;
    if (POP[used[u]] > need) {
      failed = true;
      return;
    }
    if (POP[used[u]] === need) {
      for (let d = 0; d < 4 && !failed; d++) if (((open & ~used[u]) >> d) & 1) dropEdge(u, d);
    }
  }

  function deduce(h, cells, mustA = -1, mustB = -1) {
    head = h;
    total = cells;
    failed = false;
    top = 0;
    for (let u = 0; u < T; u++) {
      nxt[u] = -1;
      prv[u] = -1;
      first[u] = u;
      tail[u] = u;
      size[u] = 1;
      inDeg[u] = 0;
      used[u] = 0;
      av[u] = 0;
    }
    for (let u = 0; u < T; u++) {
      if ((holes && holes[u]) || (vis[u] && u !== h) || u === end) continue;
      let mask = 0;
      for (let d = 0; d < 4; d++) {
        const v = out[u * 4 + d];
        if (v >= 0 && !vis[v]) mask |= 1 << d;
      }
      av[u] = mask;
    }
    for (let u = 0; u < T; u++) {
      for (let d = 0; d < 4; d++) if ((av[u] >> d) & 1) inDeg[out[u * 4 + d]]++;
    }
    guardEnd();
    if (mustA >= 0) {
      let d = 0;
      while (d < 4 && out[mustA * 4 + d] !== mustB) d++;
      if (d === 4 || !((av[mustA] >> d) & 1)) return false;
      force(mustA, d);
    }
    for (let u = 0; u < T; u++) {
      if ((holes && holes[u]) || (vis[u] && u !== h)) continue;
      work[top++] = u;
    }
    while (top > 0 && !failed) check(work[--top]);
    return !failed;
  }

  return { av, deduce };
}
