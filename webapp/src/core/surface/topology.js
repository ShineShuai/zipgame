// Closed-surface boards as graphs: the cells of a regular tetrahedron (equilateral triangles, 3
// neighbours each), of a cube (squares, 4 neighbours each) or of a ball (a convex polyhedron whose
// cells are triangles, squares and pentagons, see ball-catalog.js). Every face of a tetra or cube
// is split into n x n cells. The cells are vertices of a graph, an edge joins two cells that share
// a side, and the puzzle is the same as on the flat board: one path through every cell, numbers
// met in order.
//
//   tetra n  4 faces of n^2 triangles: 4n^2 cells, 6n^2 edges, 2n^2 + 2 corners
//   cube n   6 faces of n^2 squares:   6n^2 cells, 12n^2 edges, 6n^2 + 2 corners
//   ball id  one cell per face of the catalog polyhedron `id` (n is the id, a string); every
//            cell is its own face, the sides of the polyhedron are the sides of the cells
//
// Cell numbers (fixed: puzzles and share codes refer to them):
//   cube   face * n^2 + i * n + j, the face 0..5 = +x, -x, +y, -y, +z, -z, row i, column j
//   ball   the index of the face in the catalog entry (its ring list), and the slots of a cell
//          follow its ring: slot k is the side from ring[k] to ring[k + 1]
//   tetra  face * n^2 + k; inside a face the rows i = 0..n-1 come in turn, and each row lists
//          the up triangle (i, j) for j = 0..n-1-i, each followed by the down triangle between
//          it and the next up triangle (not after the last one of the row)
//
// A cell has up to 5 slots (a tetra cell uses 3, a cube cell 4), one per side, in
// counter-clockwise order seen from outside. Slot k of cell c is the side c shares with
// nb[c * SLOTS + k]; rev[c * SLOTS + k] is the slot of that neighbour that points back at c.
// Edges are numbered by (lower cell, slot).
//
// All these boards are closed (no border, nothing is forced by a border). Tetra and cube are not
// bipartite: three cells meet at every corner of the solid, and any two of them touch. A ball is
// bipartite when an even number of cells meets at every corner; then no path can cover it unless
// the two colour classes differ by at most 1 in size (top.classes).
//
// The one exception is the Pentagon board (kind 'pentagon', n = 4 to 11; pentagon.js): a
// flat patch of the Cairo tiling with a border. A cell on the border has sides with no neighbour:
// there nb is -1 and edgeAt is -1 (no edge, so no wall, and the solver never steps there); deg is
// still the number of sides, so a slot is a side as everywhere else. top.flat is true and
// top.centres[2 * cell], [2 * cell + 1] is the centre of a cell (verts have z = 0).

import { BALL_CATALOG } from './ball-catalog.js';
import {
  PENTAGON_KIND, PENTAGON_CELLS, PENTAGON_BOARD_SIZES, pentagonMesh,
} from './pentagon.js';

export { PENTAGON_KIND };

// The kinds with a size n (a whole number); `ball` has an id instead and is listed in BALL_KIND.
export const SURFACE_KINDS = ['tetra', 'cube'];
export const BALL_KIND = 'ball';
// The sizes (n) the app offers; the builders of a tetra or cube accept any n from 1 to MAX_SIDE,
// the Pentagon boards are the sizes listed (pentagon.js).
export const SURFACE_SIZES = { tetra: [3, 4, 5], cube: [3, 4], pentagon: PENTAGON_BOARD_SIZES };
export const MAX_SIDE = 12;
export const SLOTS = 5;

export const surfaceCellCount = (kind, n) => {
  if (kind === BALL_KIND) {
    return ballEntry(n).r.length;
  }
  if (kind === PENTAGON_KIND) {
    return PENTAGON_CELLS[n];
  }
  return (kind === 'tetra' ? 4 : 6) * n * n;
};

const TETRA_CORNERS = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];

// Collects corner points and cells. A corner is identified by an exact integer key, so the same
// point reached from two faces is one vertex.
function makeMesh() {
  const ids = new Map();
  const positions = [];
  const cells = [];
  const faces = [];
  const vertex = (key, xyz) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length;
      ids.set(key, id);
      positions.push(xyz);
    }
    return id;
  };
  // Stores a cell with its corners in counter-clockwise order seen from outside.
  const cell = (face, ring) => {
    const [a, b, c] = ring.map(id => positions[id]);
    const normal = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    let outward = 0;
    for (const id of ring) {
      for (let axis = 0; axis < 3; axis++) {
        outward += normal[axis] * positions[id][axis];
      }
    }
    cells.push(outward < 0 ? ring.slice().reverse() : ring);
    faces.push(face);
  };
  return { vertex, cell, positions, cells, faces };
}

