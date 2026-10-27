import { generateArrows, ARROW_SIZES } from '../core/gen/arrows.js';
import { generateCutout, CUTOUT_MAX_MS } from '../core/gen/cutout.js';
import { generateExact, EXACT_SIZES } from '../core/gen/exact.js';
import { generateLoop, LOOP_SIZES } from '../core/gen/loop.js';
import { generatePentagon } from '../core/gen/pentagon.js';
import { generateTwoPaths, TWOPATHS_SIZES } from '../core/gen/twopaths.js';
import { PENTAGON_SIZES, isPentagon } from '../core/pentagon.js';
import { loadBalls, pickBall } from '../core/solid/balls.js';
import { generateSurfaceSteps } from '../core/surface/gen.js';
import { isSurfacePuzzle } from '../core/surface/puzzle.js';
import {
  BALL_KIND, SURFACE_SIZES, ballEntry,
} from '../core/surface/topology.js';
import { generate, PLAY_SIZES, WRAP_SIZES } from '../core/gen/generate.js';
import { generateTeleport, TELEPORT_SIZES } from '../core/gen/teleport.js';

// The puzzle types Patchwork plays, one entry each (drawing.js unsupported() refuses the rest).
// The ids are those of the play app, so its texts (`mode.<id>`) name them.
//
//   id        'standard' or the play app's variant id
//   sizes     the board sizes on offer
//   generate  (n, seed) -> generator function* (core/run.js, platform/run.js drive it)
//   ready     optional, () -> promise: what generate needs first (the catalog of the balls)
// The solids come as a puzzle with its solution in `path`, as the generators of the others do.
function* generateSolid(kind, n, seed) {
  const made = yield* generateSurfaceSteps(kind, n, seed);
  made.puzzle.path = made.path;
  return made.puzzle;
}

// A ball from the catalog, drawn by the seed (the size select has nothing to say about a ball).
function* generateBall(seed) {
  const entry = pickBall(() => (Math.imul(seed, 2654435761) >>> 0) / 4294967296);
  return yield* generateSolid(BALL_KIND, entry.id, seed);
}

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
    id: 'arrows',
    sizes: () => PLAY_SIZES.filter(n => ARROW_SIZES.includes(n)),
    generate: (n, seed) => generateArrows(n, seed),
  },
  {
    id: 'exact',
    sizes: () => PLAY_SIZES.filter(n => EXACT_SIZES.includes(n)),
    generate: (n, seed) => generateExact(n, seed),
  },
  {
    id: 'wrap',
    sizes: () => WRAP_SIZES,
    generate: (n, seed) => generate(n, seed, { wrap: true }),
  },
  {
    id: 'loop',
    sizes: () => LOOP_SIZES,
    generate: (n, seed) => generateLoop(n, seed),
  },
  {
    id: 'teleport',
    sizes: () => TELEPORT_SIZES,
    generate: (n, seed) => generateTeleport(n, seed),
  },
  {
    id: 'twopaths',
    sizes: () => TWOPATHS_SIZES,
    generate: (n, seed) => generateTwoPaths(n, seed),
  },
  {
    id: 'pentagon',
    sizes: () => PENTAGON_SIZES,
    generate: (n, seed) => generatePentagon(n, seed),
  },
  {
    id: 'tetra',
    sizes: () => SURFACE_SIZES.tetra,
    generate: (n, seed) => generateSolid('tetra', n, seed),
  },
  {
    id: 'cube',
    sizes: () => SURFACE_SIZES.cube,
    generate: (n, seed) => generateSolid('cube', n, seed),
  },
  {
    id: 'ball',
    sizes: () => [0],
    generate: (n, seed) => generateBall(seed),
    ready: loadBalls,
  },
];

// The solids (a 3D tab of their own in the menu, as in the play app's free play).
export const SOLID_IDS = ['tetra', 'cube', 'ball'];
export const isSolidId = id => SOLID_IDS.includes(id);
export const FLAT_IDS = COOP_VARIANTS.map(({ id }) => id).filter(id => !isSolidId(id));

export const variantById = id => COOP_VARIANTS.find(variant => variant.id === id)
  ?? COOP_VARIANTS[0];

export const sizesFor = id => variantById(id).sizes();

// The variant a puzzle belongs to, among those of COOP_VARIANTS (others are not played).
export function variantOf(puzzle) {
  if (isSurfacePuzzle(puzzle)) {
    return puzzle.kind;
  }
  if (puzzle.holes) {
    return 'cutout';
  }
  if (puzzle.exact) {
    return 'exact';
  }
  if (puzzle.arrows) {
    return 'arrows';
  }
  if (puzzle.wrap) {
    return 'wrap';
  }
  if (puzzle.loop) {
    return 'loop';
  }
  if (puzzle.split) {
    return 'twopaths';
  }
  return puzzle.portals ? 'teleport' : 'standard';
}

// What the size of a puzzle is called in the title of the game: 6×6, 4 (a tetra or cube) or the
// name of the ball.
export function sizeName(puzzle) {
  switch (variantOf(puzzle)) {
    case 'tetra':
    case 'cube':
      return `${puzzle.n}`;
    case 'ball':
      return ballEntry(puzzle.n).name;
    default:
      return `${puzzle.n}×${puzzle.n}`;
  }
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
