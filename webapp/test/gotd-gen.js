// The automatic Game of Day: the size schedule (core/gotd-schedule.js), the gates a candidate passes (core/gotd-gen.js) and the queue
// (core/gotd-queue.js). Registered by tests.js: gotdGenTests(). The command line is tested in test/gotd-gen-cli.test.js.
import { makePuzzle } from '../src/core/model.js';
import { setWallId } from '../src/core/edges.js';
import { serialize, parse } from '../src/core/format.js';
import { symmetryKey, ratingKey, transformPuzzle } from '../src/core/ratings-io.js';
import { runSync } from '../src/core/run.js';
import { generateTargeted } from '../src/core/gen/target.js';
import { TRAP_MODEL } from '../src/core/trap.js';
import { utcDayNumber, dateOfDay as dailyDateOfDay } from '../src/features/daily.js';
import { CYCLE_DAYS, SIZE_BAG, BIG_SIZE, BIG_GAP, sizeForDay, cycleOrder, orderOk, slotSeed, dayOfDate, dateOfDay } from '../src/core/gotd-schedule.js';
import { GOTD_CFG, stampParts, genStamp, createDistinct, pathKey, puzzleId, hash64, vetCandidate, makeCandidate, candidateText, candidateFile, carriedOrigin } from '../src/core/gotd-gen.js';
import { emptyIndex, parseIndex, formatIndex, planFill, fillQueue, applyFill, usable } from '../src/core/gotd-queue.js';

// 20261121 .. 20261220: the schedule is part of the product (a published day never changes, a future day is decided by this function), so it is pinned.
const GOLDEN_SCHEDULE = '11,7,8,8,6,9,7,8,7,10,8,6,8,7,9,11,9,7,8,10,8,7,6,7,10,7,8,10,8,7';

const SNAKE4 = [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12];
const SPIRAL4 = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4, 5, 6, 10, 9];
const asymmetric = () => { // a 5x5 puzzle with no symmetry of its own (validity is not needed for keys)
  const p = makePuzzle(5);
  [[0, 1], [7, 2], [13, 3], [24, 4]].forEach(([cell, k]) => { p.cp[cell] = k; });
  setWallId(p.walls, 3, true);
  setWallId(p.walls, 17, true);
  return p;
};

