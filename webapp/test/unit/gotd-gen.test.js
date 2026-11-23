// Tests of the automatic Game of Day: the size schedule (core/gotd-schedule.js), the gates a
// candidate passes (core/gotd-gen.js), the queue (core/gotd-queue.js), and the human side of it:
// rating widget rules, the verdict file, the review plan, applying verdicts, promotion planning
// and the published day's text (core/gotd-verdict.js, planReview and planPromote of
// core/gotd-queue.js, publishedText and the holdGrade gate of core/gotd-gen.js). The command line
// is tested in test/gotd-gen-cli.test.js, the design app panel (apps/design/gotd-review.js) end to
// end elsewhere.
import '../setup-balls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAST, SLOW } from '../harness.js';
import { readFileSync } from 'node:fs';
import { makePuzzle } from '../../src/core/model.js';
import { setWallId } from '../../src/core/edges.js';
import { serialize, parse, commentTimes } from '../../src/core/format.js';
import { symmetryKey, ratingKey, transformPuzzle } from '../../src/core/ratings-io.js';
import { runSync } from '../../src/core/run.js';
import { generateTargeted } from '../../src/core/gen/target.js';
import { TRAP_MODEL } from '../../src/core/trap.js';
import { utcDayNumber, dateOfDay as dailyDateOfDay } from '../../src/features/daily.js';
import {
  CYCLE_DAYS,
  SIZE_BAG,
  BIG_SIZE,
  BIG_GAP,
  sizeForDay,
  cycleOrder,
  orderOk,
  slotSeed,
  dayOfDate,
  dateOfDay,
} from '../../src/core/gotd-schedule.js';
import {
  GOTD_CFG,
  stampParts,
  genStamp,
  createDistinct,
  pathKey,
  puzzleId,
  hash64,
  vetCandidate,
  makeCandidate,
  candidateText,
  candidateFile,
  carriedOrigin,
  publishedText,
} from '../../src/core/gotd-gen.js';
import {
  emptyIndex,
  parseIndex,
  formatIndex,
  planFill,
  fillQueue,
  applyFill,
  restampQueue,
  usable,
  queueStatus,
  planPromote,
  planReview,
  reviewSpan,
  scanPublished,
} from '../../src/core/gotd-queue.js';
import {
  APPROVE_MIN,
  nextSelection,
  nextLean,
  toggleUnsure,
  decide,
  createTakebacks,
  makeVerdict,
  verdictProblem,
  formatVerdicts,
  parseVerdicts,
  mergeVerdicts,
  verdictConflicts,
  harvestRatings,
  applyVerdicts,
  reviewStats,
} from '../../src/core/gotd-verdict.js';

// ---- schedule, gates and the queue

// 20261121 .. 20261220: the schedule is part of the product (a published day never changes, a future day is decided by this function), so it is pinned.
const GOLDEN_SCHEDULE = '11,7,8,8,6,9,7,8,7,10,8,6,8,7,9,11,9,7,8,10,8,7,6,7,10,7,8,10,8,7';

const SNAKE4 = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
const SPIRAL4 = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4, 5, 6, 10, 9];
const asymmetric = () => {
  // a 5x5 puzzle with no symmetry of its own (validity is not needed for keys)
  const p = makePuzzle(5);
  [
    [0, 1],
    [7, 2],
    [13, 3],
    [24, 4],
  ].forEach(([cell, k]) => {
    p.cp[cell] = k;
  });
  setWallId(p.walls, 3, true);
  setWallId(p.walls, 17, true);
  return p;
};

test(
  'gotd schedule: every cycle holds exactly SIZE_BAG days of each size, in an accepted order',
  FAST,
  () => {
    assert.deepStrictEqual(
      Object.values(SIZE_BAG).reduce((a, b) => a + b, 0),
      CYCLE_DAYS,
    );
    for (let cycle = 0; cycle < 800; cycle++) {
      const order = cycleOrder(cycle),
        count = {};
      for (const n of order) count[n] = (count[n] || 0) + 1;
      assert.deepStrictEqual(count, SIZE_BAG, `cycle ${cycle}`);
      assert.ok(orderOk(order), `cycle ${cycle}`);
    }
  },
);

test(
  'gotd schedule: big sizes are at least BIG_GAP days apart and no size runs three days, also across cycle boundaries',
  FAST,
  () => {
    let lastBig = -1e9;
    for (let day = 0; day < 800 * CYCLE_DAYS; day++) {
      const n = sizeForDay(day);
      if (n >= BIG_SIZE) {
        assert.ok(day - lastBig >= BIG_GAP, `day ${day}: big sizes ${day - lastBig} days apart`);
        lastBig = day;
      }
      if (day >= 2)
        assert.ok(
          !(n === sizeForDay(day - 1) && n === sizeForDay(day - 2)),
          `day ${day}: three days of ${n}`,
        );
    }
  },
);

test(
  'gotd schedule: a pure function of the date, pinned: 20261121..20261220 are the golden sizes',
  FAST,
  () => {
    const d0 = dayOfDate('20261121'),
      sizes = Array.from({ length: 30 }, (_, i) => sizeForDay(d0 + i));
    assert.deepStrictEqual(
      sizes.join(','),
      GOLDEN_SCHEDULE,
      'the schedule changed: only on purpose (see the top of core/gotd-schedule.js)',
    );
    assert.deepStrictEqual(
      Array.from({ length: 30 }, (_, i) => sizeForDay(d0 + i)),
      sizes,
      'the second call (a cached cycle) gives the same sizes',
    );
    assert.deepStrictEqual(
      cycleOrder(Math.floor(d0 / CYCLE_DAYS)),
      cycleOrder(Math.floor(d0 / CYCLE_DAYS)),
    );
  },
);

test(
  'gotd schedule: 7 and 8 are the most frequent sizes, then 6 and 9 (less), 10 and 11 occasionally; 11 the rarest',
  FAST,
  () => {
    const c = SIZE_BAG;
    assert.ok(c[7] > c[6] && c[7] > c[9] && c[8] > c[6] && c[8] > c[9], '7 and 8 beat 6 and 9');
    assert.ok(
      c[9] > c[10] && c[6] >= c[10] && c[10] > c[11] && Math.min(...Object.values(c)) === c[11],
      '11 is the rarest',
    );
    assert.deepStrictEqual(Object.keys(c).map(Number), [6, 7, 8, 9, 10, 11]);
    const per = 28 * 100,
      seen = {};
    for (let day = 0; day < per; day++) seen[sizeForDay(day)] = (seen[sizeForDay(day)] || 0) + 1;
    assert.deepStrictEqual(
      seen,
      Object.fromEntries(Object.entries(c).map(([n, k]) => [n, k * 100])),
      'exact shares over 100 cycles',
    );
  },
);

test('gotd schedule: orderOk refuses what the rules refuse', FAST, () => {
  const base = [
    7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9,
  ];
  assert.ok(orderOk(base));
  const put = (i, v) => {
    const s = base.slice();
    s[i] = v;
    return s;
  };
  assert.ok(!orderOk(put(0, 10)), 'big first');
  assert.ok(!orderOk(put(27, 11)), 'big last');
  assert.ok(!orderOk(put(5, 10).map((v, i) => (i === 6 ? 11 : v))), 'two bigs next to each other');
  assert.ok(!orderOk(put(5, 10).map((v, i) => (i === 7 ? 11 : v))), 'two bigs two days apart');
  assert.ok(orderOk(put(5, 10).map((v, i) => (i === 8 ? 11 : v))), 'two bigs BIG_GAP days apart');
  assert.ok(
    !orderOk(put(10, 8).map((v, i) => (i === 9 ? 8 : i === 11 ? 8 : v))),
    'a run of three',
  );
  assert.ok(!orderOk(put(1, 7)), 'an equal pair at the start');
  assert.ok(!orderOk(put(26, 9)), 'an equal pair at the end');
});

test(
  'gotd dates: dayOfDate / dateOfDay are the day numbers of features/daily.js, and bad dates are refused',
  FAST,
  () => {
    for (const date of ['20260101', '20260228', '20240229', '20261231', '20270301']) {
      const day = dayOfDate(date);
      assert.deepStrictEqual(
        day,
        utcDayNumber(new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6)))),
        date,
      );
      assert.deepStrictEqual(dateOfDay(day), date);
      assert.deepStrictEqual(dateOfDay(day), dailyDateOfDay(day));
    }
    for (const bad of ['2026-11-04', '2026113', '20261301', '20260230', '20250229', '']) {
      let message = '';
      try {
        dayOfDate(bad);
      } catch (e) {
        message = e.message;
      }
      assert.ok(message, `${JSON.stringify(bad)} must be refused`);
    }
  },
);

test(
  'gotd seed: an integer that is the same every time and changes with every argument',
  FAST,
  () => {
    const base = slotSeed('a6-x', 20261, 8, 0);
    assert.deepStrictEqual(base, slotSeed('a6-x', 20261, 8, 0));
    assert.ok(Number.isInteger(base) && base >= 0 && base < 2 ** 32);
    // pinned: the same on every machine and in every process (a candidate is made again from it)
    assert.deepStrictEqual([base, slotSeed('a6-x', 20261, 8, 1)], [60857558, 77635177]);
    const others = [
      slotSeed('a6-y', 20261, 8, 0),
      slotSeed('a6-x', 20262, 8, 0),
      slotSeed('a6-x', 20261, 9, 0),
      slotSeed('a6-x', 20261, 8, 1),
    ];
    assert.deepStrictEqual(new Set([base, ...others]).size, 5);
  },
);

test(
  'gotd stamp: the same parts give the same stamp; the trap model, the settings or the algorithm version change it',
  FAST,
  () => {
    const parts = stampParts();
    assert.ok(/^a\d+-[0-9a-f]{8}$/.test(genStamp()), genStamp());
    assert.deepStrictEqual(genStamp(parts), genStamp(stampParts()));
    const refit = {
      ...parts,
      model: { ...TRAP_MODEL, cuts: TRAP_MODEL.cuts.map(c => c + 0.01) },
    };
    const margin = { ...parts, gotd: { ...parts.gotd, margin: 0.4 } };
    const algo = { ...parts, algo: parts.algo + 1 };
    assert.deepStrictEqual(
      new Set([genStamp(parts), genStamp(refit), genStamp(margin), genStamp(algo)]).size,
      4,
    );
  },
);

