// The look of the portals of a Teleport puzzle (puzzle.portals, core/model.js), shared by the
// Play app and the Design app: every pair has its own colour AND its own shape, so that two
// pairs are told apart without the colour (colour blindness): a ring, a diamond, a square, a
// triangle, then round again. Pure markup, no DOM.
export const PORTAL_COLORS = ['#8b5cf6', '#0d9488', '#db2777', '#65a30d', '#0284c7', '#ea580c'];
export const PORTAL_SHAPES = ['ring', 'diamond', 'square', 'triangle'];
export const portalColor = index => PORTAL_COLORS[index % PORTAL_COLORS.length];
export const portalShape = index => PORTAL_SHAPES[index % PORTAL_SHAPES.length];
// The play app draws the portals with the theme's tokens (--portal-1..6, css/theme.css: the same colours as above by default); the
// Design app has no theme and keeps the hex above.
export const portalColorVar = index => `var(--portal-${(index % PORTAL_COLORS.length) + 1})`;

const num = value => +value.toFixed(3);
const pts = list => list.map(([px, py]) => `${num(px)},${num(py)}`).join(' ');

// One outline of `shape` centred on (x, y), `radius` from the centre to its sides.
function outline(shape, color, x, y, radius, width) {
  const look = `fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linejoin="round"`;
  if (shape === 'diamond') {
    const r = radius * 1.15;
    return `<polygon ${look} points="${pts([[x, y - r], [x + r, y], [x, y + r], [x - r, y]])}"/>`;
  }
  if (shape === 'square') {
    const r = radius * 0.9;
    return `<rect ${look} x="${num(x - r)}" y="${num(y - r)}" width="${num(2 * r)}" ` +
      `height="${num(2 * r)}" rx="${num(radius * 0.25)}"/>`;
  }
  if (shape === 'triangle') {
    const top = [x, y - radius * 1.1];
    const right = [x + radius * 1.05, y + radius * 0.8];
    const left = [x - radius * 1.05, y + radius * 0.8];
    return `<polygon ${look} points="${pts([top, right, left])}"/>`;
  }
  return `<circle ${look} cx="${num(x)}" cy="${num(y)}" r="${num(radius)}"/>`;
}

// One portal icon centred on (x, y): the pair's shape twice, a big outline and a small one
// inside, in the pair's colour, on a faint disc. `size` is the width of one cell in the
// caller's units (the stroke widths scale with it).
export function portalIcon(shape, color, x, y, size = 60) {
  const r = size * 0.34;
  const k = size / 60;
  return `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="${color}" ` +
    'fill-opacity="0.14" stroke="none"/>' +
    outline(shape, color, x, y, r, 3.5 * k) + outline(shape, color, x, y, r * 0.5, 2.5 * k);
}
