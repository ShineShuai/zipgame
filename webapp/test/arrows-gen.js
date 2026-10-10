// Tests of the "One way arrows" generator (gen/arrows.js). Registered by tests.js:
// arrowsGenTests(t, ok, eq).
import { validate, maxNumber, makePuzzle } from '../src/core/model.js';
import { arrowIds, arrowDirId, pathEdgeIds, setArrowId, wallCount } from '../src/core/edges.js';
import { solve } from '../src/core/solver/solve.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';
import {
  generateArrows, makeUniqueArrows, tryRemoveArrow, ARROW_MIN_ARROWS,
} from '../src/core/gen/arrows.js';
import { backbite } from '../src/core/gen/hampath.js';
import { gapCheckpoints } from '../src/core/gen/checkpoints.js';

const make = (n, seed, o = {}) => runSync(generateArrows(n, seed, { candidates: 3, ...o }));
const solutions = (p, opts = {}) => solve(p, { limit: 2, capture: true, nodeCap: 5e6, ...opts });

export function arrowsGenTests(t, ok, eq) {
  t('generateArrows: valid, wall-free, one solution = p.path (propagation on and off)', () => {
    for (const [n, seed] of [[5, 1], [5, 2], [6, 3], [6, 4], [7, 5]]) {
      const p = make(n, seed);
      const tag = `n ${n} seed ${seed}`;
      ok(validate(p).ok, `${tag}: ${validate(p).msg}`);
      eq(wallCount(p), 0, `${tag}: walls`);
      ok(arrowIds(p).length >= ARROW_MIN_ARROWS, `${tag}: arrows`);
      const k = maxNumber(p);
      ok(k >= 3 && k <= Math.round(0.2 * n * n), `${tag}: K ${k}`);
      for (const prop of n <= 6 ? [true, false] : [true]) {
        const r = solutions(p, { prop });
        eq(r.count, 1, `${tag} prop ${prop}: solutions`);
        eq(r.paths[0], p.path, `${tag} prop ${prop}: the planted path`);
      }
    }
  });

  t('generateArrows: every arrow is necessary (removing any gives a second solution)', () => {
    let checked = 0;
    for (const [n, seed] of [[5, 11], [6, 12], [6, 13], [7, 14], [7, 15]]) {
      const p = make(n, seed);
      for (const e of arrowIds(p)) {
        const dir = arrowDirId(p.arrows, e);
        setArrowId(p.arrows, e, 0);
        const r = solutions(p);
        setArrowId(p.arrows, e, dir);
        ok(r.count >= 2, `n ${n} seed ${seed}: arrow on edge ${e} is redundant`);
        checked++;
      }
    }
    ok(checked >= 15, `${checked} arrows checked`);
  });

  t('generateArrows: pathArrows = false keeps the solution\'s edges free of arrows', () => {
    for (const [n, seed] of [[5, 21], [6, 22], [7, 23]]) {
      const p = make(n, seed, { pathArrows: false });
      const onPath = new Set(pathEdgeIds(n, p.path));
      for (const e of arrowIds(p)) ok(!onPath.has(e), `n ${n} seed ${seed}: arrow on a path edge`);
      eq(solutions(p).count, 1, `n ${n} seed ${seed}`);
    }
    const withPath = [31, 32, 33, 34].some(seed => {
      const p = make(6, seed);
      const onPath = new Set(pathEdgeIds(6, p.path));
      return arrowIds(p).some(e => onPath.has(e));
    });
    ok(withPath, 'by default some arrow sits on the solution (and points along it)');
  });

  t('generateArrows: same seed, same puzzle; progress events behave', () => {
    const a = make(6, 41);
    const b = make(6, 41);
    eq(Array.from(a.cp), Array.from(b.cp));
    eq(Array.from(a.arrows), Array.from(b.arrows));
    const events = [];
    const p = runSync(generateArrows(5, 42, { candidates: 3 }), ev => events.push(ev));
    ok(events.length > 3);
    const counts = events.map(ev => ev.arrows).filter(x => x !== null && x !== undefined);
    for (let i = 1; i < counts.length; i++) {
      ok(counts[i] <= counts[i - 1], `arrows rose at event ${i}`);
    }
    const fracs = events.map(ev => ev.frac).filter(x => x !== null && x !== undefined);
    ok(fracs.every(x => x >= 0 && x <= 1), 'frac in [0, 1]');
    eq(events[events.length - 1], { frac: 1, arrows: arrowIds(p).length, K: maxNumber(p) });
  });

  t('tryRemoveArrow: both checks keep a needed arrow, accept a spare one', () => {
    for (const [n, seed] of [[5, 51], [6, 52], [6, 53]]) {
      const p = make(n, seed);
      const before = Array.from(p.arrows);
      for (const e of arrowIds(p)) {
        for (const freedEdge of [true, false]) {
          const r = tryRemoveArrow(p, e, 5e6, freedEdge);
          const tag = `n ${n} seed ${seed} edge ${e} ${freedEdge}`;
          eq([r.removable, r.capped], [false, false], tag);
          eq(Array.from(p.arrows), before, 'a refused removal puts the arrow back');
        }
      }
      // an arrow on an edge the solution does not use cannot hurt it: spare, and removable again
      const onPath = new Set(pathEdgeIds(n, p.path));
      const spare = [...Array(2 * n * n).keys()].find(e => {
        const exists = e & 1 ? (e >> 1) + n < n * n : ((e >> 1) % n) + 1 < n;
        return exists && !onPath.has(e) && arrowDirId(p.arrows, e) === 0;
      });
      setArrowId(p.arrows, spare, -1);
      eq(solutions(p).count, 1, 'still unique with the extra arrow');
      for (const freedEdge of [true, false]) {
        const r = tryRemoveArrow(p, spare, 5e6, freedEdge);
        eq(r.removable, true, `n ${n} seed ${seed} spare ${spare} ${freedEdge}`);
        eq(arrowDirId(p.arrows, spare), 0);
        setArrowId(p.arrows, spare, -1);
      }
    }
  });

  t('makeUniqueArrows: unique with the anchor path as the only solution, or null', () => {
    let built = 0;
    for (let seed = 61; seed <= 70; seed++) {
      const n = 5;
      const rnd = makeRng(seed);
      const path = backbite(n, rnd);
      const p = makePuzzle(n);
      gapCheckpoints(n, path, 4).forEach((q, i) => {
        p.cp[path[q]] = i + 1;
      });
      p.arrows = new Uint8Array(n * n);
      const cfg = { nodeCap: 200000, seedFraction: 0.4, K: 4, pathArrows: seed % 2 === 0 };
      const order = runSync(makeUniqueArrows(p, path, rnd, cfg));
      if (order === null) continue;
      built++;
      const r = solutions(p);
      eq([r.count, r.paths[0]], [1, path], `seed ${seed}`);
      eq(arrowIds(p).length, order.length, `seed ${seed}: the order lists every arrow`);
    }
    ok(built >= 6, `${built} of 10 attempts built a puzzle`);
  });
}
