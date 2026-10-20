// The meshes of the solids: the corners and the cells of a tetrahedron, a cube or a ball, in the
// form buildGraph (core/surface/topology.js) takes: { positions, cells, faces }. A tetra or cube
// face is split into n x n cells; a ball is one cell per face of a catalog polyhedron
// (ball-catalog.js).
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

export function tetraMesh(n) {
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

export function cubeMesh(n) {
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

// The corners are the unit vectors of the entry, a cell is a face (its ring of corners).
export function ballMesh(entry) {
  const mesh = makeMesh();
  const ids = entry.v.map((xyz, i) => mesh.vertex(String(i), xyz));
  entry.r.forEach((ring, face) => mesh.cell(face, ring.map(k => ids[k])));
  return mesh;
}
