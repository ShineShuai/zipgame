// Icons of the play menu: one per puzzle variant (standard, cutout, arrows, exact, wrap, loop,
// teleport, twopaths, pentagon) and one
// per menu card.
// Plain SVG strings, no DOM. Colours come from css/play.css (.vi-*, currentColor), so the
// icons follow the page theme and the same markup serves the picker, the HUD and the cards.

import { currentArt } from '../../themes/art-state.js';
import { freshScope, scopeIds } from '../../themes/svg.js';

const CELLS = 4; // the variant icons draw a 4x4 board
const UNIT = 9; // one cell, in viewBox units (48 x 48 box)
const ORIGIN = 6; // left and top edge of the board
const GAP = 0.7; // space on each side of a tile

const num = value => +value.toFixed(2);
const centre = index => ORIGIN + UNIT * index + UNIT / 2;

// Cutout icon: the 2x2 middle is a hole, so the board is a ring (cells numbered row * 4 + col).
const NO_HOLES = new Set();
const RING_HOLES = new Set([5, 6, 9, 10]);

// Solution paths as [col, row] corners: a snake over all 16 cells, a lap around the ring.
const SNAKE = [[0, 0], [3, 0], [3, 1], [0, 1], [0, 2], [3, 2], [3, 3], [0, 3]];
// Standard icon: the snake mirrored left to right, so it starts top right and reads as an S (through the cells, like the others).
const S_SHAPE = SNAKE.map(([col, row]) => [CELLS - 1 - col, row]);
const LAP = [[0, 0], [3, 0], [3, 3], [0, 3], [0, 1]];
// Loop icon: one closed ring through all 16 cells (it comes back to its start), with three
// numbers on it in cyclic order.
const RING = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3], [0, 0]];
const ICON_RING_NUMBERS = [[0, 0, 1], [3, 1, 2], [1, 2, 3]];

function tiles(holes) {
  const rects = [];
  const side = num(UNIT - 2 * GAP);
  for (let row = 0; row < CELLS; row++) {
    for (let col = 0; col < CELLS; col++) {
      if (holes.has(row * CELLS + col)) {
        continue;
      }
      const x = num(ORIGIN + col * UNIT + GAP);
      const y = num(ORIGIN + row * UNIT + GAP);
      rects.push(`<rect x="${x}" y="${y}" width="${side}" height="${side}" rx="1.6"/>`);
    }
  }
  return `<g class="vi-tile">${rects.join('')}</g>`;
}

function route(corners) {
  const points = corners.map(([col, row]) => `${centre(col)},${centre(row)}`);
  const [startCol, startRow] = corners[0];
  const [endCol, endRow] = corners[corners.length - 1];
  return `<polyline class="vi-path" points="${points.join(' ')}"/>` +
    `<circle class="vi-dot" cx="${centre(startCol)}" cy="${centre(startRow)}" r="2.7"/>` +
    `<circle class="vi-dot" cx="${centre(endCol)}" cy="${centre(endRow)}" r="2.7"/>`;
}

// Arrows icon: the snake board with three one-way arrows on its edges (the first and last point the
// way the snake goes, the middle one is a decoy). Each is [col, row, side, direction]: the edge sits
// on the right ('r') or the bottom ('b') side of that cell, the direction is the unit step [dx, dy].
const ICON_ARROWS = [
  [1, 1, 'r', [-1, 0]],
  [1, 1, 'b', [0, 1]],
  [2, 2, 'b', [0, -1]],
];

function arrowheads() {
  const heads = ICON_ARROWS.map(([col, row, side, [dx, dy]]) => {
    const x = side === 'r' ? ORIGIN + UNIT * (col + 1) : centre(col);
    const y = side === 'b' ? ORIGIN + UNIT * (row + 1) : centre(row);
    const tip = [x + dx * 3.2, y + dy * 3.2];
    const left = [x - dx * 2 - dy * 3, y - dy * 2 + dx * 3];
    const right = [x - dx * 2 + dy * 3, y - dy * 2 - dx * 3];
    const points = [tip, left, right].map(([px, py]) => `${num(px)},${num(py)}`).join(' ');
    return `<polygon class="vi-arrow" points="${points}"/>`;
  });
  return heads.join('');
}

// Exact icon: the snake board with four number badges that are steps along it (cells numbered row
// * 4 + col; the snake reaches [col, row] = [0, 0] at step 1, [1, 1] at 7, [3, 2] at 12 and [0, 3]
// at 16).
const ICON_STEPS = [[0, 0, 1], [1, 1, 7], [3, 2, 12], [0, 3, 16]];

