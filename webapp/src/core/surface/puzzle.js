// Puzzles on a cell graph (see topology.js: a solid or the flat Pentagon board): the model, the
// move rule, the solved check and a plain-text format. A puzzle is
//   { kind: 'tetra' | 'cube' | 'ball' | 'pentagon', n, cp: Uint16Array(T),
//     walls: Uint8Array(E) }
// (n is the size of a tetra, cube or pentagon board, the catalog id of a ball)
// cp[cell] is the checkpoint number of a cell (0 = none) and walls[edge] is 1 where the side
// between two cells is closed. The rules are those of the flat game: the path starts on 1, ends
// on the highest number, visits every cell once and meets the numbers in ascending order.
import { surfaceTopology, edgeBetween, BALL_KIND } from './topology.js';
import { timeComments } from '../format.js';

export const isSurfacePuzzle = p => Boolean(p && p.kind);
export const topologyOf = p => surfaceTopology(p.kind, p.n);

export function makeSurfacePuzzle(kind, n) {
  const top = surfaceTopology(kind, n);
  return {
    kind,
    n,
    cp: new Uint16Array(top.T),
    walls: new Uint8Array(top.E),
  };
}

export const cloneSurfacePuzzle = p => ({
  kind: p.kind,
  n: p.n,
  cp: Uint16Array.from(p.cp),
  walls: Uint8Array.from(p.walls),
});

export function maxNumber(p) {
  let max = 0;
  for (const value of p.cp) {
    if (value > max) {
      max = value;
    }
  }
  return max;
}

export const startCell = p => p.cp.indexOf(1);

export function endCell(p) {
  const max = maxNumber(p);
  return max ? p.cp.indexOf(max) : -1;
}

export function wallEdges(p) {
  const edges = [];
  for (let edge = 0; edge < p.walls.length; edge++) {
    if (p.walls[edge]) {
      edges.push(edge);
    }
  }
  return edges;
}

export const wallCount = p => wallEdges(p).length;

// One step from cell a to cell b: the cells touch and the side between them is open.
export function canStep(p, a, b) {
  const edge = edgeBetween(topologyOf(p), a, b);
  return edge >= 0 && !p.walls[edge];
}

export function validateSurface(p) {
  const top = topologyOf(p);
  if (p.cp.length !== top.T || p.walls.length !== top.E) {
    return { ok: false, msg: 'Invalid: the board arrays do not match the board.' };
  }
  const numbers = [];
  for (const value of p.cp) {
    if (value) {
      numbers.push(value);
    }
  }
  if (!numbers.length) {
    return { ok: false, msg: 'No checkpoints yet — place at least a cell with number 1.' };
  }
  const set = new Set(numbers);
  if (set.size !== numbers.length) {
    return { ok: false, msg: 'Invalid: duplicate checkpoint numbers.' };
  }
  if (!set.has(1)) {
    return { ok: false, msg: 'Invalid: missing checkpoint 1 — numbering must start at 1.' };
  }
  const max = Math.max(...numbers);
  for (let k = 1; k <= max; k++) {
    if (!set.has(k)) {
      return { ok: false, msg: `Invalid: gap in checkpoints — number ${k} is missing.` };
    }
  }
  if (max < 2) {
    return {
      ok: false,
      msg: 'Invalid: at least 2 checkpoints are needed (the first and the last).',
    };
  }
  return { ok: true, max };
}

// Covers every cell once, starts on 1, ends on the highest number, numbers in ascending order,
// and every step crosses an open side.
export function isSolved(p, path) {
  const top = topologyOf(p);
  if (path.length !== top.T) {
    return false;
  }
  if (path[0] !== startCell(p) || path[path.length - 1] !== endCell(p)) {
    return false;
  }
  const seen = new Uint8Array(top.T);
  let previous = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    if (!(cell >= 0 && cell < top.T) || seen[cell]) {
      return false;
    }
    seen[cell] = 1;
    if (i > 0 && !canStep(p, path[i - 1], cell)) {
      return false;
    }
    const number = p.cp[cell];
    if (number) {
      if (number !== previous + 1) {
        return false;
      }
      previous = number;
    }
  }
  return previous === maxNumber(p);
}

// The number the path has to reach next: the highest number on it plus one (0 once the highest
// number of the puzzle is on it).
export function nextNumber(p, path) {
  let highest = 0;
  for (const cell of path) {
    highest = Math.max(highest, p.cp[cell]);
  }
  return highest < maxNumber(p) ? highest + 1 : 0;
}

// Whether one step from the head of `path` to `cell` would make the path longer (the test of
// step(), nothing is moved).
export const canPush = (p, path, cell, opts = {}) => step(p, path.slice(), cell, opts) === 'push';

