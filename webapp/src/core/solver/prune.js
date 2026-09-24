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

// Single-entrance pocket check: from `cur`, does stepping toward some neighbour commit the path
// to a region it can never leave — a connected component of the free-cell graph (with `cur`
// itself removed as an obstacle) that touches the rest of the grid through only that one edge —
// while that region contains none of the checkpoints still needed?
//
// Why this needs its own check: connOk verifies total reachable *count*, and noDeadEnd/propagate
// reason about individual cells' degree. Neither sees a multi-cell region — a corridor or a wide
// "ladder" block — where every interior cell keeps degree >=2 throughout (so no single-cell rule
// ever fires) but the region as a whole only connects out through one edge. Once the path enters
// such a region without a needed checkpoint inside it, it can only ever double back through the
// same entrance cell, which will already be visited — guaranteed infeasible, but connOk/noDeadEnd
// (and even prop, against a wide enough pocket) won't discover that until the DFS has wandered
// deep inside trying every internal arrangement. See bench/pocket-bench.js for a constructed case
// where this costs the existing prunes upwards of 2,000,000 nodes versus one pass here.
//
// vis, nb, T: same as makeConnOk. needCp: Uint8Array/plain array, truthy at cell i iff i is a
// checkpoint the path still needs to pass through (any of pos[need..K], end included).
// Returns a pocketOk(cur) closure: true if none of cur's neighbours leads into a single-entrance
// pocket that lacks a still-needed checkpoint.
export function makePocketOk(nb, T, vis, needCp) {
  const seen = new Int32Array(T);   // per-component stamp: which flood-fill last touched this cell
  const claimed = new Int32Array(T); // per-call epoch: which pocketOk() call already assigned this cell to some component
  const stack = new Int32Array(T);
  let stamp = 0;
  let epoch = 0;

  return function pocketOk(cur) {
    epoch++;
    for (let d0 = 0; d0 < 4; d0++) {
      const seed = nb[cur * 4 + d0];
      if (seed < 0 || vis[seed] || claimed[seed] === epoch) continue; // already swept earlier this call
      // Flood-fill the component containing `seed`, with `cur` treated as an obstacle (so the
      // fill can't leak back out through cur), tracking whether it holds a needed checkpoint.
      stamp++;
      let sp = 0, hasNeed = !!needCp[seed];
      stack[sp++] = seed;
      seen[seed] = stamp;
      claimed[seed] = epoch;
      while (sp > 0) {
        const u = stack[--sp];
        for (let d = 0; d < 4; d++) {
          const v = nb[u * 4 + d];
          if (v < 0 || vis[v] || v === cur || seen[v] === stamp) continue;
          seen[v] = stamp;
          claimed[v] = epoch;
          if (needCp[v]) hasNeed = true;
          stack[sp++] = v;
        }
      }
      // Count cur's own entrances into this exact component (cheap: cur has only 4 edges, and
      // membership in the just-computed component is an O(1) stamp check).
      let entrances = 0;
      for (let d = 0; d < 4; d++) {
        const v = nb[cur * 4 + d];
        if (v >= 0 && !vis[v] && seen[v] === stamp) entrances++;
      }
      if (entrances === 1 && !hasNeed) return false;
    }
    return true;
  };
}

