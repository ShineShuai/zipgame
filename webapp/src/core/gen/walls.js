import { solve } from '../solver/solve.js';
import { allEdges, hasWallId, setWallId, pathEdgeIds } from '../edges.js';
import { shuffle } from '../rng.js';

// Generators (function*) so callers can drive them synchronously (tests) or time-sliced (UI).
// Yielded values are progress events { frac, walls, K }.

// 0/1 lookup by edge id: which edges a path uses.
function edgeMarks(n, path) {
  const marks = new Uint8Array(n * n * 2);
  for (const e of pathEdgeIds(n, path)) marks[e] = 1;
  return marks;
}

// Add walls to p (checkpoints set, no walls) until it has exactly one solution.
// `path` is the anchor solution: none of its edges is ever walled.
// cfg: { nodeCap, wallBudget (null = all edges), seedFraction, K, prop (solver propagation) }
// Returns the wall insertion order (array of edge ids), or null if no unique puzzle was reached.
export function* makeUnique(p, path, rnd, cfg) {
  const n = p.n;
  const { nodeCap, seedFraction, K, prop } = cfg;
  const all = allEdges(n);
  const maxWalls = cfg.wallBudget == null ? all.length : cfg.wallBudget;
  const anchor = edgeMarks(n, path);
  const pool = shuffle(all.filter(e => !anchor[e]), rnd); // walls we may still place, in random order
  const order = [];                                       // walls placed so far
  let next = 0;                                           // first pool index not handed out yet

  const addWall = e => {
    setWallId(p.walls, e, true);
    order.push(e);
  };
  const search = (cap, capture) => solve(p, { limit: 2, nodeCap: cap, capture, prop });
  const progress = () => ({ frac: null, walls: order.length, K });

  // Next pool wall that is not already set, or null when the pool is used up.
  function nextPoolWall() {
    while (next < pool.length && hasWallId(p.walls, pool[next])) next++;
    return next < pool.length ? pool[next++] : null;
  }

  // A random edge used by exactly one of the two solutions (never an anchor edge), or null.
  // Walling it rules that solution out.
  function distinguishingWall(pathA, pathB) {
    const edgesA = pathEdgeIds(n, pathA);
    const edgesB = pathEdgeIds(n, pathB);
    const inA = edgeMarks(n, pathA);
    const inB = edgeMarks(n, pathB);
    let diff = edgesA.filter(e => !inB[e] && !anchor[e]);
    if (diff.length === 0) diff = edgesB.filter(e => !inA[e] && !anchor[e]);
    if (diff.length === 0) return null;
    return diff[Math.floor(rnd() * diff.length)];
  }

  // Pre-wall a share of the free edges at random, so the searches below start from a tighter puzzle.
  const seedCount = seedFraction > 0
    ? Math.min(Math.floor(pool.length * seedFraction), pool.length, maxWalls)
    : 0;
  for (let i = 0; i < seedCount; i++) addWall(pool[i]);
  next = seedCount;
  if (seedCount > 0) yield progress();

  // Cheap probe: keep walling while even a small search budget is exceeded.
  const probeCap = Math.min(nodeCap, 4000);
  let probe = search(probeCap, false);
  while (probe.exceeded && next < pool.length && order.length < maxWalls) {
    addWall(pool[next++]);
    probe = search(probeCap, false);
    yield progress();
  }

  let result = search(nodeCap, true);
  while ((result.count > 1 || result.exceeded) && order.length < maxWalls) {
    if (result.count === 0) return null;
    const wall = result.exceeded ? nextPoolWall() : distinguishingWall(result.paths[0], result.paths[1]);
    if (wall === null) return null;
    addWall(wall);
    result = search(nodeCap, true);
    yield progress();
  }
  return result.count === 1 && !result.exceeded ? order : null;
}

// Remove every wall (random order, once) whose removal keeps the solution unique.
// Mutates p.walls. Returns { removed, kept }.
export function* minimizeWalls(p, order, rnd, checkCap, K, prop) {
  const list = shuffle([...order], rnd);
  let kept = list.length;
  for (const wall of list) {
    setWallId(p.walls, wall, false);
    const check = solve(p, { limit: 2, nodeCap: checkCap, prop });
    if (check.count === 1 && !check.exceeded) {
      kept--;
    } else {
      setWallId(p.walls, wall, true);
    }
    yield { frac: null, walls: kept, K };
  }
  return { removed: list.length - kept, kept };
}
