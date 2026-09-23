import { endCell } from './model.js';
import { buildNeighbors, makeReachable, isDeadEnd } from './solver/prune.js';

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
