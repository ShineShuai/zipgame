import { isPortalPair } from '../core/geom.js';
import { SEAM_STUB, WRAP_PAD, cellCenter } from '../view/geometry.js';

// Where the line of an edge runs on the board (pure). Lengths are in units of `s` per cell: 1 for
// cells, CELL for board units.
//
//   a plain edge        one chord between the two cell centres
//   a seam of a         two stubs: out at one border, in at the other (as pathD() in
//   Wrap-around board   view/geometry.js draws a step of the single path)
//   a portal pair       a curve (a jump), not a line across cells the path does not visit
//
// The same geometry draws a line (view.js), finds the line under a press (cut.js) and places a
// hint on it.

// The margin of a Wrap-around board, in cells, on every side: the stubs of a seam show there, and
// a drag that leaves the board through it comes in on the other side.
export const padOf = puzzle => (puzzle.wrap ? WRAP_PAD : 0);

// The jump between the portals a and b: a curve { from, via, to } bent to one side. The same bend
// as the play app's jump (apps/play/board.js jumpMarksSvg), whichever way round the pair is named.
export function jumpCurve(n, a, b, s = 1) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const [x1, y1] = cellCenter(n, lo, s);
  const [x2, y2] = cellCenter(n, hi, s);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(s * 1.2, length * 0.22);
  return {
    from: [x1, y1],
    via: [(x1 + x2) / 2 - (dy / length) * bend, (y1 + y2) / 2 + (dx / length) * bend],
    to: [x2, y2],
  };
}

const CURVE_PARTS = 12;

const onCurve = ({ from, via, to }, t) => [0, 1].map(axis => (1 - t) * (1 - t) * from[axis]
  + 2 * (1 - t) * t * via[axis] + t * t * to[axis]);

// The straight pieces [x1, y1, x2, y2] that the line of the edge a-b is made of.
export function edgeSegments(puzzle, a, b, s = 1) {
  const n = puzzle.n;
  if (isPortalPair(puzzle.portals, a, b)) {
    const curve = jumpCurve(n, a, b, s);
    const points = Array.from({ length: CURVE_PARTS + 1 },
      (_, i) => onCurve(curve, i / CURVE_PARTS));
    return points.slice(1).map((point, i) => [...points[i], ...point]);
  }
  const [ax, ay] = cellCenter(n, a, s);
  const [bx, by] = cellCenter(n, b, s);
  if (puzzle.wrap) {
    const far = (n + SEAM_STUB) * s;
    const near = -SEAM_STUB * s;
    if (Math.abs(bx - ax) > 1.01 * s) {
      return [[ax, ay, bx < ax ? far : near, ay], [bx < ax ? near : far, by, bx, by]];
    }
    if (Math.abs(by - ay) > 1.01 * s) {
      return [[ax, ay, ax, by < ay ? far : near], [bx, by < ay ? near : far, bx, by]];
    }
  }
  return [[ax, ay, bx, by]];
}

// The point to put a mark on the line of the edge a-b: the middle of the chord, of the jump, or
// of the stub on a's side of a seam.
export function edgeMiddleOf(puzzle, a, b, s = 1) {
  if (isPortalPair(puzzle.portals, a, b)) {
    return onCurve(jumpCurve(puzzle.n, a, b, s), 0.5);
  }
  const [x1, y1, x2, y2] = edgeSegments(puzzle, a, b, s)[0];
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}
