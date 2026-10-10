import { ARROW_SIZES } from '../../core/gen/arrows.js';

// Which variant a puzzle belongs to: 'cutout' (has holes), 'arrows' (has one-way arrows), else
// null (standard). The app keeps S.variant = null for a standard puzzle.
export const variantOf = puzzle => {
  if (puzzle.holes) return 'cutout';
  if (puzzle.arrows) return 'arrows';
  return null;
};

// The grid sizes the menu offers for a puzzle type, out of all the sizes the app plays. The arrows
// generator is tuned for small boards only (gen/arrows.js).
export const sizesFor = (mode, sizes) => (
  mode === 'arrows' ? sizes.filter(n => ARROW_SIZES.includes(n)) : sizes
);

// The size to show when `size` is not on offer: the offered one closest to it (the smaller one
// on a tie).
export function nearestSize(size, offered) {
  const distance = n => Math.abs(n - size);
  return offered.reduce((best, n) => (distance(n) < distance(best) ? n : best), offered[0]);
}
