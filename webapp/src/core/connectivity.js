import { endCell, labelRanks } from './model.js';
import {
  buildNeighbors, makeReachable, isDeadEnd, forcedEdges, legConflicts, segBlockerDir,
} from './solver/prune.js';
import { buildMoves } from './solver/solve-dir.js';
import { makeDirPropagator } from './solver/propagate-dir.js';

// Live per-cell status from the current path head, for the design app's play-mode overlay.
// Drives the exact same adjacency and flood-fill the solver's connOk prune uses (buildNeighbors /
// makeReachable from solver/prune.js), so the overlay can never disagree with what the solver
// would prune — only the presentation (the actual cell set, not just a count) differs.
// Pure, no DOM.
//
// Returns { reachable: Set<cell>, deadEnd: Set<cell>, unreachable: Set<cell>, connOk: boolean }
//   reachable   = unvisited cells reachable from head (includes dead ends)
//   deadEnd     = reachable unvisited cells with <=1 free neighbour and not the puzzle's end cell
//                 (a second one of these, besides a legal end, means the path is already stuck)
//   unreachable = unvisited cells NOT reachable from head at all
//   connOk      = same predicate the solver's connOk prune tests: reachable count equals the
//                 number of unvisited cells — false means the board has already split into pieces
//                 the path can no longer stitch back together
export function boardConnectivity(p, path) {
  if (p.arrows) return boardConnectivityDir(p, path);
  const { nb, T } = buildNeighbors(p);
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  const end = endCell(p);

  const reachable = new Set();
  let reachedCount = 0;
  if (head >= 0) reachedCount = makeReachable(nb, T, vis)(head, reachable);

  const deadEnd = new Set();
  const unreachable = new Set();
  for (let cell = 0; cell < T; cell++) {
    if (vis[cell]) continue;
    if (!reachable.has(cell)) { unreachable.add(cell); continue; }
    if (cell !== end && isDeadEnd(nb, vis, head, cell)) deadEnd.add(cell);
  }

  return { reachable, deadEnd, unreachable, connOk: reachedCount === T - path.length };
}

// Live forced-edge status from the current path head, for the design app's play-mode overlay.
// Drives the exact same deduction rule solve.js's prop prune uses (forcedEdges() from
// solver/prune.js, a standalone one-shot version of solve.js's internal propagate()), so the
// overlay can never disagree with what the prop-enabled solver would deduce at this position.
// Pure, no DOM.
//
// Returns { forced: Set<cell>, dirs: Uint8Array, infeasible: boolean }
//   forced      = unvisited cells the deduction has pinned at least one edge for
//   dirs        = per-cell forced-direction bitmask (see forcedEdges() for the encoding)
//   infeasible  = true if forced-edge deduction alone already proves the position is stuck
//                 (a stronger, later signal than connOk — connOk can still say "reachable" while
//                 forced-edge deduction has already found a contradiction)
export function boardPropagation(p, path) {
  if (p.arrows) return boardPropagationDir(p, path);
  const { nb, T } = buildNeighbors(p);
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  const end = endCell(p);
  if (head < 0) return { forced: new Set(), dirs: new Uint8Array(T), infeasible: false };
  return forcedEdges(nb, T, vis, head, end);
}

// Live leg-collision check, for the design app's play-mode overlay.
//
// Drives legsCollide() from solver/prune.js: for the remaining journey head -> next checkpoint ->
// next -> ... -> end, each hop's forced must-pass-through cells (segBlocker) must not collide with
// another hop's — a Hamiltonian path visits every cell once, so two different hops both requiring
// the same cell (other than the one checkpoint they share) is a proof the position is already
// unsolvable, even when connOk/dead-ends/forced-edge propagation all still say the position looks
// fine. This is not a checkpoint-order check (the order is fixed and never in question) — it is
// purely about two legs' required cells physically colliding. See legsCollide()'s own comment for
// the full soundness argument — general to any puzzle, not tied to how it was generated. Pure, no
// DOM.
//
// Returns { infeasible: boolean, conflicts: [{ a: [s,t], b: [s,t], cells: number[] }] } — a/b are the two
// colliding legs as [fromCell, toCell] (the first leg starts at the head), cells the forced cells both
// need. infeasible === conflicts.length > 0. infeasible true means the current position, however open it still looks
// by every other check, cannot be completed. Cost is O(K^2) segBlocker calls (K = remaining
// checkpoints), each proportional to the size of the free region — fine for a one-shot UI check on
// pointer move, not something to run unconditionally per solver node (see prune.js for that
// tradeoff if it's ever wired into solve()).
export function boardLegCollide(p, path) {
  const { nb, T } = p.arrows ? { nb: buildMoves(p).out, T: p.n * p.n } : buildNeighbors(p);
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  if (head < 0) return { infeasible: false, conflicts: [] };

  // Legs run between checkpoints in order: the numbers, or the ranks of an Exact puzzle's steps.
  const rank = labelRanks(p);
  let K = 0;
  for (const v of rank) if (v > K) K = v;
  const pos = new Int32Array(K + 1).fill(-1);
  for (let i = 0; i < T; i++) if (rank[i]) pos[rank[i]] = i;

  let need = 1;
  for (const c of path) if (rank[c]) need = rank[c] + 1;
  if (need > K) return { infeasible: false, conflicts: [] }; // already on the final checkpoint or past it

  const legs = [[head, pos[need]]];
  for (let k = need; k < K; k++) legs.push([pos[k], pos[k + 1]]);
  const blocker = p.arrows ? segBlockerDir : undefined; // arrows: routes are walks of allowed moves
  const conflicts = legConflicts(nb, T, vis, legs, blocker).map(({ i, j, cells }) => ({ a: legs[i], b: legs[j], cells }));
  return { infeasible: conflicts.length > 0, conflicts };
}

