// Boards with holes for the Cutout variant (see cutout.js): a hole is a cell that is not part of
// the board. A board is two layers:
//
//   silhouette the outline: square, octagon, L, cross, T, U or H (corner blocks and notches cut
//   away)
//   interior 0-4 holes inside it: single cells, dominoes, 2x2 blocks or one rectangle in the
//   middle (a donut)
//
// Checkerboard rule: colour the cells like a checkerboard. Every step of a path changes colour, so
// a path through every cell
// alternates and the two colour counts can differ by at most 1 (when they differ, it starts and
// ends on the larger colour).
// A board that breaks the rule has no solution. Dominoes and 2x2 blocks always keep the counts; a
// single hole is placed on the
// colour that keeps them within 1; silhouettes are drawn at random and kept only when they obey
// the rule.
//
// An interior hole never touches the board's edge (a free cell all around it) and keeps 2 free
// cells to the silhouette and the
// other holes, so there is no long 1-wide corridor: that is one forced run, which is no fun.
// (Silhouette arms are at least a
// third of the board wide for the same reason.)
//
// Nothing here knows about difficulty: the generator (cutout.js) builds puzzles on many boards and
// keeps the best.

export const SILHOUETTES = ['square', 'octagon', 'ell', 'cross', 'tee', 'ushape', 'hshape'];
// The names a board can carry (puzzle.shape): its silhouette, or for a square one: 'donut' (a hole
// in the middle) or 'pillars'.
export const LABELS = ['donut', 'pillars', 'octagon', 'ell', 'cross', 'tee', 'ushape', 'hshape'];

const CLEARANCE = 2; // free cells kept around a hole, to other holes
const EDGE_CLEARANCE = 1; // and to the edge of the board
const WARNSDORFF_TRIES = 48;
const MIN_AREA = 0.45; // share of the board that is left at least
// Number of interior holes asked for, by weight: 0, 1, 2, 3, 4.
const COUNT_WEIGHTS = [2, 3, 3, 2, 1];
// Interior hole kinds, by weight (the 'centre' rectangle is used at most once per board).
const KIND_WEIGHTS = { single: 4, domino: 4, block: 2, centre: 1 };

// ---------- checkerboard ----------

// 0 = (row + col) even (the colour of the top-left corner), 1 = odd.
export const colourOf = (n, i) => (((i / n) | 0) + (i % n)) & 1;

// [cells of colour 0, cells of colour 1] among the cells that are not holes.
export function colourCounts(n, holes) {
  const count = [0, 0];
  for (let i = 0; i < n * n; i++) {
    if (!(holes && holes[i])) {
      count[colourOf(n, i)]++;
    }
  }
  return count;
}

export const isBalanced = (n, holes) => {
  const [a, b] = colourCounts(n, holes);
  return Math.abs(a - b) <= 1;
};

// ---------- graph of the cells that are left ----------

export function adjacency(n, holes) {
  const adj = [];
  for (let i = 0; i < n * n; i++) {
    const list = [];
    if (!holes[i]) {
      const r = (i / n) | 0;
      const c = i % n;
      if (r > 0 && !holes[i - n]) list.push(i - n);
      if (r < n - 1 && !holes[i + n]) list.push(i + n);
      if (c > 0 && !holes[i - 1]) list.push(i - 1);
      if (c < n - 1 && !holes[i + 1]) list.push(i + 1);
    }
    adj.push(list);
  }
  return adj;
}

