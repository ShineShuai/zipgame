// Unit tests of the share link: codec, strip, receiver status, dev reveal.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { makePuzzle, maxNumber, ALGO_VERSION } from '../../src/core/model.js';
import { serialize } from '../../src/core/format.js';
import { dailySeed } from '../../src/core/rng.js';
import { step } from '../../src/core/rules.js';
import { generate, PLAY_SIZES } from '../../src/core/gen/generate.js';
import { runSync } from '../../src/core/run.js';
import { utcDayNumber, dateOfDay } from '../../src/features/daily.js';
import { REPLAY_DAYS } from '../../src/core/hist.js';
import { t as tr } from '../../src/ui/i18n.js';
import { newTrace, traceStep } from '../../src/features/playlog.js';
import { encodeShare, decodeShare, SHARE_VERSION, MAX_LEGS } from '../../src/core/share-code.js';
import {
  levelOf,
  legsUndo,
  legLevels,
  stripText,
  dayOfDate,
  makeShareRecord,
  shareUrl,
  parseShareLink,
  shareText,
  shareStatus,
  isPlayable,
  LEVEL_EMOJI,
} from '../../src/features/share.js';
import { generateCutout } from '../../src/core/gen/cutout.js';
import {
  devLinkMode,
  devLinkCode,
  devLinkUrl,
  tapCombo,
  loadPin,
  savePin,
  DEV_KEY,
} from '../../src/features/dev-reveal.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { atDay, fakeStorage } from './helpers.js';

const GOTD_REC = {
  kind: 'gotd',
  n: 7,
  grade: 3,
  timeS: 72.4,
  day: dayOfDate('20261007'),
  pct: 83,
  levels: [0, 0, 1, 0, 3, 2, 0],
};

const LOCAL_PUZZLE = runSync(generate(5, 123)); // a standard 5x5 game: the record carries its puzzle

const LOCAL_REC = {
  kind: 'local',
  variant: null,
  n: 5,
  grade: 2,
  timeS: 1234.5,
  levels: Array.from({ length: maxNumber(LOCAL_PUZZLE) - 1 }, (_, i) => i % 4),
  puzzle: LOCAL_PUZZLE,
};

const sameRec = (a, b) => {
  const flat = r =>
    JSON.stringify([
      r.kind,
      r.variant ?? null,
      r.n,
      r.grade,
      r.timeS,
      r.levels,
      [...r.puzzle.cp],
      [...r.puzzle.walls],
    ]);
  return flat(a) === flat(b);
};

t('share-code: Game of Day and local records round-trip; codes are URL-safe and short', () => {
  for (const rec of [
    GOTD_REC,
    { ...GOTD_REC, pct: null, grade: null },
    { ...GOTD_REC, pct: 0, grade: 0, n: 31 },
  ]) {
    const code = encodeShare(rec);
    ok(/^[A-Za-z0-9_-]+$/.test(code), code);
    eq(decodeShare(code), rec);
  }
  for (const rec of [LOCAL_REC, { ...LOCAL_REC, grade: null, levels: [] }]) {
    const code = encodeShare(rec);
    ok(/^[A-Za-z0-9_-]+$/.test(code), code);
    ok(sameRec(decodeShare(code), rec), 'the puzzle comes back with the record');
  }
  ok(encodeShare(GOTD_REC).length <= 14, 'a Game of Day with 7 legs is at most 14 characters');
  ok(encodeShare(LOCAL_REC).length <= 16, 'a standard 5x5 game is at most 16 characters');
  // compat pin: the version of the links already shared
  ok(SHARE_VERSION === 1, 'the Game of Day frame keeps version 1: its links stay valid');
});

t(
  'share-code: time is kept in tenths, clamped at 13107.1 s; a strip longer than 63 legs is dropped',
  () => {
    eq(decodeShare(encodeShare({ ...GOTD_REC, timeS: 72.44 })).timeS, 72.4);
    eq(decodeShare(encodeShare({ ...GOTD_REC, timeS: 1e6 })).timeS, 13107.1);
    eq(decodeShare(encodeShare({ ...GOTD_REC, levels: Array(MAX_LEGS + 1).fill(1) })).levels, []);
  },
);

