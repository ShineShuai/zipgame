// Incremental forced-edge propagation for the solver's DFS (solve.js, `prop` with incr on, the default).
//
// propagate.js recomputes the whole deduction from scratch at every search node: O(unvisited cells) each
// time, although a move changes very little. This keeps the deduced state between nodes and, on each move,
// only repairs what the move touched; backtracking undoes those changes from a trail (an undo log).
//
// Same rules, same result: the state after step() is exactly the state propagate.js's deduce() computes from
// scratch for the new head (tests.js compares the two at every node of real searches, and the solver
// results node for node). Why that holds:
//   - The deductions are monotone: every forced edge, dropped edge and chain of the parent node is also a valid
//     consequence of the child node. The child only adds facts: the head h is gone from the graph (its edges
//     are removed from its neighbours) and the new head v needs one more edge instead of two.
//   - So the child's state is the parent's plus a few edge removals; running the same rules to a fixpoint from
//     the cells whose degree dropped reaches the same least fixpoint that deduce() reaches from scratch.
//
// State per cell, all in one Int32Array S (block k at offset k*T) so one trail entry is (index, old value):
//   AV  still-open edge bits (bit d = direction d, order R,L,D,U), for the unvisited cells and the head
//   FR  forced edge bits
//   FD  number of forced edges, DG number of open edges
//   OE, CN  for a forced-chain END x: the chain's other end, and the number of cells in the chain
//           (a lone cell is its own other end, size 1). Read only at chain ends; see propagate.js.
// The head needs 1 more edge, the end cell 1, every other unvisited cell 2.
//
// makeIncremental(nb, T, end, vis) -> {   (vis: Uint8Array, truthy at cells on the path, kept up to date by the
//                                         caller; at step(h, v) both h and v are already marked)
//   S              the state array; S[cell] is the AV block, so S[head] is the head's still-possible moves
//   init(cur, count, mustA, mustB)   state for the root node (only `cur` on the path); true unless infeasible.
//                                    mustA/mustB: optional edge the path must use (solve.js mustUse)
//   mark()         trail position; pass it back to undo()
//   step(h, v, count)   the path moves h -> v (count = path length including v); true unless infeasible.
//                       Mutates the state even when it returns false: undo() afterwards either way.
//   undo(mark, h)  roll back to `mark`; h = the head to restore (the cell the path was at before step())
//   forcedBits(u)  forced edge bits of u
// }
const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function makeIncremental(nb, T, end, vis) {
  const n = Math.round(Math.sqrt(T));
  const AV = 0, FR = T, FD = 2 * T, DG = 3 * T, OE = 4 * T, CN = 5 * T;
  const S = new Int32Array(6 * T);
  const nbm = new Uint8Array(T); // static open-edge mask (walls and borders excluded)
  for (let i = 0; i < T; i++) {
    let mask = 0;
    for (let d = 0; d < 4; d++) if (nb[i * 4 + d] >= 0) mask |= 1 << d;
    nbm[i] = mask;
  }
  let tr = new Int32Array(1 << 12); // trail: (index into S, old value) pairs
  let tp = 0;
  const pq = new Int32Array(4 * T + 8); // cells whose open degree just reached what they need
  let qt = 0;
  let hd = -1;    // head cell
  let pneed = 0;  // cells a head -> end chain has to contain

  function set(i, value) {
    if (tp + 2 > tr.length) {
      const grown = new Int32Array(tr.length * 2);
      grown.set(tr);
      tr = grown;
    }
    tr[tp++] = i;
    tr[tp++] = S[i];
    S[i] = value;
  }

  const required = u => (u === hd || u === end ? 1 : 2);

  // u has all the edges it needs, so its other open edges are unusable.
  function dropEdges(u) {
    const unforced = S[AV + u] & ~S[FR + u];
    for (let d = 0; d < 4; d++) {
      if (((unforced >> d) & 1) === 0) continue;
      const w = nb[u * 4 + d];
      set(AV + u, S[AV + u] & ~(1 << d));
      set(AV + w, S[AV + w] & ~(1 << (d ^ 1)));
      set(DG + u, S[DG + u] - 1);
      const need = required(w);
      const left = S[DG + w] - 1;
      set(DG + w, left);
      if (left < need) return false;
      if (left === need) pq[qt++] = w;
    }
    return true;
  }

  // x and y are the two ends of one forced chain: an open edge between them would close a cycle. Drop it.
  function dropClosingEdge(x, y) {
    const gap = x > y ? x - y : y - x;
    if (gap !== 1 && gap !== n) return true; // not grid neighbours: nothing to drop
    for (let d = 0; d < 4; d++) {
      if (nb[x * 4 + d] !== y || ((S[AV + x] & ~S[FR + x]) >> d & 1) === 0) continue;
      set(AV + x, S[AV + x] & ~(1 << d));
      set(AV + y, S[AV + y] & ~(1 << (d ^ 1)));
      const dx = S[DG + x] - 1;
      const dy = S[DG + y] - 1;
      set(DG + x, dx);
      set(DG + y, dy);
      const needX = required(x);
      const needY = required(y);
      if (dx < needX || dy < needY) return false;
      if (dx === needX) pq[qt++] = x;
      if (dy === needY) pq[qt++] = y;
      return true;
    }
    return true;
  }

  // Force the edge u -> direction d. Returns false if that makes the branch infeasible.
  function force(u, d) {
    if ((S[FR + u] >> d) & 1) return true;
    const v = nb[u * 4 + d];
    set(FR + u, S[FR + u] | (1 << d));
    set(FR + v, S[FR + v] | (1 << (d ^ 1)));
    const fu = S[FD + u] + 1;
    set(FD + u, fu);
    if (fu > required(u)) return false;
    const fv = S[FD + v] + 1;
    set(FD + v, fv);
    if (fv > required(v)) return false;

    // u and v both still have spare capacity, so both are chain ends (see propagate.js force()).
    if (S[OE + u] === v) return false; // forced cycle
    const endA = S[OE + u];
    const endB = S[OE + v];
    const merged = S[CN + u] + S[CN + v];
    set(OE + endA, endB);
    set(OE + endB, endA);
    set(CN + endA, merged);
    set(CN + endB, merged);

    // A forced chain from the head to the end has to contain every uncovered cell.
    if (S[OE + hd] === end && S[CN + hd] !== pneed) return false;

    if (!dropClosingEdge(endA, endB)) return false;
    if (fu >= required(u) && !dropEdges(u)) return false;
    if (fv >= required(v) && !dropEdges(v)) return false;
    return true;
  }

  function drain() {
    for (let h = 0; h < qt; h++) {
      const u = pq[h];
      for (let d = 0; d < 4; d++) {
        const open = ((S[AV + u] & ~S[FR + u]) >> d) & 1;
        if (open && !force(u, d)) return false;
      }
    }
    return true;
  }

  function init(cur, count, mustA = -1, mustB = -1) {
    if (cur === end) return false;
    S.fill(0);
    tp = 0;
    hd = cur;
    pneed = T - count + 1;
    qt = 0;
    for (let u = 0; u < T; u++) {
      S[AV + u] = nbm[u]; // only `cur` is on the path, and the head counts as an open neighbour
      S[OE + u] = u;
      S[CN + u] = 1;
      const degree = POP[nbm[u]];
      S[DG + u] = degree;
      const need = required(u);
      if (degree < need) return false;
      if (degree === need) pq[qt++] = u;
    }
    if (mustA >= 0) {
      let dir = -1;
      for (let d = 0; d < 4; d++) if (nb[mustA * 4 + d] === mustB) dir = d;
      if (dir < 0 || ((S[AV + mustA] >> dir) & 1) === 0 || !force(mustA, dir)) return false;
    }
    const ok = drain();
    tp = 0; // the root state is permanent: nothing to roll back below it
    return ok;
  }

  function step(h, v, count) {
    if (v === end) return false; // count < T here: the path may only end on the last checkpoint
    hd = v;
    pneed = T - count + 1;
    qt = 0;
    const fh = S[FR + h]; // h had one edge to give, so this is 0 or the single forced edge

    // h leaves the graph: take its edges away from its neighbours.
    for (let d = 0; d < 4; d++) {
      const w = nb[h * 4 + d];
      if (w < 0 || (w !== v && vis[w])) continue; // off the grid, or a cell already behind us
      const bit = 1 << (d ^ 1); // w's edge towards h
      const aw = S[AV + w];
      if ((aw & bit) === 0) continue; // already gone
      set(AV + w, aw & ~bit);
      const left = S[DG + w] - 1;
      set(DG + w, left);
      if (w === v) {
        if (S[FR + w] & bit) { // the forced edge h-v is used up: v is left needing one edge fewer
          set(FR + w, S[FR + w] & ~bit);
          set(FD + w, S[FD + w] - 1);
        }
      } else {
        if (fh & (1 << d)) return false; // h's forced edge leads somewhere else
        const need = required(w);
        if (left < need) return false;
        if (left === need) pq[qt++] = w;
      }
    }

    if (fh !== 0) {
      // the chain h ... z loses h; v becomes its end (it is z itself for a chain of just h and v)
      const z = S[OE + h];
      const size = S[CN + h] - 1;
      set(OE + v, z);
      set(OE + z, v);
      set(CN + v, size);
      set(CN + z, size);
    }

    // v is the head now: it needs 1 edge, not 2.
    const degree = S[DG + v];
    if (degree < 1) return false;
    if (S[FD + v] >= 1) {
      if (!dropEdges(v)) return false;
    } else if (degree === 1) {
      pq[qt++] = v;
    }
    if (S[OE + v] === end && S[CN + v] !== pneed) return false;
    return drain();
  }

  function undo(mark, head) {
    while (tp > mark) {
      tp -= 2;
      S[tr[tp]] = tr[tp + 1];
    }
    hd = head;
  }

  return { S, init, step, undo, mark: () => tp, forcedBits: u => S[FR + u] };
}
