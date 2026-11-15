// Writes test/fixtures/puzzles.json: the puzzles the tests use as input, made by the generators and frozen (see puzzles.js).
//   node test/fixtures/build-puzzles.mjs          rebuild the file
//   node test/fixtures/build-puzzles.mjs --check  say whether the generators still make what the file holds
// A test that needs one more puzzle: add its kind, size and seed to SPECS, rebuild, commit the file.
import fs from 'node:fs';
import { runSync } from '../../src/core/run.js';
import { COOP_VARIANTS } from '../../src/coop/variants.js';
import { freeze, keyOf } from './puzzles.js';
import { MAKE as CORE_MAKERS } from './makers.js';

const solid = id => (n, seed) => COOP_VARIANTS.find(variant => variant.id === id).generate(n, seed);
// the solids belong to the co-op trial, which test/fixtures/makers.js (used by made()) may not import
const MAKE = { ...CORE_MAKERS, tetra: solid('tetra'), cube: solid('cube'), ball: solid('ball') };

const grid = (sizes, seeds) => sizes.flatMap(n => seeds.map(seed => [n, seed]));
const SPECS = [
  ['std', grid([5, 6, 7, 8], [1, 2, 3, 4, 5, 6])],
  ['std', [[5, 7], [5, 8], [6, 9], [6, 11], [5, 45], [6, 46], [7, 47]]],
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
];

await COOP_VARIANTS.find(variant => variant.id === 'ball').ready();
const made = {};
for (const [kind, pairs] of SPECS) {
  for (const [n, seed] of pairs) {
    made[keyOf(kind, n, seed)] = freeze(runSync(MAKE[kind](n, seed)));
  }
}
const text = `{\n${Object.keys(made).sort().map(key => `${JSON.stringify(key)}: ${JSON.stringify(made[key])}`).join(',\n')}\n}\n`;
const file = new URL('./puzzles.json', import.meta.url);
if (process.argv.includes('--check')) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(same ? 'puzzles.json: the generators still make these puzzles' : 'puzzles.json differs from what the generators make now');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`${Object.keys(made).length} puzzles written to test/fixtures/puzzles.json`);