function tetraMesh(n) {
  const mesh = makeMesh();
  for (let face = 0; face < 4; face++) {
    const corners = [0, 1, 2, 3].filter(k => k !== face);
    // The lattice point (i, j), i + j <= n, as weights of the face's three corners.
    const point = (i, j) => {
      const weights = [0, 0, 0, 0];
      weights[corners[0]] = n - i - j;
      weights[corners[1]] = i;
      weights[corners[2]] = j;
      const xyz = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        for (let axis = 0; axis < 3; axis++) {
          xyz[axis] += (weights[k] * TETRA_CORNERS[k][axis]) / n;
        }
      }
      return mesh.vertex(weights.join(','), xyz);
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        mesh.cell(face, [point(i, j), point(i + 1, j), point(i, j + 1)]);
        if (i + j < n - 1) {
          mesh.cell(face, [point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]);
        }
      }
    }
  }
  return mesh;
}

function cubeMesh(n) {
  const mesh = makeMesh();
  for (let face = 0; face < 6; face++) {
    const axis = face >> 1;
    const sign = face & 1 ? -1 : 1;
    const point = (u, v) => {
      const xyz = [0, 0, 0];
      xyz[axis] = sign * n;
      xyz[(axis + 1) % 3] = 2 * u - n;
      xyz[(axis + 2) % 3] = 2 * v - n;
      return mesh.vertex(xyz.join(','), xyz.map(x => x / n));
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        mesh.cell(face, [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]);
      }
    }
  }
  return mesh;
}

