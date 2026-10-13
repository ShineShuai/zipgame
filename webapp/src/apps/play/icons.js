// Icons of the play menu: one per puzzle variant (standard, cutout, arrows, exact) and one per
// menu card.
// Plain SVG strings, no DOM. Colours come from css/play.css (.vi-*, currentColor), so the
// icons follow the page theme and the same markup serves the picker, the HUD and the cards.

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
const LAP = [[0, 0], [3, 0], [3, 3], [0, 3], [0, 1]];

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

function stepBadges() {
  const badges = ICON_STEPS.map(([col, row, step]) => {
    const x = centre(col);
    const y = centre(row);
    return `<circle class="vi-badge" cx="${x}" cy="${y}" r="4.1"/>` +
      `<text class="vi-num" x="${x}" y="${y}" dy=".35em">${step}</text>`;
  });
  return badges.join('');
}

// variant: 'cutout', 'arrows', 'exact', 'lucky' (the mystery of the lucky game) or anything else
// (= standard). Class: variant-icon vi-standard | vi-cutout | vi-arrows | vi-exact | vi-lucky.
export function variantIcon(variant) {
  if (variant === 'lucky') return luckyIcon();
  const cutout = variant === 'cutout';
  const arrows = variant === 'arrows';
  const exact = variant === 'exact';
  const name = cutout ? 'cutout' : arrows ? 'arrows' : exact ? 'exact' : 'standard';
  const board = tiles(cutout ? RING_HOLES : NO_HOLES);
  const path = route(cutout ? LAP : SNAKE);
  return `<svg class="variant-icon vi-${name}" viewBox="0 0 48 48" aria-hidden="true" ` +
    'focusable="false"><rect class="vi-bg" x="2" y="2" width="44" height="44" rx="11"/>' +
    `${board}${path}${arrows ? arrowheads() : ''}${exact ? stepBadges() : ''}</svg>`;
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
};

export function cardIcon(kind) {
  return '<svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    `focusable="false">${CARD_ICONS[kind]}</svg>`;
}
