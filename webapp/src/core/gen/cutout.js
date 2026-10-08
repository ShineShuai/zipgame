import { makePuzzle, cellCount } from '../model.js';
import { makeRng } from '../rng.js';
import { gapCheckpoints } from './checkpoints.js';
import { makeUnique, minimizeWalls, refineWalls, REFINE_CAP_X } from './walls.js';
import { CANDIDATES, REFINE_NODES_PER_CELL, PROP_CAP_X, CHECK_CAP_X, SEED_FRACTION, pickK } from './generate.js';

// Cutout: Zip on a board with holes. A hole is not drawn and not counted; the path covers every other cell, and
// checkpoints, walls and uniqueness work as in the standard game (the solver skips holes, see puzzle.holes in model.js).
// The holes are cut as a recognisable shape: a donut (one hole in the middle), an L (a corner block cut away) or a cross
// (all four corners cut away), which gives every board a look of its own.
//
// Checkerboard rule: colour the cells like a checkerboard. Every step of a path changes colour, so a path through all cells
// alternates, and the two colour counts can differ by at most 1 (when they differ, it starts and ends on the larger colour).
// A shape that breaks the rule has no solution at all, so such shapes are never offered (isBalanced / shapeIsViable).
//
// Seeded like generate() (same seed => same puzzle, which keeps the tests pinnable), but the app seeds it at random: a Cutout game
// has no daily sequence and is never rebuilt from a seed. A shared game carries the puzzle itself (core/share-code.js).

export const SHAPES = ['donut', 'ell', 'cross'];

// ---------- checkerboard ----------

// 0 = (row + col) even (the colour of the top-left corner), 1 = odd.
export const colourOf = (n, i) => (((i / n) | 0) + (i % n)) & 1;
// [cells of colour 0, cells of colour 1] among the cells that are not holes.
export function colourCounts(n, holes) {
  const count = [0, 0];
  for (let i = 0; i < n * n; i++) {
    if (!(holes && holes[i])) count[colourOf(n, i)]++;
  }
  return count;
}
export const isBalanced = (n, holes) => {
  const [a, b] = colourCounts(n, holes);
  return Math.abs(a - b) <= 1;
};

// ---------- shapes ----------

const rectHoles = (n, rects) => {
  const holes = new Uint8Array(n * n);
  for (const [r0, c0, h, w] of rects) {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) holes[r * n + c] = 1;
  }
  return holes;
};
const halves = k => [...new Set([Math.floor(k / 2), Math.ceil(k / 2)])]; // the two ways to centre an odd gap

// Open the grid graph of the cells that are not holes: adjacency lists.
function adjacency(n, holes) {
  const adj = [];
  for (let i = 0; i < n * n; i++) {
    const list = [];
    if (!holes[i]) {
      const r = (i / n) | 0, c = i % n;
      if (r > 0 && !holes[i - n]) list.push(i - n);
      if (r < n - 1 && !holes[i + n]) list.push(i + n);
      if (c > 0 && !holes[i - 1]) list.push(i - 1);
      if (c < n - 1 && !holes[i + 1]) list.push(i + 1);
    }
    adj.push(list);
  }
  return adj;
}

// Necessary conditions for a path through every cell (cheap, so bad shapes are dropped before a path is searched for):
// the colour counts differ by at most 1, the cells form one piece, and at most two cells (the path's ends) hang on a single neighbour.
export function shapeIsViable(n, holes) {
  if (!isBalanced(n, holes)) return false;
  const adj = adjacency(n, holes);
  let cells = 0, ends = 0, first = -1;
  for (let i = 0; i < n * n; i++) {
    if (holes[i]) continue;
    cells++;
    if (first < 0) first = i;
    if (adj[i].length === 0) return false;
    if (adj[i].length === 1) ends++;
  }
  if (cells < 4 || ends > 2) return false;
  const seen = new Uint8Array(n * n), stack = [first];
  seen[first] = 1;
  let reached = 0;
  while (stack.length) {
    const u = stack.pop();
    reached++;
    for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; stack.push(v); }
  }
  return reached === cells;
}

// Donut: a roughly square hole in the middle, a ring at least 2 cells thick on boards from 7x7 (1 on the small ones).
function donuts(n) {
  const out = [], ring = n >= 7 ? 2 : 1, min = Math.max(1, Math.floor(n / 4));
  for (let h = min; h <= n - 2 * ring; h++) {
    for (let w = min; w <= n - 2 * ring; w++) {
      if (Math.abs(h - w) > 2) continue;
      for (const r0 of halves(n - h)) for (const c0 of halves(n - w)) out.push(rectHoles(n, [[r0, c0, h, w]]));
    }
  }
  return out;
}

// L: one corner block cut away (any of the four corners), both arms at least a third of the board thick.
function ells(n) {
  const out = [], third = Math.max(2, Math.ceil(n / 3));
  for (let h = third; h <= n - third; h++) {
    for (let w = third; w <= n - third; w++) {
      for (const top of [true, false]) for (const left of [true, false]) out.push(rectHoles(n, [[top ? 0 : n - h, left ? 0 : n - w, h, w]]));
    }
  }
  return out;
}

