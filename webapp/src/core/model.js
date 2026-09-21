// Puzzle = { n, cp: Uint16Array(n*n) checkpoint numbers (0 = none), walls: Uint8Array(n*n) }
// walls bit0 = wall between cell and its right neighbour, bit1 = wall between cell and the one below.
// Generated puzzles may carry extra fields: path (the unique solution), seed.
export const ALGO_VERSION = 4; // bump when generator/solver output changes for a given seed. v2: solver propagation + scaled node caps in generate() (fewer walls, faster). v3: K ~ Normal peaked at 30% of range. v4: candidates seeded with 40% random walls; best of several minimized candidates (CANDIDATES)

export const makePuzzle = n => ({ n, cp: new Uint16Array(n * n), walls: new Uint8Array(n * n) });
export const clonePuzzle = p => ({ n: p.n, cp: p.cp.slice(), walls: p.walls.slice() });
export const maxNumber = p => { let m = 0; for (const v of p.cp) if (v > m) m = v; return m; };
export const startCell = p => p.cp.indexOf(1);
export const endCell = p => { const m = maxNumber(p); return m ? p.cp.indexOf(m) : -1; };

export function validate(p) {
  const nums = [];
  for (const v of p.cp) if (v) nums.push(v);
  if (!nums.length) return { ok: false, msg: 'No checkpoints yet — place at least a cell with number 1.' };
  const set = new Set(nums);
  if (set.size !== nums.length) return { ok: false, msg: 'Invalid: duplicate checkpoint numbers.' };
  if (!set.has(1)) return { ok: false, msg: 'Invalid: missing checkpoint 1 — numbering must start at 1.' };
  const max = Math.max(...nums);
  for (let k = 1; k <= max; k++) if (!set.has(k)) return { ok: false, msg: `Invalid: gap in checkpoints — number ${k} is missing.` };
  return { ok: true, max };
}
