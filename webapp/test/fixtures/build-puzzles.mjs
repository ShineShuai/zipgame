// Writes test/fixtures/puzzles.json: the puzzles the tests use as input, made by the generators and frozen (see puzzles.js).
//   node test/fixtures/build-puzzles.mjs          rebuild the file
//   node test/fixtures/build-puzzles.mjs --check  say whether the generators still make what the file holds
// A test that needs one more puzzle: add its kind, size and seed to SPECS, rebuild, commit the file.
import fs from 'node:fs';
import { runSync } from '../../src/core/run.js';
import { COOP_VARIANTS } from '../../src/coop/variants.js';
import { freeze, keyOf, SAMPLES } from './puzzles.js';
import { MAKE as CORE_MAKERS } from './makers.js';
import { generateUnique } from '../../src/core/gen/generate.js';
import { makeRng } from '../../src/core/rng.js';

const solid = id => (n, seed) =>
  COOP_VARIANTS.find(variant => variant.id === id).generate(n, seed);
// the solids belong to the co-op trial, which test/fixtures/makers.js (used by made()) may not import
const MAKE = {
  ...CORE_MAKERS,
  tetra: solid('tetra'),
  cube: solid('cube'),
  ball: solid('ball'),
  sample: sampleJob,
};

// a unique puzzle with K checkpoints, as unit/helpers.js used to make it
function* sampleJob(n, seed, { K }) {
  const found = yield* generateUnique(n, K, makeRng(seed), { tries: 20 });
  if (!found.unique) throw new Error(`no unique sample puzzle for n=${n} K=${K} seed=${seed}`);
  return found.puzzle;
}

const grid = (sizes, seeds) => sizes.flatMap(n => seeds.map(seed => [n, seed]));
// the options the tests use to make a puzzle quickly
const FAST_GEN = { candidates: 1, refineNodes: 0 };
const SPECS = [
  ['std', grid([5, 6, 7, 8], [1, 2, 3, 4, 5, 6])],
  [
    'std',
    [
      [5, 7],
      [5, 8],
      [6, 9],
      [6, 11],
      [5, 45],
      [6, 46],
      [7, 47],
    ],
  ],
  ['wrap', [...grid([4, 5, 6], [1, 2, 3])]],
  ['cutout', grid([5, 6], [1, 2, 3])],
  ['exact', grid([5, 6, 7, 8], [1, 2])],
  ['teleport', grid([5, 6, 7, 8], [1, 2])],
  ['loop', [...grid([6, 8], [1, 2]), [6, 3]]],
  ['twopaths', grid([5, 6, 7], [1, 2])],
  ['pentagon', [...grid([4, 6, 8], [1, 2]), [6, 3]]],
  ['arrows', grid([5, 6, 7, 8], [1, 2, 3])],
  ['tetra', grid([2, 3], [1, 2])],
  ['cube', grid([2, 3], [1, 2])],
  ['ball', grid([0], [1, 2, 3, 4])],
  // what made() used to generate in the tests (it thaws these now)
  [
    'std',
    [
      [6, 12],
      [9, 3],
    ],
  ],
  [
    'wrap',
    [
      [5, 4],
      [5, 7],
    ],
  ],
  ['exact', [[5, 11]]],
  [
    'loop',
    [
      [4, 3],
      [6, 4],
      [6, 5],
    ],
  ],
  [
    'pentagon',
    [
      [6, 4],
      [6, 5],
    ],
  ],
  [
    'teleport',
    [
      [5, 3],
      [6, 3],
      [6, 4],
      [6, 5],
      [6, 6],
    ],
  ],
  [
    'twopaths',
    [
      [6, 3],
      [6, 4],
      [7, 4],
      [7, 5],
      [8, 2],
    ],
  ],
  // [n, seed, options]
  ['teleport', [[8, 3, { pairs: 2 }]]],
  ['arrows', [[5, 3, FAST_GEN]]],
  [
    'exact',
    [
      [6, 3],
      [6, 5],
      [6, 7],
      [6, 9],
      [7, 13],
    ].map(([n, seed]) => [n, seed, FAST_GEN]),
  ],
  ['sample', SAMPLES.map(([n, K, seed]) => [n, seed, { K }])],
];

await COOP_VARIANTS.find(variant => variant.id === 'ball').ready();
const made = {};
for (const [kind, pairs] of SPECS) {
  for (const [n, seed, opts] of pairs) {
    made[keyOf(kind, n, seed, opts)] = freeze(runSync(MAKE[kind](n, seed, opts)));
  }
}
const text = `{\n${Object.keys(made)
  .sort()
  .map(key => `${JSON.stringify(key)}: ${JSON.stringify(made[key])}`)
  .join(',\n')}\n}\n`;
const file = new URL('./puzzles.json', import.meta.url);
if (process.argv.includes('--check')) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(
    same
      ? 'puzzles.json: the generators still make these puzzles'
      : 'puzzles.json differs from what the generators make now',
  );
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`${Object.keys(made).length} puzzles written to test/fixtures/puzzles.json`);
