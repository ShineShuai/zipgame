// The human side of the automatic Game of Day: rating widget rules, the verdict file, the review plan, applying verdicts, promotion planning and the published
// day's text (core/gotd-verdict.js, planReview and planPromote of core/gotd-queue.js, publishedText and the holdGrade gate of core/gotd-gen.js). Registered by tests.js.
// The design app panel (apps/design/gotd-review.js) and the command line (test/gotd-gen-cli.test.js) are tested end to end elsewhere.
import { parse, serialize, commentTimes } from '../src/core/format.js';
import { ratingKey, symmetryKey, transformPuzzle } from '../src/core/ratings-io.js';
import { runSync } from '../src/core/run.js';
import { generateTargeted } from '../src/core/gen/target.js';
import { makePuzzle } from '../src/core/model.js';
import {
  APPROVE_MIN, nextSelection, nextLean, toggleUnsure, decide, createTakebacks, makeVerdict, verdictProblem, formatVerdicts, parseVerdicts, mergeVerdicts,
  verdictConflicts, harvestRatings, applyVerdicts, reviewStats,
} from '../src/core/gotd-verdict.js';
import { dayOfDate, sizeForDay } from '../src/core/gotd-schedule.js';
import { createDistinct, vetCandidate, publishedText, carriedOrigin, puzzleId } from '../src/core/gotd-gen.js';
import { emptyIndex, planPromote, planReview } from '../src/core/gotd-queue.js';

