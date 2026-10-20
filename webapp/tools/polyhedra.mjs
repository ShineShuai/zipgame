// Convex polyhedra for the ball boards (tools/ball-catalog.mjs): a convex hull that merges
// coplanar points into polygons, the operators dual, kis and snub, the seed solids and a
// point spreader for free-form triangulations. Offline only: the app reads the data the catalog
// tool writes (src/core/solid/ball-catalog.js) and never runs this.
//
// A mesh is { verts: [[x, y, z]], faces: [ring], planes: [{ n, d }] }: a ring lists vertex ids
// counter-clockwise seen from outside, plane i is the plane of face i (unit outward normal n, and
// d = n . point > 0 when the origin is inside).
export const PHI = (1 + Math.sqrt(5)) / 2;

const EPS = 1e-7;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => mul(a, 1 / norm(a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mean = points => mul(points.reduce(add, [0, 0, 0]), 1 / points.length);

function dedupe(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const key = p.map(x => Math.round(x * 1e6)).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

// The faces of the convex hull of `points` (brute force: every plane through three points with
// all points on one side). Coplanar points make one polygon.
export function hull(input) {
  const verts = dedupe(input);
  const n = verts.length;
  const found = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const raw = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
        const length = norm(raw);
        if (length < 1e-9) {
          continue;
        }
        const u = mul(raw, 1 / length);
        const d = dot(u, verts[i]);
        let above = false;
        let below = false;
        for (let m = 0; m < n && !(above && below); m++) {
          const s = dot(u, verts[m]) - d;
          above = above || s > EPS;
          below = below || s < -EPS;
        }
        if (above && below) {
          continue;
        }
        const members = [];
        for (let m = 0; m < n; m++) {
          if (Math.abs(dot(u, verts[m]) - d) <= EPS) {
            members.push(m);
          }
        }
        const key = members.join(',');
        if (!found.has(key)) {
          found.set(key, { members, normal: above ? mul(u, -1) : u });
        }
      }
    }
  }
  const faces = [];
  const planes = [];
  for (const { members, normal } of found.values()) {
    const centre = mean(members.map(m => verts[m]));
    const e1 = unit(sub(verts[members[0]], centre));
    const e2 = cross(normal, e1);
    const angle = m => Math.atan2(dot(sub(verts[m], centre), e2), dot(sub(verts[m], centre), e1));
    let ring = members.slice().sort((a, b) => angle(a) - angle(b));
    let trimmed = true;
    while (trimmed && ring.length > 3) {
      trimmed = false;
      for (let at = 0; at < ring.length && !trimmed; at++) {
        const a = verts[ring[(at + ring.length - 1) % ring.length]];
        const b = verts[ring[at]];
        const c = verts[ring[(at + 1) % ring.length]];
        if (Math.abs(dot(cross(sub(b, a), sub(c, b)), normal)) < 1e-9) {
          ring = ring.filter((_, i) => i !== at);
          trimmed = true;
        }
      }
    }
    faces.push(ring);
    planes.push({ n: normal, d: dot(normal, verts[ring[0]]) });
  }
  return { verts, faces, planes };
}

export function edgesOf(faces) {
  const seen = new Map();
  for (const ring of faces) {
    ring.forEach((a, k) => {
      const b = ring[(k + 1) % ring.length];
      seen.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
    });
  }
  return [...seen.values()];
}

// Whether the mesh is a closed convex polyhedron: every side shared by two faces, Euler holds.
export function isClosed(mesh) {
  const count = new Map();
  for (const ring of mesh.faces) {
    ring.forEach((a, k) => {
      const key = `${a},${ring[(k + 1) % ring.length]}`;
      count.set(key, (count.get(key) || 0) + 1);
    });
  }
  for (const [key, times] of count) {
    const [a, b] = key.split(',');
    if (times !== 1 || count.get(`${b},${a}`) !== 1) {
      return false;
    }
  }
  const E = edgesOf(mesh.faces).length;
  return mesh.verts.length - E + mesh.faces.length === 2;
}

