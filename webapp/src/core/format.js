import { makePuzzle } from './model.js';
import {
  edgeToKey, keyToEdge, wallIds, setWallId, hasWallId, edgeId, setArrowId, arrowDirId, arrowIds,
  arrowMove,
} from './edges.js';
import { gridAdjacent, canStep } from './rules.js';
import { adjacent, isPortalPair, gridDist } from './geom.js';

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

const cellKey = (n, cell) => `${(cell / n) | 0},${cell % n}`;

// The portal pairs in canonical order: the lower cell of each pair first, the pairs by their lower
// cell.
// (Two puzzles that differ only in the order of the pairs have one text, so one rating key.)
export const portalPairs = p => (p.portals || [])
  .map(([a, b]) => (a < b ? [a, b] : [b, a]))
  .sort((x, y) => x[0] - y[0]);

// opts.path: optional current play-mode path (array of cell indices) to include as a `path` line.
// opts.times: optional { generateMs, solveMs, playS }, written as comment lines (see timeComments).
export function serialize(p, opts = {}) {
  const cps = [];
  for (let i = 0; i < p.n * p.n; i++) if (p.cp[i]) cps.push(`${(i / p.n) | 0},${i % p.n}=${p.cp[i]}`);
  const ws = wallIds(p).map(e => edgeToKey(p.n, e));
  const as = p.arrows
    ? arrowIds(p).map(e => {
      const move = arrowMove(p.n, e, arrowDirId(p.arrows, e));
      return move.map(cell => cellKey(p.n, cell)).join('>');
    })
    : null;
  const hs = [];
  if (p.holes) for (let i = 0; i < p.n * p.n; i++) if (p.holes[i]) hs.push(`${(i / p.n) | 0},${i % p.n}`);
  const lines = ['# Zip Puzzle — plain text format', '# size N', '# checkpoints r,c=n ...   (0-based row/col)',
    '# walls T,r,c ...        (T = H or V; H spans (r,c)-(r+1,c); V spans (r,c)-(r,c+1))'];
  if (hs.length) lines.push('# holes r,c ...           (cells that are not part of the board; Cutout variant)');
  if (as) {
    lines.push('# arrows r,c>r,c ...     (one-way edges: a step is allowed from the first cell to the'
      + ' second only)');
  }
  if (p.exact) {
    lines.push('# exact                   (a number is the step of its cell on the path: Exact variant)');
  }
  if (p.wrap) {
    lines.push('# wrap                    (the edges join across the borders: a torus; Wrap-around)');
  }
  if (p.loop) {
    lines.push('# loop                    (the last cell touches cell 1, a ring; numbers in cyclic order: Loop)');
  }
  if (p.split) {
    lines.push('# split k                 (Two paths: red takes the numbers 1..k, blue the numbers after k)');
  }
  const portals = portalPairs(p);
  if (p.portals) {
    lines.push('# portals r,c~r,c ...     (pairs of linked cells; a step between them is a move)');
  }
  if (opts.path && opts.path.length) lines.push('# path r,c ...           (current play-mode line, in order, optional)');
  lines.push(...timeComments(opts.times));
  lines.push(`size ${p.n}`);
  if (p.wrap) lines.push('wrap');
  if (p.loop) lines.push('loop');
  lines.push(cps.length ? 'checkpoints ' + cps.join(' ') : 'checkpoints',
    ws.length ? 'walls ' + ws.join(' ') : 'walls');
  if (hs.length) lines.push('holes ' + hs.join(' '));
  if (as) lines.push(as.length ? 'arrows ' + as.join(' ') : 'arrows');
  if (p.exact) lines.push('exact');
  if (p.split) lines.push(`split ${p.split}`);
  if (p.portals) {
    const pairs = portals.map(pair => pair.map(cell => cellKey(p.n, cell)).join('~'));
    lines.push(('portals ' + pairs.join(' ')).trim());
  }
  if (opts.path && opts.path.length) lines.push('path ' + opts.path.map(cell => `${(cell / p.n) | 0},${cell % p.n}`).join(' '));
  return lines.join('\n');
}

