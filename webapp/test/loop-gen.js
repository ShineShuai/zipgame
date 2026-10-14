// Tests of the Loop generator: the ring (gen/hampath.js ringPath), the numbers on it
// (gen/checkpoints.js loopCheckpoints) and generateLoop (gen/loop.js). Registered by tests.js:
// loopGenTests(t, ok, eq).
import { validate, maxNumber, labelCount } from '../src/core/model.js';
import { isSolved } from '../src/core/rules.js';
import { serialize } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { ringPath } from '../src/core/gen/hampath.js';
import { loopCheckpoints, LOOP_TAIL } from '../src/core/gen/checkpoints.js';
import { generateLoop, LOOP_SIZES } from '../src/core/gen/loop.js';
import { generate } from '../src/core/gen/generate.js';
import { runSync } from '../src/core/run.js';
import { gridAdjacent } from '../src/core/rules.js';
import { makeRng } from '../src/core/rng.js';
import { bruteLoop } from './loop.js';

const isRing = (n, ring) => {
  if (ring.length !== n * n || new Set(ring).size !== n * n) return false;
  for (let i = 0; i < ring.length; i++) {
    if (!gridAdjacent(n, ring[i], ring[(i + 1) % ring.length])) return false;
  }
  return true;
};

export function loopGenTests(t, ok, eq) {
  t('loop-gen: ringPath is a Hamiltonian cycle of the grid, seeded, even sizes only', () => {
    for (const n of [2, 4, 6, 8, 12, 16]) {
      for (let seed = 1; seed <= 5; seed++) {
        const ring = ringPath(n, makeRng(seed));
        ok(isRing(n, ring), `n ${n} seed ${seed}`);
        eq(ringPath(n, makeRng(seed)), ring, 'same seed, same ring');
      }
    }
    ok(ringPath(8, makeRng(1)).join() !== ringPath(8, makeRng(2)).join(), 'seeds differ');
    let threw = false;
    try {
      ringPath(5, makeRng(1));
    } catch {
      threw = true;
    }
    ok(threw, 'odd size');
  });

  t('loop-gen: loopCheckpoints — cell 1 first, number K short of the way round, a tail between K and cell 1', () => {
    for (const n of [4, 6, 8, 10]) {
      for (let seed = 1; seed <= 6; seed++) {
        const rnd = makeRng(seed);
        const ring = ringPath(n, rnd);
        const K = Math.max(4, n);
        const placed = loopCheckpoints(n, ring, K, rnd);
        if (!placed) continue;
        const { path, positions } = placed;
        const T = n * n;
        ok(isRing(n, path) && positions.length === K && positions[0] === 0, `n ${n} seed ${seed}`);
        ok(positions.every((q, i) => i === 0 || q > positions[i - 1]), 'ascending');
        const tail = T - 1 - positions[K - 1];
        ok(tail >= Math.round(T * LOOP_TAIL[0]) - 1 && tail <= Math.round(T * LOOP_TAIL[1]) - 1, `tail ${tail} of ${T}`);
      }
    }
  });

  t('loop-gen: generateLoop gives a valid, unique Loop puzzle with a solving path, K not on the last cell', () => {
    for (const [n, seeds] of [[4, [1, 2, 3, 4]], [6, [1, 2, 3, 4]], [8, [1, 2]]]) {
      for (const seed of seeds) {
        const p = runSync(generateLoop(n, seed));
        const label = `n ${n} seed ${seed}`;
        ok(p.loop === true && validate(p).ok, label);
        ok(maxNumber(p) >= 3 && labelCount(p) === maxNumber(p), label);
        ok(isSolved(p, p.path), `${label}: the stored path solves it`);
        const K = maxNumber(p);
        ok(p.path[p.path.length - 1] !== p.cp.indexOf(K), `${label}: K is not the last cell`);
        const found = solve(p, { limit: 2, nodeCap: 5e6, capture: true, prop: true, parity: true });
        ok(found.count === 1 && !found.exceeded, `${label}: unique`);
        eq(found.paths[0], p.path, `${label}: the solver finds the same ring`);
      }
    }
  });

  t('loop-gen: generated puzzles are unique by brute force too (4x4 and 6x6)', () => {
    for (const [n, seeds] of [[4, [11, 12, 13]], [6, [11, 12]]]) {
      for (const seed of seeds) {
        const p = runSync(generateLoop(n, seed));
        const all = bruteLoop(p);
        eq(all.length, 1, `n ${n} seed ${seed}`);
        eq(all[0], p.path);
      }
    }
  });

  t('loop-gen: same seed, same puzzle; other seeds, other puzzles; a standard puzzle is unchanged by the option', () => {
    const a = serialize(runSync(generateLoop(6, 5)));
    eq(serialize(runSync(generateLoop(6, 5))), a);
    ok(serialize(runSync(generateLoop(6, 6))) !== a);
    ok(!('loop' in runSync(generate(5, 1))));
  });

  t('loop-gen: only even sizes; the sizes on offer', () => {
    let threw = false;
    try {
      runSync(generateLoop(7, 1));
    } catch {
      threw = true;
    }
    ok(threw);
    eq(LOOP_SIZES, [6, 8, 10, 12]);
  });
}
