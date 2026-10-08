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
  const all = allEdges(n, p.holes); // no wall is ever put next to a hole
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

// Per-check node caps of refineWalls()' passes, as multiples of the first look's check cap: cheap removals
// first, the big searches last.
export const REFINE_CAP_X = [8, 32, 128];

// The options the removal checks of the functions below share: the solve() options (without freedEdge,
// which is a flag of these loops, not a solve() option) and whether the freed-edge check is used.
// `fallback` is the freedEdge value when neither opts nor opts.flags says.
function checkOptions(opts, fallback) {
  const { prop, legCollide, flags } = opts;
  const solveOpts = flags ? { ...flags } : { prop, legCollide };
  const freedEdge = opts.freedEdge ?? solveOpts.freedEdge ?? fallback;
  delete solveOpts.freedEdge;
  return { solveOpts, freedEdge: !!freedEdge };
}

// Take `wall` out of p and test whether p stays uniquely solvable, the search capped at `cap` nodes.
// freedEdge: search only for a solution through the freed edge (p must be unique when called); else
// a plain two-solution search. The wall goes back in unless it is removable.
// Returns { removable, capped, nodes }. A wall that is neither removable nor capped is necessary for
// good (a solution was found; removing more walls only adds solutions). A capped one is undecided.
// counts, when given, gets counts.minimizeWalls++ per call.
export function tryRemoveWall(p, wall, cap, solveOpts, freedEdge, counts) {
  setWallId(p.walls, wall, false);
  if (counts) counts.minimizeWalls++;
  let check;
  if (freedEdge) {
    const [a, b] = edgeCells(p.n, wall);
    check = solve(p, { limit: 1, nodeCap: cap, mustUse: [a, b], ...solveOpts });
  } else {
    check = solve(p, { limit: 2, nodeCap: cap, ...solveOpts });
  }
  const removable = !check.exceeded && check.count === (freedEdge ? 0 : 1);
  if (!removable) setWallId(p.walls, wall, true);
  return { removable, capped: !!check.exceeded, nodes: check.nodes };
}

// Remove every wall (random order, once) whose removal keeps the solution unique.
// Mutates p.walls. Returns { removed, kept, uncertain }: uncertain = the walls kept only because their
// check hit checkCap. They may still be removable: refineWalls() takes a deeper look at them, and
// minimizeFully() below does both. Every other kept wall is necessary for good.
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
// Events: { frac: null, walls, K } (walls = the count left so far).
// Back-compat: a bare boolean 6th positional arg (the old `prop`) is still accepted, so any code
// still calling minimizeWalls(p, order, rnd, checkCap, K, true) keeps working unchanged.
export function* minimizeWalls(p, order, rnd, checkCap, K, opts = {}) {
  if (typeof opts === 'boolean') opts = { prop: opts };
  const { counts, bound } = opts;
  const { solveOpts, freedEdge } = checkOptions(opts, false);
  const list = shuffle([...order], rnd);
  let kept = list.length;
  let retained = 0; // walls that had to stay so far; the final `kept` ends up equal to it
  const uncertain = [];
  for (const wall of list) {
    const r = tryRemoveWall(p, wall, checkCap, solveOpts, freedEdge, counts);
    if (r.removable) {
      kept--;
    } else {
      if (r.capped) uncertain.push(wall);
      if (++retained >= bound) return { removed: 0, kept: Infinity, aborted: true };
    }
    yield { frac: null, walls: kept, K };
  }
  return { removed: list.length - kept, kept, uncertain };
}

// A deeper look at the walls minimizeWalls() kept only because a check hit its node cap (`uncertain`).
// Needs p uniquely solvable, which minimizeWalls leaves it. Spends at most opts.budget solver nodes in
// total (a node count, never a clock, so a seeded run stays reproducible), in one pass per entry of
// opts.caps (ascending per-check caps, absolute node counts; REFINE_CAP_X * the first look's cap is the
// usual choice). A check that finds a solution through the freed edge settles its wall for good, so
// only the walls that hit the cap again go to the next pass.
// opts: { caps, budget (default Infinity), prop, legCollide, flags, freedEdge (as in minimizeWalls, but
//        default true here), counts, walls (the wall count of p now, default: counted), K (passed through
//        to the events) }
// Mutates p.walls. Events: { frac: null, walls, K, nodes, removed, budget } (the first three as in
// minimizeWalls, so a caller can use one progress handler for both). Returns
// { removed, kept (the wall count now), left (walls still undecided), nodes }.
export function* refineWalls(p, uncertain, rnd, opts = {}) {
  const { counts, caps = [], budget = Infinity, K } = opts;
  const { solveOpts, freedEdge } = checkOptions(opts, true);
  let current = opts.walls ?? allEdges(p.n).filter(e => hasWallId(p.walls, e)).length;
  let todo = shuffle([...uncertain], rnd);
  let nodes = 0;
  let removed = 0;
  for (const cap of caps) {
    const undecided = [];
    for (let i = 0; i < todo.length; i++) {
      const room = budget - nodes;
      if (room <= 0) {
        undecided.push(...todo.slice(i));
        break;
      }
      const r = tryRemoveWall(p, todo[i], Math.min(cap, room), solveOpts, freedEdge, counts);
      nodes += r.nodes;
      if (r.removable) {
        removed++;
        current--;
      } else if (r.capped) {
        undecided.push(todo[i]);
      }
      yield { frac: null, walls: current, K, nodes, removed, budget };
    }
    todo = undecided;
    if (!todo.length || nodes >= budget) break;
  }
  return { removed, kept: current, left: todo, nodes };
}

// minimizeWalls(), then refineWalls() on the walls it left undecided: the design app's Minimize button
// and generateUnique() use it; generate() runs the two apart, because it refines only its best candidate.
// opts: those of minimizeWalls, plus
//   refineBudget (default 0 = no deeper look): total solver nodes of the second look,
//   refineCapX (default REFINE_CAP_X): its passes' per-check caps as multiples of checkCap,
//   maxKept (optional): skip the second look when even removing every undecided wall would leave more
//        than this many walls, since the caller would not use the result.
// Events as in minimizeWalls (the second look's also carry nodes, removed and budget).
// Returns { removed, kept, uncertain }: uncertain = the walls still undecided (empty = every kept
// wall is necessary), or, when bound aborted the run, what minimizeWalls returns.
export function* minimizeFully(p, order, rnd, checkCap, K, opts = {}) {
  if (typeof opts === 'boolean') opts = { prop: opts };
  const first = yield* minimizeWalls(p, order, rnd, checkCap, K, opts);
  const budget = opts.refineBudget ?? 0;
  if (first.aborted || budget <= 0 || !first.uncertain.length) return first;
  if (opts.maxKept != null && first.kept - first.uncertain.length > opts.maxKept) return first;
  const caps = (opts.refineCapX ?? REFINE_CAP_X).map(x => x * checkCap);
  const r = yield* refineWalls(p, first.uncertain, rnd, { ...opts, caps, budget, walls: first.kept, K });
  return { removed: first.removed + r.removed, kept: r.kept, uncertain: r.left };
}
