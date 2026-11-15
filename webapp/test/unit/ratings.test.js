// Unit tests of ratings and pairs (ratings.json format, the design panel, the tools that check them).
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { serialize, parse } from '../../src/core/format.js';
import { loadRatings, saveRatings, loadPairs, savePairs } from '../../src/core/log-store.js';
import fs from 'node:fs';
import { mountDifficultyPanel } from '../../src/apps/design/difficulty-panel.js';
import {
  ratingKey, ratingFromSelection, leanOf, describeRating, toRatingsJson, parseRatingsJson,
  mergeRatings, parseRatingComment, ratingWeight, UNSURE_WEIGHT, symmetryKey, findDuplicateGroups,
  transformPuzzle, asciiPuzzle, keyDifference,
} from '../../src/core/ratings-io.js';
import {
  parsePairsJson, toPairsJson, mergePairs, pairAccuracy, impliedPairs, flipCmp, pairKeyOf,
} from '../../src/core/pairs-io.js';
import { pickStorage } from '../../src/platform/storage.js';
import { t, ta, eq, ok, registerAsyncTests } from '../harness.js';
import { cachedSamples } from './helpers.js';

t('ratings-io: a rating is one grade, a range, or a range leaning to one end; describeRating/leanOf read it back', () => {
  eq(ratingFromSelection({ lo: 2, hi: 2 }), { human: 2, lo: 2, hi: 2 });
  eq(ratingFromSelection({ lo: 3, hi: 2 }), { human: 2.5, lo: 2, hi: 3 }, 'order does not matter');
  eq(ratingFromSelection({ lo: 2, hi: 3, lean: 1 }), { human: 2.75, lo: 2, hi: 3 });
  eq(ratingFromSelection({ lo: 2, hi: 3, lean: -1 }), { human: 2.25, lo: 2, hi: 3 });
  eq(ratingFromSelection({ lo: 4, hi: 4, lean: 1 }), { human: 4, lo: 4, hi: 4 }, 'a single grade has nothing to lean toward');
  eq([describeRating({ human: 2, lo: 2, hi: 2 }), describeRating({ human: 2.5, lo: 2, hi: 3 }), describeRating({ human: 2.75, lo: 2, hi: 3 }), describeRating({ human: 2.25, lo: 2, hi: 3 }), describeRating({ human: 4, lo: 3, hi: 5 }), describeRating({ human: 3 })],
    ['2', '2 or 3', '2 or 3, close to 3', '2 or 3, close to 2', '3 to 5', '3']);
  eq([leanOf({ human: 2.75, lo: 2, hi: 3 }), leanOf({ human: 2.25, lo: 2, hi: 3 }), leanOf({ human: 2.5, lo: 2, hi: 3 }), leanOf({ human: 2, lo: 2, hi: 2 })], [1, -1, 0, 0]);
});

t('ratings-io: ratingKey is the comment-free puzzle text, the same for a puzzle object, serialize() output and the bare 3 lines', () => {
  const p = cachedSamples()[0], k = ratingKey(p);
  ok(!k.includes('#') && k.startsWith('size ') && k.split('\n').length === 3, 'size / checkpoints / walls only');
  eq(ratingKey(serialize(p)), k); eq(ratingKey(k), k); eq(ratingKey(k + '\n\n# note\n'), k);
});

t('ratings-io: export -> parse round-trips (metrics are not exported), and rows are validated one by one', () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b);
  const text = toRatingsJson([{ key: ka, human: 2.75, lo: 2, hi: 3, metrics: { x: 1 } }, { key: kb, human: 1 }]);
  ok(!text.includes('metrics') && text.endsWith('\n'), 'no metrics, trailing newline');
  eq(parseRatingsJson(text), { ratings: [{ key: ka, human: 2.75, lo: 2, hi: 3 }, { key: kb, human: 1, lo: 1, hi: 1 }], problems: [] });
  eq(parseRatingsJson('nope').ratings, []); ok(parseRatingsJson('nope').problems[0].includes('not valid JSON'));
  ok(parseRatingsJson('{}').problems[0].includes('array'));
  const bad = parseRatingsJson(JSON.stringify([{ key: ka, human: 2 }, { human: 1 }, { key: 'garbage', human: 1 }, { key: kb, human: 7 }, { key: kb, human: 2, lo: 3, hi: 2 }, { key: kb, human: 4, lo: 1, hi: 2 }, { key: serialize(b), lo: 1, hi: 2 }]));
  eq(bad.ratings.map(r => [r.key === ka ? 'a' : 'b', r.human, r.lo, r.hi]), [['a', 2, 2, 2], ['b', 1.5, 1, 2]], 'only valid rows import; human defaults to the midpoint of lo/hi; serialize() text is normalised');
  eq(bad.problems.length, 5, 'missing key, unparseable puzzle, human 7, lo > hi, human outside its range'); ok(bad.problems.some(s => s.startsWith('#2:')) && bad.problems.some(s => s.includes('does not parse')) && bad.problems.some(s => s.includes('outside [1, 2]')));
  eq(parseRatingsJson(JSON.stringify([{ key: ka, human: 1 }, { key: serialize(a), human: 3 }])).ratings, [{ key: ka, human: 3, lo: 3, hi: 3 }], 'the same puzzle twice: the later one wins');
});

