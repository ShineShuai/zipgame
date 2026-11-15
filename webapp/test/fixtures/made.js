// The same puzzle as the generator makes it, for the tests that go on with a puzzle (draw it, grade it, share it): made once per
// process, whatever test asks, and handed out as a copy. A test of the generator itself calls the generator, not this.
import { runSync } from '../../src/core/run.js';
import { MAKE } from './makers.js';

const memo = new Map();
const keyOf = (kind, n, seed) => `${kind}-${n}-${seed}`;

export function made(kind, n, seed, opts = {}) {
  const key = `${keyOf(kind, n, seed)}${JSON.stringify(opts)}`;
  if (!memo.has(key)) {
    memo.set(key, runSync(MAKE[kind](n, seed, opts)));
  }
  return structuredClone(memo.get(key));
}
