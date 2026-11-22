// Unit tests of what the app stores: daily counters, stats, attempts, play log, calib, log store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../setup-balls.js';
import { makePuzzle, ALGO_VERSION } from '../../src/core/model.js';
import { serialize, parse } from '../../src/core/format.js';
import { dailySeed } from '../../src/core/rng.js';
import { step } from '../../src/core/rules.js';
import { createDaily, utcDayNumber } from '../../src/features/daily.js';
import { createStore } from '../../src/features/stats-store.js';
import {
  newTrace,
  traceStep,
  traceClear,
  buildRecord,
  createPlayLog,
  PLAYLOG_KEY,
  PLAYLOG_LEGACY_KEY,
} from '../../src/features/playlog.js';
import {
  loadRatings,
  saveRatings,
  loadPairs,
  savePairs,
  packRatings,
  unpackRatings,
  packPairs,
  unpackPairs,
  RATING_KEY,
  RATING_KEY_V1,
  PAIR_KEY,
  PAIR_KEY_V1,
} from '../../src/core/log-store.js';
import { withEviction, migrateKey, usage } from '../../src/platform/storage.js';
import { STATS_KEY, GOTD_KEY, ATTEMPT_KEEP_DAYS } from '../../src/features/stats-store.js';
import { skillBucket } from '../../src/core/behaviour.js';
import { createCalib, calibRequested, CALIB_DIR } from '../../src/features/calib.js';
import { pickStorage } from '../../src/platform/storage.js';
import { FAST, SLOW } from '../harness.js';
import { atDay, fakeStorage } from './helpers.js';

test(
  'playlog: a trace counts cells drawn and taken back, with the real rules; pushes - undone = cells left on the board',
  FAST,
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[8] = 2;
    const path = [],
      tr = newTrace(),
      mv = c => {
        const b = path.length,
          k = step(p, path, c, { truncate: true });
        traceStep(tr, k, b, path.length);
        return k;
      };
    assert.deepStrictEqual([0, 1, 2, 5].map(mv), ['push', 'push', 'push', 'push']);
    assert.deepStrictEqual(mv(2), 'pop', 'one-step undo');
    assert.deepStrictEqual([5, 4, 3].map(mv), ['push', 'push', 'push']);
    assert.deepStrictEqual(mv(1), 'trunc', 'cut back to an earlier cell');
    assert.deepStrictEqual(mv(8), null, 'a blocked move is not counted');
    assert.deepStrictEqual(
      {
        pushes: tr.pushes,
        undone: tr.undone,
        maxUndone: tr.maxUndone,
        backtracks: tr.backtracks,
        resets: tr.resets,
      },
      { pushes: 7, undone: 5, maxUndone: 4, backtracks: 2, resets: 0 },
    );
    assert.deepStrictEqual(
      tr.pushes - tr.undone,
      path.length,
      'pushes - undone = cells on the board',
    );
    traceClear(tr, path.length);
    assert.deepStrictEqual(
      [tr.resets, tr.undone, tr.backtracks],
      [1, 7, 3],
      'the reset button takes back everything drawn',
    );
    traceClear(tr, 0);
    assert.deepStrictEqual(tr.resets, 1, 'resetting an empty path counts nothing');
  },
);

test(
  'playlog: consecutive one-step undos are one take-back action; maxUndone is the deepest one',
  FAST,
  () => {
    const tr = newTrace();
    for (let i = 0; i < 6; i++) traceStep(tr, 'push', i, i + 1);
    for (let i = 0; i < 3; i++) traceStep(tr, 'pop', 6 - i, 5 - i); // one run of 3
    traceStep(tr, 'push', 3, 4);
    traceStep(tr, 'pop', 4, 3); // a second run of 1
    assert.deepStrictEqual([tr.backtracks, tr.undone, tr.maxUndone], [2, 4, 3]);
  },
);

test(
  'playlog: a record keeps size, raw time, solved, any hint, mode and minute; the stored list is capped, survives a reload and a corrupt value',
  FAST,
  async () => {
    const p = makePuzzle(3),
      at = 7 * 60000 + 123;
    const rec = buildRecord(p, { ms: 12345.6, solved: true, hints: 2, mode: 'gotd', at });
    assert.deepStrictEqual(rec, { n: 3, ms: 12346, solved: true, hints: 2, mode: 'gotd', at });
    const st = fakeStorage(),
      log = createPlayLog(st, 2),
      mk = (i, o = {}) => buildRecord(p, { ms: 1000 * i, solved: true, at: i * 60000, ...o });
    await Promise.all([
      log.add(mk(1)),
      log.add(mk(2, { hints: 3, mode: 'replay' })),
      log.add(mk(3, { solved: false })),
    ]);
    const all = await log.all();
    assert.deepStrictEqual(
      all.map(r => [r.ms, r.solved, r.hints, r.mode, r.at]),
      [
        [2000, true, 1, 'replay', 120000],
        [3000, false, 0, 'local', 180000],
      ],
      'concurrent adds are all kept, then the oldest is dropped past the cap; hints are kept as any/none',
    );
    assert.deepStrictEqual(
      (await createPlayLog(st, 2).all()).length,
      2,
      'a new log object reads the same list back',
    );
    assert.deepStrictEqual(
      await st.get(PLAYLOG_LEGACY_KEY),
      null,
      'nothing is written under the old key',
    );
    await st.set(PLAYLOG_KEY, '{not json');
    assert.deepStrictEqual(
      await createPlayLog(st).all(),
      [],
      'a corrupt value reads as an empty log',
    );
  },
);