const id12 = n => String(n).padStart(12, '0');
const cand = (n, size, slot, over = {}) => ({
  id: id12(n), file: `c-${size}-${id12(n)}.txt`, size, slot, attempt: n, seed: n, stamp: 'S', status: 'pending', K: 8, walls: 5, pathKey: id12(n), trap: { pred: 2.3, grade: 3 }, ...over,
});
const NOW = '2026-11-05T10:00:00Z';
// two puzzles of tools/ratings.json, and a candidate whose id is the real one of the puzzle
const K1 = 'size 7\ncheckpoints 0,1=2 0,6=1 1,3=3 2,2=5 2,5=4 3,1=7 3,5=9 4,3=8 5,3=6\nwalls V,4,3 H,5,4';
const K2 = 'size 7\ncheckpoints 0,5=3 0,6=1 1,3=4 2,1=5 3,1=8 3,5=6 3,6=2 4,4=9 5,3=7\nwalls H,2,3 V,3,2';
const real = key => ({ ...cand(1, 7, '20261122'), id: puzzleId(symmetryKey(key)) });
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

  t('gotd verdict: the reviewer\'s button decides, the rating only suggests; a verdict may have no rating', () => {
    const c = cand(1, 7, '20261121'), sel = g => ({ lo: g, hi: g, lean: 0 });
    const v = (g, verdictName) => makeVerdict({ candidate: c, sel: g === null ? null : sel(g), verdict: verdictName, solved: true, takebacks: 0, now: NOW });
    eq([v(1, 'approve').verdict, v(1, 'approve').human], ['approve', 1], 'Easy approved by hand');
    eq(v(4, 'reject').verdict, 'reject', 'Expert rejected by hand');
    eq(v(2).verdict, 'reject', 'no button: the rating suggests');
    const bare = v(null, 'approve');
    eq([bare.verdict, 'human' in bare, 'lo' in bare, 'hi' in bare, 'unsure' in bare], ['approve', false, false, false, false], 'no rating, no rating fields');
    eq(verdictProblem(bare), '', 'and the file accepts it');
    eq(parseVerdicts(formatVerdicts([bare]))[0], bare);
    eq(verdictProblem({ ...bare, human: 3 }) !== '', true, 'a rating is all or nothing');
    eq(makeVerdict({ candidate: c, sel: { lo: 1, hi: 1, lean: 0, unsure: true }, verdict: 'reject', solved: false, takebacks: 0, now: NOW }).unsure, true);
    eq(makeVerdict({ candidate: c, sel: null, verdict: 'reject', solved: false, takebacks: 0, now: NOW }).solved, false);
  });

  t('gotd verdict: makeVerdict records the rating, the blind play and what the model said; no rating and no decision is an error', () => {
    const c = cand(7, 8, '20261122', { trap: { pred: 2.31, grade: 3 } });
    const v = makeVerdict({ candidate: c, sel: { lo: 2, hi: 3, lean: 1, unsure: true }, solved: false, playS: 41.26, takebacks: 5.9, now: NOW });
    eq(v, { id: id12(7), size: 8, stamp: 'S', model: { grade: 3, pred: 2.31 }, human: 2.75, lo: 2, hi: 3, unsure: true, solved: false, playS: 41.3, takebacks: 5, verdict: 'reject', at: NOW });
    eq(Object.keys(verdict(c, 3)).includes('unsure'), false, 'sure ratings carry no unsure flag');
    eq(makeVerdict({ candidate: c, sel: { lo: 3, hi: 3, lean: 0 }, solved: true, takebacks: 0, now: NOW }).playS, undefined, 'no time, no playS');
    let message = '';
    try { makeVerdict({ candidate: c, sel: null, solved: true, now: NOW }); } catch (e) { message = e.message; }
    eq(message, 'no verdict', 'neither a rating nor a decision');
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

  t('gotd verdict key: the puzzle text rides with the verdict; it must be canonical and hash to the id (a turned copy does), older verdicts have none', () => {
    const c = real(K1), v = verdict(c, 3, { key: K1 });
    eq([v.key, Object.keys(v).at(-1), verdictProblem(v)], [K1, 'key', '']);
    eq(parseVerdicts(formatVerdicts([v]))[0], v, 'round trip');
    ok(verdictProblem({ ...v, key: K2 }) !== '', 'the key of another puzzle');
    ok(verdictProblem({ ...v, key: `${K1}\n` }) !== '', 'not canonical');
    ok(verdictProblem({ ...v, key: 5 }) !== '' && verdictProblem({ ...v, key: 'size 7' }) !== '', 'not a puzzle');
    eq(verdictProblem({ ...v, key: ratingKey(transformPuzzle(parse(K1), 2, true)) }), '', 'the same puzzle turned and renumbered has the same id');
    eq('key' in verdict(c, 3), false);
    eq(verdictProblem(verdict(c, 3)), '');
  });

  t('gotd verdicts conflicts: only ids both copies have with another decision or rating, with the one that is kept', () => {
    const a = verdict(cand(1, 7, 'x'), 3), mine = [a, verdict(cand(2, 7, 'x'), 1)];
    const newer = { ...verdict(cand(1, 7, 'x'), 1), at: '2026-11-06T10:00:00Z' };
    eq(verdictConflicts(mine, [newer, verdict(cand(3, 7, 'x'), 4), mine[1]]).map(c => [c.id, c.kept, c.dropped]), [[a.id, newer, a]], 'a new id and an equal verdict are no conflict');
    eq(verdictConflicts([newer], [a])[0].kept, newer, 'the newer one is kept whichever copy it is in');
    eq(verdictConflicts(mine, mine), []);
  });

  t('gotd harvest: rated verdicts become new ratings.json rows once; rated, equivalent, unrated, unresolved and given-up ones are told apart', () => {
    const tag = (K, human, { unsure, ...over } = {}) => verdict(real(K), human, { key: K, ...(unsure ? { sel: { lo: human, hi: human, lean: 0, unsure: true } } : {}), ...over });
    const row = (key, human, lo = human, hi = human) => ({ key, human, lo, hi });
    const turned = ratingKey(transformPuzzle(parse(K1), 1, false));
    eq(turned !== K1 && symmetryKey(turned) === symmetryKey(K1), true, 'the test puzzle really is a different text of the same puzzle');
    let h = harvestRatings([tag(K1, 3, { unsure: true })], []);
    eq(h.add.map(r => [r.key, r.human, r.lo, r.hi, r.unsure, r.id]), [[K1, 3, 3, 3, true, real(K1).id]]);
    eq(h.add[0].key, K1);
    h = harvestRatings([tag(K1, 3)], [row(K1, 3)]);
    eq([h.add, h.same, h.differs], [[], [real(K1).id], []], 'harvesting again adds nothing');
    h = harvestRatings([tag(K1, 3)], [row(K1, 2)]);
    eq([h.add.length, h.differs.map(d => [d.id, d.have.human, d.got.human])], [0, [[real(K1).id, 2, 3]]], 'another rating in the file is kept and listed');
    h = harvestRatings([tag(K1, 3)], [row(K1, 3, 2, 3)]);
    eq(h.differs.length, 1, 'same human, other range');
    h = harvestRatings([tag(K1, 3, { unsure: true })], [row(K1, 3)]);
    eq(h.differs.length, 1, 'same rating, but unsure now');
    h = harvestRatings([{ ...tag(K1, 3), key: turned }], [row(K1, 4)]);
    eq([h.add.length, h.equivalent], [0, [{ id: real(K1).id, key: K1 }]], 'a turned copy of a rated puzzle is not added');
    const bare = verdict(real(K2), undefined, { sel: null, verdict: 'approve' }), old = verdict(cand(9, 7, 'x'), 2), gaveUp = tag(K2, 4, { solved: false });
    h = harvestRatings([bare, old, tag(K1, 1)], []);
    eq([h.unrated, h.unresolved, h.add.length], [1, [old.id], 1], 'no rating: nothing to add; no key: unresolved');
    eq(harvestRatings([gaveUp], []).add.length, 1);
    h = harvestRatings([gaveUp], [], { solvedOnly: true });
    eq([h.add.length, h.skipped], [0, [gaveUp.id]]);
    h = harvestRatings([tag(K1, 2.5), tag(K2, 4)], []);
    eq(harvestRatings([tag(K1, 2.5), tag(K2, 4)], h.add.map(({ id, ...r }) => r)).same.length, 2, 'the added rows are what a rerun finds');
  });

  // 20261122..27 are 7, 8, 8, 6, 9, 7 in the schedule. 20261122 is published already (the candidate 1 made for it was promoted and left the index).
  const reviewWorld = () => {
    const index = emptyIndex();
    index.candidates = [
      cand(2, 7, '20261122'), cand(3, 8, '20261123'), cand(4, 8, '20261123'), cand(5, 8, '20261124'), cand(6, 8, '20261124'), cand(7, 6, '20261125'), cand(8, 9, '20261126'),
      cand(9, 6, '20261125', { stamp: 'OLD' }), cand(10, 8, '20261123', { status: 'rejected' }),
    ];
    const args = { today: dayOfDate('20261122'), horizon: 6, published: new Set(['20261122']), index, stamp: 'S' };
    return { index, args, review: (verdicts = [], more = {}) => planReview({ ...args, verdicts, ...more }) };
  };
  const approve = c => makeVerdict({ candidate: c, sel: null, verdict: 'approve', solved: true, takebacks: 0, now: NOW });
  const reject = c => makeVerdict({ candidate: c, sel: null, verdict: 'reject', solved: true, takebacks: 0, now: NOW });
  const ids = list => list.map(c => +c.id);

  t('gotd review plan: candidates in the order of the open days they fill; a published day is not offered again, its leftovers wait for a later day of their size', () => {
    const w = reviewWorld(), r = w.review();
    eq(ids(r.queue), [3, 4, 5, 6, 7, 8, 2], 'older stamp, rejected ones out; the leftover 2 of the published day comes last, for the next 7x7 day, not first');
    eq(r.queue.map(c => c.date), ['20261123', '20261123', '20261123', '20261123', '20261125', '20261126', '20261127']);
    eq(r.open.map(d => [d.date, d.size]), [['20261123', 8], ['20261124', 8], ['20261125', 6], ['20261126', 9], ['20261127', 7]], 'the published day is not open');
    eq(ids(w.review([], { horizon: 3 }).queue), [3, 4, 5, 6], 'no open day of size 6, 9 or 7 in the horizon: those candidates wait');
    eq(ids(w.review([], { horizon: 3, reserve: true }).queue), [3, 4, 5, 6, 2, 7, 8], 'reserve: after the others, in queue order');
    eq(w.review([], { horizon: 3, reserve: true }).queue.slice(4).map(c => c.date), [null, null, null]);
    eq(ids(w.review([], { published: new Set(['20261122', '20261123', '20261124']) }).queue), [7, 8, 2], 'days published by other means are closed too');
    eq(planReview({ ...w.args, index: emptyIndex(), verdicts: [] }).queue, []);
  });

  t('gotd review plan: an approved candidate covers its day at once and the next review is for the next open day; a reject leaves the day open', () => {
    const w = reviewWorld(), c = id => w.index.candidates.find(x => +x.id === id);
    let r = w.review([approve(c(3))]);
    eq(ids(r.queue), [5, 6, 4, 7, 8, 2], 'day 23 is covered: the candidates made for day 24 come first, the sibling 4 of 23 after them');
    eq(r.queue.slice(0, 3).map(x => x.date), ['20261124', '20261124', '20261124']);
    eq(r.plan.find(p => p.id === id12(3)).date, '20261123');
    r = w.review([approve(c(3)), approve(c(5))]);
    eq(ids(r.queue), [7, 8, 2]);
    eq(ids(w.review([approve(c(3)), approve(c(5))], { reserve: true }).queue), [7, 8, 2, 4, 6], 'the siblings of the approved ones are the reserve');
    r = w.review([approve(c(3)), approve(c(5)), reject(c(7))]);
    eq(ids(r.queue), [8, 2]);
    eq(r.open.map(d => d.date), ['20261125', '20261126', '20261127'], 'a rejected candidate leaves its day open');
    eq(w.review([reject(c(3)), reject(c(4))]).queue.map(x => +x.id).slice(0, 2), [5, 6], 'rejects of day 23 hand the day to the candidates made for day 24');
  });

  t('gotd review plan: approving what is shown always fills the next open day, so approved days never leave a gap (the day shown is the day promote plans)', () => {
    const w = reviewWorld(), verdicts = [], days = [];
    for (let r = w.review(); r.queue.length; r = w.review(verdicts)) {
      const first = r.queue[0], v = approve(first);
      verdicts.push(v);
      const got = w.review(verdicts).plan.find(p => p.id === first.id);
      eq(got && got.date, first.date, `candidate ${+first.id} is shown for ${first.date}`);
      days.push(first.date);
    }
    eq(days, ['20261123', '20261124', '20261125', '20261126', '20261127'], 'five approvals, five consecutive days');
    eq(w.review(verdicts).open, []);
  });

  t('gotd review plan: a verdict counts before it reaches the index; an approved candidate of a promoted day cannot hold a day closed', () => {
    const w = reviewWorld(), c = id => w.index.candidates.find(x => +x.id === id);
    eq(ids(w.review([approve(c(8))]).queue), [3, 4, 5, 6, 7, 2], 'approved by verdict only');
    const gone = reviewWorld(); // candidate 1 was approved, promoted and removed from the index: its verdict stays in verdicts.json and changes nothing
    const old = approve({ ...cand(1, 7, '20261122'), stamp: 'S' });
    eq(ids(gone.review([old]).queue), [3, 4, 5, 6, 7, 8, 2]);
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
    const bare = makeVerdict({ candidate: c1, sel: null, verdict: 'approve', solved: true, takebacks: 0, now: NOW });
    eq(reviewStats([verdict(c1, 3), bare]).S, { reviewed: 2, approved: 2, rejected: 0, sumErr: 0, worst: 0 }, 'an unrated verdict counts as reviewed, not in the model gap');
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
    const unrated = publishedText(p, c, makeVerdict({ candidate: c, sel: null, verdict: 'approve', solved: true, playS: 5, takebacks: 1, now: NOW }));
    ok(unrated.includes('# review unrated solved yes takebacks 1'), unrated);
    const bare = publishedText(p, c);
    ok(!bare.includes('# review') && !bare.includes('play_time_s'), 'without a verdict only the origin line');
    // how the puzzle was made is carried from the candidate's file, line for line, between the origin line and the review line
    const origin = ['seed 5: grade 3 (target 3+, inside the margin), 4 walls, 8 checkpoints, 2.8 s, 1678 changes, 4 tries', 'gen a6-x: node tools/gen-target.mjs --size 7 --grade 3 --at-least --margin 0.5 --retries 12 --seed 5'];
    const carried = publishedText(p, c, verdict(c, 3), origin);
    ok(carried.includes(`score 2.265\n# ${origin[0]}\n# ${origin[1]}\n# review human 3`), carried);
    eq(carriedOrigin(carried).slice(-2), origin, 'and they can be carried again');
    eq(ratingKey(carried), ratingKey(serialize(p)));
    eq(publishedText(p, c, null, origin).split('\n').filter(l => l.startsWith('# seed')).length, 1);
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