// One move on a path being walked (`path` is changed in place), like core/rules.js step():
//   'push'   the path grew by `cell`
//   'pop'    `cell` is the one before the head: one step back
//   'trunc'  opts.truncate: `cell` is earlier on the path, the path is cut back to it
//   null     refused
// opts.strictOrder: the numbers have to be met in order, and nothing follows the highest number.
export function step(p, path, cell, opts = {}) {
  const length = path.length;
  if (length === 0) {
    if (cell !== startCell(p)) {
      return null;
    }
    path.push(cell);
    return 'push';
  }
  if (length > 1 && cell === path[length - 2]) {
    path.pop();
    return 'pop';
  }
  const at = path.indexOf(cell);
  if (at >= 0) {
    if (opts.truncate && at < length - 1) {
      path.length = at + 1;
      return 'trunc';
    }
    return null;
  }
  const last = path[length - 1];
  if (!canStep(p, last, cell)) {
    return null;
  }
  if (opts.strictOrder) {
    const K = maxNumber(p);
    if (K > 1 && p.cp[last] === K) {
      return null;
    }
    const number = p.cp[cell];
    if (number && number !== nextNumber(p, path)) {
      return null;
    }
  }
  path.push(cell);
  return 'push';
}

// Plain text:
//   surface tetra 4                  (or: surface pentagon 6, surface ball snubdodeca)
//   checkpoints 12=1 7=2 30=3        cell=number, in the order of the numbers
//   walls 3,17,22                    edge numbers
//   path 12 14 ...                   optional: a solution, as cell numbers
// Blank lines and lines starting with # are ignored. opts.times ({ generateMs, solveMs, playS })
// adds `# name value` comment lines, as the flat format does.
export function serializeSurface(p, opts = {}) {
  const lines = [`surface ${p.kind} ${p.n}`];
  const cells = [];
  for (let cell = 0; cell < p.cp.length; cell++) {
    if (p.cp[cell]) {
      cells.push(cell);
    }
  }
  cells.sort((a, b) => p.cp[a] - p.cp[b]);
  if (cells.length) {
    lines.push(`checkpoints ${cells.map(cell => `${cell}=${p.cp[cell]}`).join(' ')}`);
  }
  const walls = wallEdges(p);
  if (walls.length) {
    lines.push(`walls ${walls.join(',')}`);
  }
  if (opts.path && opts.path.length) {
    lines.push(`path ${opts.path.join(' ')}`);
  }
  lines.push(...timeComments(opts.times));
  return `${lines.join('\n')}\n`;
}

// Whether `text` is a surface puzzle: its first line that is not blank or a comment starts with
// `surface` (the design app tells it from a flat puzzle this way).
export const looksLikeSurface = text => /^\s*(?:#[^\n]*\n\s*)*surface\s/.test(text);

const whole = (text, what) => {
  if (!/^\d+$/.test(text)) {
    throw new Error(`${what}: '${text}' is not a whole number`);
  }
  return Number(text);
};

export function parseSurface(text) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  const head = (lines.shift() || '').split(/\s+/);
  if (head[0] !== 'surface' || head.length !== 3) {
    throw new Error(
      "the first line must be 'surface <tetra|cube|pentagon> <n>' or 'surface ball <id>'",
    );
  }
  const size = head[1] === BALL_KIND ? head[2] : whole(head[2], 'size');
  const p = makeSurfacePuzzle(head[1], size);
  const top = topologyOf(p);
  let path;
  for (const line of lines) {
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'checkpoints') {
      for (const item of rest) {
        const [cell, number] = item.split('=');
        const index = whole(cell, 'checkpoint cell');
        if (index >= top.T || p.cp[index]) {
          throw new Error(`checkpoints: bad or repeated cell ${cell}`);
        }
        p.cp[index] = whole(number ?? '', 'checkpoint number');
      }
    } else if (key === 'walls') {
      for (const item of rest.join('').split(',').filter(Boolean)) {
        const edge = whole(item, 'wall');
        if (edge >= top.E) {
          throw new Error(`walls: edge ${edge} does not exist`);
        }
        p.walls[edge] = 1;
      }
    } else if (key === 'path') {
      path = rest.map(item => whole(item, 'path cell'));
    } else {
      throw new Error(`unknown line '${line}'`);
    }
  }
  if (path) {
    const seen = new Set();
    path.forEach((cell, i) => {
      if (cell >= top.T || seen.has(cell)) {
        throw new Error(`path: bad or repeated cell ${cell}`);
      }
      seen.add(cell);
      if (i > 0 && !canStep(p, path[i - 1], cell)) {
        throw new Error(`path: no open side between ${path[i - 1]} and ${cell}`);
      }
    });
    p.path = path;
  }
  return p;
}
