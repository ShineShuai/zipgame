// Puzzle = { n, cp: Uint16Array(n*n) checkpoint numbers (0 = none), walls: Uint8Array(n*n) }
// walls bit0 = wall between cell and its right neighbour, bit1 = wall between cell and the one below.
// Generated puzzles may carry extra fields: path (the unique solution), seed. A puzzle of the
// "One way arrows" variant has `arrows` (Uint8Array(n*n), one-way edges, see core/edges.js) and no
// walls; solve() then runs solver/solve-dir.js.
// A wrap-around puzzle has `wrap: true` (its edges join across the borders, core/geom.js; no holes,
// arrows or Exact numbers yet). A puzzle of the "Exact" (Hidato-style) variant has `exact: true`:
// the number of a cell is its step on the path (the cell numbered 8 is the 8th cell of the path),
// so the numbers are not 1..K
// but any increasing steps, 1 and the cell count among them. solve() then searches with the steps
// (see exactRanks below) and isSolved() compares every number with its step.
// A puzzle of the "Loop" variant has `loop: true`: the path closes into a ring, so its last cell
// touches cell 1 (through an open edge) and the numbers 1..K are met in cyclic order; K need not
// be the last cell. solve() then runs solver/solve-loop.js (a standard search per possible last cell).
// A puzzle of the "Two paths" variant has `split: k` (2 <= k <= K - 2): two paths, red and blue,
// cover the board and share no cell. The numbers are still one list 1..K, the red path takes 1..k
// (start 1, end k) and the blue path k+1..K (start k+1, end K); the board shows the blue ones as
// 1..K-k. solve() then runs solver/solve-two.js, and a solution path is the red path followed by
// the blue one (core/twopaths.js).
// A puzzle of the "Teleport pairs" variant has `portals: [[a, b], ...]`: pairs of linked cells; a
// step
// from one cell of a pair to the other counts as a move (no wall ever stands on it, see
// core/geom.js
// and the solver's buildNeighbors()). Everything else is a standard puzzle.
import { arrowProblem } from './edges.js';
import { gridDist } from './geom.js';

export const ALGO_VERSION = 6; // bump when generator/solver output changes for a given seed. v2: solver propagation + scaled node caps in generate() (fewer walls, faster). v3: K ~ Normal peaked at 30% of range. v4: candidates seeded with 40% random walls; best of several minimized candidates (CANDIDATES). v5: solver propagation also drops cycle-closing edges (fewer nodes, so node-capped generation of the larger sizes changes). v6: wall minimizing tests each removal by searching only for solutions through the freed edge (fewer node-cap hits, fewer walls); the winning candidate also gets a deeper second look at the walls kept only because a check hit its node cap (refineWalls; fewer walls again, same ALGO_VERSION by choice, golden puzzles regenerated)

export const makePuzzle = n => ({ n, cp: new Uint16Array(n * n), walls: new Uint8Array(n * n) });
export const clonePuzzle = p => ({
  n: p.n,
  cp: p.cp.slice(),
  walls: p.walls.slice(),
  ...(p.holes ? { holes: p.holes.slice() } : {}),
  ...(p.arrows ? { arrows: p.arrows.slice() } : {}),
  ...(p.exact ? { exact: true } : {}),
  ...(p.wrap ? { wrap: true } : {}),
  ...(p.loop ? { loop: true } : {}),
  ...(p.split ? { split: p.split } : {}),
  ...(p.portals ? { portals: p.portals.map(pair => pair.slice()) } : {}),
});
// Cells the path has to cover: all n*n, minus the holes. A puzzle may carry `holes` (Uint8Array(n*n), 1 = hole): cells that are
// not part of the board (no edges, no checkpoint, not drawn, not counted). Only the Cutout variant (gen/cutout.js) has them.
export const cellCount = p => { let c = p.n * p.n; if (p.holes) for (let i = 0; i < p.holes.length; i++) if (p.holes[i]) c--; return c; };
export const maxNumber = p => { let m = 0; for (const v of p.cp) if (v > m) m = v; return m; };
export const startCell = p => p.cp.indexOf(1);
// The numbered cells, in ascending order of their number.
export const numberedCells = p => {
  const cells = [];
  for (let i = 0; i < p.cp.length; i++) {
    if (p.cp[i]) cells.push(i);
  }
  return cells.sort((a, b) => p.cp[a] - p.cp[b]);
};
// How many cells are numbered (K; the highest number only in a standard puzzle).
export const labelCount = p => {
  let count = 0;
  for (const v of p.cp) {
    if (v) count++;
  }
  return count;
};
// Cell index of checkpoint k at [k-1], k = 1..K (assumes a valid puzzle: no gaps / duplicates). An
// Exact puzzle has no number k for every k: [k-1] is its k-th numbered cell.
export const checkpointCells = p => {
  if (p.exact) return numberedCells(p);
  const o = new Array(maxNumber(p));
  for (let i = 0; i < p.cp.length; i++) if (p.cp[i]) o[p.cp[i] - 1] = i;
  return o;
};

