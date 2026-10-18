// The Pentagon boards: a flat patch of the Cairo tiling, every cell a pentagon. Every cell has the
// same shape (4 equal sides and 1 shorter one, angles 90, 90, 120, 120, 120) and every interior
// cell has 5 neighbours, one per side. The cells are the corners of the snub square tiling (unit
// edges: squares and triangles), two cells touch when the corners are joined by an edge; the
// corners of a cell are the centres of the 5 tiles (2 squares, 3 triangles) around that corner.
//
// One fixed board per size n (the same puzzle always means the same board):
//   n    4   6   8   9   10    cells 16, 36, 64, 96, 100
// The board is the part of the tiling inside a window centred on a 4-fold centre of the tiling (a
// square of the snub tiling): the windows of n = 4, 6, 8, 10 are squares and a turn by 90 degrees
// about the centre maps the board onto itself; n = 9 is a window 4 periods wide and 6 high (a
// portrait board) and a half turn maps it onto itself. The windows are chosen so that no cell has
// fewer than 2 neighbours (no cell sticks out of the board: it would be the start or the end of
// any path, a free hint) and only the 4 corner cells have 2. The other windows that qualify (24,
// 48, 80, 120 cells) have 8 to 20 cells with 2 neighbours; those cells fix both their sides, which
// is 70% (24 cells) to 34% (120 cells) of the path before the first move, against 8 to 23% for the
// boards above 36 cells: they are not offered.
//
// The geometry uses floating point, but every decision made with it has a large margin (see
// WINDOW, ROW_EPS), so every engine builds the same board. test/pentagon.js freezes the numbering.
//
// Cell numbers (fixed: puzzles and share codes refer to them): the cells in reading order of their
// centres, top row first, rows being the cells whose centres have the same y. y points down, as
// on screen; the coordinates of the board are screen coordinates.
// Slots (see topology.js): the corners of a cell go counter-clockwise on screen, and slot 0 is
// the one short side of every cell, so slot k leads to the same kind of side in every cell.

export const PENTAGON_KIND = 'pentagon';
export const PENTAGON_SIZES = [4, 6, 8, 9, 10]; // by cells
export const PENTAGON_CELLS = { 4: 16, 6: 36, 8: 64, 9: 96, 10: 100 };

const PERIOD = (1 + Math.sqrt(3)) / Math.SQRT2; // the snub square tiling repeats every PERIOD
const TILT = Math.PI / 12; // squares are turned by +-15 degrees
const SAME = 1e-6; // two points closer than this are one point
// Width and height of the window in periods. The cell set stays the same for any width or height
// in these ranges: 1.64..2.36, 2.64..3.36, 3.64..4.36, 4.64..5.20 (n = 10) and 5.64..6.36 (the
// height of n = 9); the sizes below sit in the middle of them.
const WINDOW = { 4: [2, 2], 6: [3, 3], 8: [4, 4], 9: [4, 6], 10: [4.9, 4.9] };
// Centres whose y differ by less than this are in one row (theoretically equal y values differ
// by rounding only; distinct rows are at least 0.25 apart).
const ROW_EPS = 1e-6;
// A side is the short one when it is shorter than this (the sides are 0.577 and 0.789 long).
const SHORT_SIDE = 0.65;