test(
  'playlog: a v1 log is converted once; skill bucket and streak days read the same as before; the old key goes; the new value is far smaller',
  FAST,
  async () => {
    const p = makePuzzle(5),
      legacy = [];
    for (let i = 0; i < 60; i++) {
      const r = buildRecord(p, {
        ms: 9000 + 700 * (i % 9),
        solved: i % 7 !== 0,
        hints: i % 11 === 0 ? 1 : 0,
        mode: ['local', 'gotd', 'replay'][i % 3],
        at: 1.7e12 + i * 3.1e7 + 12345,
      });
      legacy.push({
        v: 1,
        key: serialize(p),
        ...r,
        pushes: 25,
        undone: 3,
        maxUndone: 2,
        backtracks: 1,
        resets: 0,
      });
    }
    const st = fakeStorage(),
      old = JSON.stringify(legacy);
    await st.set(PLAYLOG_LEGACY_KEY, old);
    const all = await createPlayLog(st).all();
    assert.deepStrictEqual(all.length, 60);
    assert.deepStrictEqual(
      skillBucket(all),
      skillBucket(legacy),
      'the skill bucket of the upload is unchanged',
    );
    const days = l =>
      [...new Set(l.filter(r => r.solved).map(r => Math.floor(r.at / 86400000)))].sort(
        (x, y) => x - y,
      );
    assert.deepStrictEqual(
      days(all),
      days(legacy),
      'the streak bootstrap sees the same solved days',
    );
    assert.deepStrictEqual(
      [
        await st.get(PLAYLOG_LEGACY_KEY),
        (await st.get(PLAYLOG_KEY)).value.length < old.length / 8,
      ],
      [null, true],
      'the old key is gone and the new value is at least 8x smaller',
    );
    assert.deepStrictEqual(
      (await createPlayLog(st).all()).length,
      60,
      'a second load reads the converted value',
    );
  },
);

test(
  'playlog: a refused write of the converted value keeps the old one for the next load',
  FAST,
  async () => {
    const st = fakeStorage(450),
      legacy = JSON.stringify(
        Array.from({ length: 3 }, (_, i) => ({
          v: 1,
          key: 'x'.repeat(10),
          n: 5,
          ms: 5000 + i,
          solved: true,
          hints: 0,
          mode: 'local',
          at: 1.7e12 + i,
        })),
      );
    await st.set(PLAYLOG_LEGACY_KEY, legacy);
    assert.deepStrictEqual(
      await migrateKey(st, PLAYLOG_LEGACY_KEY, PLAYLOG_KEY, () => 'y'.repeat(500)),
      'failed',
    );
    assert.ok(await st.get(PLAYLOG_LEGACY_KEY), 'the old value is still there');
  },
);

test("playlog: two tabs sharing the storage keep each other's records", FAST, async () => {
  const st = fakeStorage(),
    A = createPlayLog(st),
    B = createPlayLog(st),
    p = makePuzzle(3),
    mk = i => buildRecord(p, { ms: 1000 * i, solved: true, at: i * 60000 });
  await A.add(mk(1));
  await B.add(mk(2));
  await A.add(mk(3));
  assert.deepStrictEqual(
    (await B.all()).map(r => r.ms),
    [1000, 2000, 3000],
    'every record is there, in order, for either tab',
  );
  assert.deepStrictEqual((await A.all()).length, 3);
});

test(
  'storage: a write refused in the end is logged once per key and listed in refused; a later success clears it',
  FAST,
  async () => {
    const warns = [],
      warn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const st = withEviction(fakeStorage(60));
      await st.set('zip_streak', 's'.repeat(20));
      assert.deepStrictEqual(
        [await st.set('zip_big', 'z'.repeat(200)), await st.set('zip_big', 'z'.repeat(300))],
        [false, false],
      );
      assert.deepStrictEqual(
        [warns.length, [...st.refused]],
        [1, ['zip_big']],
        'one warning for the key',
      );
      assert.deepStrictEqual([await st.set('zip_big', 'ok'), st.refused.size], [true, 0]);
    } finally {
      console.warn = warn;
    }
  },
);

