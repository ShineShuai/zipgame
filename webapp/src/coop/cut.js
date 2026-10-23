import { edgeMiddleOf, edgeSegments } from './layout.js';

// "Press and hold on a line to cut it": which drawn line does a press mean? Pure.
// The point is in cell units: the cell in column c and row r covers [c, c + 1) x [r, r + 1).
// A line is its chord, the two stubs of a seam, or the curve of a jump (layout.js).
const distanceToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const along = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// The drawn edge [a, b] nearest to the point, when the point is within `reach` of its line; else
// null. At a cell centre, where two lines meet, the line whose
// middle is nearer wins (a press between two cells is the clear way to point at one line).
export function edgeAt(drawing, x, y, reach = 0.3) {
  let best = null;
  let bestScore = Infinity;
  for (const edge of drawing.edges()) {
    const pieces = edgeSegments(drawing.puzzle, edge[0], edge[1]);
    const near = Math.min(...pieces.map(piece => distanceToSegment(x, y, ...piece)));
    if (near > reach) {
      continue;
    }
    const [mx, my] = edgeMiddleOf(drawing.puzzle, edge[0], edge[1]);
    const score = near + 0.1 * Math.hypot(x - mx, y - my);
    if (score < bestScore) {
      best = edge;
      bestScore = score;
    }
  }
  return best;
}
