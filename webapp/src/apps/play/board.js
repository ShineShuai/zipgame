import { wallSegments, cellCenter, pathD } from '../../view/geometry.js';

export const CELL = 60; // logical units; on-screen size comes from viewBox scaling

// One palette for the board. The numbers are recolored while drawing (main.js), so it is shared.
export const COLORS = {
  grid: '#dbe4fb',
  wall: '#26324f',
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

function wallLines(puzzle) {
  const lines = wallSegments(puzzle, CELL).map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  return `<g stroke="${COLORS.wall}" stroke-width="6" stroke-linecap="round">${lines.join('')}</g>`;
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

  let svg = `<svg viewBox="0 0 ${size} ${size}" class="zip-svg" style="${maxBoardCss(n)}">`;
  svg += gridLines(size);
  svg += wallLines(p);
  svg += `<path data-role="path" d="${route}" stroke="${COLORS.path}" stroke-width="${CELL * 0.28}" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
  svg += numberBadges(p, visited);
  if (S.hintWrongCell != null) svg += wrongMoveMark(n, S.hintWrongCell);
  if (S.hintCell != null) svg += correctMoveRing(n, S.hintCell);
  return svg + '</svg>';
}