test(
  'storage: a refused write frees the play log (never stats or streak) and retries; usage counts keys and chars',
  FAST,
  async () => {
    const st = withEviction(fakeStorage(200));
    await st.set('zip_playlog_v2', 'p'.repeat(120));
    await st.set('zip_streak', 's'.repeat(40));
    assert.deepStrictEqual(
      await st.set('zip_stats_v2', 't'.repeat(100)),
      true,
      'written after the play log was dropped',
    );
    assert.deepStrictEqual(
      [await st.get('zip_playlog_v2'), (await st.get('zip_streak')).value.length],
      [null, 40],
    );
    const warn = console.warn;
    console.warn = () => {}; // the refusal is logged (tested below)
    try {
      assert.deepStrictEqual(
        await st.set('zip_big', 'z'.repeat(500)),
        false,
        'nothing else may be evicted: the write is refused',
      );
    } finally {
      console.warn = warn;
    }
    assert.ok(
      (await st.get('zip_streak')) && (await st.get('zip_stats_v2')),
      'stats and streak survive',
    );
    assert.deepStrictEqual(await usage(st), {
      keys: 2,
      chars: 'zip_streak'.length + 40 + 'zip_stats_v2'.length + 100,
    });
  },
);

test(
  'calib: serves the fixed set in order from a random block; skip, wrap, reload',
  FAST,
  async () => {
    const fs = await import('node:fs');
    assert.deepStrictEqual(['?calib', '?x=1&calib=1', '?lb=a', ''].map(calibRequested), [
      true,
      true,
      false,
      false,
    ]);
    const rated = JSON.parse(
      fs.readFileSync(new URL('../../tools/ratings.json', import.meta.url)),
    );
    const keyOfSize = n => rated.find(r => parse(r.key).n === n).key;
    const files = Array.from({ length: 6 }, (_, i) => `cal-5-00${i}.txt`),
      text = keyOfSize(5);
    const server =
      (index, body = text) =>
      async url => {
        const miss = { ok: false, status: 404 };
        if (url === CALIB_DIR + 'index.json') {
          return index ? { ok: true, json: async () => index } : miss;
        }
        const hit = files.includes(url.slice(CALIB_DIR.length));
        return hit ? { ok: true, text: async () => body } : miss;
      };
    const index = { v: 1, sizes: { 5: files }, block: { 5: 3 } },
      st = fakeStorage();
    const mk = (o = {}) => createCalib(st, { fetchFn: server(index), rnd: () => 0.99, ...o });
    let c = mk();
    assert.deepStrictEqual(await c.sizes(), [5]);
    let g = await c.open(5);
    assert.deepStrictEqual(
      [g.pos, g.puzzle.calib, g.puzzle.n],
      [3, files[3], 5],
      'random start, block-aligned',
    );
    assert.deepStrictEqual((await c.open(5)).pos, 3, 'an unsolved puzzle stays the current one');
    await c.markSolved(5, 2);
    assert.deepStrictEqual((await c.open(5)).pos, 3, 'a stale solve changes nothing');
    await c.markSolved(5, 3);
    assert.deepStrictEqual((await c.open(5)).pos, 4, 'solved: the next one');
    assert.deepStrictEqual((await c.skip(5)).pos, 5);
    g = await c.skip(5);
    assert.deepStrictEqual([g.pos, g.puzzle.calib], [6, files[0]], 'the order wraps around');
    c = mk({ rnd: () => 0 });
    assert.deepStrictEqual(
      (await c.open(5)).pos,
      6,
      'a reload keeps the place (the start is only random once)',
    );
    const fresh = createCalib(fakeStorage(), { fetchFn: server(index), rnd: () => 0 });
    assert.deepStrictEqual((await fresh.open(5)).pos, 0);
    const rejects = async (c2, why) => {
      let e = null;
      try {
        await c2.open(5);
      } catch (x) {
        e = x;
      }
      assert.ok(e, why);
    };
    const mkBad = (idx, body) => createCalib(fakeStorage(), { fetchFn: server(idx, body) });
    await rejects(mkBad(null), 'no index');
    await rejects(mkBad({ v: 1, sizes: { 5: [] } }), 'an empty list');
    await rejects(mkBad({ v: 2, sizes: { 5: files } }), 'an unknown version');
    await rejects(mkBad(index, keyOfSize(6)), 'a puzzle of another size');
  },
);

