// The ball board seen from outside, for the ball view of the design app: the cells of a catalog
// solid (core/solid/ball-catalog.js) as pieces of a sphere, the same cells and neighbours, only
// drawn round. No DOM. buildBallView() has the shape of view/proj.js buildView() (the corners of
// every cell in the picture, centers, glued, hidden, depth, frameOf, box, side), so the renderer
// of surface-board.js draws both, and more: the true outline of every cell (a side is the
// great-circle arc between its corners, the parts behind the horizon are cut off along the unit
// circle, so the silhouette is round) and the pieces of the marks, walls and routes in front.
//
// The corners of a catalog entry are the central projection of a convex solid, so every cell is a
// convex spherical polygon, and the cells tile the sphere.
import { SLOTS } from '../core/surface/topology.js';
import { turn, frameForNormal, multiply, axisAngle } from './proj.js';

// The longest piece a side is drawn in, and how fine the arc along the horizon is (radians).
const STEP = 0.14;
const HORIZON_STEP = 0.1;
// A cell is marked (number, head) when the z of its centre is above this; it is drawn when any
// part of it is in front.
const MARKED = 0.08;
// The side the widths of walls and routes are sized by, as a share of the mean side of a cell.
const MARKS = 0.4;
// A number badge: its radius as a share of the radius of the biggest circle in the cell, and its
// largest radius (the unit is the radius of the ball).
const BADGE = 0.5;
const BADGE_MAX = 0.085;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => v.map(value => value / Math.hypot(...v));
const sum = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// The view of the far side: `R`, then a half turn about the vertical axis.
export const behind = R => multiply(axisAngle([0, 1, 0], Math.PI), R);

// The points of the great-circle arc from unit vector a to b in `pieces` pieces (the ends
// included).
function arcBetween(a, b, pieces) {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (angle < 1e-9) {
    return [a, b];
  }
  const points = [];
  for (let i = 0; i <= pieces; i++) {
    const t = i / pieces;
    const wa = Math.sin((1 - t) * angle) / Math.sin(angle);
    const wb = Math.sin(t * angle) / Math.sin(angle);
    points.push([0, 1, 2].map(axis => wa * a[axis] + wb * b[axis]));
  }
  return points;
}

const piecesFor = (a, b) =>
  Math.max(2, Math.ceil(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / STEP));

const slotBetween = (top, from, to) => {
  for (let k = 0; k < top.deg[from]; k++) {
    if (top.nb[from * SLOTS + k] === to) {
      return k;
    }
  }
  return -1;
};

const spheres = new WeakMap();

// What does not depend on the view: the corners of every cell, the arc of every side, the middle
// of every side, the centre direction of every cell, the chord of the biggest circle in a cell
// (radius), and the mean chord of a side.
function sphereOf(top) {
  if (spheres.has(top)) {
    return spheres.get(top);
  }
  const corner = id => unit([0, 1, 2].map(axis => top.verts[id * 3 + axis]));
  const corners = [];
  const centers = [];
  const radius = [];
  const arcs = new Array(top.T * SLOTS);
  const mids = new Array(top.T * SLOTS);
  let chords = 0;
  let sides = 0;
  for (let cell = 0; cell < top.T; cell++) {
    const ring = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      ring.push(corner(top.ring[cell * SLOTS + k]));
    }
    corners.push(ring);
    const centre = unit(ring.reduce(sum));
    centers.push(centre);
    let nearest = Math.PI;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const mid = unit(sum(a, b));
      arcs[cell * SLOTS + k] = arcBetween(a, b, piecesFor(a, b));
      mids[cell * SLOTS + k] = mid;
      nearest = Math.min(nearest, Math.acos(Math.max(-1, Math.min(1, dot(centre, mid)))));
      chords += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      sides++;
    }
    radius.push(2 * Math.sin(nearest / 2));
  }
  const sphere = {
    corners,
    centers,
    radius,
    arcs,
    mids,
    side: chords / sides,
    glued: new Uint8Array(top.T * SLOTS).fill(1),
  };
  spheres.set(top, sphere);
  return sphere;
}

