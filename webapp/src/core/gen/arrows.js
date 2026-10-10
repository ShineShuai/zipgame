import { makePuzzle } from '../model.js';
import { makeRng, shuffle } from '../rng.js';
import { warnsdorff } from './hampath.js';
import { gapCheckpoints } from './checkpoints.js';
import { pickK, SEED_FRACTION } from './generate.js';
import { allEdges, edgeId, setArrowId, arrowDirId, arrowIds, arrowMove } from '../edges.js';
import { solve } from '../solver/solve.js';

// Generator of "One way arrows" puzzles: no walls, only one-way edges (core/edges.js), as few as
// possible, and exactly one solution. The same pipeline as gen/generate.js and gen/walls.js:
// candidates (fresh path, fresh checkpoints, arrows until unique), each minimized, the one with
// the fewest arrows wins and gets a deeper look at the arrows its minimizing kept only because a
// check hit its node cap. Generators (function*) so callers can drive them synchronously or
// time-sliced; progress events are { frac, arrows, K }.
//
// What differs from walls:
//   - No "wall every edge off the solution" shortcut to uniqueness: an arrow blocks one direction
//     only, and a random one may lock a rival in. Arrows are added against a rival solution
//     instead (see distinguishingArrow), and an attempt that cannot get further is dropped.
//   - An arrow may sit on a solution edge (it then points along the solution: it can't hurt it).
//     Option pathArrows = false keeps the solution's edges free of arrows, at the price of a few
//     more.
//   - Arrows are tested for removal through the freed move (solve()'s mustUse): the puzzle stays
//     unique iff no solution makes the move the arrow blocked.

// Candidate puzzles per grid size (the quality/time knob, see CANDIDATES in generate.js) and the
// solver-node budgets, as multiples of the cell count (tools/bench-arrows.mjs prints the
// trade-off).
export const ARROW_CANDIDATES = { 5: 32, 6: 24, 7: 16, 8: 8, 9: 3 };
const candidatesFor = n => ARROW_CANDIDATES[n] || 2;
// The grid sizes the play app offers for this variant (it grows with the solver; see
// generateArrows).
export const ARROW_SIZES = Object.keys(ARROW_CANDIDATES).map(Number);
export const ARROW_CAP_PER_CELL = 600;
export const ARROW_MIN_CAP = 20000;
export const ARROW_CHECK_CAP_X = 0.2;
// Checkpoint count K ~ pickK(KMIN, KMAX) (see generate.js: it favours small K). Fewer checkpoints
// need more arrows and are the hardest puzzles; with K as big as the standard generator uses,
// small boards need almost no arrows at all (5x5: 0-2), which would not show the variant. K is
// about 0.1 * n^2.
const kRange = cells => [
  Math.max(3, Math.round(0.08 * cells)),
  Math.max(4, Math.round(0.2 * cells)),
];
// A puzzle needs at least this many arrows (a candidate minimized below it is not used).
export const ARROW_MIN_ARROWS = 1;
export const ARROW_REFINE_NODES_PER_CELL = 1500;
export const ARROW_REFINE_CAP_X = [4, 16];
const ATTEMPTS_PER_CANDIDATE = 12;
const BUILD_SHARE = 0.1;
const REFINE_SHARE = 0.25;

// +1 when the move a -> b goes from the lower to the higher cell index, else -1: the direction
// value of the arrow that allows exactly that move.
const allowing = (a, b) => (a < b ? 1 : -1);

// How the path walks each edge: along[e] = allowing(a, b) for its move a -> b, 0 = it does not.
function pathDirections(n, path) {
  const along = new Int8Array(n * n * 2);
  for (let i = 1; i < path.length; i++) {
    along[edgeId(n, path[i - 1], path[i])] = allowing(path[i - 1], path[i]);
  }
  return along;
}