// Necessary conditions for a path through every cell (cheap, so a bad board is dropped before a
// path is searched for): the
// colour counts differ by at most 1, the cells form one piece, and at most two cells (the path's
// ends) hang on one neighbour.
export function shapeIsViable(n, holes) {
  if (!isBalanced(n, holes)) {
    return false;
  }
  const adj = adjacency(n, holes);
  let cells = 0;
  let ends = 0;
  let first = -1;
  for (let i = 0; i < n * n; i++) {
    if (holes[i]) {
      continue;
    }
    cells++;
    if (first < 0) {
      first = i;
    }
    if (adj[i].length === 0) {
      return false;
    }
    if (adj[i].length === 1) {
      ends++;
    }
  }
  if (cells < 4 || ends > 2) {
    return false;
  }
  const seen = new Uint8Array(n * n);
  const stack = [first];
  seen[first] = 1;
  let reached = 0;
  while (stack.length) {
    const u = stack.pop();
    reached++;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = 1;
        stack.push(v);
      }
    }
  }
  return reached === cells;
}

// ---------- path ----------

// Randomised Warnsdorff walk (as gen/hampath.js) over the cells that are not holes. When the
// colour counts differ the path
// has to start on the larger colour, so it does. Returns null on a dead end.
export function warnsdorffHoles(n, holes, rnd, adj = adjacency(n, holes)) {
  const total = n * n;
  const visited = new Uint8Array(total);
  const counts = colourCounts(n, holes);
  const starts = [];
  for (let i = 0; i < total; i++) {
    if (holes[i]) {
      continue;
    }
    const colour = colourOf(n, i);
    if (counts[0] === counts[1] || counts[colour] > counts[1 - colour]) {
      starts.push(i);
    }
  }
  let cur = starts[Math.floor(rnd() * starts.length)];
  const path = [cur];
  visited[cur] = 1;
  const freeCount = cell => adj[cell].filter(v => !visited[v]).length;
  while (path.length < counts[0] + counts[1]) {
    const options = adj[cur].filter(v => !visited[v]).map(v => [v, freeCount(v)]);
    if (!options.length) {
      return null;
    }
    const fewest = Math.min(...options.map(o => o[1]));
    const best = options.filter(o => o[1] === fewest);
    cur = best[Math.floor(rnd() * best.length)][0];
    visited[cur] = 1;
    path.push(cur);
  }
  return path;
}

// ---------- sampling helpers ----------

const between = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const third = n => Math.max(2, Math.ceil(n / 3));
// The ways to centre a gap of k cells (two when k is odd).
const halves = k => [...new Set([Math.floor(k / 2), Math.ceil(k / 2)])];
const oneOf = (rnd, list) => list[Math.floor(rnd() * list.length)];

function weighted(rnd, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let x = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) {
      return i;
    }
  }
  return weights.length - 1;
}

// Mask with the given rectangles [row, col, height, width] cut out.
function rectHoles(n, rects) {
  const holes = new Uint8Array(n * n);
  for (const [r0, c0, h, w] of rects) {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        holes[r * n + c] = 1;
      }
    }
  }
  return holes;
}

// Quarter turns clockwise (k = 0-3). The colour counts of the cells left stay within 1 of each
// other.
function rotate(n, holes, k) {
  let cur = holes;
  for (let t = 0; t < k; t++) {
    const next = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        next[c * n + (n - 1 - r)] = cur[r * n + c];
      }
    }
    cur = next;
  }
  return cur;
}

// ---------- silhouettes ----------