// What the solver needs of an Exact puzzle: rank[cell] = 1..K by ascending number (0 = not
// numbered), so that the numbers are the checkpoints 1..K of the standard search, and steps[k] =
// the number (the step) of rank k.
export function exactRanks(p) {
  const cells = numberedCells(p);
  const rank = new Uint16Array(p.cp.length);
  const steps = new Int32Array(cells.length + 2);
  cells.forEach((cell, i) => {
    rank[cell] = i + 1;
    steps[i + 1] = p.cp[cell];
  });
  return { rank, steps };
}

// The checkpoint rank of every cell (1..K by ascending number, 0 = not numbered): the numbers of a
// standard puzzle themselves, the ranks of an Exact puzzle's steps. What counts checkpoints rather
// than steps (the legs of the colour strip, the pitch of the move sounds) reads it.
export const labelRanks = p => (p.exact ? exactRanks(p).rank : p.cp);

// null when every two neighbouring numbers of an Exact puzzle can be joined in exactly the steps
// between them as far as distance and checkerboard go (Manhattan distance <= steps, same parity),
// else a message. Walls and holes only make the real route longer, so this is a necessary
// condition for any Exact puzzle.
export function exactLegProblem(p) {
  const cells = numberedCells(p);
  const distance = (a, b) => {
    const rows = Math.abs(((a / p.n) | 0) - ((b / p.n) | 0));
    return rows + Math.abs((a % p.n) - (b % p.n));
  };
  for (let i = 1; i < cells.length; i++) {
    const from = p.cp[cells[i - 1]];
    const to = p.cp[cells[i]];
    const apart = distance(cells[i - 1], cells[i]);
    const steps = to - from;
    const unit = steps === 1 ? 'step' : 'steps';
    if (apart > steps) {
      const gap = `${apart} cells apart, but only ${steps} ${unit} lie between them`;
      return `Invalid: ${from} and ${to} are ${gap}.`;
    }
    if ((steps - apart) % 2) {
      const parity = apart % 2 ? 'odd' : 'even';
      const need = `cells ${apart} apart need an ${parity} number of steps`;
      return `Invalid: ${from} to ${to} is ${steps} ${unit}, but ${need}.`;
    }
  }
  return null;
}

// An Exact puzzle: the numbers are steps, so there are gaps by design; the last number is the cell
// count (the path ends there, as it ends on the highest checkpoint of a standard puzzle) and the
// legs have to fit (exactLegProblem). max = how many cells are numbered.
function validateExact(p, nums) {
  if (p.arrows) return { ok: false, msg: 'Invalid: an Exact puzzle cannot have one-way arrows.' };
  const total = cellCount(p);
  const last = Math.max(...nums);
  if (last !== total) {
    const msg = `Invalid: the last number must be ${total} (the cells to cover), not ${last}.`;
    return { ok: false, msg };
  }
  const problem = exactLegProblem(p);
  return problem ? { ok: false, msg: problem } : { ok: true, max: nums.length };
}
export const endCell = p => { const m = maxNumber(p); return m ? p.cp.indexOf(m) : -1; };

// A wrap-around (torus) puzzle: its edges join across the borders (core/geom.js). A 2 x 2 board
// would put two edges between the same two cells, so n >= 3. Holes, arrows and Exact numbers do
// not come with it yet (their checks still assume a grid).
function wrapProblem(p) {
  if (p.n < 3) return 'Invalid: a wrap-around board needs at least 3 x 3.';
  if (p.holes || p.arrows || p.exact) {
    return 'Invalid: a wrap-around puzzle cannot have holes, arrows or exact numbers (yet).';
  }
  return null;
}

// A Loop puzzle: a ring needs an even number of cells (a grid is bipartite) and at least 3
// numbers (with 2, the ring can be run either way round, so it never has one solution). Holes,
// arrows, Exact numbers and wrap-around do not come with it yet.
function loopProblem(p, count) {
  if (p.holes || p.arrows || p.exact || p.wrap) {
    return 'Invalid: a loop puzzle cannot have holes, arrows, exact numbers or wrap-around (yet).';
  }
  if (p.n % 2) {
    return `Invalid: a ${p.n} x ${p.n} board has an odd number of cells, so no ring covers it.`;
  }
  if (count < 3) {
    return 'Invalid: a loop needs at least 3 checkpoints (with 2 the ring runs either way round).';
  }
  return null;
}