// Add arrows to p (checkpoints set, no arrows) until it has exactly one solution. `path` is the
// anchor solution: its edges only ever get an arrow that points along it. cfg: { nodeCap,
// seedFraction, K, pathArrows }. Returns the arrow insertion order (edge ids) or null.
export function* makeUniqueArrows(p, path, rnd, cfg) {
  const n = p.n;
  const { nodeCap, seedFraction, K, pathArrows = true } = cfg;
  const along = pathDirections(n, path);
  const pool = shuffle(allEdges(n).filter(e => pathArrows || !along[e]), rnd);
  const order = [];
  let next = 0;

  const addArrow = (e, dir) => {
    setArrowId(p.arrows, e, dir);
    order.push(e);
  };
  const search = (cap, capture) => solve(p, { limit: 2, nodeCap: cap, capture });
  const progress = () => ({ frac: null, arrows: order.length, K });

  // Next pool edge without an arrow (null when the pool is used up); a solution edge gets its
  // arrow along the solution, any other edge a random direction.
  function addFromPool() {
    while (next < pool.length && arrowDirId(p.arrows, pool[next]) !== 0) next++;
    if (next >= pool.length) return false;
    const e = pool[next++];
    addArrow(e, along[e] || (rnd() < 0.5 ? 1 : -1));
    return true;
  }

  // An arrow that rules out the rival solution `rival` (a path other than the anchor): on one of
  // its moves the anchor does not make, pointing the other way. Null when there is no such edge.
  function distinguishingArrow(rival) {
    const options = [];
    for (let i = 1; i < rival.length; i++) {
      const a = rival[i - 1];
      const b = rival[i];
      const e = edgeId(n, a, b);
      if (along[e] === allowing(a, b)) continue; // the anchor walks it that way too
      if (arrowDirId(p.arrows, e) !== 0) continue;
      if (!pathArrows && along[e] !== 0) continue;
      options.push([e, allowing(b, a)]);
    }
    return options.length ? options[Math.floor(rnd() * options.length)] : null;
  }

  const seedCount = Math.floor(pool.length * seedFraction);
  for (let i = 0; i < seedCount; i++) addFromPool();
  if (seedCount > 0) yield progress();

  // Cheap probe: keep adding while even a small search budget is exceeded.
  const probeCap = Math.min(nodeCap, 4000);
  let probe = search(probeCap, false);
  while (probe.exceeded && addFromPool()) {
    probe = search(probeCap, false);
    yield progress();
  }

  let result = search(nodeCap, true);
  while (result.count > 1 || result.exceeded) {
    if (result.count === 0 && !result.exceeded) return null;
    if (result.exceeded) {
      if (!addFromPool()) return null;
    } else {
      const rival = result.paths.find(q => q.some((c, i) => c !== path[i]));
      const pick = distinguishingArrow(rival);
      if (!pick) return null;
      addArrow(pick[0], pick[1]);
    }
    result = search(nodeCap, true);
    yield progress();
  }
  return order;
}

// Take the arrow on edge e out of p and test whether p stays uniquely solvable, the search capped
// at `cap` nodes. freedEdge: search only for a solution through the move the arrow blocked (p must
// be unique when called); else a plain two-solution search. The arrow goes back unless it is
// removable. Returns { removable, capped, nodes }. An arrow that is neither removable nor capped
// is necessary for good (removing more arrows only adds solutions); a capped one is undecided.
export function tryRemoveArrow(p, e, cap, freedEdge) {
  const dir = arrowDirId(p.arrows, e);
  setArrowId(p.arrows, e, 0);
  let check;
  if (freedEdge) {
    check = solve(p, { limit: 1, nodeCap: cap, mustUse: arrowMove(p.n, e, -dir) });
  } else {
    check = solve(p, { limit: 2, nodeCap: cap });
  }
  const removable = !check.exceeded && check.count === (freedEdge ? 0 : 1);
  if (!removable) setArrowId(p.arrows, e, dir);
  return { removable, capped: !!check.exceeded, nodes: check.nodes };
}

// Remove every arrow (random order, once) whose removal keeps the solution unique. Mutates
// p.arrows. Returns { removed, kept, uncertain } (uncertain = the arrows kept only because their
// check hit checkCap). opts: { freedEdge (default true), bound: stop early with { aborted: true,
// kept: Infinity } once that many arrows had to stay, since the caller has no use for such a
// candidate }. Events: { frac: null, arrows, K } (arrows = the count left so far).
export function* minimizeArrows(p, order, rnd, checkCap, K, opts = {}) {
  const { freedEdge = true, bound = Infinity } = opts;
  const list = shuffle([...order], rnd);
  let kept = list.length;
  let retained = 0;
  const uncertain = [];
  for (const e of list) {
    const r = tryRemoveArrow(p, e, checkCap, freedEdge);
    if (r.removable) {
      kept--;
    } else {
      if (r.capped) uncertain.push(e);
      if (++retained >= bound) return { removed: 0, kept: Infinity, aborted: true };
    }
    yield { frac: null, arrows: kept, K };
  }
  return { removed: list.length - kept, kept, uncertain };
}

