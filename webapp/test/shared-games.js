// Tests of the saved shared games: the radix coder (core/radix-code.js), the puzzle frame of
// the share code (core/share-code.js), the colour-strip order and the merge of a duplicate
// (features/share.js) and the collection kept on the device (features/shared-games.js).
// Registered by tests.js: sharedGamesTests(t, ta, ok, eq).
import { RadixWriter, RadixReader, bitLength } from '../src/core/radix-code.js';
import { encodeShare, decodeShare, VARIANTS, MAX_TENTHS } from '../src/core/share-code.js';
import { validate, labelCount } from '../src/core/model.js';
import { makeRng } from '../src/core/rng.js';
import { runSync } from '../src/core/run.js';
import { generate } from '../src/core/gen/generate.js';
import { generateCutout } from '../src/core/gen/cutout.js';
import { generateArrows } from '../src/core/gen/arrows.js';
import { generateExact } from '../src/core/gen/exact.js';
import { generateLoop } from '../src/core/gen/loop.js';
import {
  makeShareRecord,
  shareKey,
  stripBadness,
  isWorseStrip,
  mergeShared,
  isSpent,
  shareStatus,
} from '../src/features/share.js';
import {
  createSharedGames,
  sanitize,
  serialize,
  SHARED_GAMES_KEY,
} from '../src/features/shared-games.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// The puzzle a code carries, as plain arrays, for comparing.
const flat = p =>
  JSON.stringify([
    p.n,
    [...p.cp],
    [...p.walls],
    p.holes ? [...p.holes] : null,
    p.shape ?? null,
    p.arrows ? [...p.arrows] : null,
    Boolean(p.wrap),
    Boolean(p.loop),
    Boolean(p.exact),
  ]);
const flatRec = r =>
  JSON.stringify([r.kind, r.variant ?? null, r.n, r.grade, r.timeS, r.levels, flat(r.puzzle)]);

// One generated puzzle per type, small and quick.
const PUZZLES = () => [
  [null, runSync(generate(6, 11))],
  ['cutout', runSync(generateCutout(6, 21, { boards: 1, effort: 0.1 }))],
  ['arrows', runSync(generateArrows(5, 3, { candidates: 1, refineNodes: 0 }))],
  ['exact', runSync(generateExact(6, 3, { candidates: 1, refineNodes: 0 }))],
  ['wrap', runSync(generate(5, 7, { wrap: true }))],
  ['loop', runSync(generateLoop(6, 5))],
];
const recordOf = (variant, puzzle, extra = {}) =>
  makeShareRecord({
    n: puzzle.n,
    grade: 3,
    timeS: 83.4,
    legs: [0, 2, 3, 7, 1, 0, 5],
    K: labelCount(puzzle),
    variant,
    puzzle,
    ...extra,
  });

// A standard puzzle by hand: a 16 x 16 snake with numbers at the given steps of it.
function snake(n, steps) {
  const order = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) order.push(r * n + (r % 2 ? n - 1 - c : c));
  }
  const cp = new Uint16Array(n * n);
  steps.forEach((step, i) => {
    cp[order[step]] = i + 1;
  });
  return { n, cp, walls: new Uint8Array(n * n) };
}

// The layout of an Exact code (core/share-code.js), written by hand: cells and the steps between
// first and the last number, so the tests can offer the decoder puzzles no game would make.
export function forgeExact(n, cells, steps, tenths = 834) {
  const T = n * n;
  const w = new RadixWriter();
  w.uint(VARIANTS.indexOf('exact'), VARIANTS.length);
  w.uint(n - 2, 15);
  w.count(tenths - 1, MAX_TENTHS - 1);
  w.uint(cells.length - 2, T - 1);
  w.distinct(cells, T);
  w.fixedSubset(
    steps.map(s => s - 2),
    T - 2,
    cells.length - 2,
  );
  w.uint(0, 2); // no strip
  const check = bits => {
    let h = 0x811c9dc5;
    for (const b of bits) h = Math.imul(h ^ b, 0x01000193);
    h >>>= 0;
    return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff;
  };
  const chars = Math.ceil((3 + 8 + bitLength(w.capacity - 1n)) / 6);
  const body = [...w.value.toString(2).padStart(chars * 6 - 11, '0')].map(Number);
  const head = [0, 1, 1];
  const sum = check([...head, ...body]);
  const bits = [...head, ...[7, 6, 5, 4, 3, 2, 1, 0].map(i => (sum >> i) & 1), ...body];
  let code = '';
  for (let i = 0; i < bits.length; i += 6)
    code += ALPHABET[parseInt(bits.slice(i, i + 6).join(''), 2)];
  return code;
}

