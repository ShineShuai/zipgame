import { SLOTS } from '../../core/surface/topology.js';
import { topologyOf } from '../../core/surface/puzzle.js';
import {
  COLORS, CELL, badgeColors, singlePathSvg, wrongMoveMarkAt, correctMoveRingAt,
} from './board.js';

// The play board of a Pentagon puzzle (core/surface/pentagon.js, p.surface === 'pentagon'): a flat
// patch of pentagon cells, drawn in the same style as the square board (board.js): white tiles on
// the light grid colour, a heavier outline along the border of the board, dark walls on the sides
// between two cells, the orange line through the cell centres, a badge on every number. The
// board's own units are the tiling's (a cell is about 1 wide), times CELL; y points down.
// No DOM: markup and numbers only, main.js puts them on the page.

const MARGIN = 6; // room around the board for the outline, in svg units
const cache = new WeakMap();

// Everything about the board that does not change while it is played: the cell polygons (corners
// counter-clockwise on screen), their centres, the segment of every edge (wall) and of every side
// on the border, and the view box.
function geometry(p) {
  const top = topologyOf(p);
  const known = cache.get(top);
  if (known) {
    return known;
  }
  const corner = id => [top.verts[id * 3] * CELL, top.verts[id * 3 + 1] * CELL];
  const polys = [];
  const centres = [];
  for (let cell = 0; cell < top.T; cell++) {
    const poly = [];
    for (let k = 0; k < top.deg[cell]; k++) {
      poly.push(corner(top.ring[cell * SLOTS + k]));
    }
    polys.push(poly);
    centres.push([top.centres[2 * cell] * CELL, top.centres[2 * cell + 1] * CELL]);
  }
  const edgeSegment = new Array(top.E);
  const border = [];
  for (let cell = 0; cell < top.T; cell++) {
    for (let k = 0; k < top.deg[cell]; k++) {
      const other = top.nb[cell * SLOTS + k];
      const segment = [polys[cell][k], polys[cell][(k + 1) % top.deg[cell]]];
      if (other < 0) {
        border.push(segment);
      } else if (cell < other) {
        edgeSegment[top.edgeAt[cell * SLOTS + k]] = segment;
      }
    }
  }
  const xs = polys.flat().map(point => point[0]);
  const ys = polys.flat().map(point => point[1]);
  const x = Math.min(...xs) - MARGIN;
  const y = Math.min(...ys) - MARGIN;
  const view = { x, y, w: Math.max(...xs) + MARGIN - x, h: Math.max(...ys) + MARGIN - y };
  const made = { top, polys, centres, edgeSegment, border, view };
  cache.set(top, made);
  return made;
}

const num = value => +value.toFixed(2);
const pointsOf = poly => poly.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
const lineOf = ([[x1, y1], [x2, y2]]) =>
  `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`;

// The view box { x, y, w, h } of the board, in svg units.
export const pentagonView = p => geometry(p).view;

// The cell centre [x, y] of every cell, in svg units.
export const pentagonCentres = p => geometry(p).centres;

// How many cells fit across the board, about (the size of a step of a fast drag).
export const pentagonAcross = p => Math.sqrt(geometry(p).top.T);

// The cell at [x, y] (svg units), or -1.
export function pentagonCellAt(p, x, y) {
  const { polys } = geometry(p);
  for (let cell = 0; cell < polys.length; cell++) {
    const poly = polys[cell];
    let inside = true;
    for (let k = 0; k < poly.length && inside; k++) {
      const [ax, ay] = poly[k];
      const [bx, by] = poly[(k + 1) % poly.length];
      // the board is drawn counter-clockwise: a point inside is on the same side of every side
      inside = (bx - ax) * (y - ay) - (by - ay) * (x - ax) <= 0;
    }
    if (inside) {
      return cell;
    }
  }
  return -1;
}

// A pointer position (client pixels) -> svg units, for an svg whose box is `rect`.
export function pentagonPoint(p, rect, clientX, clientY) {
  const { view } = geometry(p);
  return [
    view.x + ((clientX - rect.left) / rect.width) * view.w,
    view.y + ((clientY - rect.top) / rect.height) * view.h,
  ];
}

// The drawn line through the centres of the cells of `line`: svg path data.
export function pentagonRouteD(p, line) {
  const { centres } = geometry(p);
  return line.map((cell, k) => `${k ? 'L' : 'M'}${num(centres[cell][0])} ${num(centres[cell][1])}`)
    .join(' ');
}

// The badges of the numbers (the same markup as the square board: data-num-cell, a circle, a text).
function badges(p, visited) {
  const { centres } = geometry(p);
  const parts = [];
  p.cp.forEach((number, cell) => {
    if (!number) {
      return;
    }
    const [x, y] = centres[cell];
    const colors = badgeColors(visited.has(cell));
    const fontSize = Math.round(CELL * 0.32 * 10) / 10;
    parts.push(
      `<g data-num-cell="${cell}">`
      + `<circle cx="${num(x)}" cy="${num(y)}" r="${CELL * 0.32}" fill="${colors.fill}" `
      + `stroke="${colors.stroke}" stroke-width="3"/>`
      + `<text x="${num(x)}" y="${num(y)}" dy=".35em" text-anchor="middle" `
      + `font-size="${fontSize}" font-weight="700" fill="${colors.text}">${number}</text></g>`,
    );
  });
  return parts.join('');
}

// How wide the board may get on screen: about 64 px per cell across, at most 640, and short
// enough to fit the window (the same rule as the square board, by the height of the board).
function maxBoardCss(p) {
  const { view } = geometry(p);
  const px = Math.min(640, Math.round((view.w / CELL) * 64));
  const byHeight = `calc((100vh - 200px) * ${num(view.w / view.h)})`;
  return `max-width:${px}px;max-width:min(${px}px,max(260px,${byHeight}))`;
}

// Full svg markup of the play board (S = the play state, as for boardSvg in board.js).
export function pentagonBoardSvg(S) {
  const p = S.puzzle;
  const g = geometry(p);
  const { view } = g;
  const visited = new Set(S.path);
  const walls = [];
  p.walls.forEach((wall, edge) => {
    if (wall) {
      walls.push(lineOf(g.edgeSegment[edge]));
    }
  });
  const route = S.path.length > 1 ? pentagonRouteD(p, S.path) : '';
  let svg = `<svg viewBox="${num(view.x)} ${num(view.y)} ${num(view.w)} ${num(view.h)}" `
    + `class="zip-svg pentagon" style="${maxBoardCss(p)}">`;
  const tiles = g.polys.map(poly => `<polygon points="${pointsOf(poly)}"/>`).join('');
  svg += `<g data-role="tiles" fill="#fff" stroke="${COLORS.grid}" stroke-width="1.5" `
    + `stroke-linejoin="round">${tiles}</g>`;
  svg += `<g data-role="outline" stroke="${COLORS.outline}" stroke-width="5" `
    + `stroke-linecap="round">${g.border.map(lineOf).join('')}</g>`;
  svg += `<g data-role="walls" stroke="${COLORS.wall}" stroke-width="6" `
    + `stroke-linecap="round">${walls.join('')}</g>`;
  svg += singlePathSvg(route);
  svg += badges(p, visited);
  if (S.hintWrongCell != null) {
    svg += wrongMoveMarkAt(g.centres[S.hintWrongCell]);
  }
  if (S.hintCell != null) {
    svg += correctMoveRingAt(g.centres[S.hintCell]);
  }
  return `${svg}</svg>`;
}