// Centred on the mean of its corners, scaled to circumradius 1.
export function normalized(points) {
  const centre = mean(points);
  const moved = points.map(p => sub(p, centre));
  const radius = Math.max(...moved.map(norm));
  return moved.map(p => mul(p, 1 / radius));
}

export const meshOf = points => hull(normalized(points));

// The polar dual about the sphere that touches the edges on average (the midsphere of the
// Archimedean solids): a corner for every face, a face for every corner.
export function dual(mesh) {
  const edges = edgesOf(mesh.faces);
  let sum = 0;
  for (const [a, b] of edges) {
    const A = mesh.verts[a];
    const B = mesh.verts[b];
    sum += norm(cross(A, B)) / norm(sub(B, A));
  }
  const mid = sum / edges.length;
  return meshOf(mesh.planes.map(({ n, d }) => mul(n, mid * mid / d)));
}

// A pyramid on every face, as high as keeps every side of the polyhedron (a taller pyramid makes
// the hull flip the side between two neighbouring pyramids and gives another solid). The highest
// of a few tries, or null.
export function kis(mesh) {
  const V = mesh.verts.length;
  const expected = new Set();
  mesh.faces.forEach((ring, i) => {
    ring.forEach((a, k) => {
      expected.add([a, ring[(k + 1) % ring.length], V + i].sort((x, y) => x - y).join(','));
    });
  });
  for (const height of [0.5, 0.4, 0.3, 0.2, 0.12, 0.06]) {
    const apexes = mesh.faces.map((ring, i) => {
      const base = mean(ring.map(v => mesh.verts[v]));
      return add(base, mul(mesh.planes[i].n, height));
    });
    const next = hull([...mesh.verts, ...apexes]);
    const got = new Set(next.faces.map(ring => ring.slice().sort((x, y) => x - y).join(',')));
    if (next.faces.length === expected.size && [...expected].every(key => got.has(key))) {
      return normalizedMesh(next);
    }
  }
  return null;
}

const normalizedMesh = mesh => meshOf(mesh.verts);

// The corners of a snub-like solid: every face turned by `turn` about its normal and shrunk by
// `shrink` about its centre; one corner per (face, corner).
function twisted(mesh, turn, shrink) {
  const points = [];
  mesh.faces.forEach((ring, f) => {
    const { n } = mesh.planes[f];
    const centre = mean(ring.map(v => mesh.verts[v]));
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    for (const v of ring) {
      const r = sub(mesh.verts[v], centre);
      const turned = add(add(mul(r, c), mul(cross(n, r), s)), mul(n, dot(n, r) * (1 - c)));
      points.push(add(centre, mul(turned, shrink)));
    }
  });
  return points;
}

const ringKey = ring => {
  const at = ring.indexOf(Math.min(...ring));
  return [...ring.slice(at), ...ring.slice(0, at)].join(',');
};

// The snub of a mesh whose faces are all alike (tetrahedron, cube, dodecahedron): its faces
// stay (turned), every corner and every side gets a face. The turn and shrink are tuned (pattern
// search) so that the sides on the unit sphere are as equal as they can be, which gives the
// Archimedean snub cube and snub dodecahedron.
export function snub(mesh) {
  const V = mesh.verts.length;
  const E = edgesOf(mesh.faces).length;
  const want = mesh.faces.length + V + 2 * E;
  const make = (turn, shrink) => hull(twisted(mesh, turn, shrink));
  let base = null;
  let at = null;
  for (const [turn, shrink] of [[0.42, 0.62], [0.3, 0.62], [0.2, 0.7], [0.5, 0.5], [0.15, 0.8]]) {
    const tried = make(turn, shrink);
    if (tried.faces.length === want && isClosed(tried)) {
      base = tried;
      at = [turn, shrink];
      break;
    }
  }
  if (!base) {
    return null;
  }
  const edges = edgesOf(base.faces);
  const spread = ([turn, shrink]) => {
    const pts = twisted(mesh, turn, shrink).map(unit);
    const lengths = edges.map(([a, b]) => norm(sub(pts[a], pts[b])));
    const avg = lengths.reduce((x, y) => x + y, 0) / lengths.length;
    return lengths.reduce((x, y) => x + (y - avg) ** 2, 0) / (avg * avg);
  };
  let step = 0.1;
  let best = spread(at);
  for (let round = 0; round < 80 && step > 1e-7; round++) {
    let moved = false;
    for (const [dt, ds] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const trial = [at[0] + dt * step, at[1] + ds * step];
      const value = spread(trial);
      if (value < best) {
        best = value;
        at = trial;
        moved = true;
      }
    }
    if (!moved) {
      step *= 0.6;
    }
  }
  const tuned = make(at[0], at[1]);
  const same = tuned.faces.length === want
    && isClosed(tuned)
    && tuned.faces.map(ringKey).sort().join('|') === base.faces.map(ringKey).sort().join('|');
  return normalizedMesh(same ? tuned : base);
}