test(
  'daily: sequence per size is independent of what was played in other sizes',
  FAST,
  async () => {
    const A = createDaily(fakeStorage(), atDay(19)),
      B = createDaily(fakeStorage(), atDay(19)),
      seedsA = [],
      seedsB = [];
    for (const step of [
      ['open', 5],
      ['open', 7],
      ['skip', 5],
      ['skip', 7],
      ['skip', 5],
    ]) {
      const g = await A[step[0]](step[1]);
      if (step[1] === 5) seedsA.push(g.seed);
    }
    for (const step of [
      ['open', 5],
      ['skip', 5],
      ['skip', 5],
    ])
      seedsB.push((await B[step[0]](step[1])).seed);
    assert.deepStrictEqual(seedsA, seedsB);
    assert.deepStrictEqual(new Set(seedsA).size, 3);
  },
);

test(
  'daily: Play local advances only after the current game was solved; New puzzle always advances',
  FAST,
  async () => {
    const D = createDaily(fakeStorage(), atDay(19));
    const g1 = await D.open(5),
      again = await D.open(5);
    assert.deepStrictEqual(again.index, g1.index, 'unsolved -> same game');
    await D.markSolved(5, g1.index);
    assert.deepStrictEqual((await D.peek(5)).index, 1, 'peek shows next');
    assert.deepStrictEqual((await D.open(5)).index, 1, 'solved -> next game');
    assert.deepStrictEqual((await D.skip(5)).index, 2);
    assert.deepStrictEqual((await D.open(7)).index, 0, 'other size untouched');
  },
);

test('daily: counter resets on a new UTC day; seeds match dailySeed', FAST, async () => {
  const st = fakeStorage(),
    d19 = createDaily(st, atDay(19)),
    d20 = createDaily(st, atDay(20));
  await d19.skip(5);
  await d19.skip(5);
  assert.deepStrictEqual((await d19.peek(5)).index, 2);
  assert.deepStrictEqual((await d20.peek(5)).index, 0);
  assert.deepStrictEqual(
    (await d20.peek(5)).seed,
    dailySeed(utcDayNumber(atDay(20)()), 5, 0, ALGO_VERSION),
  );
});

test('stats-store: today resets each day, total accumulates, both persist', FAST, async () => {
  const st = fakeStorage(),
    S = createStore(st, [5]);
  await S.hydrate('20260919');
  await S.recordSolve(5, 100, 10);
  await S.recordSolve(5, 100, 20);
  await S.recordSolve(5, 101, 30);
  assert.deepStrictEqual([S.today(5, 100).n, S.today(5, 101).n, S.total(5).n], [0, 1, 3]);
  assert.deepStrictEqual(S.today(5, 101).recent, [30]);
  const S2 = createStore(st, [5]);
  await S2.hydrate('20260919');
  assert.deepStrictEqual([S2.today(5, 101).n, S2.total(5).n], [1, 3]);
});

test(
  'daily: a variant counts its own games; the standard counter and keys are untouched',
  FAST,
  async () => {
    const st = fakeStorage(),
      D = createDaily(st, atDay(19));
    assert.deepStrictEqual((await D.open(5, 'cutout')).index, 0);
    await D.markSolved(5, 0, 'cutout');
    assert.deepStrictEqual(
      [
        (await D.peek(5, 'cutout')).index,
        (await D.peek(5)).index,
        (await D.peek(5, 'arrows')).index,
        (await D.peek(6, 'cutout')).index,
      ],
      [1, 0, 0, 0],
    );
    assert.deepStrictEqual((await D.skip(5, 'arrows')).index, 1);
    assert.deepStrictEqual((await D.open(5)).index, 0, 'standard still at its first game');
    assert.deepStrictEqual(
      [
        (await st.get('zip_daily_index_cutout_5')) !== null,
        (await st.get('zip_daily_index_arrows_5')) !== null,
        (await st.get('zip_daily_index_5')) !== null,
      ],
      [true, true, true],
    );
    assert.deepStrictEqual(
      (await createDaily(fakeStorage(), atDay(19)).peek(5, 'cutout')).index,
      0,
      'a fresh storage starts at game 1',
    );
  },
);

test(
  'stats-store: a variant keeps its own stats per size; standard totals do not move; both persist',
  FAST,
  async () => {
    const st = fakeStorage(),
      scopes = { cutout: [5, 6] },
      S = createStore(st, [5], scopes);
    await S.hydrate('20260919');
    await S.recordSolve(5, 100, 10, 'cutout');
    await S.recordSolve(5, 100, 20, 'cutout');
    await S.recordSolve(5, 100, 30);
    assert.deepStrictEqual(
      [
        S.total(5, 'cutout').n,
        S.total(5).n,
        S.today(5, 100, 'cutout').n,
        S.total(6, 'cutout').n,
        S.total(5, 'arrows').n,
      ],
      [2, 1, 2, 0, 0],
    );
    const S2 = createStore(st, [5], scopes);
    await S2.hydrate('20260919');
    assert.deepStrictEqual(
      [
        S2.total(5, 'cutout').n,
        S2.today(5, 100, 'cutout').n,
        S2.today(5, 101, 'cutout').n,
        S2.total(5).n,
      ],
      [2, 2, 0, 1],
    );
    assert.deepStrictEqual(
      [
        await st.keys('zip_local_stats_'),
        await st.keys('zip_today_stats_'),
        (await st.keys('zip_')).sort(),
      ],
      [[], [], [STATS_KEY]],
      'one key holds every size and variant',
    );
  },
);