function stepBadges(steps) {
  const badges = steps.map(([col, row, step]) => {
    const x = centre(col);
    const y = centre(row);
    return `<circle class="vi-badge" cx="${x}" cy="${y}" r="4.1"/>` +
      `<text class="vi-num" x="${x}" y="${y}" dy=".35em">${step}</text>`;
  });
  return badges.join('');
}

// Wrap-around icon: the path leaves the board on the left of the second row and comes back in on
// its right (two stubs into the margin), then runs down the right column.
const WRAP_OUT = [[2, 0], [2, 1], [0, 1]];
const WRAP_IN = [[3, 1], [3, 3]];
const STUB = 2.5; // how far the stubs reach out of the board, in viewBox units

function wrapRoute() {
  const at = ([col, row]) => `${centre(col)},${centre(row)}`;
  const y = centre(1);
  const out = [...WRAP_OUT.map(at), `${ORIGIN - STUB},${y}`];
  const back = [`${ORIGIN + UNIT * CELLS + STUB},${y}`, ...WRAP_IN.map(at)];
  const dot = ([col, row]) =>
    `<circle class="vi-dot" cx="${centre(col)}" cy="${centre(row)}" r="2.7"/>`;
  return `<polyline class="vi-path" points="${out.join(' ')}"/>` +
    `<polyline class="vi-path" points="${back.join(' ')}"/>` +
    `${dot(WRAP_OUT[0])}${dot(WRAP_IN[WRAP_IN.length - 1])}`;
}

// Teleport icon: the path walks into a portal on the top row, and carries on from its partner two
// rows down
// (a dotted arc between them); both portals are rings. Cells are [col, row].
const PORTAL_A = [1, 0];
const PORTAL_B = [2, 2];
const PORTAL_ICON_COLOR_CLASS = 'vi-portal';

function teleportRoute() {
  const at = ([col, row]) => `${centre(col)},${centre(row)}`;
  const first = [[0, 0], PORTAL_A].map(at).join(' ');
  const second = [PORTAL_B, [3, 2], [3, 3]].map(at).join(' ');
  const [ax, ay] = [centre(PORTAL_A[0]), centre(PORTAL_A[1])];
  const [bx, by] = [centre(PORTAL_B[0]), centre(PORTAL_B[1])];
  const arc = `M${ax} ${ay}Q${num((ax + bx) / 2 + 7)} ${num((ay + by) / 2 - 3)} ${bx} ${by}`;
  const ring = ([x, y]) => {
    const at = `cx="${centre(x)}" cy="${centre(y)}"`;
    return `<circle class="${PORTAL_ICON_COLOR_CLASS}" ${at} r="3.9"/>` +
      `<circle class="${PORTAL_ICON_COLOR_CLASS} vi-portal-core" ${at} r="1.5"/>`;
  };
  const dot = ([x, y]) => `<circle class="vi-dot" cx="${centre(x)}" cy="${centre(y)}" r="2.7"/>`;
  return `<polyline class="vi-path" points="${first}"/><path class="vi-jump" d="${arc}"/>` +
    `<polyline class="vi-path" points="${second}"/>${ring(PORTAL_A)}${ring(PORTAL_B)}` +
    `${dot([0, 0])}${dot([3, 3])}`;
}

// Two paths icon: a red path over the top two rows and a blue one under it, each with a dot at
// both ends. Corners are [col, row].
const RED_ROUTE = [[0, 0], [3, 0], [3, 1], [0, 1]];
const BLUE_ROUTE = [[3, 3], [0, 3], [0, 2], [3, 2]];

function twoPathsRoutes() {
  const one = (corners, colour) => {
    const at = ([col, row]) => `${centre(col)},${centre(row)}`;
    const dot = ([col, row]) =>
      `<circle class="vi-dot vi-dot-${colour}" cx="${centre(col)}" cy="${centre(row)}" r="2.7"/>`;
    return `<polyline class="vi-path vi-path-${colour}" points="${corners.map(at).join(' ')}"/>` +
      `${dot(corners[0])}${dot(corners[corners.length - 1])}`;
  };
  return one(RED_ROUTE, 'red') + one(BLUE_ROUTE, 'blue');
}

