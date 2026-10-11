// Incremental forced-edge propagation for puzzles with one-way arrows: the same rules as
// propagate-dir.js, but the deductions are kept from node to node of the search instead of being
// recomputed from scratch, and taken back through a trail when the search backs up.
//
// The whole puzzle is one problem, "a Hamiltonian path from the start to the end", and a move of
// the search is just one more forced edge: the path so far is a chain of forced edges starting at
// the start. A child node only adds facts to its parent's (every deduction stays valid), so a move
// costs the propagation of its own consequences, not a pass over the board.
//
// Rules, run to a fixpoint (see propagate-dir.js for the reasoning):
//   - Undirected: every cell has two path neighbours (the start and the end one). A cell with
//     exactly that many neighbours it can still use must use all of them; a cell that has all it
//     needs drops its other edges (both directions).
//   - Directed: every cell but the start needs one move into it, every cell but the end one move
//     out of it. A cell with one possible move out (in) forces it, and then no other cell may use
//     the cell that move enters (leave the cell that move leaves). A used edge with one direction
//     left is that move.
//   - Forced moves form chains: a move from the end of a chain back to its start would close a
//     cycle, so it is dropped; the chain from the start to the end has to hold every cell, so the
//     move that would join it to the end's chain is dropped unless the result holds them all.
//
// moves: buildMoves() of solve-dir.js. start, end: the first and last checkpoint cells (they
// differ).
// total: the number of cells on the board. holes: optional Uint8Array, 1 = not on the board.
// Returns { av, init, move, mark, undo }:
//   av[u]   still-possible moves out of u (bit d = the move to out[u * 4 + d]); av[head] = the
//           head's possible next moves while the search stands on it.
//   init(mustA = -1, mustB = -1)  deduce at the root, forcing the move mustA -> mustB when given.
//           false: the puzzle cannot be solved. Call once, before anything else.
//   mark()  a token for the current state; undo(token) takes back everything since it.
//   move(from, to)  force the move from -> to (the search steps onto `to`) and propagate; false
//           when that is a contradiction. Always follow with undo(), whatever it returned.

const AV = 0;
const USED = 1;
const INDEG = 2;
const NXT = 3;
const PRV = 4;
const TAIL = 5;
const FIRST = 6;
const SIZE = 7;
const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
// 1 when the 4-bit mask has exactly one bit, and the direction of that bit
const ONE_BIT = [0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
const BIT_DIR = [0, 0, 1, 0, 2, 0, 0, 0, 3];

export function makeDirIncremental(moves, start, end, total, holes = null) {
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
  const arrays = [av, used, inDeg, nxt, prv, tail, first, size];
  const work = new Int32Array(T + 1); // cells whose edges changed, each at most once
  const queued = new Uint8Array(T);
  let top = 0;
  let trail = new Int32Array(3 * 64 * T);
  let trailTop = 0;
  let failed = false;

  // arrays[kind][i] = value, remembered on the trail.
  function put(kind, i, value) {
    if (trailTop + 3 > trail.length) {
      const bigger = new Int32Array(trail.length * 2);
      bigger.set(trail);
      trail = bigger;
    }
    const array = arrays[kind];
    trail[trailTop++] = kind;
    trail[trailTop++] = i;
    trail[trailTop++] = array[i];
    array[i] = value;
  }

  function undo(token) {
    while (trailTop > token) {
      const old = trail[--trailTop];
      const i = trail[--trailTop];
      arrays[trail[--trailTop]][i] = old;
    }
  }

  function enqueue(u) {
    if (queued[u]) return;
    queued[u] = 1;
    work[top++] = u;
  }

  // The move out of u in direction d can't be made.
  function drop(u, d) {
    if (!((av[u] >> d) & 1)) return;
    const v = out[u * 4 + d];
    if (nxt[u] === v) {
      failed = true;
      return;
    }
    put(AV, u, av[u] & ~(1 << d));
    put(INDEG, v, inDeg[v] - 1);
    enqueue(u);
    enqueue(v);
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

  // The chain that starts at the start has to end at the end holding every cell: joining it to
  // the end's chain is possible only when that makes them all.
  function guard() {
    const a = tail[start];
    const b = first[end];
    if (b === start) {
      if (size[start] !== total) failed = true;
      return;
    }
    if (size[start] + size[b] < total) dropBetween(a, b);
  }

  // The edge from u in direction d is on the path; with one direction left it is that move.
  function use(u, d) {
    if ((used[u] >> d) & 1) return;
    const w = gnb[u * 4 + d];
    put(USED, u, used[u] | (1 << d));
    put(USED, w, used[w] | (1 << (d ^ 1)));
    enqueue(u);
    enqueue(w);
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
    put(NXT, u, v);
    put(PRV, v, u);
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
    put(TAIL, s, e);
    put(FIRST, e, s);
    put(SIZE, s, size[s] + size[v]);
    dropBetween(e, s);
    guard();
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
    if (u !== start) {
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
    // path degree: 2 for a cell in the middle, 1 for the start and the end
    const need = u === start || u === end ? 1 : 2;
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

  function drain() {
    while (top > 0 && !failed) {
      const u = work[--top];
      queued[u] = 0;
      check(u);
    }
    while (top > 0) queued[work[--top]] = 0; // a contradiction: forget the rest
    return !failed;
  }

  function init(mustA = -1, mustB = -1) {
    failed = false;
    top = 0;
    queued.fill(0);
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
      if ((holes && holes[u]) || u === end) continue;
      let mask = 0;
      for (let d = 0; d < 4; d++) {
        const v = out[u * 4 + d];
        if (v >= 0 && v !== start) mask |= 1 << d; // nothing moves onto the start
      }
      av[u] = mask;
    }
    for (let u = 0; u < T; u++) {
      for (let d = 0; d < 4; d++) if ((av[u] >> d) & 1) inDeg[out[u * 4 + d]]++;
    }
    guard();
    if (mustA >= 0) {
      let d = 0;
      while (d < 4 && out[mustA * 4 + d] !== mustB) d++;
      if (d === 4 || !((av[mustA] >> d) & 1)) return false;
      force(mustA, d);
    }
    for (let u = 0; u < T; u++) {
      if (!(holes && holes[u])) enqueue(u);
    }
    return drain();
  }

  function move(from, to) {
    failed = false;
    top = 0;
    let d = 0;
    while (d < 4 && out[from * 4 + d] !== to) d++;
    if (d === 4 || !((av[from] >> d) & 1)) return false;
    force(from, d);
    return drain();
  }

  return { av, init, move, mark: () => trailTop, undo };
}
