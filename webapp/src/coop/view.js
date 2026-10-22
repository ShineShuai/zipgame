import {
  CELL, COLORS, badgeColors, correctMoveRingAt, wrongMoveMarkAt,
} from '../apps/play/board.js';
import { cellCenter, wallSegments } from '../view/geometry.js';

// The Free draw board as SVG markup (pure). One line per drawn edge, so lines drawn in any order
// and from anywhere look alike; a number is filled once a line touches its cell.
const line = ([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

// The middle of the edge a-b, in board units.
export function edgeMiddle(n, a, b) {
  const [ax, ay] = cellCenter(n, a, CELL);
  const [bx, by] = cellCenter(n, b, CELL);
  return [(ax + bx) / 2, (ay + by) / 2];
}

function gridMarkup(n) {
  const size = n * CELL;
  const rules = [];
  for (let i = 0; i <= n; i++) {
    rules.push(line([0, i * CELL, size, i * CELL]), line([i * CELL, 0, i * CELL, size]));
  }
  return `<g stroke="${COLORS.grid}" stroke-width="1.5">${rules.join('')}</g>`;
}

function drawnMarkup(puzzle, drawing) {
  const segments = drawing.edges().map(([a, b]) => {
    const [x1, y1] = cellCenter(puzzle.n, a, CELL);
    const [x2, y2] = cellCenter(puzzle.n, b, CELL);
    return line([x1, y1, x2, y2]);
  });
  return `<g data-role="lines" stroke="${COLORS.path}" stroke-width="${CELL * 0.28}" `
    + `stroke-linecap="round" opacity="0.95">${segments.join('')}</g>`;
}

function badgesMarkup(puzzle, drawing) {
  const badges = [];
  for (let cell = 0; cell < puzzle.cp.length; cell++) {
    const number = puzzle.cp[cell];
    if (!number) {
      continue;
    }
    const [x, y] = cellCenter(puzzle.n, cell, CELL);
    const colors = badgeColors(drawing.degree(cell) > 0);
    badges.push(
      `<g data-num-cell="${cell}">`
      + `<circle cx="${x}" cy="${y}" r="${CELL * 0.32}" fill="${colors.fill}" `
      + `stroke="${colors.stroke}" stroke-width="3"/>`
      + `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-size="${CELL * 0.32}" `
      + `font-weight="700" fill="${colors.text}">${number}</text></g>`,
    );
  }
  return badges.join('');
}

// hint: { kind: 'wrong' | 'next', edge: [a, b] } or null.
function hintMarkup(puzzle, hint) {
  if (!hint || !hint.edge) {
    return '';
  }
  const middle = edgeMiddle(puzzle.n, ...hint.edge);
  return hint.kind === 'wrong' ? wrongMoveMarkAt(middle) : correctMoveRingAt(middle);
}

export function maxBoardCss(n) {
  const px = Math.min(720, n * 84);
  return `max-width:${px}px;max-width:min(${px}px,max(260px,calc(100dvh - 330px)))`;
}

export function boardMarkup(puzzle, drawing, hint = null) {
  const size = puzzle.n * CELL;
  const walls = wallSegments(puzzle, CELL).map(line).join('');
  return `<svg class="coop-svg" viewBox="0 0 ${size} ${size}" style="${maxBoardCss(puzzle.n)}">`
    + `<rect width="${size}" height="${size}" rx="6" fill="${COLORS.tile}"/>`
    + gridMarkup(puzzle.n)
    + `<g stroke="${COLORS.wall}" stroke-width="6" stroke-linecap="round">${walls}</g>`
    + drawnMarkup(puzzle, drawing)
    + badgesMarkup(puzzle, drawing)
    + hintMarkup(puzzle, hint)
    + '</svg>';
}