export function gotdGenTests(t, ok, eq) {
  t('gotd schedule: every cycle holds exactly SIZE_BAG days of each size, in an accepted order', () => {
    eq(Object.values(SIZE_BAG).reduce((a, b) => a + b, 0), CYCLE_DAYS);
    for (let cycle = 0; cycle < 800; cycle++) {
      const order = cycleOrder(cycle), count = {};
      for (const n of order) count[n] = (count[n] || 0) + 1;
      eq(count, SIZE_BAG, `cycle ${cycle}`);
      ok(orderOk(order), `cycle ${cycle}`);
    }
  });

  t('gotd schedule: big sizes are at least BIG_GAP days apart and no size runs three days, also across cycle boundaries', () => {
    let lastBig = -1e9;
    for (let day = 0; day < 800 * CYCLE_DAYS; day++) {
      const n = sizeForDay(day);
      if (n >= BIG_SIZE) { ok(day - lastBig >= BIG_GAP, `day ${day}: big sizes ${day - lastBig} days apart`); lastBig = day; }
      if (day >= 2) ok(!(n === sizeForDay(day - 1) && n === sizeForDay(day - 2)), `day ${day}: three days of ${n}`);
    }
  });

  t('gotd schedule: a pure function of the date, pinned: 20261121..20261220 are the golden sizes', () => {
    const d0 = dayOfDate('20261121'), sizes = Array.from({ length: 30 }, (_, i) => sizeForDay(d0 + i));
    eq(sizes.join(','), GOLDEN_SCHEDULE, 'the schedule changed: only on purpose (see the top of core/gotd-schedule.js)');
    eq(Array.from({ length: 30 }, (_, i) => sizeForDay(d0 + i)), sizes, 'the second call (a cached cycle) gives the same sizes');
    eq(cycleOrder(Math.floor(d0 / CYCLE_DAYS)), cycleOrder(Math.floor(d0 / CYCLE_DAYS)));
  });

  t('gotd schedule: 7 and 8 are the most frequent sizes, then 6 and 9 (less), 10 and 11 occasionally; 11 the rarest', () => {
    const c = SIZE_BAG;
    ok(c[7] > c[6] && c[7] > c[9] && c[8] > c[6] && c[8] > c[9], '7 and 8 beat 6 and 9');
    ok(c[9] > c[10] && c[6] >= c[10] && c[10] > c[11] && Math.min(...Object.values(c)) === c[11], '11 is the rarest');
    eq(Object.keys(c).map(Number), [6, 7, 8, 9, 10, 11]);
    const per = 28 * 100, seen = {};
    for (let day = 0; day < per; day++) seen[sizeForDay(day)] = (seen[sizeForDay(day)] || 0) + 1;
    eq(seen, Object.fromEntries(Object.entries(c).map(([n, k]) => [n, k * 100])), 'exact shares over 100 cycles');
  });

  t('gotd schedule: orderOk refuses what the rules refuse', () => {
    const base = [7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9, 7, 8, 7, 8, 6, 9];
    ok(orderOk(base));
    const put = (i, v) => { const s = base.slice(); s[i] = v; return s; };
    ok(!orderOk(put(0, 10)), 'big first');
    ok(!orderOk(put(27, 11)), 'big last');
    ok(!orderOk(put(5, 10).map((v, i) => (i === 6 ? 11 : v))), 'two bigs next to each other');
    ok(!orderOk(put(5, 10).map((v, i) => (i === 7 ? 11 : v))), 'two bigs two days apart');
    ok(orderOk(put(5, 10).map((v, i) => (i === 8 ? 11 : v))), 'two bigs BIG_GAP days apart');
    ok(!orderOk(put(10, 8).map((v, i) => (i === 9 ? 8 : i === 11 ? 8 : v))), 'a run of three');
    ok(!orderOk(put(1, 7)), 'an equal pair at the start');
    ok(!orderOk(put(26, 9)), 'an equal pair at the end');
  });

  t('gotd dates: dayOfDate / dateOfDay are the day numbers of features/daily.js, and bad dates are refused', () => {
    for (const date of ['20260101', '20260228', '20240229', '20261231', '20270301']) {
      const day = dayOfDate(date);
      eq(day, utcDayNumber(new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6)))), date);
      eq(dateOfDay(day), date);
      eq(dateOfDay(day), dailyDateOfDay(day));
    }
    for (const bad of ['2026-11-04', '2026113', '20261301', '20260230', '20250229', '']) {
      let message = '';
      try { dayOfDate(bad); } catch (e) { message = e.message; }
      ok(message, `${JSON.stringify(bad)} must be refused`);
    }
  });

  t('gotd seed: an integer that is the same every time and changes with every argument', () => {
    const base = slotSeed('a6-x', 20261, 8, 0);
    eq(base, slotSeed('a6-x', 20261, 8, 0));
    ok(Number.isInteger(base) && base >= 0 && base < 2 ** 32);
    const others = [slotSeed('a6-y', 20261, 8, 0), slotSeed('a6-x', 20262, 8, 0), slotSeed('a6-x', 20261, 9, 0), slotSeed('a6-x', 20261, 8, 1)];
    eq(new Set([base, ...others]).size, 5);
  });

  t('gotd stamp: the same parts give the same stamp; the trap model, the settings or the algorithm version change it', () => {
    const parts = stampParts();
    ok(/^a\d+-[0-9a-f]{8}$/.test(genStamp()), genStamp());
    eq(genStamp(parts), genStamp(stampParts()));
    const refit = { ...parts, model: { ...TRAP_MODEL, cuts: TRAP_MODEL.cuts.map(c => c + 0.01) } };
    const margin = { ...parts, gotd: { ...parts.gotd, margin: 0.4 } };
    const algo = { ...parts, algo: parts.algo + 1 };
    eq(new Set([genStamp(parts), genStamp(refit), genStamp(margin), genStamp(algo)]).size, 4);
  });

  t('format: serialize(p, { comments }) writes # lines that parse() and ratingKey() ignore', () => {
    const p = asymmetric(), plain = serialize(p), noted = serialize(p, { comments: ['gotd candidate abc', 'gen x slot 1'] });
    ok(noted.includes('# gotd candidate abc\n# gen x slot 1\nsize 5'), noted);
    eq(ratingKey(noted), ratingKey(plain));
    eq(serialize(parse(noted)), plain);
    eq(serialize(p, {}), plain);
  });

  t('gotd distinct: all 16 symmetries of a puzzle (rotation, reflection, reversed numbering) conflict; another puzzle does not', () => {
    const p = asymmetric(), d = createDistinct();
    d.add({ symKey: symmetryKey(p), where: 'the original' });
    eq(d.size, 1);
    for (const rev of [false, true]) {
      for (let k = 0; k < 8; k++) {
        const c = d.conflict(symmetryKey(transformPuzzle(p, k, rev)));
        eq(c, { kind: 'puzzle', where: 'the original' }, `k=${k} rev=${rev}`);
      }
    }
    const other = asymmetric();
    other.cp[24] = 0; other.cp[23] = 4;
    eq(d.conflict(symmetryKey(other)), null);
    d.add({ symKey: symmetryKey(p), where: 'a second add does not replace the first' });
    eq(d.conflict(symmetryKey(p)).where, 'the original');
  });

  t('gotd distinct: the same solution path is found under every symmetry; another path is not', () => {
    const key = pathKey(4, SNAKE4);
    ok(/^[0-9a-f]{16}$/.test(key));
    eq(pathKey(4, SNAKE4.slice().reverse()), key, 'a path read backwards');
    const columns = SNAKE4.map(c => (c % 4) * 4 + ((c / 4) | 0)); // the snake turned a quarter: rows become columns
    eq(pathKey(4, columns), key, 'the snake turned');
    ok(pathKey(4, SPIRAL4) !== key, 'a spiral is another path');
    const d = createDistinct();
    d.add({ pathKey: key, where: 'a published puzzle' });
    eq(d.conflict('some other puzzle', pathKey(4, columns)), { kind: 'path', where: 'a published puzzle' });
    eq(d.conflict('some other puzzle', pathKey(4, SPIRAL4)), null);
    eq(d.conflict('some other puzzle'), null);
  });

  // One real candidate of size 7 (about a second): the generator under the GOTD settings, then the gates.
  const stamp = 'a6-test', day = dayOfDate('20261122');
  let made = null, attempt = 0;
  const first = createDistinct();
  for (; attempt < 8 && !made; attempt++) {
    const r = makeCandidate({ stamp, day, date: '20261122', size: 7, attempt, distinct: first });
    if (r.ok) made = r;
  }
  t('gotd candidate: a 7x7 slot yields a candidate that is Hard or harder with margin, unique, and recorded in the queue entry', () => {
    ok(made, 'no candidate in 8 generator runs');
    const e = made.entry;
    ok(/^[0-9a-f]{12}$/.test(e.id) && e.id === puzzleId(made.symKey), e.id);
    eq([e.size, e.slot, e.stamp, e.status, e.file], [7, '20261122', stamp, 'pending', candidateFile(e)]);
    eq(e.file, `c-7-${e.id}.txt`);
    ok(e.trap.grade >= GOTD_CFG.grade, `grade ${e.trap.grade}`);
    ok(e.trap.pred >= TRAP_MODEL.cuts[GOTD_CFG.grade - 1] + 0.4 * 0.5 && Number.isFinite(e.trap.max) && Number.isFinite(e.corr.wideFrac), JSON.stringify(e));
    eq(e.seed, slotSeed(stamp, day, 7, e.attempt));
    ok(e.K >= 7 && e.walls >= 0 && /^[0-9a-f]{16}$/.test(e.pathKey));
  });

  const NOT_TIMED = text => text.replace(/, \d+\.\d s,/, ', X s,'); // the seconds are the one thing in a candidate's file that depends on the machine

  t('gotd candidate: the file is the puzzle, a line naming the candidate and the origin lines, no solution path; it parses back to the same puzzle', () => {
    const text = candidateText(made.puzzle, made.entry, made.origin), e = made.entry;
    ok(text.endsWith('\n') && !/^path /m.test(text), 'no path line: a reviewer plays it blind');
    const lines = text.split('\n').filter(l => l.startsWith('# ')).slice(-3);
    eq(lines[0], `# gotd candidate ${e.id} for 20261122, attempt ${e.attempt}`);
    ok(/^# seed \d+: grade \d \(target 3\+, inside the margin\), \d+ walls, \d+ checkpoints, \d+\.\d s, \d+ changes, \d+ tries$/.test(lines[1]), lines[1]);
    eq(lines[2], `# gen ${stamp}: node tools/gen-target.mjs --size 7 --grade 3 --at-least --margin 0.5 --retries 12 --seed ${e.seed}`);
    ok(lines[1].startsWith(`# seed ${e.seed}: `), 'the seed of the summary line is the candidate\'s');
    eq(symmetryKey(parse(text)), made.symKey);
    eq(ratingKey(text), ratingKey(serialize(made.puzzle)));
    eq(candidateText(made.puzzle, made.entry).includes('# seed'), false, 'without origin only the first line');
  });

  t('gotd candidate: the comment is enough to make the puzzle again: gen-target options from the command line give the same puzzle, grade, walls, checkpoints, changes and tries', () => {
    const cmd = made.origin[1], opt = name => cmd.match(new RegExp(`--${name} (\\S+)`))[1], summary = made.origin[0];
    const r = runSync(generateTargeted(+opt('size'), +opt('grade'), +opt('seed'), { atLeast: cmd.includes('--at-least'), margin: +opt('margin'), retries: +opt('retries') }));
    eq(symmetryKey(r.puzzle), made.symKey);
    eq(serialize(r.puzzle), serialize(made.puzzle));
    ok(summary.includes(`grade ${r.grade} (target ${r.target}+${r.inside ? ', inside the margin' : ''}), ${r.walls} walls, ${r.K} checkpoints, `) && summary.endsWith(`, ${r.proposals} changes, ${r.tries} tries`), summary);
  });

  t('gotd candidate: carriedOrigin takes the seed and gen lines of a candidate file (also the one gen line of the first queue files), nothing else', () => {
    const text = candidateText(made.puzzle, made.entry, made.origin);
    eq(carriedOrigin(text), made.origin);
    eq(carriedOrigin(serialize(made.puzzle)), []);
    eq(carriedOrigin('# Zip Puzzle\n# gotd candidate x\n# gen a6-t slot 20261122 seed 5 attempt 0\nsize 7\n'), ['gen a6-t slot 20261122 seed 5 attempt 0']);
    eq(carriedOrigin('# seed 1: grade 3\r\n# genetics are not\r\n# gen a6-x: node\r\n'), ['seed 1: grade 3', 'gen a6-x: node']);
  });

  t('gotd candidate: the same arguments give the same candidate, text and entry (the seconds apart)', () => {
    const again = makeCandidate({ stamp, day, date: '20261122', size: 7, attempt: made.entry.attempt, distinct: createDistinct() });
    ok(again.ok);
    eq(NOT_TIMED(candidateText(again.puzzle, again.entry, again.origin)), NOT_TIMED(candidateText(made.puzzle, made.entry, made.origin)));
    eq(again.entry, made.entry);
  });

  t('gotd gates: a duplicate (also rotated, mirrored or reversed) and a repeated solution path are refused with the reason', () => {
    const d = createDistinct();
    d.add({ symKey: made.symKey, pathKey: made.entry.pathKey, where: 'queue candidate x' });
    eq(vetCandidate(made.puzzle, 7, d), { ok: false, reason: 'duplicate', detail: 'queue candidate x' });
    const turned = transformPuzzle(made.puzzle, 3, true);
    eq(vetCandidate(turned, 7, d).reason, 'duplicate', 'the same puzzle turned and numbered backwards');
    const onlyPath = createDistinct();
    onlyPath.add({ pathKey: made.entry.pathKey, where: 'a published puzzle' });
    eq(vetCandidate(made.puzzle, 7, onlyPath), { ok: false, reason: 'duplicate-path', detail: 'a published puzzle' });
    const ok1 = vetCandidate(made.puzzle, 7, createDistinct());
    ok(ok1.ok);
    eq(ok1.entry, { id: made.entry.id, size: 7, K: made.entry.K, walls: made.entry.walls, pathKey: made.entry.pathKey, trap: made.entry.trap, corr: made.entry.corr });
  });

  t('gotd gates: the wrong size, an invalid puzzle and an easy puzzle are refused (grade), not accepted', () => {
    eq(vetCandidate(made.puzzle, 8, createDistinct()).reason, 'size');
    eq(vetCandidate(makePuzzle(7), 7, createDistinct()).reason, 'invalid');
    const easy = runSync(generateTargeted(7, 1, 5, { retries: 3 })).puzzle;
    const r = vetCandidate(easy, 7, createDistinct());
    ok(!r.ok && (r.reason === 'grade' || r.reason === 'margin'), `an easy puzzle gave ${JSON.stringify(r).slice(0, 120)}`);
  });

  // ---- queue: planner, fill loop, index ----
  const cand = (id, size, slot, over = {}) => ({ id, file: `c-${size}-${id}.txt`, size, slot, attempt: 0, seed: 1, stamp: 'S', status: 'pending', ...over });
  const id12 = n => String(n).padStart(12, '0');
  const today = dayOfDate('20261121');
  const sizeOn = date => sizeForDay(dayOfDate(date));

  t('gotd plan: open days from today, none that has a file, each with the size of the schedule and the runs already spent', () => {
    const index = emptyIndex();
    index.slots['20261123'] = { size: sizeOn('20261123'), attempts: 4 };
    const plan = planFill({ today, horizon: 5, perSlot: 2, published: new Set(['20261122']), index, stamp: 'S' });
    eq(plan.slots.map(s => s.date), ['20261121', '20261123', '20261124', '20261125']);
    eq(plan.slots.map(s => s.size), plan.slots.map(s => sizeOn(s.date)));
    eq(plan.slots.map(s => [s.have, s.need, s.attempts]), [[0, 2, 0], [0, 2, 4], [0, 2, 0], [0, 2, 0]]);
    eq(plan.adopt, []);
  });

  t('gotd plan: pending candidates count under the current stamp only, approved ones always, rejected ones never', () => {
    const date = '20261121', size = sizeOn(date), index = emptyIndex();
    index.candidates = [cand(id12(1), size, date), cand(id12(2), size, date, { stamp: 'OLD' }), cand(id12(3), size, date, { stamp: 'OLD', status: 'approved' }), cand(id12(4), size, date, { status: 'rejected' })];
    const plan = planFill({ today, horizon: 1, perSlot: 3, published: new Set(), index, stamp: 'S' });
    eq([plan.slots[0].have, plan.slots[0].need], [2, 1]);
    ok(usable(index.candidates[0], 'S') && !usable(index.candidates[1], 'S') && usable(index.candidates[2], 'S') && !usable(index.candidates[3], 'S'));
  });

  t('gotd plan: candidates of a day that is published (or past) move to the earliest open day of their size that lacks candidates', () => {
    eq([sizeOn('20261122'), sizeOn('20261123'), sizeOn('20261124')], [7, 8, 8], 'the golden schedule this test is written for');
    const published = new Set(['20261123']), index = emptyIndex();
    index.candidates = [cand(id12(1), 8, '20261123'), cand(id12(2), 8, '20261123', { attempt: 1 }), cand(id12(3), 7, '20261123')];
    const plan = planFill({ today, horizon: 6, perSlot: 1, published, index, stamp: 'S' });
    eq(plan.adopt, [{ id: id12(3), slot: '20261122' }, { id: id12(1), slot: '20261124' }], 'days in order; a candidate only goes to a day of its size; the second 8 has no day left');
    eq(plan.slots.filter(s => ['20261122', '20261124'].includes(s.date)).map(s => [s.have, s.need]), [[1, 0], [1, 0]]);
    const next = applyFill(index, plan, { slots: {}, added: [] });
    eq(next.candidates.map(c => [c.id, c.slot]), [[id12(1), '20261124'], [id12(2), '20261123'], [id12(3), '20261122']].sort((a, b) => (a[1] < b[1] ? -1 : 1)));
    eq(planFill({ today, horizon: 6, perSlot: 1, published, index: next, stamp: 'S' }).adopt, [], 'nothing left to move');
    eq(planFill({ today, horizon: 6, perSlot: 2, published, index: next, stamp: 'S' }).adopt, [{ id: id12(2), slot: '20261124' }], 'with 2 wanted per day the second 8 finds its day');
    eq(planFill({ today, horizon: 6, perSlot: 1, published: new Set(), index: { ...emptyIndex(), candidates: [cand(id12(9), 8, '20261120')] }, stamp: 'S' }).adopt,
      [{ id: id12(9), slot: '20261123' }], 'a candidate of a past day moves too');
  });

  // a stand-in for the generator: attempt 1 of every day fails the margin gate, the others succeed
  let made1 = 0;
  const stub = ({ stamp: st, date, size, attempt, distinct }) => {
    if (attempt === 1) return { ok: false, reason: 'margin', detail: 'score too low' };
    const id = hash64(`${date}:${attempt}`).slice(0, 12);
    made1++;
    ok(!distinct.conflict(`key ${id}`), 'a stand-in puzzle is new');
    return { ok: true, symKey: `key ${id}`, path: [], puzzle: makePuzzle(size), entry: { ...cand(id, size, date, { attempt, stamp: st }), pathKey: id, trap: { pred: 2.3, grade: 3 } } };
  };

  t('gotd fill: runs only the missing candidates, counts failed runs per reason, continues the attempt numbers, stops at maxNew / maxAttempts', () => {
    const index = emptyIndex();
    index.slots['20261121'] = { size: sizeOn('20261121'), attempts: 2 };
    const plan = planFill({ today, horizon: 3, perSlot: 2, published: new Set(), index, stamp: 'S' });
    const r = fillQueue({ plan, distinct: createDistinct(), stamp: 'S', maxNew: 100, maxAttempts: 100, make: stub });
    eq(r.added.length, 6);
    eq(r.fails, { margin: 2 }, 'attempt 1 of the two days that start at 0 fails');
    eq(r.added.filter(a => a.entry.slot === '20261121').map(a => a.entry.attempt), [2, 3], 'the first day continues after the 2 runs spent');
    eq(r.added.filter(a => a.entry.slot === '20261122').map(a => a.entry.attempt), [0, 2]);
    eq(r.slots['20261121'], { size: sizeOn('20261121'), attempts: 4 });
    eq(r.slots['20261122'].attempts, 3);
    eq(r.starved, []);
    const few = fillQueue({ plan, distinct: createDistinct(), stamp: 'S', maxNew: 3, make: stub });
    eq(few.added.length, 3, 'maxNew');
    const runs = fillQueue({ plan, distinct: createDistinct(), stamp: 'S', maxAttempts: 4, make: stub });
    eq(runs.tries, 4, 'maxAttempts');
    eq(fillQueue({ plan, distinct: createDistinct(), stamp: 'S', maxNew: 0, make: stub }).added, []);
  });

  t('gotd fill: a day that used all its runs is starved; a rerun on the stored index adds nothing (idempotent)', () => {
    const never = () => ({ ok: false, reason: 'grade', detail: '' });
    const plan = planFill({ today, horizon: 1, perSlot: 1, published: new Set(), index: emptyIndex(), stamp: 'S' });
    const r = fillQueue({ plan, distinct: createDistinct(), stamp: 'S', slotAttempts: 5, make: never });
    eq([r.tries, r.starved, r.added.length, r.fails], [5, ['20261121'], 0, { grade: 5 }]);
    const again = planFill({ today, horizon: 1, perSlot: 1, published: new Set(), index: applyFill(emptyIndex(), plan, r), stamp: 'S' });
    eq(again.slots[0].attempts, 5, 'the 5 runs are not repeated');
    eq(fillQueue({ plan: again, distinct: createDistinct(), stamp: 'S', slotAttempts: 5, make: never }).tries, 0);
    // after a full fill the plan needs nothing
    const full = planFill({ today, horizon: 4, perSlot: 2, published: new Set(), index: emptyIndex(), stamp: 'S' });
    const filled = applyFill(emptyIndex(), full, fillQueue({ plan: full, distinct: createDistinct(), stamp: 'S', make: stub }));
    const second = planFill({ today, horizon: 4, perSlot: 2, published: new Set(), index: filled, stamp: 'S' });
    eq(second.slots.map(s => s.need), [0, 0, 0, 0]);
    const calls = made1;
    eq(fillQueue({ plan: second, distinct: createDistinct(), stamp: 'S', make: stub }).added.length, 0);
    eq(made1, calls, 'the generator is not called');
  });

  t('gotd index: formatIndex and parseIndex round trip byte for byte; the candidates stay in day order, one per line', () => {
    const plan = planFill({ today, horizon: 3, perSlot: 2, published: new Set(), index: emptyIndex(), stamp: 'S' });
    const index = applyFill(emptyIndex(), plan, fillQueue({ plan, distinct: createDistinct(), stamp: 'S', make: stub }));
    const text = formatIndex(index);
    eq(formatIndex(parseIndex(text)), text);
    eq(parseIndex(text), JSON.parse(JSON.stringify(index)));
    eq(text.split('\n').filter(l => l.startsWith('    {')).length, index.candidates.length);
    eq(index.candidates.map(c => c.slot), index.candidates.map(c => c.slot).sort());
    eq(formatIndex(emptyIndex()), '{\n  "v": 1,\n  "slots": {},\n  "candidates": []\n}\n');
    eq(parseIndex(formatIndex(emptyIndex())), emptyIndex());
  });

  t('gotd index: parseIndex names what is wrong', () => {
    const msg = text => { try { parseIndex(text); } catch (e) { return e.message; } return ''; };
    const good = c => JSON.stringify({ v: 1, slots: {}, candidates: c });
    ok(/not valid JSON/.test(msg('{')));
    ok(/"v" must be 1/.test(msg('{"v":2,"slots":{},"candidates":[]}')));
    ok(/"slots" must be an object/.test(msg('{"v":1,"slots":[],"candidates":[]}')));
    ok(/not YYYYMMDD/.test(msg('{"v":1,"slots":{"x":{"size":7,"attempts":1}},"candidates":[]}')));
    ok(/integer "size" and "attempts"/.test(msg('{"v":1,"slots":{"20261121":{"size":7}},"candidates":[]}')));
    ok(/"candidates" must be an array/.test(msg('{"v":1,"slots":{},"candidates":{}}')));
    ok(/"id" must be 12 hex/.test(msg(good([{ ...cand('zz', 7, '20261121') }]))));
    ok(/appears twice/.test(msg(good([cand(id12(1), 7, '20261121'), cand(id12(1), 7, '20261122')]))));
    ok(/stamp, status/.test(msg(good([cand(id12(1), 7, '20261121', { status: 'maybe' })]))));
    ok(/"file" must be/.test(msg(good([cand(id12(1), 7, '20261121', { file: 'x.txt' })]))));
    eq(msg(good([cand(id12(1), 7, '20261121')])), '');
  });
}