const fakeStorage = () => ({
  data: new Map(),
  async get(k) {
    return this.data.has(k) ? { value: this.data.get(k) } : null;
  },
  async set(k, v) {
    this.data.set(k, v);
  },
});

export function sharedGamesTests(t, ta, ok, eq) {
  t('radix-code: count, subset, fixedSubset and distinct round-trip', () => {
    const rnd = makeRng(99);
    for (let trial = 0; trial < 300; trial++) {
      const size = 5 + Math.floor(rnd() * 120),
        k = Math.floor(rnd() * Math.min(size, 30));
      const pool = Array.from({ length: size }, (_, i) => i).sort(() => rnd() - 0.5);
      const subset = pool.slice(0, k).sort((a, b) => a - b),
        picks = pool.slice(0, k);
      const max = 300 + Math.floor(rnd() * 100),
        c = Math.floor(rnd() * 300);
      const w = new RadixWriter();
      w.count(c, max);
      w.subset(subset, size);
      w.distinct(picks, size);
      w.fixedSubset(subset, size, k);
      w.uint(3, 7);
      const r = new RadixReader(w.value);
      eq(
        [r.count(max), r.subset(size), r.distinct(size, k), r.fixedSubset(size, k), r.uint(7)],
        [c, subset, picks, subset, 3],
      );
      ok(r.done && r.capacity === w.capacity, `trial ${trial}`);
    }
  });

  t('radix-code: a subset costs log2 C(size, k) bits; fields share bits', () => {
    const bits = fill => {
      const w = new RadixWriter();
      fill(w);
      return bitLength(w.capacity - 1n);
    };
    eq(
      bits(w => w.fixedSubset([5, 30, 70], 84, 3)),
      17,
      'C(84, 3) = 95284 < 2^17',
    );
    ok(
      bits(w => w.count(0, 100000)) < bits(w => w.count(99999, 100000)),
      'a small value is shorter',
    );
    eq(
      bits(w => {
        for (let i = 0; i < 8; i++) w.uint(0, 49);
      }),
      45,
      'eight cells of 49: 44.9 bits, not 8 x 6',
    );
    eq(
      bits(w => w.distinct([48, 47, 46], 49)),
      17,
      '49 x 48 x 47 = 110544 < 2^17',
    );
  });

  t('radix-code: bad input is refused (writer) or reported as RangeError (reader)', () => {
    const throws = fn => {
      try {
        fn();
      } catch (e) {
        return e instanceof RangeError;
      }
      return false;
    };
    const w = () => new RadixWriter();
    ok(
      throws(() => w().uint(7, 7)) &&
        throws(() => w().uint(-1, 7)) &&
        throws(() => w().uint(1.5, 7)),
    );
    ok(
      throws(() => w().count(5, 4)) &&
        throws(() => w().subset([3, 3], 9)) &&
        throws(() => w().subset([4, 2], 9)),
    );
    ok(
      throws(() => w().subset([9], 9)) &&
        throws(() => w().distinct([1, 1], 4)) &&
        throws(() => w().distinct([4], 4)),
    );
    ok(
      throws(() => new RadixReader(5n).count(3)),
      'a count above its maximum (size class 2, mantissa 1 = 4 > 3)',
    );
    ok(
      throws(() => new RadixReader(5n).distinct(2, 3)),
      'more picks than items',
    );
    ok(
      throws(() => new RadixReader(5n).fixedSubset(2, 3)),
      'a bigger subset than the set',
    );
    ok(throws(() => new RadixReader(5n).uint(0)));
  });

  t('share-code: every puzzle type round-trips (with and without a strip), canonically', () => {
    for (const [variant, puzzle] of PUZZLES()) {
      ok(validate(puzzle).ok, `${variant} sample is valid`);
      for (const rec of [
        recordOf(variant, puzzle),
        recordOf(variant, puzzle, { legs: [], K: 1 }),
      ]) {
        const code = encodeShare(rec);
        ok(/^[A-Za-z0-9_-]+$/.test(code), `${variant}: ${code}`);
        const back = decodeShare(code);
        eq(flatRec(back), flatRec(rec), `${variant}: same record`);
        eq(encodeShare(back), code, `${variant}: re-encodes to the same code`);
      }
    }
    eq(
      PUZZLES().map(([variant]) => VARIANTS.indexOf(variant)),
      [0, 1, 2, 3, 4, 5],
    );
  });

  t('share-code: codes are short; big boards stay encodable', () => {
    const len = (n, seed) => encodeShare(recordOf(null, runSync(generate(n, seed)))).length;
    ok(len(7, 3) <= 24 && len(9, 3) <= 34, `${len(7, 3)} / ${len(9, 3)}`);
    const big = snake(16, [0, 40, 100, 160, 255]),
      rec = recordOf(null, big, { legs: [1, 0, 3, 2] });
    const code = encodeShare(rec);
    ok(code && code.length <= 24, `a 16x16 board with 5 numbers: ${code && code.length}`);
    eq(flatRec(decodeShare(code)), flatRec(rec));
    const noStrip = recordOf(
      null,
      snake(
        16,
        Array.from({ length: 70 }, (_, i) => i * 3 + 1),
      ),
      { legs: [] },
    );
    eq(noStrip.levels, [], 'more than 63 legs: no strip');
    eq(decodeShare(encodeShare(noStrip)).levels, []);
  });

  t('share-code: time in tenths, 0.1 to 13107.1 s; a strip is 0 or K - 1 levels', () => {
    const [, puzzle] = PUZZLES()[0];
    const timeOf = timeS => decodeShare(encodeShare(recordOf(null, puzzle, { timeS }))).timeS;
    eq([timeOf(72.44), timeOf(1e6), timeOf(0.05)], [72.4, 13107.1, 0.1]);
    const rec = recordOf(null, puzzle);
    eq(encodeShare({ ...rec, levels: rec.levels.slice(1) }), null, 'a strip one leg short');
    eq(encodeShare({ ...rec, levels: [...rec.levels, 0] }), null, 'a strip one leg long');
  });

  t('share-code: a local record is refused when out of range or unsound', () => {
    const [, puzzle] = PUZZLES()[0],
      rec = recordOf(null, puzzle);
    for (const bad of [
      { timeS: 0 },
      { timeS: NaN },
      { grade: 6 },
      { grade: -1 },
      { n: puzzle.n + 1 },
      { variant: 'unknown' },
      { variant: 'wrap' },
      { levels: [4] },
      { kind: 'x' },
    ])
      eq(encodeShare({ ...rec, ...bad }), null, JSON.stringify(bad));
    const cp = puzzle.cp.slice();
    cp[cp.indexOf(2)] = 0;
    eq(encodeShare({ ...rec, puzzle: { ...puzzle, cp } }), null, 'a gap in the numbers');
    const walls = puzzle.walls.slice();
    walls[puzzle.n * puzzle.n - 1] |= 1;
    eq(encodeShare({ ...rec, puzzle: { ...puzzle, walls } }), null, 'a wall off the board');
    eq(
      encodeShare({ ...recordOf('cutout', PUZZLES()[1][1]), grade: 2 }),
      null,
      'a variant has no grade',
    );
    const [, wrapped] = PUZZLES()[4];
    eq(
      encodeShare({ ...recordOf('wrap', wrapped), puzzle: { ...wrapped, n: 2 }, n: 2 }),
      null,
      'wrap-around needs 3 x 3',
    );
  });

  t('share-code: damaged puzzle codes are rejected', () => {
    const code = encodeShare(recordOf(null, PUZZLES()[0][1]));
    for (const bad of [
      '',
      code.slice(0, -1),
      code.slice(0, 5),
      code + 'A',
      code + 'AA',
      'A' + code,
      code + '=',
      ' ' + code,
    ]) {
      eq(decodeShare(bad), null, bad);
    }
    let tried = 0,
      accepted = 0;
    for (let i = 0; i < code.length; i++) {
      for (const ch of ALPHABET) {
        if (ch === code[i]) continue;
        tried++;
        if (decodeShare(code.slice(0, i) + ch + code.slice(i + 1))) accepted++;
      }
    }
    ok(
      accepted / tried < 0.02,
      `an 8-bit check lets ~0.4% of single-character mistakes through, got ${accepted}/${tried}`,
    );
  });

  t('share-code: links of the earlier formats are not read any more', () => {
    eq(decodeShare('NnGByofoUsB-g'), null, 'version 1 local game: day, index, algo');
    eq(decodeShare('QlAaEeYABEMKiYSDCIaACjYYg'), null, 'version 2 variant frame');
  });

  t(
    'share-code: forged Exact codes with an unsound puzzle are refused (they come from outside)',
    () => {
      const good = decodeShare(forgeExact(5, [0, 24], []));
      eq(
        [good.variant, good.puzzle.cp[0], good.puzzle.cp[24], good.puzzle.exact, good.timeS],
        ['exact', 1, 25, true, 83.4],
      );
      eq(encodeShare(good), forgeExact(5, [0, 24], []), 'the forged frame is the real one');
      ok(
        decodeShare(forgeExact(5, [0, 12, 24], [13])) !== null,
        'steps 1, 13, 25: legs of 4 cells apart need 4+, fine',
      );
      eq(decodeShare(forgeExact(5, [0, 1, 24], [3])), null, '1 apart, 2 steps: wrong parity');
      eq(decodeShare(forgeExact(5, [0, 12, 24], [3])), null, '4 apart, 2 steps: too short');
      eq(decodeShare(forgeExact(2, [0, 3], [])), null, 'a 2x2 board: 2 apart, 3 steps');
      eq(decodeShare(forgeExact(5, [0, 24], [], 834).slice(0, -1)), null, 'truncated');
    },
  );

  t('share: shareKey names the game, not the result; different games differ', () => {
    const [, puzzle] = PUZZLES()[0],
      rec = recordOf(null, puzzle);
    const other = { ...rec, timeS: 999.9, grade: 0, levels: rec.levels.map(() => 3) };
    eq(shareKey(other), shareKey(rec));
    ok(
      shareKey(rec) && shareKey({ ...rec, puzzle: PUZZLES()[0][1], grade: null }) === shareKey(rec),
    );
    ok(shareKey(recordOf(null, runSync(generate(6, 12)))) !== shareKey(rec), 'another puzzle');
    ok(shareKey(recordOf('cutout', PUZZLES()[1][1])) !== shareKey(rec));
    const gotd = {
      kind: 'gotd',
      n: 7,
      grade: 3,
      timeS: 72.4,
      day: 20733,
      pct: 83,
      levels: [0, 1, 0],
    };
    eq(
      [
        shareKey({ ...gotd, timeS: 5, pct: null, grade: null, levels: [] }) === shareKey(gotd),
        shareKey({ ...gotd, day: 20734 }) === shareKey(gotd),
      ],
      [true, false],
    );
    eq(shareKey({ ...gotd, n: 99 }), null, 'not encodable: no key');
  });

  t('share: the worse strip is the bigger (sum of levels, sum of squares)', () => {
    eq(
      [stripBadness([3, 0, 0]), stripBadness([1, 1, 1]), stripBadness([])],
      [
        [3, 9],
        [3, 3],
        [0, 0],
      ],
    );
    const worse = (a, b) => isWorseStrip(a, b);
    eq(worse([1, 0, 0], [0, 0, 0]), true); // 🟨🟩🟩 is worse than 🟩🟩🟩
    // equal sum: the spike is worse
    eq([worse([3, 0, 0], [1, 1, 1]), worse([1, 1, 1], [3, 0, 0])], [true, false]);
    // identical: not strictly worse
    eq([worse([2, 2, 0], [2, 2, 0]), worse([0, 0], [0, 0])], [false, false]);
    eq(worse([0, 0, 0], [1, 0, 0]), false);
  });

  t('share: mergeShared keeps one entry per game, the one with the worse strip', () => {
    const [, puzzle] = PUZZLES()[0],
      K = labelCount(puzzle);
    const withStrip = levels => ({ ...recordOf(null, puzzle, { legs: [] }), levels });
    const strip = (...levels) => withStrip(Array.from({ length: K - 1 }, (_, i) => levels[i] || 0));
    const green = strip(),
      yellow = strip(1, 1, 1),
      spike = strip(3); // yellow: (3, 3), spike: (3, 9)
    const gotd = {
      kind: 'gotd',
      n: 7,
      grade: 3,
      timeS: 72.4,
      day: 20733,
      pct: 83,
      levels: [0, 1, 0],
    };
    let m = mergeShared([], green, 100);
    eq([m.outcome, m.entries.length, m.entries[0].added], ['added', 1, 100]);
    m = mergeShared(m.entries, gotd, 200);
    eq([m.outcome, m.entries.map(e => e.rec.kind)], ['added', ['local', 'gotd']]);
    m = mergeShared(m.entries, yellow, 300);
    eq(
      [m.outcome, m.entries.length, m.entries[0].rec.levels, m.entries[0].added],
      ['replaced', 2, yellow.levels, 100],
    );
    eq(mergeShared(m.entries, green, 400).outcome, 'kept');
    eq(
      mergeShared(m.entries, { ...yellow, timeS: 1 }, 400).outcome,
      'kept',
      'a tie keeps the stored record (and its time)',
    );
    const spiked = mergeShared(m.entries, spike, 500);
    eq(spiked.outcome, 'replaced');
    eq(
      spiked.entries[0].rec.levels.slice(0, 3),
      [3, 0, 0],
      'same sum, but one red leg is worse than three yellow ones',
    );
    eq(mergeShared([], { ...green, timeS: -1 }, 1).outcome, 'invalid');
    // arrival order does not matter when the strips differ
    const keep = order =>
      order.reduce((entries, rec) => mergeShared(entries, rec, 1).entries, [])[0].rec.levels;
    eq(keep([green, yellow, spike]), keep([spike, green, yellow]));
    eq(keep([green, yellow, spike]), keep([yellow, spike, green]));
  });

  t('share: isSpent = a Game of Day played or out of the replay window', () => {
    const gotd = { kind: 'gotd' },
      local = { kind: 'local' };
    eq(
      ['played', 'old'].map(status => isSpent(gotd, { status })),
      [true, true],
    );
    eq(
      ['live', 'replay', 'future', 'invalid'].map(status => isSpent(gotd, { status })),
      [false, false, false, false],
    );
    eq(
      ['ok', 'played', 'old', 'invalid'].map(status => isSpent(local, { status })),
      [false, false, false, false],
    );
  });

  t('share: a local game is playable whatever the app version', () => {
    const ctx = {
      today: 20000,
      replayDates: [],
      attempt: null,
      sizes: [5, 6, 7],
      sizesOf: id => (id === 'wrap' ? [4, 5] : []),
    };
    const [, puzzle] = PUZZLES()[0];
    eq(shareStatus(recordOf(null, puzzle), ctx), { status: 'ok' });
    eq(shareStatus({ ...recordOf(null, puzzle), n: 9 }, ctx), { status: 'invalid' });
    eq(
      shareStatus({ ...recordOf('wrap', PUZZLES()[4][1]), n: 4 }, ctx),
      { status: 'ok' },
      'a size only the variant offers',
    );
  });

  ta(
    'shared-games: add, persist across instances, remove; a duplicate keeps the worse strip',
    async () => {
      const st = fakeStorage(),
        [, puzzle] = PUZZLES()[0],
        K = labelCount(puzzle);
      const lv = fill => Array(K - 1).fill(fill);
      let clock = 1000;
      const a = createSharedGames(st, () => clock++);
      await a.init();
      eq(a.list(), []);
      const first = await a.add({ ...recordOf(null, puzzle, { legs: [] }), levels: lv(0) });
      eq(first.outcome, 'added');
      ok(first.key && st.data.has(SHARED_GAMES_KEY));
      const b = createSharedGames(st);
      await b.init();
      eq(
        b.list().map(e => [e.key, e.added, e.rec.levels]),
        [[first.key, 1000, lv(0)]],
        'a new instance reads it back',
      );
      eq(
        (await b.add({ ...recordOf(null, puzzle, { legs: [] }), levels: lv(2) })).outcome,
        'replaced',
      );
      eq((await b.add({ ...recordOf(null, puzzle, { legs: [] }), levels: lv(1) })).outcome, 'kept');
      const c = createSharedGames(st);
      await c.init();
      eq(
        c.list().map(e => e.rec.levels),
        [lv(2)],
      );
      eq(await c.remove('nope'), false);
      eq(await c.remove(first.key), true);
      const d = createSharedGames(st);
      await d.init();
      eq(d.list(), [], 'removed for good');
    },
  );

  ta('shared-games: two instances taking turns lose nothing; prune drops entries', async () => {
    const st = fakeStorage(),
      games = PUZZLES().map(([variant, puzzle]) =>
        recordOf(variant, puzzle, { grade: variant ? null : 2 }),
      );
    const one = createSharedGames(st),
      two = createSharedGames(st);
    await Promise.all([one.init(), two.init()]);
    await one.add(games[0]);
    await two.add(games[1]);
    await one.add(games[2]);
    await two.add(games[3]); // each reads the stored list first
    const all = createSharedGames(st);
    await all.init();
    eq(all.list().length, 4);
    eq(await all.prune(e => e.rec.variant !== 'cutout'), 1);
    eq(await all.prune(() => true), 0);
    const again = createSharedGames(st);
    await again.init();
    eq(
      again
        .list()
        .map(e => e.rec.variant ?? null)
        .sort(),
      ['arrows', 'exact', null],
    );
  });

  ta('shared-games: corrupt or hostile stored values are ignored; load cleans up', async () => {
    const [, puzzle] = PUZZLES()[0],
      rec = recordOf(null, puzzle, { legs: [] });
    const code = encodeShare(rec);
    for (const stored of [
      'not json',
      '{"v":2,"items":[]}',
      '{"v":1}',
      'null',
      '[]',
      '{"v":1,"items":"x"}',
    ]) {
      const st = fakeStorage();
      st.data.set(SHARED_GAMES_KEY, stored);
      const games = createSharedGames(st);
      await games.init();
      eq(games.list(), [], stored);
    }
    const mixed = {
      v: 1,
      items: [
        { c: code, a: 5 },
        { c: 'garbage', a: 6 },
        { c: 42 },
        null,
        { c: code, a: 9 },
        { c: code.slice(0, -1), a: 7 },
      ],
    };
    const entries = sanitize(mixed);
    eq(
      entries.map(e => [e.key, e.added]),
      [[shareKey(rec), 5]],
      'one entry, the first one kept',
    );
    eq(JSON.parse(serialize(entries)), { v: 1, items: [{ c: code, a: 5 }] });
  });
}
