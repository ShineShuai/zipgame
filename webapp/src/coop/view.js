import {
  CELL, COLORS, arrowMarks, badgeColors, badgeColorsTwo, correctMoveRingAt, cutoutLayers,
  portalIconsSvg, wrapLayers, wrongMoveMarkAt,
} from '../apps/play/board.js';
import {
  maxBoardCss as pentagonCss, pentagonLayers, pentagonView,
} from '../apps/play/pentagon-board.js';
import { isPortalPair } from '../core/geom.js';
import { isPentagon } from '../core/pentagon.js';
import { colourNumber, colourOfCell } from '../core/twopaths.js';
import { cellCenter, wallSegments } from '../view/geometry.js';
import {
  cellCentre, edgeMiddleOf, edgeSegments, jumpCurve, padOf,
} from './layout.js';

// The Free draw board as SVG markup (pure). One line per drawn edge, so lines drawn in any order
// and from anywhere look alike; a number is filled once a line touches its cell.
// The colour of each player's lines: the orange of the single path and blue, a pair that stays
// apart for colour-blind players too (both are tokens of css/theme.css, so dark mode follows).
export const PLAYER_COLORS = [COLORS.path, COLORS.twoPath[1]];

const line = ([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

// The middle of the straight edge a-b, in board units (layout.js edgeMiddleOf for the others).
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

const num = value => +value.toFixed(2);

// The line of one edge: a chord, the two stubs of a seam, or, between two portals, a dotted curve
// (a jump) that does not run across the cells in between. A jump has no direction, so no arrowhead.
function edgeMarkup(puzzle, a, b) {
  if (!isPortalPair(puzzle.portals, a, b)) {
    return edgeSegments(puzzle, a, b, CELL).map(line).join('');
  }
  const { from, via, to } = jumpCurve(puzzle.n, a, b, CELL);
  const [x1, y1, cx, cy, x2, y2] = [...from, ...via, ...to].map(num);
  return `<path data-mark="jump" d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" `
    + `stroke-width="${CELL * 0.1}" stroke-dasharray="1 ${num(CELL * 0.16)}"/>`;
}

// One group of lines per player that has drawn (always the first player's, even when empty).
function drawnMarkup(puzzle, drawing) {
  const byPlayer = new Map([[0, []]]);
  for (const [a, b] of drawing.edges()) {
    const player = drawing.ownerOf(a, b);
    byPlayer.set(player, [...(byPlayer.get(player) ?? []), edgeMarkup(puzzle, a, b)]);
  }
  const players = [...byPlayer.keys()].sort((x, y) => x - y);
  return players.map(player => `<g data-role="lines" data-player="${player}" `
    + `stroke="${PLAYER_COLORS[player] ?? PLAYER_COLORS[0]}" stroke-width="${CELL * 0.28}" `
    + `stroke-linecap="round" opacity="0.95">${byPlayer.get(player).join('')}</g>`).join('');
}

function badgesMarkup(puzzle, drawing) {
  const badges = [];
  for (let cell = 0; cell < puzzle.cp.length; cell++) {
    const number = puzzle.cp[cell];
    if (!number) {
      continue;
    }
    const [x, y] = cellCentre(puzzle, cell, CELL);
    const used = drawing.degree(cell) > 0;
    // Two paths: a red number is a circle, a blue one a rounded square counted from 1 again
    const colour = puzzle.split ? colourOfCell(puzzle, cell) : -1;
    const colors = colour < 0 ? badgeColors(used) : badgeColorsTwo(colour, used);
    const half = CELL * 0.29;
    const shape = colour === 1
      ? `<rect x="${x - half}" y="${y - half}" width="${2 * half}" height="${2 * half}" `
        + `rx="${CELL * 0.1}" `
      : `<circle cx="${x}" cy="${y}" r="${CELL * 0.32}" `;
    const label = colour < 0 ? number : colourNumber(puzzle, number);
    badges.push(
      `<g data-num-cell="${cell}"${colour < 0 ? '' : ` data-colour="${colour}"`}>`
      + `${shape}fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3"/>`
      + `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-size="${CELL * 0.32}" `
      + `font-weight="700" fill="${colors.text}">${label}</text></g>`,
    );
  }
  return badges.join('');
}

// hint: { kind: 'wrong' | 'next', edge: [a, b] } or null.
function hintMarkup(puzzle, hint) {
  if (!hint || !hint.edge) {
    return '';
  }
  const middle = edgeMiddleOf(puzzle, ...hint.edge, CELL);
  return hint.kind === 'wrong' ? wrongMoveMarkAt(middle) : correctMoveRingAt(middle);
}

// `pad`: the margin of a Wrap-around board, in cells, on every side.
export function maxBoardCss(n, pad = 0) {
  const px = Math.min(720, (n + 2 * pad) * 84);
  return `max-width:${px}px;max-width:min(${px}px,max(260px,calc(100dvh - 330px)))`;
}

// The cells of the board and the grid: a full square, or, for a Cutout puzzle, only the cells that
// are left, drawn as in the play app.
function cellsMarkup(puzzle) {
  if (puzzle.holes) {
    return cutoutLayers(puzzle);
  }
  const size = puzzle.n * CELL;
  if (puzzle.wrap) {
    return wrapLayers(size);
  }
  return `<rect width="${size}" height="${size}" rx="6" fill="${COLORS.tile}"/>`
    + gridMarkup(puzzle.n);
}

// While a portal is waiting for its partner: a pulsing ring on the partner, "tap it to jump" (as in
// the play app). `ring` is { cell, player } or null.
function ringMarkup(puzzle, ring) {
  if (!ring) {
    return '';
  }
  const [x, y] = cellCentre(puzzle, ring.cell, CELL);
  const color = PLAYER_COLORS[ring.player] ?? PLAYER_COLORS[0];
  const [small, large] = [CELL * 0.38, CELL * 0.46];
  return `<circle data-mark="jump-ready" cx="${num(x)}" cy="${num(y)}" r="${CELL * 0.42}" `
    + `fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="6 4">`
    + `<animate attributeName="r" values="${small};${large};${small}" dur="1s" `
    + 'repeatCount="indefinite"/></circle>';
}

// The Pentagon board: the tiles, the outline and the walls of the play app, and what the other
// boards have on top (lines, badges, hint).
function pentagonMarkup(puzzle, drawing, hint) {
  const { x, y, w, h } = pentagonView(puzzle);
  return `<svg class="zip-svg coop-svg pentagon" viewBox="${x} ${y} ${w} ${h}" `
    + `style="${pentagonCss(puzzle)}">`
    + pentagonLayers(puzzle)
    + drawnMarkup(puzzle, drawing)
    + badgesMarkup(puzzle, drawing)
    + hintMarkup(puzzle, hint)
    + '</svg>';
}

export function boardMarkup(puzzle, drawing, hint = null, ring = null) {
  if (isPentagon(puzzle)) {
    return pentagonMarkup(puzzle, drawing, hint);
  }
  const size = puzzle.n * CELL;
  const walls = wallSegments(puzzle, CELL).map(line).join('');
  const pad = padOf(puzzle);
  const style = maxBoardCss(puzzle.n, pad);
  const margin = pad * CELL;
  const view = `${-margin} ${-margin} ${size + 2 * margin} ${size + 2 * margin}`;
  const kind = (puzzle.holes ? ' cutout' : '') + (puzzle.wrap ? ' wrap' : '')
    + (puzzle.portals ? ' teleport' : '');
  return `<svg class="zip-svg coop-svg${kind}" viewBox="${view}" style="${style}">`
    + cellsMarkup(puzzle)
    + `<g stroke="${COLORS.wall}" stroke-width="6" stroke-linecap="round">${walls}</g>`
    + portalIconsSvg(puzzle)
    + drawnMarkup(puzzle, drawing)
    + (puzzle.arrows ? arrowMarks(puzzle) : '')
    + badgesMarkup(puzzle, drawing)
    + hintMarkup(puzzle, hint)
    + ringMarkup(puzzle, ring)
    + '</svg>';
}