t('share-code: out-of-range fields are not encoded', () => {
  for (const bad of [
    { n: 1 },
    { n: 32 },
    { grade: 6 },
    { timeS: 0 },
    { timeS: NaN },
    { day: -1 },
    { day: 65536 },
    { pct: 101 },
    { levels: [4] },
    { kind: 'x' },
  ])
    eq(encodeShare({ ...GOTD_REC, ...bad }), null, JSON.stringify(bad));
  for (const bad of [{ grade: 6 }, { timeS: 0 }, { n: 6 }, { levels: [4] }])
    eq(encodeShare({ ...LOCAL_REC, ...bad }), null, JSON.stringify(bad));
  eq(encodeShare(null), null);
});

t(
  'share-code: damaged codes are rejected (empty, truncated, extended, foreign characters, mistyped character)',
  () => {
    const code = encodeShare(GOTD_REC);
    for (const bad of [
      '',
      null,
      undefined,
      42,
      code.slice(0, -1),
      code + 'A',
      code + 'AA',
      code.slice(0, 5),
      code + '=',
      ' ' + code,
      'AAAAAAAAAAAAAA',
    ])
      eq(decodeShare(bad), null, String(bad));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let tried = 0,
      accepted = 0;
    for (let i = 0; i < code.length; i++)
      for (const ch of alphabet) {
        if (ch === code[i]) continue;
        tried++;
        if (decodeShare(code.slice(0, i) + ch + code.slice(i + 1))) accepted++;
      }
    ok(
      accepted / tried < 0.02,
      `an 8-bit check lets ~0.4% of single-character mistakes through, got ${accepted}/${tried}`,
    );
  },
);

t('dev link: a share-looking code, on and off apart, never an ordinary share', () => {
  const on = devLinkCode(true),
    off = devLinkCode(false);
  ok(
    on !== off && /^[A-Za-z0-9_-]{14}$/.test(on) && /^[A-Za-z0-9_-]{14}$/.test(off),
    'URL-safe, as long as a Game of Day with 7 legs',
  );
  eq(
    [devLinkMode(decodeShare(on)), devLinkMode(decodeShare(off))],
    ['on', 'off'],
    'it decodes like any share',
  );
  eq(decodeShare(on).day, 0, 'a day no game has');
  eq(devLinkUrl('https://x/p/', true), `https://x/p/?s=${on}`);
  for (const rec of [
    GOTD_REC,
    LOCAL_REC,
    null,
    undefined,
    { ...decodeShare(on), pct: 5 },
    { ...decodeShare(on), day: 1 },
  ])
    eq(devLinkMode(rec), null);
});

t(
  'dev reveal: 5 taps in a row, each within the gap, make the combo; a pause starts it over',
  () => {
    const tap = tapCombo(5, 500);
    eq([0, 300, 600, 900, 1200].map(tap), [false, false, false, false, true]);
    eq(
      [1500, 1800, 2100, 2400, 2700].map(tap),
      [false, false, false, false, true],
      'it starts over after a combo',
    );
    eq(
      [4000, 4300, 4600, 5200, 5500, 5800, 6100].map(tap),
      [false, false, false, false, false, false, false],
      'a 600 ms gap resets the count (fewer than 5 since)',
    );
    eq([6400].map(tap), [true], 'and 5 since the reset make one');
  },
);

ta("dev reveal: the pin is kept under one key as '1' and cleared by removing it", async () => {
  const st = fakeStorage();
  eq(await loadPin(st), false);
  await savePin(st, true);
  eq([await loadPin(st), (await st.get(DEV_KEY)).value], [true, '1']);
  await savePin(st, false);
  eq([await loadPin(st), await st.get(DEV_KEY)], [false, null]);
  await st.set(DEV_KEY, 'yes');
  eq(await loadPin(st), false, 'anything but 1 is not a pin');
  eq(
    await loadPin({
      get() {
        throw new Error('x');
      },
    }),
    false,
    'a failing store is no pin',
  );
});

t(
  'share: levelOf thresholds and legLevels (K-1 legs; extra legs merge into the last; none for K<2 or too many)',
  () => {
    eq([0, 1, 2, 3, 6, 7, 99].map(levelOf), [0, 1, 1, 2, 2, 3, 3]);
    eq(legLevels([2, undefined, 9], 3), [1, 3]); // leg 2 (index 2) is beyond K-1 = 2 legs: merged into the last
    eq(legLevels([], 4), [0, 0, 0]);
    eq([legLevels([1], 1), legLevels([1], 0), legLevels([], MAX_LEGS + 2)], [[], [], []]);
    eq(legLevels([], MAX_LEGS + 1).length, MAX_LEGS);
    eq(stripText([0, 1, 2, 3]), LEVEL_EMOJI.join(''));
  },
);

