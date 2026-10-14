import { wallIds, arrowIds, arrowDirId, arrowMove } from '../core/edges.js';

// Pure board geometry in "cell units" scaled by s. Shared by every painter (SVG now, canvas later).
export const cellCenter = (n, i, s = 1) => [((i % n) + 0.5) * s, (((i / n) | 0) + 0.5) * s];
export const polyPoints = (n, path, s = 1) => path.map(i => cellCenter(n, i, s).join(',')).join(' ');
// A wrap-around board (core/geom.js) is drawn with a margin of WRAP_PAD cells on every side: a step
// across a seam leaves the board on one side and comes in on the opposite one, and the margin is
// where the two stubs of such a step are seen. SEAM_STUB = how far into the margin a stub reaches.
export const WRAP_PAD = 0.4;
export const SEAM_STUB = 0.25;
// wrap: the path of a wrap-around board. A step between cells that are not neighbours on the grid
// goes over a seam: a stub out of the board, and a stub in from the opposite side.
export function pathD(n, path, s = 1, wrap = false) {
  if (!wrap) return path.map((i, k) => (k ? 'L' : 'M') + cellCenter(n, i, s).join(' ')).join(' ');
  const far = (n + SEAM_STUB) * s, near = -SEAM_STUB * s;
  let d = '';
  path.forEach((cell, k) => {
    const [x, y] = cellCenter(n, cell, s);
    if (k === 0) { d = `M${x} ${y}`; return; }
    const [px, py] = cellCenter(n, path[k - 1], s);
    const sideways = Math.abs(x - px) > 1.01 * s, vertical = Math.abs(y - py) > 1.01 * s;
    if (sideways) d += `L${x < px ? far : near} ${py}M${x < px ? near : far} ${y}`;
    else if (vertical) d += `L${px} ${y < py ? far : near}M${x} ${y < py ? near : far}`;
    d += `L${x} ${y}`;
  });
  return d;
}
// The in / out marks of a wrap-around path: for every step over a seam, an arrowhead on the stub
// that leaves the board (pointing out) and one on the stub that comes in on the opposite side
// (pointing in). Both point the way the path goes, so tracing the path back, the two stubs of a
// crossing tell which side is the exit and which the entrance. A seam row or column is crossed at
// most once (its edge is one edge), so the two stubs of a crossing are found by their row / column.
// -> [{ kind: 'out' | 'in', x, y, dx, dy }]: the centre of the arrowhead and the unit direction.
export const MARK_OUT = 0.17; // centre of an 'out' arrowhead beyond the border, in cells
export const MARK_IN = 0.15; // centre of an 'in' arrowhead before the border, in cells
export function seamMarks(n, path, s = 1) {
  const marks = [];
  for (let k = 1; k < path.length; k++) {
    const [px, py] = cellCenter(n, path[k - 1], s), [x, y] = cellCenter(n, path[k], s);
    const sideways = Math.abs(x - px) > 1.01 * s, vertical = Math.abs(y - py) > 1.01 * s;
    if (!sideways && !vertical) continue;
    const dx = sideways ? (x < px ? 1 : -1) : 0, dy = vertical ? (y < py ? 1 : -1) : 0;
    const edge = v => (v > 0 ? n * s : 0); // the border the path leaves through, on its axis
    const out = [
      dx ? edge(dx) + dx * MARK_OUT * s : px,
      dy ? edge(dy) + dy * MARK_OUT * s : py,
    ];
    const entry = [
      dx ? edge(-dx) - dx * MARK_IN * s : x,
      dy ? edge(-dy) - dy * MARK_IN * s : y,
    ];
    marks.push({ kind: 'out', x: out[0], y: out[1], dx, dy });
    marks.push({ kind: 'in', x: entry[0], y: entry[1], dx, dy });
  }
  return marks;
}
// The straight line between the centres of cells a and b as segments [x1,y1,x2,y2]. On a grid it is
// one segment. On a wrap-around board it takes the shorter way round each axis, so a line that
// crosses a seam is two pieces: one leaving the board from a, one coming in to b (both reach into
// the margin; a view clips them there).
export function chordSegments(n, wrap, a, b, s = 1) {
  const [ax, ay] = cellCenter(n, a, s), [bx, by] = cellCenter(n, b, s);
  if (!wrap) return [[ax, ay, bx, by]];
  const half = (n * s) / 2;
  const shorter = d => (d > half ? d - n * s : d < -half ? d + n * s : d);
  const dx = shorter(bx - ax), dy = shorter(by - ay);
  if (dx === bx - ax && dy === by - ay) return [[ax, ay, bx, by]];
  return [[ax, ay, ax + dx, ay + dy], [bx - dx, by - dy, bx, by]];
}
// Pointer position (relative to a w×h box) -> cell index or -1. pad: the margin around the board
// in cells (WRAP_PAD). wrap: a point in the margin belongs to the cell on the opposite side (the
// neighbour across the seam), so a drag can leave one side and enter the other.
export function cellAtPoint(n, x, y, w, h, pad = 0, wrap = false) {
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  const span = n + 2 * pad;
  let c = Math.floor(x / (w / span) - pad), r = Math.floor(y / (h / span) - pad);
  if (wrap) {
    c = ((c % n) + n) % n;
    r = ((r % n) + n) % n;
  } else if (c < 0 || c >= n || r < 0 || r >= n) {
    return -1;
  }
  return r * n + c;
}
// Wall segments as [x1,y1,x2,y2] on the shared border of the two cells they separate. A wall across
// a seam of a wrap-around board is drawn on both borders of the board.
export const wallSegments = (p, s = 1) => wallIds(p).flatMap(e => {
  const a = e >> 1, r = (a / p.n) | 0, c = a % p.n;
  const seg = e & 1
    ? [c * s, (r + 1) * s, (c + 1) * s, (r + 1) * s]
    : [(c + 1) * s, r * s, (c + 1) * s, (r + 1) * s];
  if (!p.wrap || !(e & 1 ? r === p.n - 1 : c === p.n - 1)) return [seg];
  return [seg, e & 1 ? [c * s, 0, (c + 1) * s, 0] : [0, r * s, 0, (r + 1) * s]];
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
