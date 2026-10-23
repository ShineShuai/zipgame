import { generateArrows, ARROW_SIZES } from '../core/gen/arrows.js';
import { generateCutout, CUTOUT_MAX_MS } from '../core/gen/cutout.js';
import { generateExact, EXACT_SIZES } from '../core/gen/exact.js';
import { generate, PLAY_SIZES } from '../core/gen/generate.js';

// The puzzle types Free draw plays, one entry each (drawing.js unsupported() refuses the rest).
// The ids are those of the play app, so its texts (`mode.<id>`) name them.
//
//   id        'standard' or the play app's variant id
//   sizes     the board sizes on offer
//   generate  (n, seed) -> generator function* (core/run.js, platform/run.js drive it)
export const COOP_VARIANTS = [
  {
    id: 'standard',
    sizes: () => PLAY_SIZES,
    generate: (n, seed) => generate(n, seed),
  },
  {
    id: 'cutout',
    sizes: () => PLAY_SIZES,
    generate: (n, seed) => generateCutout(n, seed, { maxMs: CUTOUT_MAX_MS }),
  },
  {
    id: 'exact',
    sizes: () => PLAY_SIZES.filter(n => EXACT_SIZES.includes(n)),
    generate: (n, seed) => generateExact(n, seed),
  },
  {
    id: 'arrows',
    sizes: () => PLAY_SIZES.filter(n => ARROW_SIZES.includes(n)),
    generate: (n, seed) => generateArrows(n, seed),
  },
];

export const variantById = id => COOP_VARIANTS.find(variant => variant.id === id)
  ?? COOP_VARIANTS[0];

export const sizesFor = id => variantById(id).sizes();

// The variant a puzzle belongs to, among those of COOP_VARIANTS (others are not played).
export function variantOf(puzzle) {
  if (puzzle.holes) {
    return 'cutout';
  }
  if (puzzle.exact) {
    return 'exact';
  }
  return puzzle.arrows ? 'arrows' : 'standard';
}

// The offered size closest to `size` (the smaller one on a tie).
export function nearestSize(size, offered) {
  const distance = n => Math.abs(n - size);
  return offered.reduce((best, n) => (distance(n) < distance(best) ? n : best), offered[0]);
}

// The key of the statistics record of a game: a standard one keeps the plain size (as before the
// variants), the others are told apart; `online` marks the games with a friend.
export function statKey(puzzle, online) {
  const variant = variantOf(puzzle);
  const base = variant === 'standard' ? `${puzzle.n}` : `${variant}-${puzzle.n}`;
  return online ? `${base}x2` : base;
}
