// Tests of the Teleport generator (core/gen/portals.js, gen/teleport.js, and the Teleport options
// of gen/generate.js,
// gen/checkpoints.js, gen/walls.js) and of its use by the design app (generateUnique /
// randomPathPuzzle with pairs).
// Registered by tests.js: teleportGenTests(t, ok, eq).
import { validate, maxNumber } from '../src/core/model.js';
import { serialize } from '../src/core/format.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import { isSolved } from '../src/core/rules.js';
import { adjacent, gridDist, isPortalPair } from '../src/core/geom.js';
import { generate, generateUnique, randomPathPuzzle } from '../src/core/gen/generate.js';
import { generateTeleport, TELEPORT_SIZES } from '../src/core/gen/teleport.js';
import {
  pairCount, pickPortals, teleportPath, usesEveryPortal, maxPortalPairs, PORTAL_MIN_DIST,
  teleportCheckpointRules,
} from '../src/core/gen/portals.js';
import { gapCheckpoints } from '../src/core/gen/checkpoints.js';

const game = (n, seed, o = {}) => runSync(generateTeleport(n, seed, o));
const usedPortals = p => p.portals.filter(pair => p.path.some(
  (cell, i) => i > 0 && isPortalPair([pair], p.path[i - 1], cell),
));

// A path is a Hamiltonian path of the grid plus the portal edges.
const isTeleportPath = (n, path, portals) => {
  if (path.length !== n * n || new Set(path).size !== n * n) return false;
  return path.every((cell, i) => i === 0 || adjacent(n, false, path[i - 1], cell)
    || isPortalPair(portals, path[i - 1], cell));
};

