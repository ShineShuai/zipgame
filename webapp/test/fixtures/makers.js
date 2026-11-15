// How each kind of puzzle is made: kind -> (n, seed, opts) => generator. Used by made().
// (The solids, tetra, cube and ball, belong to the co-op trial, which nothing else may import.)
import { generate } from '../../src/core/gen/generate.js';
import { generateArrows } from '../../src/core/gen/arrows.js';
import { generateCutout, CUTOUT_MAX_MS } from '../../src/core/gen/cutout.js';
import { generateExact } from '../../src/core/gen/exact.js';
import { generateLoop } from '../../src/core/gen/loop.js';
import { generatePentagon } from '../../src/core/gen/pentagon.js';
import { generateTeleport } from '../../src/core/gen/teleport.js';
import { generateTwoPaths } from '../../src/core/gen/twopaths.js';

export const MAKE = {
  std: (n, seed, o) => generate(n, seed, o),
  wrap: (n, seed, o) => generate(n, seed, { ...o, wrap: true }),
  cutout: (n, seed, o) => generateCutout(n, seed, { maxMs: CUTOUT_MAX_MS, ...o }),
  exact: generateExact,
  teleport: generateTeleport,
  loop: generateLoop,
  twopaths: generateTwoPaths,
  pentagon: generatePentagon,
  arrows: generateArrows,
};
