// The human side of the automatic Game of Day: rating widget rules, the verdict file, the review queue, applying verdicts, promotion planning and the published
// day's text (core/gotd-verdict.js, planPromote of core/gotd-queue.js, publishedText and the holdGrade gate of core/gotd-gen.js). Registered by tests.js.
// The design app panel (apps/design/gotd-review.js) and the command line (test/gotd-gen-cli.test.js) are tested end to end elsewhere.
import { parse, serialize, commentTimes } from '../src/core/format.js';
import { ratingKey, symmetryKey } from '../src/core/ratings-io.js';
import { runSync } from '../src/core/run.js';
import { generateTargeted } from '../src/core/gen/target.js';
import { makePuzzle } from '../src/core/model.js';
import {
  APPROVE_MIN, nextSelection, nextLean, toggleUnsure, decide, createTakebacks, makeVerdict, verdictProblem, formatVerdicts, parseVerdicts, mergeVerdicts, reviewQueue,
  applyVerdicts, reviewStats,
} from '../src/core/gotd-verdict.js';
import { dayOfDate, sizeForDay } from '../src/core/gotd-schedule.js';
import { createDistinct, vetCandidate, publishedText } from '../src/core/gotd-gen.js';
import { emptyIndex, planPromote } from '../src/core/gotd-queue.js';

const id12 = n => String(n).padStart(12, '0');
const cand = (n, size, slot, over = {}) => ({
  id: id12(n), file: `c-${size}-${id12(n)}.txt`, size, slot, attempt: n, seed: n, stamp: 'S', status: 'pending', K: 8, walls: 5, pathKey: id12(n), trap: { pred: 2.3, grade: 3 }, ...over,
});
const NOW = '2026-11-05T10:00:00Z';
const verdict = (c, human, over = {}) => makeVerdict({ candidate: c, sel: { lo: human, hi: human, lean: 0 }, solved: true, playS: 60, takebacks: 2, now: NOW, ...over });

