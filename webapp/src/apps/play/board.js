import {
  wallSegments, cellCenter, pathD, seamMarks, WRAP_PAD,
} from '../../view/geometry.js';
import { arrowIds, arrowDirId, arrowMove } from '../../core/edges.js';
import { cellCount } from '../../core/model.js';
import { colourOfCell, colourNumber } from '../../core/twopaths.js';
import { isSolved } from '../../core/rules.js';
import { isPortalPair, portalPartner } from '../../core/geom.js';
import { portalIcon, portalColor, portalShape } from '../../view/portal-icons.js';

export const CELL = 60; // logical units; on-screen size comes from viewBox scaling

// One palette for the board, as CSS variables (css/theme.css: light and dark). The numbers are recolored while drawing
// (grid-input.js), so it is shared. SVG attributes take var() like any CSS value, so a theme switch needs no redraw.
export const COLORS = {
  grid: 'var(--b-grid)',
  outline: 'var(--b-outline)', // the edge of a board with holes (Cutout)
  wall: 'var(--b-wall)',
  arrow: 'var(--b-wall)',      // one-way arrows (same ink as the walls), with a halo
  path: 'var(--b-path)',
  number: 'var(--b-num)',      // idle number: the digit (on --b-num-fill, inside --b-num-ring)
  numberFill: 'var(--b-num-fill)',
  numberRing: 'var(--b-num-ring)',
  numberVisited: 'var(--b-numv-fill)', // visited: filled, ringed with --b-numv-ring, the digit --b-num-on
  numberVisitedRing: 'var(--b-numv-ring)',
  numberVisitedText: 'var(--b-num-on)',
  numberWrong: 'var(--b-wrong)', // an Exact number the path reached on the wrong step
  hintRing: 'var(--b-hint)',
  hintWrong: 'var(--b-wrong)',
  tile: 'var(--b-bg)',         // a board tile (the cells of Cutout, Wrap-around, Pentagon)
  halo: 'var(--b-halo)',       // separates an arrow or a seam mark from the path under it
  // Two paths: the two colours of a path and of its numbers (a ring when idle, filled when visited)
  twoPath: ['var(--b-red)', 'var(--b-blue)'],
};

// The colours of a number badge: idle (the idle disc, its ring), visited (the visited disc; both discs are themed, in
// light and dark they are white with a blue ring and filled blue), and in an Exact puzzle visited on the wrong step
// (filled red).
export function badgeColors(visited, wrong = false) {
  if (!visited) return { fill: COLORS.numberFill, stroke: COLORS.numberRing, text: COLORS.number };
  if (wrong) return { fill: COLORS.numberWrong, stroke: COLORS.numberWrong, text: COLORS.numberVisitedText };
  return { fill: COLORS.numberVisited, stroke: COLORS.numberVisitedRing, text: COLORS.numberVisitedText };
}

// Two paths: the colours of a number badge of `colour` (0 red, 1 blue): idle (white, coloured ring)
// or visited (filled with the colour).
export function badgeColorsTwo(colour, visited) {
  const ink = COLORS.twoPath[colour];
  return visited
    ? { fill: ink, stroke: ink, text: COLORS.numberVisitedText }
    : { fill: COLORS.numberFill, stroke: ink, text: ink };
}

// An Exact number on the path (cell visited) is wrong unless the cell is the step its number says.
export const stepWrong = (puzzle, path, cell) => {
  return Boolean(puzzle.exact) && path[puzzle.cp[cell] - 1] !== cell;
};
// Widest the board gets on screen, in px: about 84 px per cell, at most 720. When the window is short
// (a laptop, a phone on its side) the board also shrinks so it fits without scrolling (dvh: the visible height).
// pad: the margin of a wrap-around board, in cells (geometry.js WRAP_PAD), on every side.
function maxBoardCss(n, pad = 0) {
  const px = Math.min(720, (n + 2 * pad) * 84);
  return `max-width:${px}px;max-width:min(${px}px,max(260px,calc(100vh - 210px)));max-width:min(${px}px,max(260px,calc(100dvh - 210px)))`;
}

