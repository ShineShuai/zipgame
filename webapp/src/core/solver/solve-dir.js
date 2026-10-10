import { maxNumber, startCell, endCell } from '../model.js';
import { arrowAllows } from '../edges.js';
import { buildNeighbors } from './prune.js';

// Solver for puzzles with one-way arrows (puzzle.arrows, see core/edges.js). solve() hands such
// puzzles over here.
//
// The board is a mixed graph: most edges are two-way, an arrow edge can be walked in one direction
// only. The standard solver (solve.js) and its prunes assume every edge is two-way (degree 2 per
// cell, undirected flood fills, ...), so none of them is reused. This is plain DFS with prunes
// that are sound for directed edges:
//   - every unvisited cell must be reachable from the head, and must reach the end, through
//     unvisited cells (this also catches a cell nothing can enter, and a cell nothing can leave
//     but the end)
//   - a neighbour of the head that no unvisited cell can lead into has to be the very next move
//   - Manhattan distance along the remaining checkpoints has to fit in the cells left
//   - at the root, the parity of that distance (the grid is bipartite). Below the root it never
//     fires: a move flips both sides of the comparison.
// Measured (25 random 6x6 / 7x7 puzzles with ~20% arrows, node totals): without the reach-to-end
// test +63%, without the reach-from-head test +11% / +24%, without the Manhattan bound +11%,
// without the forced neighbour +2.6%. Per-cell predecessor / successor tests on the cells a move
// touches changed nothing on top of the two reach tests.
//
// opts (a subset of solve()'s): limit (default 2), nodeCap (default 200000), capture, forced,
// decisions, mustUse.
//   mustUse  [a, b]: only count solutions that walk the move a -> b (directed: b can only be
//            entered from a, a only left to b). In solve() it is the edge a-b, either way; with
//            arrows the direction matters.
//   prune2, prop, seg, pocket, parity, legCollide, incr, fast, lconn belong to solve.js and are
//   ignored here: they only prune, and the checks above are always on.
// Returns { count, exceeded, nodes, subNodes, paths?, decisionNodes?, maxDecisionDepth? } like
// solve(). Pure.

// Out- and in-neighbours of every cell: out[cell * 4 + d] = cell reached by the allowed move in
// direction d (order R, L, D, U; -1 = none); pre[cell * 4 + k] = the k-th cell that can move onto
// it (filled from k = 0, then -1). Walls, holes and the border are handled by buildNeighbors();
// arrows then remove the forbidden direction.
export function buildMoves(p) {
  const T = p.n * p.n;
  const { nb: out, row, col } = buildNeighbors(p);
  if (p.arrows) {
    for (let u = 0; u < T; u++) {
      for (let d = 0; d < 4; d++) {
        const v = out[u * 4 + d];
        if (v >= 0 && !arrowAllows(p.arrows, p.n, u, v)) out[u * 4 + d] = -1;
      }
    }
  }
  const pre = new Int32Array(T * 4).fill(-1);
  const preCount = new Uint8Array(T);
  for (let u = 0; u < T; u++) {
    for (let d = 0; d < 4; d++) {
      const v = out[u * 4 + d];
      if (v >= 0) pre[v * 4 + preCount[v]++] = u;
    }
  }
  return { out, pre, row, col, T };
}