export function teleportGenTests(t, ok, eq) {
  t('teleport-gen: pairCount — 1 pair on 5 and 6 (no random draw), 1 or '
    + '2 from 7, 2 likelier with the difficulty', () => {
    const never = () => { throw new Error('no random draw below 7'); };
    for (const n of [4, 5, 6]) eq(pairCount(n, never), 1, `n=${n}`);
    const draw = (n, level) => {
      const rnd = makeRng(100 + n);
      const seen = { 1: 0, 2: 0 };
      for (let i = 0; i < 400; i++) seen[pairCount(n, rnd, level)]++;
      return seen;
    };
    for (const n of [7, 8, 9]) {
      const mid = draw(n);
      ok(mid[1] > 40 && mid[2] > 40 && mid[1] + mid[2] === 400,
        `n=${n}: both counts happen ${JSON.stringify(mid)}`);
    }
    ok(draw(8, 5)[2] > draw(8, 0)[2] + 60, 'the harder the more second pairs');
  });

  t('teleport-gen: pickPortals — distinct cells, odd distance of at '
    + 'least 3, canonical, repeatable, null when impossible', () => {
    for (const [n, count] of [[5, 1], [6, 1], [7, 2], [9, 3], [12, 6]]) {
      for (let seed = 1; seed <= 25; seed++) {
        const portals = pickPortals(n, count, makeRng(seed));
        eq(portals.length, count);
        eq(new Set(portals.flat()).size, 2 * count, 'distinct cells');
        for (const [a, b] of portals) {
          ok(a < b, 'lower cell first');
          ok(gridDist(n, false, a, b) >= PORTAL_MIN_DIST && gridDist(n, false, a, b) % 2 === 1,
            `n=${n}: odd, far`);
        }
        ok(portals.every(([a], i) => i === 0 || portals[i - 1][0] < a),
          'sorted by the lower cell');
        eq(pickPortals(n, count, makeRng(seed)), portals, 'same seed, same pairs');
      }
    }
    eq(pickPortals(4, 20, makeRng(1)), null, 'no room for 20 pairs');
  });

  t('teleport-gen: teleportPath — a Hamiltonian path of grid plus '
    + 'portals through every pair, ends off the portals', () => {
    for (const n of [5, 6, 7, 8, 9]) {
      for (const count of [1, 2, 3]) {
        for (let seed = 1; seed <= 12; seed++) {
          const rnd = makeRng(1000 * n + 10 * count + seed);
          const portals = pickPortals(n, count, rnd);
          const path = teleportPath(n, portals, rnd);
          ok(path, `n=${n} pairs=${count} seed=${seed}: found`);
          ok(isTeleportPath(n, path, portals), 'a Hamiltonian path of the graph');
          ok(usesEveryPortal(path, portals), 'every pair is one step of the path');
          ok(!portals.flat().includes(path[0]) && !portals.flat().includes(path[n * n - 1]),
            'ends off the portals');
        }
      }
    }
    const snake5 = [0, 1, 2, 3, 4, 9, 8, 7, 6, 5, 10, 11, 12, 13, 14, 19, 18, 17, 16, 15,
      20, 21, 22, 23, 24];
    ok(!usesEveryPortal(snake5, [[1, 8]]),
      'a path that walks past a pair does not use it');
  });

  t('teleport-gen: gapCheckpoints with the teleport rules numbers no '
    + 'portal cell and spreads along the real distances', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const n = 7;
      const rnd = makeRng(seed);
      const portals = pickPortals(n, 2, rnd);
      const path = teleportPath(n, portals, rnd);
      const rules = teleportCheckpointRules(n, portals);
      const positions = gapCheckpoints(n, path, 8, false, rules);
      ok(positions && positions.length === 8, 'eight numbers');
      eq(positions[0], 0);
      eq(positions[positions.length - 1], n * n - 1);
      ok(positions.every(q => !rules.skip.has(path[q])), 'no number on a portal cell');
      ok(positions.every((q, i) => i === 0 || q > positions[i - 1]), 'increasing');
    }
  });

  t('teleport-gen: generateTeleport 5 to 9 — valid, unique, the one '
    + 'solution is the planted path and uses every portal', () => {
    eq(TELEPORT_SIZES, [5, 6, 7, 8, 9]);
    for (const n of TELEPORT_SIZES) {
      for (const seed of n >= 8 ? [3] : [3, 4]) {
        const p = game(n, seed);
        ok(validate(p).ok, `n=${n} seed=${seed}: valid`);
        ok(p.portals.length >= 1 && p.portals.length <= (n >= 7 ? 2 : 1),
          `n=${n}: ${p.portals.length} pair(s)`);
        const r = solve(p, { limit: 2, nodeCap: 5e7, prop: true, capture: true });
        ok(!r.exceeded && r.count === 1, `n=${n} seed=${seed}: one solution`);
        eq(r.paths[0], p.path, 'the solution is the planted path');
        ok(isSolved(p, p.path));
        eq(usedPortals(p).length, p.portals.length, 'every portal is used by the solution');
        ok(p.portals.flat().every(cell => !p.cp[cell]), 'no number on a portal');
        ok(maxNumber(p) >= Math.min(n, 5), 'a reasonable number of checkpoints');
        eq(solve(p, { limit: 2, nodeCap: 5e7, prop: true, parity: true, pocket: true }).count, 1,
          'also with parity and pocket pruning');
      }
    }
  });

  t('teleport-gen: same seed, same puzzle; another seed, another one; '
    + 'o.pairs sets the count', () => {
    eq(serialize(game(6, 7)), serialize(game(6, 7)));
    ok(serialize(game(6, 7)) !== serialize(game(6, 8)));
    const three = game(8, 5, { pairs: 3 });
    eq(three.portals.length, 3);
    ok(validate(three).ok && solve(three, { limit: 2, nodeCap: 5e7, prop: true }).count === 1,
      'three pairs, unique');
    const one = game(8, 5, { pairs: 1 });
    eq(one.portals.length, 1);
  });

  t('teleport-gen: generate() refuses what a Teleport board cannot be, '
    + 'and plain generation is untouched', () => {
    const throws = f => { try { f(); return false; } catch { return true; } };
    ok(throws(() => runSync(generate(3, 1, { teleport: true }))), 'n < 4');
    ok(throws(() => runSync(generate(6, 1, { teleport: true, wrap: true }))), 'with wrap');
    ok(throws(() => runSync(generate(6, 1, { teleport: true, loop: true }))), 'with loop');
    const plain = runSync(generate(6, 9));
    ok(!plain.portals, 'a standard puzzle has no portals');
  });

  t('teleport-gen: design app — randomPathPuzzle and generateUnique with pairs', () => {
    for (const pairs of [1, 2, 3]) {
      const p = randomPathPuzzle(7, 7, makeRng(pairs), false, false, pairs);
      eq(p.portals.length, pairs);
      ok(validate(p).ok, 'valid');
      ok(p.path && isTeleportPath(7, p.path, p.portals) && isSolved(p, p.path),
        'the template path solves it');
    }
    // more pairs than fit: fewer are made
    const crowded = randomPathPuzzle(4, 4, makeRng(5), false, false, 9);
    ok(crowded.portals.length >= 1 && crowded.portals.length <= maxPortalPairs(4, 4),
      `crowded 4x4: ${crowded.portals.length}`);
    eq(maxPortalPairs(4, 4), 3);
    eq(maxPortalPairs(3, 9), 1, 'at least one');
    const r = runSync(generateUnique(7, 8, makeRng(5), { maxWalls: 6, tries: 20, pairs: 2 }));
    ok(r.unique, 'found a unique puzzle');
    eq(r.puzzle.portals.length, 2);
    eq(solve(r.puzzle, { limit: 2, nodeCap: 5e7, prop: true }).count, 1);
    const none = randomPathPuzzle(6, 6, makeRng(3));
    ok(!none.portals, 'without pairs: a standard puzzle');
    const throws = f => { try { f(); return false; } catch { return true; } };
    ok(throws(() => runSync(generateUnique(7, 6, makeRng(1), { pairs: 1, wrap: true }))),
      'no pairs with wrap');
  });
}