// Each returns a mask of the cells cut away, or null when this size has no such shape. Parameters
// are drawn at random;
// sampleSilhouette keeps a draw only when it obeys the checkerboard rule.
const SILHOUETTE_MAKERS = {
  square: n => new Uint8Array(n * n),

  // The four corners cut away stair-wise (r + c < m).
  octagon: (n, rnd) => {
    const base = between(rnd, 2, Math.max(2, Math.floor(n / 3)));
    const m = [0, 1, 2, 3].map(() => between(rnd, Math.max(1, base - 1), base));
    const holes = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const topLeft = r + c < m[0];
        const topRight = r + (n - 1 - c) < m[1];
        const bottomLeft = n - 1 - r + c < m[2];
        const bottomRight = 2 * n - 2 - r - c < m[3];
        holes[r * n + c] = topLeft || topRight || bottomLeft || bottomRight ? 1 : 0;
      }
    }
    return holes;
  },

  // One corner block cut away.
  ell: (n, rnd) => {
    const lo = third(n);
    const h = between(rnd, lo, n - lo);
    const w = between(rnd, lo, n - lo);
    const top = rnd() < 0.5;
    const left = rnd() < 0.5;
    return rectHoles(n, [[top ? 0 : n - h, left ? 0 : n - w, h, w]]);
  },

  // All four corner blocks cut away: a vertical arm w wide and a horizontal one h high.
  cross: (n, rnd) => {
    const lo = third(n);
    const hi = Math.ceil(n * 0.6);
    const w = between(rnd, lo, hi);
    const h = between(rnd, Math.max(lo, w - 1), Math.min(hi, w + 1));
    if (n - w < 2 || n - h < 2) {
      return null;
    }
    const r0 = oneOf(rnd, halves(n - h));
    const c0 = oneOf(rnd, halves(n - w));
    const r1 = n - r0 - h;
    const c1 = n - c0 - w;
    return rectHoles(n, [
      [0, 0, r0, c0],
      [0, c0 + w, r0, c1],
      [r0 + h, 0, r1, c0],
      [r0 + h, c0 + w, r1, c1],
    ]);
  },

  // A bar across the top and a stem down the middle (any of the four turns).
  tee: (n, rnd) => {
    const lo = third(n);
    const bar = between(rnd, lo, Math.ceil(n / 2));
    const stem = between(rnd, lo, n - 2);
    const c0 = oneOf(rnd, halves(n - stem));
    const holes = rectHoles(n, [[bar, 0, n - bar, c0], [bar, c0 + stem, n - bar, n - c0 - stem]]);
    return rotate(n, holes, between(rnd, 0, 3));
  },

  // A notch cut into the middle of one side.
  ushape: (n, rnd) => {
    const lo = third(n);
    const hiSide = Math.floor((n - 2) / 2);
    if (hiSide < lo) {
      return null;
    }
    const side = between(rnd, lo, hiSide);
    const depth = between(rnd, lo, n - lo);
    return rotate(n, rectHoles(n, [[0, side, depth, n - 2 * side]]), between(rnd, 0, 3));
  },

  // A notch in the middle of two opposite sides.
  hshape: (n, rnd) => {
    const lo = third(n);
    const hiSide = Math.floor((n - 2) / 2);
    const hiDepth = Math.floor((n - lo) / 2);
    const minDepth = Math.max(2, Math.floor(n / 4));
    if (hiSide < lo || hiDepth < minDepth) {
      return null;
    }
    const side = between(rnd, lo, hiSide);
    const depth = between(rnd, minDepth, hiDepth);
    const width = n - 2 * side;
    const holes = rectHoles(n, [[0, side, depth, width], [n - depth, side, depth, width]]);
    return rotate(n, holes, between(rnd, 0, 1));
  },
};

// A silhouette mask for size n that obeys the checkerboard rule (a few draws are tried), or null.
export function sampleSilhouette(name, n, rnd) {
  for (let draw = 0; draw < 24; draw++) {
    const holes = SILHOUETTE_MAKERS[name](n, rnd);
    if (!holes) {
      return null;
    }
    const left = holes.reduce((s, v) => s + (1 - v), 0);
    if (left >= MIN_AREA * n * n && shapeIsViable(n, holes)) {
      return holes;
    }
  }
  return null;
}

// ---------- interior holes ----------