// A deeper look at the arrows minimizeArrows() kept only because a check hit its node cap: one
// pass per entry of opts.caps (ascending absolute per-check caps), at most opts.budget solver
// nodes in total (a node count, never a clock, so a seeded run stays reproducible). Needs p
// unique. opts: { caps, budget, arrows (the count now), K }. Events: { frac: null, arrows, K,
// nodes, budget }. Returns { removed, kept, left, nodes }.
export function* refineArrows(p, uncertain, rnd, opts) {
  const { caps, budget, K } = opts;
  let current = opts.arrows;
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
      const r = tryRemoveArrow(p, todo[i], Math.min(cap, room), true);
      nodes += r.nodes;
      if (r.removable) {
        removed++;
        current--;
      } else if (r.capped) {
        undecided.push(todo[i]);
      }
      yield { frac: null, arrows: current, K, nodes, budget };
    }
    todo = undecided;
    if (!todo.length || nodes >= budget) break;
  }
  return { removed, kept: current, left: todo, nodes };
}

// minimizeArrows(), then refineArrows() on the arrows it left undecided: the design app's Minimize
// button uses it (generateArrows runs the two apart, because it refines only its best candidate).
// opts: those of minimizeArrows, plus refineBudget (default 0 = no deeper look) and refineCapX
// (default ARROW_REFINE_CAP_X, the passes' per-check caps as multiples of checkCap). Needs p
// unique. Events as in minimizeArrows (the second look's also carry nodes and budget). Returns
// { removed, kept, uncertain } (uncertain = the arrows still undecided), or what minimizeArrows
// returns when `bound` aborted the run.
export function* minimizeArrowsFully(p, order, rnd, checkCap, K, opts = {}) {
  const first = yield* minimizeArrows(p, order, rnd, checkCap, K, opts);
  const budget = opts.refineBudget ?? 0;
  if (first.aborted || budget <= 0 || !first.uncertain.length) return first;
  const caps = (opts.refineCapX ?? ARROW_REFINE_CAP_X).map(x => x * checkCap);
  const r = yield* refineArrows(p, first.uncertain, rnd, { caps, budget, arrows: first.kept, K });
  return { removed: first.removed + r.removed, kept: r.kept, uncertain: r.left };
}

// One attempt: path -> checkpoints -> arrows until unique. Returns the puzzle (with .path and
// .order) or null.
export function* tryGenerateArrows(n, K, rnd, nodeCap, seedFraction, o = {}) {
  const path = warnsdorff(n, rnd);
  if (!path) return null;
  const positions = gapCheckpoints(n, path, K);
  if (!positions) return null;
  const p = makePuzzle(n);
  positions.forEach((q, i) => {
    p.cp[path[q]] = i + 1;
  });
  p.arrows = new Uint8Array(n * n);
  const order = yield* makeUniqueArrows(p, path, rnd, {
    nodeCap, seedFraction, K, pathArrows: o.pathArrows,
  });
  if (!order) return null;
  p.path = path;
  p.order = order;
  return p;
}

// Re-emit a generator's progress events with extra fields merged in.
function* tag(gen, extra) {
  for (let step = gen.next(); ; step = gen.next()) {
    if (step.done) return step.value;
    yield step.value && { ...step.value, ...extra };
  }
}

const fewest = candidates => (
  candidates.length ? Math.min(...candidates.map(c => c.order.length)) : null
);