// Pentagon icon: the 16 cells of the smallest Pentagon board (core/pentagon.js, n = 4) as
// corner lists in the 48 x 48 box, and a path through all their centres.
const PENTAGON_TILES = [
  '17.9,7 14.7,10.2 16.3,16.3 22.4,14.7 24,8.6',
  '33.3,7 30.1,10.2 31.7,16.3 37.8,14.7 39.4,8.6',
  '7,14.7 10.2,17.9 16.3,16.3 14.7,10.2 8.6,8.6',
  '22.4,14.7 25.6,17.9 31.7,16.3 30.1,10.2 24,8.6',
  '25.6,17.9 22.4,14.7 16.3,16.3 17.9,22.4 24,24',
  '41,17.9 37.8,14.7 31.7,16.3 33.3,22.4 39.4,24',
  '14.7,25.6 17.9,22.4 16.3,16.3 10.2,17.9 8.6,24',
  '30.1,25.6 33.3,22.4 31.7,16.3 25.6,17.9 24,24',
  '17.9,22.4 14.7,25.6 16.3,31.7 22.4,30.1 24,24',
  '33.3,22.4 30.1,25.6 31.7,31.7 37.8,30.1 39.4,24',
  '7,30.1 10.2,33.3 16.3,31.7 14.7,25.6 8.6,24',
  '22.4,30.1 25.6,33.3 31.7,31.7 30.1,25.6 24,24',
  '25.6,33.3 22.4,30.1 16.3,31.7 17.9,37.8 24,39.4',
  '41,33.3 37.8,30.1 31.7,31.7 33.3,37.8 39.4,39.4',
  '14.7,41 17.9,37.8 16.3,31.7 10.2,33.3 8.6,39.4',
  '30.1,41 33.3,37.8 31.7,31.7 25.6,33.3 24,39.4',
];
const PENTAGON_ROUTE = [
  [19.1, 26.8], [21.2, 19.1], [28.9, 21.2], [36.6, 19.1], [34.5, 11.4], [26.8, 13.5], [19.1, 11.4],
  [11.4, 13.5], [13.5, 21.2], [11.4, 28.9], [13.5, 36.6], [21.2, 34.5], [26.8, 28.9], [34.5, 26.8],
  [36.6, 34.5], [28.9, 36.6],
];

function pentagonTiles() {
  const polygons = PENTAGON_TILES.map(points => `<polygon points="${points}"/>`);
  return `<g class="vi-tile vi-pentagons">${polygons.join('')}</g>`;
}

function pentagonRoute() {
  const dot = ([x, y]) => `<circle class="vi-dot" cx="${x}" cy="${y}" r="2.7"/>`;
  const points = PENTAGON_ROUTE.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polyline class="vi-path" points="${points}"/>${dot(PENTAGON_ROUTE[0])}`
    + dot(PENTAGON_ROUTE[PENTAGON_ROUTE.length - 1]);
}

// The solid puzzles (apps/play/solid.js): a cube seen from a corner, a tetrahedron seen from above
// one corner, a ball with a pentagon in front. Each is a few tiles with a path over them.
const polygon = points => `<polygon class="vi-tile" points="${points}"/>`;
const dots = (...centres) => centres
  .map(([x, y]) => `<circle class="vi-dot" cx="${x}" cy="${y}" r="2.7"/>`)
  .join('');

const SOLID_ICONS = {
  cube: polygon('24,10.5 36.5,17.5 24,24.5 11.5,17.5') + polygon('11.5,19.5 23,26 23,40 11.5,33')
    + polygon('25,26 36.5,19.5 36.5,33 25,40')
    + '<polyline class="vi-path" points="24,17.5 17,28 23.5,33 30.5,28"/>'
    + dots([24, 17.5], [30.5, 28]),
  tetra: polygon('24,9 40,36 25,28.2') + polygon('22.5,9.8 8,36 23,28.2')
    + polygon('9.5,38 38.5,38 24,30.2')
    + '<polyline class="vi-path" points="20,24 16,32 24,34 32,32"/>'
    + dots([20, 24], [32, 32]),
  ball: '<circle class="vi-tile" cx="24" cy="24" r="17.5"/>'
    + '<polygon class="vi-tile" points="24,17.5 30.2,22 27.8,29.3 20.2,29.3 17.8,22"/>'
    + '<path class="vi-spoke" d="M24 17.5V8M30.2 22l9-3M27.8 29.3l5.5 7.5M20.2 29.3l-5.5 7.5'
    + 'M17.8 22l-9-3"/>'
    + '<polyline class="vi-path" points="13,30 20,26 28,26 35,18"/>'
    + dots([13, 30], [35, 18]),
};

function solidIcon(kind) {
  return `<svg class="variant-icon vi-${kind}" viewBox="0 0 48 48" aria-hidden="true" ` +
    'focusable="false"><rect class="vi-bg" x="2" y="2" width="44" height="44" rx="11"/>' +
    `${SOLID_ICONS[kind]}</svg>`;
}

// The icon of the theme on screen (its art): the same ids as below, anything else = standard. null when the theme does not draw it
// (a built-in theme, or one that leaves lucky and the solids to the classic icons): the classic icon is drawn then.
const ART_ICONS = ['standard', 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon', 'lucky', 'tetra', 'cube', 'ball'];
function themedIcon(variant) {
  const id = ART_ICONS.includes(variant) ? variant : 'standard';
  const inner = currentArt()?.icons?.[id];
  return inner ? `<svg class="variant-icon vi-${id}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${scopeIds(inner, freshScope())}</svg>` : null;
}

