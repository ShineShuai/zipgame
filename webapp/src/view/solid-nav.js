// Turning a solid (tetrahedron, cube or ball) on the screen, shared by the design app and the play
// app: the numbers of a drag and of the arrow keys, and following the head of a path. The solid is
// turned by a rotation (view/proj.js); each app owns its rotation, its drawing and its pointer
// handling.
import { cellDirection, turn, turnToward } from './proj.js';
import { SLOTS } from '../core/surface/topology.js';

// Pixels of a drag per radian, and the pixels a click may move before it is a drag.
export const ORBIT_SPEED = 0.01;
export const ORBIT_SLOP = 6;
// Radians of an arrow key: [about the vertical axis, about the horizontal axis].
export const ARROW_TURN = {
  ArrowLeft: [-0.15, 0],
  ArrowRight: [0.15, 0],
  ArrowUp: [0, -0.15],
  ArrowDown: [0, 0.15],
};
// Following the head: the share of the way the solid turns per animation frame, and how near to
// the viewer (z of the direction of the head) it stops.
export const FOLLOW_SPEED = 0.25;
export const FOLLOW_DONE = 0.9995;
// A ball turns to the head of the path when the head, or a cell it can step to, is nearer to the
// rim than this (z of its direction).
export const FOLLOW_EDGE = 0.25;

// Whether the head of `path`, or a cell it can step to, is turned away in `layout` (a view of
// the solid): out of sight on a tetrahedron or cube, near the rim on a ball. `outside(cell)`: a
// cell that is out of the part of the picture the zoom shows counts as turned away too.
export function headTurnedAway(top, layout, path, ball, outside = () => false) {
  const away = cell => (
    (ball ? layout.depth[cell] < FOLLOW_EDGE : Boolean(layout.hidden[cell])) || outside(cell)
  );
  const head = path[path.length - 1];
  let turnedAway = away(head);
  for (let k = 0; k < top.deg[head]; k++) {
    const next = top.nb[head * SLOTS + k];
    turnedAway = turnedAway || (away(next) && !path.includes(next));
  }
  return turnedAway;
}

// The animation that turns a solid until `cell` faces the viewer.
//   getRotation(), setRotation(R)   the rotation of the solid
//   redraw()                        draws the solid in its new position
// stop() ends a turn in progress (call it when the user takes over).
export function createTurner({ getRotation, setRotation, redraw }) {
  let frame = null;
  const stop = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
  return {
    stop,
    toward(top, cell) {
      stop();
      const direction = cellDirection(top, cell);
      const tick = () => {
        setRotation(turnToward(getRotation(), direction, FOLLOW_SPEED));
        redraw();
        const facing = turn(getRotation(), direction)[2];
        frame = facing < FOLLOW_DONE ? requestAnimationFrame(tick) : null;
      };
      frame = requestAnimationFrame(tick);
    },
  };
}

// The side of the turn from a to b to c: positive counter-clockwise.
const turnOf = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// Whether the segments p1-p2 and q1-q2 cross.
function crosses(p1, p2, q1, q2) {
  return turnOf(p1, p2, q1) * turnOf(p1, p2, q2) < 0 && turnOf(q1, q2, p1) * turnOf(q1, q2, p2) < 0;
}

// The cell a drag enters by leaving the head over a cut of a net (surface-net.js buildNet): the
// pointer went from point `from` to point `to` (net coordinates) and that segment crosses a side
// of the head's cell that is cut, i.e. glued to a cell elsewhere on the net. -1 when it crosses
// none. The net has no neighbour beside a cut, so the pointer leaves the board there.
export function crossedCut(top, net, head, from, to) {
  const poly = net.polys[head];
  for (let slot = 0; slot < top.deg[head]; slot++) {
    const other = top.nb[head * SLOTS + slot];
    if (other >= 0 && !net.glued[head * SLOTS + slot]) {
      if (crosses(from, to, poly[slot], poly[(slot + 1) % poly.length])) {
        return other;
      }
    }
  }
  return -1;
}