t(
  'share: legsUndo credits every removed cell to the leg it was drawn in (the cell that is checkpoint k+1 closes leg k)',
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[2] = 2;
    p.cp[8] = 3;
    const reset = [],
      a = [0, 1, 2, 5];
    legsUndo(reset, p, a, 1); // cells 1 and 2 are leg 0 (2 closes it), cell 5 is leg 1
    eq([reset[0], reset[1]], [2, 1]);
    const legs = [];
    legsUndo(legs, p, [0, 1, 4], 2);
    legsUndo(legs, p, [0, 1], 1); // two one-step undos inside leg 0
    eq([legs[0], legs[1]], [2, undefined]);
    const trunc = [];
    legsUndo(trunc, p, [0, 1, 2, 5, 4], 3); // cut back to the checkpoint: 5 and 4 are leg 1
    eq([trunc[0], trunc[1]], [undefined, 2]);
    const none = [];
    legsUndo(none, p, [0, 1, 2], 3);
    legsUndo(none, p, [], 0);
    eq(none.length, 0, 'nothing removed, nothing counted');
  },
);

t(
  'share: legsUndo agrees with the play trace (same moves through rules.step: total credited = cells undone)',
  () => {
    const p = makePuzzle(3);
    p.cp[0] = 1;
    p.cp[2] = 2;
    p.cp[8] = 3;
    const path = [],
      tr = newTrace(),
      legs = [];
    for (const c of [0, 1, 4, 1, 0, 3, 6, 7, 4, 1, 2, 5, 4, 5]) {
      const before = path.length,
        prev = path.slice(),
        k = step(p, path, c, { truncate: true });
      traceStep(tr, k, before, path.length);
      if (k && k !== 'push') legsUndo(legs, p, prev, path.length);
    }
    const credited = legs.reduce((a, v) => a + (v || 0), 0);
    ok(
      tr.backtracks === 2 && tr.undone === 5,
      'the moves include a run of two undos and a cut back of three cells',
    );
    eq(
      credited,
      tr.undone,
      'every cell taken back is credited to some leg (this sequence has no reset, which would also count the start cell)',
    );
  },
);

t(
  'share: makeShareRecord -> shareUrl -> parseShareLink round trip; the text carries head, time, percent, strip and the link',
  () => {
    const legs = [0, 1, 7];
    const sorted = o => Object.fromEntries(Object.entries(o).sort()); // key order is not part of the contract
    const g = makeShareRecord({
      gotdDate: '20261007',
      n: 7,
      grade: 3,
      timeS: 72.44,
      pct: 83,
      legs,
      K: 4,
    });
    eq(
      sorted(g),
      sorted({
        kind: 'gotd',
        n: 7,
        grade: 3,
        timeS: 72.4,
        levels: [0, 1, 3],
        day: dayOfDate('20261007'),
        pct: 83,
      }),
    );
    const url = shareUrl('https://x.example/zip/', g);
    ok(url.startsWith('https://x.example/zip/?s=') && !url.includes('%'), url);
    const parsed = parseShareLink(new URL(url).search);
    eq([sorted(parsed.rec), parsed.bad], [sorted(g), false]);
    eq(
      shareText(g, url, tr),
      `zigzag · Game of Day 2026-10-07 · 7x7 · Hard 3/5\n⏱ 72.4s · beat 83%\n🟩🟨🟥\n${url}`,
    );
    const l = makeShareRecord({
      gotdDate: null,
      n: 5,
      grade: null,
      timeS: 40,
      pct: null,
      legs: [],
      K: maxNumber(LOCAL_PUZZLE),
      puzzle: LOCAL_PUZZLE,
    });
    eq(
      sorted({ ...l, puzzle: null }),
      sorted({
        kind: 'local',
        variant: null,
        n: 5,
        grade: null,
        timeS: 40,
        levels: Array(maxNumber(LOCAL_PUZZLE) - 1).fill(0),
        puzzle: null,
      }),
    );
    ok(
      l.puzzle !== LOCAL_PUZZLE && l.puzzle.cp !== LOCAL_PUZZLE.cp,
      'the record holds a copy of the puzzle',
    );
    eq(shareText(l, 'U', tr), 'zigzag · 5x5\n⏱ 40.0s\n' + stripText(l.levels) + '\nU');
    eq(parseShareLink(''), { rec: null, bad: false });
    eq(parseShareLink('?s=garbage'), { rec: null, bad: true });
    ok(sameRec(parseShareLink('?lb=x&s=' + encodeShare(l)).rec, l));
    eq(dayOfDate(dateOfDay(20733)), 20733);
  },
);