t('ratings-io: merging replaces the same puzzle, keeps the rest, and clears metrics so they get recomputed', () => {
  const [a, b, c] = cachedSamples(); const ka = ratingKey(a), kb = ratingKey(b), kc = ratingKey(c);
  const log = [{ key: ka, human: 2, lo: 2, hi: 2, metrics: { m: 1 } }, { key: kb, human: 1, metrics: { m: 2 } }];
  const m = mergeRatings(log, [{ key: ka, human: 2, lo: 2, hi: 2 }, { key: kb, human: 2.5, lo: 2, hi: 3 }, { key: kc, human: 4, lo: 4, hi: 4 }]);
  eq([m.added, m.updated, m.changed], [1, 2, 1], 'a and b existed; only b changed; c is new');
  eq(m.entries.map(e => [e.key === ka ? 'a' : e.key === kb ? 'b' : 'c', e.human, e.metrics]), [['a', 2, null], ['b', 2.5, null], ['c', 4, null]]);
  eq(log[0].metrics, { m: 1 }, 'the stored log is not mutated');
  eq(mergeRatings([{ key: 'zzz', human: 0 }], []).entries.length, 1, 'entries missing from the file are kept');
});

t('ratings-io: comment grammar — explicit "human 2, range 2-3", the older forms, and chatter; everything else is an error', () => {
  const g = c => { const r = parseRatingComment(c); return r.ok ? [r.human, r.lo, r.hi, r.unsure] : r.why; };
  eq(g('human 2, range 2-3'), [2, 2, 3, false]); eq(g('human 2.5, range 2–3, unsure'), [2.5, 2, 3, true]); eq(g('range 3-5'), [4, 3, 5, false]); eq(g('human 4'), [4, 4, 4, false]);
  eq(g('Range 1 to 2 , SURE'), [1.5, 1, 2, false], 'case, spacing, "to" and "sure" are tolerated');
  eq(g('this is 2'), [2, 2, 2, false]); eq(g('this is 2 or 3'), [2.5, 2, 3, false]); eq(g('this is 2 or 3, close to 3'), [2.75, 2, 3, false]); eq(g('this is 1 or 2, close to 1'), [1.25, 1, 2, false]);
  eq(g('this is at least 4'), [4, 4, 5, false]); eq(g('this is at most 1'), [0.5, 0, 1, false]);
  eq(g('this is at least 3, close to 4 or 4.'), [4, 3, 5, false], 'the interpreted rating: human 4, range 3-5');
  eq(g('this is at most 2, close to 1 or rather 1'), [1, 1, 1, false]); eq(g('This is close to 3, you graded as 2'), [3, 3, 3, false]);
  eq(g('this one is also 1 or 0, not 3.'), [0.5, 0, 1, false], 'either order; "not 3" is chatter'); eq(g('It is 2, instead of 3'), [2, 2, 2, false]); eq(g('this can be 1, more than 0.'), [1, 1, 1, false]);
  eq(g('this is 2 or 3, close to 3. you graded as 3.'), [2.75, 2, 3, false]); eq(g('this one is medium 2, not expert 4.'), [2, 2, 2, false], 'grade words are ignored');
  for (const bad of ['', 'this is pretty hard', 'human 2, range 3-4', 'human 2, range 4-3', 'human 6', 'range 2-3, wibble', 'this is 2 or 3, close to 1', 'human 2, human 3', 'unsure']) ok(typeof g(bad) === 'string', `rejects "${bad}": ${g(bad)}`);
});

t('ratings-io: unsure ratings — exported only when true, validated, merged, and weighted', () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b);
  eq([ratingWeight({ unsure: true }), ratingWeight({}), ratingWeight(undefined), UNSURE_WEIGHT], [0.5, 1, 1, 0.5]);
  const text = toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 3, unsure: true }, { key: kb, human: 1 }]);
  ok(text.includes('"unsure": true') && text.split('unsure').length === 2, 'written only for the unsure one');
  eq(parseRatingsJson(text).ratings.map(r => !!r.unsure), [true, false]);
  ok(parseRatingsJson(JSON.stringify([{ key: ka, human: 1, unsure: 'maybe' }])).problems[0].includes('"unsure"'));
  const m = mergeRatings([{ key: ka, human: 2, lo: 2, hi: 3, metrics: { x: 1 } }], [{ key: ka, human: 2, lo: 2, hi: 3, unsure: true }]);
  eq([m.updated, m.changed, m.entries[0].unsure], [1, 1, true], 'becoming unsure counts as a change');
});

