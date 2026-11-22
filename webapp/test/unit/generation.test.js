// Unit tests of generation: generate, generateUnique, flags, wall minimising.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import {
  makePuzzle,
  clonePuzzle,
  validate,
  maxNumber,
  ALGO_VERSION,
} from '../../src/core/model.js';
import { allEdges, setWallId, hasWallId, wallCount } from '../../src/core/edges.js';
import { serialize } from '../../src/core/format.js';
import { makeRng, hashStr } from '../../src/core/rng.js';
import { solve } from '../../src/core/solver/solve.js';
import { isSolved } from '../../src/core/rules.js';
import {
  generate,
  generateUnique,
  randomPathPuzzle,
  pickK,
  PLAY_SIZES,
  tryGenerate,
  PROP_CAP_X,
} from '../../src/core/gen/generate.js';
import { scatter } from '../../src/core/gen/checkpoints.js';
import {
  encodeFlags,
  decodeFlags,
  flagsToHex,
  hexToFlags,
  DEFAULT_FLAGS_INT,
  DEFAULT_GEN_FLAGS,
  DEFAULT_MINIMIZE_FLAGS,
  PLAY_FLAGS_INT,
} from '../../src/core/gen/flags.js';
import {
  minimizeWalls,
  makeUnique,
  refineWalls,
  minimizeFully,
  REFINE_CAP_X,
} from '../../src/core/gen/walls.js';
import { runSync } from '../../src/core/run.js';
import { GOLDEN } from '../golden.js';
import { FAST, SLOW } from '../harness.js';

test(
  'generate: ALGO_VERSION 6 golden puzzles cover every play size below 16 and are valid and unique',
  SLOW,
  () => {
    // compat pin: bump with the golden puzzles (README)
    assert.deepStrictEqual(ALGO_VERSION, 6);
    for (const n of PLAY_SIZES.filter(size => size < 16)) {
      assert.ok(
        GOLDEN.some(([size]) => size === n),
        `no golden puzzle for play size ${n}`,
      );
    }
    for (const [n, seed, hash] of GOLDEN) {
      const p = runSync(generate(n, seed));
      assert.deepStrictEqual(hashStr(serialize(p)), hash, `v6 n=${n} seed=${seed}`);
      assert.deepStrictEqual(validate(p).ok, true, `valid n=${n} seed=${seed}`);
      assert.deepStrictEqual(isSolved(p, p.path), true, `anchor path n=${n} seed=${seed}`);
      assert.deepStrictEqual(
        solve(p, { limit: 2, nodeCap: 5e6, prop: true }).count,
        1,
        `unique n=${n} seed=${seed}`,
      );
    }
  },
);

test(
  'generate: progress events only move forward (frac up, walls down) and end at 1',
  FAST,
  () => {
    const events = [];
    runSync(generate(7, 5), e => events.push(e));
    assert.ok(events.length > 0, 'no events');
    let frac = 0;
    let walls = Infinity;
    for (const e of events) {
      if (e.frac != null) {
        assert.ok(e.frac >= frac, `frac went back from ${frac} to ${e.frac}`);
        frac = e.frac;
      }
      if (e.walls != null) {
        assert.ok(e.walls <= walls, `walls went up from ${walls} to ${e.walls}`);
        walls = e.walls;
      }
    }
    assert.deepStrictEqual(frac, 1);
  },
);

test(
  'generate: more candidates never give a puzzle with more walls than the first candidate alone',
  FAST,
  () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const one = wallCount(runSync(generate(7, seed, { candidates: 1 })));
      const many = wallCount(runSync(generate(7, seed, { candidates: 6 })));
      assert.ok(many <= one, `seed ${seed}: ${many} walls with 6 candidates vs ${one} with 1`);
    }
  },
);

test(
  'pickK: deterministic, always in range, uses 2 rnd values, mode near 30% of the range',
  FAST,
  () => {
    const Kmin = 9;
    const Kmax = 20;
    assert.deepStrictEqual(pickK(Kmin, Kmax, makeRng(7)), pickK(Kmin, Kmax, makeRng(7)));

    let draws = 0;
    const rng = makeRng(3);
    pickK(Kmin, Kmax, () => {
      draws++;
      return rng();
    });
    assert.deepStrictEqual(draws, 2);

    const rnd = makeRng(1);
    const counts = {};
    for (let i = 0; i < 20000; i++) {
      const k = pickK(Kmin, Kmax, rnd);
      assert.ok(k >= Kmin && k <= Kmax, `k=${k} outside [${Kmin}, ${Kmax}]`);
      counts[k] = (counts[k] || 0) + 1;
    }
    const mode = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]);
    assert.ok(
      Math.abs(mode - (Kmin + 0.3 * (Kmax - Kmin))) <= 1,
      `mode ${mode} is not near 30% of the range`,
    );
    assert.deepStrictEqual(pickK(5, 6, makeRng(2)) >= 5, true); // a two-value range still works
  },
);

