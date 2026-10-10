import { wallIds, arrowIds, arrowDirId, arrowMove } from '../core/edges.js';

// Pure board geometry in "cell units" scaled by s. Shared by every painter (SVG now, canvas later).
export const cellCenter = (n, i, s = 1) => [((i % n) + 0.5) * s, (((i / n) | 0) + 0.5) * s];
export const polyPoints = (n, path, s = 1) => path.map(i => cellCenter(n, i, s).join(',')).join(' ');
export const pathD = (n, path, s = 1) => path.map((i, k) => (k ? 'L' : 'M') + cellCenter(n, i, s).join(' ')).join(' ');
// Pointer position (relative to a w×h board box) -> cell index or -1.
export function cellAtPoint(n, x, y, w, h) {
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  return Math.floor(y / (h / n)) * n + Math.floor(x / (w / n));
}
// Wall segments as [x1,y1,x2,y2] on the shared border of the two cells they separate.
export const wallSegments = (p, s = 1) => wallIds(p).map(e => {
  const a = e >> 1, r = (a / p.n) | 0, c = a % p.n;
  return e & 1 ? [c * s, (r + 1) * s, (c + 1) * s, (r + 1) * s] : [(c + 1) * s, r * s, (c + 1) * s, (r + 1) * s];
});
// Arrow from cell a to cell b, trimmed by `inset` at both ends (so it clears the checkpoint badges).
// Returns { line: [x1,y1,x2,y2] ending at the arrowhead's base, tip: [x,y], head: [x,y,x,y,x,y] triangle }.
export function arrowSegment(n, a, b, s = 1, inset = 0.34, headLen = 0.22, headHalf = 0.1) {
  const [ax, ay] = cellCenter(n, a, s), [bx, by] = cellCenter(n, b, s);
  const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
  const x1 = ax + ux * inset * s, y1 = ay + uy * inset * s, tx = bx - ux * inset * s, ty = by - uy * inset * s;
  const hx = tx - ux * headLen * s, hy = ty - uy * headLen * s, px = -uy * headHalf * s, py = ux * headHalf * s;
  return { line: [x1, y1, hx, hy], tip: [tx, ty], head: [tx, ty, hx + px, hy + py, hx - px, hy - py] };
}

// The one-way mark on the edge between cells `from` and `to`: a triangle (as an SVG points string)
// centred on the middle of the edge, pointing from -> to.
export function arrowMarkPoints(n, from, to, s = 1, tip = 0.2, back = 0.12, half = 0.17) {
  const [ax, ay] = cellCenter(n, from, s);
  const [bx, by] = cellCenter(n, to, s);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const px = -uy;
  const py = ux;
  const corners = [
    [mx + ux * tip * s, my + uy * tip * s],
    [mx - ux * back * s + px * half * s, my - uy * back * s + py * half * s],
    [mx - ux * back * s - px * half * s, my - uy * back * s - py * half * s],
  ];
  return corners.map(([x, y]) => `${+x.toFixed(3)},${+y.toFixed(3)}`).join(' ');
}

// Every one-way arrow of puzzle p as { edge, from, to, points }: the move it allows and its
// triangle.
export function arrowMarks(p, s = 1) {
  return arrowIds(p).map(edge => {
    const [from, to] = arrowMove(p.n, edge, arrowDirId(p.arrows, edge));
    return { edge, from, to, points: arrowMarkPoints(p.n, from, to, s) };
  });
}
