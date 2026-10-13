import { generateCutout, CUTOUT_MAX_MS } from '../../core/gen/cutout.js';
import { generateArrows, ARROW_SIZES } from '../../core/gen/arrows.js';
import { generateExact, EXACT_SIZES } from '../../core/gen/exact.js';

// The puzzle variants of the play app, one entry each. Everything that differs between variants
// is read from here (the menu tiles, the generator, the texts, the lucky game), so a new variant
// is: a generator module, an icon (icons.js), one entry below, and its texts (ui/i18n.js; the
// keys follow textKeys). Also add its id to VARIANTS in core/share-code.js (the share link).
//
//   id         the name the app uses (S.mode, S.variant, the share record)
//   detect     which puzzles belong to the variant
//   sizes      the grid sizes on offer, out of all the sizes the app plays
//              (the lucky game of a still locked variant draws its size from LUCKY_SIZES among them)
//   countKey   the progress text under the generating bar
//   source     the generator, for the hold-V seed tag
//   generate   (n, seed) -> generator function* (core/run.js, platform/run.js drive it)
export const LUCKY_SIZES = [7, 8, 9, 10]; // sizes of the lucky game for a locked variant: solvable, but not trivial
const cap = id => id[0].toUpperCase() + id.slice(1);
export const textKeys = id => ({
  name: `mode.${id}`, tag: `mode.${id}Tag`, gen: `gen.sub${cap(id)}`,
  title: `game.${id}Title`, sharedTitle: `game.shared${cap(id)}Title`,
  share: `share.${id}`, shareHead: `share.head${cap(id)}`,
});

export const PLAY_VARIANTS = [
  {
    id: 'cutout',
    detect: puzzle => Boolean(puzzle.holes),
    sizes: all => all,
    countKey: 'gen.walls',
    source: 'generateCutout (core/gen/cutout.js)',
    generate: (n, seed) => generateCutout(n, seed, { maxMs: CUTOUT_MAX_MS }),
  },
  {
    id: 'arrows',
    detect: puzzle => Boolean(puzzle.arrows),
    // The arrows generator is tuned for small boards only (gen/arrows.js).
    sizes: all => all.filter(n => ARROW_SIZES.includes(n)),
    countKey: 'gen.arrows',
    source: 'generateArrows (core/gen/arrows.js)',
    generate: (n, seed) => generateArrows(n, seed),
  },
  {
    id: 'exact',
    detect: puzzle => Boolean(puzzle.exact),
    // The Exact generator is tuned for 5..12 (gen/exact.js).
    sizes: all => all.filter(n => EXACT_SIZES.includes(n)),
    countKey: 'gen.labels',
    source: 'generateExact (core/gen/exact.js)',
    generate: (n, seed) => generateExact(n, seed),
  },
].map(variant => ({ ...variant, keys: textKeys(variant.id) }));

export const variantById = id => PLAY_VARIANTS.find(variant => variant.id === id) || null;

// Which variant a puzzle belongs to, else null (standard). The app keeps S.variant = null for a
// standard puzzle.
export const variantOf = puzzle => {
  const variant = PLAY_VARIANTS.find(v => v.detect(puzzle));
  return variant ? variant.id : null;
};

// The grid sizes the menu offers for a puzzle type, out of all the sizes the app plays.
export const sizesFor = (mode, sizes) => {
  const variant = variantById(mode);
  return variant ? variant.sizes(sizes) : sizes;
};

// What the unlock feature (features/unlock.js) needs of each variant: the sizes of its lucky game
// while it is locked (LUCKY_SIZES that the variant offers) and once it is unlocked (all of its sizes).
export const luckyDefs = sizes => PLAY_VARIANTS.map(variant => {
  const pool = variant.sizes(sizes), locked = pool.filter(n => LUCKY_SIZES.includes(n));
  return { id: variant.id, locked: locked.length ? locked : pool, pool };
});

// The size to show when `size` is not on offer: the offered one closest to it (the smaller one
// on a tie).
export function nearestSize(size, offered) {
  const distance = n => Math.abs(n - size);
  return offered.reduce((best, n) => (distance(n) < distance(best) ? n : best), offered[0]);
}