test(
  'format: serialize(p, { comments }) writes # lines that parse() and ratingKey() ignore',
  FAST,
  () => {
    const p = asymmetric(),
      plain = serialize(p),
      noted = serialize(p, { comments: ['gotd candidate abc', 'gen x slot 1'] });
    assert.ok(noted.includes('# gotd candidate abc\n# gen x slot 1\nsize 5'), noted);
    assert.deepStrictEqual(ratingKey(noted), ratingKey(plain));
    assert.deepStrictEqual(serialize(parse(noted)), plain);
    assert.deepStrictEqual(serialize(p, {}), plain);
  },
);

test(
  'gotd distinct: all 16 symmetries of a puzzle (rotation, reflection, reversed numbering) conflict; another puzzle does not',
  FAST,
  () => {
    const p = asymmetric(),
      d = createDistinct();
    d.add({ symKey: symmetryKey(p), where: 'the original' });
    assert.deepStrictEqual(d.size, 1);
    for (const rev of [false, true]) {
      for (let k = 0; k < 8; k++) {
        const c = d.conflict(symmetryKey(transformPuzzle(p, k, rev)));
        assert.deepStrictEqual(c, { kind: 'puzzle', where: 'the original' }, `k=${k} rev=${rev}`);
      }
    }
    const other = asymmetric();
    other.cp[24] = 0;
    other.cp[23] = 4;
    assert.deepStrictEqual(d.conflict(symmetryKey(other)), null);
    d.add({ symKey: symmetryKey(p), where: 'a second add does not replace the first' });
    assert.deepStrictEqual(d.conflict(symmetryKey(p)).where, 'the original');
  },
);

test(
  'gotd distinct: the same solution path is found under every symmetry; another path is not',
  FAST,
  () => {
    const key = pathKey(4, SNAKE4);
    assert.ok(/^[0-9a-f]{16}$/.test(key));
    assert.deepStrictEqual(pathKey(4, SNAKE4.slice().reverse()), key, 'a path read backwards');
    const columns = SNAKE4.map(c => (c % 4) * 4 + ((c / 4) | 0)); // the snake turned a quarter: rows become columns
    assert.deepStrictEqual(pathKey(4, columns), key, 'the snake turned');
    assert.ok(pathKey(4, SPIRAL4) !== key, 'a spiral is another path');
    const d = createDistinct();
    d.add({ pathKey: key, where: 'a published puzzle' });
    assert.deepStrictEqual(d.conflict('some other puzzle', pathKey(4, columns)), {
      kind: 'path',
      where: 'a published puzzle',
    });
    assert.deepStrictEqual(d.conflict('some other puzzle', pathKey(4, SPIRAL4)), null);
    assert.deepStrictEqual(d.conflict('some other puzzle'), null);
  },
);

// Two candidates of size 7. The frozen one is in the queue of test/fixtures/gotd-queue, as `fill` once made it: the fast tests of the
// file format and of the gates use it. The generated one is made when a slow test asks (the generator under the GOTD settings and
// the gates; several runs of the generator, about 7 s), once for the file.
const stamp = 'a6-test',
  day = dayOfDate('20261122');
let frozenOnce = null,
  generatedOnce = null;
const frozen = () => {
  if (!frozenOnce) {
    const dir = new URL('../fixtures/gotd-queue/', import.meta.url);
    const entry = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).candidates.find(
      c => c.size === 7,
    );
    const text = readFileSync(new URL(entry.file, dir), 'utf8');
    const puzzle = parse(text);
    frozenOnce = { entry, puzzle, origin: carriedOrigin(text), symKey: symmetryKey(puzzle) };
  }
  return frozenOnce;
};
const generated = () => {
  for (let attempt = 0, distinct = createDistinct(); attempt < 8 && !generatedOnce; attempt++) {
    const r = makeCandidate({ stamp, day, date: '20261122', size: 7, attempt, distinct });
    if (r.ok) generatedOnce = r;
  }
  return generatedOnce;
};
test(
  'gotd candidate: a 7x7 slot yields a candidate that is Hard or harder with margin, unique, and recorded in the queue entry',
  SLOW,
  () => {
    const made = generated();
    assert.ok(made, 'no candidate in 8 generator runs');
    const e = made.entry;
    assert.ok(/^[0-9a-f]{12}$/.test(e.id) && e.id === puzzleId(made.symKey), e.id);
    assert.deepStrictEqual(
      [e.size, e.slot, e.stamp, e.status, e.file],
      [7, '20261122', stamp, 'pending', candidateFile(e)],
    );
    assert.deepStrictEqual(e.file, `c-7-${e.id}.txt`);
    assert.ok(e.trap.grade >= GOTD_CFG.grade, `grade ${e.trap.grade}`);
    assert.ok(
      e.trap.pred >= TRAP_MODEL.cuts[GOTD_CFG.grade - 1] + 0.4 * 0.5 &&
        Number.isFinite(e.trap.max) &&
        Number.isFinite(e.corr.wideFrac),
      JSON.stringify(e),
    );
    assert.deepStrictEqual(e.seed, slotSeed(stamp, day, 7, e.attempt));
    assert.ok(e.K >= 7 && e.walls >= 0 && /^[0-9a-f]{16}$/.test(e.pathKey));
  },
);

const NOT_TIMED = text => text.replace(/, \d+\.\d s,/, ', X s,'); // the seconds are the one thing in a candidate's file that depends on the machine

test(
  'gotd candidate: the file is the puzzle, a line naming the candidate and the origin lines, no solution path; it parses back to the same puzzle',
  FAST,
  () => {
    const made = frozen(),
      e = made.entry,
      text = candidateText(made.puzzle, e, made.origin);
    assert.ok(
      text.endsWith('\n') && !/^path /m.test(text),
      'no path line: a reviewer plays it blind',
    );
    const lines = text
      .split('\n')
      .filter(l => l.startsWith('# '))
      .slice(-3);
    assert.deepStrictEqual(
      lines[0],
      `# gotd candidate ${e.id} for ${e.slot}, attempt ${e.attempt}`,
    );
    assert.ok(
      /^# seed \d+: grade \d \(target 3\+, inside the margin\), \d+ walls, \d+ checkpoints, \d+\.\d s, \d+ changes, \d+ tries$/.test(
        lines[1],
      ),
      lines[1],
    );
    assert.deepStrictEqual(
      lines[2],
      `# gen ${e.stamp}: node tools/gen-target.mjs --size 7 --grade 3 --at-least --margin 0.5 --retries 12 --seed ${e.seed}`,
    );
    assert.ok(
      lines[1].startsWith(`# seed ${e.seed}: `),
      "the seed of the summary line is the candidate's",
    );
    assert.deepStrictEqual(symmetryKey(parse(text)), made.symKey);
    assert.deepStrictEqual(ratingKey(text), ratingKey(serialize(made.puzzle)));
    assert.deepStrictEqual(
      candidateText(made.puzzle, made.entry).includes('# seed'),
      false,
      'without origin only the first line',
    );
  },
);

test(
  'gotd candidate: carriedOrigin takes the seed and gen lines of a candidate file (also the one gen line of the first queue files), nothing else',
  FAST,
  () => {
    const made = frozen(),
      text = candidateText(made.puzzle, made.entry, made.origin);
    assert.deepStrictEqual(carriedOrigin(text), made.origin);
    assert.deepStrictEqual(carriedOrigin(serialize(made.puzzle)), []);
    assert.deepStrictEqual(
      carriedOrigin(
        '# Zip Puzzle\n# gotd candidate x\n# gen a6-t slot 20261122 seed 5 attempt 0\nsize 7\n',
      ),
      ['gen a6-t slot 20261122 seed 5 attempt 0'],
    );
    assert.deepStrictEqual(
      carriedOrigin('# seed 1: grade 3\r\n# genetics are not\r\n# gen a6-x: node\r\n'),
      ['seed 1: grade 3', 'gen a6-x: node'],
    );
  },
);

test(
  'gotd candidate: the same arguments give the same candidate, text and entry (the seconds apart)',
  SLOW,
  () => {
    const made = generated(),
      again = makeCandidate({
        stamp,
        day,
        date: '20261122',
        size: 7,
        attempt: made.entry.attempt,
        distinct: createDistinct(),
      });
    assert.ok(again.ok);
    assert.deepStrictEqual(
      NOT_TIMED(candidateText(again.puzzle, again.entry, again.origin)),
      NOT_TIMED(candidateText(made.puzzle, made.entry, made.origin)),
    );
    assert.deepStrictEqual(again.entry, made.entry);
  },
);

// The grade a puzzle needs depends on the fitted model (tools/fit-trap.mjs refits it when the labels change), so the tests of the
// other gates hold the grade (holdGrade) and the frozen puzzle does not have to be Hard under every model.
test(
  'gotd gates: a duplicate (also rotated, mirrored or reversed) and a repeated solution path are refused with the reason',
  FAST,
  () => {
    const { puzzle, entry, symKey } = frozen();
    const d = createDistinct();
    d.add({ symKey, pathKey: entry.pathKey, where: 'queue candidate x' });
    assert.deepStrictEqual(vetCandidate(puzzle, 7, d), {
      ok: false,
      reason: 'duplicate',
      detail: 'queue candidate x',
    });
    const turned = transformPuzzle(puzzle, 3, true);
    assert.deepStrictEqual(
      vetCandidate(turned, 7, d).reason,
      'duplicate',
      'the same puzzle turned and numbered backwards',
    );
    const onlyPath = createDistinct();
    onlyPath.add({ pathKey: entry.pathKey, where: 'a published puzzle' });
    assert.deepStrictEqual(vetCandidate(puzzle, 7, onlyPath, { holdGrade: true }), {
      ok: false,
      reason: 'duplicate-path',
      detail: 'a published puzzle',
    });
  },
);