// A `portals` line (pairs written r,c~r,c; even an empty one) makes it a Teleport puzzle:
// p.portals (core/geom.js),
// in canonical order (see portalPairs). Without a pair it is not valid yet (validate), as in the
// design app.
// An `arrows` line (even an empty one) makes it a One way arrows puzzle: p.arrows (core/edges.js).
// A `split k` line makes it a Two paths puzzle: p.split = k, the numbers 1..k are the red path's, the
// rest the blue path's (core/model.js, core/twopaths.js); a path line then lists the red path
// followed by the blue one.
// An `exact` line (no values) makes it an Exact puzzle: p.exact, the numbers are steps
// (core/model.js). A `loop` line (no values) makes it a Loop puzzle: p.loop, a ring.
// Throws Error with a user-readable message. Returns the puzzle; if the text had a `path` line,
// the puzzle also carries `.path` (array of cell indices) — same convention as a generated puzzle's
// solution path (see model.js).
export function parse(text) {
  let n = null; const cps = [], ws = [], hs = [], as = [], ps = [];
  let pathCells = null, hasArrows = false;
  let isExact = false, isWrap = false, isLoop = false, isPortals = false, split = 0;
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
    } else if (kw === 'arrows') {
      hasArrows = true;
      for (const t of parts.slice(1)) {
        const m = t.match(/^(\d+),(\d+)>(\d+),(\d+)$/);
        if (!m) throw new Error(`Invalid arrow: "${t}" (expected r,c>r,c)`);
        as.push([+m[1], +m[2], +m[3], +m[4]]);
      }
    } else if (kw === 'exact') {
      if (parts.length > 1) throw new Error('The "exact" line takes no values.');
      isExact = true;
    } else if (kw === 'wrap') {
      if (parts.length > 1) throw new Error('The "wrap" line takes no values.');
      isWrap = true;
    } else if (kw === 'loop') {
      if (parts.length > 1) throw new Error('The "loop" line takes no values.');
      isLoop = true;
    } else if (kw === 'split') {
      split = parts.length === 2 && /^\d+$/.test(parts[1]) ? parseInt(parts[1], 10) : 0;
      if (split < 1) throw new Error('The "split" line takes one number: split k.');
    } else if (kw === 'portals') {
      // even an empty line: a Teleport puzzle without a pair yet (the design app's, not yet valid)
      isPortals = true;
      for (const t of parts.slice(1)) {
        const m = t.match(/^(\d+),(\d+)~(\d+),(\d+)$/);
        if (!m) throw new Error(`Invalid portal pair: \"${t}\" (expected r,c~r,c)`);
        ps.push([+m[1], +m[2], +m[3], +m[4], t]);
      }
    } else if (kw === 'path') {
      pathCells = [];
      for (const t of parts.slice(1)) { const m = t.match(/^(\d+),(\d+)$/); if (!m) throw new Error(`Invalid path cell: "${t}"`); pathCells.push([+m[1], +m[2]]); }
    } else throw new Error(`Unknown line: "${line}"`);
  }
  if (n === null) throw new Error('Missing "size" line.');
  const p = makePuzzle(n);
  if (isWrap) {
    if (n < 3) throw new Error('A wrap-around board needs at least 3 x 3.');
    if (hasArrows || isExact || hs.length) {
      throw new Error('A wrap-around puzzle cannot have holes, arrows or exact numbers (yet).');
    }
    p.wrap = true;
  }
  if (isLoop) {
    if (isWrap || hasArrows || isExact || hs.length) {
      throw new Error('A loop puzzle cannot have holes, arrows, exact numbers or wrap-around (yet).');
    }
    p.loop = true;
  }
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
    if (t === 'V' && c >= n - 1 && !p.wrap) {
      throw new Error(`Vertical wall out of range: ${t},${r},${c}`);
    }
    if (t === 'H' && r >= n - 1 && !p.wrap) {
      throw new Error(`Horizontal wall out of range: ${t},${r},${c}`);
    }
    setWallId(p.walls, keyToEdge(n, `${t},${r},${c}`), true);
  }
  if (hasArrows) {
    p.arrows = new Uint8Array(n * n);
    for (const [r1, c1, r2, c2] of as) {
      const label = `${r1},${c1}>${r2},${c2}`;
      if (Math.max(r1, c1, r2, c2) >= n) throw new Error(`Arrow out of range: ${label}`);
      const from = r1 * n + c1, to = r2 * n + c2;
      if (!gridAdjacent(n, from, to)) throw new Error(`Arrow cells are not neighbours: ${label}`);
      if (p.holes && (p.holes[from] || p.holes[to])) {
        throw new Error(`Arrow next to a hole: ${label}`);
      }
      const e = edgeId(n, from, to);
      if (hasWallId(p.walls, e)) throw new Error(`Arrow on a wall: ${label}`);
      if (arrowDirId(p.arrows, e) !== 0) throw new Error(`Two arrows on one edge: ${label}`);
      setArrowId(p.arrows, e, from < to ? 1 : -1);
    }
  }
  if (isExact) {
    if (hasArrows) throw new Error('An Exact puzzle cannot have arrows.');
    p.exact = true;
  }
  if (split) {
    if (isWrap || isLoop || isExact || isPortals || hasArrows || hs.length) {
      throw new Error('A Two paths puzzle cannot have holes, arrows, exact numbers, wrap-around, '
        + 'a loop or portals (yet).');
    }
    p.split = split;
  }
  if (isPortals) {
    if (isWrap || isLoop || isExact || hasArrows || hs.length) {
      throw new Error('A Teleport puzzle cannot have holes, arrows, exact numbers, wrap-around '
        + 'or a loop (yet).');
    }
    const used = new Set();
    p.portals = ps.map(([r1, c1, r2, c2, label]) => {
      if (Math.max(r1, c1, r2, c2) >= n) throw new Error(`Portal out of range: ${label}`);
      const a = r1 * n + c1, b = r2 * n + c2;
      if (a === b) throw new Error(`A portal pair needs two different cells: ${label}`);
      if (gridDist(n, false, a, b) === 1) {
        throw new Error(`Portal cells are neighbours already: ${label}`);
      }
      for (const cell of [a, b]) {
        if (used.has(cell)) throw new Error(`A cell is in two portal pairs: ${label}`);
        used.add(cell);
      }
      return [a, b];
    });
    p.portals = portalPairs(p);
  }
  if (pathCells) {
    const path = pathCells.map(([r, c]) => {
      if (r >= n || c >= n) throw new Error(`Path cell out of range: ${r},${c}`);
      return r * n + c;
    });
    for (let i = 1; i < path.length; i++) {
      if (p.holes && (p.holes[path[i - 1]] || p.holes[path[i]])) throw new Error(`Path enters a hole at step ${i}: ${pathCells[i - 1].join(',')} -> ${pathCells[i].join(',')}`);
      const [from, to] = [path[i - 1], path[i]];
      // a Two paths path crosses its bridge, from the last red number to the first blue one
      const bridge = p.split && p.cp[from] === p.split && p.cp[to] === p.split + 1;
      if (!bridge && !isPortalPair(p.portals, from, to) && !adjacent(n, !!p.wrap, from, to)) {
        throw new Error(`Path is not connected at step ${i}: ${pathCells[i - 1].join(',')} -> ${pathCells[i].join(',')}`);
      }
      if (!bridge && !canStep(p, path[i - 1], path[i])) throw new Error(`Path crosses a wall at step ${i}: ${pathCells[i - 1].join(',')} -> ${pathCells[i].join(',')}`);
    }
    if (new Set(path).size !== path.length) throw new Error('Path revisits a cell.');
    p.path = path;
  }
  return p;
}
