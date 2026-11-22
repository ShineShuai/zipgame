// The tiers of the unit suites. Tests are plain node:test tests (npm test, or node --test
// test/unit/solver.test.js), so one can be picked with --test-name-pattern.
//
// Tiers, picked by ZIGZAG_TESTS (the npm scripts set it):
//   fast (the default)  every test that is not marked slow: what the pre-commit hook and the
//                       Node 20 job run
//   slow                only the tests marked slow: test(name, SLOW, fn)
//   all                 both: what the Node 22 job runs
// A file with both kinds marks its fast tests FAST, or they would run in the slow tier too. A test
// that uses 0.5 s of CPU time or more belongs in the slow tier; test/budget.js reports and, off
// CI, fails the ones that are far over.
import './budget.js';

export const TIER = process.env.ZIGZAG_TESTS || 'fast';
if (!['fast', 'slow', 'all'].includes(TIER)) {
  throw new Error(`ZIGZAG_TESTS is "${TIER}": fast, slow or all`);
}

// For a test that compares two implementations over a long list of cases (seeds, sizes): the fast
// tier takes every `every`-th case, the all tier every case. The fast tier runs the same checks on
// fewer inputs; the full list runs in the Node 22 job and before a release.
export const sampled = (cases, every = 3) =>
  TIER === 'fast' ? cases.filter((_, index) => index % every === 0) : cases;

// For test(name, FAST, fn) and test(name, SLOW, fn): the test runs in its tier only.
export const FAST = TIER === 'slow' ? { skip: 'fast tier' } : {};
export const SLOW = TIER === 'fast' ? { skip: 'slow tier: npm run test:slow' } : {};