// Per-segment must-pass-through blocker: for a fixed (s, t) pair (adjacent checkpoints, or the
// live head and the next checkpoint), find every unvisited cell that lies on *every* s-t path
// through the currently-unvisited region. Removing any one of those cells disconnects s from t,
// so the main search can safely refuse to spend that cell on any other segment.
//
// Method: two BFS passes (forward from s, backward from t) restrict attention to the candidate
// set C = reachable(s) ∩ reachable(t) — cells that could plausibly sit on an s-t path at all.
// Within the induced subgraph on C, an articulation point that actually separates s's side from
// t's side is forced. This is cheap (two BFS + one Tarjan pass, each O(|C|)) and exact: it is not
// a heuristic approximation of "must-pass-through", it is the same statement (s-t vertex cut of
// size 1 on the induced subgraph), just computed without an explicit max-flow.
//
// Returns a Set of forced cell indices (never containing s or t themselves). Empty set = no
// single cell is forced (either s/t disconnected — connOk/noDeadEnd already handle that case
// elsewhere — or there are >=2 vertex-disjoint routes).
export function segBlocker(nb, T, vis, s, t) {
  if (s === t) return new Set();

  // 1) forward/backward reachability restricted to unvisited cells (s, t themselves are "live"
  //    endpoints, not required to be unvisited — the head cell itself is on `vis` but must count).
  const fwd = new Uint8Array(T);
  const bwd = new Uint8Array(T);
  const qf = [s];
  fwd[s] = 1;
  for (let h = 0; h < qf.length; h++) {
    const u = qf[h];
    for (let d = 0; d < 4; d++) {
      const v = nb[u * 4 + d];
      if (v < 0 || fwd[v] || (vis[v] && v !== t)) continue;
      fwd[v] = 1;
      qf.push(v);
    }
  }
  if (!fwd[t]) return new Set(); // disconnected — not this function's job to report

  const qb = [t];
  bwd[t] = 1;
  for (let h = 0; h < qb.length; h++) {
    const u = qb[h];
    for (let d = 0; d < 4; d++) {
      const v = nb[u * 4 + d];
      if (v < 0 || bwd[v] || (vis[v] && v !== s)) continue;
      bwd[v] = 1;
      qb.push(v);
    }
  }

  // C = candidate cells that could lie on some s-t path (both directions reach them).
  const inC = new Uint8Array(T);
  const C = [];
  for (let i = 0; i < T; i++) {
    if (fwd[i] && bwd[i]) {
      inC[i] = 1;
      C.push(i);
    }
  }
  if (C.length <= 2) return new Set(); // just {s,t} or degenerate — nothing to force

  // 2) Tarjan articulation points on the induced subgraph over C, rooted at s. Standard
  //    low-link recursion, iterative to avoid stack blowups on larger grids.
  const disc = new Int32Array(T).fill(-1);
  const low = new Int32Array(T).fill(-1);
  const parent = new Int32Array(T).fill(-1);
  const isArt = new Uint8Array(T);
  let timer = 0;

  // Iterative DFS: stack frames of [node, neighbourDirIndex, childCount].
  const stackNode = new Int32Array(C.length + 1);
  const stackDir = new Int32Array(C.length + 1);
  const rootChildren = new Int32Array(1);
  let sp = 0;
  stackNode[sp] = s;
  stackDir[sp] = 0;
  disc[s] = low[s] = timer++;
  sp++;

  while (sp > 0) {
    const u = stackNode[sp - 1];
    let d = stackDir[sp - 1];
    let recursed = false;
    for (; d < 4; d++) {
      const v = nb[u * 4 + d];
      if (v < 0 || !inC[v] || v === parent[u]) continue;
      if (disc[v] === -1) {
        parent[v] = u;
        if (u === s) rootChildren[0]++;
        disc[v] = low[v] = timer++;
        stackDir[sp - 1] = d + 1;
        stackNode[sp] = v;
        stackDir[sp] = 0;
        sp++;
        recursed = true;
        break;
      } else if (disc[v] < low[u]) {
        low[u] = disc[v];
      }
    }
    if (recursed) continue;
    if (d >= 4) {
      // done with u — pop, propagate low-link to parent, test articulation condition
      sp--;
      const pu = parent[u];
      if (pu !== -1) {
        if (low[u] < low[pu]) low[pu] = low[u];
        if (pu !== s && low[u] >= disc[pu]) isArt[pu] = 1;
      }
      stackDir[sp] = d; // no-op, keeps intent explicit
    } else {
      stackDir[sp - 1] = d;
    }
  }
  if (rootChildren[0] > 1) isArt[s] = 1; // root is articulation iff it has >1 DFS-tree children — s itself is never added to the result below anyway

  // 3) An articulation point of the induced subgraph is only a forced *s-t* cell if it actually
  //    separates s from t (it might separate two other branches that don't matter here). Cheap
  //    check: cut it out and re-run the forward BFS restricted to C; if t becomes unreachable,
  //    it's forced. C is typically small (a corridor), so this stays cheap in practice.
  const forced = new Set();
  const seen = new Uint8Array(T);
  for (const v of C) {
    if (!isArt[v] || v === s || v === t) continue;
    seen.fill(0);
    const stack = [s];
    seen[s] = 1;
    let reachedT = false;
    while (stack.length) {
      const u = stack.pop();
      if (u === t) { reachedT = true; break; }
      for (let d = 0; d < 4; d++) {
        const w = nb[u * 4 + d];
        if (w < 0 || w === v || !inC[w] || seen[w]) continue;
        seen[w] = 1;
        stack.push(w);
      }
    }
    if (!reachedT) forced.add(v);
  }
  return forced;
}

// General checkpoint-order contradiction check: does the current position already force two
// DIFFERENT, non-adjacent legs of the remaining journey to both need the same cell — which is
// impossible, since a Hamiltonian path visits every cell once?
//
// For each pair of remaining legs (legs[i], legs[i+1], ..., a leg is one (s, t) checkpoint-to-
// checkpoint hop, with the first leg starting at the live head), segBlocker(s, t) gives the cells
// EVERY route for that leg must use. Two legs' true sub-paths in any valid solution are disjoint,
// except that two CONSECUTIVE legs share exactly their common endpoint (leg i's t is leg i+1's
// s). So: any forced cell shared by two legs that are not immediately consecutive is already a
// contradiction, and even for consecutive legs, sharing a forced cell OTHER than their shared
// checkpoint is a contradiction. This generalizes segBlocker's own single-leg guarantee across
// the whole remaining sequence — sound for any puzzle, independent of how it was generated.
//
// legs: array of [s, t] cell-index pairs, in journey order (e.g. [[head, pos[need]],
// [pos[need], pos[need+1]], ...]). Returns true if a contradiction is found (infeasible),
// false if none of the pairwise checks find one (not a full guarantee of feasibility — this is
// a necessary, not sufficient, condition, same as every other prune here).
//
// Cost: O(legs^2) segBlocker calls, each O(free region size) — quadratic in remaining checkpoint
// count, so this is meant for one-shot use (the play-mode overlay, or opt-in on small K), not
// unconditionally in the solver's hot loop.
export function legsCollide(nb, T, vis, legs) {
  const blockers = legs.map(([s, t]) => segBlocker(nb, T, vis, s, t));
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const sharedEndpoint = legs[i][1] === legs[j][0] && j === i + 1 ? legs[i][1] : -1;
      for (const c of blockers[i]) {
        if (c === sharedEndpoint) continue;
        if (blockers[j].has(c)) return true;
      }
    }
  }
  return false;
}