test(
  'gotd gates: a puzzle that passes is described by an entry with its id, size, checkpoints, walls and path key',
  FAST,
  () => {
    const { puzzle, entry } = frozen();
    const r = vetCandidate(puzzle, 7, createDistinct(), { holdGrade: true });
    assert.ok(r.ok, JSON.stringify(r));
    const { id, size, K, walls, pathKey: key } = r.entry;
    assert.deepStrictEqual(
      { id, size, K, walls, pathKey: key },
      { id: entry.id, size: 7, K: entry.K, walls: entry.walls, pathKey: entry.pathKey },
    );
  },
);

test('gotd gates: the wrong size and an invalid puzzle are refused with the reason', FAST, () => {
  assert.deepStrictEqual(vetCandidate(frozen().puzzle, 8, createDistinct()).reason, 'size');
  assert.deepStrictEqual(vetCandidate(makePuzzle(7), 7, createDistinct()).reason, 'invalid');
});

test(
  'gotd gates: a generated candidate passes, and an easy puzzle is refused (grade), not accepted',
  SLOW,
  () => {
    const made = generated();
    const accepted = vetCandidate(made.puzzle, 7, createDistinct());
    assert.ok(accepted.ok, JSON.stringify(accepted).slice(0, 120));
    assert.deepStrictEqual(accepted.entry, {
      id: made.entry.id,
      size: 7,
      K: made.entry.K,
      walls: made.entry.walls,
      pathKey: made.entry.pathKey,
      trap: made.entry.trap,
      corr: made.entry.corr,
    });
    const easy = runSync(generateTargeted(7, 1, 5, { retries: 3 })).puzzle;
    const r = vetCandidate(easy, 7, createDistinct());
    assert.ok(
      !r.ok && (r.reason === 'grade' || r.reason === 'margin'),
      `an easy puzzle gave ${JSON.stringify(r).slice(0, 120)}`,
    );
  },
);

// ---- queue: planner, fill loop, index ----
const queueCand = (id, size, slot, over = {}) => ({
  id,
  file: `c-${size}-${id}.txt`,
  size,
  slot,
  attempt: 0,
  seed: 1,
  stamp: 'S',
  status: 'pending',
  ...over,
});
const id12 = n => String(n).padStart(12, '0');
const today = dayOfDate('20261121');
const sizeOn = date => sizeForDay(dayOfDate(date));

test(
  'gotd plan: open days from today, none that has a file, each with the size of the schedule and the runs already spent',
  FAST,
  () => {
    const index = emptyIndex();
    index.slots['20261123'] = { size: sizeOn('20261123'), attempts: 4 };
    const plan = planFill({
      today,
      horizon: 5,
      perSlot: 2,
      published: new Set(['20261122']),
      index,
      stamp: 'S',
    });
    assert.deepStrictEqual(
      plan.slots.map(s => s.date),
      ['20261121', '20261123', '20261124', '20261125'],
    );
    assert.deepStrictEqual(
      plan.slots.map(s => s.size),
      plan.slots.map(s => sizeOn(s.date)),
    );
    assert.deepStrictEqual(
      plan.slots.map(s => [s.have, s.need, s.attempts]),
      [
        [0, 2, 0],
        [0, 2, 4],
        [0, 2, 0],
        [0, 2, 0],
      ],
    );
    assert.deepStrictEqual(plan.adopt, []);
  },
);

test(
  'gotd plan: pending candidates count under the current stamp only, approved ones always, rejected ones never',
  FAST,
  () => {
    const date = '20261121',
      size = sizeOn(date),
      index = emptyIndex();
    index.candidates = [
      queueCand(id12(1), size, date),
      queueCand(id12(2), size, date, { stamp: 'OLD' }),
      queueCand(id12(3), size, date, { stamp: 'OLD', status: 'approved' }),
      queueCand(id12(4), size, date, { status: 'rejected' }),
    ];
    const plan = planFill({
      today,
      horizon: 1,
      perSlot: 3,
      published: new Set(),
      index,
      stamp: 'S',
    });
    assert.deepStrictEqual([plan.slots[0].have, plan.slots[0].need], [2, 1]);
    assert.ok(
      usable(index.candidates[0], 'S') &&
        !usable(index.candidates[1], 'S') &&
        usable(index.candidates[2], 'S') &&
        !usable(index.candidates[3], 'S'),
    );
  },
);

test(
  'gotd status: per size the candidates of this stamp, of an older one, approved and rejected; the review plan; the stock of each day',
  FAST,
  () => {
    const index = emptyIndex();
    index.candidates = [
      queueCand(id12(1), 7, '20261122'), // this stamp: stock, offered for the 7x7 day
      queueCand(id12(2), 7, '20261122', { stamp: 'OLD' }), // an older stamp: neither stock nor offered
      queueCand(id12(3), 8, '20261123', { stamp: 'OLD', status: 'approved' }), // approved: stock whatever its stamp, and it covers 20261123
      queueCand(id12(4), 8, '20261123', { status: 'rejected' }),
      queueCand(id12(5), 8, '20261123'), // this stamp, but no open 8x8 day is left: extra
    ];
    const status = queueStatus({
      today,
      horizon: 3,
      published: new Set(),
      index,
      verdicts: [],
      stamp: 'S',
      sizes: [7, 8],
    });
    assert.deepStrictEqual(status.bySize, [
      { size: 7, pending: 1, older: 1, approved: 0, rejected: 0 },
      { size: 8, pending: 1, older: 0, approved: 1, rejected: 1 },
    ]);
    assert.deepStrictEqual(
      status.review,
      { count: 2, fit: 1, extra: 1, open: 2, span: 3 },
      'open: 20261121 (11x11) and 20261122; 20261123 has its approved one',
    );
    assert.deepStrictEqual(status.stock, { 20261122: 1, 20261123: 2 });
    // the same queue under another stamp: the stamp is all that changes the counts
    const other = queueStatus({
      today,
      horizon: 3,
      published: new Set(),
      index,
      verdicts: [],
      stamp: 'OLD',
      sizes: [7, 8],
    });
    assert.deepStrictEqual(
      other.bySize.map(c => [c.pending, c.older]),
      [
        [1, 1],
        [0, 1],
      ],
    );
    assert.deepStrictEqual(other.stock, { 20261122: 1, 20261123: 1 });
  },
);

test(
  'gotd plan: candidates of a day that is published (or past) move to the earliest open day of their size that lacks candidates',
  FAST,
  () => {
    assert.deepStrictEqual(
      [sizeOn('20261122'), sizeOn('20261123'), sizeOn('20261124')],
      [7, 8, 8],
      'the golden schedule this test is written for',
    );
    const published = new Set(['20261123']),
      index = emptyIndex();
    index.candidates = [
      queueCand(id12(1), 8, '20261123'),
      queueCand(id12(2), 8, '20261123', { attempt: 1 }),
      queueCand(id12(3), 7, '20261123'),
    ];
    const plan = planFill({ today, horizon: 6, perSlot: 1, published, index, stamp: 'S' });
    assert.deepStrictEqual(
      plan.adopt,
      [
        { id: id12(3), slot: '20261122' },
        { id: id12(1), slot: '20261124' },
      ],
      'days in order; a candidate only goes to a day of its size; the second 8 has no day left',
    );
    assert.deepStrictEqual(
      plan.slots.filter(s => ['20261122', '20261124'].includes(s.date)).map(s => [s.have, s.need]),
      [
        [1, 0],
        [1, 0],
      ],
    );
    const next = applyFill(index, plan, { slots: {}, added: [] });
    assert.deepStrictEqual(
      next.candidates.map(c => [c.id, c.slot]),
      [
        [id12(1), '20261124'],
        [id12(2), '20261123'],
        [id12(3), '20261122'],
      ].sort((a, b) => (a[1] < b[1] ? -1 : 1)),
    );
    assert.deepStrictEqual(
      planFill({ today, horizon: 6, perSlot: 1, published, index: next, stamp: 'S' }).adopt,
      [],
      'nothing left to move',
    );
    assert.deepStrictEqual(
      planFill({ today, horizon: 6, perSlot: 2, published, index: next, stamp: 'S' }).adopt,
      [{ id: id12(2), slot: '20261124' }],
      'with 2 wanted per day the second 8 finds its day',
    );
    assert.deepStrictEqual(
      planFill({
        today,
        horizon: 6,
        perSlot: 1,
        published: new Set(),
        index: { ...emptyIndex(), candidates: [queueCand(id12(9), 8, '20261120')] },
        stamp: 'S',
      }).adopt,
      [{ id: id12(9), slot: '20261123' }],
      'a candidate of a past day moves too',
    );
  },
);

// a stand-in for the generator: attempt 1 of every day fails the margin gate, the others succeed
let made1 = 0;
const stub = ({ stamp: st, date, size, attempt, distinct }) => {
  if (attempt === 1) return { ok: false, reason: 'margin', detail: 'score too low' };
  const id = hash64(`${date}:${attempt}`).slice(0, 12);
  made1++;
  assert.ok(!distinct.conflict(`key ${id}`), 'a stand-in puzzle is new');
  return {
    ok: true,
    symKey: `key ${id}`,
    path: [],
    puzzle: makePuzzle(size),
    entry: {
      ...queueCand(id, size, date, { attempt, stamp: st }),
      pathKey: id,
      trap: { pred: 2.3, grade: 3 },
    },
  };
};

