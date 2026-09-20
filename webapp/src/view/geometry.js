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