t('ratings-io: duplicates — rotated / mirrored / reversed copies share a symmetry key; exact copies are found; different puzzles are not', () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), K = Math.max(...a.cp);
  for (let k = 0; k < 8; k++) eq(symmetryKey(transformPuzzle(a, k, false)), symmetryKey(a), `transform ${k}`);
  eq(symmetryKey(transformPuzzle(a, 3, true)), symmetryKey(a), 'reversed numbering');
  ok(symmetryKey(a) !== symmetryKey(b), 'different puzzles differ');
  const rot = transformPuzzle(a, 1, false);
  ok(ratingKey(rot) !== ka, 'a quarter turn really changes the text'); eq(Math.max(...rot.cp), K); eq(rot.walls.reduce((s, w) => s + (w & 1) + (w >> 1 & 1), 0), a.walls.reduce((s, w) => s + (w & 1) + (w >> 1 & 1), 0), 'wall count preserved');
  const g = findDuplicateGroups([{ key: ka }, { key: kb }, { key: serialize(a) }, { key: ratingKey(rot) }, { key: 'garbage' }]);
  eq(g.exact, [[0, 2]], 'exact: same puzzle despite the header comments'); eq(g.equivalent, [[0, 2, 3]], 'equivalent group lists every member');
  eq(findDuplicateGroups([{ key: ka }, { key: kb }]), { exact: [], equivalent: [] });
  ok(asciiPuzzle(a).split('\n').length >= 2 * a.n - 1, 'ascii picture has a line per row plus wall lines');
});

t('pairs-io: parse / merge / orientation / accuracy', () => {
  const [a, b, c] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), kc = ratingKey(c);
  const text = toPairsJson([{ a: ka, b: kb, cmp: 'harder', ma: { x: 1 } }, { a: kb, b: kc, cmp: 'same' }]);
  ok(!text.includes('"ma"'), 'cached metrics are not exported'); const back = parsePairsJson(text);
  eq(back.problems, []); eq(back.pairs.map(p => p.cmp), ['harder', 'same']);
  const bad = parsePairsJson(JSON.stringify([{ a: ka, b: ka, cmp: 'harder' }, { a: ka, b: kb, cmp: 'bigger' }, { a: 'garbage', b: kb, cmp: 'same' }, { a: ka, b: kb }, { a: ka, b: kb, cmp: 'harder' }, { a: kb, b: ka, cmp: 'harder' }]));
  eq(bad.pairs.length, 1, 'only the last valid row of the repeated pair stays'); eq([bad.pairs[0].a === kb, bad.pairs[0].cmp], [true, 'harder']);
  ok(bad.problems.length === 5 && bad.problems.some(s => s.includes('DIFFERENT verdict')), bad.problems.join(' | '));
  eq([flipCmp('harder'), flipCmp('easier'), flipCmp('same')], ['easier', 'harder', 'same']); eq(pairKeyOf(ka, kb), pairKeyOf(kb, ka));
  const m = mergePairs([{ a: ka, b: kb, cmp: 'harder', ma: {} }, { a: kb, b: kc, cmp: 'same' }], [{ a: kb, b: ka, cmp: 'easier' }, { a: kc, b: ka, cmp: 'harder' }]);
  eq([m.added, m.updated, m.changed], [1, 1, 0], 'B-vs-A "easier" is the same verdict as A-vs-B "harder"'); eq(m.pairs[0].ma, undefined, 'replaced pair loses its cached grades so they are recomputed');
  const val = { [ka]: 1, [kb]: 3, [kc]: 3 }, v = k => val[k];
  const acc = pairAccuracy([{ a: ka, b: kb, cmp: 'harder' }, { a: kb, b: ka, cmp: 'harder' }, { a: kb, b: kc, cmp: 'harder' }, { a: kb, b: kc, cmp: 'same' }, { a: ka, b: 'zzz', cmp: 'harder' }], v);
  eq([acc.decided, acc.correct, acc.accuracy, acc.ties, acc.sameN, acc.sameTied, acc.skipped], [3, 1.5, 0.5, 1, 1, 1, 1], 'right, wrong, tie = half, "same" scored apart, missing value skipped');
  eq(impliedPairs([{ key: 'p', lo: 1, hi: 2 }, { key: 'q', lo: 3, hi: 3 }, { key: 'r', lo: 2, hi: 3 }]).map(x => `${x.a}${x.cmp}${x.b}`), ['pharderq'], 'only non-overlapping ranges imply an order');
});