test(
  'gotd fill: runs only the missing candidates, counts failed runs per reason, continues the attempt numbers, stops at maxNew / maxAttempts',
  FAST,
  () => {
    const index = emptyIndex();
    index.slots['20261121'] = { size: sizeOn('20261121'), attempts: 2 };
    const plan = planFill({
      today,
      horizon: 3,
      perSlot: 2,
      published: new Set(),
      index,
      stamp: 'S',
    });
    const r = fillQueue({
      plan,
      distinct: createDistinct(),
      stamp: 'S',
      maxNew: 100,
      maxAttempts: 100,
      make: stub,
    });
    assert.deepStrictEqual(r.added.length, 6);
    assert.deepStrictEqual(
      r.fails,
      { margin: 2 },
      'attempt 1 of the two days that start at 0 fails',
    );
    assert.deepStrictEqual(
      r.added.filter(a => a.entry.slot === '20261121').map(a => a.entry.attempt),
      [2, 3],
      'the first day continues after the 2 runs spent',
    );
    assert.deepStrictEqual(
      r.added.filter(a => a.entry.slot === '20261122').map(a => a.entry.attempt),
      [0, 2],
    );
    assert.deepStrictEqual(r.slots['20261121'], {
      size: sizeOn('20261121'),
      attempts: 4,
      stamp: 'S',
    });
    assert.deepStrictEqual(r.slots['20261122'].attempts, 3);
    assert.deepStrictEqual(r.starved, []);
    const few = fillQueue({
      plan,
      distinct: createDistinct(),
      stamp: 'S',
      maxNew: 3,
      make: stub,
    });
    assert.deepStrictEqual(few.added.length, 3, 'maxNew');
    const runs = fillQueue({
      plan,
      distinct: createDistinct(),
      stamp: 'S',
      maxAttempts: 4,
      make: stub,
    });
    assert.deepStrictEqual(runs.tries, 4, 'maxAttempts');
    assert.deepStrictEqual(
      fillQueue({ plan, distinct: createDistinct(), stamp: 'S', maxNew: 0, make: stub }).added,
      [],
    );
  },
);

test(
  'gotd fill: a day that used all its runs is starved; a rerun on the stored index adds nothing (idempotent)',
  FAST,
  () => {
    const never = () => ({ ok: false, reason: 'grade', detail: '' });
    const plan = planFill({
      today,
      horizon: 1,
      perSlot: 1,
      published: new Set(),
      index: emptyIndex(),
      stamp: 'S',
    });
    const r = fillQueue({
      plan,
      distinct: createDistinct(),
      stamp: 'S',
      slotAttempts: 5,
      make: never,
    });
    assert.deepStrictEqual(
      [r.tries, r.starved, r.added.length, r.fails],
      [5, ['20261121'], 0, { grade: 5 }],
    );
    const again = planFill({
      today,
      horizon: 1,
      perSlot: 1,
      published: new Set(),
      index: applyFill(emptyIndex(), plan, r),
      stamp: 'S',
    });
    assert.deepStrictEqual(again.slots[0].attempts, 5, 'the 5 runs are not repeated');
    assert.deepStrictEqual(
      fillQueue({
        plan: again,
        distinct: createDistinct(),
        stamp: 'S',
        slotAttempts: 5,
        make: never,
      }).tries,
      0,
    );
    // after a full fill the plan needs nothing
    const full = planFill({
      today,
      horizon: 4,
      perSlot: 2,
      published: new Set(),
      index: emptyIndex(),
      stamp: 'S',
    });
    const filled = applyFill(
      emptyIndex(),
      full,
      fillQueue({ plan: full, distinct: createDistinct(), stamp: 'S', make: stub }),
    );
    const second = planFill({
      today,
      horizon: 4,
      perSlot: 2,
      published: new Set(),
      index: filled,
      stamp: 'S',
    });
    assert.deepStrictEqual(
      second.slots.map(s => s.need),
      [0, 0, 0, 0],
    );
    const calls = made1;
    assert.deepStrictEqual(
      fillQueue({ plan: second, distinct: createDistinct(), stamp: 'S', make: stub }).added.length,
      0,
    );
    assert.deepStrictEqual(made1, calls, 'the generator is not called');
  },
);

test('gotd plan: the runs a day has used count per stamp; a new stamp starts at 0', FAST, () => {
  const index = emptyIndex();
  index.slots['20261121'] = { size: sizeOn('20261121'), attempts: 4, stamp: 'OLD' };
  index.slots['20261122'] = { size: sizeOn('20261122'), attempts: 3, stamp: 'S' };
  index.slots['20261123'] = { size: sizeOn('20261123'), attempts: 2 };
  const plan = planFill({
    today,
    horizon: 3,
    perSlot: 1,
    published: new Set(),
    index,
    stamp: 'S',
  });
  assert.deepStrictEqual(
    plan.slots.map(s => s.attempts),
    [0, 3, 2],
    'a counter without a stamp counts for every stamp',
  );
  const r = fillQueue({ plan, distinct: createDistinct(), stamp: 'S', make: stub });
  assert.deepStrictEqual(
    r.added.map(a => [a.entry.slot, a.entry.attempt]),
    [
      ['20261121', 0],
      ['20261122', 3],
      ['20261123', 2],
    ],
    'the day of the old stamp starts again at attempt 0',
  );
  assert.deepStrictEqual(r.slots['20261121'], {
    size: sizeOn('20261121'),
    attempts: 1,
    stamp: 'S',
  });
});

test(
  'gotd restamp: a candidate still Hard takes the stamp and keeps its place; the others stay',
  FAST,
  () => {
    const old = (n, size, slot, over = {}) =>
      queueCand(id12(n), size, slot, { stamp: 'OLD', trap: { pred: 2.3, grade: 3 }, ...over });
    const index = {
      ...emptyIndex(),
      candidates: [
        old(1, 7, '20261121'),
        old(2, 7, '20261121'),
        old(3, 8, '20261122'),
        old(4, 8, '20261122'),
        queueCand(id12(5), 8, '20261122'),
        old(6, 8, '20261122', { status: 'approved' }),
        old(7, 8, '20261122', { status: 'rejected' }),
      ],
    };
    const seen = [],
      log = [];
    const vet = c => {
      seen.push(+c.id);
      if (c.id === id12(2)) return { ok: false, reason: 'margin', detail: 'score 2.1 < 2.4' };
      if (c.id === id12(3)) return { ok: true, entry: { id: id12(99) } };
      if (c.id === id12(4)) return { ok: false, reason: 'duplicate', detail: 'a day' };
      return {
        ok: true,
        entry: {
          id: c.id,
          K: 9,
          walls: 3,
          pathKey: 'pk',
          trap: { pred: 2.6, grade: 3 },
          corr: { wideFrac: 0.1 },
        },
      };
    };
    const r = restampQueue({ index, stamp: 'S', vet, log: m => log.push(m) });
    assert.deepStrictEqual(
      seen,
      [1, 2, 3, 4],
      'only pending ones of another stamp, earliest day first',
    );
    assert.deepStrictEqual([r.old, r.kept, r.fails], [4, 1, { margin: 1, file: 1, duplicate: 1 }]);
    const by = n => r.index.candidates.find(c => c.id === id12(n));
    assert.deepStrictEqual(by(1), {
      ...old(1, 7, '20261121'),
      stamp: 'S',
      K: 9,
      walls: 3,
      pathKey: 'pk',
      trap: { pred: 2.6, grade: 3 },
      corr: { wideFrac: 0.1 },
    });
    assert.deepStrictEqual(
      [2, 3, 4, 6, 7].map(n => by(n).stamp),
      ['OLD', 'OLD', 'OLD', 'OLD', 'OLD'],
      'not kept, approved and rejected ones are as they were',
    );
    assert.deepStrictEqual(by(5), index.candidates[4], 'a candidate of this stamp is not touched');
    assert.deepStrictEqual(log.length, 4);
    assert.deepStrictEqual(
      r.index.candidates.filter(c => usable(c, 'S')).map(c => +c.id),
      [1, 5, 6],
      'the kept one counts now',
    );
    assert.deepStrictEqual(index.candidates[0].stamp, 'OLD', 'the index given is not changed');
  },
);

test(
  'gotd index: formatIndex and parseIndex round trip byte for byte; the candidates stay in day order, one per line',
  FAST,
  () => {
    const plan = planFill({
      today,
      horizon: 3,
      perSlot: 2,
      published: new Set(),
      index: emptyIndex(),
      stamp: 'S',
    });
    const index = applyFill(
      emptyIndex(),
      plan,
      fillQueue({ plan, distinct: createDistinct(), stamp: 'S', make: stub }),
    );
    const text = formatIndex(index);
    assert.deepStrictEqual(formatIndex(parseIndex(text)), text);
    assert.deepStrictEqual(parseIndex(text), JSON.parse(JSON.stringify(index)));
    assert.deepStrictEqual(
      text.split('\n').filter(l => l.startsWith('    {')).length,
      index.candidates.length,
    );
    assert.deepStrictEqual(
      index.candidates.map(c => c.slot),
      index.candidates.map(c => c.slot).sort(),
    );
    assert.deepStrictEqual(
      formatIndex(emptyIndex()),
      '{\n  "v": 1,\n  "slots": {},\n  "candidates": []\n}\n',
    );
    assert.deepStrictEqual(parseIndex(formatIndex(emptyIndex())), emptyIndex());
  },
);

test('gotd index: parseIndex names what is wrong', FAST, () => {
  const msg = text => {
    try {
      parseIndex(text);
    } catch (e) {
      return e.message;
    }
    return '';
  };
  const good = c => JSON.stringify({ v: 1, slots: {}, candidates: c });
  assert.ok(/not valid JSON/.test(msg('{')));
  assert.ok(/"v" must be 1/.test(msg('{"v":2,"slots":{},"candidates":[]}')));
  assert.ok(/"slots" must be an object/.test(msg('{"v":1,"slots":[],"candidates":[]}')));
  assert.ok(
    /not YYYYMMDD/.test(msg('{"v":1,"slots":{"x":{"size":7,"attempts":1}},"candidates":[]}')),
  );
  assert.ok(
    /integer "size" and "attempts"/.test(
      msg('{"v":1,"slots":{"20261121":{"size":7}},"candidates":[]}'),
    ),
  );
  assert.ok(/"candidates" must be an array/.test(msg('{"v":1,"slots":{},"candidates":{}}')));
  assert.ok(/"id" must be 12 hex/.test(msg(good([{ ...queueCand('zz', 7, '20261121') }]))));
  assert.ok(
    /appears twice/.test(
      msg(good([queueCand(id12(1), 7, '20261121'), queueCand(id12(1), 7, '20261122')])),
    ),
  );
  assert.ok(
    /stamp, status/.test(msg(good([queueCand(id12(1), 7, '20261121', { status: 'maybe' })]))),
  );
  assert.ok(
    /"file" must be/.test(msg(good([queueCand(id12(1), 7, '20261121', { file: 'x.txt' })]))),
  );
  assert.deepStrictEqual(msg(good([queueCand(id12(1), 7, '20261121')])), '');
});