// variant: 'cutout', 'arrows', 'exact', 'wrap', 'loop', 'teleport', 'twopaths', 'pentagon',
// 'lucky' (the mystery of the lucky game), the solid puzzles 'tetra', 'cube' and 'ball', or
// anything else (= standard). Class: variant-icon vi-standard | vi-cutout | vi-arrows |
// vi-exact | vi-wrap | vi-loop | vi-teleport | vi-twopaths | vi-pentagon | vi-lucky |
// vi-tetra | vi-cube | vi-ball.
export function variantIcon(variant) {
  const themed = themedIcon(variant);
  if (themed) return themed;
  if (variant === 'lucky') return luckyIcon();
  if (SOLID_ICONS[variant]) return solidIcon(variant);
  const cutout = variant === 'cutout';
  const arrows = variant === 'arrows';
  const exact = variant === 'exact';
  const wrap = variant === 'wrap';
  const loop = variant === 'loop';
  const teleport = variant === 'teleport';
  const twopaths = variant === 'twopaths';
  const pentagon = variant === 'pentagon';
  const name = cutout ? 'cutout' : arrows ? 'arrows' : exact ? 'exact' : wrap ? 'wrap'
    : loop ? 'loop' : teleport ? 'teleport' : twopaths ? 'twopaths' : pentagon ? 'pentagon'
      : 'standard';
  const board = pentagon ? pentagonTiles() : tiles(cutout ? RING_HOLES : NO_HOLES);
  const path = pentagon ? pentagonRoute() : wrap ? wrapRoute() : twopaths ? twoPathsRoutes()
    : teleport ? teleportRoute() : route(cutout ? LAP : loop ? RING : name === 'standard' ? S_SHAPE : SNAKE);
  return `<svg class="variant-icon vi-${name}" viewBox="0 0 48 48" aria-hidden="true" ` +
    'focusable="false"><rect class="vi-bg" x="2" y="2" width="44" height="44" rx="11"/>' +
    `${board}${path}${arrows ? arrowheads() : ''}${exact ? stepBadges(ICON_STEPS) : ''}` +
    `${loop ? stepBadges(ICON_RING_NUMBERS) : ''}</svg>`;
}

// The mystery variant of the lucky game: a dimmed board under a question mark.
function luckyIcon() {
  const mark = 'M17.5 18.5C17.5 14.5 20.5 12.5 24 12.5S30.5 14.8 30.5 18.5c0 3.3-2.4 4.7-4.6 6.2' +
    '-1.4 1-1.9 1.9-1.9 3.6';
  return '<svg class="variant-icon vi-lucky" viewBox="0 0 48 48" aria-hidden="true" ' +
    'focusable="false"><rect class="vi-bg" x="2" y="2" width="44" height="44" rx="11"/>' +
    `<g opacity="0.55">${tiles(NO_HOLES)}</g>` +
    `<path class="vi-q vi-halo" d="${mark}"/><circle class="vi-qdot vi-halo" cx="24" cy="34.2" r="2.3"/>` +
    `<path class="vi-q" d="${mark}"/><circle class="vi-qdot" cx="24" cy="34.2" r="2.3"/></svg>`;
}

function star(cx, cy, outer, inner) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / 5 - Math.PI / 2;
    points.push(`${num(cx + radius * Math.cos(angle))},${num(cy + radius * Math.sin(angle))}`);
  }
  return points.join(' ');
}

const CARD_ICONS = {
  // a calendar page with a star: the game of the day
  gotd: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/>' +
    '<path d="M3.5 10h17M8 3v4M16 3v4"/>' +
    `<polygon points="${star(12, 15.2, 3.3, 1.4)}" fill="currentColor" stroke-width="1"/>`,
  // a play button: free play
  free: '<circle cx="12" cy="12" r="9"/><path d="M10 8.4v7.2l5.8-3.6z" fill="currentColor"/>',
  // a patchwork: four patches joined by one stitched line (Patchwork, src/coop)
  coop: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M12 3.5v17M3.5 12h17"/>' +
    '<path d="M7 8.6l2.2-2.2 2.2 2.2M12.8 15.4l2.2 2.2 2.2-2.2" stroke-width="1.6"/>',
  // a cube: the solid puzzles
  solid: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>' +
    '<path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
};

export function cardIcon(kind) {
  return '<svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    `focusable="false">${CARD_ICONS[kind]}</svg>`;
}

// Small line icons for the action buttons of a game (icon over label on a phone, icon beside it elsewhere).
const ACTION_PATHS = {
  menu: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  new: '<path d="M12 5v14M5 12h14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  hint: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
export function actionIcon(name) {
  return `<svg class="bi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ACTION_PATHS[name]}</svg>`;
}