ta('tools/ratings.json: the repo label file parses cleanly, keys are canonical and unique, ranges contain human', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only (reads the file from disk)
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../../tools/ratings.json', import.meta.url), 'utf8');
  const { ratings, problems } = parseRatingsJson(text);
  eq(problems, []); ok(ratings.length >= 74, `expected >= 74 ratings, got ${ratings.length}`);
  eq(new Set(ratings.map(r => r.key)).size, ratings.length, 'unique puzzles');
  const bad = JSON.parse(text).map((r, i) => [i + 1, keyDifference(r.key)]).filter(x => x[1]);
  ok(!bad.length, `${bad.length} key(s) in tools/ratings.json are not canonical (they parse, but differ from what the app exports). ${bad.slice(0, 3).map(([i, why]) => `row #${i}: ${why}`).join(' | ')}${bad.length > 3 ? ` | ... +${bad.length - 3} more` : ''}. Fix: node tools/check-ratings.mjs --fix`);
  ok(toRatingsJson(ratings) === text.replace(/\r\n/g, '\n'), 'tools/ratings.json is not laid out the way the app exports it (indentation / field order / trailing newline: did an editor or formatter rewrite it?). Fix: node tools/check-ratings.mjs --fix');
});

// A fake DOM just rich enough to drive the panel's real handlers (buttons, file input, status text); nothing is mocked in the panel itself.
function makePanelDom() {
  const reg = new Map(), mk = () => ({ style: {}, dataset: {}, textContent: '', innerHTML: '', onclick: null, onchange: null, files: null, value: '', classList: { toggle() {}, add() {}, remove() {} }, querySelectorAll: () => [] });
  const sel = s => {
    if (!reg.has(s)) {
      const e = mk();
      if (s === '#diffDups') { // the duplicate list builds delete buttons inside its own innerHTML
        e.dels = {};
        e.querySelectorAll = q => q === '.diff-dup-del' ? [...e.innerHTML.matchAll(/data-key-index="(\d+)"/g)].map(m => ({ dataset: { keyIndex: m[1] }, set onclick(f) { e.dels[m[1]] = f; } })) : [];
      }
      reg.set(s, e);
    }
    return reg.get(s);
  };
  const groups = new Map();
  const all = (s, k, f) => { if (!groups.has(s)) groups.set(s, Array.from({ length: k }, (_, i) => { const e = mk(); f(e, i); return e; })); return groups.get(s); };
  const el = { _html: '', set innerHTML(v) { this._html = v; reg.clear(); groups.clear(); }, get innerHTML() { return this._html; }, style: {},
    querySelector: sel,
    querySelectorAll: s => s === '.diff-rate-btn' ? all(s, 6, (e, i) => { e.dataset.grade = i; }) : s === '.diff-lean-btn' ? all(s, 2, (e, i) => { e.dataset.lean = i ? 1 : -1; }) : s === '.diff-pair-btn' ? all(s, 3, (e, i) => { e.dataset.cmp = ['harder', 'same', 'easier'][i]; }) : [] };
  return { el, sel, pair: c => el.querySelectorAll('.diff-pair-btn')[['harder', 'same', 'easier'].indexOf(c)], grade: g => el.querySelectorAll('.diff-rate-btn')[g], lean: d => el.querySelectorAll('.diff-lean-btn')[d < 0 ? 0 : 1], text: () => sel('.diff-rate-text').textContent };
}

const LOG_KEY = 'zip-difficulty-rating-log-v1';

const readLog = loadRatings, writeLog = saveRatings; // the compact v2 format (core/log-store.js)

const PAIR_LOG = 'pairs', PREV_REC = 'zip-difficulty-prev-v1';

const readJson = async (k, d) => { if (k === LOG_KEY) return loadRatings(); if (k === PAIR_LOG) return loadPairs(); const s = await pickStorage(), r = await s.get(k); return r ? JSON.parse(r.value) : d; };

const writeJson = async (k, v) => { if (k === LOG_KEY) return saveRatings(v); if (k === PAIR_LOG) return savePairs(v); const s = await pickStorage(); await s.set(k, JSON.stringify(v)); };

const wait = ms => new Promise(r => setTimeout(r, ms));

const resetAll = async () => { await writeLog([]); await writeJson(PAIR_LOG, []); await writeJson(PREV_REC, {}); };