// ---- the human side: verdicts, review, promotion

const cand = (n, size, slot, over = {}) => ({
  id: id12(n),
  file: `c-${size}-${id12(n)}.txt`,
  size,
  slot,
  attempt: n,
  seed: n,
  stamp: 'S',
  status: 'pending',
  K: 8,
  walls: 5,
  pathKey: id12(n),
  trap: { pred: 2.3, grade: 3 },
  ...over,
});
const NOW = '2026-11-05T10:00:00Z';
// two puzzles of tools/ratings.json, and a candidate whose id is the real one of the puzzle
const K1 =
  'size 7\ncheckpoints 0,1=2 0,6=1 1,3=3 2,2=5 2,5=4 3,1=7 3,5=9 4,3=8 5,3=6\nwalls V,4,3 H,5,4';
const K2 =
  'size 7\ncheckpoints 0,5=3 0,6=1 1,3=4 2,1=5 3,1=8 3,5=6 3,6=2 4,4=9 5,3=7\nwalls H,2,3 V,3,2';
const real = key => ({ ...cand(1, 7, '20261122'), id: puzzleId(symmetryKey(key)) });
const verdict = (c, human, over = {}) =>
  makeVerdict({
    candidate: c,
    sel: { lo: human, hi: human, lean: 0 },
    solved: true,
    playS: 60,
    takebacks: 2,
    now: NOW,
    ...over,
  });

test(
  'gotd rating widget: a grade, a neighbour makes "N or M", the same single grade clears; lean and unsure only where they make sense',
  FAST,
  () => {
    let sel = nextSelection(null, 3);
    assert.deepStrictEqual(sel, { lo: 3, hi: 3, lean: 0, unsure: false });
    assert.deepStrictEqual(
      nextSelection(sel, 3),
      null,
      'the same single grade again removes the rating',
    );
    sel = nextSelection(sel, 4);
    assert.deepStrictEqual(sel, { lo: 3, hi: 4, lean: 0, unsure: false });
    sel = nextLean(sel, 1);
    assert.deepStrictEqual(sel.lean, 1);
    assert.deepStrictEqual(nextLean(sel, 1).lean, 0, 'the same lean again clears it');
    assert.deepStrictEqual(
      nextLean({ lo: 3, hi: 3, lean: 0 }, 1),
      { lo: 3, hi: 3, lean: 0 },
      'no lean for a single grade',
    );
    assert.deepStrictEqual(
      nextSelection({ lo: 1, hi: 1, lean: 0 }, 4),
      { lo: 4, hi: 4, lean: 0, unsure: false },
      'a distant grade replaces',
    );
    assert.deepStrictEqual(
      nextSelection({ lo: 3, hi: 4, lean: 1, unsure: true }, 0),
      { lo: 0, hi: 0, lean: 0, unsure: true },
      'unsure survives a new grade',
    );
    assert.deepStrictEqual(toggleUnsure(sel).unsure, true);
    assert.deepStrictEqual(toggleUnsure(null), null);
  },
);

test(
  'gotd verdict: a rating of Hard or more approves, below rejects; two grades use their midpoint and lean',
  FAST,
  () => {
    const A = APPROVE_MIN;
    const v = (lo, hi, lean = 0) =>
      verdict(cand(1, 7, '20261121'), 0, { sel: { lo, hi, lean } }).verdict;
    assert.ok(A >= 1, 'a grade below the limit exists');
    assert.deepStrictEqual(
      [A, A + 1, A + 2, A - 1, 0].map(g => v(g, g)),
      ['approve', 'approve', 'approve', 'reject', 'reject'],
    );
    assert.deepStrictEqual(
      [v(A - 1, A), v(A - 1, A, 1), v(A, A + 1), v(A, A + 1, -1)],
      ['reject', 'reject', 'approve', 'approve'],
      'A - 1 or A is A - 0.5, leaning up A - 0.25: below the limit; A or A + 1 is above',
    );
    assert.deepStrictEqual(decide({ human: A - 0.01 }), 'reject');
    assert.deepStrictEqual(decide({ human: A }), 'approve');
  },
);

test(
  "gotd verdict: the reviewer's button decides, the rating only suggests; a verdict may have no rating",
  FAST,
  () => {
    const c = cand(1, 7, '20261121'),
      sel = g => ({ lo: g, hi: g, lean: 0 });
    const v = (g, verdictName) =>
      makeVerdict({
        candidate: c,
        sel: g === null ? null : sel(g),
        verdict: verdictName,
        solved: true,
        takebacks: 0,
        now: NOW,
      });
    assert.deepStrictEqual(
      [v(1, 'approve').verdict, v(1, 'approve').human],
      ['approve', 1],
      'Easy approved by hand',
    );
    assert.deepStrictEqual(v(4, 'reject').verdict, 'reject', 'Expert rejected by hand');
    assert.deepStrictEqual(v(2).verdict, 'reject', 'no button: the rating suggests');
    const bare = v(null, 'approve');
    assert.deepStrictEqual(
      [bare.verdict, 'human' in bare, 'lo' in bare, 'hi' in bare, 'unsure' in bare],
      ['approve', false, false, false, false],
      'no rating, no rating fields',
    );
    assert.deepStrictEqual(verdictProblem(bare), '', 'and the file accepts it');
    assert.deepStrictEqual(parseVerdicts(formatVerdicts([bare]))[0], bare);
    assert.deepStrictEqual(
      verdictProblem({ ...bare, human: 3 }) !== '',
      true,
      'a rating is all or nothing',
    );
    assert.deepStrictEqual(
      makeVerdict({
        candidate: c,
        sel: { lo: 1, hi: 1, lean: 0, unsure: true },
        verdict: 'reject',
        solved: false,
        takebacks: 0,
        now: NOW,
      }).unsure,
      true,
    );
    assert.deepStrictEqual(
      makeVerdict({
        candidate: c,
        sel: null,
        verdict: 'reject',
        solved: false,
        takebacks: 0,
        now: NOW,
      }).solved,
      false,
    );
  },
);

test(
  'gotd verdict: makeVerdict records the rating, the blind play and what the model said; no rating and no decision is an error',
  FAST,
  () => {
    const c = cand(7, 8, '20261122', { trap: { pred: 2.31, grade: 3 } });
    const v = makeVerdict({
      candidate: c,
      sel: { lo: 2, hi: 3, lean: 1, unsure: true },
      solved: false,
      playS: 41.26,
      takebacks: 5.9,
      now: NOW,
    });
    assert.deepStrictEqual(v, {
      id: id12(7),
      size: 8,
      stamp: 'S',
      model: { grade: 3, pred: 2.31 },
      human: 2.75,
      lo: 2,
      hi: 3,
      unsure: true,
      solved: false,
      playS: 41.3,
      takebacks: 5,
      verdict: 'reject',
      at: NOW,
    });
    assert.deepStrictEqual(
      Object.keys(verdict(c, 3)).includes('unsure'),
      false,
      'sure ratings carry no unsure flag',
    );
    assert.deepStrictEqual(
      makeVerdict({
        candidate: c,
        sel: { lo: 3, hi: 3, lean: 0 },
        solved: true,
        takebacks: 0,
        now: NOW,
      }).playS,
      undefined,
      'no time, no playS',
    );
    let message = '';
    try {
      makeVerdict({ candidate: c, sel: null, solved: true, now: NOW });
    } catch (e) {
      message = e.message;
    }
    assert.deepStrictEqual(message, 'no verdict', 'neither a rating nor a decision');
  },
);

test('gotd takebacks: counts the path cells taken back, not the cells added', FAST, () => {
  const tb = createTakebacks();
  [1, 2, 3, 4, 5].forEach(n => tb.note(n));
  assert.deepStrictEqual(tb.total, 0);
  tb.note(2);
  assert.deepStrictEqual(tb.total, 3);
  tb.note(3);
  tb.note(4);
  tb.note(1);
  assert.deepStrictEqual(tb.total, 6);
  tb.note(1);
  assert.deepStrictEqual(tb.total, 6, 'no change, no takeback');
  tb.reset();
  assert.deepStrictEqual(tb.total, 0);
  tb.note(5);
  tb.note(4);
  assert.deepStrictEqual(tb.total, 1, 'reset also forgets the old length');
});

test(
  'gotd verdict file: format and parse round trip byte for byte, one verdict per line in time order; parse names what is wrong',
  FAST,
  () => {
    const a = verdict(cand(1, 7, '20261121'), 3),
      b = verdict(cand(2, 8, '20261122'), 2, { now: '2026-11-05T09:00:00Z' });
    const text = formatVerdicts([a, b]);
    assert.deepStrictEqual(formatVerdicts(parseVerdicts(text)), text);
    assert.deepStrictEqual(
      parseVerdicts(text).map(v => v.id),
      [id12(2), id12(1)],
      'earlier first',
    );
    assert.deepStrictEqual(text.split('\n').filter(l => l.startsWith('    {')).length, 2);
    assert.deepStrictEqual(formatVerdicts([]), '{\n  "v": 1,\n  "verdicts": []\n}\n');
    assert.deepStrictEqual(parseVerdicts(formatVerdicts([])), []);
    const msg = s => {
      try {
        parseVerdicts(s);
      } catch (e) {
        return e.message;
      }
      return '';
    };
    const wrap = v => JSON.stringify({ v: 1, verdicts: v });
    assert.ok(/not valid JSON/.test(msg('{')));
    assert.ok(/"v" must be 1/.test(msg('{"v":3,"verdicts":[]}')));
    assert.ok(/"verdicts" must be an array/.test(msg('{"v":1,"verdicts":{}}')));
    assert.ok(/"id" must be 12 hex/.test(msg(wrap([{ ...a, id: 'x' }]))));
    assert.ok(/"verdict" must be approve or reject/.test(msg(wrap([{ ...a, verdict: 'maybe' }]))));
    assert.ok(/"human", "lo", "hi"/.test(msg(wrap([{ ...a, human: 7 }]))));
    assert.ok(/"human", "lo", "hi"/.test(msg(wrap([{ ...a, lo: 4, hi: 3 }]))));
    assert.ok(/"solved" must be true or false/.test(msg(wrap([{ ...a, solved: 'yes' }]))));
    assert.ok(/"playS"/.test(msg(wrap([{ ...a, playS: -1 }]))));
    assert.ok(/"takebacks"/.test(msg(wrap([{ ...a, takebacks: 1.5 }]))));
    assert.ok(/"at" must be an ISO time/.test(msg(wrap([{ ...a, at: 'yesterday' }]))));
    assert.ok(/appears twice/.test(msg(wrap([a, { ...a, at: '2026-11-06T00:00:00Z' }]))));
    assert.deepStrictEqual(verdictProblem(a), '');
    assert.ok(verdictProblem(null));
  },
);