// Cross: all four corner blocks cut away, leaving a vertical arm (w columns) and a horizontal one (h rows) of about equal thickness,
// each at least a third of the board.
function crosses(n) {
  const out = [], min = Math.max(2, Math.ceil(n / 3)), max = Math.ceil(n * 0.6);
  for (let w = min; w <= max; w++) {
    for (let h = min; h <= max; h++) {
      if (Math.abs(w - h) > 1 || n - w < 2 || n - h < 2) continue;
      for (const r0 of halves(n - h)) {
        for (const c0 of halves(n - w)) {
          const r1 = n - r0 - h, c1 = n - c0 - w; // sizes of the bottom and right corner blocks
          out.push(rectHoles(n, [[0, 0, r0, c0], [0, c0 + w, r0, c1], [r0 + h, 0, r1, c0], [r0 + h, c0 + w, r1, c1]]));
        }
      }
    }
  }
  return out;
}

const POOLS = { donut: donuts, ell: ells, cross: crosses };

// ---------- Hamiltonian path on the board with holes ----------

// Randomised Warnsdorff walk, as for the standard board (gen/hampath.js), over the cells that are not holes. When the colour
// counts differ the path has to start on the larger colour, so it does. Returns null on a dead end.
export function warnsdorffHoles(n, holes, rnd, adj = adjacency(n, holes)) {
  const T = n * n, vis = new Uint8Array(T), path = [], counts = colourCounts(n, holes);
  const starts = [];
  for (let i = 0; i < T; i++) {
    if (holes[i]) continue;
    if (counts[0] === counts[1] || counts[colourOf(n, i)] > counts[1 - colourOf(n, i)]) starts.push(i);
  }
  const total = counts[0] + counts[1];
  let cur = starts[Math.floor(rnd() * starts.length)];
  vis[cur] = 1; path.push(cur);
  const free = c => { let k = 0; for (const v of adj[c]) if (!vis[v]) k++; return k; };
  while (path.length < total) {
    const cands = adj[cur].filter(v => !vis[v]).map(v => [v, free(v)]);
    if (!cands.length) return null;
    cands.sort((a, b) => a[1] - b[1]);
    const best = cands.filter(x => x[1] === cands[0][1]);
    cur = best[Math.floor(rnd() * best.length)][0];
    vis[cur] = 1; path.push(cur);
  }
  return path;
}

// A shape (family and cut) that is viable and has a path: { shape, holes } or null. Consumes rnd deterministically.
// only: optionally one family (tests, tuning).
export function pickShape(n, rnd, only = null) {
  const pools = {};
  for (const name of only ? [only] : SHAPES) {
    const pool = POOLS[name](n);
    if (pool.length) pools[name] = pool;
  }
  for (let round = 0; round < 400; round++) {
    const names = Object.keys(pools).filter(k => pools[k].length);
    if (!names.length) return null;
    const shape = names[Math.floor(rnd() * names.length)], pool = pools[shape];
    const holes = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    if (!shapeIsViable(n, holes)) continue;
    const adj = adjacency(n, holes);
    for (let attempt = 0; attempt < 64; attempt++) {
      if (warnsdorffHoles(n, holes, rnd, adj)) return { shape, holes };
    }
  }
  return null;
}

// ---------- generator ----------

const ATTEMPTS_PER_CANDIDATE = 12;
const REFINE_SHARE = 0.25; // the progress bar's shares, as in generate()
const BUILD_SHARE = 0.1;

const fewestWalls = candidates => (candidates.length ? Math.min(...candidates.map(c => c.order.length)) : null);

function* tag(gen, extra) {
  for (let step = gen.next(); ; step = gen.next()) {
    if (step.done) return step.value;
    yield step.value && { ...step.value, ...extra };
  }
}

// One attempt: path -> checkpoints -> walls until unique. Returns the puzzle (with .path and .order) or null.
function* tryCutout(n, holes, adj, K, rnd, nodeCap, wallBudget, seedFraction) {
  const path = warnsdorffHoles(n, holes, rnd, adj);
  if (!path) return null;
  const positions = gapCheckpoints(n, path, K);
  if (!positions) return null;
  const p = makePuzzle(n);
  p.holes = holes.slice();
  positions.forEach((q, i) => { p.cp[path[q]] = i + 1; });
  const order = yield* makeUnique(p, path, rnd, { nodeCap, wallBudget, seedFraction, K, prop: true });
  if (!order) return null;
  p.path = path;
  p.order = order;
  return p;
}

// Last resort: every cell numbered along the path.
function numberEveryCell(n, holes, path, seed, shape) {
  const p = makePuzzle(n);
  p.holes = holes.slice();
  path.forEach((cell, i) => { p.cp[cell] = i + 1; });
  p.path = path;
  p.seed = seed;
  p.shape = shape;
  return p;
}