ta('design panel: rating a puzzle as one grade, a range, a range leaning to one end; clicking again removes it', async () => {
  await writeLog([]);
  const p = cachedSamples()[0], key = ratingKey(p), dom = makePanelDom();
  mountDifficultyPanel(dom.el, () => p, () => undefined).run();
  await new Promise(r => setTimeout(r, 20));
  const last = async () => (await readLog()).find(e => e.key === key);
  await dom.grade(2).onclick();
  let e = await last(); eq([e.human, e.lo, e.hi], [2, 2, 2]); ok(e.metrics && Number.isFinite(e.metrics['grade: trap']), 'grades are logged with the rating');
  await dom.grade(3).onclick(); e = await last(); eq([e.human, e.lo, e.hi], [2.5, 2, 3], 'a neighbouring grade makes it "2 or 3"');
  eq(dom.text(), 'Saved: 2 or 3 (used as 2.5)');
  await dom.lean(1).onclick(); e = await last(); eq([e.human, e.lo, e.hi], [2.75, 2, 3]); eq(dom.text(), 'Saved: 2 or 3, close to 3 (used as 2.75)');
  await dom.lean(1).onclick(); e = await last(); eq(e.human, 2.5, 'the lean toggles off');
  await dom.grade(5).onclick(); e = await last(); eq([e.human, e.lo, e.hi], [5, 5, 5], 'a non-neighbour replaces the range');
  await dom.grade(5).onclick(); eq(await last(), undefined, 'the same single grade again removes the rating'); eq(dom.text(), 'Not rated.');
  eq((await readLog()).length, 0);
});

ta('design panel: Export ratings.json downloads the log in the shared format', async () => {
  await writeLog([]);
  const p = cachedSamples()[0], key = ratingKey(p), dom = makePanelDom();
  const panel = mountDifficultyPanel(dom.el, () => p, () => undefined); panel.run(); await new Promise(r => setTimeout(r, 20));
  await dom.grade(1).onclick(); await dom.grade(2).onclick(); await dom.lean(-1).onclick(); // 1 or 2, close to 1
  const saved = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }; let blob = null, name = null;
  globalThis.document = { createElement: () => ({ click() { name = this.download; }, remove() {} }), body: { appendChild() {} } };
  URL.createObjectURL = b => { blob = b; return 'blob:test'; }; URL.revokeObjectURL = () => {};
  try {
    await dom.sel('#diffLogExport').onclick();
    eq(name, 'ratings.json');
    eq(JSON.parse(await blob.text()), [{ key, human: 1.25, lo: 1, hi: 2 }]);
    ok(dom.sel('#diffLogStatus').textContent.startsWith('Exported 1 ratings'), dom.sel('#diffLogStatus').textContent);
  } finally { globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
});

ta('design panel: Import ratings.json merges, regrades with the current code, replaces same-puzzle ratings and migrates old header keys', async () => {
  const [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b);
  await writeLog([{ key: serialize(a), human: 4, metrics: { 'grade: trap': 99 } }, { key: 'size 5\ncheckpoints\nwalls', human: 0, metrics: null }]); // old-style key (with # comments) + an unrelated entry
  const dom = makePanelDom();
  mountDifficultyPanel(dom.el, () => a, () => undefined).run(); await new Promise(r => setTimeout(r, 20));
  const file = { text: async () => JSON.stringify([{ key: ka, human: 2.75, lo: 2, hi: 3 }, { key: kb, human: 1, lo: 1, hi: 1 }, { key: 'garbage', human: 1 }]) };
  const input = dom.sel('#diffLogFile'); input.files = [file];
  await input.onchange();
  const log = await readLog();
  eq(log.length, 3, 'a replaced (not duplicated), b added, the unrelated entry kept');
  const ea = log.find(e => e.key === ka), eb = log.find(e => e.key === kb);
  eq([ea.human, ea.lo, ea.hi], [2.75, 2, 3], 'the file wins over the stored rating');
  ok(Number.isFinite(ea.metrics['grade: trap']) && ea.metrics['grade: trap'] !== 99, 'stale grades are recomputed on import');
  ok(eb.metrics && Number.isFinite(eb.metrics['grade: ladder']), 'new puzzle is graded');
  const st = dom.sel('#diffLogStatus').textContent;
  ok(st.startsWith('Imported 2 ratings: 1 new, 1 replaced (1 with a different rating)') && st.includes('1 note(s)'), st);
  await writeLog([]);
});