test('gotd verdicts merge: one per id, the newer wins, a tie goes to reject', FAST, () => {
  const c = cand(1, 7, '20261121'),
    old = verdict(c, 3),
    later = verdict(c, 2, { now: '2026-11-06T00:00:00Z' });
  assert.deepStrictEqual(
    mergeVerdicts([old], [later]).map(v => v.verdict),
    ['reject'],
    'the newer verdict wins',
  );
  assert.deepStrictEqual(
    mergeVerdicts([later], [old]).map(v => v.verdict),
    ['reject'],
    'whatever the order',
  );
  const approve = verdict(c, 3),
    reject = verdict(c, 1);
  assert.deepStrictEqual(
    mergeVerdicts([approve], [reject])[0].verdict,
    'reject',
    'same time: reject',
  );
  assert.deepStrictEqual(mergeVerdicts([reject], [approve])[0].verdict, 'reject');
  assert.deepStrictEqual(
    mergeVerdicts([approve], [{ ...approve, takebacks: 99 }])[0].takebacks,
    2,
    'same time and verdict: the first stays',
  );
  assert.deepStrictEqual(mergeVerdicts([old], [verdict(cand(2, 7, '20261121'), 3)]).length, 2);
  assert.deepStrictEqual(mergeVerdicts([], []), []);
});

test(
  'gotd verdict key: the puzzle text rides with the verdict; it must be canonical and hash to the id (a turned copy does), older verdicts have none',
  FAST,
  () => {
    const c = real(K1),
      v = verdict(c, 3, { key: K1 });
    assert.deepStrictEqual([v.key, Object.keys(v).at(-1), verdictProblem(v)], [K1, 'key', '']);
    assert.deepStrictEqual(parseVerdicts(formatVerdicts([v]))[0], v, 'round trip');
    assert.ok(verdictProblem({ ...v, key: K2 }) !== '', 'the key of another puzzle');
    assert.ok(verdictProblem({ ...v, key: `${K1}\n` }) !== '', 'not canonical');
    assert.ok(
      verdictProblem({ ...v, key: 5 }) !== '' && verdictProblem({ ...v, key: 'size 7' }) !== '',
      'not a puzzle',
    );
    assert.deepStrictEqual(
      verdictProblem({ ...v, key: ratingKey(transformPuzzle(parse(K1), 2, true)) }),
      '',
      'the same puzzle turned and renumbered has the same id',
    );
    assert.deepStrictEqual('key' in verdict(c, 3), false);
    assert.deepStrictEqual(verdictProblem(verdict(c, 3)), '');
  },
);

test(
  'gotd verdicts conflicts: only ids both copies have with another decision or rating, with the one that is kept',
  FAST,
  () => {
    const a = verdict(cand(1, 7, 'x'), 3),
      mine = [a, verdict(cand(2, 7, 'x'), 1)];
    const newer = { ...verdict(cand(1, 7, 'x'), 1), at: '2026-11-06T10:00:00Z' };
    assert.deepStrictEqual(
      verdictConflicts(mine, [newer, verdict(cand(3, 7, 'x'), 4), mine[1]]).map(c => [
        c.id,
        c.kept,
        c.dropped,
      ]),
      [[a.id, newer, a]],
      'a new id and an equal verdict are no conflict',
    );
    assert.deepStrictEqual(
      verdictConflicts([newer], [a])[0].kept,
      newer,
      'the newer one is kept whichever copy it is in',
    );
    assert.deepStrictEqual(verdictConflicts(mine, mine), []);
  },
);

test(
  'gotd harvest: rated verdicts become new ratings.json rows once; rated, equivalent, unrated, unresolved and given-up ones are told apart',
  FAST,
  () => {
    const tag = (K, human, { unsure, ...over } = {}) =>
      verdict(real(K), human, {
        key: K,
        ...(unsure ? { sel: { lo: human, hi: human, lean: 0, unsure: true } } : {}),
        ...over,
      });
    const row = (key, human, lo = human, hi = human) => ({ key, human, lo, hi });
    const turned = ratingKey(transformPuzzle(parse(K1), 1, false));
    assert.deepStrictEqual(
      turned !== K1 && symmetryKey(turned) === symmetryKey(K1),
      true,
      'the test puzzle really is a different text of the same puzzle',
    );
    let h = harvestRatings([tag(K1, 3, { unsure: true })], []);
    assert.deepStrictEqual(
      h.add.map(r => [r.key, r.human, r.lo, r.hi, r.unsure, r.id]),
      [[K1, 3, 3, 3, true, real(K1).id]],
    );
    assert.deepStrictEqual(h.add[0].key, K1);
    h = harvestRatings([tag(K1, 3)], [row(K1, 3)]);
    assert.deepStrictEqual(
      [h.add, h.same, h.differs],
      [[], [real(K1).id], []],
      'harvesting again adds nothing',
    );
    h = harvestRatings([tag(K1, 3)], [row(K1, 2)]);
    assert.deepStrictEqual(
      [h.add.length, h.differs.map(d => [d.id, d.have.human, d.got.human])],
      [0, [[real(K1).id, 2, 3]]],
      'another rating in the file is kept and listed',
    );
    h = harvestRatings([tag(K1, 3)], [row(K1, 3, 2, 3)]);
    assert.deepStrictEqual(h.differs.length, 1, 'same human, other range');
    h = harvestRatings([tag(K1, 3, { unsure: true })], [row(K1, 3)]);
    assert.deepStrictEqual(h.differs.length, 1, 'same rating, but unsure now');
    h = harvestRatings([{ ...tag(K1, 3), key: turned }], [row(K1, 4)]);
    assert.deepStrictEqual(
      [h.add.length, h.equivalent],
      [0, [{ id: real(K1).id, key: K1 }]],
      'a turned copy of a rated puzzle is not added',
    );
    const bare = verdict(real(K2), undefined, { sel: null, verdict: 'approve' }),
      old = verdict(cand(9, 7, 'x'), 2),
      gaveUp = tag(K2, 4, { solved: false });
    h = harvestRatings([bare, old, tag(K1, 1)], []);
    assert.deepStrictEqual(
      [h.unrated, h.unresolved, h.add.length],
      [1, [old.id], 1],
      'no rating: nothing to add; no key: unresolved',
    );
    assert.deepStrictEqual(harvestRatings([gaveUp], []).add.length, 1);
    h = harvestRatings([gaveUp], [], { solvedOnly: true });
    assert.deepStrictEqual([h.add.length, h.skipped], [0, [gaveUp.id]]);
    h = harvestRatings([tag(K1, 2.5), tag(K2, 4)], []);
    assert.deepStrictEqual(
      harvestRatings(
        [tag(K1, 2.5), tag(K2, 4)],
        h.add.map(({ id, ...r }) => r),
      ).same.length,
      2,
      'the added rows are what a rerun finds',
    );
  },
);

// 20261122..27 are 7, 8, 8, 6, 9, 7 in the schedule. 20261122 is published already (the candidate 1 made for it was promoted and left the index).
const reviewWorld = () => {
  const index = emptyIndex();
  index.candidates = [
    cand(2, 7, '20261122'),
    cand(3, 8, '20261123'),
    cand(4, 8, '20261123'),
    cand(5, 8, '20261124'),
    cand(6, 8, '20261124'),
    cand(7, 6, '20261125'),
    cand(8, 9, '20261126'),
    cand(9, 6, '20261125', { stamp: 'OLD' }),
    cand(10, 8, '20261123', { status: 'rejected' }),
  ];
  const args = {
    today: dayOfDate('20261122'),
    horizon: 6,
    published: new Set(['20261122']),
    index,
    stamp: 'S',
  };
  return {
    index,
    args,
    review: (verdicts = [], more = {}) => planReview({ ...args, verdicts, ...more }),
  };
};
const approve = c =>
  makeVerdict({
    candidate: c,
    sel: null,
    verdict: 'approve',
    solved: true,
    takebacks: 0,
    now: NOW,
  });
const reject = c =>
  makeVerdict({
    candidate: c,
    sel: null,
    verdict: 'reject',
    solved: true,
    takebacks: 0,
    now: NOW,
  });
const ids = list => list.map(c => +c.id);

test(
  'gotd review plan: candidates in the order of the open days they fill; a published day is not offered again, its leftovers wait for a later day of their size',
  FAST,
  () => {
    const w = reviewWorld(),
      r = w.review();
    assert.deepStrictEqual(
      ids(r.queue),
      [3, 4, 5, 6, 7, 8, 2],
      'older stamp, rejected ones out; the leftover 2 of the published day comes last, for the next 7x7 day, not first',
    );
    assert.deepStrictEqual(
      r.queue.map(c => c.date),
      ['20261123', '20261123', '20261123', '20261123', '20261125', '20261126', '20261127'],
    );
    assert.deepStrictEqual(
      r.open.map(d => [d.date, d.size]),
      [
        ['20261123', 8],
        ['20261124', 8],
        ['20261125', 6],
        ['20261126', 9],
        ['20261127', 7],
      ],
      'the published day is not open',
    );
    assert.deepStrictEqual(
      ids(w.review([], { horizon: 3 }).queue),
      [3, 4, 5, 6],
      'no open day of size 6, 9 or 7 in the horizon: those candidates wait',
    );
    assert.deepStrictEqual(
      ids(w.review([], { horizon: 3, reserve: true }).queue),
      [3, 4, 5, 6, 2, 7, 8],
      'reserve: after the others, in queue order',
    );
    assert.deepStrictEqual(
      w
        .review([], { horizon: 3, reserve: true })
        .queue.slice(4)
        .map(c => c.date),
      [null, null, null],
    );
    assert.deepStrictEqual(
      ids(w.review([], { published: new Set(['20261122', '20261123', '20261124']) }).queue),
      [7, 8, 2],
      'days published by other means are closed too',
    );
    assert.deepStrictEqual(planReview({ ...w.args, index: emptyIndex(), verdicts: [] }).queue, []);
  },
);