function gridLines(size) {
  const lines = [];
  for (let i = 0; i <= size / CELL; i++) {
    const at = i * CELL;
    lines.push(`<line x1="0" y1="${at}" x2="${size}" y2="${at}"/><line x1="${at}" y1="0" x2="${at}" y2="${size}"/>`);
  }
  return `<g stroke="${COLORS.grid}" stroke-width="1.5">${lines.join('')}</g>`;
}

// Wrap-around board: a white square with a dashed outline (its edges are open: leave one side and
// come in on the other), the grid on top. The margin around it is transparent, where the stubs of a
// step across a seam are seen.
export function wrapLayers(size) {
  const square = `x="0" y="0" width="${size}" height="${size}" rx="6"`;
  return `<rect data-role="tiles" ${square} fill="${COLORS.tile}"/>` +
    gridLines(size) +
    `<rect data-role="outline" ${square} fill="none" ` +
    `stroke="${COLORS.outline}" stroke-width="4" stroke-dasharray="9 7"/>`;
}

// The in / out arrowheads of the seam steps of a path (geometry.js seamMarks), as svg. Pure markup;
// the play input replaces the content of the data-role="seam" group on every move.
export function seamMarksSvg(n, path) {
  const len = CELL * 0.32, half = CELL * 0.22, num = v => +v.toFixed(2);
  return seamMarks(n, path, CELL).map(({ kind, x, y, dx, dy }) => {
    const tip = [x + (dx * len) / 2, y + (dy * len) / 2];
    const base = [x - (dx * len) / 2, y - (dy * len) / 2];
    const wing = sign => [base[0] - sign * dy * half, base[1] + sign * dx * half];
    const points = [tip, wing(1), wing(-1)].map(([px, py]) => `${num(px)},${num(py)}`).join(' ');
    return `<polygon data-mark="${kind}" points="${points}" fill="${COLORS.path}" stroke="${COLORS.halo}" ` +
      'stroke-width="2.5" paint-order="stroke" stroke-linejoin="round"/>';
  }).join('');
}

// Board with holes (Cutout): only the cells that are left are drawn, each a white tile; the grid lines run between two
// tiles, and the edge of the shape (every side of a tile that faces a hole or the border) gets the outline. Holes stay empty.
export function cutoutLayers(p) {
  const n = p.n;
  const open = (r, c) => r >= 0 && r < n && c >= 0 && c < n && !p.holes[r * n + c];
  const tiles = [], grid = [], edge = [];
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!open(r, c)) continue;
      const x = c * CELL, y = r * CELL;
      tiles.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`);
      if (open(r, c + 1)) grid.push(line(x + CELL, y, x + CELL, y + CELL)); else edge.push(line(x + CELL, y, x + CELL, y + CELL));
      if (open(r + 1, c)) grid.push(line(x, y + CELL, x + CELL, y + CELL)); else edge.push(line(x, y + CELL, x + CELL, y + CELL));
      if (!open(r, c - 1)) edge.push(line(x, y, x, y + CELL));
      if (!open(r - 1, c)) edge.push(line(x, y, x + CELL, y));
    }
  }
  return `<g data-role="tiles" fill="${COLORS.tile}">${tiles.join('')}</g>` +
    `<g stroke="${COLORS.grid}" stroke-width="1.5">${grid.join('')}</g>` +
    `<g data-role="outline" stroke="${COLORS.outline}" stroke-width="5" stroke-linecap="round">${edge.join('')}</g>`;
}

function wallLines(puzzle) {
  const lines = wallSegments(puzzle, CELL).map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  return `<g stroke="${COLORS.wall}" stroke-width="6" stroke-linecap="round">${lines.join('')}</g>`;
}

// One-way arrows (puzzle.arrows): a filled triangle on the middle of the edge it belongs to, pointing the
// way the edge may be walked. data-arrow = the edge id, so a blocked step can flash the right one.
// The triangle is drawn for a right-pointing arrow and rotated about the edge's middle.
export function arrowMarks(puzzle) {
  const n = puzzle.n;
  const marks = arrowIds(puzzle).map(edge => {
    const [from, to] = arrowMove(n, edge, arrowDirId(puzzle.arrows, edge));
    const [x1, y1] = cellCenter(n, from, CELL);
    const [x2, y2] = cellCenter(n, to, CELL);
    const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
    const tip = CELL * 0.26;
    const back = CELL * 0.14;
    const half = CELL * 0.19;
    const points = `${tip},0 ${-back},${-half} ${-back},${half}`;
    return `<g class="arrow-mark" data-arrow="${edge}" transform="translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${angle})">` +
      `<polygon points="${points}" fill="${COLORS.arrow}" stroke="${COLORS.halo}" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round"/></g>`;
  });
  return marks.join('');
}