ta('design panel: unsure flag needs a rating, keeps the rating, is exported and survives import', async () => {
  await resetAll();
  const p = cachedSamples()[0], key = ratingKey(p), dom = makePanelDom();
  mountDifficultyPanel(dom.el, () => p, () => undefined).run(); await wait(20);
  await dom.sel('.diff-unsure-btn').onclick(); eq(await readJson(LOG_KEY, []), [], 'nothing to be unsure about before a rating exists');
  await dom.grade(2).onclick(); await dom.grade(3).onclick(); await dom.lean(1).onclick(); // 2 or 3, close to 3 = 2.75
  await dom.sel('.diff-unsure-btn').onclick();
  let e = (await readJson(LOG_KEY, []))[0]; eq([e.human, e.lo, e.hi, e.unsure], [2.75, 2, 3, true], 'unsure keeps human/lo/hi'); ok(dom.text().includes('unsure'), dom.text());
  await dom.grade(2).onclick(); e = (await readJson(LOG_KEY, []))[0]; eq([e.human, e.lo, e.hi, e.unsure], [2, 2, 2, true], 'changing the grade does not change how sure you are');
  const saved = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }; let blob = null;
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }; URL.createObjectURL = b => (blob = b, 'blob:t'); URL.revokeObjectURL = () => {};
  try { await dom.sel('#diffLogExport').onclick(); eq(JSON.parse(await blob.text()), [{ key, human: 2, lo: 2, hi: 2, unsure: true }]); } finally { globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
  await dom.sel('.diff-unsure-btn').onclick(); e = (await readJson(LOG_KEY, []))[0]; ok(!('unsure' in e), 'sure again: the field disappears');
  await writeLog([]); const dom2 = makePanelDom(); mountDifficultyPanel(dom2.el, () => p, () => undefined).run(); await wait(20);
  const input = dom2.sel('#diffLogFile'); input.files = [{ text: async () => JSON.stringify([{ key, human: 1.5, lo: 1, hi: 2, unsure: true }]) }]; await input.onchange();
  e = (await readJson(LOG_KEY, []))[0]; eq([e.human, e.unsure], [1.5, true]); ok(dom2.text().includes('unsure'), 'a rating imported as unsure is shown as unsure: ' + dom2.text());
  await resetAll();
});

ta('design panel: pairwise — compare with the previous puzzle, either orientation, remove, export, import', async () => {
  await resetAll();
  const [A, B] = cachedSamples(), kA = ratingKey(A), kB = ratingKey(B);
  let current = A; const dom = makePanelDom(), panel = mountDifficultyPanel(dom.el, () => current, () => undefined);
  panel.run(); await wait(30);
  ok(dom.sel('.diff-pair-text').textContent.startsWith('No previous puzzle yet'), dom.sel('.diff-pair-text').textContent);
  await dom.pair('harder').onclick(); eq(await readJson(PAIR_LOG, []), [], 'no previous puzzle: nothing recorded');
  current = B; panel.run(); await wait(30);
  ok(dom.sel('.diff-pair-text').textContent.includes('Previous puzzle:') && dom.sel('.diff-pair-text').textContent.includes('Not compared yet'), dom.sel('.diff-pair-text').textContent);
  await dom.pair('harder').onclick();
  let pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1); eq([pairs[0].a === kA, pairs[0].b === kB, pairs[0].cmp], [true, true, 'harder'], 'verdict is for the CURRENT puzzle (B) relative to the previous one (A)');
  ok(pairs[0].ma && pairs[0].mb && Number.isFinite(pairs[0].mb['grade: trap']), 'both puzzles\' grades are cached for the agreement table'); ok(dom.sel('.diff-pair-text').textContent.includes('You said this one is harder'));
  panel.run(); await wait(30); ok(dom.sel('.diff-pair-text').textContent.includes('Previous puzzle:') && dom.sel('.diff-pair-text').textContent.includes('harder'), 'recomputing B keeps A as the previous puzzle and shows the saved verdict');
  await dom.pair('easier').onclick(); pairs = await readJson(PAIR_LOG, []); eq([pairs.length, pairs[0].cmp], [1, 'easier'], 'a new verdict replaces the old one');
  await dom.pair('easier').onclick(); eq(await readJson(PAIR_LOG, []), [], 'same verdict again removes the pair');
  await dom.pair('harder').onclick();               // B is harder than A, stored as a=A, b=B
  current = A; panel.run(); await wait(30);         // now A is current and B previous: the stored pair must be read in the other orientation
  ok(dom.sel('.diff-pair-text').textContent.includes('You said this one is easier'), 'B harder than A means A is easier than B: ' + dom.sel('.diff-pair-text').textContent);
  await dom.pair('easier').onclick(); eq(await readJson(PAIR_LOG, []), [], 'clicking the verdict you already gave (seen from the other side) removes it');
  await dom.pair('same').onclick(); pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1, 'the same two puzzles stay ONE pair whichever was previous'); eq([pairs[0].cmp], ['same']);
  await dom.pair('harder').onclick(); pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1); eq([pairs[0].a === kB, pairs[0].b === kA, pairs[0].cmp], [true, true, 'harder'], 'A harder than B is stored as a=B, b=A');
  await dom.pair('harder').onclick(); eq(await readJson(PAIR_LOG, []), [], 'repeating the verdict from this side removes the pair stored from the other side');
  await dom.pair('harder').onclick(); pairs = await readJson(PAIR_LOG, []);
  const saved = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL }; let blob = null;
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }; URL.createObjectURL = b => (blob = b, 'blob:t'); URL.revokeObjectURL = () => {};
  try { await dom.sel('#diffPairExport').onclick(); eq(JSON.parse(await blob.text()), [{ a: kB, b: kA, cmp: 'harder' }], 'exported without cached grades'); } finally { globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
  await writeJson(PAIR_LOG, []); const dom2 = makePanelDom(); mountDifficultyPanel(dom2.el, () => A, () => undefined).run(); await wait(30);
  const pf = dom2.sel('#diffPairFile'); pf.files = [{ text: async () => JSON.stringify([{ a: kB, b: kA, cmp: 'harder' }, { a: kA, b: kA, cmp: 'same' }]) }]; await pf.onchange();
  pairs = await readJson(PAIR_LOG, []); eq(pairs.length, 1); ok(pairs[0].ma && pairs[0].mb, 'imported pairs are regraded'); ok(dom2.sel('#diffLogStatus').textContent.startsWith('Imported 1 pairs: 1 new') && dom2.sel('#diffLogStatus').textContent.includes('1 note(s)'), dom2.sel('#diffLogStatus').textContent);
  await resetAll();
});

