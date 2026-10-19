import { generateCutout, CUTOUT_MAX_MS } from '../../core/gen/cutout.js';
import { generateArrows, ARROW_SIZES } from '../../core/gen/arrows.js';
import { generateExact, EXACT_SIZES } from '../../core/gen/exact.js';
import { generate, WRAP_SIZES } from '../../core/gen/generate.js';
import { generateLoop, LOOP_SIZES } from '../../core/gen/loop.js';
import { generateTeleport, TELEPORT_SIZES } from '../../core/gen/teleport.js';
import { generateTwoPaths, TWOPATHS_SIZES } from '../../core/gen/twopaths.js';
import { generatePentagon, PENTAGON_SIZES } from '../../core/gen/pentagon.js';
import { PENTAGON_KIND } from '../../core/surface/pentagon.js';
import { PLAY_MAX_CELLS, PLAY_MIN_CELLS } from '../../core/surface/balls.js';
import { SOLID_KINDS, SOLID_SIZES, stageOf } from '../../features/solid-release.js';

// The puzzle variants of the play app, one entry each. Everything that differs between variants
// is read from here (the menu tiles, the generator, the texts, the lucky game), so a new variant
// is: a generator module, an icon (icons.js), one entry below, and its texts (ui/i18n.js; the
// keys follow textKeys). Also add its id to VARIANTS in core/share-code.js (the share link);
// Teleport, Two paths and Pentagon are the exceptions: their link has a version of its own
// (SHARE_VERSION_PORTAL, SHARE_VERSION_SPLIT, SHARE_VERSION_PENTAGON), so that the older links
// keep reading.
//
//   id         the name the app uses (S.mode, S.variant, the share record)
//   detect     which puzzles belong to the variant
//   sizes      the grid sizes on offer: all => sizes, `all` being the sizes the app plays (a
//              variant may offer a size outside it, as Wrap-around does with 4)
//   luckySizes (optional) the sizes of the lucky game while the variant is still locked, out of
//              its sizes (default LUCKY_SIZES); once unlocked the lucky game draws from all sizes
//   countKey   the progress text under the generating bar
//   source     the generator, for the hold-V seed tag
//   generate   (n, seed) -> generator function* (core/run.js, platform/run.js drive it)
export const LUCKY_SIZES = [7, 8, 9, 10]; // sizes of the lucky game for a locked variant: solvable, but not trivial
const cap = id => id[0].toUpperCase() + id.slice(1);
export const textKeys = id => ({
  name: `mode.${id}`, tag: `mode.${id}Tag`, rules: `mode.${id}Rules`, gen: `gen.sub${cap(id)}`,
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
  {
    id: 'wrap',
    detect: puzzle => Boolean(puzzle.wrap),
    // The seams are hard to hold in mind: 4 to 8 in free play (4 is below the app's smallest size,
    // so this list does not depend on `all`), and 4 to 6 in the lucky game of a locked variant.
    sizes: () => WRAP_SIZES,
    luckySizes: [4, 5, 6],
    countKey: 'gen.walls',
    source: 'generate with wrap (core/gen/generate.js)',
    generate: (n, seed) => generate(n, seed, { wrap: true }),
  },
  {
    id: 'loop',
    detect: puzzle => Boolean(puzzle.loop),
    // A ring needs an even number of cells, so even sizes only (gen/loop.js).
    sizes: all => all.filter(n => LOOP_SIZES.includes(n)),
    countKey: 'gen.walls',
    source: 'generateLoop (core/gen/loop.js)',
    generate: (n, seed) => generateLoop(n, seed),
  },
  {
    id: 'teleport',
    detect: puzzle => Boolean(puzzle.portals),
    // The decision "jump now or walk on" is harder than the cell count suggests: small boards, one
    // pair on 5 and 6,
    // one or two from 7 (gen/teleport.js, gen/portals.js).
    sizes: all => all.filter(n => TELEPORT_SIZES.includes(n)),
    luckySizes: [5, 6, 7],
    countKey: 'gen.walls',
    source: 'generateTeleport (core/gen/teleport.js)',
    generate: (n, seed) => generateTeleport(n, seed),
  },
  {
    id: 'twopaths',
    detect: puzzle => Boolean(puzzle.split),
    // Planning the split of the board is the game, so the small boards (gen/twopaths.js).
    sizes: all => all.filter(n => TWOPATHS_SIZES.includes(n)),
    luckySizes: [5, 6, 7],
    countKey: 'gen.walls',
    source: 'generateTwoPaths (core/gen/twopaths.js)',
    generate: (n, seed) => generateTwoPaths(n, seed),
  },
  {
    id: 'pentagon',
    detect: puzzle => puzzle.surface === PENTAGON_KIND,
    // Its own boards (core/surface/pentagon.js): n is the id of a board, 4 to 10, by cells: 16, 36,
    // 64, 96, 100. They do not depend on the grid sizes of the app. The lucky game of a locked
    // variant takes the middle boards.
    sizes: () => PENTAGON_SIZES,
    luckySizes: [6, 8],
    countKey: 'gen.walls',
    source: 'generatePentagon (core/gen/pentagon.js)',
    generate: (n, seed) => generatePentagon(n, seed),
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

// The sizes of the lucky game of a locked 3D kind. A ball has no size: its entry is
// the range of cells the board may have, { min, max }.
export const SOLID_LUCKY = {
  tetra: [3, 4],
  cube: [2, 3],
  ball: [{ min: 10, max: 30 }],
};

// What the unlock feature (features/unlock.js) needs of each 3D kind. `release` is
// releaseDays(SOLID_RELEASE) (null: not released, so the kind is never in the lucky
// game). Size 2 of the tetra is open to everyone from the first day, so a locked
// tetra is played at 3 or 4; once unlocked it draws from every size, a ball from
// every playable board.
export const solidDefs = release => SOLID_KINDS.map(kind => ({
  id: kind,
  solid: true,
  from: release ? release.first : null,
  locked: SOLID_LUCKY[kind],
  pool: kind === 'ball' ? [{ min: PLAY_MIN_CELLS, max: PLAY_MAX_CELLS }] : SOLID_SIZES[kind],
  open: day => stageOf(kind, day, release) === 'all',
}));

// What the unlock feature (features/unlock.js) needs of each variant: the sizes of its
// lucky game while it is locked (its luckySizes, default LUCKY_SIZES, that the variant
// offers) and once it is unlocked (all of its sizes, the same as in free play). With
// `release` given (null or the releaseDays of the config) the 3D kinds follow
// (solidDefs).
export const luckyDefs = (sizes, release) => [
  ...PLAY_VARIANTS.map(variant => {
    const pool = variant.sizes(sizes), lucky = variant.luckySizes || LUCKY_SIZES;
    const locked = pool.filter(n => lucky.includes(n));
    return { id: variant.id, locked: locked.length ? locked : pool, pool };
  }),
  ...(release === undefined ? [] : solidDefs(release)),
];

// The size to show when `size` is not on offer: the offered one closest to it (the smaller one
// on a tie).
export function nearestSize(size, offered) {
  const distance = n => Math.abs(n - size);
  return offered.reduce((best, n) => (distance(n) < distance(best) ? n : best), offered[0]);
}