// The tiles and corners of the snub square tiling around the origin, up to `reach` periods.
function snubPatch(reach) {
  const points = [];
  const pointId = (x, y) => {
    for (let i = 0; i < points.length; i++) {
      if (Math.abs(points[i][0] - x) < SAME && Math.abs(points[i][1] - y) < SAME) {
        return i;
      }
    }
    points.push([x, y]);
    return points.length - 1;
  };
  const tiles = []; // { ids: corner ids, x, y: the centre }
  const square = (cx, cy, turn) => {
    const ids = [];
    for (let k = 0; k < 4; k++) {
      const a = turn + Math.PI / 4 + (k * Math.PI) / 2;
      ids.push(pointId(cx + Math.SQRT1_2 * Math.cos(a), cy + Math.SQRT1_2 * Math.sin(a)));
    }
    tiles.push({ ids, x: cx, y: cy });
  };
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      square(i * PERIOD, j * PERIOD, TILT);
      square((i + 0.5) * PERIOD, (j + 0.5) * PERIOD, -TILT);
    }
  }
  const around = points.map(() => []);
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const gap = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
      if (Math.abs(gap - 1) < SAME) {
        around[a].push(b);
        around[b].push(a);
      }
    }
  }
  // The triangles: three corners that are all joined.
  for (let a = 0; a < points.length; a++) {
    for (const b of around[a]) {
      if (b < a) continue;
      for (const c of around[b]) {
        if (c > b && around[a].includes(c)) {
          const x = (points[a][0] + points[b][0] + points[c][0]) / 3;
          const y = (points[a][1] + points[b][1] + points[c][1]) / 3;
          tiles.push({ ids: [a, b, c], x, y });
        }
      }
    }
  }
  return { points, around, tiles };
}

// The mesh of board n for buildGraph() in topology.js: { positions, cells, faces, centres }.
// positions: the corners [x, y, 0]; cells[i]: the corner ids of cell i; faces[i] = i (every cell is
// its own face); centres: [[x, y]] of every cell.
export function pentagonMesh(n) {
  if (!PENTAGON_SIZES.includes(n)) {
    throw new Error(`pentagon board size must be one of ${PENTAGON_SIZES.join(', ')}`);
  }
  const [halfX, halfY] = WINDOW[n].map(width => (width * PERIOD) / 2);
  const { points, around, tiles } = snubPatch(Math.ceil(Math.max(...WINDOW[n]) / 2) + 1);
  const tilesAt = points.map(() => []);
  tiles.forEach((tile, index) => tile.ids.forEach(id => tilesAt[id].push(index)));
  let inside = [];
  points.forEach(([x, y], id) => {
    if (Math.abs(x) < halfX && Math.abs(y) < halfY) inside.push(id);
  });
  // Reading order: rows from the top, a row left to right.
  inside.sort((a, b) => points[a][1] - points[b][1]);
  const row = new Map();
  let rows = 0;
  inside.forEach((id, i) => {
    if (i && points[id][1] - points[inside[i - 1]][1] > ROW_EPS) rows++;
    row.set(id, rows);
  });
  inside = inside.sort((a, b) => row.get(a) - row.get(b) || points[a][0] - points[b][0]);
  if (inside.length !== PENTAGON_CELLS[n]) {
    throw new Error(`pentagon ${n}: ${inside.length} cells, expected ${PENTAGON_CELLS[n]}`);
  }
  const cornerOf = new Map(); // tile index -> corner id of the board
  const positions = [];
  const cells = [];
  const centres = [];
  for (const id of inside) {
    const [vx, vy] = points[id];
    if (tilesAt[id].length !== 5 || around[id].length !== 5) {
      throw new Error(`pentagon ${n}: the patch is too small`);
    }
    // The tiles around the corner, counter-clockwise on screen (y down: decreasing angle).
    const turn = tilesAt[id].slice().sort((a, b) => {
      const angle = t => Math.atan2(tiles[t].y - vy, tiles[t].x - vx);
      return angle(b) - angle(a);
    });
    const sides = turn.map((tile, k) => {
      const next = turn[(k + 1) % 5];
      return Math.hypot(tiles[tile].x - tiles[next].x, tiles[tile].y - tiles[next].y);
    });
    const shorts = sides.filter(gap => gap < SHORT_SIDE).length;
    if (shorts !== 1) throw new Error(`pentagon ${n}: a cell without exactly one short side`);
    const first = sides.findIndex(gap => gap < SHORT_SIDE);
    const ring = [];
    for (let k = 0; k < 5; k++) {
      const tile = turn[(first + k) % 5];
      if (!cornerOf.has(tile)) {
        cornerOf.set(tile, positions.length);
        positions.push([tiles[tile].x, tiles[tile].y, 0]);
      }
      ring.push(cornerOf.get(tile));
    }
    cells.push(ring);
    centres.push([vx, vy]);
  }
  return { positions, cells, faces: inside.map((id, i) => i), centres };
}