function numberBadges(puzzle, visited, path) {
  const n = puzzle.n;
  const badges = [];
  for (let cell = 0; cell < n * n; cell++) {
    const number = puzzle.cp[cell];
    if (!number) continue;
    const [x, y] = cellCenter(n, cell, CELL);
    const isVisited = visited.has(cell);
    const colors = badgeColors(isVisited, isVisited && stepWrong(puzzle, path, cell));
    // an Exact number has up to 3 digits
    const fontSize = Math.round(CELL * (number > 99 ? 0.24 : 0.32) * 10) / 10;
    badges.push(
      `<g data-num-cell="${cell}">` +
      `<circle cx="${x}" cy="${y}" r="${CELL * 0.32}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3"/>` +
      `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-size="${fontSize}" font-weight="700" ` +
      `fill="${colors.text}">${number}</text></g>`
    );
  }
  return badges.join('');
}

// Two paths: the number badges. A red number is a circle, a blue one a rounded square (so that the
// colours differ by more than a hue), and the blue numbers count again from 1. class num-shape =
// the shape that grid-input.js recolours when the cell is visited or left.
function twoNumberBadges(p, visited) {
  const n = p.n;
  const badges = [];
  for (let cell = 0; cell < n * n; cell++) {
    const colour = colourOfCell(p, cell);
    if (colour < 0) continue;
    const [x, y] = cellCenter(n, cell, CELL);
    const colors = badgeColorsTwo(colour, visited.has(cell));
    const number = colourNumber(p, p.cp[cell]);
    const fontSize = Math.round(CELL * 0.32 * 10) / 10;
    const half = CELL * 0.29;
    const shape = colour === 0
      ? `<circle class="num-shape" cx="${x}" cy="${y}" r="${CELL * 0.32}" `
      : `<rect class="num-shape" x="${x - half}" y="${y - half}" width="${2 * half}" ` +
        `height="${2 * half}" rx="${CELL * 0.1}" `;
    badges.push(
      `<g data-num-cell="${cell}" data-colour="${colour}">` +
      `${shape}fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3"/>` +
      `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-size="${fontSize}" ` +
      `font-weight="700" fill="${colors.text}">${number}</text></g>`
    );
  }
  return badges.join('');
}

// Two paths: the drawn line of each colour, one path element each (data-colour 0 = red, 1 = blue).
export const twoPathsSvg = (p, paths) => paths.map((path, colour) => {
  const d = path.length > 1 ? routeD(p, path) : '';
  return `<path data-role="path" data-colour="${colour}" d="${d}" ` +
    `stroke="${COLORS.twoPath[colour]}" stroke-width="${CELL * 0.28}" fill="none" ` +
    'stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>';
}).join('');

// Red cross on the first wrong move of a hint.
function wrongMoveMark(n, cell) {
  return wrongMoveMarkAt(cellCenter(n, cell, CELL));
}

// The same, centred on [x, y] (the Pentagon board has its own cell centres).
export function wrongMoveMarkAt([x, y]) {
  const d = CELL * 0.22;
  return `<g data-role="hint-wrong" stroke="${COLORS.hintWrong}" stroke-width="5" stroke-linecap="round">` +
    `<line x1="${x - d}" y1="${y - d}" x2="${x + d}" y2="${y + d}"/><line x1="${x - d}" y1="${y + d}" x2="${x + d}" y2="${y - d}"/></g>`;
}

// Pulsing ring on the correct move of a hint.
function correctMoveRing(n, cell) {
  return correctMoveRingAt(cellCenter(n, cell, CELL));
}

