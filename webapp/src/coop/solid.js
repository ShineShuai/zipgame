import { BALL_KIND } from '../core/surface/topology.js';
import { solidIsDark } from '../apps/play/board.js';
import { isSurfacePuzzle, startCell, topologyOf } from '../core/surface/puzzle.js';
import { behind, buildBallView } from '../view/ball.js';
import { IDENTITY, buildView, cellDirection, orbit, turnToward } from '../view/proj.js';
import {
  LIGHT_PALETTE, PLAY_DARK_PALETTE, surfaceSvg,
} from '../view/surface-board.js';
import { buildNet, routePieces } from '../view/surface-net.js';
import {
  ARROW_TURN, FOLLOW_EDGE, ORBIT_SLOP, ORBIT_SPEED, createTurner, crossedCut,
} from '../view/solid-nav.js';
import { PLAYER_COLORS } from './view.js';

// The solids of Patchwork (a tetrahedron, a cube, a ball), drawn with the pictures of the play app
// (view/surface-board.js): the solid you turn, or its net. The lines of the players go in the
// layer that surfaceSvg() leaves for them. Turning and hit-testing follow the play app
// (apps/play/solid.js):
//   a press on a cell draws; a press on anything else turns the solid once the pointer has moved a
//   little (ORBIT_SLOP), and so do two fingers; the arrow keys turn it; a drag that leaves the head
//   over a cut of the net goes on where the cut leads (crossedCut).
// Kept out of this module: the state (the view, the rotation), which the screen owns.
export { ARROW_TURN, FOLLOW_EDGE, IDENTITY, ORBIT_SLOP, createTurner, crossedCut };

export const SOLID_KINDS = ['tetra', 'cube', BALL_KIND];
export const isSolid = puzzle => isSurfacePuzzle(puzzle) && SOLID_KINDS.includes(puzzle.kind);

// The two halves of a ball side by side (the Map view): the width of each, in pixels.
const MAP_WIDTH = 300;
const round = value => Math.round(value * 100) / 100;

// The solid starts turned to cell 1, so that it is in view.
export const startRotation = puzzle => turnToward(
  IDENTITY,
  cellDirection(topologyOf(puzzle), startCell(puzzle)),
);

// An arrow key turns the solid.
export const turnByKey = (rotation, key) => orbit(rotation, ...ARROW_TURN[key]);

// A drag of (dx, dy) pixels turns the solid.
export const turnBy = (rotation, dx, dy) => orbit(rotation, dx * ORBIT_SPEED, dy * ORBIT_SPEED);

// Whether the solid can be turned in this view: the 3D view, and both views of a ball.
export const turnable = (puzzle, view) => view === '3d' || puzzle.kind === BALL_KIND;

// The pictures to draw: the main ones, and the one shown small in a corner (or null). A tetra or
// cube is the solid with its net in the corner, or the net; a ball is the ball with its far side in
// the corner, or both halves side by side.
export function layoutsFor(puzzle, view, rotation) {
  const top = topologyOf(puzzle);
  const solid = view === '3d';
  if (puzzle.kind === BALL_KIND) {
    const options = solid ? {} : { maxWidth: MAP_WIDTH };
    const back = buildBallView(top, behind(rotation), options);
    return solid
      ? { main: [buildBallView(top, rotation)], inset: back }
      : { main: [buildBallView(top, rotation, options), back], inset: null };
  }
  return solid
    ? { main: [buildView(top, rotation)], inset: buildNet(top) }
    : { main: [buildNet(top)], inset: null };
}

const piecesOf = (net, a, b) => (net.routePieces
  ? net.routePieces([a, b]) : routePieces(net, [a, b]));

const polylineMiddle = points => points[Math.floor((points.length - 1) / 2)]
  .map((value, axis) => (value + points[Math.ceil((points.length - 1) / 2)][axis]) / 2);