t('share: shareStatus = what the receiver may do (live / replay / ok) or why not', () => {
  const clock = atDay(19),
    today = utcDayNumber(clock()),
    window = Array.from({ length: REPLAY_DAYS }, (_, i) => dateOfDay(today - 1 - i));
  const ctx = (attempt = null) => ({ today, replayDates: window, attempt, sizes: PLAY_SIZES });
  const day = k => ({ ...GOTD_REC, day: today - k });
  eq(shareStatus(day(0), ctx()).status, 'live');
  eq(shareStatus(day(1), ctx()).status, 'replay');
  eq(shareStatus(day(REPLAY_DAYS), ctx()).status, 'replay');
  eq(shareStatus(day(REPLAY_DAYS + 1), ctx()).status, 'old');
  eq(shareStatus(day(-1), ctx()).status, 'future');
  eq(shareStatus(day(0), ctx({ solved: true, time: 30 })).status, 'played');
  eq(shareStatus(day(3), ctx({ solved: false, time: null })).status, 'played');
  eq(
    shareStatus(day(-1), ctx({ solved: true, time: 30 })).status,
    'future',
    'a future date is refused before anything else',
  );
  eq(shareStatus(LOCAL_REC, ctx()).status, 'ok');
  eq(
    shareStatus({ ...LOCAL_REC, n: 3 }, ctx()).status,
    'invalid',
    'a size the generator does not serve',
  );
  eq(
    ['live', 'replay', 'ok', 'played', 'old', 'future', 'invalid'].map(status =>
      isPlayable({ status }),
    ),
    [true, true, true, false, false, false, false],
  );
});

t(
  'share: the local seed a link names is the seed the game was made with (day, size, index, version -> same puzzle)',
  () => {
    const day = 20733,
      n = 5,
      index = 3,
      seed = dailySeed(day, n, index, ALGO_VERSION);
    const g = generate(n, seed),
      h = generate(n, dailySeed(day, n, index, ALGO_VERSION));
    eq(serialize(runSync(g)), serialize(runSync(h)));
    ok(
      dailySeed(day - 1, n, index, ALGO_VERSION) !== seed &&
        dailySeed(day, n, index + 1, ALGO_VERSION) !== seed,
    );
  },
);

t(
  'share-code: a Cutout record is refused when its puzzle is unsound (unbalanced, checkpoint on a hole, wall at a hole, a gap in the numbers)',
  () => {
    const good = runSync(generateCutout(6, 8, { boards: 1, effort: 0.1 }));
    const rec = puzzle =>
      makeShareRecord({
        n: 6,
        timeS: 5,
        legs: [],
        K: Math.max(2, Object.values(puzzle.cp).filter(Boolean).length),
        variant: 'cutout',
        puzzle,
      });
    ok(encodeShare(rec(good)) !== null);
    const flat = new Uint8Array(36),
      withCp = (a, b) => {
        const q = {
          ...good,
          holes: flat.slice(),
          cp: new Uint16Array(36),
          walls: new Uint8Array(36),
        };
        q.cp[a] = 1;
        q.cp[b] = 2;
        return q;
      };
    ok(encodeShare(rec(withCp(0, 35))) !== null);
    const odd = withCp(0, 35);
    odd.holes[1] = 1;
    odd.holes[3] = 1;
    odd.holes[5] = 1;
    ok(encodeShare(rec(odd)) === null, 'three holes of one colour');
    const onHole = withCp(0, 35);
    onHole.holes[0] = 1;
    onHole.holes[1] = 1;
    ok(encodeShare(rec(onHole)) === null, 'checkpoint on a hole');
    const wallHole = withCp(0, 35);
    wallHole.holes[7] = 1;
    wallHole.holes[10] = 1;
    wallHole.walls[6] = 1;
    ok(encodeShare(rec(wallHole)) === null, 'wall at a hole');
    const gap = withCp(0, 35);
    gap.cp[35] = 3;
    ok(encodeShare(rec(gap)) === null, 'numbering has a gap');
  },
);

registerAsyncTests();
