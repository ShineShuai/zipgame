// The harness of the unit suites (test/unit/*.test.js and the files they register): t(name, fn) a test, ta(name, fn) an async test (these run after
// all the sync ones), eq and ok the assertions. Tests run with node:test (node test/unit/solver.test.js, npm test), so one can be picked
// with --test-name-pattern.
//
// Tiers, picked by ZIGZAG_TESTS (the npm scripts set it):
//   fast (the default)  every test that is not marked slow: what the pre-commit hook and the Node 20 job run
//   slow                only the tests marked slow: t.slow(name, fn), ta.slow(name, fn)
//   all                 both: what the Node 22 job runs
// A test that takes 0.5 s or more is marked slow. A fast test that takes longer than the budget (3 s, ZIGZAG_FAST_BUDGET_MS)
// fails with a message to mark it, so the fast tier does not grow back unnoticed (on CI it only warns).
import test from 'node:test';

export const TIER = process.env.ZIGZAG_TESTS || 'fast';
if (!['fast', 'slow', 'all'].includes(TIER)) {
  throw new Error(`ZIGZAG_TESTS is "${TIER}": fast, slow or all`);
}
const FAST_BUDGET_MS = Number(process.env.ZIGZAG_FAST_BUDGET_MS || 3000);
const BUDGET_ONLY_WARNS = Boolean(process.env.CI); // set by GitHub Actions: a shared runner is slower than a laptop, which is no regression

export const eq = (a, b, m = '') => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) {
    throw new Error(`${m} expected ${B} got ${A}`);
  }
};
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
    const start = Date.now();
    await fn();
    const took = Date.now() - start;
    if (!slow && took > FAST_BUDGET_MS) {
      const message = `took ${took} ms, over the fast-tier budget of ${FAST_BUDGET_MS} ms: mark it slow (t.slow / ta.slow)`;
      if (!BUDGET_ONLY_WARNS) {
        throw new Error(message);
      }
      console.warn(`warning: ${name}: ${message}`);
    }
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

// For a file that calls node:test itself: test(name, FAST, fn) or test(name, SLOW, fn) puts the test in its tier.
export const FAST = TIER === 'slow' ? { skip: 'fast tier' } : {};
export const SLOW = TIER === 'fast' ? { skip: 'slow tier: npm run test:slow' } : {};