// Puzzle with the fewest arrows found for (n, seed): the same seed gives the same puzzle (no clock
// is involved, only node budgets). Events: { frac|null, arrows, K }; `arrows` never increases.
// o.candidates overrides ARROW_CANDIDATES[n]; o.K fixes the checkpoint count; o.minArrows (default
// ARROW_MIN_ARROWS); o.checkCapX scales the removal-check cap; o.pathArrows (default true): arrows
// may sit on the solution's edges; o.freedEdge (default true): the removal check; o.refineNodes:
// node budget of the second look (default ARROW_REFINE_NODES_PER_CELL * n^2, 0 = off); o.capX
// scales the node caps. Limits: tuned for 5 <= n <= 9 (the solver is plain DFS plus propagation,
// see solver/solve-dir.js); larger n works but slowly.
export function* generateArrows(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const cells = n * n;
  const freedEdge = o.freedEdge !== false;
  const wanted = o.candidates || candidatesFor(n);
  const rnd = makeRng(seed);
  const nodeCap = Math.round(Math.max(ARROW_MIN_CAP, ARROW_CAP_PER_CELL * cells) * (o.capX ?? 1));
  const checkCap = Math.max(1000, Math.floor(nodeCap * (o.checkCapX ?? ARROW_CHECK_CAP_X)));
  const [Kmin, Kmax] = kRange(cells);
  const K = o.K || pickK(Kmin, Kmax, rnd);
  const minArrows = o.minArrows ?? ARROW_MIN_ARROWS;
  const attemptOpts = { pathArrows: o.pathArrows !== false };

  // 1. Build candidates.
  const candidates = [];
  const maxAttempts = wanted * ATTEMPTS_PER_CANDIDATE;
  for (let attempt = 0; attempt < maxAttempts && candidates.length < wanted; attempt++) {
    const events = tryGenerateArrows(n, K, rnd, nodeCap, SEED_FRACTION, attemptOpts);
    const found = yield* tag(events, { arrows: fewest(candidates) });
    if (found) candidates.push(found);
    yield { frac: (BUILD_SHARE * candidates.length) / wanted, arrows: fewest(candidates), K };
  }
  if (candidates.length === 0) {
    if (depth < 5) return yield* generateArrows(n, seed + 1, { ...o, retryDepth: depth + 1 });
    throw new Error('Arrows puzzle generation failed for N=' + n);
  }

  // 2. Minimize every candidate; keep the one with the fewest arrows (the earliest on a tie).
  let shown = fewest(candidates);
  const budget = o.refineNodes ?? ARROW_REFINE_NODES_PER_CELL * cells;
  const refining = freedEdge && budget > 0;
  const minShare = 1 - BUILD_SHARE - (refining ? REFINE_SHARE : 0);
  let winner = null;
  let winnerArrows = Infinity;
  let winnerUncertain = [];
  let spare = null; // the best candidate below minArrows: used only when no other is left
  for (let i = 0; i < candidates.length && winnerArrows > minArrows; i++) {
    const candidate = candidates[i];
    const events = minimizeArrows(candidate, candidate.order, rnd, checkCap, K, {
      freedEdge, bound: winnerArrows,
    });
    const total = candidate.order.length;
    let tested = 0;
    let step;
    while (!(step = events.next()).done) {
      tested++;
      shown = Math.min(shown, step.value.arrows);
      const progress = (i + tested / total) / candidates.length;
      yield { frac: BUILD_SHARE + minShare * progress, arrows: shown, K };
    }
    const r = step.value;
    if (r.aborted) {
      yield { frac: BUILD_SHARE + (minShare * (i + 1)) / candidates.length, arrows: shown, K };
    } else if (r.kept < minArrows) {
      if (!spare) spare = candidate;
    } else if (r.kept < winnerArrows) {
      winner = candidate;
      winnerArrows = r.kept;
      winnerUncertain = r.uncertain;
    }
  }
  if (!winner) {
    if (depth < 5) return yield* generateArrows(n, seed + 1, { ...o, retryDepth: depth + 1 });
    winner = spare;
    winnerArrows = arrowIds(winner).length;
    winnerUncertain = [];
  }

  // 3. Only the winner: a second look at the arrows kept because a check hit its node cap.
  if (refining && winnerUncertain.length) {
    const caps = ARROW_REFINE_CAP_X.map(x => x * checkCap);
    const events = refineArrows(winner, winnerUncertain, rnd, {
      caps, budget, arrows: winnerArrows, K,
    });
    let step;
    while (!(step = events.next()).done) {
      yield {
        frac: BUILD_SHARE + minShare + (REFINE_SHARE * step.value.nodes) / budget,
        arrows: step.value.arrows,
        K,
      };
    }
    winnerArrows = step.value.kept;
  }
  yield { frac: 1, arrows: winnerArrows, K };
  delete winner.order;
  winner.seed = seed;
  return winner;
}
