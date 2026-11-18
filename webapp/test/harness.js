// The harness of the unit suites (test/unit/*.test.js and the files they register): t(name, fn) a test, ta(name, fn) an async test (these run after
// all the sync ones), eq and ok the assertions. Tests run with node:test (node test/unit/solver.test.js, npm test), so one can be picked
// with --test-name-pattern.
//
// Tiers, picked by ZIGZAG_TESTS (the npm scripts set it):
//   fast (the default)  every test that is not marked slow: what the pre-commit hook and the Node 20 job run
//   slow                only the tests marked slow: t.slow(name, fn), ta.slow(name, fn)
//   all                 both: what the Node 22 job runs
// A test that uses 0.5 s of CPU time or more belongs in the slow tier; test/budget.js reports and, off CI, fails the ones that are far over.
import assert from 'node:assert/strict';
import test from 'node:test';
import './budget.js';

export const TIER = process.env.ZIGZAG_TESTS || 'fast';
if (!['fast', 'slow', 'all'].includes(TIER)) {
  throw new Error(`ZIGZAG_TESTS is "${TIER}": fast, slow or all`);
}
// eq(actual, expected, message): deep and strict, so NaN is not null, a Set is not compared as {},
// and a typed array is not an array.
export const eq = (actual, expected, message) => assert.deepStrictEqual(actual, expected, message);
export const ok = (c, m = 'assertion failed') => {
  if (!c) {
    throw new Error(m);
  }
};

const pending = []; // the async tests, registered after the sync ones

function register(name, fn, slow) {
  if (TIER !== 'all' && (TIER === 'slow') !== slow) {
    return;
  }
  test(name, async () => {
    await fn();
  });
}

export const t = (name, fn) => register(name, fn, false);
t.slow = (name, fn) => register(name, fn, true);

export const ta = (name, fn) => { pending.push([name, fn, false]); };
ta.slow = (name, fn) => { pending.push([name, fn, true]); };

// after every suite has registered its tests
export function registerAsyncTests() {
  for (const [name, fn, slow] of pending.splice(0)) {
    register(name, fn, slow);
  }
}

// For a test that compares two implementations over a long list of cases (seeds, sizes): the fast tier takes every `every`-th case,
// the all tier every case. The fast tier runs the same checks on fewer inputs; the full list runs in the Node 22 job and before a release.
export const sampled = (cases, every = 3) => (TIER === 'fast' ? cases.filter((_, index) => index % every === 0) : cases);

// For a file that calls node:test itself: test(name, FAST, fn) or test(name, SLOW, fn) puts the test in its tier.
export const FAST = TIER === 'slow' ? { skip: 'fast tier' } : {};
export const SLOW = TIER === 'fast' ? { skip: 'slow tier: npm run test:slow' } : {};