test(
  'stats-store: legacy keys (known sizes, variants, orphans) are converted to one key; values, today and best survive; the old keys go',
  FAST,
  async () => {
    const st = fakeStorage(),
      scopes = { cutout: [5] },
      stat = (n, m) => ({ n, mean: m, M2: n * 3.5, recent: [m, m + 1] });
    await st.set('zip_local_stats_5', JSON.stringify(stat(4, 10.25)));
    await st.set('zip_today_stats_5', JSON.stringify({ day: 100, stat: stat(1, 9) }));
    await st.set('zip_local_stats_cutout_5', JSON.stringify(stat(2, 30)));
    await st.set('zip_gotd_best_5', JSON.stringify({ date: '20260919', time: 41.5 }));
    await st.set('zip_local_stats_9', JSON.stringify(stat(7, 70))); // a size no longer offered
    await st.set('zip_today_stats_6', '{broken'); // a damaged value is skipped
    const S = createStore(st, [5], scopes);
    await S.hydrate('20260919');
    assert.deepStrictEqual(
      [
        S.total(5).n,
        S.total(5).mean,
        S.total(5, 'cutout').n,
        S.today(5, 100).n,
        S.today(5, 101).n,
        S.gotdBest(5),
      ],
      [4, 10.25, 2, 1, 0, { date: '20260919', time: 41.5 }],
    );
    const left = (await st.keys('zip_'))
      .filter(k => k !== STATS_KEY && !k.startsWith('zip_gotd_attempt_'))
      .sort();
    assert.deepStrictEqual(left, [], 'every legacy key is gone, the unreadable one included');
    assert.deepStrictEqual(
      JSON.parse((await st.get(STATS_KEY)).value).t['9'],
      [7, 70, 24.5, [70, 71]],
      'orphan sizes are carried over, not lost',
    );
    const S2 = createStore(st, [5], scopes);
    await S2.hydrate('20260919');
    assert.deepStrictEqual(
      [S2.total(5).mean, S2.gotdBest(5).time],
      [10.25, 41.5],
      'a second load reads the blob',
    );
  },
);

test(
  "stats-store: two tabs writing different variants keep each other's stats; an older day's today entry is dropped on the next write",
  FAST,
  async () => {
    const st = fakeStorage(),
      scopes = { cutout: [5] },
      A = createStore(st, [5], scopes),
      B = createStore(st, [5], scopes);
    await A.hydrate('20260919');
    await B.hydrate('20260919');
    await A.recordSolve(5, 100, 10);
    await B.recordSolve(5, 100, 20, 'cutout');
    const C = createStore(st, [5], scopes);
    await C.hydrate('20260919');
    assert.deepStrictEqual([C.total(5).n, C.total(5, 'cutout').n], [1, 1]);
    await C.recordSolve(5, 101, 30);
    assert.deepStrictEqual(
      Object.entries(JSON.parse((await st.get(STATS_KEY)).value).d).map(([k, v]) => [k, v[0]]),
      [['5', 101]],
      'the day-100 entry of the other scope is gone',
    );
  },
);

test(
  'stats-store: the blob of a full device stays small (15 sizes x 6 variants)',
  SLOW,
  async () => {
    const st = fakeStorage(),
      sizes = Array.from({ length: 15 }, (_, i) => i + 2),
      scopes = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(id => [id, sizes]));
    const S = createStore(st, sizes, scopes);
    await S.hydrate('20260919');
    for (const n of sizes)
      for (const sc of ['', ...Object.keys(scopes)])
        for (let i = 0; i < 25; i++)
          await S.recordSolve(n, 100, 12345.678912345 + i * 1111.1111, sc);
    const len = (await st.get(STATS_KEY)).value.length;
    assert.ok(len < 60000, 'worst case, every scope played: ' + len + ' chars');
    assert.deepStrictEqual(S.total(15).recent.length, 20);
  },
);