export function solveDirected(p, opts = {}) {
  const T = p.n * p.n;
  const holes = p.holes || null;
  let TC = T;
  if (holes) {
    for (let i = 0; i < T; i++) if (holes[i]) TC--;
  }
  const cp = p.cp;
  const K = maxNumber(p);
  const start = startCell(p);
  const end = endCell(p);
  const limit = opts.limit ?? 2;
  const cap = opts.nodeCap || 200000;
  const MA = opts.mustUse ? opts.mustUse[0] : -1;
  const MB = opts.mustUse ? opts.mustUse[1] : -1;
  const none = {
    count: 0,
    exceeded: false,
    nodes: 0,
    subNodes: 0,
    paths: opts.capture ? [] : undefined,
    ...(opts.decisions ? { decisionNodes: 0, maxDecisionDepth: 0 } : {}),
  };
  if (K < 1 || start < 0 || (holes && cp.some((v, i) => v && holes[i]))) return none;
  // b can never be entered / a can never be left
  if (MA >= 0 && (MB === start || MA === end)) return none;

  const { out, pre, row, col } = buildMoves(p);
  const pos = new Int32Array(K + 2).fill(-1);
  for (let i = 0; i < T; i++) if (cp[i]) pos[cp[i]] = i;
  for (let k = 1; k <= K; k++) if (pos[k] < 0) return none; // gap in the numbering

  // sufMan[k] = summed Manhattan distance along checkpoints k -> k+1 -> ... -> K: a path through
  // them is at least that long, and as long as it modulo 2.
  const manhattan = (a, b) => Math.abs(row[a] - row[b]) + Math.abs(col[a] - col[b]);
  const sufMan = new Int32Array(K + 2);
  for (let k = K - 1; k >= 1; k--) sufMan[k] = sufMan[k + 1] + manhattan(pos[k], pos[k + 1]);
  // The path has TC - 1 steps; the grid is bipartite, so that has the parity of the legs (and
  // fits them).
  if (sufMan[1] > TC - 1 || ((TC - 1 - sufMan[1]) & 1) !== 0) return none;

  // ---------- search state ----------

  const vis = new Uint8Array(T);
  const pathBuf = new Int32Array(T);
  const cand = new Int32Array(T * 4);
  const cdeg = new Int32Array(T * 4);
  const seen = new Int32Array(T);
  const stack = new Int32Array(T);
  const paths = opts.capture ? [] : null;
  const forced = opts.forced || null;
  const prefix = forced ? forced.length - 1 : 0;
  const DECISIONS = !!opts.decisions;
  let stamp = 0;
  let nodes = 0;
  let found = 0;
  let decisionNodes = 0;
  let maxDecisionDepth = 0;

  // ---------- prunes ----------

  // Counts the unvisited cells reachable from the head over unvisited cells.
  function reachFrom(head) {
    stamp++;
    let sp = 0;
    let reached = 0;
    stack[sp++] = head;
    seen[head] = stamp;
    while (sp > 0) {
      const u = stack[--sp];
      for (let d = 0; d < 4; d++) {
        const v = out[u * 4 + d];
        if (v < 0 || vis[v] || seen[v] === stamp) continue;
        seen[v] = stamp;
        reached++;
        stack[sp++] = v;
      }
    }
    return reached;
  }

  // The same backwards from the end: how many unvisited cells can still get to it (the end
  // counts).
  function reachTo() {
    stamp++;
    let sp = 0;
    let reached = 1;
    stack[sp++] = end;
    seen[end] = stamp;
    while (sp > 0) {
      const u = stack[--sp];
      for (let k = 0; k < 4; k++) {
        const w = pre[u * 4 + k];
        if (w < 0) break;
        if (vis[w] || seen[w] === stamp) continue;
        seen[w] = stamp;
        reached++;
        stack[sp++] = w;
      }
    }
    return reached;
  }

  // The node's own check; `head` is on the path already, `count` cells are.
  function feasible(head, count) {
    const remaining = TC - count;
    return reachFrom(head) === remaining && reachTo() === remaining;
  }

  // ---------- search ----------

  // used: the must-use move (opts.mustUse) is already on the path.
  function dfs(cell, count, need, depth, used) {
    nodes++;
    if (nodes - prefix > cap || found >= limit) return;
    vis[cell] = 1;
    pathBuf[depth] = cell;

    // Checkpoints have to be entered in order.
    let needNext = need;
    if (cp[cell] !== 0) {
      if (cp[cell] !== need) {
        vis[cell] = 0;
        return;
      }
      needNext++;
    }

    if (count === TC) {
      if (cell === end && needNext === K + 1 && (MA < 0 || used)) {
        found++;
        if (paths) paths.push(Array.from(pathBuf.subarray(0, TC)));
      }
      vis[cell] = 0;
      return;
    }
    if (cell === end || !feasible(cell, count)) { // the end is entered last
      vis[cell] = 0;
      return;
    }

    // A neighbour no unvisited cell can lead into has to be entered straight from here: two of
    // them is a dead end.
    let mustNext = -1;
    let clash = false;
    for (let d = 0; d < 4; d++) {
      const v = out[cell * 4 + d];
      if (v < 0 || vis[v]) continue;
      let fed = false;
      for (let k = 0; k < 4 && !fed; k++) {
        const w = pre[v * 4 + k];
        fed = w >= 0 && !vis[w];
      }
      if (fed) continue;
      if (mustNext >= 0) clash = true;
      mustNext = v;
    }

    // Candidate moves, most constrained first (stable insertion sort by onward out-degree).
    const remaining = TC - count;
    const base = depth * 4;
    let count2 = 0;
    for (let d = 0; d < 4 && !clash; d++) {
      const v = out[cell * 4 + d];
      if (v < 0 || vis[v]) continue;
      if (mustNext >= 0 && v !== mustNext) continue;
      if (forced && depth < prefix && v !== forced[depth + 1]) continue;
      if (MA >= 0 && !used && ((cell === MA && v !== MB) || (v === MB && cell !== MA))) continue;
      if (cp[v] !== 0 && cp[v] !== needNext) continue;
      if (needNext <= K) {
        // `remaining - 1` cells are left after the move: the legs from v through the remaining
        // checkpoints have to fit.
        if (manhattan(v, pos[needNext]) + sufMan[needNext] > remaining - 1) continue;
      }
      let degree = 0;
      for (let e = 0; e < 4; e++) {
        const w = out[v * 4 + e];
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
      const frac = depth / T;
      if (frac > maxDecisionDepth) maxDecisionDepth = frac;
    }

    for (let i = 0; i < count2; i++) {
      const next = cand[base + i];
      const nowUsed = used || (cell === MA && next === MB) ? 1 : 0;
      dfs(next, count + 1, needNext, depth + 1, nowUsed);
      if (found >= limit || nodes - prefix > cap) break;
    }
    vis[cell] = 0;
  }

  dfs(start, 1, 1, 0, 0);
  return {
    count: found,
    exceeded: nodes - prefix > cap,
    nodes,
    subNodes: Math.max(0, nodes - prefix),
    paths: paths || undefined,
    ...(DECISIONS ? { decisionNodes, maxDecisionDepth } : {}),
  };
}