// ---------- One way arrows ----------
// The three overlays above on a puzzle with p.arrows, which has one-way edges: the same results
// (same shapes), computed over the allowed moves (buildMoves() of solve-dir.js) instead of the
// two-way neighbours, so what they show is what the directed solver would deduce.

// boardConnectivity for one-way moves. A cell is unreachable when the head cannot get to it by
// allowed moves, or when it cannot get to the end cell (a path that enters it could never go on to
// the end). A dead end is a cell, not the end, that a path cannot pass through: it has no unvisited
// cell to move on to, or no cell (the head counts) to be entered from, or only one and the same
// neighbour for both (the path would turn straight back). Unlike the two-way version this looks at
// every unvisited cell, not just the reachable ones: a cell that cannot be left is cut off from the
// end as well, and showing it as a dead end says why.
function boardConnectivityDir(p, path) {
  const moves = buildMoves(p), { out, pre, T } = moves;
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  const end = endCell(p);

  const flood = (from, next) => { // the unvisited cells reached from `from` over `next(cell) -> cells`
    const seen = new Set(), stack = [from];
    while (stack.length) {
      for (const v of next(stack.pop())) if (v >= 0 && !vis[v] && !seen.has(v)) { seen.add(v); stack.push(v); }
    }
    return seen;
  };
  const moveOut = u => [out[u * 4], out[u * 4 + 1], out[u * 4 + 2], out[u * 4 + 3]];
  const moveIn = u => [pre[u * 4], pre[u * 4 + 1], pre[u * 4 + 2], pre[u * 4 + 3]];
  const reachable = head >= 0 ? flood(head, moveOut) : new Set();
  // cells that can get to the end (while the end is free: once it is on the path, nothing can)
  const toEnd = end >= 0 && !vis[end] ? flood(end, moveIn).add(end) : null;

  const deadEnd = new Set(), unreachable = new Set();
  for (let cell = 0; cell < T; cell++) {
    if (vis[cell]) continue;
    if (!reachable.has(cell) || (toEnd && !toEnd.has(cell))) unreachable.add(cell);
    if (cell === end) continue;
    const exits = new Set(moveOut(cell).filter(v => v >= 0 && !vis[v]));
    const entries = new Set(moveIn(cell).filter(u => u >= 0 && (u === head || !vis[u])));
    const sameOnly = exits.size === 1 && entries.size === 1 && [...exits][0] === [...entries][0];
    if (!exits.size || !entries.size || sameOnly) deadEnd.add(cell);
  }
  const unvisited = T - path.length;
  return { reachable, deadEnd, unreachable, connOk: reachable.size === unvisited && unreachable.size === 0 };
}

// boardPropagation for one-way moves: a cell with one move left to make has it forced (makeDirPropagator
// of propagate-dir.js, the directed solver's own deduction). dirs marks both ends of a forced move,
// as the two-way version does for an edge.
function boardPropagationDir(p, path) {
  const moves = buildMoves(p), { out, T } = moves;
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  const end = endCell(p);
  const none = infeasible => ({ forced: new Set(), dirs: new Uint8Array(T), infeasible });
  if (head < 0 || head === end) return none(false);
  if (end >= 0 && vis[end]) return none(true); // the path can never end there now
  const prop = makeDirPropagator(moves, end, vis);
  if (!prop.deduce(head, T - path.length + 1)) return none(true);

  const dirs = new Uint8Array(T), forced = new Set();
  for (let u = 0; u < T; u++) {
    if (u === end || (vis[u] && u !== head)) continue;
    const mask = prop.av[u];
    if (!mask || (mask & (mask - 1))) continue; // none, or more than one move left: nothing forced
    const d = 31 - Math.clz32(mask), v = out[u * 4 + d];
    dirs[u] |= 1 << d;
    dirs[v] |= 1 << (d ^ 1);
    for (const c of [u, v]) if (c !== head) forced.add(c);
  }
  return { forced, dirs, infeasible: false };
}
