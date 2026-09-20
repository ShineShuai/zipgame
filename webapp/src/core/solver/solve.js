import { maxNumber, startCell, endCell } from '../model.js';
import { hasWall } from '../edges.js';

// Direction order R,L,D,U is part of the seeded-generation contract (tie-breaks). Do not change without bumping ALGO_VERSION.
const DR = [0, 0, 1, -1], DC = [1, -1, 0, 0];

// Hamiltonian-path search: start at checkpoint 1, hit checkpoints in order, end on the max checkpoint, cover every cell.
// opts: limit (stop after N solutions, default 2), nodeCap (default 200000), capture (return paths), prune2 / prop (opt-in, prune-only: fewer nodes, same solutions in the same DFS order).
// prop = forced-edge propagation: every unvisited cell needs path-degree 2 (1 for the end, 1 more edge for the head), so cells with exactly that many open edges force them; saturated cells drop their other edges; forced cycles / early head-end chains prune.
// Returns { count, exceeded, nodes, paths? }. Pure: no DOM, no timers, no randomness.
export function solve(p, opts = {}) {
  const n = p.n, T = n * n, cp = p.cp, limit = opts.limit ?? 2, cap = opts.nodeCap || 200000;
  const K = maxNumber(p), start = startCell(p), end = endCell(p);
  if (K < 1 || start < 0) return { count: 0, exceeded: false, nodes: 0, paths: opts.capture ? [] : undefined };

  const nb = new Int32Array(T * 4).fill(-1); // open neighbours per direction, -1 = wall/border
  const row = new Int32Array(T), col = new Int32Array(T);
  for (let i = 0; i < T; i++) {
    const r = (i / n) | 0, c = i % n; row[i] = r; col[i] = c;
    for (let d = 0; d < 4; d++) {
      const rr = r + DR[d], cc = c + DC[d];
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const j = rr * n + cc;
      if (!hasWall(p, i, j)) nb[i * 4 + d] = j;
    }
  }
  const pos = new Int32Array(K + 1).fill(-1);
  for (let i = 0; i < T; i++) if (cp[i]) pos[cp[i]] = i;

  // prune2: wall-aware BFS distance from every checkpoint + suffix sums of inter-checkpoint distances.
  let D = null, suf = null;
  if (opts.prune2) {
    D = new Int32Array((K + 1) * T).fill(-1);
    for (let k = 1; k <= K; k++) {
      const q = [pos[k]]; D[k * T + pos[k]] = 0;
      for (let h = 0; h < q.length; h++) for (let d = 0; d < 4; d++) { const v = nb[q[h] * 4 + d]; if (v >= 0 && D[k * T + v] < 0) { D[k * T + v] = D[k * T + q[h]] + 1; q.push(v); } }
    }
    suf = new Int32Array(K + 2);
    for (let k = K - 1; k >= 1; k--) { const d = D[k * T + pos[k + 1]]; suf[k] = d < 0 ? 1e9 : suf[k + 1] + d; }
  }

  // prop scratch (only allocated when enabled). av/fr = open/forced edge bits per cell (bit d = direction d), dg/fd = their counts.
  const PROP = !!opts.prop, POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  const av = PROP ? new Uint8Array(T) : null, fr = PROP ? new Uint8Array(T) : null, fd = PROP ? new Uint8Array(T) : null, dg = PROP ? new Uint8Array(T) : null;
  const par = PROP ? new Int32Array(T) : null, sz = PROP ? new Int32Array(T) : null, pq = PROP ? new Int32Array(T) : null;
  // incremental prop bookkeeping: nbm = static open-edge mask, vm = mask of visited neighbours, ul[0..un) = unvisited cells (swap-removed / restored LIFO)
  const nbm = PROP ? new Uint8Array(T) : null, vm = PROP ? new Uint8Array(T) : null, ul = PROP ? new Int32Array(T) : null, up = PROP ? new Int32Array(T) : null;
  let qt = 0, pcur = -1, pneed = 0, un = T;
  if (PROP) for (let i = 0; i < T; i++) { ul[i] = up[i] = i; let m = 0; for (let d = 0; d < 4; d++) if (nb[i * 4 + d] >= 0) m |= 1 << d; nbm[i] = m; }
  const reqOf = u => (u === pcur || u === end) ? 1 : 2;
  function find(x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
  function dropEdges(u) { // u has all the edges it needs: its other open edges are unusable
    const m = av[u] & ~fr[u];
    for (let d = 0; d < 4; d++) if ((m >> d) & 1) {
      const w = nb[u * 4 + d]; av[u] &= ~(1 << d); av[w] &= ~(1 << (d ^ 1)); dg[u]--;
      const r = reqOf(w); if (--dg[w] < r) return false; if (dg[w] === r) pq[qt++] = w;
    }
    return true;
  }
  function force(u, d) {
    if ((fr[u] >> d) & 1) return true;
    const v = nb[u * 4 + d]; fr[u] |= 1 << d; fr[v] |= 1 << (d ^ 1);
    if (++fd[u] > reqOf(u) || ++fd[v] > reqOf(v)) return false;
    let a = find(u), b = find(v); if (a === b) return false; // forced cycle
    if (sz[a] < sz[b]) { const t = a; a = b; b = t; } par[b] = a; sz[a] += sz[b];
    const rc = find(pcur); if (rc === find(end) && sz[rc] !== pneed) return false; // head->end chain that leaves cells uncovered
    return (fd[u] < reqOf(u) || dropEdges(u)) && (fd[v] < reqOf(v) || dropEdges(v));
  }
  function propagate(cur, count) { // false = this branch cannot be completed; on true, av[cur] holds the head's still-possible moves
    if (cur === end) return false; // count < T here: the path may only end on the last checkpoint
    pcur = cur; pneed = T - count + 1; qt = 0;
    for (let i = 0; i < un; i++) { const u = ul[i]; av[u] = nbm[u] & ~vm[u]; fr[u] = 0; fd[u] = 0; par[u] = u; sz[u] = 1; }
    av[cur] = nbm[cur] & ~vm[cur]; fr[cur] = 0; fd[cur] = 0; par[cur] = cur; sz[cur] = 1;
    for (let d = 0; d < 4; d++) { const u = nb[cur * 4 + d]; if (u >= 0 && !vis[u]) av[u] |= 1 << (d ^ 1); } // the head still counts as an open neighbour
    for (let i = 0; i < un; i++) { const u = ul[i], g = dg[u] = POP[av[u]], r = u === end ? 1 : 2; if (g < r) return false; if (g === r) pq[qt++] = u; }
    { const g = dg[cur] = POP[av[cur]]; if (g < 1) return false; if (g === 1) pq[qt++] = cur; }
    for (let h = 0; h < qt; h++) { const u = pq[h]; for (let d = 0; d < 4; d++) if (((av[u] & ~fr[u]) >> d) & 1 && !force(u, d)) return false; }
    return true;
  }
  function enter(c) { vis[c] = 1; if (!PROP) return; for (let d = 0; d < 4; d++) { const w = nb[c * 4 + d]; if (w >= 0) vm[w] |= 1 << (d ^ 1); } const last = ul[un - 1], i = up[c]; ul[i] = last; up[last] = i; ul[un - 1] = c; up[c] = un - 1; un--; }
  function leave(c) { vis[c] = 0; if (!PROP) return; un++; for (let d = 0; d < 4; d++) { const w = nb[c * 4 + d]; if (w >= 0) vm[w] &= ~(1 << (d ^ 1)); } }

  const vis = new Uint8Array(T), seen = new Int32Array(T), stack = new Int32Array(T);
  const cand = new Int32Array(T * 4), cdeg = new Int32Array(T * 4), pathBuf = new Int32Array(T);
  const paths = opts.capture ? [] : null;
  let stamp = 0, nodes = 0, found = 0;

  function connOk(cur, remaining) { // unvisited region must be one connected blob of the size still needed
    stamp++; let sp = 0, cnt = 0; stack[sp++] = cur; seen[cur] = stamp;
    while (sp > 0) {
      const u = stack[--sp];
      for (let d = 0; d < 4; d++) { const v = nb[u * 4 + d]; if (v < 0 || vis[v] || seen[v] === stamp) continue; seen[v] = stamp; cnt++; stack[sp++] = v; }
    }
    return cnt === remaining;
  }
  function noDeadEnd(cur) { // only neighbours of cur changed degree this step
    for (let d = 0; d < 4; d++) {
      const u = nb[cur * 4 + d]; if (u < 0 || vis[u]) continue;
      let free = 0;
      for (let e = 0; e < 4; e++) { const v = nb[u * 4 + e]; if (v < 0 || (vis[v] && v !== cur)) continue; free++; }
      if (free === 0 || (free === 1 && u !== end)) return false;
    }
    return true;
  }
  function dfs(cell, count, needed, depth) {
    nodes++;
    if (nodes > cap || found >= limit) return;
    enter(cell); pathBuf[depth] = cell;
    let need = needed; const m = cp[cell];
    if (m !== 0) { if (m !== need) { leave(cell); return; } need++; }
    if (count === T) {
      if (cell === end && need === K + 1) { found++; if (paths) paths.push(Array.from(pathBuf)); }
      leave(cell); return;
    }
    const remaining = T - count;
    if (!noDeadEnd(cell) || !connOk(cell, remaining) || (PROP && !propagate(cell, count))) { leave(cell); return; }
    const base = depth * 4; let k = 0;
    for (let d = 0; d < 4; d++) {
      const v = nb[cell * 4 + d]; if (v < 0 || vis[v] || (PROP && !((av[cell] >> d) & 1))) continue;
      const mm = cp[v]; if (mm !== 0 && mm !== need) continue;
      if (need <= K) {
        const tgt = pos[need];
        if (tgt >= 0 && Math.abs(row[v] - row[tgt]) + Math.abs(col[v] - col[tgt]) > remaining) continue; // Manhattan bound (legacy)
        if (D) { const dd = D[need * T + v]; if (dd < 0 || dd + suf[need] > remaining - 1) continue; }
      }
      let deg = 0; for (let e = 0; e < 4; e++) { const w = nb[v * 4 + e]; if (w >= 0 && !vis[w]) deg++; }
      let q = k++; // stable insertion sort by onward degree (most constrained first)
      while (q > 0 && cdeg[base + q - 1] > deg) { cdeg[base + q] = cdeg[base + q - 1]; cand[base + q] = cand[base + q - 1]; q--; }
      cdeg[base + q] = deg; cand[base + q] = v;
    }
    for (let i = 0; i < k; i++) { dfs(cand[base + i], count + 1, need, depth + 1); if (found >= limit || nodes > cap) break; }
    leave(cell);
  }
  dfs(start, 1, 1, 0);
  return { count: found, exceeded: nodes > cap, nodes, paths: paths || undefined };
}