// The same, centred on [x, y].
export function correctMoveRingAt([x, y]) {
  const small = CELL * 0.36;
  const large = CELL * 0.44;
  return `<circle data-role="hint" cx="${x}" cy="${y}" r="${CELL * 0.4}" fill="none" stroke="${COLORS.hintRing}" stroke-width="4" stroke-dasharray="6 4">` +
    `<animate attributeName="r" values="${small};${large};${small}" dur="1s" repeatCount="indefinite"/></circle>`;
}

// A Loop puzzle whose path has visited every cell but does not close: its last cell does not touch cell 1
// through an open edge (a wall, or just not next to it), so the ring is open and the puzzle is not solved.
export const loopOpen = (p, path) => Boolean(p.loop) && path.length === cellCount(p) && !isSolved(p, path);

// What shows that: a pulsing red ring on the last cell and one on cell 1, the two ends that should have met.
export function loopOpenMarks(p, path) {
  if (!loopOpen(p, path)) return '';
  const small = CELL * 0.36, large = CELL * 0.44;
  return [path[path.length - 1], path[0]].map(cell => {
    const [x, y] = cellCenter(p.n, cell, CELL);
    return `<circle cx="${x}" cy="${y}" r="${CELL * 0.4}" fill="none" stroke="${COLORS.hintWrong}" stroke-width="4" stroke-dasharray="6 4">` +
      `<animate attributeName="r" values="${small};${large};${small}" dur="1s" repeatCount="indefinite"/></circle>`;
  }).join('');
}

// The cells the drawn line runs through: the path, and for a solved Loop puzzle back to cell 1, so
// the ring is drawn closed.
export const routeCells = (p, path, finished) => (p.loop && finished && path.length > 2 ? [...path, path[0]] : path);

// Every portal of a Teleport puzzle, both cells of a pair with the same icon (data-portal-cell =
// the cell).
export function portalIconsSvg(p) {
  if (!p.portals) return '';
  return p.portals.map((pair, index) => pair.map(cell => {
    const [x, y] = cellCenter(p.n, cell, CELL);
    const icon = portalIcon(portalShape(index), portalColor(index), x, y);
    return `<g class="portal" data-portal-cell="${cell}" data-pair="${index}">${icon}</g>`;
  }).join('')).join('');
}

// The drawn line of the path. A jump over a portal pair is not drawn as a line across the board
// (it would cross
// cells the path does not visit): the line stops at one portal and starts again at the other, and
// the jump is
// shown by jumpMarksSvg. Other puzzles: pathD() as before.
export function routeD(p, line) {
  if (!p.portals) return pathD(p.n, line, CELL, Boolean(p.wrap));
  return line.map((cell, k) => {
    const [x, y] = cellCenter(p.n, cell, CELL);
    return (k && !isPortalPair(p.portals, line[k - 1], cell) ? 'L' : 'M') + x + ' ' + y;
  }).join(' ');
}