// The lines that the players drew (one group per player, in their colour), and the mark of the hint
// on its edge: svg for the layer under the numbers of one picture.
function linesLayer(drawing, hint, net, frame, px) {
  const width = round(px * (net.depth ? 0.1 : 0.13));
  const pixels = piece => piece.map(point => frame.toPixels(point));
  const byPlayer = new Map();
  for (const [a, b] of drawing.edges()) {
    const player = drawing.ownerOf(a, b);
    const lines = piecesOf(net, a, b)
      .filter(piece => piece.length > 1)
      .map(piece => `<polyline class="sf-path" points="${pixels(piece).join(' ')}"/>`);
    byPlayer.set(player, [...(byPlayer.get(player) ?? []), ...lines]);
  }
  let markup = '';
  for (const [player, lines] of byPlayer) {
    markup += `<g data-role="lines" stroke="${PLAYER_COLORS[player] ?? PLAYER_COLORS[0]}" `
      + `stroke-width="${width}">${lines.join('')}</g>`;
  }
  if (hint) {
    const piece = piecesOf(net, ...hint.edge).find(candidate => candidate.length > 1);
    if (piece) {
      const [x, y] = polylineMiddle(pixels(piece));
      const name = hint.kind === 'wrong' ? 'sf-wrong' : 'sf-hint';
      markup += `<circle class="${name}" data-mark="hint" cx="${round(x)}" cy="${round(y)}" `
        + `r="${round(px * 0.3)}"/>`;
    }
  }
  return markup;
}

const palette = () => (typeof document !== 'undefined'
  && solidIsDark(document) ? PLAY_DARK_PALETTE : LIGHT_PALETTE);

// The board of a solid game: { html, layouts, frames }. `layouts` and `frames` are those of the
// main pictures, for hit-testing (cellUnder, edgeNear, netPoint).
export function solidBoard(puzzle, drawing, { view, rotation, hint = null }) {
  const { main, inset } = layoutsFor(puzzle, view, rotation);
  const picture = (net, idSuffix) => surfaceSvg(net, {
    P: puzzle,
    selected: -1,
    buffer: '',
    playing: false,
    template: null,
    solutions: [],
    visible: [],
    palette: palette(),
    idSuffix,
    under: (frame, px) => linesLayer(drawing, hint, net, frame, px),
  });
  const pictures = main.map((net, i) => picture(net, String(i)));
  const views = pictures
    .map((one, i) => `<div class="sf-view" data-view="${i}">${one.markup}</div>`)
    .join('');
  const small = inset ? `<div class="sf-mini">${picture(inset, 'm').markup}</div>` : '';
  return {
    html: (pictures.length > 1 ? `<div class="sf-pair">${views}</div>` : views) + small,
    layouts: main,
    frames: pictures.map(one => one.frame),
  };
}

// The cell under a pointer, among the cells drawn in `root` (-1: none). A line, a number or the
// hint may lie over a cell, so the cells are looked for in the whole stack under the pointer.
export function cellUnder(root, clientX, clientY) {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const cell = element.closest?.('[data-cell]');
    if (cell && root.contains(cell)) {
      return Number(cell.dataset.cell);
    }
  }
  return -1;
}

// Which main picture (0, or 1 for the second half of a ball map) a pointer is on, and its svg.
function pictureAt(root, clientX, clientY) {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const view = element.closest?.('.sf-view');
    if (view && root.contains(view)) {
      return { index: Number(view.dataset.view), svg: view.querySelector('svg') };
    }
  }
  return null;
}

// A pointer as a point of picture `index`: [x, y] in its pixels (the units of its frame).
function framePoint(svg, frame, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return [
    (clientX - rect.left) * (frame.width / rect.width),
    (clientY - rect.top) * (frame.height / rect.height),
  ];
}

// The pointer in the net coordinates of the first picture, for crossedCut (null if it is off it).
export function netPoint(root, frames, clientX, clientY) {
  const svg = root.querySelector('.sf-view[data-view="0"] svg');
  return svg ? frames[0].toNet(...framePoint(svg, frames[0], clientX, clientY)) : null;
}

const distanceToSegment = (x, y, [x1, y1], [x2, y2]) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length2 = dx * dx + dy * dy;
  const along = length2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2)) : 0;
  return Math.hypot(x - (x1 + along * dx), y - (y1 + along * dy));
};

// The drawn edge [a, b] nearest to a pointer, when within `reach` (a fraction of a cell) of its
// line in the picture; else null.
export function edgeNear(root, drawing, layouts, frames, clientX, clientY, reach = 0.3) {
  const at = pictureAt(root, clientX, clientY);
  if (!at) {
    return null;
  }
  const net = layouts[at.index];
  const frame = frames[at.index];
  const [x, y] = framePoint(at.svg, frame, clientX, clientY);
  let best = null;
  let bestDistance = reach * net.side * frame.scale;
  for (const edge of drawing.edges()) {
    for (const piece of piecesOf(net, ...edge)) {
      const points = piece.map(point => frame.toPixels(point));
      for (let i = 1; i < points.length; i++) {
        const distance = distanceToSegment(x, y, points[i - 1], points[i]);
        if (distance < bestDistance) {
          best = edge;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}
