import { makePuzzle } from './model.js';
import { edgeToKey, keyToEdge, wallIds, setWallId } from './edges.js';

export const MAX_N = 16;
export function serialize(p) {
  const cps = [];
  for (let i = 0; i < p.n * p.n; i++) if (p.cp[i]) cps.push(`${(i / p.n) | 0},${i % p.n}=${p.cp[i]}`);
  const ws = wallIds(p).map(e => edgeToKey(p.n, e));
  return ['# Zip Puzzle — plain text format', '# size N', '# checkpoints r,c=n ...   (0-based row/col)',
    '# walls T,r,c ...        (T = H or V; H spans (r,c)-(r+1,c); V spans (r,c)-(r,c+1))',
    `size ${p.n}`, cps.length ? 'checkpoints ' + cps.join(' ') : 'checkpoints', ws.length ? 'walls ' + ws.join(' ') : 'walls'].join('\n');
}

// Throws Error with a user-readable message.
export function parse(text) {
  let n = null; const cps = [], ws = [];
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
    } else throw new Error(`Unknown line: "${line}"`);
  }
  if (n === null) throw new Error('Missing "size" line.');
  const p = makePuzzle(n);
  for (const [r, c, v] of cps) {
    if (r >= n || c >= n) throw new Error(`Checkpoint out of range: ${r},${c}`);
    if (v < 1 || v > n * n) throw new Error(`Checkpoint number out of range: ${v}`);
    p.cp[r * n + c] = v;
  }
  for (const [t, r, c] of ws) {
    if (r >= n || c >= n) throw new Error(`Wall out of range: ${t},${r},${c}`);
    if (t === 'V' && c >= n - 1) throw new Error(`Vertical wall out of range: ${t},${r},${c}`);
    if (t === 'H' && r >= n - 1) throw new Error(`Horizontal wall out of range: ${t},${r},${c}`);
    setWallId(p.walls, keyToEdge(n, `${t},${r},${c}`), true);
  }
  return p;
}