// The cell that contains the direction p (a unit vector of the ball, not of the view): the point
// is to the left of every side of the cell. The exact hit test; -1 for a point on no cell (never
// happens beyond rounding). A point on a side belongs to either cell.
export function directionCell(top, p) {
  const sphere = sphereOf(top);
  let best = -1;
  let margin = -Infinity;
  for (let cell = 0; cell < top.T; cell++) {
    const ring = sphere.corners[cell];
    let least = Infinity;
    for (let k = 0; k < ring.length && least > margin; k++) {
      const side = cross(ring[k], ring[(k + 1) % ring.length]);
      least = Math.min(least, dot(side, p) / Math.hypot(...side));
    }
    if (least > margin) {
      margin = least;
      best = cell;
    }
  }
  return margin >= -1e-9 ? best : -1;
}

// The point where the segment from p to q (z of one above 0, of the other below) crosses the
// horizon, as a point of the unit circle.
function horizon(p, q) {
  const t = p[2] / (p[2] - q[2]);
  const x = p[0] + t * (q[0] - p[0]);
  const y = p[1] + t * (q[1] - p[1]);
  return [x / Math.hypot(x, y), y / Math.hypot(x, y)];
}

// The points along the unit circle, counter-clockwise, from point a to point b (ends left out).
function along(a, b) {
  const from = Math.atan2(a[1], a[0]);
  const full = 2 * Math.PI;
  const turned = (((Math.atan2(b[1], b[0]) - from) % full) + full) % full;
  const steps = Math.ceil(turned / HORIZON_STEP);
  const points = [];
  for (let i = 1; i < steps; i++) {
    const angle = from + (turned * i) / steps;
    points.push([Math.cos(angle), Math.sin(angle)]);
  }
  return points;
}

// The part of the closed outline `points` (3D, in view space, counter-clockwise) that is in front
// (z >= 0), as screen points. Where the outline goes behind, the cut is the horizon: a piece of
// the unit circle. [] when nothing is in front. A cell is convex, so the front part is one run.
export function frontOf(points) {
  const first = points.findIndex(p => p[2] >= 0);
  if (first < 0) {
    return [];
  }
  const out = [];
  let leftAt = null;
  for (let k = 0; k < points.length; k++) {
    const p = points[(first + k) % points.length];
    const q = points[(first + k + 1) % points.length];
    if (p[2] >= 0) {
      out.push([p[0], p[1]]);
    }
    if (p[2] >= 0 && q[2] < 0) {
      leftAt = horizon(p, q);
      out.push(leftAt);
    } else if (p[2] < 0 && q[2] >= 0) {
      const backAt = horizon(p, q);
      out.push(...along(leftAt, backAt), backAt);
    }
  }
  return out;
}

// Splits points (3D view space, null = a break) into the runs in front (z >= 0), as screen points.
function runsInFront(points) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      runs.push(run);
    }
    run = [];
  };
  for (const p of points) {
    if (p && p[2] >= 0) {
      run.push([p[0], p[1]]);
    } else {
      flush();
    }
  }
  flush();
  return runs;
}

const distanceToSegment = ([x, y], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const reach = dx || dy ? ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy) : 0;
  const along = Math.max(0, Math.min(1, reach));
  return Math.hypot(x - (ax + along * dx), y - (ay + along * dy));
};

// Twice the signed area of a polygon of screen points (positive: counter-clockwise).
const doubleArea = poly =>
  poly.reduce((sum, [x, y], i) => {
    const [nx, ny] = poly[(i + 1) % poly.length];
    return sum + x * ny - nx * y;
  }, 0);

// A cell with less than this much of the disc in front is a sliver on the horizon: not drawn.
const SLIVER = 1e-5;

const NO_LETTERS = new Map();