// Cells of a random hole of this kind, or null.
function sampleHole(n, kind, rnd) {
  const cell = (r, c) => r * n + c;
  const cells = [];
  let h = 1;
  let w = 1;
  if (kind === 'domino') {
    [h, w] = rnd() < 0.5 ? [1, 2] : [2, 1];
  } else if (kind === 'block') {
    h = 2;
    w = 2;
  } else if (kind === 'centre') {
    h = between(rnd, 2, Math.floor(n / 2));
    w = between(rnd, Math.max(2, h - 2), Math.min(Math.floor(n / 2), h + 2));
  }
  const r0 = kind === 'centre' ? oneOf(rnd, halves(n - h)) : between(rnd, 0, n - h);
  const c0 = kind === 'centre' ? oneOf(rnd, halves(n - w)) : between(rnd, 0, n - w);
  for (let r = r0; r < r0 + h; r++) {
    for (let c = c0; c < c0 + w; c++) {
      cells.push(cell(r, c));
    }
  }
  return cells;
}

// A hole may go where no cell within CLEARANCE of it is a hole and every cell within
// EDGE_CLEARANCE is on the board.
function hasClearance(n, holes, cells) {
  for (const i of cells) {
    const r = (i / n) | 0;
    const c = i % n;
    for (let dr = -CLEARANCE; dr <= CLEARANCE; dr++) {
      for (let dc = -CLEARANCE; dc <= CLEARANCE; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        const onBoard = rr >= 0 && rr < n && cc >= 0 && cc < n;
        const reach = Math.max(Math.abs(dr), Math.abs(dc));
        if (onBoard ? holes[rr * n + cc] : reach <= EDGE_CLEARANCE) {
          return false;
        }
      }
    }
  }
  return true;
}

// Cut up to `wanted` holes into the silhouette `base`, keeping the checkerboard rule. Returns {
// holes, count, centre }:
// count = holes cut (fewer than wanted when no place was found).
function addInterior(n, base, wanted, rnd) {
  const holes = base.slice();
  const kinds = Object.keys(KIND_WEIGHTS);
  const weights = Object.values(KIND_WEIGHTS);
  let diff = colourCounts(n, holes);
  diff = diff[0] - diff[1];
  let count = 0;
  let centre = false;
  for (let attempt = 0; attempt < 40 * wanted && count < wanted; attempt++) {
    const kind = kinds[weighted(rnd, weights)];
    if (kind === 'centre' && centre) {
      continue;
    }
    const cells = sampleHole(n, kind, rnd);
    if (!hasClearance(n, holes, cells)) {
      continue;
    }
    let delta = 0;
    for (const i of cells) {
      delta += colourOf(n, i) === 0 ? 1 : -1;
    }
    if (Math.abs(diff - delta) > 1) {
      continue;
    }
    for (const i of cells) {
      holes[i] = 1;
    }
    diff -= delta;
    count++;
    centre = centre || kind === 'centre';
  }
  return { holes, count, centre };
}

function labelOf(silhouette, centre) {
  if (silhouette !== 'square') {
    return silhouette;
  }
  return centre ? 'donut' : 'pillars';
}

// ---------- boards ----------

// A random board for size n with a path through all its cells: { holes, path, silhouette, label,
// interior } where interior =
// the number of holes inside the silhouette, or null (rarely: nothing found). o.silhouettes
// restricts the outlines tried,
// o.interior fixes the number of interior holes asked for (tests, tuning). A board has at least
// one hole.
export function proposeBoard(n, rnd, o = {}) {
  const names = o.silhouettes || SILHOUETTES;
  for (let round = 0; round < 60; round++) {
    const silhouette = oneOf(rnd, names);
    const base = sampleSilhouette(silhouette, n, rnd);
    if (!base) {
      continue;
    }
    const wanted = o.interior ?? weighted(rnd, COUNT_WEIGHTS);
    const { holes, count, centre } = addInterior(n, base, wanted, rnd);
    if ((silhouette === 'square' && count === 0) || !shapeIsViable(n, holes)) {
      continue;
    }
    const adj = adjacency(n, holes);
    for (let attempt = 0; attempt < WARNSDORFF_TRIES; attempt++) {
      const path = warnsdorffHoles(n, holes, rnd, adj);
      if (path) {
        return { holes, path, silhouette, label: labelOf(silhouette, centre), interior: count };
      }
    }
  }
  return null;
}
