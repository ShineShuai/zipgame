// Puzzle = { n, cp: Uint16Array(n*n) checkpoint numbers (0 = none), walls: Uint8Array(n*n) }
// walls bit0 = wall between cell and its right neighbour, bit1 = wall between cell and the one below.
// Generated puzzles may carry extra fields: path (the unique solution), seed. A puzzle of the
// "One way arrows" variant has `arrows` (Uint8Array(n*n), one-way edges, see core/edges.js) and no
// walls; solve() then runs solver/solve-dir.js.
// A puzzle of the "Exact" (Hidato-style) variant has `exact: true`: the number of a cell is its
// step on the path (the cell numbered 8 is the 8th cell of the path), so the numbers are not 1..K
// but any increasing steps, 1 and the cell count among them. solve() then searches with the steps
// (see exactRanks below) and isSolved() compares every number with its step.
import { arrowProblem } from './edges.js';

export const ALGO_VERSION = 6; // bump when generator/solver output changes for a given seed. v2: solver propagation + scaled node caps in generate() (fewer walls, faster). v3: K ~ Normal peaked at 30% of range. v4: candidates seeded with 40% random walls; best of several minimized candidates (CANDIDATES). v5: solver propagation also drops cycle-closing edges (fewer nodes, so node-capped generation of the larger sizes changes). v6: wall minimizing tests each removal by searching only for solutions through the freed edge (fewer node-cap hits, fewer walls); the winning candidate also gets a deeper second look at the walls kept only because a check hit its node cap (refineWalls; fewer walls again, same ALGO_VERSION by choice, golden puzzles regenerated)

export const makePuzzle = n => ({ n, cp: new Uint16Array(n * n), walls: new Uint8Array(n * n) });
export const clonePuzzle = p => ({
  n: p.n,
  cp: p.cp.slice(),
  walls: p.walls.slice(),
  ...(p.holes ? { holes: p.holes.slice() } : {}),
  ...(p.arrows ? { arrows: p.arrows.slice() } : {}),
  ...(p.exact ? { exact: true } : {}),
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

export function validate(p) {
  const nums = [];
  for (const v of p.cp) if (v) nums.push(v);
  if (!nums.length) return { ok: false, msg: 'No checkpoints yet — place at least a cell with number 1.' };
  const set = new Set(nums);
  if (set.size !== nums.length) return { ok: false, msg: 'Invalid: duplicate checkpoint numbers.' };
  if (!set.has(1)) return { ok: false, msg: 'Invalid: missing checkpoint 1 — numbering must start at 1.' };
  if (p.holes) for (let i = 0; i < p.cp.length; i++) if (p.holes[i] && p.cp[i]) return { ok: false, msg: 'Invalid: a checkpoint sits on a hole.' };
  if (p.exact) return validateExact(p, nums);
  if (p.arrows) {
    const problem = arrowProblem(p);
    if (problem) return { ok: false, msg: problem };
  }
  const max = Math.max(...nums);
  for (let k = 1; k <= max; k++) if (!set.has(k)) return { ok: false, msg: `Invalid: gap in checkpoints — number ${k} is missing.` };
  return { ok: true, max };
}
