// Puzzles on a closed surface (see topology.js): the model, the move rule, the solved check and a
// plain-text format. A puzzle is
//   { surface: 'tetra' | 'cube', n, cp: Uint16Array(T), walls: Uint8Array(E) }
// cp[cell] is the checkpoint number of a cell (0 = none) and walls[edge] is 1 where the side
// between two cells is closed. The rules are those of the flat game: the path starts on 1, ends
// on the highest number, visits every cell once and meets the numbers in ascending order.
import { surfaceTopology, edgeBetween } from './topology.js';

export const isSurfacePuzzle = p => Boolean(p && p.surface);
export const topologyOf = p => surfaceTopology(p.surface, p.n);

export function makeSurfacePuzzle(kind, n) {
  const top = surfaceTopology(kind, n);
  return {
    surface: kind,
    n,
    cp: new Uint16Array(top.T),
    walls: new Uint8Array(top.E),
  };
}

export const cloneSurfacePuzzle = p => ({
  surface: p.surface,
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
    return { ok: false, msg: 'Invalid: the board arrays do not match the surface.' };
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

// Plain text:
//   surface tetra 4
//   checkpoints 12=1 7=2 30=3        cell=number, in the order of the numbers
//   walls 3,17,22                    edge numbers
//   path 12 14 ...                   optional: a solution, as cell numbers
// Blank lines and lines starting with # are ignored.
export function serializeSurface(p, opts = {}) {
  const lines = [`surface ${p.surface} ${p.n}`];
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
  if (opts.path) {
    lines.push(`path ${opts.path.join(' ')}`);
  }
  return `${lines.join('\n')}\n`;
}

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
    throw new Error("the first line must be 'surface <tetra|cube> <n>'");
  }
  const p = makeSurfacePuzzle(head[1], whole(head[2], 'size'));
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