test(
  'gotd review plan: an approved candidate covers its day at once and the next review is for the next open day; a reject leaves the day open',
  FAST,
  () => {
    const w = reviewWorld(),
      c = id => w.index.candidates.find(x => +x.id === id);
    let r = w.review([approve(c(3))]);
    assert.deepStrictEqual(
      ids(r.queue),
      [5, 6, 4, 7, 8, 2],
      'day 23 is covered: the candidates made for day 24 come first, the sibling 4 of 23 after them',
    );
    assert.deepStrictEqual(
      r.queue.slice(0, 3).map(x => x.date),
      ['20261124', '20261124', '20261124'],
    );
    assert.deepStrictEqual(r.plan.find(p => p.id === id12(3)).date, '20261123');
    r = w.review([approve(c(3)), approve(c(5))]);
    assert.deepStrictEqual(ids(r.queue), [7, 8, 2]);
    assert.deepStrictEqual(
      ids(w.review([approve(c(3)), approve(c(5))], { reserve: true }).queue),
      [7, 8, 2, 4, 6],
      'the siblings of the approved ones are the reserve',
    );
    r = w.review([approve(c(3)), approve(c(5)), reject(c(7))]);
    assert.deepStrictEqual(ids(r.queue), [8, 2]);
    assert.deepStrictEqual(
      r.open.map(d => d.date),
      ['20261125', '20261126', '20261127'],
      'a rejected candidate leaves its day open',
    );
    assert.deepStrictEqual(
      w
        .review([reject(c(3)), reject(c(4))])
        .queue.map(x => +x.id)
        .slice(0, 2),
      [5, 6],
      'rejects of day 23 hand the day to the candidates made for day 24',
    );
  },
);

test(
  'gotd review plan: approving what is shown always fills the next open day, so approved days never leave a gap (the day shown is the day promote plans)',
  FAST,
  () => {
    const w = reviewWorld(),
      verdicts = [],
      days = [];
    for (let r = w.review(); r.queue.length; r = w.review(verdicts)) {
      const first = r.queue[0],
        v = approve(first);
      verdicts.push(v);
      const got = w.review(verdicts).plan.find(p => p.id === first.id);
      assert.deepStrictEqual(
        got?.date,
        first.date,
        `candidate ${+first.id} is shown for ${first.date}`,
      );
      days.push(first.date);
    }
    assert.deepStrictEqual(
      days,
      ['20261123', '20261124', '20261125', '20261126', '20261127'],
      'five approvals, five consecutive days',
    );
    assert.deepStrictEqual(w.review(verdicts).open, []);
  },
);

test(
  'gotd review plan: a verdict counts before it reaches the index; an approved candidate of a promoted day cannot hold a day closed',
  FAST,
  () => {
    const w = reviewWorld(),
      c = id => w.index.candidates.find(x => +x.id === id);
    assert.deepStrictEqual(
      ids(w.review([approve(c(8))]).queue),
      [3, 4, 5, 6, 7, 2],
      'approved by verdict only',
    );
    const gone = reviewWorld(); // candidate 1 was approved, promoted and removed from the index: its verdict stays in verdicts.json and changes nothing
    const old = approve({ ...cand(1, 7, '20261122'), stamp: 'S' });
    assert.deepStrictEqual(ids(gone.review([old]).queue), [3, 4, 5, 6, 7, 8, 2]);
  },
);

test(
  'gotd verdicts apply: approve and reject set the status, other candidates stay; applying twice changes nothing',
  FAST,
  () => {
    const index = emptyIndex();
    index.candidates = [cand(1, 7, '20261122'), cand(2, 7, '20261122'), cand(3, 8, '20261123')];
    const verdicts = [
      verdict(index.candidates[0], 4),
      verdict(index.candidates[1], 1),
      verdict(cand(99, 7, '20261122'), 3),
    ];
    const r = applyVerdicts(index, verdicts);
    assert.deepStrictEqual(
      r.index.candidates.map(c => c.status),
      ['approved', 'rejected', 'pending'],
    );
    assert.deepStrictEqual(
      r.changed,
      [
        { id: id12(1), from: 'pending', to: 'approved' },
        { id: id12(2), from: 'pending', to: 'rejected' },
      ],
      'a verdict without a candidate is ignored',
    );
    const again = applyVerdicts(r.index, verdicts);
    assert.deepStrictEqual(again.changed, []);
    assert.deepStrictEqual(again.index, r.index);
    assert.deepStrictEqual(
      index.candidates.map(c => c.status),
      ['pending', 'pending', 'pending'],
      'the input is not changed',
    );
    const flip = applyVerdicts(r.index, [
      verdict(index.candidates[0], 1, { now: '2026-11-06T00:00:00Z' }),
    ]);
    assert.deepStrictEqual(
      flip.index.candidates[0].status,
      'rejected',
      'a later verdict can overturn an approval that was not published yet',
    );
  },
);

test(
  'gotd review stats: per stamp the reviewed, approved and rejected counts and how far the human is from the model',
  FAST,
  () => {
    const c1 = cand(1, 7, '20261122'),
      c2 = cand(2, 7, '20261122'),
      c3 = cand(3, 7, '20261122', { stamp: 'T' });
    const stats = reviewStats([verdict(c1, 3), verdict(c2, 1), verdict(c3, 4)]);
    assert.deepStrictEqual(stats.S, {
      reviewed: 2,
      approved: 1,
      rejected: 1,
      sumErr: -2,
      worst: -2,
    });
    assert.deepStrictEqual(stats.T, {
      reviewed: 1,
      approved: 1,
      rejected: 0,
      sumErr: 1,
      worst: 1,
    });
    assert.deepStrictEqual(reviewStats([]), {});
    const bare = makeVerdict({
      candidate: c1,
      sel: null,
      verdict: 'approve',
      solved: true,
      takebacks: 0,
      now: NOW,
    });
    assert.deepStrictEqual(
      reviewStats([verdict(c1, 3), bare]).S,
      { reviewed: 2, approved: 2, rejected: 0, sumErr: 0, worst: 0 },
      'an unrated verdict counts as reviewed, not in the model gap',
    );
  },
);

test(
  'gotd promote plan: an open day takes an approved candidate of its size, the one made for it first, else the earliest; each is used once',
  FAST,
  () => {
    assert.deepStrictEqual(
      [
        sizeForDay(dayOfDate('20261122')),
        sizeForDay(dayOfDate('20261123')),
        sizeForDay(dayOfDate('20261124')),
        sizeForDay(dayOfDate('20261125')),
      ],
      [7, 8, 8, 6],
      'the golden schedule this test is written for',
    );
    const today = dayOfDate('20261122'),
      index = emptyIndex();
    index.candidates = [
      cand(1, 8, '20261124', { status: 'approved' }),
      cand(2, 8, '20261123', { status: 'approved' }),
      cand(3, 8, '20261130', { status: 'approved' }),
      cand(4, 7, '20261201', { status: 'pending' }),
      cand(5, 6, '20261125', { status: 'rejected' }),
    ];
    const plan = planPromote({ today, horizon: 4, published: new Set(), index });
    assert.deepStrictEqual(
      plan.map(p => [p.date, p.size, p.id && +p.id]),
      [
        ['20261122', 7, null],
        ['20261123', 8, 2],
        ['20261124', 8, 1],
        ['20261125', 6, null],
      ],
    );
    assert.deepStrictEqual(
      planPromote({ today, horizon: 4, published: new Set(['20261123']), index }).map(p => [
        p.date,
        p.id && +p.id,
      ]),
      [
        ['20261122', null],
        ['20261124', 1],
        ['20261125', null],
      ],
      'a published day is closed',
    );
    assert.deepStrictEqual(
      planPromote({
        today,
        horizon: 4,
        published: new Set(['20261123', '20261124']),
        index,
      }).map(p => p.date),
      ['20261122', '20261125'],
    );
    const one = emptyIndex();
    one.candidates = [cand(9, 8, '20261130', { status: 'approved' })];
    assert.deepStrictEqual(
      planPromote({ today, horizon: 4, published: new Set(), index: one }).map(p => p.id && +p.id),
      [null, 9, null, null],
      'the earliest open day of its size takes it, the next gets none',
    );
    assert.deepStrictEqual(
      planPromote({ today, horizon: 4, published: new Set(), index: emptyIndex() }).every(
        p => p.id === null,
      ),
      true,
    );
  },
);

test(
  'gotd promote plan: without a horizon every approved candidate gets a day however far ahead, and the near days are listed anyway; with one, later days wait',
  FAST,
  () => {
    const today = dayOfDate('20261122'),
      index = emptyIndex();
    index.candidates = [
      cand(1, 7, '20261122', { status: 'approved' }),
      cand(2, 7, '20261122', { status: 'approved' }),
    ];
    const plan = planPromote({ today, published: new Set(), index });
    assert.deepStrictEqual(
      plan.length,
      10,
      'both candidates have a day within the buffer days: the plan covers just those, every day listed',
    );
    assert.deepStrictEqual(
      plan.filter(p => p.id).map(p => [p.date, +p.id]),
      [
        ['20261122', 1],
        ['20261127', 2],
      ],
      'the second 7x7 waits for the next 7x7 day',
    );
    const far = emptyIndex(),
      files = new Set(Array.from({ length: 40 }, (_, i) => dateOfDay(today + i)));
    far.candidates = [cand(9, 7, '20261122', { status: 'approved' })];
    let day = today + 40;
    while (sizeForDay(day) !== 7) day++;
    assert.deepStrictEqual(
      planPromote({ today, published: files, index: far })
        .filter(p => p.id)
        .map(p => [p.date, +p.id]),
      [[dateOfDay(day), 9]],
      'past 40 published days, no limit',
    );
    assert.deepStrictEqual(
      planPromote({ today, horizon: 30, published: files, index: far }).filter(p => p.id),
      [],
      'a horizon of 30 leaves it waiting: nothing says so',
    );
    const stuck = emptyIndex();
    stuck.candidates = [cand(8, 7, '20261122', { status: 'approved' })];
    assert.deepStrictEqual(
      planPromote({
        today,
        published: new Set(Array.from({ length: 400 }, (_, i) => dateOfDay(today + i))),
        index: stuck,
      }).length,
      0,
      'every day to the cap published: nothing to plan, no endless loop',
    );
  },
);