// The ball in view R. Like buildView() and also
//   outlines[cell]        the outline of the part of the cell in front: curved sides, cut by the
//                         horizon (screen points)
//   drawn[cell]           1 when any part of the cell is in front; hidden[cell] is 1 when its
//                         centre is turned away (such a cell is drawn but not marked)
//   sideMid(cell, slot)   the middle of a side, on the arc
//   arcPieces(cell, slot) the parts of the arc of a side that are in front (lists of points)
//   pickSide(cell, x, y)  the slot whose visible side is the nearest to the point
//   routePieces(cells)    a route over the ball: centre to side middle to centre along
//                         great circles, the parts in front (lists of points)
//   markRadius(cell)      the radius of a number badge in this cell (the cells differ in size)
//   uniform, disc         no faces to tell apart; the disc of the ball is drawn behind
// `options.maxWidth` limits the width and height of the picture (the pair of the Map view).
export function buildBallView(top, R, options = {}) {
  const sphere = sphereOf(top);
  const turned = sphere.centers.map(c => turn(R, c));
  const polys = [];
  const centers = [];
  const outlines = [];
  const drawn = [];
  const hidden = [];
  const depth = [];
  for (let cell = 0; cell < top.T; cell++) {
    polys.push(sphere.corners[cell].map(p => turn(R, p).slice(0, 2)));
    centers.push([turned[cell][0], turned[cell][1]]);
    depth.push(turned[cell][2]);
    hidden.push(turned[cell][2] > MARKED ? 0 : 1);
    const ring = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      const arc = sphere.arcs[cell * SLOTS + k];
      ring.push(...arc.slice(0, arc.length - 1).map(p => turn(R, p)));
    }
    outlines.push(frontOf(ring));
    drawn.push(outlines[cell].length >= 3 && doubleArea(outlines[cell]) > 2 * SLIVER ? 1 : 0);
  }
  const arcPieces = (cell, slot) =>
    runsInFront(sphere.arcs[cell * SLOTS + slot].map(p => turn(R, p)));
  return {
    top,
    polys,
    centers,
    glued: sphere.glued,
    letterAt: NO_LETTERS,
    cuts: [],
    tags: [],
    hidden,
    drawn,
    depth,
    outlines,
    uniform: true,
    disc: true,
    frameOf: cell => frameForNormal(turned[cell]),
    sideMid: (cell, slot) => turn(R, sphere.mids[cell * SLOTS + slot]).slice(0, 2),
    arcPieces,
    pickSide(cell, x, y) {
      let best = 0;
      let nearest = Infinity;
      for (let slot = 0; slot < top.deg[cell]; slot++) {
        for (const piece of arcPieces(cell, slot)) {
          for (let i = 0; i + 1 < piece.length; i++) {
            const distance = distanceToSegment([x, y], piece[i], piece[i + 1]);
            if (distance < nearest) {
              nearest = distance;
              best = slot;
            }
          }
        }
      }
      return best;
    },
    routePieces(cells) {
      const chain = [];
      cells.forEach((cell, i) => {
        if (i === 0) {
          chain.push(sphere.centers[cell]);
          return;
        }
        const from = cells[i - 1];
        const slot = slotBetween(top, from, cell);
        if (slot < 0) {
          chain.push(null, sphere.centers[cell]);
          return;
        }
        const mid = sphere.mids[from * SLOTS + slot];
        chain.push(
          ...arcBetween(sphere.centers[from], mid, 3).slice(1),
          ...arcBetween(mid, sphere.centers[cell], 3).slice(1),
        );
      });
      return runsInFront(chain.map(p => (p ? turn(R, p) : null)));
    },
    markRadius: cell => Math.min(sphere.radius[cell] * BADGE, BADGE_MAX),
    box: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    // widths of walls and routes: smaller than the cells, which are large on the screen because
    // the ball fills the picture
    side: sphere.side * MARKS,
    maxSidePx: Infinity,
    maxWidth: options.maxWidth,
    maxHeight: options.maxWidth,
  };
}