// ---------- seeds ----------

const SIGNS = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
];

// The vectors of `v` with every sign, in every order (`even`: only the cyclic orders).
function arrange(v, even) {
  const orders = even
    ? [[0, 1, 2], [1, 2, 0], [2, 0, 1]]
    : [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const out = [];
  for (const order of orders) {
    for (const s of SIGNS) {
      out.push(order.map((o, i) => v[o] * s[i]));
    }
  }
  return out;
}

const ring = (n, z = 0, offset = 0) =>
  Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * (k + offset)) / n;
    return [Math.cos(a), Math.sin(a), z];
  });

const side = n => 2 * Math.sin(Math.PI / n);

const prism = n => [...ring(n, side(n) / 2), ...ring(n, -side(n) / 2)];

function antiprism(n) {
  const run = 2 * Math.sin(Math.PI / (2 * n));
  const h = Math.sqrt(side(n) ** 2 - run ** 2) / 2;
  return [...ring(n, h), ...ring(n, -h, 0.5)];
}

const pyramid = n => [...ring(n), [0, 0, Math.sqrt(Math.max(side(n) ** 2 - 1, 0.1))]];

const bipyramid = n => {
  const h = Math.sqrt(Math.max(side(n) ** 2 - 1, 0.1));
  return [...ring(n), [0, 0, h], [0, 0, -h]];
};

// The named seeds: [id, name, corners]. Names are the usual ones where there is one.
export function seeds(maxN = 8) {
  const out = [
    ['tetra', 'tetrahedron', SIGNS.filter(s => s[0] * s[1] * s[2] > 0)],
    ['cube', 'cube', SIGNS],
    ['octa', 'octahedron', arrange([1, 0, 0], false)],
    ['dodeca', 'dodecahedron', [...SIGNS, ...arrange([0, 1 / PHI, PHI], true)]],
    ['icosa', 'icosahedron', arrange([0, 1, PHI], true)],
    ['cuboct', 'cuboctahedron', arrange([1, 1, 0], false)],
    ['icosidodeca', 'icosidodecahedron', [
      ...arrange([0, 0, PHI], true),
      ...arrange([0.5, PHI / 2, PHI * PHI / 2], true),
    ]],
    ['rhombicuboct', 'rhombicuboctahedron', arrange([1, 1, 1 + Math.SQRT2], false)],
    ['rhombicosidodeca', 'rhombicosidodecahedron', [
      ...arrange([1, 1, PHI ** 3], true),
      ...arrange([PHI ** 2, PHI, 2 * PHI], true),
      ...arrange([2 + PHI, 0, PHI ** 2], true),
    ]],
  ];
  for (let n = 3; n <= Math.min(maxN, 5); n++) {
    out.push([`prism${n}`, `${n}-gonal prism`, prism(n)]);
  }
  for (let n = 4; n <= maxN; n++) {
    out.push([`antiprism${n}`, `${n}-gonal antiprism`, antiprism(n)]);
  }
  for (let n = 4; n <= 5; n++) {
    out.push([`pyramid${n}`, `${n}-gonal pyramid`, pyramid(n)]);
  }
  for (let n = 3; n <= maxN; n++) {
    if (n !== 4) {
      out.push([`bipyramid${n}`, `${n}-gonal bipyramid`, bipyramid(n)]);
    }
  }
  return out;
}