// A Teleport puzzle: pairs of two different cells on the board, no cell in two pairs, no pair of
// cells that are neighbours already (that would be a second edge between them), no portal on a
// numbered cell (a badge and a portal icon in one cell are unreadable), and none of the other
// variants' extras (yet).
export function portalProblem(p) {
  const { n, portals } = p;
  if (!Array.isArray(portals) || !portals.length) {
    return 'Invalid: a Teleport puzzle needs at least one pair of portals.';
  }
  if (p.holes || p.arrows || p.exact || p.wrap || p.loop) {
    return 'Invalid: a Teleport puzzle cannot have holes, arrows, exact numbers, wrap-around or '
      + 'a loop (yet).';
  }
  const used = new Set();
  for (const pair of portals) {
    if (!Array.isArray(pair) || pair.length !== 2) return 'Invalid: a portal pair has two cells.';
    const [a, b] = pair;
    for (const cell of pair) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= n * n) {
        return 'Invalid: a portal lies outside the board.';
      }
      if (used.has(cell)) return 'Invalid: a cell cannot be in two portal pairs.';
      used.add(cell);
      if (p.cp[cell]) return 'Invalid: a portal cannot sit on a checkpoint.';
    }
    if (a === b) return 'Invalid: a portal pair needs two different cells.';
    if (gridDist(n, false, a, b) === 1) {
      return 'Invalid: the two cells of a portal pair are neighbours already.';
    }
  }
  return null;
}

// Why the cells a and b cannot be a new portal pair of p (null = they can): the design app checks
// a click with it.
// Same rules as portalProblem, for one more pair.
export function portalPairProblem(p, a, b) {
  const { n } = p;
  if (a === b) return 'A portal pair needs two different cells.';
  if (gridDist(n, false, a, b) === 1) {
    return 'Those two cells are neighbours already: a portal between them would be a second edge.';
  }
  for (const cell of [a, b]) {
    if (p.cp[cell]) return 'A portal cannot sit on a checkpoint.';
    if ((p.portals || []).some(pair => pair.includes(cell))) {
      return 'That cell already has a portal.';
    }
  }
  return null;
}

// A Two paths puzzle: each colour has at least 2 numbers (a path has a start and an end), and none of
// the other variants' extras comes with it (yet).
function twoPathsProblem(p, count) {
  if (p.holes || p.arrows || p.exact || p.wrap || p.loop || p.portals) {
    return 'Invalid: a Two paths puzzle cannot have holes, arrows, exact numbers, wrap-around, '
      + 'a loop or portals (yet).';
  }
  if (!Number.isInteger(p.split) || p.split < 2 || p.split > count - 2) {
    return `Invalid: the red path needs 2 numbers or more and so does the blue one (split ${p.split} of ${count}).`;
  }
  return null;
}

export function validate(p) {
  const nums = [];
  for (const v of p.cp) if (v) nums.push(v);
  if (!nums.length) return { ok: false, msg: 'No checkpoints yet — place at least a cell with number 1.' };
  const set = new Set(nums);
  if (set.size !== nums.length) return { ok: false, msg: 'Invalid: duplicate checkpoint numbers.' };
  if (!set.has(1)) return { ok: false, msg: 'Invalid: missing checkpoint 1 — numbering must start at 1.' };
  if (p.holes) for (let i = 0; i < p.cp.length; i++) if (p.holes[i] && p.cp[i]) return { ok: false, msg: 'Invalid: a checkpoint sits on a hole.' };
  if (p.wrap) {
    const problem = wrapProblem(p);
    if (problem) return { ok: false, msg: problem };
  }
  if (p.loop) {
    const problem = loopProblem(p, nums.length);
    if (problem) return { ok: false, msg: problem };
  }
  if (p.portals) {
    const problem = portalProblem(p);
    if (problem) return { ok: false, msg: problem };
  }
  if (p.split) {
    const problem = twoPathsProblem(p, nums.length);
    if (problem) return { ok: false, msg: problem };
  }
  if (p.exact) return validateExact(p, nums);
  if (p.arrows) {
    const problem = arrowProblem(p);
    if (problem) return { ok: false, msg: problem };
  }
  const max = Math.max(...nums);
  for (let k = 1; k <= max; k++) if (!set.has(k)) return { ok: false, msg: `Invalid: gap in checkpoints — number ${k} is missing.` };
  return { ok: true, max };
}
