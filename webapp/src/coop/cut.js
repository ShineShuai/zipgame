import { cellCenter } from '../view/geometry.js';

// "Press and hold on a line to cut it": which drawn line does a press mean? Pure.
// The point is in cell units: the cell in column c and row r covers [c, c + 1) x [r, r + 1).
const distanceToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const along = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// The drawn edge [a, b] nearest to the point, when the point is within `reach` of the line
// between the two cell centres; else null. At a cell centre, where two lines meet, the line whose
// middle is nearer wins (a press between two cells is the clear way to point at one line).
export function edgeAt(drawing, x, y, reach = 0.3) {
  const n = drawing.puzzle.n;
  let best = null;
  let bestScore = Infinity;
  for (const edge of drawing.edges()) {
    const [ax, ay] = cellCenter(n, edge[0]);
    const [bx, by] = cellCenter(n, edge[1]);
    const near = distanceToSegment(x, y, ax, ay, bx, by);
    if (near > reach) {
      continue;
    }
    const score = near + 0.1 * Math.hypot(x - (ax + bx) / 2, y - (ay + by) / 2);
    if (score < bestScore) {
      best = edge;
      bestScore = score;
    }
  }
  return best;
}