// ---------- congruent cells ----------

const chord = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The distances between all pairs of corners of a polygon, in the order of its corners from
// corner `start`, forwards (turn 1) or backwards (-1). Corners on the unit sphere: two polygons
// with equal distances are the same spherical polygon (equal up to a rotation or a reflection of
// the sphere).
function spread(corners, start, turn) {
  const k = corners.length;
  const ring = Array.from({ length: k }, (_, i) => corners[(((start + turn * i) % k) + k) % k]);
  const out = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      out.push(chord(ring[i], ring[j]));
    }
  }
  return out;
}

// How far apart two polygons with the same number of corners are from being congruent: the least,
// over the ways to lay one over the other, of the greatest difference of a corner distance.
export function incongruence(a, b) {
  const reference = spread(a, 0, 1);
  let least = Infinity;
  for (let start = 0; start < b.length; start++) {
    for (const turn of [1, -1]) {
      const other = spread(b, start, turn);
      least = Math.min(least, Math.max(...other.map((d, i) => Math.abs(d - reference[i]))));
    }
  }
  return least;
}

// Whether the cells of the same type (triangles, squares, pentagons) of a ball are congruent, as
// the cells of the ball on the sphere: the corners are unit vectors, `rings` list them by cell.
// The solids with this are those with regular faces (Platonic, Archimedean, prisms and antiprisms),
// their duals (the faces of a Catalan solid are all alike) and the pyramids on faces of those
// with one kind of face; a solid with uneven cells, e.g. a pyramid on every face of a square
// pyramid, is not.
export function congruentByType(verts, rings, tolerance = 1e-4) {
  const first = new Map();
  for (const ring of rings) {
    const cell = ring.map(v => verts[v]);
    if (!first.has(cell.length)) {
      first.set(cell.length, cell);
    } else if (incongruence(first.get(cell.length), cell) > tolerance) {
      return false;
    }
  }
  return true;
}

// ---------- identity of a solid ----------

export const fnv = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

// A canonical code of the solid as a planar map: equal exactly when two solids have the same cells
// and neighbours in the same cyclic order, a mirror image counting as equal (Whitney: a 3-connected
// planar graph has one embedding). From every flag (cell, side, direction) the cells are numbered
// in the order a walk meets them; the smallest code of all flags is the code of the solid.
export function canonical(rings) {
  const T = rings.length;
  const owner = new Map();
  rings.forEach((ring, cell) => {
    ring.forEach((a, k) => owner.set(`${a},${ring[(k + 1) % ring.length]}`, [cell, k]));
  });
  const across = rings.map(ring =>
    ring.map((a, k) => owner.get(`${ring[(k + 1) % ring.length]},${a}`)));
  const number = new Int32Array(T);
  const first = new Int32Array(T);
  const walk = (start, side, turn) => {
    number.fill(-1);
    number[start] = 0;
    first[start] = side;
    const order = [start];
    const code = [];
    for (let at = 0; at < order.length; at++) {
      const cell = order[at];
      const sides = rings[cell].length;
      code.push(sides);
      for (let j = 0; j < sides; j++) {
        const [other, back] = across[cell][(((first[cell] + turn * j) % sides) + sides) % sides];
        if (number[other] < 0) {
          number[other] = order.length;
          first[other] = back;
          order.push(other);
        }
        code.push(number[other]);
      }
    }
    return code.join(',');
  };
  let best = null;
  for (let cell = 0; cell < T; cell++) {
    for (let side = 0; side < rings[cell].length; side++) {
      for (const turn of [1, -1]) {
        const code = walk(cell, side, turn);
        if (best === null || code < best) {
          best = code;
        }
      }
    }
  }
  return fnv(best) + best.length;
}