test(
  'gotd review span: as many days without a file as there are candidates in stock, at most maxDays',
  FAST,
  () => {
    const today = dayOfDate('20261122'),
      files = new Set(Array.from({ length: 5 }, (_, i) => dateOfDay(today + i)));
    assert.deepStrictEqual(
      reviewSpan({ today, published: files, stock: 3 }),
      8,
      'five published days, then three open ones',
    );
    assert.deepStrictEqual(reviewSpan({ today, published: files, stock: 0 }), 0);
    assert.deepStrictEqual(
      reviewSpan({ today, published: files, stock: 1000, maxDays: 50 }),
      50,
      'the cap',
    );
    assert.deepStrictEqual(reviewSpan({ today, published: new Set(), stock: 3 }), 3);
  },
);

test(
  'gotd review plan: without a horizon the days looked at follow the stock, and the extra candidates come last',
  FAST,
  () => {
    const today = dayOfDate('20261122'),
      files = new Set(Array.from({ length: 5 }, (_, i) => dateOfDay(today + i)));
    assert.deepStrictEqual(
      [5, 6, 7, 8, 9].map(i => sizeForDay(today + i)),
      [7, 8, 7, 10, 8],
      'the golden schedule this test is written for (20261127 .. 20261201)',
    );
    const index = emptyIndex();
    index.candidates = [
      cand(1, 7, 'x'),
      cand(2, 7, 'x'),
      cand(3, 7, 'x'),
      cand(4, 8, 'x'),
      cand(5, 9, 'x'),
      cand(6, 7, 'x', { stamp: 'OLD' }),
    ];
    const r = planReview({
      today,
      published: files,
      index,
      verdicts: [],
      stamp: 'S',
      reserve: true,
    });
    assert.deepStrictEqual(
      r.span,
      10,
      'five candidates in stock (the older stamp does not count): five open days after the five published ones',
    );
    assert.deepStrictEqual(
      r.queue.map(c => [+c.id, c.date]),
      [
        [1, '20261127'],
        [2, '20261127'],
        [3, '20261127'],
        [4, '20261128'],
        [5, null],
      ],
      'the 9x9 has no open day within the span: extra, last',
    );
    assert.deepStrictEqual(
      planReview({ today, published: files, index, verdicts: [], stamp: 'S' }).queue.map(
        c => +c.id,
      ),
      [1, 2, 3, 4],
      'without the reserve it stays out',
    );
    const v = [approve(index.candidates[0])];
    const r2 = planReview({
      today,
      published: files,
      index,
      verdicts: v,
      stamp: 'S',
      reserve: true,
    });
    assert.deepStrictEqual(r2.span, 10, 'an approval does not change the stock');
    assert.deepStrictEqual(
      r2.queue.map(c => [+c.id, c.date]),
      [
        [4, '20261128'],
        [2, '20261129'],
        [3, '20261129'],
        [5, null],
      ],
      'the first 7x7 day is covered: the other 7x7 move to the next 7x7 day',
    );
    assert.deepStrictEqual(
      planReview({
        today,
        horizon: 6,
        published: files,
        index,
        verdicts: [],
        stamp: 'S',
        reserve: true,
      }).span,
      6,
      'an explicit horizon is kept',
    );
  },
);

test(
  'gotd scan: asks for the days from today only as far as the stock needs, in batches',
  FAST,
  async () => {
    const today = dayOfDate('20261122'),
      files = new Set(Array.from({ length: 22 }, (_, i) => dateOfDay(today + i)));
    for (const batch of [32, 10, 1000]) {
      const asked = [],
        has = async date => {
          asked.push(date);
          return files.has(date);
        };
      const r = await scanPublished({ today, stock: 24, has, batch });
      assert.deepStrictEqual(
        [r.span, r.published.size, asked.length],
        [46, 22, 46],
        `batch ${batch}: 22 published days, then 24 open ones, every day asked once`,
      );
      assert.deepStrictEqual(
        asked.slice().sort(),
        Array.from({ length: 46 }, (_, i) => dateOfDay(today + i)),
      );
    }
    const none = [];
    const r0 = await scanPublished({
      today,
      stock: 0,
      has: async d => {
        none.push(d);
        return true;
      },
    });
    assert.deepStrictEqual(
      [r0.span, none.length, r0.published.size],
      [0, 0, 0],
      'nothing in stock: nothing asked',
    );
    const capped = await scanPublished({ today, stock: 5, has: async () => true, maxDays: 40 });
    assert.deepStrictEqual(
      [capped.span, capped.published.size],
      [40, 40],
      'every day published: stops at maxDays',
    );
  },
);

test(
  "gotd published text: the puzzle with where it came from, the reviewer's rating and (if solved) the play time; the file means the same puzzle",
  FAST,
  () => {
    const p = runSync(generateTargeted(7, 1, 5, { retries: 3 })).puzzle,
      c = cand(7, 7, '20261122', { stamp: 'a6-x', trap: { pred: 2.265, grade: 3 } });
    const text = publishedText(p, c, verdict(c, 3, { playS: 95.46, takebacks: 4 }));
    assert.ok(
      text.includes(
        '# gotd 000000000007 gen a6-x made-for 20261122 model-grade 3 score 2.265\n# review human 3 solved yes takebacks 4\nsize 7',
      ),
      text,
    );
    assert.deepStrictEqual(
      commentTimes(text).playS,
      95.5,
      "the line the author's own Game-of-Day files carry",
    );
    assert.deepStrictEqual(ratingKey(text), ratingKey(serialize(p)));
    assert.deepStrictEqual(symmetryKey(parse(text)), symmetryKey(p));
    assert.ok(text.endsWith('\n') && !/^path /m.test(text));
    const gaveUp = publishedText(p, c, verdict(c, 3, { solved: false, playS: 30 }));
    assert.deepStrictEqual(
      commentTimes(gaveUp).playS,
      undefined,
      'no play time for a puzzle that was not solved',
    );
    assert.ok(gaveUp.includes('solved no'));
    const unsure = publishedText(
      p,
      c,
      makeVerdict({
        candidate: c,
        sel: { lo: 3, hi: 3, lean: 0, unsure: true },
        solved: true,
        playS: 5,
        takebacks: 0,
        now: NOW,
      }),
    );
    assert.ok(unsure.includes('review human 3 unsure solved yes'));
    const unrated = publishedText(
      p,
      c,
      makeVerdict({
        candidate: c,
        sel: null,
        verdict: 'approve',
        solved: true,
        playS: 5,
        takebacks: 1,
        now: NOW,
      }),
    );
    assert.ok(unrated.includes('# review unrated solved yes takebacks 1'), unrated);
    const bare = publishedText(p, c);
    assert.ok(
      !bare.includes('# review') && !bare.includes('play_time_s'),
      'without a verdict only the origin line',
    );
    // how the puzzle was made is carried from the candidate's file, line for line, between the origin line and the review line
    const origin = [
      'seed 5: grade 3 (target 3+, inside the margin), 4 walls, 8 checkpoints, 2.8 s, 1678 changes, 4 tries',
      'gen a6-x: node tools/gen-target.mjs --size 7 --grade 3 --at-least --margin 0.5 --retries 12 --seed 5',
    ];
    const carried = publishedText(p, c, verdict(c, 3), origin);
    assert.ok(
      carried.includes(`score 2.265\n# ${origin[0]}\n# ${origin[1]}\n# review human 3`),
      carried,
    );
    assert.deepStrictEqual(
      carriedOrigin(carried).slice(-2),
      origin,
      'and they can be carried again',
    );
    assert.deepStrictEqual(ratingKey(carried), ratingKey(serialize(p)));
    assert.deepStrictEqual(
      publishedText(p, c, null, origin)
        .split('\n')
        .filter(l => l.startsWith('# seed')).length,
      1,
    );
  },
);

test(
  'gotd gates: holdGrade lets a puzzle through that misses the grade (a human judged it) and reports the drift; the other gates still hold',
  FAST,
  () => {
    const easy = runSync(generateTargeted(7, 1, 5, { retries: 3 })).puzzle;
    const strict = vetCandidate(easy, 7, createDistinct());
    assert.ok(
      !strict.ok && (strict.reason === 'grade' || strict.reason === 'margin'),
      JSON.stringify(strict).slice(0, 100),
    );
    const held = vetCandidate(easy, 7, createDistinct(), { holdGrade: true });
    assert.ok(held.ok, JSON.stringify(held).slice(0, 120));
    assert.ok(/^(grade \d, wanted 3\+|score [\d.]+ < [\d.]+)$/.test(held.drift), held.drift);
    assert.ok(held.entry.trap.grade < 3 || held.entry.trap.pred < 2.26);
    const dup = createDistinct();
    dup.add({ symKey: held.symKey, where: 'published' });
    assert.deepStrictEqual(
      vetCandidate(easy, 7, dup, { holdGrade: true }).reason,
      'duplicate',
      'a duplicate is refused even when the grade is held',
    );
    assert.deepStrictEqual(
      vetCandidate(makePuzzle(7), 7, createDistinct(), { holdGrade: true }).reason,
      'invalid',
    );
    assert.deepStrictEqual(
      vetCandidate(easy, 8, createDistinct(), { holdGrade: true }).reason,
      'size',
    );
  },
);
