// The automatic Game of Day: the size schedule (core/gotd-schedule.js), the gates a candidate passes (core/gotd-gen.js) and the queue
// (core/gotd-queue.js). Registered by unit/gotd-gen.test.js: gotdGenTests(). The command line is tested in test/gotd-gen-cli.test.js.
import { readFileSync } from 'node:fs';
import { makePuzzle } from '../src/core/model.js';
import { setWallId } from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { symmetryKey, ratingKey, transformPuzzle } from '../src/core/ratings-io.js';
import { runSync } from '../src/core/run.js';
import { generateTargeted } from '../src/core/gen/target.js';
import { TRAP_MODEL } from '../src/core/trap.js';
import { utcDayNumber, dateOfDay as dailyDateOfDay } from '../src/features/daily.js';
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
} from '../src/core/gotd-schedule.js';
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
} from '../src/core/gotd-gen.js';
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
} from '../src/core/gotd-queue.js';

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

export function gotdGenTests(t, ok, eq) {
  t(
    'gotd schedule: every cycle holds exactly SIZE_BAG days of each size, in an accepted order',
    () => {
      eq(
        Object.values(SIZE_BAG).reduce((a, b) => a + b, 0),
        CYCLE_DAYS,
      );
      for (let cycle = 0; cycle < 800; cycle++) {
        const order = cycleOrder(cycle),
          count = {};
        for (const n of order) count[n] = (count[n] || 0) + 1;
        eq(count, SIZE_BAG, `cycle ${cycle}`);
        ok(orderOk(order), `cycle ${cycle}`);
      }
    },
  );

  t(
    'gotd schedule: big sizes are at least BIG_GAP days apart and no size runs three days, also across cycle boundaries',
    () => {
      let lastBig = -1e9;
      for (let day = 0; day < 800 * CYCLE_DAYS; day++) {
        const n = sizeForDay(day);
        if (n >= BIG_SIZE) {
          ok(day - lastBig >= BIG_GAP, `day ${day}: big sizes ${day - lastBig} days apart`);
          lastBig = day;
        }
        if (day >= 2)
          ok(
            !(n === sizeForDay(day - 1) && n === sizeForDay(day - 2)),
            `day ${day}: three days of ${n}`,
          );
      }
    },
  );

  t(
    'gotd schedule: a pure function of the date, pinned: 20261121..20261220 are the golden sizes',
    () => {
      const d0 = dayOfDate('20261121'),
        sizes = Array.from({ length: 30 }, (_, i) => sizeForDay(d0 + i));
      eq(
        sizes.join(','),
        GOLDEN_SCHEDULE,
        'the schedule changed: only on purpose (see the top of core/gotd-schedule.js)',
      );
      eq(
        Array.from({ length: 30 }, (_, i) => sizeForDay(d0 + i)),
        sizes,
        'the second call (a cached cycle) gives the same sizes',
      );
      eq(cycleOrder(Math.floor(d0 / CYCLE_DAYS)), cycleOrder(Math.floor(d0 / CYCLE_DAYS)));
    },
  );

  t(
    'gotd schedule: 7 and 8 are the most frequent sizes, then 6 and 9 (less), 10 and 11 occasionally; 11 the rarest',
    () => {
      const c = SIZE_BAG;
      ok(c[7] > c[6] && c[7] > c[9] && c[8] > c[6] && c[8] > c[9], '7 and 8 beat 6 and 9');
      ok(
        c[9] > c[10] && c[6] >= c[10] && c[10] > c[11] && Math.min(...Object.values(c)) === c[11],
        '11 is the rarest',
      );
      eq(Object.keys(c).map(Number), [6, 7, 8, 9, 10, 11]);
      const per = 28 * 100,
        seen = {};
      for (let day = 0; day < per; day++) seen[sizeForDay(day)] = (seen[sizeForDay(day)] || 0) + 1;
      eq(
        seen,
        Object.fromEntries(Object.entries(c).map(([n, k]) => [n, k * 100])),
        'exact shares over 100 cycles',
      );
    },
  );

  t('gotd schedule: orderOk refuses what the rules refuse', () => {
    const base = [
      7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9,
    ];
    ok(orderOk(base));
    const put = (i, v) => {
      const s = base.slice();
      s[i] = v;
      return s;
    };
    ok(!orderOk(put(0, 10)), 'big first');
    ok(!orderOk(put(27, 11)), 'big last');
    ok(!orderOk(put(5, 10).map((v, i) => (i === 6 ? 11 : v))), 'two bigs next to each other');
    ok(!orderOk(put(5, 10).map((v, i) => (i === 7 ? 11 : v))), 'two bigs two days apart');
    ok(orderOk(put(5, 10).map((v, i) => (i === 8 ? 11 : v))), 'two bigs BIG_GAP days apart');
    ok(!orderOk(put(10, 8).map((v, i) => (i === 9 ? 8 : i === 11 ? 8 : v))), 'a run of three');
    ok(!orderOk(put(1, 7)), 'an equal pair at the start');
    ok(!orderOk(put(26, 9)), 'an equal pair at the end');
  });

  t(
    'gotd dates: dayOfDate / dateOfDay are the day numbers of features/daily.js, and bad dates are refused',
    () => {
      for (const date of ['20260101', '20260228', '20240229', '20261231', '20270301']) {
        const day = dayOfDate(date);
        eq(
          day,
          utcDayNumber(
            new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6))),
          ),
          date,
        );
        eq(dateOfDay(day), date);
        eq(dateOfDay(day), dailyDateOfDay(day));
      }
      for (const bad of ['2026-11-04', '2026113', '20261301', '20260230', '20250229', '']) {
        let message = '';
        try {
          dayOfDate(bad);
        } catch (e) {
          message = e.message;
        }
        ok(message, `${JSON.stringify(bad)} must be refused`);
      }
    },
  );

  t('gotd seed: an integer that is the same every time and changes with every argument', () => {
    const base = slotSeed('a6-x', 20261, 8, 0);
    eq(base, slotSeed('a6-x', 20261, 8, 0));
    ok(Number.isInteger(base) && base >= 0 && base < 2 ** 32);
    const others = [
      slotSeed('a6-y', 20261, 8, 0),
      slotSeed('a6-x', 20262, 8, 0),
      slotSeed('a6-x', 20261, 9, 0),
      slotSeed('a6-x', 20261, 8, 1),
    ];
    eq(new Set([base, ...others]).size, 5);
  });

  t(
    'gotd stamp: the same parts give the same stamp; the trap model, the settings or the algorithm version change it',
    () => {
      const parts = stampParts();
      ok(/^a\d+-[0-9a-f]{8}$/.test(genStamp()), genStamp());
      eq(genStamp(parts), genStamp(stampParts()));
      const refit = {
        ...parts,
        model: { ...TRAP_MODEL, cuts: TRAP_MODEL.cuts.map(c => c + 0.01) },
      };
      const margin = { ...parts, gotd: { ...parts.gotd, margin: 0.4 } };
      const algo = { ...parts, algo: parts.algo + 1 };
      eq(new Set([genStamp(parts), genStamp(refit), genStamp(margin), genStamp(algo)]).size, 4);
    },
  );

  t(
    'format: serialize(p, { comments }) writes # lines that parse() and ratingKey() ignore',
    () => {
      const p = asymmetric(),
        plain = serialize(p),
        noted = serialize(p, { comments: ['gotd candidate abc', 'gen x slot 1'] });
      ok(noted.includes('# gotd candidate abc\n# gen x slot 1\nsize 5'), noted);
      eq(ratingKey(noted), ratingKey(plain));
      eq(serialize(parse(noted)), plain);
      eq(serialize(p, {}), plain);
    },
  );

  t(
    'gotd distinct: all 16 symmetries of a puzzle (rotation, reflection, reversed numbering) conflict; another puzzle does not',
    () => {
      const p = asymmetric(),
        d = createDistinct();
      d.add({ symKey: symmetryKey(p), where: 'the original' });
      eq(d.size, 1);
      for (const rev of [false, true]) {
        for (let k = 0; k < 8; k++) {
          const c = d.conflict(symmetryKey(transformPuzzle(p, k, rev)));
          eq(c, { kind: 'puzzle', where: 'the original' }, `k=${k} rev=${rev}`);
        }
      }
      const other = asymmetric();
      other.cp[24] = 0;
      other.cp[23] = 4;
      eq(d.conflict(symmetryKey(other)), null);
      d.add({ symKey: symmetryKey(p), where: 'a second add does not replace the first' });
      eq(d.conflict(symmetryKey(p)).where, 'the original');
    },
  );

  t(
    'gotd distinct: the same solution path is found under every symmetry; another path is not',
    () => {
      const key = pathKey(4, SNAKE4);
      ok(/^[0-9a-f]{16}$/.test(key));
      eq(pathKey(4, SNAKE4.slice().reverse()), key, 'a path read backwards');
      const columns = SNAKE4.map(c => (c % 4) * 4 + ((c / 4) | 0)); // the snake turned a quarter: rows become columns
      eq(pathKey(4, columns), key, 'the snake turned');
      ok(pathKey(4, SPIRAL4) !== key, 'a spiral is another path');
      const d = createDistinct();
      d.add({ pathKey: key, where: 'a published puzzle' });
      eq(d.conflict('some other puzzle', pathKey(4, columns)), {
        kind: 'path',
        where: 'a published puzzle',
      });
      eq(d.conflict('some other puzzle', pathKey(4, SPIRAL4)), null);
      eq(d.conflict('some other puzzle'), null);
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
      const dir = new URL('./fixtures/gotd-queue/', import.meta.url);
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
  t.slow(
    'gotd candidate: a 7x7 slot yields a candidate that is Hard or harder with margin, unique, and recorded in the queue entry',
    () => {
      const made = generated();
      ok(made, 'no candidate in 8 generator runs');
      const e = made.entry;
      ok(/^[0-9a-f]{12}$/.test(e.id) && e.id === puzzleId(made.symKey), e.id);
      eq(
        [e.size, e.slot, e.stamp, e.status, e.file],
        [7, '20261122', stamp, 'pending', candidateFile(e)],
      );
      eq(e.file, `c-7-${e.id}.txt`);
      ok(e.trap.grade >= GOTD_CFG.grade, `grade ${e.trap.grade}`);
      ok(
        e.trap.pred >= TRAP_MODEL.cuts[GOTD_CFG.grade - 1] + 0.4 * 0.5 &&
          Number.isFinite(e.trap.max) &&
          Number.isFinite(e.corr.wideFrac),
        JSON.stringify(e),
      );
      eq(e.seed, slotSeed(stamp, day, 7, e.attempt));
      ok(e.K >= 7 && e.walls >= 0 && /^[0-9a-f]{16}$/.test(e.pathKey));
    },
  );

  const NOT_TIMED = text => text.replace(/, \d+\.\d s,/, ', X s,'); // the seconds are the one thing in a candidate's file that depends on the machine

  t(
    'gotd candidate: the file is the puzzle, a line naming the candidate and the origin lines, no solution path; it parses back to the same puzzle',
    () => {
      const made = frozen(),
        e = made.entry,
        text = candidateText(made.puzzle, e, made.origin);
      ok(text.endsWith('\n') && !/^path /m.test(text), 'no path line: a reviewer plays it blind');
      const lines = text
        .split('\n')
        .filter(l => l.startsWith('# '))
        .slice(-3);
      eq(lines[0], `# gotd candidate ${e.id} for ${e.slot}, attempt ${e.attempt}`);
      ok(
        /^# seed \d+: grade \d \(target 3\+, inside the margin\), \d+ walls, \d+ checkpoints, \d+\.\d s, \d+ changes, \d+ tries$/.test(
          lines[1],
        ),
        lines[1],
      );
      eq(
        lines[2],
        `# gen ${e.stamp}: node tools/gen-target.mjs --size 7 --grade 3 --at-least --margin 0.5 --retries 12 --seed ${e.seed}`,
      );
      ok(
        lines[1].startsWith(`# seed ${e.seed}: `),
        "the seed of the summary line is the candidate's",
      );
      eq(symmetryKey(parse(text)), made.symKey);
      eq(ratingKey(text), ratingKey(serialize(made.puzzle)));
      eq(
        candidateText(made.puzzle, made.entry).includes('# seed'),
        false,
        'without origin only the first line',
      );
    },
  );

  t.slow(
    'gotd candidate: the comment is enough to make the puzzle again: gen-target options from the command line give the same puzzle, grade, walls, checkpoints, changes and tries',
    () => {
      const made = generated(),
        cmd = made.origin[1],
        opt = name => cmd.match(new RegExp(`--${name} (\\S+)`))[1],
        summary = made.origin[0];
      const r = runSync(
        generateTargeted(+opt('size'), +opt('grade'), +opt('seed'), {
          atLeast: cmd.includes('--at-least'),
          margin: +opt('margin'),
          retries: +opt('retries'),
        }),
      );
      eq(symmetryKey(r.puzzle), made.symKey);
      eq(serialize(r.puzzle), serialize(made.puzzle));
      ok(
        summary.includes(
          `grade ${r.grade} (target ${r.target}+${r.inside ? ', inside the margin' : ''}), ${r.walls} walls, ${r.K} checkpoints, `,
        ) && summary.endsWith(`, ${r.proposals} changes, ${r.tries} tries`),
        summary,
      );
    },
  );

  t(
    'gotd candidate: carriedOrigin takes the seed and gen lines of a candidate file (also the one gen line of the first queue files), nothing else',
    () => {
      const made = frozen(),
        text = candidateText(made.puzzle, made.entry, made.origin);
      eq(carriedOrigin(text), made.origin);
      eq(carriedOrigin(serialize(made.puzzle)), []);
      eq(
        carriedOrigin(
          '# Zip Puzzle\n# gotd candidate x\n# gen a6-t slot 20261122 seed 5 attempt 0\nsize 7\n',
        ),
        ['gen a6-t slot 20261122 seed 5 attempt 0'],
      );
      eq(carriedOrigin('# seed 1: grade 3\r\n# genetics are not\r\n# gen a6-x: node\r\n'), [
        'seed 1: grade 3',
        'gen a6-x: node',
      ]);
    },
  );

  t.slow(
    'gotd candidate: the same arguments give the same candidate, text and entry (the seconds apart)',
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
      ok(again.ok);
      eq(
        NOT_TIMED(candidateText(again.puzzle, again.entry, again.origin)),
        NOT_TIMED(candidateText(made.puzzle, made.entry, made.origin)),
      );
      eq(again.entry, made.entry);
    },
  );

  // The grade a puzzle needs depends on the fitted model (tools/fit-trap.mjs refits it when the labels change), so the tests of the
  // other gates hold the grade (holdGrade) and the frozen puzzle does not have to be Hard under every model.
  t(
    'gotd gates: a duplicate (also rotated, mirrored or reversed) and a repeated solution path are refused with the reason',
    () => {
      const { puzzle, entry, symKey } = frozen();
      const d = createDistinct();
      d.add({ symKey, pathKey: entry.pathKey, where: 'queue candidate x' });
      eq(vetCandidate(puzzle, 7, d), {
        ok: false,
        reason: 'duplicate',
        detail: 'queue candidate x',
      });
      const turned = transformPuzzle(puzzle, 3, true);
      eq(
        vetCandidate(turned, 7, d).reason,
        'duplicate',
        'the same puzzle turned and numbered backwards',
      );
      const onlyPath = createDistinct();
      onlyPath.add({ pathKey: entry.pathKey, where: 'a published puzzle' });
      eq(vetCandidate(puzzle, 7, onlyPath, { holdGrade: true }), {
        ok: false,
        reason: 'duplicate-path',
        detail: 'a published puzzle',
      });
    },
  );

  t(
    'gotd gates: a puzzle that passes is described by an entry with its id, size, checkpoints, walls and path key',
    () => {
      const { puzzle, entry } = frozen();
      const r = vetCandidate(puzzle, 7, createDistinct(), { holdGrade: true });
      ok(r.ok, JSON.stringify(r));
      const { id, size, K, walls, pathKey: key } = r.entry;
      eq(
        { id, size, K, walls, pathKey: key },
        { id: entry.id, size: 7, K: entry.K, walls: entry.walls, pathKey: entry.pathKey },
      );
    },
  );

  t('gotd gates: the wrong size and an invalid puzzle are refused with the reason', () => {
    eq(vetCandidate(frozen().puzzle, 8, createDistinct()).reason, 'size');
    eq(vetCandidate(makePuzzle(7), 7, createDistinct()).reason, 'invalid');
  });

  t.slow(
    'gotd gates: a generated candidate passes, and an easy puzzle is refused (grade), not accepted',
    () => {
      const made = generated();
      const accepted = vetCandidate(made.puzzle, 7, createDistinct());
      ok(accepted.ok, JSON.stringify(accepted).slice(0, 120));
      eq(accepted.entry, {
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
      ok(
        !r.ok && (r.reason === 'grade' || r.reason === 'margin'),
        `an easy puzzle gave ${JSON.stringify(r).slice(0, 120)}`,
      );
    },
  );

  // ---- queue: planner, fill loop, index ----
  const cand = (id, size, slot, over = {}) => ({
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

  t(
    'gotd plan: open days from today, none that has a file, each with the size of the schedule and the runs already spent',
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
      eq(
        plan.slots.map(s => s.date),
        ['20261121', '20261123', '20261124', '20261125'],
      );
      eq(
        plan.slots.map(s => s.size),
        plan.slots.map(s => sizeOn(s.date)),
      );
      eq(
        plan.slots.map(s => [s.have, s.need, s.attempts]),
        [
          [0, 2, 0],
          [0, 2, 4],
          [0, 2, 0],
          [0, 2, 0],
        ],
      );
      eq(plan.adopt, []);
    },
  );

  t(
    'gotd plan: pending candidates count under the current stamp only, approved ones always, rejected ones never',
    () => {
      const date = '20261121',
        size = sizeOn(date),
        index = emptyIndex();
      index.candidates = [
        cand(id12(1), size, date),
        cand(id12(2), size, date, { stamp: 'OLD' }),
        cand(id12(3), size, date, { stamp: 'OLD', status: 'approved' }),
        cand(id12(4), size, date, { status: 'rejected' }),
      ];
      const plan = planFill({
        today,
        horizon: 1,
        perSlot: 3,
        published: new Set(),
        index,
        stamp: 'S',
      });
      eq([plan.slots[0].have, plan.slots[0].need], [2, 1]);
      ok(
        usable(index.candidates[0], 'S') &&
          !usable(index.candidates[1], 'S') &&
          usable(index.candidates[2], 'S') &&
          !usable(index.candidates[3], 'S'),
      );
    },
  );

  t(
    'gotd status: per size the candidates of this stamp, of an older one, approved and rejected; the review plan; the stock of each day',
    () => {
      const index = emptyIndex();
      index.candidates = [
        cand(id12(1), 7, '20261122'), // this stamp: stock, offered for the 7x7 day
        cand(id12(2), 7, '20261122', { stamp: 'OLD' }), // an older stamp: neither stock nor offered
        cand(id12(3), 8, '20261123', { stamp: 'OLD', status: 'approved' }), // approved: stock whatever its stamp, and it covers 20261123
        cand(id12(4), 8, '20261123', { status: 'rejected' }),
        cand(id12(5), 8, '20261123'), // this stamp, but no open 8x8 day is left: extra
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
      eq(status.bySize, [
        { size: 7, pending: 1, older: 1, approved: 0, rejected: 0 },
        { size: 8, pending: 1, older: 0, approved: 1, rejected: 1 },
      ]);
      eq(
        status.review,
        { count: 2, fit: 1, extra: 1, open: 2, span: 3 },
        'open: 20261121 (11x11) and 20261122; 20261123 has its approved one',
      );
      eq(status.stock, { 20261122: 1, 20261123: 2 });
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
      eq(
        other.bySize.map(c => [c.pending, c.older]),
        [
          [1, 1],
          [0, 1],
        ],
      );
      eq(other.stock, { 20261122: 1, 20261123: 1 });
    },
  );

  t(
    'gotd plan: candidates of a day that is published (or past) move to the earliest open day of their size that lacks candidates',
    () => {
      eq(
        [sizeOn('20261122'), sizeOn('20261123'), sizeOn('20261124')],
        [7, 8, 8],
        'the golden schedule this test is written for',
      );
      const published = new Set(['20261123']),
        index = emptyIndex();
      index.candidates = [
        cand(id12(1), 8, '20261123'),
        cand(id12(2), 8, '20261123', { attempt: 1 }),
        cand(id12(3), 7, '20261123'),
      ];
      const plan = planFill({ today, horizon: 6, perSlot: 1, published, index, stamp: 'S' });
      eq(
        plan.adopt,
        [
          { id: id12(3), slot: '20261122' },
          { id: id12(1), slot: '20261124' },
        ],
        'days in order; a candidate only goes to a day of its size; the second 8 has no day left',
      );
      eq(
        plan.slots
          .filter(s => ['20261122', '20261124'].includes(s.date))
          .map(s => [s.have, s.need]),
        [
          [1, 0],
          [1, 0],
        ],
      );
      const next = applyFill(index, plan, { slots: {}, added: [] });
      eq(
        next.candidates.map(c => [c.id, c.slot]),
        [
          [id12(1), '20261124'],
          [id12(2), '20261123'],
          [id12(3), '20261122'],
        ].sort((a, b) => (a[1] < b[1] ? -1 : 1)),
      );
      eq(
        planFill({ today, horizon: 6, perSlot: 1, published, index: next, stamp: 'S' }).adopt,
        [],
        'nothing left to move',
      );
      eq(
        planFill({ today, horizon: 6, perSlot: 2, published, index: next, stamp: 'S' }).adopt,
        [{ id: id12(2), slot: '20261124' }],
        'with 2 wanted per day the second 8 finds its day',
      );
      eq(
        planFill({
          today,
          horizon: 6,
          perSlot: 1,
          published: new Set(),
          index: { ...emptyIndex(), candidates: [cand(id12(9), 8, '20261120')] },
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
    ok(!distinct.conflict(`key ${id}`), 'a stand-in puzzle is new');
    return {
      ok: true,
      symKey: `key ${id}`,
      path: [],
      puzzle: makePuzzle(size),
      entry: {
        ...cand(id, size, date, { attempt, stamp: st }),
        pathKey: id,
        trap: { pred: 2.3, grade: 3 },
      },
    };
  };

  t(
    'gotd fill: runs only the missing candidates, counts failed runs per reason, continues the attempt numbers, stops at maxNew / maxAttempts',
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
      eq(r.added.length, 6);
      eq(r.fails, { margin: 2 }, 'attempt 1 of the two days that start at 0 fails');
      eq(
        r.added.filter(a => a.entry.slot === '20261121').map(a => a.entry.attempt),
        [2, 3],
        'the first day continues after the 2 runs spent',
      );
      eq(
        r.added.filter(a => a.entry.slot === '20261122').map(a => a.entry.attempt),
        [0, 2],
      );
      eq(r.slots['20261121'], { size: sizeOn('20261121'), attempts: 4, stamp: 'S' });
      eq(r.slots['20261122'].attempts, 3);
      eq(r.starved, []);
      const few = fillQueue({
        plan,
        distinct: createDistinct(),
        stamp: 'S',
        maxNew: 3,
        make: stub,
      });
      eq(few.added.length, 3, 'maxNew');
      const runs = fillQueue({
        plan,
        distinct: createDistinct(),
        stamp: 'S',
        maxAttempts: 4,
        make: stub,
      });
      eq(runs.tries, 4, 'maxAttempts');
      eq(
        fillQueue({ plan, distinct: createDistinct(), stamp: 'S', maxNew: 0, make: stub }).added,
        [],
      );
    },
  );

  t(
    'gotd fill: a day that used all its runs is starved; a rerun on the stored index adds nothing (idempotent)',
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
      eq([r.tries, r.starved, r.added.length, r.fails], [5, ['20261121'], 0, { grade: 5 }]);
      const again = planFill({
        today,
        horizon: 1,
        perSlot: 1,
        published: new Set(),
        index: applyFill(emptyIndex(), plan, r),
        stamp: 'S',
      });
      eq(again.slots[0].attempts, 5, 'the 5 runs are not repeated');
      eq(
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
      eq(
        second.slots.map(s => s.need),
        [0, 0, 0, 0],
      );
      const calls = made1;
      eq(
        fillQueue({ plan: second, distinct: createDistinct(), stamp: 'S', make: stub }).added
          .length,
        0,
      );
      eq(made1, calls, 'the generator is not called');
    },
  );

  t('gotd plan: the runs a day has used count per stamp; a new stamp starts at 0', () => {
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
    eq(
      plan.slots.map(s => s.attempts),
      [0, 3, 2],
    );
    const r = fillQueue({ plan, distinct: createDistinct(), stamp: 'S', make: stub });
    eq(
      r.added.map(a => [a.entry.slot, a.entry.attempt]),
      [
        ['20261121', 0],
        ['20261122', 3],
        ['20261123', 2],
      ],
      'the day of the old stamp starts again at attempt 0',
    );
    eq(r.slots['20261121'], { size: sizeOn('20261121'), attempts: 1, stamp: 'S' });
  });

  t(
    'gotd restamp: a candidate still Hard takes the stamp and keeps its place; the others stay',
    () => {
      const old = (n, size, slot, over = {}) =>
        cand(id12(n), size, slot, { stamp: 'OLD', trap: { pred: 2.3, grade: 3 }, ...over });
      const index = {
        ...emptyIndex(),
        candidates: [
          old(1, 7, '20261121'),
          old(2, 7, '20261121'),
          old(3, 8, '20261122'),
          old(4, 8, '20261122'),
          cand(id12(5), 8, '20261122'),
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
      eq(seen, [1, 2, 3, 4], 'only pending ones of another stamp, earliest day first');
      eq([r.old, r.kept, r.fails], [4, 1, { margin: 1, file: 1, duplicate: 1 }]);
      const by = n => r.index.candidates.find(c => c.id === id12(n));
      eq(by(1), {
        ...old(1, 7, '20261121'),
        stamp: 'S',
        K: 9,
        walls: 3,
        pathKey: 'pk',
        trap: { pred: 2.6, grade: 3 },
        corr: { wideFrac: 0.1 },
      });
      eq(
        [2, 3, 4, 6, 7].map(n => by(n).stamp),
        ['OLD', 'OLD', 'OLD', 'OLD', 'OLD'],
        'not kept, approved and rejected ones are as they were',
      );
      eq(by(5), index.candidates[4], 'a candidate of this stamp is not touched');
      eq(log.length, 4);
      eq(
        r.index.candidates.filter(c => usable(c, 'S')).map(c => +c.id),
        [1, 5, 6],
        'the kept one counts now',
      );
      eq(index.candidates[0].stamp, 'OLD', 'the index given is not changed');
    },
  );

  t(
    'gotd index: formatIndex and parseIndex round trip byte for byte; the candidates stay in day order, one per line',
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
      eq(formatIndex(parseIndex(text)), text);
      eq(parseIndex(text), JSON.parse(JSON.stringify(index)));
      eq(text.split('\n').filter(l => l.startsWith('    {')).length, index.candidates.length);
      eq(
        index.candidates.map(c => c.slot),
        index.candidates.map(c => c.slot).sort(),
      );
      eq(formatIndex(emptyIndex()), '{\n  "v": 1,\n  "slots": {},\n  "candidates": []\n}\n');
      eq(parseIndex(formatIndex(emptyIndex())), emptyIndex());
    },
  );

  t('gotd index: parseIndex names what is wrong', () => {
    const msg = text => {
      try {
        parseIndex(text);
      } catch (e) {
        return e.message;
      }
      return '';
    };
    const good = c => JSON.stringify({ v: 1, slots: {}, candidates: c });
    ok(/not valid JSON/.test(msg('{')));
    ok(/"v" must be 1/.test(msg('{"v":2,"slots":{},"candidates":[]}')));
    ok(/"slots" must be an object/.test(msg('{"v":1,"slots":[],"candidates":[]}')));
    ok(/not YYYYMMDD/.test(msg('{"v":1,"slots":{"x":{"size":7,"attempts":1}},"candidates":[]}')));
    ok(
      /integer "size" and "attempts"/.test(
        msg('{"v":1,"slots":{"20261121":{"size":7}},"candidates":[]}'),
      ),
    );
    ok(/"candidates" must be an array/.test(msg('{"v":1,"slots":{},"candidates":{}}')));
    ok(/"id" must be 12 hex/.test(msg(good([{ ...cand('zz', 7, '20261121') }]))));
    ok(
      /appears twice/.test(
        msg(good([cand(id12(1), 7, '20261121'), cand(id12(1), 7, '20261122')])),
      ),
    );
    ok(/stamp, status/.test(msg(good([cand(id12(1), 7, '20261121', { status: 'maybe' })]))));
    ok(/"file" must be/.test(msg(good([cand(id12(1), 7, '20261121', { file: 'x.txt' })]))));
    eq(msg(good([cand(id12(1), 7, '20261121')])), '');
  });
}
