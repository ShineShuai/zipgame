// The puzzle of a kind, size and seed as the generator makes it, for the tests that go on with a
// puzzle (draw it, grade it, share it): made once per process, whatever test asks, and handed out
// as a copy. A test of the generator itself calls the generator, not this.
// A puzzle that puzzles.json holds is thawed from there instead of generated (about 5 s of the
// fast tier). The file is checked against the generators by unit/fixtures.test.js (slow tier), so
// it cannot drift unseen. What the text format does not keep is put back: the seed. A kind whose
// generator result carries more than the format (the Cutout's shape and score) always goes to the
// generator.
import { runSync } from '../../src/core/run.js';
import { MAKE } from './makers.js';
import { fixture, hasFixture, keyOf } from './puzzles.js';

const memo = new Map();
const GENERATED_ONLY = new Set(['cutout']);

const frozen = (kind, n, seed, opts) => {
  if (GENERATED_ONLY.has(kind) || !hasFixture(kind, n, seed, opts)) return null;
  return { ...fixture(kind, n, seed, opts), seed };
};

export function made(kind, n, seed, opts = {}) {
  const key = keyOf(kind, n, seed, opts);
  if (!memo.has(key)) {
    memo.set(key, frozen(kind, n, seed, opts) ?? runSync(MAKE[kind](n, seed, opts)));
  }
  return structuredClone(memo.get(key));
}
