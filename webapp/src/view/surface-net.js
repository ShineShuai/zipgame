// The flat net of a closed-surface board (core/surface/topology.js): the faces of the solid are
// unfolded into one plane, so the board can be drawn, clicked and played on a screen before there
// is a 3D view. No DOM: the design app draws what this returns (apps/design/surface-board.js).
//
// The unfolding is generic. The first face is put in the plane (its first side along the x axis);
// every other face is hinged on a face that is already placed, along the edge the two share, by a
// breadth-first search over the faces. A cube then comes out as a cross (the first face in the
// middle, four around it, the opposite one on the end of an arm), a tetrahedron as one big
// triangle with a flap on each side.
//
// Coordinates are in the units of the solid (x right, y up, seen from outside, so a cell's
// corners run counter-clockwise like top.ring); the drawing flips y.
//
// The net cuts the surface along the edges between faces that were not hinged. A side of a cell
// on such a cut has its neighbour somewhere else on the net: it is called unglued. The two
// copies of one cut carry the same letter (A, B, ...): the sides that touch when the net is
// folded.
import { SLOTS } from '../core/surface/topology.js';

const EPS = 1e-6;

const vertexOf = (top, id) => [top.verts[id * 3], top.verts[id * 3 + 1], top.verts[id * 3 + 2]];
const minus = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const norm = a => Math.hypot(...a);
const scaled = (a, factor) => a.map(value => value * factor);
const unit = a => scaled(a, 1 / norm(a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;

// The corner ids of every face.
function faceCorners(top) {
  const sets = Array.from({ length: top.faceCount }, () => new Set());
  for (let cell = 0; cell < top.T; cell++) {
    for (let k = 0; k < top.deg[cell]; k++) {
      sets[top.faceOf[cell]].add(top.ring[cell * SLOTS + k]);
    }
  }
  return sets;
}

// Where the corners of face `root` land in the plane: the first side of cell 0 that lies on the
// border of the face runs along the x axis, the face above it.
function placeRoot(top, corners, root) {
  const cell = 0;
  let slot = 0;
  for (let k = 0; k < top.deg[cell]; k++) {
    if (top.faceOf[top.nb[cell * SLOTS + k]] !== root) {
      slot = k;
      break;
    }
  }
  const ring = k => top.ring[cell * SLOTS + (k % top.deg[cell])];
  const origin = vertexOf(top, ring(slot));
  const e1 = unit(minus(vertexOf(top, ring(slot + 1)), origin));
  const a = vertexOf(top, ring(0));
  const outward = unit(cross(minus(vertexOf(top, ring(1)), a), minus(vertexOf(top, ring(2)), a)));
  const e2 = cross(outward, e1);
  const placed = new Map();
  for (const id of corners[root]) {
    const d = minus(vertexOf(top, id), origin);
    placed.set(id, [dot(d, e1), dot(d, e2)]);
  }
  return placed;
}

// Hinges face g on the placed face f along their shared edge.
function hinge(top, corners, placed, f, g) {
  const shared = [...corners[f]].filter(id => corners[g].has(id));
  let ends = [shared[0], shared[0]];
  let longest = -1;
  for (const a of shared) {
    for (const b of shared) {
      const length = norm(minus(vertexOf(top, a), vertexOf(top, b)));
      if (length > longest) {
        longest = length;
        ends = [a, b];
      }
    }
  }
  const [A, B] = ends;
  const a2 = placed[f].get(A);
  const b2 = placed[f].get(B);
  const along = unit([b2[0] - a2[0], b2[1] - a2[1]]);
  let away = [-along[1], along[0]];
  const inside = [0, 0];
  for (const point of placed[f].values()) {
    inside[0] += point[0] / placed[f].size;
    inside[1] += point[1] / placed[f].size;
  }
  if ((inside[0] - a2[0]) * away[0] + (inside[1] - a2[1]) * away[1] > 0) {
    away = [-away[0], -away[1]];
  }
  const a3 = vertexOf(top, A);
  const axis = unit(minus(vertexOf(top, B), a3));
  const result = new Map();
  for (const id of corners[g]) {
    const d = minus(vertexOf(top, id), a3);
    const s = dot(d, axis);
    const t = norm(minus(d, scaled(axis, s)));
    result.set(id, [a2[0] + s * along[0] + t * away[0], a2[1] + s * along[1] + t * away[1]]);
  }
  return result;
}

const sideOf = (net, cell, slot) => {
  const poly = net.polys[cell];
  return [poly[slot], poly[(slot + 1) % poly.length]];
};

const midpoint = ([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// The slot of `a` whose side touches `b`, or -1.
export function slotBetween(top, a, b) {
  for (let k = 0; k < top.deg[a]; k++) {
    if (top.nb[a * SLOTS + k] === b) {
      return k;
    }
  }
  return -1;
}

// Which sides are glued, the cuts and their letters.
function findCuts(top, polys) {
  const glued = new Uint8Array(top.T * SLOTS);
  const letterAt = new Map();
  const cuts = new Map();
  for (let cell = 0; cell < top.T; cell++) {
    for (let k = 0; k < top.deg[cell]; k++) {
      const other = top.nb[cell * SLOTS + k];
      const back = top.rev[cell * SLOTS + k];
      const p = polys[cell][k];
      const q = polys[cell][(k + 1) % top.deg[cell]];
      const r = polys[other][back];
      const s = polys[other][(back + 1) % top.deg[other]];
      if (near(p, s) && near(q, r)) {
        glued[cell * SLOTS + k] = 1;
        continue;
      }
      const faces = [top.faceOf[cell], top.faceOf[other]].sort((x, y) => x - y);
      const key = faces.join('-');
      if (!cuts.has(key)) {
        cuts.set(key, { letter: String.fromCharCode(65 + cuts.size), faces, copies: new Map() });
      }
      letterAt.set(cell * SLOTS + k, cuts.get(key).letter);
      const copies = cuts.get(key).copies;
      const face = top.faceOf[cell];
      if (!copies.has(face)) {
        copies.set(face, []);
      }
      copies.get(face).push({ cell, slot: k });
    }
  }
  return { glued, letterAt, cuts: [...cuts.values()] };
}

// One letter tag per copy of a cut: on the middle side of the copy, pushed outwards.
function cutTags(net, cuts) {
  const tags = [];
  for (const cut of cuts) {
    for (const [face, sides] of cut.copies) {
      const mids = sides.map(({ cell, slot }) => midpoint(sideOf(net, cell, slot)));
      const mean = [0, 1].map(axis => mids.reduce((sum, m) => sum + m[axis], 0) / mids.length);
      const spread = m => Math.hypot(m[0] - mean[0], m[1] - mean[1]);
      const best = mids.reduce((at, m, i) => (spread(m) < spread(mids[at]) ? i : at), 0);
      const [x, y] = mids[best];
      const [cx, cy] = net.centers[sides[best].cell];
      const out = unit([x - cx, y - cy]);
      tags.push({ letter: cut.letter, face, x, y, dx: out[0], dy: out[1], ...sides[best] });
    }
  }
  return tags;
}

const nets = new WeakMap();

// The net of a surface topology (cached). Returns
//   polys[cell]   the corners of the cell, in the order of top.ring
//   centers[cell] the mean of the corners
//   glued[cell * SLOTS + slot]  1 where the neighbour across that side is drawn right beside it
//   letterAt      Map(cell * SLOTS + slot -> letter) for the sides on a cut
//   cuts          [{ letter, faces, copies: Map(face -> [{ cell, slot }]) }]
//   tags          [{ letter, x, y, dx, dy, cell, slot }]: where each copy of a cut is labelled
//   box           { minX, minY, maxX, maxY }
//   side          the length of a cell side
export function buildNet(top) {
  if (nets.has(top)) {
    return nets.get(top);
  }
  const corners = faceCorners(top);
  const placed = new Array(top.faceCount).fill(null);
  placed[0] = placeRoot(top, corners, 0);
  const order = [0];
  for (let head = 0; head < order.length; head++) {
    for (let g = 0; g < top.faceCount; g++) {
      if (placed[g]) {
        continue;
      }
      const touching = [...corners[order[head]]].filter(id => corners[g].has(id)).length;
      if (touching >= 2) {
        placed[g] = hinge(top, corners, placed, order[head], g);
        order.push(g);
      }
    }
  }
  const polys = [];
  const centers = [];
  for (let cell = 0; cell < top.T; cell++) {
    const face = top.faceOf[cell];
    const poly = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      poly.push(placed[face].get(top.ring[cell * SLOTS + k]));
    }
    polys.push(poly);
    centers.push([0, 1].map(axis => poly.reduce((sum, p) => sum + p[axis], 0) / poly.length));
  }
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const poly of polys) {
    for (const [x, y] of poly) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  const { glued, letterAt, cuts } = findCuts(top, polys);
  const net = {
    top,
    polys,
    centers,
    glued,
    letterAt,
    cuts,
    box,
    side: Math.hypot(polys[0][0][0] - polys[0][1][0], polys[0][0][1] - polys[0][1][1]),
  };
  net.tags = cutTags(net, cuts);
  nets.set(top, net);
  return net;
}

// The layout of a flat board (top.flat: the Pentagon board): the cells lie as they are, nothing is
// folded, nothing is cut, so every side with a neighbour is glued and the border is the only edge.
// top.verts and top.centres are screen coordinates (y down); the layout has y up, like a net (the
// drawing flips it back), and the corners of a cell still run counter-clockwise. The picture has
// one tint for all cells (net.uniform), and no letters.
export function buildFlat(top) {
  if (nets.has(top)) {
    return nets.get(top);
  }
  const polys = [];
  const centers = [];
  for (let cell = 0; cell < top.T; cell++) {
    const poly = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      const [x, y] = vertexOf(top, top.ring[cell * SLOTS + k]);
      poly.push([x, -y]);
    }
    polys.push(poly);
    centers.push([top.centres[2 * cell], -top.centres[2 * cell + 1]]);
  }
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of polys.flat()) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  const first = polys[0];
  const perimeter = first.reduce((sum, [x, y], k) => {
    const [nx, ny] = first[(k + 1) % first.length];
    return sum + Math.hypot(nx - x, ny - y);
  }, 0);
  const net = {
    top,
    polys,
    centers,
    glued: new Uint8Array(top.T * SLOTS).fill(1),
    letterAt: new Map(),
    cuts: [],
    tags: [],
    box,
    side: perimeter / first.length,
    uniform: true,
  };
  nets.set(top, net);
  return net;
}

export const sideSegment = (net, cell, slot) => sideOf(net, cell, slot);

// The cell whose polygon holds the point, or -1.
export function cellAt(net, x, y) {
  for (let cell = 0; cell < net.top.T; cell++) {
    const poly = net.polys[cell];
    let inside = true;
    for (let k = 0; k < poly.length && inside; k++) {
      const [ax, ay] = poly[k];
      const [bx, by] = poly[(k + 1) % poly.length];
      inside = (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -EPS;
    }
    if (inside) {
      return cell;
    }
  }
  return -1;
}

// The slot of `cell` whose side is the nearest to the point (a click on a cell picks a side).
export function pickSide(net, cell, x, y) {
  let best = 0;
  let nearest = Infinity;
  for (let slot = 0; slot < net.top.deg[cell]; slot++) {
    const [a, b] = sideOf(net, cell, slot);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const reach = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy);
    const along = Math.max(0, Math.min(1, reach));
    const distance = Math.hypot(x - (a[0] + along * dx), y - (a[1] + along * dy));
    if (distance < nearest) {
      nearest = distance;
      best = slot;
    }
  }
  return best;
}

const shown = (net, cell) => !net.hidden || !net.hidden[cell];

// How a route goes from cell `from` to its neighbour `cell`: null when they are no neighbours,
// { joined: true } when both are drawn side by side, else the sides on both ends.
function stepOver(net, from, cell) {
  const slot = slotBetween(net.top, from, cell);
  if (slot < 0) {
    return null;
  }
  if (net.glued[from * SLOTS + slot] && shown(net, from) && shown(net, cell)) {
    return { joined: true };
  }
  return { joined: false, slot, back: net.top.rev[from * SLOTS + slot] };
}

// A route through cells as pieces of polyline (lists of [x, y]). A step between cells drawn
// side by side is a straight line between their centres. A step over a cut is two stubs: out
// of the cell to the middle of its side, and from the middle of the other cell's side into it.
// (A drawing may hide cells, net.hidden[cell]: a route is drawn only where it is shown.)
export function routePieces(net, cells) {
  const pieces = [];
  let piece = [];
  const flush = () => {
    if (piece.length) {
      pieces.push(piece);
    }
    piece = [];
  };
  cells.forEach((cell, i) => {
    const start = shown(net, cell) ? [net.centers[cell]] : [];
    if (i === 0) {
      piece = start;
      return;
    }
    const from = cells[i - 1];
    const over = stepOver(net, from, cell);
    if (!over) {
      flush();
      piece = start;
    } else if (over.joined) {
      piece.push(net.centers[cell]);
    } else {
      if (shown(net, from)) {
        piece.push(midpoint(sideOf(net, from, over.slot)));
      }
      flush();
      piece = shown(net, cell) ? [midpoint(sideOf(net, cell, over.back)), net.centers[cell]] : [];
    }
  });
  flush();
  return pieces;
}

// The places where a route leaves the picture and where it comes back: for every step over a
// cut, { kind: 'out', cell, slot, letter } on the side it leaves by and { kind: 'in', ... } on
// the side it enters by; `letter` is the letter of the cut (the same on both copies).
export function routeCrossings(net, cells) {
  const marks = [];
  for (let i = 1; i < cells.length; i++) {
    const over = stepOver(net, cells[i - 1], cells[i]);
    if (over && !over.joined) {
      const letter = net.letterAt.get(cells[i - 1] * SLOTS + over.slot) ?? '';
      if (shown(net, cells[i - 1])) {
        marks.push({ kind: 'out', cell: cells[i - 1], slot: over.slot, letter });
      }
      if (shown(net, cells[i])) {
        marks.push({ kind: 'in', cell: cells[i], slot: over.back, letter });
      }
    }
  }
  return marks;
}
