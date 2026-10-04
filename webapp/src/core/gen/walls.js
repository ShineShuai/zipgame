import { solve } from '../solver/solve.js';
import { allEdges, hasWallId, setWallId, pathEdgeIds, edgeCells } from '../edges.js';
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
// cfg: { nodeCap, wallBudget (null = all edges), seedFraction, K, prop (solver propagation),
//        legCollide (leg-collision pruning), counts (optional call-count accumulator),
//        flags (optional full solve() opts object — pocket/parity/prune2/seg — overrides
//        prop/legCollide above when given; see gen/flags.js. Absent = same as before: only
//        prop/legCollide reach solve()) }
// counts, when passed, is mutated in place: counts.makeUnique is incremented once per solve()
// call made here (the probe loop and the main search loop both count against it).
// Returns the wall insertion order (array of edge ids), or null if no unique puzzle was reached.
export function* makeUnique(p, path, rnd, cfg) {
  const n = p.n;
  const { nodeCap, seedFraction, K, prop, legCollide, counts, flags } = cfg;
  const solveOpts = flags ? { ...flags } : { prop, legCollide };
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
  const search = (cap, capture) => {
    if (counts) counts.makeUnique++;
    return solve(p, { limit: 2, nodeCap: cap, capture, ...solveOpts });
  };
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
// opts: { prop, legCollide, flags (optional full solve() opts — see makeUnique above; overrides
//        prop/legCollide when given), counts (optional call-count accumulator: counts.minimizeWalls
//        is incremented once per solve() call made here),
//        freedEdge (default false; flags.freedEdge when flags is given): test each removal with the
//        solver's mustUse option instead of a 2-solution search. Needs p to be uniquely solvable when
//        called (makeUnique's result, or a checked design): then, with the wall gone, the puzzle is still
//        unique iff no solution walks the freed edge, which is a smaller search that stops at its first
//        hit. Not the same decisions as the plain check when a node cap is hit, so it is opt-in and
//        changes seeded output,
//        bound (optional, a wall count): stop early with { removed: 0, kept: Infinity, aborted: true }
//        once this many walls have had to stay, since a result of `bound` or more walls is of no use to
//        the caller (generate() keeps only a candidate with fewer walls than its best so far). Never
//        changes which result a caller that ignores such candidates ends up with }
// Back-compat: a bare boolean 6th positional arg (the old `prop`) is still accepted, so any code
// still calling minimizeWalls(p, order, rnd, checkCap, K, true) keeps working unchanged.
export function* minimizeWalls(p, order, rnd, checkCap, K, opts = {}) {
  if (typeof opts === 'boolean') opts = { prop: opts };
  const { prop, legCollide, counts, flags, bound } = opts;
  const solveOpts = flags ? { ...flags } : { prop, legCollide };
  const freedEdge = opts.freedEdge ?? !!solveOpts.freedEdge;
  delete solveOpts.freedEdge; // a flag of this loop, not a solve() option
  const list = shuffle([...order], rnd);
  let kept = list.length;
  let retained = 0; // walls that had to stay so far; the final `kept` ends up equal to it
  for (const wall of list) {
    setWallId(p.walls, wall, false);
    if (counts) counts.minimizeWalls++;
    let removable;
    if (freedEdge) {
      const [a, b] = edgeCells(p.n, wall);
      const check = solve(p, { limit: 1, nodeCap: checkCap, mustUse: [a, b], ...solveOpts });
      removable = check.count === 0 && !check.exceeded;
    } else {
      const check = solve(p, { limit: 2, nodeCap: checkCap, ...solveOpts });
      removable = check.count === 1 && !check.exceeded;
    }
    if (removable) {
      kept--;
    } else {
      setWallId(p.walls, wall, true);
      if (++retained >= bound) return { removed: 0, kept: Infinity, aborted: true };
    }
    yield { frac: null, walls: kept, K };
  }
  return { removed: list.length - kept, kept };
}