// Distances between all pairs of cells by breadth-first search from every cell.
function allDistances(T, nb) {
  const dist = new Uint8Array(T * T).fill(255);
  const queue = new Int32Array(T);
  for (let source = 0; source < T; source++) {
    const row = source * T;
    let head = 0;
    let tail = 0;
    dist[row + source] = 0;
    queue[tail++] = source;
    while (head < tail) {
      const cell = queue[head++];
      for (let k = 0; k < SLOTS; k++) {
        const next = nb[cell * SLOTS + k];
        if (next >= 0 && dist[row + next] === 255) {
          dist[row + next] = dist[row + cell] + 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail !== T) {
      throw new Error('surface graph is not connected');
    }
  }
  return dist;
}

// A 2-colouring of the cells (neighbours differ) as an array of 0 and 1, or null when there is
// none (an odd cycle of cells).
function twoColouring(T, nb) {
  const colour = new Int8Array(T).fill(-1);
  const stack = [0];
  colour[0] = 0;
  while (stack.length) {
    const cell = stack.pop();
    for (let k = 0; k < SLOTS; k++) {
      const next = nb[cell * SLOTS + k];
      if (next < 0) {
        continue;
      }
      if (colour[next] < 0) {
        colour[next] = 1 - colour[cell];
        stack.push(next);
      } else if (colour[next] === colour[cell]) {
        return null;
      }
    }
  }
  return colour;
}

// faceCount: the number of faces of the solid (a cell of a ball is its own face).
// opts.open: the board has a border (a side may have no neighbour); mesh.centres: see the header.
function buildGraph(kind, n, mesh, faceCount, opts = {}) {
  const { cells, faces, positions } = mesh;
  const T = cells.length;
  const nb = new Int32Array(T * SLOTS).fill(-1);
  const rev = new Int8Array(T * SLOTS).fill(-1);
  const ring = new Int32Array(T * SLOTS).fill(-1);
  const deg = new Uint8Array(T);
  const unmatched = new Map();
  for (let cell = 0; cell < T; cell++) {
    const corners = cells[cell];
    if (corners.length > SLOTS) {
      throw new Error(`${kind} ${n}: a cell with more than ${SLOTS} sides`);
    }
    deg[cell] = corners.length;
    for (let k = 0; k < corners.length; k++) {
      ring[cell * SLOTS + k] = corners[k];
      const a = corners[k];
      const b = corners[(k + 1) % corners.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const other = unmatched.get(key);
      if (other === undefined) {
        unmatched.set(key, cell * SLOTS + k);
        continue;
      }
      unmatched.delete(key);
      const otherCell = Math.floor(other / SLOTS);
      nb[cell * SLOTS + k] = otherCell;
      nb[other] = cell;
      rev[cell * SLOTS + k] = other % SLOTS;
      rev[other] = k;
    }
  }
  if (unmatched.size && !opts.open) {
    throw new Error(`${kind} ${n}: a side with no neighbour (the surface is not closed)`);
  }
  const edgeAt = new Int32Array(T * SLOTS).fill(-1);
  const ends = [];
  for (let cell = 0; cell < T; cell++) {
    const seen = new Set();
    for (let k = 0; k < deg[cell]; k++) {
      const other = nb[cell * SLOTS + k];
      if (other < 0) {
        continue; // a side on the border
      }
      if (seen.has(other)) {
        throw new Error(`${kind} ${n}: two cells share more than one side`);
      }
      seen.add(other);
      if (other > cell) {
        const edge = ends.length / 2;
        ends.push(cell, other);
        edgeAt[cell * SLOTS + k] = edge;
        edgeAt[other * SLOTS + rev[cell * SLOTS + k]] = edge;
      }
    }
  }
  const colouring = twoColouring(T, nb);
  // [cells of one colour, cells of the other] of a bipartite board, else null
  const ones = colouring ? colouring.reduce((sum, c) => sum + c, 0) : 0;
  const classes = colouring ? [T - ones, ones] : null;
  const verts = new Float64Array(positions.length * 3);
  positions.forEach((xyz, i) => verts.set(xyz, i * 3));
  return {
    kind,
    n,
    T,
    E: ends.length / 2,
    V: positions.length,
    deg,
    nb,
    rev,
    edgeAt,
    ends: Int32Array.from(ends),
    ring,
    faceOf: Uint16Array.from(faces),
    faceCount,
    verts,
    dist: allDistances(T, nb),
    bipartite: colouring !== null,
    classes,
    ...(opts.open ? { flat: true, centres: Float64Array.from(mesh.centres.flat()) } : {}),
  };
}

const cache = new Map();

const ballsById = new Map(BALL_CATALOG.map(entry => [entry.id, entry]));

// The catalog entry of a ball (see ball-catalog.js): { id, name, f, ok, why, v, r }.
export function ballEntry(id) {
  const entry = ballsById.get(id);
  if (!entry) {
    throw new Error(`unknown ball '${id}'`);
  }
  return entry;
}

// The corners are the unit vectors of the entry, a cell is a face (its ring of corners).
function ballMesh(entry) {
  const mesh = makeMesh();
  const ids = entry.v.map((xyz, i) => mesh.vertex(String(i), xyz));
  entry.r.forEach((ring, face) => mesh.cell(face, ring.map(k => ids[k])));
  return mesh;
}

// The graph of a catalog entry, not cached (tools/ball-catalog.mjs builds it for entries that
// are not in the catalog yet); the app uses surfaceTopology('ball', id).
export const buildBallTopology = entry =>
  buildGraph(BALL_KIND, entry.id, ballMesh(entry), entry.r.length);

export function surfaceTopology(kind, n) {
  const key = `${kind}:${n}`;
  let top = cache.get(key);
  if (top) {
    return top;
  }
  if (kind === BALL_KIND) {
    top = buildBallTopology(ballEntry(n));
  } else if (kind === PENTAGON_KIND) {
    top = buildGraph(kind, n, pentagonMesh(n), PENTAGON_CELLS[n], { open: true });
  } else {
    if (!SURFACE_KINDS.includes(kind)) {
      throw new Error(`unknown surface '${kind}'`);
    }
    if (!Number.isInteger(n) || n < 1 || n > MAX_SIDE) {
      throw new Error(`surface size must be a whole number from 1 to ${MAX_SIDE}`);
    }
    const tetra = kind === 'tetra';
    top = buildGraph(kind, n, tetra ? tetraMesh(n) : cubeMesh(n), tetra ? 4 : 6);
  }
  cache.set(key, top);
  return top;
}

// The edge between two cells, or -1 when they do not touch.
export function edgeBetween(top, a, b) {
  for (let k = 0; k < top.deg[a]; k++) {
    if (top.nb[a * SLOTS + k] === b) {
      return top.edgeAt[a * SLOTS + k];
    }
  }
  return -1;
}

export const graphDistance = (top, a, b) => top.dist[a * top.T + b];

// The mean of a cell's corners, a point on the solid's surface (inside the face, not on a side).
export function cellCentroid(top, cell) {
  const xyz = [0, 0, 0];
  const count = top.deg[cell];
  for (let k = 0; k < count; k++) {
    const corner = top.ring[cell * SLOTS + k];
    for (let axis = 0; axis < 3; axis++) {
      xyz[axis] += top.verts[corner * 3 + axis] / count;
    }
  }
  return xyz;
}
