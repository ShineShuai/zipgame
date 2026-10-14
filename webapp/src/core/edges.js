import { neighbourCell } from './geom.js';

// Edge id e = cell*2 + t.  t=0: edge between cell and its right neighbour (text "V,r,c").
// t=1: between cell and the one below ("H,r,c"). On a wrap-around board (wrap = true, geom.js)
// the right and below neighbours wrap around the borders: the last column's "V" edge joins the
// first column, and the same for "H" and the rows. Only those seam edges need the flag.
export const edgeId = (n, a, b, wrap = false) => {
  if (wrap) {
    if (neighbourCell(n, true, a, 0) === b) return a * 2;
    if (neighbourCell(n, true, b, 0) === a) return b * 2;
    return (neighbourCell(n, true, a, 2) === b ? a : b) * 2 + 1;
  }
  const lo = a < b ? a : b, gap = a < b ? b - a : a - b;
  // A grid has no edge between these two cells: most likely a wrap-around board and a missing
  // `wrap` argument. Without this check the id would silently belong to another edge.
  if (gap !== n && !(gap === 1 && lo % n !== n - 1)) {
    throw new Error(`edgeId: cells ${a} and ${b} are not neighbours on a grid (wrap-around: pass wrap)`);
  }
  return lo * 2 + (gap === 1 ? 0 : 1);
};
export const edgeCells = (n, e, wrap = false) => {
  const a = e >> 1;
  if (wrap) return [a, neighbourCell(n, true, a, e & 1 ? 2 : 0)];
  return [a, e & 1 ? a + n : a + 1];
};
export const hasWallId = (w, e) => (w[e >> 1] >> (e & 1)) & 1;
export const setWallId = (w, e, on) => { if (on) w[e >> 1] |= 1 << (e & 1); else w[e >> 1] &= ~(1 << (e & 1)); };
export const hasWall = (p, a, b) => hasWallId(p.walls, edgeId(p.n, a, b, p.wrap));
// All edges, in the legacy order (row-major; right edge before down edge). `holes` (optional,
// 1 = hole): edges touching a hole are left out. wrap: a torus, so every cell has a right and a
// down edge (the seam ones included).
export function allEdges(n, holes = null, wrap = false) {
  const out = [];
  for (let i = 0; i < n * n; i++) {
    if (holes && holes[i]) continue;
    const right = neighbourCell(n, wrap, i, 0), down = neighbourCell(n, wrap, i, 2);
    if (right >= 0 && !(holes && holes[right])) out.push(i * 2);
    if (down >= 0 && !(holes && holes[down])) out.push(i * 2 + 1);
  }
  return out;
}
// Remove the walls on seam edges (the last column's right edge, the last row's lower edge): only a
// wrap-around board has them. Returns how many were removed.
export function clearSeamWalls(p) {
  const { n, walls } = p;
  let removed = 0;
  for (let i = 0; i < n * n; i++) {
    if (i % n === n - 1 && hasWallId(walls, i * 2)) { setWallId(walls, i * 2, false); removed++; }
    if (i >= n * (n - 1) && hasWallId(walls, i * 2 + 1)) { setWallId(walls, i * 2 + 1, false); removed++; }
  }
  return removed;
}
export const wallIds = p => { const o = []; for (let i = 0; i < p.n * p.n; i++) for (let t = 0; t < 2; t++) if ((p.walls[i] >> t) & 1) o.push(i * 2 + t); return o; };
export const wallCount = p => wallIds(p).length;
export const edgeToKey = (n, e) => `${e & 1 ? 'H' : 'V'},${((e >> 1) / n) | 0},${(e >> 1) % n}`;
export const keyToEdge = (n, k) => { const [t, r, c] = k.split(','); return (+r * n + +c) * 2 + (t === 'H' ? 1 : 0); };
export const pathEdgeIds = (n, path, wrap = false) => {
  const o = [];
  for (let i = 1; i < path.length; i++) o.push(edgeId(n, path[i - 1], path[i], wrap));
  return o;
};

// One-way arrows (puzzle.arrows, Uint8Array(n*n); only the "One way arrows" variant has them).
// They sit on the same edges as walls (edge ids above) and use arrows[cell] the same way, two
// bits per edge (t = e & 1):
//   bit t      the edge has an arrow
//   bit 2 + t  the arrow points to the lower cell index (left / up); clear = right / down
// A one-way edge may only be walked in the direction of its arrow. Nothing has to cross it.
export const arrowDirId = (a, e) => {
  const bits = a[e >> 1];
  const t = e & 1;
  if (!((bits >> t) & 1)) return 0;
  return (bits >> (2 + t)) & 1 ? -1 : 1;
};
// dir: 1 = from the lower to the higher cell index (right / down), -1 = the other way,
// 0 = no arrow.
export function setArrowId(a, e, dir) {
  const t = e & 1;
  let bits = a[e >> 1] & ~((1 << t) | (1 << (2 + t)));
  if (dir !== 0) bits |= 1 << t;
  if (dir < 0) bits |= 1 << (2 + t);
  a[e >> 1] = bits;
}
// May the path step from `from` to its grid neighbour `to`, as far as their edge's arrow goes?
export function arrowAllows(arrows, n, from, to) {
  const dir = arrowDirId(arrows, edgeId(n, from, to));
  return dir === 0 || (dir > 0) === (from < to);
}
// The move [from, to] that the arrow on edge e allows.
export function arrowMove(n, e, dir) {
  const [a, b] = edgeCells(n, e);
  return dir > 0 ? [a, b] : [b, a];
}
export const arrowIds = p => {
  const o = [];
  if (!p.arrows) return o;
  for (let i = 0; i < p.n * p.n; i++) {
    for (let t = 0; t < 2; t++) if ((p.arrows[i] >> t) & 1) o.push(i * 2 + t);
  }
  return o;
};
export const arrowCount = p => arrowIds(p).length;

// null when puzzle.arrows is sound, else a message: right size, canonical bits, only on edges
// that exist, not at a hole, and not on a walled edge.
export function arrowProblem(p) {
  const { n, arrows, walls, holes } = p;
  if (arrows.length !== n * n) return 'Invalid: the arrows array has the wrong size.';
  for (let i = 0; i < n * n; i++) {
    const bits = arrows[i];
    const stray = (bits >> 2) & ~bits & 3; // a direction bit without its arrow bit
    if (bits > 15 || stray) return `Invalid: malformed arrow bits at cell ${i}.`;
    for (let t = 0; t < 2; t++) {
      if (!((bits >> t) & 1)) continue;
      const e = i * 2 + t;
      const onBoard = t === 0 ? i % n + 1 < n : i + n < n * n;
      if (!onBoard) return `Invalid: an arrow leaves the board at cell ${i}.`;
      const [a, b] = edgeCells(n, e);
      if (holes && (holes[a] || holes[b])) return 'Invalid: an arrow touches a hole.';
      if (walls && hasWallId(walls, e)) return 'Invalid: an arrow shares its edge with a wall.';
    }
  }
  return null;
}