test(
  'attempts: legacy per-date keys are converted to one key; records are kept as they are; dates past the keep window go; a blob record wins',
  FAST,
  async () => {
    const st = fakeStorage(),
      full = {
        solved: true,
        time: 41.2,
        sent: false,
        stats: { n: 3, mean: 30, top: null, pct: 50 },
        statsFrom: 'cf',
        done: ['cf'],
        rounds: 1,
      };
    await st.set('zip_gotd_attempt_20260919', JSON.stringify(full));
    await st.set('zip_gotd_attempt_20260918', JSON.stringify({ solved: false, time: null }));
    await st.set(
      'zip_gotd_attempt_20250101',
      JSON.stringify({ solved: true, time: 9, sent: false }),
    ); // far outside any replay window
    await st.set('zip_gotd_attempt_20260917', '{broken');
    await st.set(GOTD_KEY, JSON.stringify({ v: 2, a: { 20260918: { solved: true, time: 7 } } }));
    const S = createStore(st, [5]);
    await S.hydrate('20260919');
    assert.deepStrictEqual(
      S.attempt(),
      full,
      'the full record, submit state included, reads back as before',
    );
    assert.deepStrictEqual(
      [
        await S.loadAttempt('20260918'),
        await S.loadAttempt('20260917'),
        await S.loadAttempt('20250101'),
        await S.loadAttempt('20260101'),
      ],
      [{ solved: true, time: 7 }, null, null, null],
    );
    assert.deepStrictEqual(await st.keys('zip_gotd_attempt_'), [], 'every old key is gone');
    assert.deepStrictEqual(Object.keys(JSON.parse((await st.get(GOTD_KEY)).value).a).sort(), [
      '20260918',
      '20260919',
    ]);
  },
);

test(
  'attempts: the Game-of-Day solves in total only grow: one per date (a repeat or a late submit flag adds nothing), replays count, pruned dates stay counted, an old blob counts its solved dates',
  FAST,
  async () => {
    const st = fakeStorage(),
      S = createStore(st, [5]);
    await S.hydrate('20260101');
    assert.deepStrictEqual(S.gotdSolves(), 0);
    await S.saveAttempt('20260101', { solved: false, time: null });
    assert.deepStrictEqual(S.gotdSolves(), 0, 'a try is not a solve');
    await S.recordGotd(5, '20260101', 30);
    assert.deepStrictEqual(S.gotdSolves(), 1);
    await S.saveAttempt('20260101', { solved: true, time: 30, sent: true });
    assert.deepStrictEqual(S.gotdSolves(), 1, 'the same date again');
    await S.recordGotd(5, '20251231', 40, false, true);
    assert.deepStrictEqual(S.gotdSolves(), 2, 'a replay of another date');
    const dateAt = i =>
      new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 300; i++) await S.saveAttempt(dateAt(i), { solved: true, time: 30 });
    assert.ok(
      Object.keys(JSON.parse((await st.get(GOTD_KEY)).value).a).length < 2 * ATTEMPT_KEEP_DAYS,
      'the old dates went',
    );
    const total = S.gotdSolves();
    assert.ok(total >= 300, 'the pruned dates stay counted: ' + total);
    const again = createStore(st, [5]);
    await again.hydrate('20260101');
    assert.deepStrictEqual(again.gotdSolves(), total, 'it is read back');
    const old = fakeStorage();
    await old.set(
      GOTD_KEY,
      JSON.stringify({
        v: 2,
        a: {
          20260918: { solved: true, time: 7 },
          20260919: { solved: false, time: null },
          20260920: { solved: true, time: 8 },
        },
      }),
    );
    const O = createStore(old, [5]);
    await O.hydrate('20260921');
    assert.deepStrictEqual(O.gotdSolves(), 2, 'a blob without a count: its solved dates');
  },
);

test(
  'attempts: only the last 120 days before the newest date are kept; 400 days of play stay in one small key',
  FAST,
  async () => {
    const st = fakeStorage(),
      S = createStore(st, [5]);
    await S.hydrate('20260101');
    const dateAt = i =>
      new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 400; i++)
      await S.saveAttempt(dateAt(i), {
        solved: true,
        time: 30 + i / 7,
        sent: true,
        stats: { n: 120, mean: 31.123, top: 20.5, pct: 63 },
      });
    const a = JSON.parse((await st.get(GOTD_KEY)).value).a;
    assert.deepStrictEqual(
      [
        Object.keys(a).length,
        (await S.loadAttempt(dateAt(399))) !== null,
        (await S.loadAttempt(dateAt(399 - ATTEMPT_KEEP_DAYS))) !== null,
        await S.loadAttempt(dateAt(398 - ATTEMPT_KEEP_DAYS)),
      ],
      [ATTEMPT_KEEP_DAYS + 1, true, true, null],
    );
    assert.ok((await usage(st)).chars < 16000, 'chars: ' + (await usage(st)).chars);
  },
);