// Deterministic Cutout puzzle for (n, seed): the same pipeline as generate() (best of several candidates, each walled until
// unique, minimised, the winner refined), on a shape picked from the seed. Events: { frac|null, walls, K }, as generate().
// The puzzle has .holes (Uint8Array, 1 = hole), .shape ('donut' | 'ell' | 'cross'), .path (the solution) and .seed.
// o.shape picks the family, o.candidates / o.refineNodes override the effort (tests, tuning).
export function* generateCutout(n, seed, o = {}) {
  const depth = o.retryDepth || 0;
  const rnd = makeRng(seed);
  const picked = pickShape(n, rnd, o.shape || null);
  if (!picked) {
    if (depth < 5) return yield* generateCutout(n, seed + 1, { ...o, retryDepth: depth + 1 });
    throw new Error('Cutout generation failed: no usable shape for N=' + n);
  }
  const { shape, holes } = picked;
  const adj = adjacency(n, holes);
  const cells = cellCount({ n, holes });
  const wanted = o.candidates || CANDIDATES[n] || 2;
  const nodeCap = Math.round(Math.max(30000, 200 * cells) * PROP_CAP_X);
  const fallbackCap = Math.min(2000000, Math.max(300000, 20 * nodeCap));
  const checkCap = Math.max(1000, Math.floor(nodeCap * CHECK_CAP_X));
  const Kmin = Math.max(4, n);
  const Kmax = Math.max(Kmin + 1, Math.round(cells / 4));
  const K = pickK(Kmin, Kmax, rnd);

  // 1. Build candidates.
  const candidates = [];
  for (let attempt = 0; attempt < wanted * ATTEMPTS_PER_CANDIDATE && candidates.length < wanted; attempt++) {
    const found = yield* tag(tryCutout(n, holes, adj, K, rnd, nodeCap, cells, SEED_FRACTION), { walls: fewestWalls(candidates) });
    if (found) candidates.push(found);
    yield { frac: (BUILD_SHARE * candidates.length) / wanted, walls: fewestWalls(candidates), K };
  }
  for (let fallback = 0; fallback < 4 && candidates.length === 0; fallback++) {
    const found = yield* tag(tryCutout(n, holes, adj, K, rnd, fallbackCap, cells, SEED_FRACTION), { walls: null });
    if (found) candidates.push(found);
    yield { frac: BUILD_SHARE, walls: fewestWalls(candidates), K };
  }
  if (candidates.length === 0) {
    if (depth < 5) return yield* generateCutout(n, seed + 1, { ...o, retryDepth: depth + 1 });
    for (let x = 0; x < 64; x++) {
      const path = warnsdorffHoles(n, holes, rnd, adj);
      if (path) return numberEveryCell(n, holes, path, seed, shape);
    }
    throw new Error('Cutout generation failed: could not construct a path for N=' + n);
  }

  // 2. Minimise every candidate; keep the one with the fewest walls (the earliest on a tie).
  let shown = fewestWalls(candidates);
  const budget = o.refineNodes ?? REFINE_NODES_PER_CELL * cells;
  const refining = budget > 0;
  const minShare = 1 - BUILD_SHARE - (refining ? REFINE_SHARE : 0);
  let winner = null, winnerWalls = Infinity, winnerUncertain = [];

  function* minimizeCandidate(candidate, index) {
    const total = candidate.order.length;
    const events = minimizeWalls(candidate, candidate.order, rnd, checkCap, K, { prop: true, freedEdge: true, bound: winnerWalls });
    let tested = 0;
    for (let step = events.next(); ; step = events.next()) {
      if (step.done) {
        if (step.value.aborted) yield { frac: BUILD_SHARE + minShare * ((index + 1) / candidates.length), walls: shown, K };
        return step.value;
      }
      tested++;
      shown = Math.min(shown, step.value.walls);
      yield { frac: BUILD_SHARE + minShare * ((index + tested / total) / candidates.length), walls: shown, K };
    }
  }

  for (let i = 0; i < candidates.length && winnerWalls > 0; i++) {
    const candidate = candidates[i];
    let kept = candidate.order.length, uncertain = [];
    if (kept > 0) {
      const r = yield* minimizeCandidate(candidate, i);
      kept = r.kept;
      uncertain = r.uncertain || [];
    }
    if (kept < winnerWalls) {
      winner = candidate;
      winnerWalls = kept;
      winnerUncertain = uncertain;
    }
  }

  // 3. Only the winner: a deeper look at the walls kept because a check hit its node cap.
  if (refining && winnerUncertain.length) {
    const events = refineWalls(winner, winnerUncertain, rnd, { prop: true, caps: REFINE_CAP_X.map(x => x * checkCap), budget, walls: winnerWalls, K });
    let step;
    while (!(step = events.next()).done) {
      yield { ...step.value, frac: BUILD_SHARE + minShare + (REFINE_SHARE * step.value.nodes) / budget };
    }
    winnerWalls = step.value.kept;
  }
  yield { frac: 1, walls: winnerWalls, K };
  delete winner.order;
  winner.seed = seed;
  winner.shape = shape;
  return winner;
}