// Number of set bits in a 4-bit direction mask. Shared with solve.js's DFS hot path.
const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// Standalone, one-shot version of solve.js's propagate(): forced-edge deduction from a fixed
// head cell over the currently-unvisited region. Not used by the solver's hot loop (that keeps
// its own incremental state across DFS depth for speed) — this is the same deduction rule
// recomputed from scratch each call, for the play-mode overlay to visualize.
//
// Every unvisited cell needs path-degree 2 (1 for the end cell), head needs 1 more edge. A cell
// down to exactly that many open edges forces all of them; propagate forces transitively via
// union-find, same as solve.js's propagate(). See that function for the full rationale.
//
// Returns { forced: Set<cell>, dirs: Uint8Array, infeasible: boolean }.
//   forced      = unvisited cells (excluding head) with at least one forced edge — i.e. cells the
//                 deduction has pinned down as "the path must use this specific connection here"
//   dirs        = per-cell forced-direction bitmask (bit d set = direction d is a forced edge),
//                 same encoding as solve.js's fr[]. A cell can have 1 or 2 bits set; forced.has()
//                 is equivalent to dirs[cell] !== 0, dirs is the finer-grained detail.
//   infeasible  = true if the deduction already proves this position can't be completed (a forced
//                 cycle, a cell driven below its required degree, or a forced head-to-end chain
//                 that doesn't yet cover every uncovered cell) — mirrors propagate()'s false return
export function forcedEdges(nb, T, vis, head, end) {
  if (head < 0 || head === end) return { forced: new Set(), dirs: new Uint8Array(T), infeasible: false };

  const av = new Uint8Array(T);
  const fr = new Uint8Array(T);
  const fd = new Uint8Array(T);
  const dg = new Uint8Array(T);
  const par = new Int32Array(T);
  const sz = new Int32Array(T);
  const pq = new Int32Array(T);
  let qt = 0;

  let count = 0; // visited so far, including head
  for (let i = 0; i < T; i++) if (vis[i]) count++;
  const pneed = T - count + 1;

  const required = u => (u === head || u === end ? 1 : 2);
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };

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

  function force(u, d) {
    if ((fr[u] >> d) & 1) return true;
    const v = nb[u * 4 + d];
    fr[u] |= 1 << d;
    fr[v] |= 1 << (d ^ 1);
    fd[u]++;
    if (fd[u] > required(u)) return false;
    fd[v]++;
    if (fd[v] > required(v)) return false;

    let a = find(u), b = find(v);
    if (a === b) return false;
    if (sz[a] < sz[b]) { const t = a; a = b; b = t; }
    par[b] = a;
    sz[a] += sz[b];

    const chainRoot = find(head);
    if (chainRoot === find(end) && sz[chainRoot] !== pneed) return false;

    if (fd[u] >= required(u) && !dropEdges(u)) return false;
    if (fd[v] >= required(v) && !dropEdges(v)) return false;
    return true;
  }

  for (let i = 0; i < T; i++) {
    if (vis[i] && i !== head) continue;
    let mask = 0;
    for (let d = 0; d < 4; d++) {
      const w = nb[i * 4 + d];
      if (w >= 0 && (!vis[w] || w === head)) mask |= 1 << d;
    }
    av[i] = mask;
    fr[i] = 0;
    fd[i] = 0;
    par[i] = i;
    sz[i] = 1;
  }

  const cells = [];
  for (let i = 0; i < T; i++) if (!vis[i] || i === head) cells.push(i);

  for (const u of cells) {
    const need = required(u);
    const degree = POPCOUNT[av[u]];
    dg[u] = degree;
    if (degree < need) return { forced: new Set(), dirs: new Uint8Array(T), infeasible: true };
    if (degree === need) pq[qt++] = u;
  }

  for (let h = 0; h < qt; h++) {
    const u = pq[h];
    for (let d = 0; d < 4; d++) {
      const open = ((av[u] & ~fr[u]) >> d) & 1;
      if (open && !force(u, d)) return { forced: new Set(), dirs: new Uint8Array(T), infeasible: true };
    }
  }

  const forced = new Set();
  for (const u of cells) {
    if (u === head) continue;
    if (fr[u] !== 0) forced.add(u);
  }
  return { forced, dirs: fr, infeasible: false };
}