test(
  "attempts: a refused conversion keeps reading the old keys (a played date never looks missed) and retries on the next load; two tabs keep each other's dates",
  FAST,
  async () => {
    const st = fakeStorage(),
      rec = { solved: true, time: 12, sent: true, stats: null };
    await st.set('zip_gotd_attempt_20260919', JSON.stringify(rec));
    const refuse = {
      ...st,
      async set(k, v) {
        return k === GOTD_KEY ? false : st.set(k, v);
      },
    };
    const S = createStore(refuse, [5]);
    await S.hydrate('20260919');
    assert.deepStrictEqual(await S.loadAttempt('20260919'), rec, 'read from the old key');
    assert.ok(await st.get('zip_gotd_attempt_20260919'), 'and it is not removed');
    const S2 = createStore(st, [5]);
    await S2.hydrate('20260919');
    assert.deepStrictEqual(
      [await S2.loadAttempt('20260919'), (await st.keys('zip_gotd_attempt_')).length],
      [rec, 0],
      'the next load converts',
    );
    const A = createStore(st, [5]),
      B = createStore(st, [5]);
    await A.hydrate('20260919');
    await B.hydrate('20260919');
    await A.saveAttempt('20260920', { solved: false, time: null });
    await B.saveAttempt('20260921', { solved: true, time: 5 });
    assert.deepStrictEqual(Object.keys(JSON.parse((await st.get(GOTD_KEY)).value).a).sort(), [
      '20260919',
      '20260920',
      '20260921',
    ]);
  },
);

test(
  'stats-store: overlapping recordSolve and recordGotd (the app does not await the first) keep both; a corrupt entry or a stat without `recent` does not block or lose data',
  FAST,
  async () => {
    const st = fakeStorage(),
      S = createStore(st, [5]);
    await S.hydrate('20260919');
    S.recordSolve(5, 100, 10);
    await S.recordGotd(5, '20260919', 10, false, false);
    const b = JSON.parse((await st.get(STATS_KEY)).value);
    assert.deepStrictEqual(
      [b.t['5'][0], b.b['5']],
      [1, ['20260919', 10]],
      'neither write was lost',
    );
    await st.set(STATS_KEY, JSON.stringify({ v: 2, t: {}, d: { 5: null }, b: {} }));
    const S2 = createStore(st, [5]);
    await S2.hydrate('20260919');
    await S2.recordSolve(5, 100, 10);
    assert.deepStrictEqual(
      JSON.parse((await st.get(STATS_KEY)).value).t['5'][0],
      1,
      'a null entry is dropped, the write goes through',
    );
    const st3 = fakeStorage();
    await st3.set('zip_local_stats_5', JSON.stringify({ n: 3, mean: 10, M2: 2 }));
    const S3 = createStore(st3, [5]);
    await S3.hydrate('20260919');
    assert.deepStrictEqual(
      [S3.total(5).n, S3.total(5).recent],
      [3, []],
      'an old stat shape is kept',
    );
  },
);

test(
  'attempts: a stray or future-dated legacy key never wipes the replay window',
  FAST,
  async () => {
    const st = fakeStorage(),
      rec = JSON.stringify({ solved: true, time: 5 });
    for (const d of ['20260919', 'test', '20300101']) await st.set('zip_gotd_attempt_' + d, rec);
    const S = createStore(st, [5]);
    await S.hydrate('20260919');
    assert.deepStrictEqual(
      [!!S.attempt(), Object.keys(JSON.parse((await st.get(GOTD_KEY)).value).a).sort()],
      [true, ['20260919', '20300101']],
      'the malformed key goes, today stays',
    );
  },
);

test(
  'playlog: a refused conversion keeps the old history in memory and the next add writes it all',
  FAST,
  async () => {
    const st = fakeStorage(),
      old = JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({
          n: 5,
          ms: 5000,
          solved: true,
          hints: 0,
          mode: 'local',
          at: 1.7e12 + i * 6e4,
        })),
      );
    await st.set(PLAYLOG_LEGACY_KEY, old);
    let refuse = true;
    const port = {
      ...st,
      async set(k, v) {
        return refuse && k === PLAYLOG_KEY && v.length > 40 ? false : st.set(k, v);
      },
    };
    const L = createPlayLog(port);
    assert.deepStrictEqual((await L.all()).length, 5, 'history is available this session');
    refuse = false;
    await L.add({ n: 5, ms: 1, solved: true, hints: 0, mode: 'local', at: 1.8e12 });
    assert.deepStrictEqual(
      (await createPlayLog(st).all()).length,
      6,
      'all of it survives the next load',
    );
  },
);

