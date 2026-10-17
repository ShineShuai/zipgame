// The solid of a surface board (core/surface/topology.js) seen from outside, for the 3D view of
// the design app. No DOM. A rotation is a 3x3 matrix as 9 numbers (row by row); the view is
// orthographic, x to the right, y up, z towards the viewer, so a cell is seen when its outward
// normal has a positive z. buildView() gives the same shape as view/surface-net.js buildNet() (the
// corners of every cell in the picture, which sides are "glued") plus `hidden`, so one renderer
// draws both.
import { SLOTS } from '../core/surface/topology.js';

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// A cell is seen when the z of its normal is above this (a cell turned edge-on is a sliver).
const SEEN = 0.05;

const minus = (a, b) => a.map((value, axis) => value - b[axis]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = a => a.map(value => value / Math.hypot(...a));

// R applied to the vector v.
export const turn = (R, v) => [
  R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
  R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
  R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
];

// The matrix of "a, then b".
export function multiply(b, a) {
  const out = new Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] = b[row * 3] * a[col]
        + b[row * 3 + 1] * a[3 + col]
        + b[row * 3 + 2] * a[6 + col];
    }
  }
  return out;
}

// The turn by `angle` (radians, right-handed) about `axis`.
export function axisAngle(axis, angle) {
  const [x, y, z] = unit(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

// Rounding errors of many turns in a row: the nearest rotation matrix.
export function orthonormalize(R) {
  const r0 = unit([R[0], R[1], R[2]]);
  const d = r0[0] * R[3] + r0[1] * R[4] + r0[2] * R[5];
  const r1 = unit([R[3] - d * r0[0], R[4] - d * r0[1], R[5] - d * r0[2]]);
  return [...r0, ...r1, ...cross(r0, r1)];
}

// The view R turned on the screen: dx about the vertical axis (positive: the front of the solid
// moves to the right), dy about the horizontal axis (positive: the front moves down).
export const orbit = (R, dx, dy) =>
  orthonormalize(multiply(axisAngle([1, 0, 0], dy), multiply(axisAngle([0, 1, 0], dx), R)));

// The view R turned the shortest way so that direction `d` (a vector of the solid) comes
// `fraction` of the way to pointing at the viewer.
export function turnToward(R, d, fraction = 1) {
  const now = unit(turn(R, d));
  const angle = Math.acos(Math.max(-1, Math.min(1, now[2])));
  if (angle < 1e-9) {
    return R;
  }
  const axis = cross(now, [0, 0, 1]);
  const spin = Math.hypot(...axis) < 1e-9 ? [0, 1, 0] : axis;
  return orthonormalize(multiply(axisAngle(spin, angle * fraction), R));
}

const solids = new WeakMap();

// What does not depend on the view: for every cell the direction of its centre and its outward
// normal; the radius, the side of a cell, and a table of glued sides (all glued: no cuts).
function solidOf(top) {
  if (solids.has(top)) {
    return solids.get(top);
  }
  const vertex = id => [top.verts[id * 3], top.verts[id * 3 + 1], top.verts[id * 3 + 2]];
  const directions = [];
  const normals = [];
  let radius = 0;
  for (let cell = 0; cell < top.T; cell++) {
    const corners = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      corners.push(vertex(top.ring[cell * SLOTS + k]));
      radius = Math.max(radius, Math.hypot(...corners[k]));
    }
    directions.push(unit([0, 1, 2].map(axis => corners.reduce((sum, c) => sum + c[axis], 0))));
    normals.push(unit(cross(minus(corners[1], corners[0]), minus(corners[2], corners[0]))));
  }
  const first = [vertex(top.ring[0]), vertex(top.ring[1])];
  const solid = {
    directions,
    normals,
    radius,
    side: Math.hypot(...minus(first[0], first[1])),
    glued: new Uint8Array(top.T * SLOTS).fill(1),
  };
  solids.set(top, solid);
  return solid;
}

// The outward unit normal of a cell.
export const cellNormal = (top, cell) => solidOf(top).normals[cell];

// The direction (from the middle of the solid) of the centre of a cell.
export const cellDirection = (top, cell) => solidOf(top).directions[cell];

// How a mark lying on a cell is drawn in view R: [a, b, c, d] of an SVG matrix(a b c d e f), where
// (e, f) is the centre of the cell on the screen. The mark is drawn upright in the plane of the
// cell (x to the right, y down, in the units of the screen); the matrix lays it into the plane,
// so it is squeezed with the cell as the solid turns away. Its "up" is the way the plane rises
// on the screen, so numbers stay as upright as the plane allows. For a cell facing the viewer it
// is [1, 0, 0, 1]; its determinant is the z of the normal, the share of its area that is seen.
export function faceFrame(R, top, cell) {
  const n = turn(R, solidOf(top).normals[cell]);
  const up = unit([-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]]);
  const right = cross(up, n);
  return [right[0], -right[1], -up[0], up[1]];
}

// How well the cell faces the viewer in view R: 1 straight at, 0 on the horizon, < 0 behind.
export const facing = (R, top, cell) => turn(R, solidOf(top).directions[cell])[2];

// A first view: looking at the corner where cell 0 is, so three faces are seen.
export const overview = top => turnToward(IDENTITY, solidOf(top).directions[0]);

const EMPTY_LETTERS = new Map();

// The solid in view R, in the shape of view/surface-net.js buildNet(): polys[cell] (the corners
// of the cell, counter-clockwise when it is seen), centers, glued (every side: there are no
// cuts), hidden[cell] (1 when the cell is turned away), depth[cell] (the z of its normal),
// frameOf(cell) (faceFrame), box (the same for every view, so the picture does not jump), side.
export function buildView(top, R) {
  const solid = solidOf(top);
  const polys = [];
  const centers = [];
  const hidden = [];
  const depth = [];
  for (let cell = 0; cell < top.T; cell++) {
    const poly = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      const id = top.ring[cell * SLOTS + k];
      const p = turn(R, [top.verts[id * 3], top.verts[id * 3 + 1], top.verts[id * 3 + 2]]);
      poly.push([p[0], p[1]]);
    }
    polys.push(poly);
    centers.push([0, 1].map(axis => poly.reduce((sum, p) => sum + p[axis], 0) / poly.length));
    const z = turn(R, solid.normals[cell])[2];
    depth.push(z);
    hidden.push(z > SEEN ? 0 : 1);
  }
  const r = solid.radius;
  return {
    top,
    polys,
    centers,
    glued: solid.glued,
    letterAt: EMPTY_LETTERS,
    cuts: [],
    tags: [],
    hidden,
    depth,
    frameOf: cell => faceFrame(R, top, cell),
    box: { minX: -r, minY: -r, maxX: r, maxY: r },
    side: solid.side,
    maxSidePx: Infinity,
  };
}
