import { maxNumber, startCell, endCell } from '../model.js';
import { buildNeighbors, makeConnOk, makeNoDeadEnd, makePocketOk, segBlocker, legsCollide } from './prune.js';
import { makePropagator } from './propagate.js';

// Hamiltonian-path search: start at checkpoint 1, hit the checkpoints in order, end on the last one,
// and cover every cell exactly once.
//
// opts:
//   limit     stop after this many solutions (default 2)
//   nodeCap   give up after this many search nodes (default 200000)
//   capture   also return the solution paths
//   prune2    static wall-aware distance bound to the remaining checkpoints
//   prop      forced-edge propagation (see propagate.js): degree-forcing, cycle ban and
//             cycle-closing edge removal
//   seg       per-segment must-pass-through blocker cells (see segBlocker() below);
//             true = next segment only, 'all' = every remaining forward segment
//   pocket    single-entrance pocket check (see makePocketOk() in prune.js)
//   parity    bipartite slack check (see sufParity below)
//   legCollide cross-leg collision check — two checkpoint-to-checkpoint legs forced to need the
//             same cell (see legsCollide() in prune.js); O(K^2) segBlocker calls per node, so
//             meaningfully pricier than the others; checked last for that reason
//   forced    array of cells: a path prefix (forced[0] must be the start cell) the search must follow before
//             branching. Used by core/trap.js to ask "is this wrong turn refuted, and how expensively?".
//             nodeCap then counts only nodes BELOW the prefix (the prefix itself is forced.length-1
//             nodes), so a late prefix is not penalised; result.subNodes is that count.
//   decisions count decision-nodes (dfs() calls where >=2 candidate moves survive every prune in
//             effect) and the deepest one's depth/T fraction — see difficulty.js. Purely additive
//             bookkeeping (a comparison + two counters), so it never changes which nodes are
//             visited; only opt-in because unused fields cost nothing to skip, not to avoid bias.
// prune2, prop, seg, pocket, parity and legCollide only prune: they never change the solutions
// found or their DFS order. They do change how many nodes are visited, which is why they are
// opt-in (nodeCap-dependent generation must stay reproducible for a given ALGO_VERSION).
//
// Returns { count, exceeded, nodes, subNodes, paths?, decisionNodes?, maxDecisionDepth? }. Pure: no DOM, no
// timers, no randomness.
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
  // forced prefix (opts.forced): the prefix's own nodes do not count against the cap (see header).
  const forced = opts.forced || null;
  const prefix = forced ? forced.length - 1 : 0;
  let found = 0;
  // Difficulty instrumentation (see difficulty.js): a "decision node" is one where >=2 candidate
  // moves survive every prune in effect for this call — a real branch/guess point, not just tree
  // size. Zero-cost when opts.decisions is falsy (the counters are read but never written).
  const DECISIONS = !!opts.decisions;
  let decisionNodes = 0;
  let maxDecisionDepth = 0;

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
  // The deduction itself lives in propagate.js (shared with the play-mode overlay); this file only
  // keeps the search-side bookkeeping it reads from:
  //   vm = mask of each cell's neighbours already on the path,
  //   ul[0 .. un) = unvisited cells (swap-removed on enter, restored LIFO on leave), up = index into ul.
  // After a successful prop.deduce(), av[cell] holds the head's still-possible moves.

  const PROP = !!opts.prop;
  const prop = PROP ? makePropagator(nb, T, end, vis) : null;
  const av = PROP ? prop.av : null;
  const vm = PROP ? new Uint8Array(T) : null;
  const ul = PROP ? new Int32Array(T) : null;
  const up = PROP ? new Int32Array(T) : null;
  let un = T;      // number of unvisited cells
  if (PROP) {
    for (let i = 0; i < T; i++) {
      ul[i] = i;
      up[i] = i;
    }
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
  const LEG_COLLIDE = !!opts.legCollide;

  // ---------- search ----------

  function dfs(cell, count, needed, depth) {
    nodes++;
    if (nodes - prefix > cap || found >= limit) return;
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
    let feasible = noDeadEnd(cell) && connOk(cell, remaining) && (!PROP || prop.deduce(cell, count, ul, un, vm)) && (!POCKET || pocketOk(cell));
    if (feasible && LEG_COLLIDE && need <= K) {
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
      if (forced && depth < prefix && v !== forced[depth + 1]) continue;
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

    if (DECISIONS && count2 >= 2) {
      decisionNodes++;
      const frac = depth / T; // depth fraction — comparable across grid sizes
      if (frac > maxDecisionDepth) maxDecisionDepth = frac;
    }

    for (let i = 0; i < count2; i++) {
      dfs(cand[base + i], count + 1, need, depth + 1);
      if (found >= limit || nodes - prefix > cap) break;
    }
    leave(cell);
  }

  // ---------- run ----------

  dfs(start, 1, 1, 0);
  return {
    count: found, exceeded: nodes - prefix > cap, nodes, subNodes: Math.max(0, nodes - prefix), paths: paths || undefined,
    ...(DECISIONS ? { decisionNodes, maxDecisionDepth } : {}),
  };
}
