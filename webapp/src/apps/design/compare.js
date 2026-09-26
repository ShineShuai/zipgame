import { makeRng } from '../../core/rng.js';
import { generateUnique } from '../../core/gen/generate.js';
import { runAsync } from '../../platform/run.js';

// Runs generateUnique twice — once with flagsA, once with flagsB — at the same rnd seed, so the
// only difference between the two runs is the flags (see generateUnique's flags param, gen/flags.js).
// Caveat (same as the old leg-collision-only compare): both runs start from an identical rnd
// sequence, but once a solve() outcome differs between them, the walls placed and thus how much of
// the rnd sequence gets consumed can diverge too — an honest same-seed comparison up to the first
// point they behave differently, not a guarantee every later attempt lines up between the two runs.
//
// o: { n, K, maxWalls, tries, hardest, seed, flagsA, flagsB, onEvent(side, event) }
// Returns { seed, msA, msB, a, b } where a/b are generateUnique's own return shape.
export async function runCompare(o) {
  const seed = o.seed;
  const t0 = performance.now();
  const a = await runAsync(generateUnique(o.n, o.K, makeRng(seed), { maxWalls: o.maxWalls, tries: o.tries, hardest: o.hardest, flags: o.flagsA }),
    { onEvent: e => o.onEvent && o.onEvent('A', e) });
  const msA = performance.now() - t0;
  const t1 = performance.now();
  const b = await runAsync(generateUnique(o.n, o.K, makeRng(seed), { maxWalls: o.maxWalls, tries: o.tries, hardest: o.hardest, flags: o.flagsB }),
    { onEvent: e => o.onEvent && o.onEvent('B', e) });
  const msB = performance.now() - t1;
  return { seed, msA, msB, a, b };
}
