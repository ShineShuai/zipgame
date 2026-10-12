// Tests of the Exact puzzle generator (core/gen/exact.js). Registered by tests.js:
// exactGenTests(t, ok, eq).
import {
  validate, labelCount, cellCount, startCell, endCell,
} from '../src/core/model.js';
import { isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver/solve.js';
import {
  generateExact, fullExactPuzzle, tryRemoveLabel, minimizeLabels, refineLabels, EXACT_SIZES,
  EXACT_CANDIDATES, EXACT_REFINE_CAP_X,
} from '../src/core/gen/exact.js';
import { backbite } from '../src/core/gen/hampath.js';
import { runSync } from '../src/core/run.js';
import { makeRng } from '../src/core/rng.js';

const CHECK = { limit: 2, nodeCap: 5e6, prop: true, parity: true };

// The interior numbers of p (not 1, not the cell count): their cells.
const interior = p => [...p.cp.keys()].filter(c => p.cp[c] > 1 && p.cp[c] < cellCount(p));

export function exactGenTests(t, ok, eq) {
  t('exact gen: puzzles are valid, unique, wall-free, solved by their path, 1 and the end', () => {
    for (const [n, seed] of [[5, 1], [5, 2], [6, 3], [6, 4], [7, 5], [7, 6], [8, 7], [8, 8]]) {
      const p = runSync(generateExact(n, seed));
      const tag = `n=${n} seed=${seed}`;
      eq(validate(p).ok, true, tag);
      const plain = [p.exact, p.seed, p.walls.some(Boolean), !!p.holes, !!p.arrows];
      eq(plain, [true, seed, false, false, false], tag);
      const r = solve(p, CHECK);
      eq([r.count, r.exceeded], [1, false], tag);
      eq(isSolved(p, p.path), true, tag);
      const ends = [p.cp[startCell(p)], p.cp[endCell(p)], endCell(p) === p.path[n * n - 1]];
      eq(ends, [1, n * n, true], tag);
      ok(labelCount(p) >= 2 && labelCount(p) < n * n / 2, `${tag}: ${labelCount(p)} numbers`);
    }
  });

  t('exact gen: no number can be taken off (each interior number is needed), 5x5 to 7x7', () => {
    for (const [n, seed] of [[5, 11], [5, 12], [6, 13], [6, 14], [7, 15], [7, 16]]) {
      const p = runSync(generateExact(n, seed));
      for (const cell of interior(p)) {
        const step = p.cp[cell];
        p.cp[cell] = 0;
        const r = solve(p, CHECK);
        p.cp[cell] = step;
        eq([r.count, r.exceeded], [2, false], `n=${n} seed=${seed} number ${step}`);
      }
    }
  });

  t('exact gen: same seed, same puzzle; other seeds, other ones; the floor adds numbers', () => {
    const a = runSync(generateExact(6, 21));
    const b = runSync(generateExact(6, 21));
    eq([...a.cp], [...b.cp]);
    eq(a.path, b.path);
    const others = [22, 23, 24].map(seed => [...runSync(generateExact(6, seed)).cp].join());
    ok(others.some(cp => cp !== [...a.cp].join()), 'seeds differ');
    const floored = runSync(generateExact(6, 21, { floor: labelCount(a) + 3 }));
    eq(labelCount(floored), labelCount(a) + 3, 'stops at the floor');
    const r = solve(floored, CHECK);
    eq([r.count, r.exceeded, validate(floored).ok], [1, false, true]);
    const big = runSync(generateExact(5, 21, { floor: 99 }));
    eq(labelCount(big), 25, 'a floor above the cell count keeps every number');
  });

  t('exact gen: progress stays inside 0..1 and rises, numbers never increase, end matches', () => {
    const fracs = [];
    const counts = [];
    const gen = generateExact(7, 31);
    let step = gen.next();
    for (; !step.done; step = gen.next()) {
      fracs.push(step.value.frac);
      counts.push(step.value.labels);
    }
    ok(fracs.every(f => f >= 0 && f <= 1), 'frac in range');
    ok(fracs.every((f, i) => i === 0 || f >= fracs[i - 1] - 1e-9), 'frac rises');
    ok(counts.every((c, i) => i === 0 || c <= counts[i - 1]), 'numbers never increase');
    eq([fracs[fracs.length - 1], counts[counts.length - 1]], [1, labelCount(step.value)]);
  });

  t('exact gen: tryRemoveLabel removes an unneeded number, keeps a needed one, sees caps', () => {
    const path = backbite(5, makeRng(5));
    const full = fullExactPuzzle(5, path);
    eq([labelCount(full), full.exact, isSolved(full, path)], [25, true, true]);
    const cell = path[10];
    const r = tryRemoveLabel(full, cell, 1e6);
    eq([r.removable, r.capped, full.cp[cell]], [true, false, 0]);
    const p = runSync(generateExact(5, 41));
    const needed = interior(p)[0];
    const step = p.cp[needed];
    const kept = tryRemoveLabel(p, needed, 1e6);
    eq([kept.removable, kept.capped, p.cp[needed]], [false, false, step], 'put back');
    const capped = tryRemoveLabel(p, needed, 1);
    const tiny = [capped.removable, capped.capped, p.cp[needed]];
    eq(tiny, [false, true, step], 'a cap of 1 node decides nothing');
  });

  t('exact gen: minimizeLabels keeps a unique puzzle, honours floor and bound, keeps ends', () => {
    const rnd = makeRng(7);
    const path = backbite(6, rnd);
    const p = fullExactPuzzle(6, path);
    const r = runSync(minimizeLabels(p, path.slice(1, -1), rnd, 1e5));
    eq([r.kept, labelCount(p), r.removed], [labelCount(p), labelCount(p), 36 - labelCount(p)]);
    eq([p.cp[path[0]], p.cp[path[35]], r.uncertain.length], [1, 36, 0]);
    eq(solve(p, CHECK).count, 1);
    const rnd2 = makeRng(7);
    const path2 = backbite(6, rnd2);
    const q = fullExactPuzzle(6, path2);
    const f = runSync(minimizeLabels(q, path2.slice(1, -1), rnd2, 1e5, { floor: 10 }));
    eq([f.kept, labelCount(q)], [10, 10]);
    const rnd3 = makeRng(7);
    const path3 = backbite(6, rnd3);
    const w = fullExactPuzzle(6, path3);
    const b = runSync(minimizeLabels(w, path3.slice(1, -1), rnd3, 1e5, { bound: 3 }));
    eq([b.aborted, b.kept], [true, Infinity]);
  });

  t('exact gen: refineLabels decides what a small cap left open; the puzzle stays unique', () => {
    const rnd = makeRng(9);
    const path = backbite(7, rnd);
    const p = fullExactPuzzle(7, path);
    const first = runSync(minimizeLabels(p, path.slice(1, -1), rnd, 25));
    ok(first.uncertain.length > 0, 'a cap of 25 nodes leaves numbers undecided');
    const caps = EXACT_REFINE_CAP_X.map(x => x * 2000);
    const opts = { caps, budget: 5e6, labels: first.kept };
    const second = runSync(refineLabels(p, first.uncertain, rnd, opts));
    eq([second.kept, labelCount(p)], [first.kept - second.removed, first.kept - second.removed]);
    ok(second.removed > 0, 'some are decided');
    eq([second.left.length, solve(p, CHECK).count], [0, 1]);
    const none = runSync(refineLabels(p, [], rnd, { caps, budget: 100, labels: 5 }));
    eq([none.removed, none.nodes], [0, 0]);
  });

  t('exact gen: more candidates never leave more numbers, and often fewer (same seed)', () => {
    let fewer = 0;
    for (let seed = 61; seed <= 70; seed++) {
      const one = labelCount(runSync(generateExact(7, seed, { candidates: 1, refineNodes: 0 })));
      const many = labelCount(runSync(generateExact(7, seed, { candidates: 8, refineNodes: 0 })));
      ok(many <= one, `seed ${seed}: ${many} against ${one}`);
      if (many < one) fewer++;
    }
    ok(fewer >= 3, `fewer numbers in ${fewer} of 10`);
  });

  t('exact gen: the offered sizes and their candidate counts', () => {
    eq(EXACT_SIZES, [5, 6, 7, 8, 9, 10, 11, 12]);
    ok(EXACT_SIZES.every(n => EXACT_CANDIDATES[n] > 0));
    const p = runSync(generateExact(9, 51, { candidates: 1, refineNodes: 0 }));
    eq([validate(p).ok, solve(p, CHECK).count], [true, 1]);
  });
}