test(
  'log-store: ratings and pairs round-trip through the compact format; the v1 keys are converted once and removed',
  FAST,
  async () => {
    const m1 = { 'grade: trap': 2.12346, decisionNodes: 4, B: 0.5 },
      m2 = { 'grade: trap': 1, B: 0.25, extra: 7 };
    const ratings = [
      { key: 'size 5\ncheckpoints\nwalls', human: 2.5, lo: 2, hi: 3, unsure: true, metrics: m1 },
      { key: 'size 6\ncheckpoints\nwalls', human: 1, metrics: null },
      { key: 'size 7', human: 3, lo: 3, hi: 3, metrics: m2, note: 'x' },
    ];
    const sorted = v =>
      JSON.stringify(v, (_k, x) =>
        x && typeof x === 'object' && !Array.isArray(x)
          ? Object.fromEntries(Object.entries(x).sort())
          : x,
      );
    assert.deepStrictEqual(
      sorted(unpackRatings(JSON.parse(JSON.stringify(packRatings(ratings))))),
      sorted(ratings),
      'extra fields included',
    );
    assert.deepStrictEqual(
      unpackRatings(
        packRatings([{ key: 'k', human: 1, metrics: { a: 1 / 3, b: 123456789, c: 1234.56789 } }]),
      )[0].metrics,
      { a: 0.333333, b: 123456789, c: 1234.57 },
      'non-integer metrics keep 6 significant digits, counts stay exact',
    );
    const pairs = [
      { a: 'A', b: 'B', cmp: 'harder', ma: m1, mb: m2 },
      { a: 'B', b: 'C', cmp: 'same', ma: m2, mb: null },
    ];
    assert.deepStrictEqual(
      unpackPairs(JSON.parse(JSON.stringify(packPairs(pairs)))),
      pairs,
      'pairs share their puzzles',
    );
    assert.deepStrictEqual(unpackRatings(null), []);
    assert.deepStrictEqual(
      unpackPairs({ v: 2, m: [], p: [], q: [[0, 1, 'same']] }),
      [],
      'a dangling pair index is dropped',
    );
    const s = await pickStorage();
    await s.set(RATING_KEY, '');
    await s.remove(RATING_KEY);
    await s.remove(PAIR_KEY);
    await s.set(RATING_KEY_V1, JSON.stringify(ratings));
    await s.set(PAIR_KEY_V1, JSON.stringify(pairs));
    assert.deepStrictEqual(
      sorted(await loadRatings()),
      sorted(ratings),
      'v1 ratings read back through the conversion',
    );
    assert.deepStrictEqual(await loadPairs(), pairs);
    assert.deepStrictEqual(
      [await s.get(RATING_KEY_V1), await s.get(PAIR_KEY_V1)],
      [null, null],
      'the old keys are removed',
    );
    assert.ok((await s.get(RATING_KEY)) && (await s.get(PAIR_KEY)));
    assert.deepStrictEqual(sorted(await loadRatings()), sorted(ratings), 'a second load reads v2');
    await s.set(PAIR_KEY_V1, '{broken');
    await s.remove(PAIR_KEY);
    assert.deepStrictEqual(await loadPairs(), [], 'a corrupt v1 value converts to an empty log');
    await saveRatings([]);
    await savePairs([]);
  },
);

test(
  'log-store: 300 rated puzzles with 25 metrics take under half of the v1 size',
  FAST,
  async () => {
    const names = Array.from({ length: 25 }, (_, i) => 'metric number ' + i),
      ratings = Array.from({ length: 300 }, (_, i) => ({
        key:
          'size 7\ncheckpoints ' +
          '0,4=5 2,0=2 4,6=4 5,3=1 '.repeat(3) +
          '\nwalls ' +
          'H,0,1 V,3,1 '.repeat(8),
        human: i % 6,
        lo: i % 6,
        hi: i % 6,
        metrics: Object.fromEntries(names.map((n, j) => [n, Math.sqrt(i + j)])),
      }));
    const v1 = JSON.stringify(ratings).length,
      v2 = JSON.stringify(packRatings(ratings)).length;
    assert.ok(v2 < v1 / 2, `v1 ${v1} -> v2 ${v2}`);
  },
);

test(
  "stats-store: a replay keeps today's record and the per-size Game-of-Day time; attemptOn reads any loaded date",
  FAST,
  async () => {
    const st = fakeStorage(),
      S = createStore(st, [5]);
    await S.hydrate('20260929');
    await S.recordGotd(5, '20260929', 42.1, true);
    assert.deepStrictEqual(S.gotdBest(5), { date: '20260929', time: 42.1 });
    await S.recordGotd(5, '20260920', 9.5, true, true);
    assert.deepStrictEqual(S.gotdBest(5), { date: '20260929', time: 42.1 });
    assert.deepStrictEqual(S.attempt(), { solved: true, time: 42.1, sent: false });
    assert.deepStrictEqual(S.attemptDate(), '20260929');
    assert.deepStrictEqual(S.attemptOn('20260920'), { solved: true, time: 9.5, sent: false });
    const S2 = createStore(st, [5]);
    await S2.hydrate('20260929');
    assert.deepStrictEqual(S2.attemptOn('20260920'), null, 'not loaded yet');
    assert.deepStrictEqual(await S2.loadAttempt('20260920'), {
      solved: true,
      time: 9.5,
      sent: false,
    });
  },
);
