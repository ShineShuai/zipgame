import { endCell, maxNumber } from './model.js';
import { buildNeighbors, makeReachable, isDeadEnd, forcedEdges, legsCollide } from './solver/prune.js';

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
  const { nb, T } = buildNeighbors(p);
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  const end = endCell(p);
  if (head < 0) return { forced: new Set(), dirs: new Uint8Array(T), infeasible: false };
  return forcedEdges(nb, T, vis, head, end);
}

// Live checkpoint-order contradiction check, for the design app's play-mode overlay.
//
// Drives legsCollide() from solver/prune.js: for the remaining journey head -> next checkpoint ->
// next -> ... -> end, each hop's forced must-pass-through cells (segBlocker) must not collide with
// another hop's — a Hamiltonian path visits every cell once, so two different hops both requiring
// the same cell (other than the one checkpoint they share) is a proof the position is already
// unsolvable, even when connOk/dead-ends/forced-edge propagation all still say the position looks
// fine. See legsCollide()'s own comment for the full soundness argument — general to any puzzle,
// not tied to how it was generated. Pure, no DOM.
//
// Returns { infeasible: boolean } — true means the current position, however open it still looks
// by every other check, cannot be completed. Cost is O(K^2) segBlocker calls (K = remaining
// checkpoints), each proportional to the size of the free region — fine for a one-shot UI check on
// pointer move, not something to run unconditionally per solver node (see prune.js for that
// tradeoff if it's ever wired into solve()).
export function boardLegOrder(p, path) {
  const { nb, T } = buildNeighbors(p);
  const vis = new Uint8Array(T);
  for (const c of path) vis[c] = 1;
  const head = path.length ? path[path.length - 1] : -1;
  if (head < 0) return { infeasible: false };

  const K = maxNumber(p);
  const pos = new Int32Array(K + 1).fill(-1);
  for (let i = 0; i < T; i++) if (p.cp[i]) pos[p.cp[i]] = i;

  let need = 1;
  for (const c of path) if (p.cp[c]) need = p.cp[c] + 1;
  if (need > K) return { infeasible: false }; // already on the final checkpoint or past it

  const legs = [[head, pos[need]]];
  for (let k = need; k < K; k++) legs.push([pos[k], pos[k + 1]]);
  return { infeasible: legsCollide(nb, T, vis, legs) };
}