ta('design panel: a rotated copy of a rated puzzle is flagged while rating; Find duplicates lists the pair and deletes one rating', async () => {
  await resetAll();
  const A = cachedSamples()[0], R = transformPuzzle(A, 5, false); let current = A;
  const dom = makePanelDom(), panel = mountDifficultyPanel(dom.el, () => current, () => undefined);
  panel.run(); await wait(30); await dom.grade(2).onclick();
  current = R; panel.run(); await wait(30);
  ok(dom.sel('.diff-dup-note').textContent.includes('Same puzzle as one you already rated (2)'), 'note: ' + dom.sel('.diff-dup-note').textContent);
  await dom.grade(3).onclick(); eq((await readJson(LOG_KEY, [])).length, 2, 'rating it anyway is allowed (and warned about)');
  await dom.sel('#diffLogDups').onclick();
  const html = dom.sel('#diffDups').innerHTML; ok(html.includes('1 duplicate group') && html.includes('diff-ascii') && (html.match(/diff-dup-del/g) || []).length === 2, html.slice(0, 200));
  await dom.sel('#diffDups').dels[1](); const left = await readJson(LOG_KEY, []);
  eq(left.length, 1, 'one rating deleted'); eq(left[0].human, 2, 'the other one stays'); ok(dom.sel('#diffDups').innerHTML.includes('No duplicates'), dom.sel('#diffDups').innerHTML.slice(0, 120));
  await resetAll();
});

ta('tools/check-ratings.mjs passes on the committed ratings.json and pairs.json (no bad rows, no exact duplicates); equivalent puzzles would be warnings', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('../../tools/check-ratings.mjs', import.meta.url).pathname, '--no-draw'], { encoding: 'utf8' });
  eq(r.status, 0, 'check-ratings failed:\n' + r.stdout.slice(0, 1500));
  ok(r.stdout.includes('0 error(s)'), r.stdout);
});

t('ratings-io: keyDifference names why a key that parses is still not canonical', () => {
  const p = cachedSamples()[0], k = ratingKey(p);
  eq(keyDifference(k), '', 'canonical keys are fine'); eq(keyDifference('garbage'), '', 'an unparseable key is reported elsewhere');
  ok(keyDifference(serialize(p)).includes('# ...'), 'header comments'); ok(keyDifference(serialize(p, { path: [0, 1] }).split('\n').filter(l => !l.startsWith('#')).join('\n')).includes('path'), 'a path line');
  ok(keyDifference(k.replace(/\n/g, '\r\n')).includes('CRLF'), 'CRLF'); ok(keyDifference(k + '\n').includes('whitespace'), 'trailing newline');
  ok(keyDifference(k.replace('checkpoints ', 'checkpoints   ')).includes('spacing'), 'extra spaces: ' + keyDifference(k.replace('checkpoints ', 'checkpoints   ')));
});

