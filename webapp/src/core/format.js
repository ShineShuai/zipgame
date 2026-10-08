import { makePuzzle } from './model.js';
import { edgeToKey, keyToEdge, wallIds, setWallId } from './edges.js';
import { gridAdjacent, canStep } from './rules.js';

export const MAX_N = 16;

// `# name value` comment lines for measured times (parse() skips them). Only the given times are written.
function timeComments({ generateMs, solveMs, playS } = {}) {
  const lines = [];
  if (generateMs != null) {
    lines.push(`# generate_time_ms ${generateMs.toFixed(1)}`);
  }
  if (solveMs != null) {
    lines.push(`# solve_time_ms ${solveMs.toFixed(1)}`);
  }
  if (playS != null) {
    lines.push(`# play_time_s ${playS.toFixed(1)}`);
  }
  return lines;
}

// The measured times in the `# name value` comment lines that serialize(p, { times }) writes: { generateMs, solveMs, playS } (only those present).
// parse() skips these lines; this reads them back (the Game-of-Day files carry the author's own play_time_s).
export function commentTimes(text) {
  const names = { generate_time_ms: 'generateMs', solve_time_ms: 'solveMs', play_time_s: 'playS' }, out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^#\s*(generate_time_ms|solve_time_ms|play_time_s)\s+(\d+(?:\.\d+)?)\s*$/);
    if (m) out[names[m[1]]] = +m[2];
  }
  return out;
}

// opts.path: optional current play-mode path (array of cell indices) to include as a `path` line.
// opts.times: optional { generateMs, solveMs, playS }, written as comment lines (see timeComments).
export function serialize(p, opts = {}) {
  const cps = [];
  for (let i = 0; i < p.n * p.n; i++) if (p.cp[i]) cps.push(`${(i / p.n) | 0},${i % p.n}=${p.cp[i]}`);
  const ws = wallIds(p).map(e => edgeToKey(p.n, e));
  const hs = [];
  if (p.holes) for (let i = 0; i < p.n * p.n; i++) if (p.holes[i]) hs.push(`${(i / p.n) | 0},${i % p.n}`);
  const lines = ['# Zip Puzzle — plain text format', '# size N', '# checkpoints r,c=n ...   (0-based row/col)',
    '# walls T,r,c ...        (T = H or V; H spans (r,c)-(r+1,c); V spans (r,c)-(r,c+1))'];
  if (hs.length) lines.push('# holes r,c ...           (cells that are not part of the board; Cutout variant)');
  if (opts.path && opts.path.length) lines.push('# path r,c ...           (current play-mode line, in order, optional)');
  lines.push(...timeComments(opts.times));
  lines.push(`size ${p.n}`, cps.length ? 'checkpoints ' + cps.join(' ') : 'checkpoints', ws.length ? 'walls ' + ws.join(' ') : 'walls');
  if (hs.length) lines.push('holes ' + hs.join(' '));
  if (opts.path && opts.path.length) lines.push('path ' + opts.path.map(cell => `${(cell / p.n) | 0},${cell % p.n}`).join(' '));
  return lines.join('\n');
}

// Throws Error with a user-readable message. Returns the puzzle; if the text had a `path` line,
// the puzzle also carries `.path` (array of cell indices) — same convention as a generated puzzle's
// solution path (see model.js).
export function parse(text) {
  let n = null; const cps = [], ws = [], hs = []; let pathCells = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/), kw = parts[0].toLowerCase();
    if (kw === 'size') {
      n = parseInt(parts[1], 10);
      if (isNaN(n) || n < 2 || n > MAX_N) throw new Error(`Invalid size: "${parts[1]}"`);
    } else if (kw === 'checkpoints' || kw === 'cp') {
      for (const t of parts.slice(1)) { const m = t.match(/^(\d+),(\d+)=(\d+)$/); if (!m) throw new Error(`Invalid checkpoint: "${t}"`); cps.push([+m[1], +m[2], +m[3]]); }
    } else if (kw === 'walls') {
      for (const t of parts.slice(1)) { const m = t.match(/^([HV]),(\d+),(\d+)$/i); if (!m) throw new Error(`Invalid wall: "${t}"`); ws.push([m[1].toUpperCase(), +m[2], +m[3]]); }
    } else if (kw === 'holes') {
      for (const t of parts.slice(1)) { const m = t.match(/^(\d+),(\d+)$/); if (!m) throw new Error(`Invalid hole: "${t}"`); hs.push([+m[1], +m[2]]); }
    } else if (kw === 'path') {
      pathCells = [];
      for (const t of parts.slice(1)) { const m = t.match(/^(\d+),(\d+)$/); if (!m) throw new Error(`Invalid path cell: "${t}"`); pathCells.push([+m[1], +m[2]]); }
    } else throw new Error(`Unknown line: "${line}"`);
  }
  if (n === null) throw new Error('Missing "size" line.');
  const p = makePuzzle(n);
  if (hs.length) {
    p.holes = new Uint8Array(n * n);
    for (const [r, c] of hs) {
      if (r >= n || c >= n) throw new Error(`Hole out of range: ${r},${c}`);
      p.holes[r * n + c] = 1;
    }
  }
  for (const [r, c, v] of cps) {
    if (r >= n || c >= n) throw new Error(`Checkpoint out of range: ${r},${c}`);
    if (p.holes && p.holes[r * n + c]) throw new Error(`Checkpoint on a hole: ${r},${c}`);
    if (v < 1 || v > n * n) throw new Error(`Checkpoint number out of range: ${v}`);
    p.cp[r * n + c] = v;
  }
  for (const [t, r, c] of ws) {
    if (r >= n || c >= n) throw new Error(`Wall out of range: ${t},${r},${c}`);
    if (t === 'V' && c >= n - 1) throw new Error(`Vertical wall out of range: ${t},${r},${c}`);
    if (t === 'H' && r >= n - 1) throw new Error(`Horizontal wall out of range: ${t},${r},${c}`);
    setWallId(p.walls, keyToEdge(n, `${t},${r},${c}`), true);
  }
  if (pathCells) {
    const path = pathCells.map(([r, c]) => {
      if (r >= n || c >= n) throw new Error(`Path cell out of range: ${r},${c}`);
      return r * n + c;
    });
    for (let i = 1; i < path.length; i++) {
      if (p.holes && (p.holes[path[i - 1]] || p.holes[path[i]])) throw new Error(`Path enters a hole at step ${i}: ${pathCells[i - 1].join(',')} -> ${pathCells[i].join(',')}`);
      if (!gridAdjacent(n, path[i - 1], path[i])) throw new Error(`Path is not connected at step ${i}: ${pathCells[i - 1].join(',')} -> ${pathCells[i].join(',')}`);
      if (!canStep(p, path[i - 1], path[i])) throw new Error(`Path crosses a wall at step ${i}: ${pathCells[i - 1].join(',')} -> ${pathCells[i].join(',')}`);
    }
    if (new Set(path).size !== path.length) throw new Error('Path revisits a cell.');
    p.path = path;
  }
  return p;
}
