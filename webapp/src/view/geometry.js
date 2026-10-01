import { wallIds } from '../core/edges.js';

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