ta('tools/check-ratings.mjs: lists non-canonical keys with the reason; --fix rewrites them, keeps every rating, and refuses when rows would be lost', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-')), [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), tool = new URL('../../tools/check-ratings.mjs', import.meta.url).pathname, f = path.join(dir, 'r.json');
  const run = (...x) => spawnSync(process.execPath, [tool, f, '--pairs', path.join(dir, 'none.json'), '--no-draw', ...x], { encoding: 'utf8' });
  fs.writeFileSync(f, JSON.stringify([{ key: serialize(a), human: 2, lo: 2, hi: 2 }, { key: kb.replace(/\n/g, '\r\n'), human: 3, lo: 2, hi: 3, unsure: true }], null, 1) + '\n');
  let r = run(); eq(r.status, 1); ok(r.stdout.includes('2 of 2 key(s) are not in canonical form') && r.stdout.includes('ratings #1: has "# ..."') && r.stdout.includes('ratings #2: has Windows (CRLF)') && r.stdout.includes('--fix'), r.stdout);
  r = run('--fix'); eq(r.status, 0, r.stdout); const fixed = JSON.parse(fs.readFileSync(f, 'utf8'));
  eq(fixed.map(x => [x.key, x.human, x.lo, x.hi, !!x.unsure]), [[ka, 2, 2, 2, false], [kb, 3, 2, 3, true]], 'canonical keys, every rating and the unsure flag kept, order unchanged');
  eq(run().status, 0, 'clean afterwards');
  fs.writeFileSync(f, JSON.stringify([{ key: ka, human: 2, lo: 2, hi: 2 }, { key: serialize(a), human: 3, lo: 3, hi: 3 }]));
  r = run('--fix'); eq(r.status, 1); ok(r.stdout.includes('--fix refused'), r.stdout); eq(JSON.parse(fs.readFileSync(f, 'utf8')).length, 2, 'nothing was rewritten');
  fs.rmSync(dir, { recursive: true, force: true });
});

ta('tools/parse-ratings.mjs: a "path ..." line after a puzzle block belongs to that block, not to the next comment', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-')), [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), tool = new URL('../../tools/parse-ratings.mjs', import.meta.url).pathname, txt = path.join(dir, 'in.txt'), out = path.join(dir, 'out.json');
  fs.writeFileSync(txt, `human 2\n${serialize(a, { path: [0, 1, 2] })}\n\nhuman 3, range 2-3\n${serialize(b)}\n`);
  const r = spawnSync(process.execPath, [tool, txt, '--out', out], { encoding: 'utf8' }); eq(r.status, 0, r.stderr);
  eq(JSON.parse(fs.readFileSync(out, 'utf8')).map(x => [x.key, x.human, x.lo, x.hi]), [[ka, 2, 2, 2], [kb, 3, 2, 3]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

ta('tools/parse-ratings.mjs: exact duplicates with different ratings stop it (exit 1), same rating warns, equivalent puzzles warn (--strict fails), explicit comments and unsure are read', async () => {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return; // Node-only
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-')), [a, b] = cachedSamples(), ka = ratingKey(a), kb = ratingKey(b), rot = ratingKey(transformPuzzle(a, 5, false));
  const tool = new URL('../../tools/parse-ratings.mjs', import.meta.url).pathname, base = path.join(dir, 'base.json'), txt = path.join(dir, 'in.txt'), out = path.join(dir, 'out.json');
  fs.writeFileSync(base, toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 2 }]));
  const run = (text, ...extra) => { fs.writeFileSync(txt, text); return spawnSync(process.execPath, [tool, txt, '--base', base, '--out', out, ...extra], { encoding: 'utf8' }); };
  let r = run(`this is 2\n${ka}\n\nthis is 3\n${ka}\n`); eq(r.status, 1, 'same puzzle, different ratings: error'); ok(r.stderr.includes('LABELS DIFFER') && r.stderr.includes('NOTHING WRITTEN'), r.stderr.slice(0, 300));
  r = run(`human 2\n${ka}\n\nthis is 2\n${ka}\n`); eq(r.status, 0, 'same puzzle, same rating: warning only'); ok(r.stderr.includes('same rating'), r.stderr.slice(0, 300));
  r = run(`human 2\n${ka}\n\nhuman 3, range 2-4, unsure\n${kb}\n`); eq(r.status, 0); eq(JSON.parse(fs.readFileSync(out, 'utf8')).map(x => [x.human, x.lo, x.hi, !!x.unsure]), [[2, 2, 2, false], [3, 2, 4, true]], 'explicit comment with unsure');
  fs.writeFileSync(base, toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 2 }]));
  r = run(`human 2\n${ka}\n\nthis is 2 or 3\n${rot}\n`); eq(r.status, 0, 'equivalent puzzle: warning'); ok(r.stderr.includes('EQUIVALENT') && r.stderr.includes('LABELS DIFFER'), r.stderr.slice(0, 400));
  fs.writeFileSync(base, toRatingsJson([{ key: ka, human: 2, lo: 2, hi: 2 }]));
  r = run(`human 2\n${ka}\n\nthis is 2 or 3\n${rot}\n`, '--strict'); eq(r.status, 1, '--strict fails on equivalents');
  r = run(`human 2\n${ka}\n\nthis is pretty hard\n${kb}\n`); eq(r.status, 1, 'an unreadable comment on a NEW puzzle is an error'); ok(r.stderr.includes('not a rating comment'), r.stderr.slice(0, 300));
  fs.rmSync(dir, { recursive: true, force: true });
});

registerAsyncTests();
