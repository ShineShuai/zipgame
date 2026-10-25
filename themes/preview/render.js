// Pure markup builders of the theme preview (themes.html): the 5x5 sample board drawn from a theme's board skin, and
// the variant icons from its art. They are the spec for the real renderers (apps/play/board.js, icons.js) in phase P2.
// Colours are tokens only; geometry comes from the skin, in CELL units.
const CELL = 60;
const SIZE = CELL * 5;
const px = v => Math.round(v * CELL * 100) / 100;

// The sample of the prototypes: a path through checkpoints 1, 2, 3 (visited) with 4 and 5 still to reach, one wall.
const PATH = '30,30 270,30 270,90 30,90 30,150 150,150';
const NUMBERS = [[30, 30, 1, true], [270, 90, 2, true], [30, 150, 3, true], [270, 210, 4, false], [270, 270, 5, false]];

export function boardSvg(skin) {
  const s = skin;
  const parts = [];
  if (s.plateRx) parts.push(`<rect width="${SIZE}" height="${SIZE}" rx="${px(s.plateRx)}" fill="var(--b-stage)"/>`);
  if (s.grid === 'tiles') {
    const inset = px(s.tileInset);
    const side = CELL - 2 * inset;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const [x, y] = [col * CELL + inset, row * CELL + inset];
        if (s.depth) {
          parts.push(`<rect x="${x}" y="${y + px(s.depth)}" width="${side}" height="${side}" rx="${px(s.tileRx)}" fill="var(--b-depth)"/>`);
        }
        const edge = s.tileEdgeW ? ` stroke="var(--b-grid)" stroke-width="${px(s.tileEdgeW)}"` : '';
        parts.push(`<rect x="${x}" y="${y}" width="${side}" height="${side}" rx="${px(s.tileRx)}" fill="var(--b-bg)"${edge}/>`);
      }
    }
  } else {
    parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="var(--b-bg)"/>`);
    for (let i = 0; i <= 5; i++) {
      parts.push(`<path d="M0 ${i * CELL}H${SIZE}M${i * CELL} 0V${SIZE}" stroke="var(--b-grid)" stroke-width="${px(s.tileEdgeW || 0.025)}"/>`);
    }
  }
  parts.push(`<line x1="60" y1="240" x2="300" y2="240" stroke="var(--b-wall)" stroke-width="${px(s.wallW)}" stroke-linecap="${s.wallCap}"/>`);
  // userSpaceOnUse: a plain horizontal run has an empty bounding box, which objectBoundingBox gradients cannot paint
  const defs = s.gradient
    ? `<defs><linearGradient id="pv-path" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIZE}">`
      + '<stop offset="0" stop-color="var(--b-path-hi)"/><stop offset="1" stop-color="var(--b-path)"/></linearGradient></defs>'
    : '';
  const stroke = s.gradient ? 'url(#pv-path)' : 'var(--b-path)';
  parts.push(`<polyline points="${PATH}" fill="none" stroke="${stroke}" stroke-width="${px(s.pathW)}"`
    + ` stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"/>`);
  parts.push('<circle cx="150" cy="150" r="9" fill="var(--b-halo)"/>');
  const r = px(s.numR);
  for (const [x, y, n, visited] of NUMBERS) {
    const fill = visited ? 'var(--b-numv-fill)' : 'var(--b-num-fill)';
    const ring = visited ? 'var(--b-numv-ring)' : 'var(--b-num-ring)';
    const ink = visited ? 'var(--b-num-on)' : 'var(--b-num)';
    const shape = s.num === 'square'
      ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="${px(0.1)}"`
      : `<circle cx="${x}" cy="${y}" r="${r}"`;
    parts.push(`${shape} fill="${fill}" stroke="${ring}" stroke-width="${px(s.numRingW)}"/>`
      + `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" font-size="17" font-weight="700"`
      + ` font-family="var(--font-num)" fill="${ink}">${n}</text>`);
  }
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Sample board">${defs}${parts.join('')}</svg>`;
}

export const iconSvg = (inner, id) =>
  `<svg class="variant-icon vi-${id}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${inner}</svg>`;
