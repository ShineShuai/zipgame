// Holes of a Cutout board in the design app (puzzle.holes, core/model.js: Uint8Array, 1 = a cell that is
// not part of the board). Kept out of main.js so it runs without a page (test/design-cutout.js).
import { hasWallId, setWallId } from '../../core/edges.js';
import { shapeProblem } from '../../core/gen/shapes.js';

export const holeCount = p => {
  let count = 0;
  if (p.holes) for (const v of p.holes) count += v;
  return count;
};

// Cut a hole at `cell`, or fill it again. A hole has no edges, so the walls on the four sides of the cell go
// with it. Returns { hole, walls } (walls = how many were taken away), or null when the cell has a number:
// a hole never carries a checkpoint, so the number has to go first.
export function toggleHole(p, cell) {
  if (p.holes[cell]) {
    p.holes[cell] = 0;
    return { hole: false, walls: 0 };
  }
  if (p.cp[cell]) return null;
  p.holes[cell] = 1;
  const { n } = p;
  const sides = [cell * 2, cell * 2 + 1];
  if (cell % n > 0) sides.push((cell - 1) * 2); // the wall to the left belongs to the left neighbour
  if (cell >= n) sides.push((cell - n) * 2 + 1); // and the one above to the neighbour above
  let walls = 0;
  for (const e of sides) {
    if (hasWallId(p.walls, e)) {
      setWallId(p.walls, e, false);
      walls++;
    }
  }
  return { hole: true, walls };
}

// Why no path can cover the board as drawn (a message), or null. The generators need a path, so they
// check this first.
export const boardProblem = p => (p.holes ? shapeProblem(p.n, p.holes) : null);