test('generate: unique, anchor path valid, progress events, same-seed determinism', FAST, () => {
  let ev = 0,
    last = null;
  const p = runSync(generate(5, 77), e => {
    ev++;
    last = e;
  });
  assert.deepStrictEqual(validate(p).ok, true);
  assert.deepStrictEqual(isSolved(p, p.path), true);
  assert.deepStrictEqual(solve(p, { limit: 2, nodeCap: 2e6 }).count, 1);
  assert.ok(ev > 0 && last.frac === 1);
  assert.deepStrictEqual(serialize(runSync(generate(5, 77))), serialize(p));
});

test('designer helpers: randomPathPuzzle, generateUnique, scatter', FAST, () => {
  const rnd = makeRng(5),
    a = randomPathPuzzle(6, 5, rnd);
  assert.deepStrictEqual(validate(a).max, 5);
  assert.deepStrictEqual(isSolved(a, a.path), true);
  const r = runSync(generateUnique(6, 5, rnd));
  assert.deepStrictEqual(r.unique, true);
  assert.deepStrictEqual(solve(r.puzzle, { nodeCap: 1e6 }).count, 1);
  const cp = scatter(makePuzzle(6), 7, rnd);
  assert.deepStrictEqual(
    [...cp].filter(Boolean).sort((x, y) => x - y),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

test(
  'generateUnique: maxWalls / K are hard bounds (feasible, tight, infeasible); unbounded call unchanged',
  FAST,
  () => {
    let tight = 0;
    for (let s = 1; s <= 12; s++) {
      // feasible: unique, <= K checkpoints, <= maxWalls, reported walls == actual walls
      const r = runSync(generateUnique(6, 6, makeRng(s), { maxWalls: 6 })),
        p = r.puzzle;
      assert.deepStrictEqual(r.unique, true, `seed ${s}`);
      assert.ok(
        wallCount(p) <= 6 && wallCount(p) === r.walls && maxNumber(p) === 6,
        `bounds seed ${s}`,
      );
      assert.deepStrictEqual(solve(p, { limit: 2, nodeCap: 2e6 }).count, 1);
      assert.deepStrictEqual(isSolved(p, p.path), true);
    }
    for (let s = 1; s <= 8; s++) {
      // maxWalls 0: unique only when the checkpoints alone force it; never a wall either way
      const r = runSync(generateUnique(6, 8, makeRng(s), { maxWalls: 0 }));
      assert.deepStrictEqual(wallCount(r.puzzle), 0);
      if (r.unique) {
        tight++;
        assert.deepStrictEqual(solve(r.puzzle, { limit: 2, nodeCap: 2e6 }).count, 1);
      }
    }
    assert.ok(tight > 0, 'no wall-free unique puzzle found');
    const bad = runSync(generateUnique(6, 2, makeRng(1), { maxWalls: 0 })); // infeasible: falls back inside the bounds, flagged non-unique
    assert.deepStrictEqual(
      [bad.unique, bad.walls, wallCount(bad.puzzle), maxNumber(bad.puzzle)],
      [false, 0, 0, 2],
    );
    const evs = [],
      f = runSync(generateUnique(6, 2, makeRng(3), { maxWalls: 0, tries: 3 }), e => evs.push(e)); // all 3 tries fail
    assert.deepStrictEqual([f.unique, f.attempts, wallCount(f.puzzle)], [false, 3, 0]);
    assert.ok(
      evs.length &&
        evs.every(e => e.of === 3 && e.attempt >= 1 && e.attempt <= 3) &&
        evs.some(e => e.attempt === 3),
      'attempt-tagged events',
    );
    const legacy = runSync(generateUnique(6, 5, makeRng(5)));
    assert.deepStrictEqual(legacy.unique, true);
    assert.ok(wallCount(legacy.puzzle) === legacy.walls, 'unbounded still exact');
  },
);

test(
  'generateUnique hardest: uses every try, keeps the max-node candidate, bounds still hold',
  FAST,
  () => {
    for (const seed of [1, 2, 3]) {
      const first = runSync(generateUnique(6, 6, makeRng(seed), { maxWalls: 6, tries: 12 })),
        evs = [];
      const h = runSync(
        generateUnique(6, 6, makeRng(seed), { maxWalls: 6, tries: 12, hardest: true }),
        e => evs.push(e),
      );
      assert.deepStrictEqual(h.unique, true);
      assert.ok(h.found >= 1 && h.attempts >= first.attempts, 'found/attempts');
      assert.ok(
        new Set(evs.map(e => e.attempt)).size === 12 &&
          evs.at(-1).attempt === 12 &&
          evs.at(-1).found === h.found,
        'all 12 tries used, candidate count reported',
      );
      assert.ok(
        wallCount(h.puzzle) <= 6 && wallCount(h.puzzle) === h.walls && maxNumber(h.puzzle) === 6,
        'bounds',
      );
      const nodes = q => solve(q, { limit: 2, nodeCap: 1e6, prop: true }).nodes;
      assert.deepStrictEqual(nodes(h.puzzle), h.nodes);
      assert.ok(
        h.nodes >= nodes(first.puzzle),
        'first candidate is among the candidates, so max >= first',
      );
      assert.deepStrictEqual(solve(h.puzzle, { limit: 2, nodeCap: 2e6 }).count, 1);
    }
    const none = runSync(
      generateUnique(6, 2, makeRng(1), { maxWalls: 0, tries: 2, hardest: true }),
    );
    assert.deepStrictEqual([none.unique, none.found, wallCount(none.puzzle)], [false, 0, 0]);
  },
);

test(
  'flags: encode/decode round trip (all-off, all-on, seg tri-state, path/cps, per-phase divergence)',
  FAST,
  () => {
    const off = {
      prop: false,
      legCollide: false,
      pocket: false,
      parity: false,
      prune2: false,
      seg: false,
    };
    assert.deepStrictEqual(
      decodeFlags(encodeFlags({ score: off, path: 'warnsdorff', cps: 'gap' })),
      {
        build: off,
        minimize: off,
        score: off,
        path: 'warnsdorff',
        cps: 'gap',
      },
    );
    const on = {
      prop: true,
      legCollide: true,
      pocket: true,
      parity: true,
      prune2: true,
      seg: 'all',
    };
    assert.deepStrictEqual(
      decodeFlags(encodeFlags({ score: on, path: 'backbite', cps: 'random' })),
      {
        build: on,
        minimize: on,
        score: on,
        path: 'backbite',
        cps: 'random',
      },
    );
    for (const seg of [false, true, 'all'])
      assert.deepStrictEqual(decodeFlags(encodeFlags({ score: { seg } })).score.seg, seg);
    // per-phase divergence: each phase keeps its own byte independently
    const build = {
      prop: true,
      legCollide: false,
      pocket: false,
      parity: false,
      prune2: false,
      seg: false,
    };
    const minimize = {
      prop: false,
      legCollide: true,
      pocket: false,
      parity: false,
      prune2: false,
      seg: true,
    };
    const score = {
      prop: true,
      legCollide: true,
      pocket: true,
      parity: false,
      prune2: true,
      seg: 'all',
    };
    const v = encodeFlags({ build, minimize, score, path: 'backbite', cps: 'gap' });
    assert.deepStrictEqual(decodeFlags(v), {
      build,
      minimize,
      score,
      path: 'backbite',
      cps: 'gap',
    });
    // single-phase encode (only `score` given, as the plain Solve button would) mirrors into build/minimize too
    assert.deepStrictEqual(decodeFlags(encodeFlags({ build: on })), {
      build: on,
      minimize: on,
      score: on,
      path: 'warnsdorff',
      cps: 'gap',
    });
    // hex round trip, both cases, plus bare-hex and decimal input
    assert.deepStrictEqual(hexToFlags(flagsToHex(v)), v);
    assert.deepStrictEqual(flagsToHex(0), '0x0');
    assert.deepStrictEqual(hexToFlags('0X' + v.toString(16).toUpperCase()), v);
    assert.deepStrictEqual(hexToFlags('ff'), 0xff);
    assert.deepStrictEqual(hexToFlags('123'), 123); // no a-f digit and no 0x prefix -> read as decimal
    assert.deepStrictEqual(hexToFlags('not-hex'), null);
    assert.deepStrictEqual(hexToFlags(''), null);
    assert.deepStrictEqual(hexToFlags('  '), null);
    // default constant matches generateUnique()'s actual defaults (prop on, rest off, backbite/gap; minimize also freedEdge)
    assert.deepStrictEqual(decodeFlags(DEFAULT_FLAGS_INT), {
      build: DEFAULT_GEN_FLAGS,
      minimize: DEFAULT_MINIMIZE_FLAGS,
      score: DEFAULT_GEN_FLAGS,
      path: 'backbite',
      cps: 'gap',
    });
  },
);

test(
  "generateUnique: o.flags with per-phase divergence actually reaches each phase's solve() calls, and o.flags overrides o.prop/o.legCollide",
  FAST,
  () => {
    // build=legCollide off, minimize=legCollide on: force it by giving minimize a tiny nodeCap that
    // only survives with legCollide's extra pruning, and confirm the run still succeeds end-to-end.
    const flags = {
      build: {
        prop: true,
        legCollide: false,
        seg: false,
        pocket: false,
        parity: false,
        prune2: false,
      },
      minimize: {
        prop: true,
        legCollide: true,
        seg: false,
        pocket: false,
        parity: false,
        prune2: false,
      },
      score: {
        prop: true,
        legCollide: true,
        seg: false,
        pocket: false,
        parity: false,
        prune2: false,
      },
      path: 'backbite',
      cps: 'gap',
    };
    const r = runSync(
      generateUnique(6, 6, makeRng(9), {
        maxWalls: 6,
        flags,
        prop: false /* must be ignored: flags wins */,
      }),
    );
    assert.deepStrictEqual(r.unique, true);
    assert.deepStrictEqual(solve(r.puzzle, { limit: 2, nodeCap: 2e6 }).count, 1);
    // o.flags absent still behaves exactly like plain o.prop/o.legCollide (no regression path)
    const withProp = runSync(
      generateUnique(6, 6, makeRng(9), { maxWalls: 6, prop: true, legCollide: false }),
    );
    const withoutFlags = runSync(generateUnique(6, 6, makeRng(9), { maxWalls: 6 }));
    assert.deepStrictEqual(serialize(withProp.puzzle), serialize(withoutFlags.puzzle));
  },
);

test(
  'minimizeWalls: options-object form matches the legacy boolean-5th-arg form exactly (back-compat)',
  FAST,
  () => {
    const rnd1 = makeRng(4),
      a = randomPathPuzzle(6, 6, rnd1);
    for (let i = 0; i < 8; i++) setWallId(a.walls, i, true);
    const orderA = [...Array(8).keys()];
    const b = { n: a.n, cp: a.cp.slice(), walls: a.walls.slice() };
    const rndA = makeRng(1),
      rndB = makeRng(1);
    const legacy = runSync(minimizeWalls(a, orderA, rndA, 5000, maxNumber(a), true));
    const opts = runSync(minimizeWalls(b, orderA, rndB, 5000, maxNumber(b), { prop: true }));
    assert.deepStrictEqual(legacy, opts);
    assert.deepStrictEqual(serialize(a), serialize(b));
  },
);

// A puzzle that a tiny check cap leaves with many undecided walls, so the second look has work to do.
function undecidedSetup() {
  const rnd = makeRng(5),
    K = 9,
    p = randomPathPuzzle(9, K, rnd);
  const order = runSync(
    makeUnique(p, p.path, rnd, {
      nodeCap: 90000,
      wallBudget: null,
      seedFraction: 0.4,
      K,
      prop: true,
    }),
  );
  return { p, order, K, cap: 100 }; // 28 walls; a check cap of 100 leaves 18, 17 of them undecided (300000 leaves 14)
}

const necessaryWalls = p =>
  allEdges(p.n).every(w => {
    if (!hasWallId(p.walls, w)) return true;
    const q = clonePuzzle(p);
    setWallId(q.walls, w, false);
    return solve(q, { limit: 2, nodeCap: 5e6, prop: true }).count >= 2;
  });

test(
  'minimizeWalls: reports the walls kept only because a check hit its cap (uncertain); a generous cap leaves none',
  FAST,
  () => {
    const { p: p0, order, K, cap } = undecidedSetup();
    const small = clonePuzzle(p0),
      big = clonePuzzle(p0);
    const a = runSync(
      minimizeWalls(small, order, makeRng(3), cap, K, { prop: true, freedEdge: true }),
    );
    assert.ok(a.uncertain.length >= 2, 'the setup must leave undecided walls');
    assert.ok(
      a.uncertain.every(w => hasWallId(small.walls, w)),
      'an undecided wall is still a wall',
    );
    assert.ok(a.uncertain.length <= a.kept);
    const b = runSync(
      minimizeWalls(big, order, makeRng(3), 300000, K, { prop: true, freedEdge: true }),
    );
    assert.deepStrictEqual(b.uncertain, []);
    assert.ok(b.kept < a.kept, 'the big cap removes more');
    assert.ok(necessaryWalls(big), 'with no undecided wall left, every kept wall is necessary');
  },
);

test(
  'refineWalls: only undecided walls can go; the puzzle stays unique; budget is a node count that is respected',
  FAST,
  () => {
    const { p: p0, order, K, cap } = undecidedSetup();
    const p = clonePuzzle(p0);
    const a = runSync(
      minimizeWalls(p, order, makeRng(3), cap, K, { prop: true, freedEdge: true }),
    );
    const before = new Set(allEdges(p.n).filter(w => hasWallId(p.walls, w)));
    const events = [];
    const r = runSync(
      refineWalls(p, a.uncertain, makeRng(4), {
        caps: [600, 6000, 300000],
        prop: true,
        K,
        walls: a.kept,
      }),
      e => events.push(e),
    );
    assert.ok(r.removed > 0 && r.removed <= a.uncertain.length);
    assert.deepStrictEqual(r.kept, a.kept - r.removed);
    assert.deepStrictEqual(wallCount(p), r.kept);
    for (const w of allEdges(p.n))
      if (before.has(w) && !hasWallId(p.walls, w))
        assert.ok(a.uncertain.includes(w), 'removed a wall that was not undecided');
    const u = solve(p, { limit: 2, nodeCap: 5e6, prop: true });
    assert.deepStrictEqual([u.count, u.exceeded], [1, false]);
    assert.deepStrictEqual(r.left, []);
    assert.ok(necessaryWalls(p));
    assert.ok(
      events.length > 0 &&
        events.every(
          e => e.frac === null && e.K === K && Number.isInteger(e.walls) && e.nodes <= r.nodes,
        ),
      'events share the minimizeWalls shape',
    );
    assert.deepStrictEqual(events[events.length - 1].walls, r.kept);
    // a tiny budget stops early and leaves the rest undecided, never spending (much) more than the budget
    const q = clonePuzzle(p0);
    runSync(minimizeWalls(q, order, makeRng(3), cap, K, { prop: true, freedEdge: true }));
    const budget = 500,
      s = runSync(
        refineWalls(q, a.uncertain, makeRng(4), { caps: [600, 6000, 300000], prop: true, budget }),
      );
    assert.ok(s.left.length > 0 && s.nodes <= budget + a.uncertain.length, `nodes ${s.nodes}`);
    const w = solve(q, { limit: 2, nodeCap: 5e6, prop: true });
    assert.deepStrictEqual(w.count, 1);
    // no caps or no budget: nothing happens
    assert.deepStrictEqual(
      runSync(refineWalls(q, a.uncertain, makeRng(4), { caps: [], prop: true })).removed,
      0,
    );
    assert.deepStrictEqual(
      runSync(refineWalls(q, a.uncertain, makeRng(4), { caps: [6000], budget: 0, prop: true }))
        .removed,
      0,
    );
  },
);

test(
  'minimizeFully: no budget = minimizeWalls exactly; with a budget it reaches a puzzle whose kept walls are all necessary; maxKept skips pointless second looks',
  FAST,
  () => {
    const { p: p0, order, K, cap } = undecidedSetup();
    const o = { prop: true, freedEdge: true };
    const a = clonePuzzle(p0),
      b = clonePuzzle(p0);
    const ra = runSync(minimizeWalls(a, order, makeRng(3), cap, K, o)),
      rb = runSync(minimizeFully(b, order, makeRng(3), cap, K, o));
    assert.deepStrictEqual(ra, rb);
    assert.deepStrictEqual(serialize(a), serialize(b));
    // budget, with events of both phases
    const c = clonePuzzle(p0),
      seen = new Set();
    const rc = runSync(
      minimizeFully(c, order, makeRng(3), cap, K, {
        ...o,
        refineBudget: 1e8,
        refineCapX: [10, 100, 5000],
      }),
      e => seen.add(e.nodes == null ? 'first' : 'second'),
    );
    assert.deepStrictEqual([...seen].sort(), ['first', 'second']);
    assert.deepStrictEqual(rc.uncertain, []);
    assert.deepStrictEqual(rc.removed, ra.removed + (ra.kept - rc.kept));
    assert.deepStrictEqual(wallCount(c), rc.kept);
    assert.ok(rc.kept < ra.kept);
    const u = solve(c, { limit: 2, nodeCap: 5e6, prop: true });
    assert.deepStrictEqual([u.count, u.exceeded], [1, false]);
    assert.ok(necessaryWalls(c));
    // maxKept: even removing every undecided wall would leave more than this, so no second look
    const d = clonePuzzle(p0);
    assert.deepStrictEqual(
      runSync(
        minimizeFully(d, order, makeRng(3), cap, K, { ...o, refineBudget: 1e8, maxKept: 0 }),
      ),
      ra,
    );
    assert.deepStrictEqual(serialize(d), serialize(a));
    // the default per-pass caps widen from pass to pass
    assert.ok(
      REFINE_CAP_X.every((x, i) => x > (REFINE_CAP_X[i - 1] ?? 1)),
      'ascending multiples',
    );
  },
);

test(
  'generate(): the deeper look at undecided walls never adds walls to the winner and keeps it valid and unique with every kept wall needed',
  SLOW,
  () => {
    for (const [n, seed] of [
      [9, 3],
      [10, 1],
    ]) {
      const off = runSync(generate(n, seed, { refineNodes: 0 })),
        on = runSync(generate(n, seed));
      assert.ok(validate(on).ok);
      const r = solve(on, { limit: 2, nodeCap: 5e6, prop: true });
      assert.deepStrictEqual([r.count, r.exceeded], [1, false]);
      assert.ok(wallCount(on) <= wallCount(off), `n=${n}: ${wallCount(on)} > ${wallCount(off)}`);
      assert.ok(necessaryWalls(on), `n=${n} seed=${seed}: a kept wall is unnecessary`);
      // the same candidate wins in both runs, so the second look only takes walls out of it
      for (const w of allEdges(n))
        if (hasWallId(on.walls, w))
          assert.ok(hasWallId(off.walls, w), 'refined puzzle has a wall the unrefined one lacks');
    }
  },
);

test(
  'flags: the freedEdge bit (minimize phase) round-trips, and every integer made before it still decodes to the same objects',
  FAST,
  () => {
    // compat pin: the play app's seed tag stays as it is in the links and records made with it
    assert.deepStrictEqual(flagsToHex(PLAY_FLAGS_INT), '0x18101');
    assert.deepStrictEqual(decodeFlags(PLAY_FLAGS_INT).minimize.freedEdge, true);
    assert.deepStrictEqual(decodeFlags(DEFAULT_FLAGS_INT).minimize.freedEdge, true);
    const before = 0x1010101; // the design app's default before the bit existed: still the plain two-solution check
    assert.deepStrictEqual(decodeFlags(before), {
      build: DEFAULT_GEN_FLAGS,
      minimize: DEFAULT_GEN_FLAGS,
      score: DEFAULT_GEN_FLAGS,
      path: 'backbite',
      cps: 'gap',
    });
    assert.deepStrictEqual(Object.keys(decodeFlags(before).minimize).includes('freedEdge'), false);
    assert.deepStrictEqual(before | 0x8000, DEFAULT_FLAGS_INT);
    assert.deepStrictEqual(
      decodeFlags(encodeFlags(decodeFlags(DEFAULT_FLAGS_INT))),
      decodeFlags(DEFAULT_FLAGS_INT),
    );
  },
);

test(
  'generateUnique: without o.flags it behaves exactly like the default flags (freedEdge in minimize), and o.freedEdge === false like the old flags',
  FAST,
  () => {
    const run = o => {
      const r = runSync(generateUnique(7, 7, makeRng(9), { maxWalls: 10, tries: 4, ...o }));
      return [serialize(r.puzzle), r.walls, r.counts.total];
    };
    assert.deepStrictEqual(run({}), run({ flags: decodeFlags(DEFAULT_FLAGS_INT) }));
    assert.deepStrictEqual(run({ freedEdge: false }), run({ flags: decodeFlags(0x1010101) }));
  },
);

test(
  'freedEdge (default in generate() since ALGO_VERSION 6): generate() and generateUnique() give valid, unique puzzles where every kept wall is needed',
  FAST,
  () => {
    const needed = p => {
      for (const w of allEdges(p.n)) {
        if (!hasWallId(p.walls, w)) continue;
        const q = clonePuzzle(p);
        setWallId(q.walls, w, false);
        assert.ok(
          solve(q, { limit: 2, nodeCap: 2e6, prop: true }).count >= 2,
          'a kept wall is unnecessary',
        );
      }
    };
    for (const [n, seed] of [
      [6, 1],
      [6, 2],
      [7, 1],
      [7, 2],
    ]) {
      const p = runSync(generate(n, seed, { freedEdge: true }));
      assert.ok(validate(p).ok);
      const r = solve(p, { limit: 2, nodeCap: 2e6, prop: true });
      assert.deepStrictEqual([r.count, r.exceeded], [1, false]);
      needed(p);
    }
    // the ALGO_VERSION 5 check (freedEdge: false) still gives valid unique puzzles
    const v5 = runSync(generate(6, 1, { freedEdge: false }));
    assert.ok(validate(v5).ok);
    assert.deepStrictEqual(solve(v5, { limit: 2, nodeCap: 2e6, prop: true }).count, 1);
    // generateUnique's default and the default flags both use it
    for (const o of [{}, { flags: decodeFlags(DEFAULT_FLAGS_INT) }]) {
      const u = runSync(generateUnique(7, 7, makeRng(5), { maxWalls: 8, ...o }));
      assert.deepStrictEqual(u.unique, true);
      needed(u.puzzle);
    }
  },
);

test(
  'generate(): the dense last-resort path (densest K, minimized) is unique and every kept wall is needed with freedEdge on and off',
  FAST,
  () => {
    // the same calls generate() makes when no candidate was built: tryGenerate at the largest K, then minimizeWalls
    for (const freedEdge of [true, false])
      for (const [n, seed] of [
        [6, 1],
        [7, 2],
        [8, 3],
      ]) {
        const rnd = makeRng(seed),
          cells = n * n,
          Kmax = Math.max(5, Math.round(cells / 4)),
          cap = Math.round(Math.max(30000, 200 * cells) * PROP_CAP_X);
        let dense = null; // an attempt can fail (Warnsdorff dead end): retry like generate() does
        for (let attempt = 0; attempt < 30 && !dense; attempt++)
          dense = runSync(
            tryGenerate(n, Kmax, rnd, Math.max(300000, 20 * cap), cells, 0, { prop: true }),
          );
        assert.ok(dense?.order, 'no dense puzzle');
        runSync(minimizeWalls(dense, dense.order, rnd, cap, Kmax, { prop: true, freedEdge }));
        const r = solve(dense, { limit: 2, nodeCap: 2e6, prop: true });
        assert.deepStrictEqual([r.count, r.exceeded], [1, false], `n=${n} freedEdge=${freedEdge}`);
        for (const w of allEdges(n)) {
          if (!hasWallId(dense.walls, w)) continue;
          const q = clonePuzzle(dense);
          setWallId(q.walls, w, false);
          assert.ok(
            solve(q, { limit: 2, nodeCap: 2e6, prop: true }).count >= 2,
            'a kept wall is unnecessary',
          );
        }
      }
  },
);

test(
  'minimizeWalls: bound aborts only a run that ends with >= bound walls; any other run equals the unbounded one',
  FAST,
  () => {
    const rnd = makeRng(11),
      p0 = randomPathPuzzle(7, 7, rnd);
    const order = runSync(
      makeUnique(p0, p0.path, rnd, {
        nodeCap: 9000,
        wallBudget: null,
        seedFraction: 0.4,
        K: 7,
        prop: true,
      }),
    );
    assert.ok(order && order.length > 4);
    const run = bound => {
      const p = clonePuzzle(p0);
      const r = runSync(minimizeWalls(p, order, makeRng(3), 4500, 7, { prop: true, bound }));
      return { r, text: serialize(p) };
    };
    const full = run(undefined),
      kept = full.r.kept;
    assert.ok(kept >= 1);
    assert.deepStrictEqual(run(kept).r, { removed: 0, kept: Infinity, aborted: true });
    assert.deepStrictEqual(run(kept + 1), full);
    assert.deepStrictEqual(run(Infinity), full);
  },
);