export function gotdVerdictTests(t, ok, eq) {
  t('gotd rating widget: a grade, a neighbour makes "N or M", the same single grade clears; lean and unsure only where they make sense', () => {
    let sel = nextSelection(null, 3);
    eq(sel, { lo: 3, hi: 3, lean: 0, unsure: false });
    eq(nextSelection(sel, 3), null, 'the same single grade again removes the rating');
    sel = nextSelection(sel, 4);
    eq(sel, { lo: 3, hi: 4, lean: 0, unsure: false });
    sel = nextLean(sel, 1);
    eq(sel.lean, 1);
    eq(nextLean(sel, 1).lean, 0, 'the same lean again clears it');
    eq(nextLean({ lo: 3, hi: 3, lean: 0 }, 1), { lo: 3, hi: 3, lean: 0 }, 'no lean for a single grade');
    eq(nextSelection({ lo: 1, hi: 1, lean: 0 }, 4), { lo: 4, hi: 4, lean: 0, unsure: false }, 'a distant grade replaces');
    eq(nextSelection({ lo: 3, hi: 4, lean: 1, unsure: true }, 0), { lo: 0, hi: 0, lean: 0, unsure: true }, 'unsure survives a new grade');
    eq(toggleUnsure(sel).unsure, true);
    eq(toggleUnsure(null), null);
  });

  t('gotd verdict: a rating of Hard or more approves, below rejects; two grades use their midpoint and lean', () => {
    eq(APPROVE_MIN, 3);
    const v = (lo, hi, lean = 0) => verdict(cand(1, 7, '20261121'), 0, { sel: { lo, hi, lean } }).verdict;
    eq([v(3, 3), v(4, 4), v(5, 5), v(2, 2), v(0, 0)], ['approve', 'approve', 'approve', 'reject', 'reject']);
    eq([v(2, 3), v(2, 3, 1), v(3, 4), v(3, 4, -1)], ['reject', 'reject', 'approve', 'approve'], '2 or 3 is 2.5, even closer to 3 is 2.75: below Hard');
    eq(decide({ human: 2.99 }), 'reject');
    eq(decide({ human: 3 }), 'approve');
  });

  t('gotd verdict: makeVerdict records the rating, the blind play and what the model said; no rating is an error', () => {
    const c = cand(7, 8, '20261122', { trap: { pred: 2.31, grade: 3 } });
    const v = makeVerdict({ candidate: c, sel: { lo: 2, hi: 3, lean: 1, unsure: true }, solved: false, playS: 41.26, takebacks: 5.9, now: NOW });
    eq(v, { id: id12(7), size: 8, stamp: 'S', model: { grade: 3, pred: 2.31 }, human: 2.75, lo: 2, hi: 3, unsure: true, solved: false, playS: 41.3, takebacks: 5, verdict: 'reject', at: NOW });
    eq(Object.keys(verdict(c, 3)).includes('unsure'), false, 'sure ratings carry no unsure flag');
    eq(makeVerdict({ candidate: c, sel: { lo: 3, hi: 3, lean: 0 }, solved: true, takebacks: 0, now: NOW }).playS, undefined, 'no time, no playS');
    let message = '';
    try { makeVerdict({ candidate: c, sel: null, solved: true, now: NOW }); } catch (e) { message = e.message; }
    eq(message, 'no rating');
  });

  t('gotd takebacks: counts the path cells taken back, not the cells added', () => {
    const tb = createTakebacks();
    [1, 2, 3, 4, 5].forEach(n => tb.note(n));
    eq(tb.total, 0);
    tb.note(2);
    eq(tb.total, 3);
    tb.note(3); tb.note(4); tb.note(1);
    eq(tb.total, 6);
    tb.note(1);
    eq(tb.total, 6, 'no change, no takeback');
    tb.reset();
    eq(tb.total, 0);
    tb.note(5); tb.note(4);
    eq(tb.total, 1, 'reset also forgets the old length');
  });

  t('gotd verdict file: format and parse round trip byte for byte, one verdict per line in time order; parse names what is wrong', () => {
    const a = verdict(cand(1, 7, '20261121'), 3), b = verdict(cand(2, 8, '20261122'), 2, { now: '2026-11-05T09:00:00Z' });
    const text = formatVerdicts([a, b]);
    eq(formatVerdicts(parseVerdicts(text)), text);
    eq(parseVerdicts(text).map(v => v.id), [id12(2), id12(1)], 'earlier first');
    eq(text.split('\n').filter(l => l.startsWith('    {')).length, 2);
    eq(formatVerdicts([]), '{\n  "v": 1,\n  "verdicts": []\n}\n');
    eq(parseVerdicts(formatVerdicts([])), []);
    const msg = s => { try { parseVerdicts(s); } catch (e) { return e.message; } return ''; };
    const wrap = v => JSON.stringify({ v: 1, verdicts: v });
    ok(/not valid JSON/.test(msg('{')));
    ok(/"v" must be 1/.test(msg('{"v":3,"verdicts":[]}')));
    ok(/"verdicts" must be an array/.test(msg('{"v":1,"verdicts":{}}')));
    ok(/"id" must be 12 hex/.test(msg(wrap([{ ...a, id: 'x' }]))));
    ok(/"verdict" must be approve or reject/.test(msg(wrap([{ ...a, verdict: 'maybe' }]))));
    ok(/"human", "lo", "hi"/.test(msg(wrap([{ ...a, human: 7 }]))));
    ok(/"human", "lo", "hi"/.test(msg(wrap([{ ...a, lo: 4, hi: 3 }]))));
    ok(/"solved" must be true or false/.test(msg(wrap([{ ...a, solved: 'yes' }]))));
    ok(/"playS"/.test(msg(wrap([{ ...a, playS: -1 }]))));
    ok(/"takebacks"/.test(msg(wrap([{ ...a, takebacks: 1.5 }]))));
    ok(/"at" must be an ISO time/.test(msg(wrap([{ ...a, at: 'yesterday' }]))));
    ok(/appears twice/.test(msg(wrap([a, { ...a, at: '2026-11-06T00:00:00Z' }]))));
    eq(verdictProblem(a), '');
    ok(verdictProblem(null));
  });

  t('gotd verdicts merge: one per id, the newer wins, a tie goes to reject', () => {
    const c = cand(1, 7, '20261121'), old = verdict(c, 3), later = verdict(c, 2, { now: '2026-11-06T00:00:00Z' });
    eq(mergeVerdicts([old], [later]).map(v => v.verdict), ['reject'], 'the newer verdict wins');
    eq(mergeVerdicts([later], [old]).map(v => v.verdict), ['reject'], 'whatever the order');
    const approve = verdict(c, 3), reject = verdict(c, 1);
    eq(mergeVerdicts([approve], [reject])[0].verdict, 'reject', 'same time: reject');
    eq(mergeVerdicts([reject], [approve])[0].verdict, 'reject');
    eq(mergeVerdicts([approve], [{ ...approve, takebacks: 99 }])[0].takebacks, 2, 'same time and verdict: the first stays');
    eq(mergeVerdicts([old], [verdict(cand(2, 7, '20261121'), 3)]).length, 2);
    eq(mergeVerdicts([], []), []);
  });

  t('gotd review queue: pending of this stamp without a verdict, soonest day first; a day with an approved candidate keeps the rest in reserve', () => {
    const index = emptyIndex();
    index.candidates = [
      cand(1, 7, '20261122'), cand(2, 7, '20261122'), cand(3, 8, '20261123'), cand(4, 8, '20261123'), cand(5, 6, '20261121'),
      cand(6, 7, '20261125', { stamp: 'OLD' }), cand(7, 9, '20261126', { status: 'approved' }), cand(8, 9, '20261126'), cand(9, 11, '20261127', { status: 'rejected' }),
    ];
    const ids = list => list.map(c => +c.id);
    eq(ids(reviewQueue(index, [], 'S')), [5, 1, 2, 3, 4], 'older stamp, approved, rejected and the sibling of an approved one are not offered');
    eq(ids(reviewQueue(index, [], 'S', { reserve: true })), [5, 1, 2, 3, 4, 8], 'reserve: after the others');
    const said = [verdict(index.candidates[0], 3), verdict(index.candidates[2], 1)];
    eq(ids(reviewQueue(index, said, 'S')), [5, 4], 'an approve closes its day for the others; a reject does not; reviewed ones are gone');
    eq(ids(reviewQueue(index, said, 'S', { reserve: true })), [5, 4, 2, 8], 'the reserves of the approved days come last');
    eq(reviewQueue(emptyIndex(), [], 'S'), []);
  });

  t('gotd verdicts apply: approve and reject set the status, other candidates stay; applying twice changes nothing', () => {
    const index = emptyIndex();
    index.candidates = [cand(1, 7, '20261122'), cand(2, 7, '20261122'), cand(3, 8, '20261123')];
    const verdicts = [verdict(index.candidates[0], 4), verdict(index.candidates[1], 1), verdict(cand(99, 7, '20261122'), 3)];
    const r = applyVerdicts(index, verdicts);
    eq(r.index.candidates.map(c => c.status), ['approved', 'rejected', 'pending']);
    eq(r.changed, [{ id: id12(1), from: 'pending', to: 'approved' }, { id: id12(2), from: 'pending', to: 'rejected' }], 'a verdict without a candidate is ignored');
    const again = applyVerdicts(r.index, verdicts);
    eq(again.changed, []);
    eq(again.index, r.index);
    eq(index.candidates.map(c => c.status), ['pending', 'pending', 'pending'], 'the input is not changed');
    const flip = applyVerdicts(r.index, [verdict(index.candidates[0], 1, { now: '2026-11-06T00:00:00Z' })]);
    eq(flip.index.candidates[0].status, 'rejected', 'a later verdict can overturn an approval that was not published yet');
  });

  t('gotd review stats: per stamp the reviewed, approved and rejected counts and how far the human is from the model', () => {
    const c1 = cand(1, 7, '20261122'), c2 = cand(2, 7, '20261122'), c3 = cand(3, 7, '20261122', { stamp: 'T' });
    const stats = reviewStats([verdict(c1, 3), verdict(c2, 1), verdict(c3, 4)]);
    eq(stats.S, { reviewed: 2, approved: 1, rejected: 1, sumErr: -2, worst: -2 });
    eq(stats.T, { reviewed: 1, approved: 1, rejected: 0, sumErr: 1, worst: 1 });
    eq(reviewStats([]), {});
  });

  t('gotd promote plan: an open day takes an approved candidate of its size, the one made for it first, else the earliest; each is used once', () => {
    eq([sizeForDay(dayOfDate('20261122')), sizeForDay(dayOfDate('20261123')), sizeForDay(dayOfDate('20261124')), sizeForDay(dayOfDate('20261125'))], [7, 8, 8, 6], 'the golden schedule this test is written for');
    const today = dayOfDate('20261122'), index = emptyIndex();
    index.candidates = [
      cand(1, 8, '20261124', { status: 'approved' }), cand(2, 8, '20261123', { status: 'approved' }), cand(3, 8, '20261130', { status: 'approved' }),
      cand(4, 7, '20261201', { status: 'pending' }), cand(5, 6, '20261125', { status: 'rejected' }),
    ];
    const plan = planPromote({ today, horizon: 4, published: new Set(), index });
    eq(plan.map(p => [p.date, p.size, p.id && +p.id]), [['20261122', 7, null], ['20261123', 8, 2], ['20261124', 8, 1], ['20261125', 6, null]]);
    eq(planPromote({ today, horizon: 4, published: new Set(['20261123']), index }).map(p => [p.date, p.id && +p.id]), [['20261122', null], ['20261124', 1], ['20261125', null]], 'a published day is closed');
    eq(planPromote({ today, horizon: 4, published: new Set(['20261123', '20261124']), index }).map(p => p.date), ['20261122', '20261125']);
    const one = emptyIndex();
    one.candidates = [cand(9, 8, '20261130', { status: 'approved' })];
    eq(planPromote({ today, horizon: 4, published: new Set(), index: one }).map(p => p.id && +p.id), [null, 9, null, null], 'the earliest open day of its size takes it, the next gets none');
    eq(planPromote({ today, horizon: 4, published: new Set(), index: emptyIndex() }).every(p => p.id === null), true);
  });

  t('gotd published text: the puzzle with where it came from, the reviewer\'s rating and (if solved) the play time; the file means the same puzzle', () => {
    const p = runSync(generateTargeted(7, 1, 5, { retries: 3 })).puzzle, c = cand(7, 7, '20261122', { stamp: 'a6-x', trap: { pred: 2.265, grade: 3 } });
    const text = publishedText(p, c, verdict(c, 3, { playS: 95.46, takebacks: 4 }));
    ok(text.includes('# gotd 000000000007 gen a6-x made-for 20261122 model-grade 3 score 2.265\n# review human 3 solved yes takebacks 4\nsize 7'), text);
    eq(commentTimes(text).playS, 95.5, 'the line the author\'s own Game-of-Day files carry');
    eq(ratingKey(text), ratingKey(serialize(p)));
    eq(symmetryKey(parse(text)), symmetryKey(p));
    ok(text.endsWith('\n') && !/^path /m.test(text));
    const gaveUp = publishedText(p, c, verdict(c, 3, { solved: false, playS: 30 }));
    eq(commentTimes(gaveUp).playS, undefined, 'no play time for a puzzle that was not solved');
    ok(gaveUp.includes('solved no'));
    const unsure = publishedText(p, c, makeVerdict({ candidate: c, sel: { lo: 3, hi: 3, lean: 0, unsure: true }, solved: true, playS: 5, takebacks: 0, now: NOW }));
    ok(unsure.includes('review human 3 unsure solved yes'));
    const bare = publishedText(p, c);
    ok(!bare.includes('# review') && !bare.includes('play_time_s'), 'without a verdict only the origin line');
  });

  t('gotd gates: holdGrade lets a puzzle through that misses the grade (a human judged it) and reports the drift; the other gates still hold', () => {
    const easy = runSync(generateTargeted(7, 1, 5, { retries: 3 })).puzzle;
    const strict = vetCandidate(easy, 7, createDistinct());
    ok(!strict.ok && (strict.reason === 'grade' || strict.reason === 'margin'), JSON.stringify(strict).slice(0, 100));
    const held = vetCandidate(easy, 7, createDistinct(), { holdGrade: true });
    ok(held.ok, JSON.stringify(held).slice(0, 120));
    ok(/^(grade \d, wanted 3\+|score [\d.]+ < [\d.]+)$/.test(held.drift), held.drift);
    ok(held.entry.trap.grade < 3 || held.entry.trap.pred < 2.26);
    const dup = createDistinct();
    dup.add({ symKey: held.symKey, where: 'published' });
    eq(vetCandidate(easy, 7, dup, { holdGrade: true }).reason, 'duplicate', 'a duplicate is refused even when the grade is held');
    eq(vetCandidate(makePuzzle(7), 7, createDistinct(), { holdGrade: true }).reason, 'invalid');
    eq(vetCandidate(easy, 8, createDistinct(), { holdGrade: true }).reason, 'size');
  });
}
