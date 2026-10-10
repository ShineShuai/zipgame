import { wallSegments, cellCenter, pathD } from '../../view/geometry.js';
import { arrowIds, arrowDirId, arrowMove } from '../../core/edges.js';

export const CELL = 60; // logical units; on-screen size comes from viewBox scaling

// One palette for the board. The numbers are recolored while drawing (main.js), so it is shared.
export const COLORS = {
  grid: '#dbe4fb',
  outline: '#aebff5',     // the edge of a board with holes (Cutout)
  wall: '#26324f',
  arrow: '#26324f',       // one-way arrows (same ink as the walls), with a white halo
  path: '#ffb020',
  number: '#3b68ee',      // idle number: blue ring and text on white; visited: filled blue, white text
  numberFill: '#ffffff',
  numberVisitedText: '#ffffff',
  hintRing: '#ff9f1c',
  hintWrong: '#e5484d',
};

// Widest the board gets on screen, in px: about 64 px per cell, at most 640. When the window is short
// (a laptop, a phone on its side) the board also shrinks so it fits without scrolling.
function maxBoardCss(n) {
  const px = Math.min(640, n * 64);
  return `max-width:${px}px;max-width:min(${px}px,max(260px,calc(100vh - 200px)))`;
}

function gridLines(size) {
  const lines = [];
  for (let i = 0; i <= size / CELL; i++) {
    const at = i * CELL;
    lines.push(`<line x1="0" y1="${at}" x2="${size}" y2="${at}"/><line x1="${at}" y1="0" x2="${at}" y2="${size}"/>`);
  }
  return `<g stroke="${COLORS.grid}" stroke-width="1.5">${lines.join('')}</g>`;
}

// Board with holes (Cutout): only the cells that are left are drawn, each a white tile; the grid lines run between two
// tiles, and the edge of the shape (every side of a tile that faces a hole or the border) gets the outline. Holes stay empty.
function cutoutLayers(p) {
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
  return `<g data-role="tiles" fill="#fff">${tiles.join('')}</g>` +
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
function arrowMarks(puzzle) {
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
      `<polygon points="${points}" fill="${COLORS.arrow}" stroke="#fff" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round"/></g>`;
  });
  return marks.join('');
}

function numberBadges(puzzle, visited) {
  const n = puzzle.n;
  const badges = [];
  for (let cell = 0; cell < n * n; cell++) {
    const number = puzzle.cp[cell];
    if (!number) continue;
    const [x, y] = cellCenter(n, cell, CELL);
    const isVisited = visited.has(cell);
    badges.push(
      `<g data-num-cell="${cell}">` +
      `<circle cx="${x}" cy="${y}" r="${CELL * 0.32}" fill="${isVisited ? COLORS.number : COLORS.numberFill}" stroke="${COLORS.number}" stroke-width="3"/>` +
      `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-size="${CELL * 0.32}" font-weight="700" ` +
      `fill="${isVisited ? COLORS.numberVisitedText : COLORS.number}">${number}</text></g>`
    );
  }
  return badges.join('');
}

// Red cross on the first wrong move of a hint.
function wrongMoveMark(n, cell) {
  const [x, y] = cellCenter(n, cell, CELL);
  const d = CELL * 0.22;
  return `<g data-role="hint-wrong" stroke="${COLORS.hintWrong}" stroke-width="5" stroke-linecap="round">` +
    `<line x1="${x - d}" y1="${y - d}" x2="${x + d}" y2="${y + d}"/><line x1="${x - d}" y1="${y + d}" x2="${x + d}" y2="${y - d}"/></g>`;
}

// Pulsing ring on the correct move of a hint.
function correctMoveRing(n, cell) {
  const [x, y] = cellCenter(n, cell, CELL);
  const small = CELL * 0.36;
  const large = CELL * 0.44;
  return `<circle data-role="hint" cx="${x}" cy="${y}" r="${CELL * 0.4}" fill="none" stroke="${COLORS.hintRing}" stroke-width="4" stroke-dasharray="6 4">` +
    `<animate attributeName="r" values="${small};${large};${small}" dur="1s" repeatCount="indefinite"/></circle>`;
}

// Full SVG markup for the play board (S = play state). The svg itself has no border or padding, because
// pointer positions are mapped to cells through its bounding box; the frame is the .grid-wrap around it.
export function boardSvg(S) {
  const p = S.puzzle;
  const n = p.n;
  const size = n * CELL;
  const visited = new Set(S.path);
  const route = S.path.length > 1 ? pathD(n, S.path, CELL) : '';

  let svg = `<svg viewBox="0 0 ${size} ${size}" class="zip-svg${p.holes ? ' cutout' : ''}${p.arrows ? ' arrows' : ''}" style="${maxBoardCss(n)}">`;
  svg += p.holes ? cutoutLayers(p) : gridLines(size);
  svg += wallLines(p);
  svg += `<path data-role="path" d="${route}" stroke="${COLORS.path}" stroke-width="${CELL * 0.28}" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
  if (p.arrows) svg += arrowMarks(p);
  svg += numberBadges(p, visited);
  if (S.hintWrongCell != null) svg += wrongMoveMark(n, S.hintWrongCell);
  if (S.hintCell != null) svg += correctMoveRing(n, S.hintCell);
  return svg + '</svg>';
}