// What shows a jump: for every jump the path has made, a dotted arc from the portal it left to the
// one it entered,
// with an arrowhead at the end; and, while the head stands on a portal whose partner is free, a
// pulsing ring on
// that partner, which says "tap it to jump". The play input replaces the content of the
// data-role="jump" group
// on every move.
export function jumpMarksSvg(p, path, finished = false) {
  if (!p.portals || !path.length) return '';
  const n = p.n;
  const num = v => +v.toFixed(2);
  const marks = [];
  for (let k = 1; k < path.length; k++) {
    if (!isPortalPair(p.portals, path[k - 1], path[k])) continue;
    const [x1, y1] = cellCenter(n, path[k - 1], CELL);
    const [x2, y2] = cellCenter(n, path[k], CELL);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(CELL * 1.2, len * 0.22);
    const cx = (x1 + x2) / 2 - (dy / len) * bend;
    const cy = (y1 + y2) / 2 + (dx / len) * bend;
    // the arrowhead sits a bit before the end, along the curve's end tangent
    const ex = x2 - cx;
    const ey = y2 - cy;
    const el = Math.hypot(ex, ey) || 1;
    const ux = ex / el;
    const uy = ey / el;
    const tipX = x2 - ux * CELL * 0.3;
    const tipY = y2 - uy * CELL * 0.3;
    const back = CELL * 0.17;
    const half = CELL * 0.12;
    const pts = [
      [tipX, tipY],
      [tipX - ux * back - uy * half, tipY - uy * back + ux * half],
      [tipX - ux * back + uy * half, tipY - uy * back - ux * half],
    ].map(([px, py]) => `${num(px)},${num(py)}`).join(' ');
    const curve = `M${num(x1)} ${num(y1)} Q${num(cx)} ${num(cy)} ${num(x2)} ${num(y2)}`;
    marks.push(
      `<path data-mark="jump" d="${curve}" fill="none" stroke="${COLORS.path}" ` +
      `stroke-width="${CELL * 0.1}" stroke-linecap="round" ` +
      `stroke-dasharray="1 ${num(CELL * 0.16)}"/>` +
      `<polygon data-mark="jump-end" points="${pts}" fill="${COLORS.path}" stroke="${COLORS.halo}" ` +
      'stroke-width="2.5" paint-order="stroke" stroke-linejoin="round"/>'
    );
  }
  if (!finished) {
    const head = path[path.length - 1];
    const partner = portalPartner(p.portals, head);
    if (partner >= 0 && !path.includes(partner)) {
      const [x, y] = cellCenter(n, partner, CELL);
      const small = CELL * 0.38;
      const large = CELL * 0.46;
      const color = portalColor(p.portals.findIndex(pair => pair.includes(head)));
      marks.push(
        `<circle data-mark="jump-ready" cx="${num(x)}" cy="${num(y)}" r="${CELL * 0.42}" ` +
        `fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="6 4">` +
        `<animate attributeName="r" values="${small};${large};${small}" dur="1s" ` +
        'repeatCount="indefinite"/></circle>'
      );
    }
  }
  return marks.join('');
}

// The drawn line of a puzzle with one path (`route` = its svg path data).
export const singlePathSvg = route => `<path data-role="path" d="${route}" stroke="${COLORS.path}" ` +
  `stroke-width="${CELL * 0.28}" fill="none" stroke-linecap="round" stroke-linejoin="round" ` +
  'opacity="0.95"/>';

// Full SVG markup for the play board (S = play state). The svg itself has no border or padding, because
// pointer positions are mapped to cells through its bounding box; the frame is the .grid-wrap around it.
export function boardSvg(S) {
  const p = S.puzzle;
  const n = p.n;
  const size = n * CELL;
  const two = Boolean(p.split);
  const visited = new Set(two ? [...S.paths[0], ...S.paths[1]] : S.path);
  const wrap = Boolean(p.wrap);
  const line = routeCells(p, S.path, S.finished);
  const route = line.length > 1 ? routeD(p, line) : '';
  const pad = wrap ? WRAP_PAD : 0, margin = pad * CELL;
  const view = `${-margin} ${-margin} ${size + 2 * margin} ${size + 2 * margin}`;

  let svg = `<svg viewBox="${view}" class="zip-svg${p.holes ? ' cutout' : ''}` +
    `${p.arrows ? ' arrows' : ''}${wrap ? ' wrap' : ''}${p.portals ? ' teleport' : ''}` +
    `${two ? ' twopaths' : ''}" ` +
    `style="${maxBoardCss(n, pad)}">`;
  svg += p.holes ? cutoutLayers(p) : wrap ? wrapLayers(size) : gridLines(size);
  svg += wallLines(p);
  svg += portalIconsSvg(p);
  svg += two ? twoPathsSvg(p, S.paths) : singlePathSvg(route);
  if (wrap) svg += `<g data-role="seam">${seamMarksSvg(n, S.path)}</g>`;
  if (p.portals) svg += `<g data-role="jump">${jumpMarksSvg(p, S.path, S.finished)}</g>`;
  if (p.arrows) svg += arrowMarks(p);
  svg += two ? twoNumberBadges(p, visited) : numberBadges(p, visited, S.path);
  if (p.loop) svg += `<g data-role="loop-open">${loopOpenMarks(p, S.path)}</g>`;
  if (S.hintWrongCell != null) svg += wrongMoveMark(n, S.hintWrongCell);
  if (S.hintCell != null) svg += correctMoveRing(n, S.hintCell);
  return svg + '</svg>';
}
