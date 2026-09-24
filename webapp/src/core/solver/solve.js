import { maxNumber, startCell, endCell } from '../model.js';
import { buildNeighbors, makeConnOk, makeNoDeadEnd, makePocketOk, segBlocker, legsCollide } from './prune.js';

// Number of set bits in a 4-bit direction mask.
const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// Hamiltonian-path search: start at checkpoint 1, hit the checkpoints in order, end on the last one,
// and cover every cell exactly once.
//
// opts:
//   limit     stop after this many solutions (default 2)
//   nodeCap   give up after this many search nodes (default 200000)
//   capture   also return the solution paths
//   prune2    static wall-aware distance bound to the remaining checkpoints
//   prop      forced-edge propagation (see propagate() below)
//   seg       per-segment must-pass-through blocker cells (see segBlocker() below);
//             true = next segment only, 'all' = every remaining forward segment
//   pocket    single-entrance pocket check (see makePocketOk() in prune.js)
//   parity    bipartite slack check (see sufParity below)
//   order     cross-leg forced-corridor collision check (see legsCollide() in prune.js);
//             O(K^2) segBlocker calls per node, so meaningfully pricier than the others
// prune2, prop, seg, pocket, parity and order only prune: they never change the solutions found
// or their DFS order. They do change how many nodes are visited, which is why they are opt-in
// (nodeCap-dependent generation must stay reproducible for a given ALGO_VERSION).
//
// Returns { count, exceeded, nodes, paths? }. Pure: no DOM, no timers, no randomness.
export function solve(p, opts = {}) {
  const n = p.n;
  const T = n * n;
  const cp = p.cp;
  const limit = opts.limit ?? 2;
  const cap = opts.nodeCap || 200000;
  const K = maxNumber(p);
  const start = startCell(p);
  const end = endCell(p);
  if (K < 1 || start < 0) {
    return { count: 0, exceeded: false, nodes: 0, paths: opts.capture ? [] : undefined };
  }

  // ---------- static geometry ----------

  const { nb, row, col } = buildNeighbors(p);

  // pos[k] = cell that holds checkpoint k.
  const pos = new Int32Array(K + 1).fill(-1);
  for (let i = 0; i < T; i++) {
    if (cp[i]) pos[cp[i]] = i;
  }

  // Wall-aware BFS distances from `source` over the whole grid (visited cells ignored),
  // written to out[offset + cell]; -1 = unreachable.
  function distancesFrom(source, out, offset) {
    const queue = [source];
    out[offset + source] = 0;
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (let d = 0; d < 4; d++) {
        const v = nb[u * 4 + d];
        if (v >= 0 && out[offset + v] < 0) {
          out[offset + v] = out[offset + u] + 1;
          queue.push(v);
        }
      }
    }
  }

  // ---------- search state ----------

  const vis = new Uint8Array(T);        // 1 = cell is on the current path
  const cand = new Int32Array(T * 4);   // per-depth candidate moves
  const cdeg = new Int32Array(T * 4);   // onward degree of each candidate (for ordering)
  const pathBuf = new Int32Array(T);    // current path
  const paths = opts.capture ? [] : null;
  let nodes = 0;
  let found = 0;

  // ---------- prune2: static distances to the remaining checkpoints ----------

  // D[k * T + cell] = wall-aware distance from checkpoint k to cell.
  // suf[k] = summed distance along checkpoints k -> k+1 -> ... -> K.
  let D = null;
  let suf = null;
  if (opts.prune2) {
    D = new Int32Array((K + 1) * T).fill(-1);
    for (let k = 1; k <= K; k++) distancesFrom(pos[k], D, k * T);
    suf = new Int32Array(K + 2);
    for (let k = K - 1; k >= 1; k--) {
      const d = D[k * T + pos[k + 1]];
      suf[k] = d < 0 ? 1e9 : suf[k + 1] + d;
    }
  }

  // ---------- parity: bipartite slack check ----------
  //
  // sufParity[k] = parity (0 or 1) of the sum of Manhattan distances along the remaining
  // checkpoint chain pos[k] -> pos[k+1] -> ... -> pos[K]. Static (Manhattan ignores walls),
  // computed once. Combined with manhattan(v, pos[need]) at each candidate, gives the parity of
  // the total remaining path length after landing on v — which must match remaining-1 (cells left
  // to spend). A mismatch means no path length can possibly fit, regardless of feasibility
  // elsewhere, so it's checked before the pricier BFS-distance (prune2) and dead-end/connectivity
  // checks. See the callsite comment for why parity is additive across concatenated legs.
  const PARITY = !!opts.parity;
  let sufParity = null;
  if (PARITY) {
    sufParity = new Int32Array(K + 2);
    for (let k = K - 1; k >= 1; k--) {
      const a = pos[k], b = pos[k + 1];
      const d = a >= 0 && b >= 0 ? Math.abs(row[a] - row[b]) + Math.abs(col[a] - col[b]) : 0;
      sufParity[k] = (sufParity[k + 1] + d) & 1;
    }
  }

  // ---------- prop: forced-edge propagation ----------
  //
  // Every unvisited cell needs path-degree 2 (1 for the end cell), and the head needs 1 more edge.
  // A cell with exactly that many open edges forces all of them; a cell with all its edges forced
  // drops its others. Forced cycles, and a forced chain from the head to the end that leaves cells
  // uncovered, prune the branch.

  const PROP = !!opts.prop;
  // Per cell: av = still-open edge bits, fr = forced edge bits (bit d = direction d),
  // dg / fd = popcount of av / fr.
  const av = PROP ? new Uint8Array(T) : null;
  const fr = PROP ? new Uint8Array(T) : null;
  const fd = PROP ? new Uint8Array(T) : null;
  const dg = PROP ? new Uint8Array(T) : null;
  // Union-find over forced edges, and the work queue of cells that just became forced.
  const par = PROP ? new Int32Array(T) : null;
  const sz = PROP ? new Int32Array(T) : null;
  const pq = PROP ? new Int32Array(T) : null;
  // Incremental bookkeeping kept by enter()/leave():
  //   nbm = static open-edge mask, vm = mask of neighbours already visited,
  //   ul[0 .. un) = unvisited cells (swap-removed on enter, restored LIFO on leave), up = index into ul.
  const nbm = PROP ? new Uint8Array(T) : null;
  const vm = PROP ? new Uint8Array(T) : null;
  const ul = PROP ? new Int32Array(T) : null;
  const up = PROP ? new Int32Array(T) : null;
  let qt = 0;      // length of pq
  let pcur = -1;   // head cell of the current propagate() call
  let pneed = 0;   // cells a head -> end chain has to contain
  let un = T;      // number of unvisited cells
  if (PROP) {
    for (let i = 0; i < T; i++) {
      ul[i] = i;
      up[i] = i;
      let mask = 0;
      for (let d = 0; d < 4; d++) {
        if (nb[i * 4 + d] >= 0) mask |= 1 << d;
      }
      nbm[i] = mask;
    }
  }

  // Path-degree cell u still needs.
  function required(u) {
    return u === pcur || u === end ? 1 : 2;
  }

  function find(x) {
    while (par[x] !== x) {
      par[x] = par[par[x]];
      x = par[x];
    }
    return x;
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

    let a = find(u);
    let b = find(v);
    if (a === b) return false; // forced cycle
    if (sz[a] < sz[b]) {
      const t = a;
      a = b;
      b = t;
    }
    par[b] = a;
    sz[a] += sz[b];

    // A forced chain from the head to the end has to contain every uncovered cell.
    const chainRoot = find(pcur);
    if (chainRoot === find(end) && sz[chainRoot] !== pneed) return false;

    if (fd[u] >= required(u) && !dropEdges(u)) return false;
    if (fd[v] >= required(v) && !dropEdges(v)) return false;
    return true;
  }

  // false = this branch cannot be completed. On true, av[cur] holds the head's still-possible moves.
  function propagate(cur, count) {
    if (cur === end) return false; // count < T here: the path may only end on the last checkpoint
    pcur = cur;
    pneed = T - count + 1;
    qt = 0;

    for (let i = 0; i < un; i++) {
      const u = ul[i];
      av[u] = nbm[u] & ~vm[u];
      fr[u] = 0;
      fd[u] = 0;
      par[u] = u;
      sz[u] = 1;
    }
    av[cur] = nbm[cur] & ~vm[cur];
    fr[cur] = 0;
    fd[cur] = 0;
    par[cur] = cur;
    sz[cur] = 1;

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

    for (let h = 0; h < qt; h++) {
      const u = pq[h];
      for (let d = 0; d < 4; d++) {
        const open = ((av[u] & ~fr[u]) >> d) & 1;
        if (open && !force(u, d)) return false;
      }
    }
    return true;
  }

  function enter(c) {
    vis[c] = 1;
    if (!PROP) return;
    for (let d = 0; d < 4; d++) {
      const w = nb[c * 4 + d];
      if (w >= 0) vm[w] |= 1 << (d ^ 1);
    }
    // swap c to the end of the unvisited list, then shrink it
    const last = ul[un - 1];
    const i = up[c];
    ul[i] = last;
    up[last] = i;
    ul[un - 1] = c;
    up[c] = un - 1;
    un--;
  }

  function leave(c) {
    vis[c] = 0;
    if (!PROP) return;
    un++;
    for (let d = 0; d < 4; d++) {
      const w = nb[c * 4 + d];
      if (w >= 0) vm[w] &= ~(1 << (d ^ 1));
    }
  }

  // ---------- pruning tests used by dfs ----------

  const connOk = makeConnOk(nb, T, vis);
  const noDeadEnd = makeNoDeadEnd(nb, vis, end);
  const SEG = !!opts.seg;
  const SEG_ALL = opts.seg === 'all';
  const POCKET = !!opts.pocket;
  // Any checkpoint cell still unvisited is, by construction, still needed (checkpoints are only
  // ever marked visited once the DFS has actually reached them in order) — so a static "is this a
  // checkpoint at all" mask is enough; makePocketOk's own vis[] check does the rest.
  let pocketOk = null;
  if (POCKET) {
    const needCp = new Uint8Array(T);
    for (let i = 0; i < T; i++) if (cp[i] !== 0) needCp[i] = 1;
    pocketOk = makePocketOk(nb, T, vis, needCp);
  }
  const ORDER = !!opts.order;

  // ---------- search ----------

  function dfs(cell, count, needed, depth) {
    nodes++;
    if (nodes > cap || found >= limit) return;
    enter(cell);
    pathBuf[depth] = cell;

    // Checkpoints have to be entered in order.
    let need = needed;
    const marker = cp[cell];
    if (marker !== 0) {
      if (marker !== need) {
        leave(cell);
        return;
      }
      need++;
    }

    if (count === T) {
      if (cell === end && need === K + 1) {
        found++;
        if (paths) paths.push(Array.from(pathBuf));
      }
      leave(cell);
      return;
    }

    const remaining = T - count;
    // Checked cheapest-first, short-circuiting: local degree, then flood-fill count, then forced-
    // edge propagation, then the single-entrance pocket check, then (most expensive — O(K^2)
    // segBlocker calls) the cross-leg forced-corridor collision check. See legsCollide() in
    // prune.js for what it catches that none of the earlier checks do.
    let feasible = noDeadEnd(cell) && connOk(cell, remaining) && (!PROP || propagate(cell, count)) && (!POCKET || pocketOk(cell));
    if (feasible && ORDER && need <= K) {
      const legs = [[cell, pos[need]]];
      for (let k = need; k < K; k++) legs.push([pos[k], pos[k + 1]]);
      feasible = !legsCollide(nb, T, vis, legs);
    }
    if (!feasible) {
      leave(cell);
      return;
    }

    // seg: must-pass-through cells for forward segments. `opts.seg==='all'` checks every
    // remaining segment (pos[j] -> pos[j+1]), j = need..K-1; opts.seg===true checks only the
    // immediate next one. Both computed once per node.
    let forcedUnion = null;
    if (SEG && need >= 1 && need <= K) {
      forcedUnion = new Set();
      const last = SEG_ALL ? K - 1 : Math.min(need, K - 1);
      for (let j = need; j <= last; j++) {
        const s = pos[j], t = pos[j + 1];
        if (s < 0 || t < 0) continue;
        const f = segBlocker(nb, T, vis, s, t);
        for (const c of f) if (!forcedUnion.has(c)) forcedUnion.add(c);
      }
    }

    // Candidate moves, most constrained first (stable insertion sort by onward degree).
    const base = depth * 4;
    let count2 = 0;
    for (let d = 0; d < 4; d++) {
      const v = nb[cell * 4 + d];
      if (v < 0 || vis[v]) continue;
      if (PROP && !((av[cell] >> d) & 1)) continue;
      const marker2 = cp[v];
      if (marker2 !== 0 && marker2 !== need) continue;
      // v is reserved for a later segment's own path — taking it now (as part of *this*
      // segment, since v isn't this segment's own target) would strand that segment.
      if (forcedUnion && forcedUnion.size && v !== pos[need] && forcedUnion.has(v)) continue;

      if (need <= K) {
        const target = pos[need];
        if (target >= 0) {
          const manhattan = Math.abs(row[v] - row[target]) + Math.abs(col[v] - col[target]);
          if (manhattan > remaining) continue;
          // Parity: the grid is bipartite (checkerboard colour flips every move), so any actual
          // path length between two cells always shares parity with their Manhattan distance.
          // That holds leg-by-leg and is additive across concatenated legs, so the TOTAL path
          // length from v to the final checkpoint must share parity with the SUM of Manhattan
          // distances over every remaining leg (v->pos[need], pos[need]->pos[need+1], ...,
          // pos[K-1]->pos[K]) — not just the next leg alone. sufParity precomputes that sum's
          // parity for legs pos[need]->...->pos[K] once per DFS node (not per candidate); adding
          // manhattan(v,target)'s own parity gives the total. remaining-1 = cells left to spend
          // after this move, all the way to path end — an odd mismatch means no path length fits.
          if (PARITY && (((remaining - 1 - manhattan - sufParity[need]) & 1) !== 0)) continue;
        }
        if (D) {
          const dist = D[need * T + v];
          if (dist < 0 || dist + suf[need] > remaining - 1) continue;
        }
      }

      let degree = 0;
      for (let e = 0; e < 4; e++) {
        const w = nb[v * 4 + e];
        if (w >= 0 && !vis[w]) degree++;
      }
      let slot = count2++;
      while (slot > 0 && cdeg[base + slot - 1] > degree) {
        cdeg[base + slot] = cdeg[base + slot - 1];
        cand[base + slot] = cand[base + slot - 1];
        slot--;
      }
      cdeg[base + slot] = degree;
      cand[base + slot] = v;
    }

    for (let i = 0; i < count2; i++) {
      dfs(cand[base + i], count + 1, need, depth + 1);
      if (found >= limit || nodes > cap) break;
    }
    leave(cell);
  }

  // ---------- run ----------

  dfs(start, 1, 1, 0);
  return { count: found, exceeded: nodes > cap, nodes, paths: paths || undefined };
}
