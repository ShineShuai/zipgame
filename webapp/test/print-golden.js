// Prints a fresh GOLDEN list for test/golden.js: same (size, seed) cases, hashes of what the current
// generator produces. Run: npm run golden
import { GOLDEN } from './golden.js';
import { generate } from '../src/core/gen/generate.js';
import { serialize } from '../src/core/format.js';
import { hashStr } from '../src/core/rng.js';
import { runSync } from '../src/core/run.js';

const fresh = GOLDEN.map(([n, seed]) => [n, seed, hashStr(serialize(runSync(generate(n, seed))))]);
const rows = fresh.map(([n, seed, hash]) => `  [${n}, ${seed}, '${hash}'],`);
console.log(['export const GOLDEN = [', ...rows, '];'].join('\n'));
