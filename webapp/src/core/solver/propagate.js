// Forced-edge propagation, shared by the solver (solve.js, `prop`) and the play-mode overlay
// (forcedEdges() in prune.js), so the overlay can never disagree with what the solver deduces.
//
// Every unvisited cell needs path-degree 2 (1 for the end cell), and the head needs 1 more edge.
// Rules, run to a fixpoint:
//   - a cell with exactly as many open edges as it needs forces all of them;
//   - a cell with all its edges forced drops its other open edges;
//   - a forced cycle is a contradiction;
//   - a forced chain from the head to the end that leaves cells uncovered is a contradiction;
//   - an open edge between the two ends of one forced chain would close a cycle, so it is dropped.
// An optional "must-use" edge (deduce's last two arguments) is forced before the fixpoint runs; the solver's
// freedEdge check uses it to look only for solutions that cross a just-removed wall.
//
// Cost per deduce() call: O(U * alpha(U)) for U unvisited cells. Space: O(T), allocated once per
// makePropagator() call (the solver makes one per solve(); the overlay one per repaint).

// Number of set bits in a 4-bit direction mask.
const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// nb: neighbour table (see buildNeighbors), T: cell count, end: the end cell,
// vis: Uint8Array, truthy at cells on the path (the caller keeps it up to date).
// Returns { av, fr, nbm, deduce }:
//   av[u]  still-open edge bits of u (bit d = direction d, order R,L,D,U), fr[u] = forced edge bits.
//          Valid after a deduce() call that returned true; av[head] = the head's possible moves.
//   nbm[u] static open-edge mask of u (walls and borders excluded).
//   deduce(cur, count, ul, un, vm, mustA = -1, mustB = -1) -> false when this position cannot be completed.
//     cur = head cell, count = path length so far (head included),
//     ul[0 .. un) = unvisited cells, vm[u] = mask of u's neighbours that are on the path.
//     mustA/mustB = optional edge (two grid-adjacent cells, each the head or unvisited) that the rest of the
//     path has to use; deduce() fails when it cannot.
// cells (default T): how many cells the path covers in all (T minus the holes of a Cutout puzzle).
export function makePropagator(nb, T, end, vis, cells = T) {
  const n = Math.round(Math.sqrt(T));
  // Per cell: av = still-open edge bits, fr = forced edge bits, dg / fd = popcount of av / fr.
  const av = new Uint8Array(T);
  const fr = new Uint8Array(T);
  const fd = new Uint8Array(T);
  const dg = new Uint8Array(T);
  // The work queue of cells that just became forced.
  const pq = new Int32Array(T);
  // Forced edges form chains (paths). For a chain END x: oe[x] = the chain's other end (a lone cell is its
  // own other end) and cn[x] = the number of cells in the chain. Both are only read at chain ends, which are
  // the only cells that can still have an open edge, so no union-find is needed: two ends are in one chain
  // iff oe[x] is the other, and a merge only has to look at the pair of new ends.
  const oe = new Int32Array(T);
  const cn = new Int32Array(T);
  const nbm = new Uint8Array(T);
  for (let i = 0; i < T; i++) {
    let mask = 0;
    for (let d = 0; d < 4; d++) {
      if (nb[i * 4 + d] >= 0) mask |= 1 << d;
    }
    nbm[i] = mask;
  }
  let qt = 0;      // length of pq
  let pcur = -1;   // head cell of the current deduce() call
  let pneed = 0;   // cells a head -> end chain has to contain

  // Path-degree cell u still needs.
  function required(u) {
    return u === pcur || u === end ? 1 : 2;
  }

  // u has all the edges it needs, so its other open edges are unusable.
  function dropEdges(u) {
    const unforced = av[u] & ~fr[u];
    for (let d = 0; d < 4; d++) {
      if (((unforced >> d) & 1) === 0) continue;
      const w = nb[u * 4 + d];
      av[u] &= ~(1 << d);
      av[w] &= ~(1 << (d ^ 1));
      dg[u]--;
      const need = required(w);
      const left = --dg[w];
      if (left < need) return false;
      if (left === need) pq[qt++] = w;
    }
    return true;
  }

  // x and y are the two ends of one forced chain: an open edge between them would close a cycle,
  // which a path never has. Drop it. Only ends can have open edges, so this single pair is the
  // whole cycle-closing check.
  function dropClosingEdge(x, y) {
    const gap = x > y ? x - y : y - x;
    if (gap !== 1 && gap !== n) return true; // not grid neighbours: nothing to drop
    for (let d = 0; d < 4; d++) {
      if (nb[x * 4 + d] !== y || ((av[x] & ~fr[x]) >> d & 1) === 0) continue;
      av[x] &= ~(1 << d);
      av[y] &= ~(1 << (d ^ 1));
      dg[x]--;
      dg[y]--;
      const needX = required(x);
      const needY = required(y);
      if (dg[x] < needX || dg[y] < needY) return false;
      if (dg[x] === needX) pq[qt++] = x;
      if (dg[y] === needY) pq[qt++] = y;
      return true;
    }
    return true;
  }

  // Force the edge u -> direction d. Returns false if that makes the branch infeasible.
  function force(u, d) {
    if ((fr[u] >> d) & 1) return true;
    const v = nb[u * 4 + d];
    fr[u] |= 1 << d;
    fr[v] |= 1 << (d ^ 1);
    fd[u]++;
    if (fd[u] > required(u)) return false;
    fd[v]++;
    if (fd[v] > required(v)) return false;

    // u and v both still have spare capacity, so both are chain ends: they are in one chain iff u's
    // other end is v, and forcing u-v would then close a cycle.
    if (oe[u] === v) return false; // forced cycle
    // The merged chain runs from u's old far end to v's old far end.
    const endA = oe[u];
    const endB = oe[v];
    const merged = cn[u] + cn[v];
    oe[endA] = endB;
    oe[endB] = endA;
    cn[endA] = merged;
    cn[endB] = merged;

    // A forced chain from the head to the end has to contain every uncovered cell.
    if (oe[pcur] === end && cn[pcur] !== pneed) return false;

    if (!dropClosingEdge(endA, endB)) return false;
    if (fd[u] >= required(u) && !dropEdges(u)) return false;
    if (fd[v] >= required(v) && !dropEdges(v)) return false;
    return true;
  }

  function deduce(cur, count, ul, un, vm, mustA = -1, mustB = -1) {
    if (cur === end) return false; // count < T here: the path may only end on the last checkpoint
    pcur = cur;
    pneed = cells - count + 1;
    qt = 0;

    for (let i = 0; i < un; i++) {
      const u = ul[i];
      av[u] = nbm[u] & ~vm[u];
      fr[u] = 0;
      fd[u] = 0;
      cn[u] = 1;
      oe[u] = u;
    }
    av[cur] = nbm[cur] & ~vm[cur];
    fr[cur] = 0;
    fd[cur] = 0;
    cn[cur] = 1;
    oe[cur] = cur;

    // The head still counts as an open neighbour of the unvisited cells next to it.
    for (let d = 0; d < 4; d++) {
      const u = nb[cur * 4 + d];
      if (u >= 0 && !vis[u]) av[u] |= 1 << (d ^ 1);
    }

    for (let i = 0; i < un; i++) {
      const u = ul[i];
      const degree = POPCOUNT[av[u]];
      const need = u === end ? 1 : 2;
      dg[u] = degree;
      if (degree < need) return false;
      if (degree === need) pq[qt++] = u;
    }
    const headDegree = POPCOUNT[av[cur]];
    dg[cur] = headDegree;
    if (headDegree < 1) return false;
    if (headDegree === 1) pq[qt++] = cur;

    if (mustA >= 0) {
      let dir = -1;
      for (let d = 0; d < 4; d++) if (nb[mustA * 4 + d] === mustB) dir = d;
      if (dir < 0 || ((av[mustA] >> dir) & 1) === 0 || !force(mustA, dir)) return false;
    }
    for (let h = 0; h < qt; h++) {
      const u = pq[h];
      for (let d = 0; d < 4; d++) {
        const open = ((av[u] & ~fr[u]) >> d) & 1;
        if (open && !force(u, d)) return false;
      }
    }
    return true;
  }

  return { av, fr, nbm, deduce };
}
