// Unit tests of Game-of-Day statistics: histograms, merged days, the time model, charts.
// Part of `npm test` (test/run.mjs); the tiers and t / ta are in test/harness.js.
import '../setup-balls.js';
import { makePuzzle } from '../../src/core/model.js';
import { serialize, commentTimes } from '../../src/core/format.js';
import { NB, TOP_K, binOf, summarize, statsLine } from '../../src/core/hist.js';
import { parseDays, mergeDays, combineDays, isReplicated } from '../../src/core/stats-merge.js';
import {
  wls, fitCandidate, predictH, dedupe, isMonotone, selectEntries, pickEntries, fitTime, predictMs,
  withoutSeeds, TIME_PRIOR, invert, floorMs, needsThinking, aboveFloor, EXTRA_MIN_SKILL,
  timePoints, playPoints, fitTimeSize, sizeShift, sizeLevel, localDifficulty, globalDifficulty,
  localFromGlobal,
} from '../../src/core/gotd-model.js';
import { barsSvg, linesSvg, histSvg, scatterSvg } from '../../src/apps/stats/charts.js';
import { t, eq, ok, registerAsyncTests } from '../harness.js';

t('hist: binOf edges and clamping', () => {
  eq([binOf(1000), binOf(1099), binOf(1100), binOf(1200), binOf(500), binOf(0), binOf(-5)], [0, 0, 1, 1, 0, 0, 0]);
  eq([binOf(2048000), binOf(3600000)], [NB - 1, NB - 1]); ok(binOf(2000000) < NB, 'in range');
  for (let ms = 500; ms <= 3600000; ms = Math.round(ms * 1.37)) ok(binOf(ms) >= binOf(ms - 1), 'monotonic');
});

t('hist: summarize exact mean, percentile (mid-rank of own bin), top-10 only when n > 10', () => {
  eq(summarize({ n: 4, sum: 100000, below: 2, cnt: 1, best: [10000, 20000, 30000, 40000] }), { n: 4, mean: 25, top: null, pct: 33 }); // beat 1 of 3 others
  eq(summarize({ n: 1, sum: 42130, below: 0, cnt: 1, best: [42130] }), { n: 1, mean: 42.13, top: null, pct: null });
  eq(summarize({ n: 5, sum: 50000, below: 0, cnt: 5, best: [1, 1, 1, 1, 1] }).pct, 50); // all in one bin: half of the others
  eq(summarize({ n: 11, sum: 110000, below: 0, cnt: 1, best: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000] }).pct, 100);
  const s = summarize({ n: 11, sum: 110000, below: 10, cnt: 1, best: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000] });
  eq([s.top, s.pct, s.mean], [5.5, 0, 10]);
  for (const bad of [null, {}, { n: 0, sum: 0, below: 0, cnt: 1, best: [] }, { n: 2, sum: 1, below: 2, cnt: 1, best: [] }, { n: 2, sum: 1, below: 0, cnt: 0, best: [] },
    { n: 2, sum: -1, below: 0, cnt: 1, best: [] }, { n: 2, sum: 1, below: 0, cnt: 1, best: 'x' }, { n: 2, sum: 1, below: 0, cnt: 1, best: new Array(TOP_K + 1).fill(1) }, { n: 2.5, sum: 1, below: 0, cnt: 1, best: [] }]) eq(summarize(bad), null, JSON.stringify(bad));
});

t('hist: statsLine', () => {
  eq(statsLine({ n: 812, mean: 61.34, top: 33.04, pct: 78 }), 'Everyone: 61.3s avg · Top 10: 33.0s avg · You beat 78%');
  eq(statsLine({ n: 812, mean: 61.34, top: 33.04, pct: 78 }, true), 'Everyone: 61.3s avg (812 players) · Top 10: 33.0s avg · You beat 78%');
  eq(statsLine({ n: 1, mean: 42.13, top: null, pct: null }), 'Everyone: 42.1s avg');
  eq(statsLine({ n: 1, mean: 42.13, top: null, pct: null }, true), 'Everyone: 42.1s avg (1 player)');
  eq(statsLine({ n: 2, mean: 28.5, top: null, pct: 100 }), 'Everyone: 28.5s avg · You beat 100%');
});

const aday = (extra = {}) => ({ d: 20260929, n: 3, sum: 9000, bins: [[3, 3]], best: [2000, 3000, 4000], ...extra });

t('stats-merge: parseDays keeps seeds (default [], sorted), rejects malformed ones; mergeDays concatenates them', () => {
  eq(parseDays({ days: [aday()] })[0].seeds, []);
  eq(parseDays({ days: [aday({ seeds: [3000, 2000] })] })[0].seeds, [2000, 3000]);
  for (const bad of [[499], [3600001], [1.5], ['x'], new Array(9).fill(5000), 'x', null]) eq(parseDays({ days: [aday({ seeds: bad })] }), null, JSON.stringify(bad));
  const a = parseDays({ days: [aday({ seeds: [3000] })] }), b = parseDays({ days: [aday({ seeds: [2000] })] }), old = [{ ...parseDays({ days: [aday()] })[0], seeds: undefined }];
  const m = mergeDays([a, b, old])[0]; eq([m.n, m.sum, m.seeds], [9, 27000, [2000, 3000]]);
  eq(mergeDays([a])[0].seeds, [3000]);
});

t('stats-merge: combineDays adds up the days before replicatedFrom and takes the fullest copy from it on', () => {
  const dayOf = (d, n, seeds = []) => parseDays({ days: [aday({ d, n, sum: n * 3000, bins: [[3, n]], best: [2000], seeds })] })[0];
  const results = [
    { name: 'asia', days: [dayOf(20261002, 3), dayOf(20261004, 10, [5000]), dayOf(20261005, 12, [5000])] },
    { name: 'cf', days: [dayOf(20261002, 4), dayOf(20261004, 11, [5000]), dayOf(20261005, 12, [5000])] },
    { name: 'eu', days: [dayOf(20261004, 1)] },
  ];
  const combined = combineDays(results, 20261004);
  eq(combined.map(x => [x.d, x.n, x.sum, x.bins[3], x.src, x.seeds.length]), [
    [20261002, 7, 21000, 7, ['asia', 'cf'], 0],
    [20261004, 11, 33000, 11, ['cf'], 1],
    [20261005, 12, 36000, 12, ['asia'], 1],
  ], 'before: added up; from replicatedFrom: the fullest copy (a tie: the earlier backend), its seeds once');
  eq(combineDays(results).map(x => [x.d, x.n, x.src]), [[20261002, 7, ['asia', 'cf']], [20261004, 22, ['asia', 'cf', 'eu']], [20261005, 24, ['asia', 'cf']]], 'no replicatedFrom: everything added up, like mergeDays');
  eq(combineDays([]), []);
  eq(results[0].days[1].bins[3], 10, 'the inputs are not changed');
});

t('stats-merge: replicatedTo ends the replicated range (both ends included); days after it add up again', () => {
  const dayOf = (d, n) => parseDays({ days: [aday({ d, n, sum: n * 3000, bins: [[3, n]], best: [2000] })] })[0];
  const results = [
    { name: 'asia', days: [20261002, 20261003, 20261004, 20261005, 20261006].map((d, i) => dayOf(d, [3, 10, 12, 8, 6][i])) },
    { name: 'cf', days: [20261002, 20261003, 20261004, 20261005, 20261006].map((d, i) => dayOf(d, [4, 9, 12, 5, 7][i])) },
  ];
  const view = combineDays(results, 20261003, 20261004).map(x => [x.d, x.n, x.src]);
  eq(view, [
    [20261002, 7, ['asia', 'cf']],
    [20261003, 10, ['asia']],
    [20261004, 12, ['asia']],
    [20261005, 13, ['asia', 'cf']],
    [20261006, 13, ['asia', 'cf']],
  ], 'before from and after to: added up; from and to themselves: one copy');
  eq(combineDays(results, 20261003, 20261003).map(x => [x.d, x.src.length]), [[20261002, 2], [20261003, 1], [20261004, 2], [20261005, 2], [20261006, 2]], 'a one-day range');
  eq(combineDays(results, 20261003).map(x => x.src.length), [2, 1, 1, 1, 1], 'no end: replication runs on');
  eq(combineDays(results, undefined, 20261004).map(x => x.src.length), [2, 2, 2, 2, 2], 'no start: nothing is replicated, whatever the end');
  eq(combineDays(results, 20261005, 20261003).map(x => x.src.length), [2, 2, 2, 2, 2], 'an empty range (to before from) replicates nothing');
  eq(combineDays(results, 20261003, null).map(x => x.src.length), [2, 1, 1, 1, 1], 'null = no end, like undefined (a config line `replicatedTo: null`)');
  eq(combineDays(results, null, 20261004).map(x => x.src.length), [2, 2, 2, 2, 2], 'null start = nothing replicated');
  ok(isReplicated(20261003, 20261003, 20261004) && isReplicated(20261004, 20261003, 20261004));
  ok(!isReplicated(20261002, 20261003, 20261004) && !isReplicated(20261005, 20261003, 20261004));
  ok(!isReplicated(20261003) && !isReplicated(20261003, undefined, 20261009), 'no start: never');
  ok(isReplicated(99999999, 20261003), 'no end: any later day');
});

t('gotd-model: withoutSeeds subtracts n, sum and bins exactly; null when the seeds do not fit', () => {
  const seeds = [41000, 9000, 41000], reals = [30000, 5000], all = [...reals, ...seeds], bins = new Array(NB).fill(0); for (const x of all) bins[binOf(x)]++;
  const r = withoutSeeds({ d: 1, n: 5, sum: all.reduce((a, x) => a + x, 0), bins, seeds }), exp = new Array(NB).fill(0); for (const x of reals) exp[binOf(x)]++;
  eq([r.n, r.sum, r.bins], [2, 35000, exp]); eq(withoutSeeds({ d: 1, n: 2, sum: 1, bins: new Array(NB).fill(0), seeds: [5000] }), null);
  eq(withoutSeeds({ d: 1, n: 4, sum: 100, bins, seeds }), null); eq(withoutSeeds({ d: 1, n: 3, sum: 5, bins }).n, 3);
});

t('gotd-model: wls and fitCandidate (linear, log, bucket, constant, too few rows)', () => {
  const line = wls([0, 1, 2, 3], [1, 3, 5, 7]); ok(Math.abs(line.a - 1) < 1e-9 && Math.abs(line.b - 2) < 1e-9); eq(wls([2, 2], [1, 3]), { a: 2, b: 0 });
  const xs = Array.from({ length: 40 }, (_, i) => i / 10), ys = xs.map(x => 0.5 + 0.9 * x), ws = xs.map(() => 1);
  const f = fitCandidate(xs, ys, ws); eq(f.model.kind, 'id'); ok(f.mae < 1e-9 && f.skill > 0.99, JSON.stringify(f.model));
  const g = Array.from({ length: 60 }, (_, i) => i % 4), gy = g.map(v => [0.2, 1.1, 2.4, 4.9][v]), b = fitCandidate(g, gy, g.map(() => 1), { bucket: true });
  eq(b.model.kind, 'bucket'); ok(b.mae < 1e-9); eq(predictH(b.model, 3), 4.9); eq(predictH(b.model, 9), b.model.fallback); // unseen grade -> mean
  eq(fitCandidate(xs.map(() => 1), ys, ws), null); eq(fitCandidate(xs.slice(0, 10), ys.slice(0, 10), ws.slice(0, 10)), null);
  eq(predictH({ kind: 'id', a: -3, b: 1 }, 1), 0); eq(predictH({ kind: 'id', a: 3, b: 1 }, 9), 5); // clamped to the 0-5 scale
});

t('gotd-model: dedupe drops same-family and near-identical candidates, keeps the better one', () => {
  const ranked = ['grade:B', 'B/N', 'wideFrac', 'altFrac', 'trapMax'].map(id => ({ id })), fam = id => (id === 'grade:B' ? 'B/N' : id);
  const r = dedupe(ranked, fam, (a, b) => ([a, b].includes('trapMax') && [a, b].includes('altFrac') ? 0.97 : 0));
  eq([r.kept.map(c => c.id), r.dropped], [['grade:B', 'wideFrac', 'altFrac'], [{ id: 'B/N', because: 'grade:B' }, { id: 'trapMax', because: 'altFrac' }]]);
});

t('gotd-model: selectEntries gives 3..8 entries, trims min and max of the next 7, skips undefined, throws below 3', () => {
  const ranked = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i })), H = [1.5, 1.0, 2.0, 0.2, 3.5, 1.7, 1.6, 4.0, 0.1, 2.2, 9, 9];
  const sel = hs => selectEntries(ranked, id => hs[+id.slice(1)]);
  let e = sel(H); eq(e.length, 8); eq(e.map(x => x.id).sort(), ['c0', 'c1', 'c2', 'c4', 'c5', 'c6', 'c9', 'c3'].sort()); // dropped: c8 (0.1 = min) and c7 (4.0 = max) of ranks 4..10
  eq(e.map(x => x.h), [...e.map(x => x.h)].sort((a, b) => a - b)); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'c2']);
  e = sel(H.map((h, i) => (i === 1 || i === 6 ? undefined : h))); eq(e.map(x => x.id).includes('c1') || e.map(x => x.id).includes('c6'), false); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c2', 'c3']);
  for (const [defined, count] of [[3, 3], [4, 4], [5, 5], [6, 4], [7, 5], [8, 6], [9, 7], [10, 8], [11, 8], [12, 8]]) eq(sel(H.map((h, i) => (i < defined ? h : undefined))).length, count, 'defined ' + defined);
  for (const defined of [0, 1, 2]) { let msg = ''; try { sel(H.map((h, i) => (i < defined ? h : undefined))); } catch (err) { msg = err.message; } ok(/need 3/.test(msg), 'defined ' + defined); }
});

t('gotd-model: isMonotone: a grade metric must not be rated lower at a higher grade', () => {
  ok(isMonotone({ kind: 'bucket', table: { 0: 1, 1: 1, 3: 2.5, 4: 2.5 } })); ok(isMonotone({ kind: 'id', a: 0, b: 0.5 })); ok(isMonotone({ kind: 'id', a: 0, b: 0 }));
  ok(!isMonotone({ kind: 'bucket', table: { 0: 1.21, 1: 1.45, 2: 1.41, 3: 0.8, 4: 2 } })); ok(!isMonotone({ kind: 'log', a: 3, b: -0.1 }));
  ok(isMonotone({ kind: 'bucket', table: { 10: 2, 9: 1, 2: 0.5 } }), 'grades are ordered numerically, not as strings');
});

t('gotd-model: the production grade (badge) always plays, in a top place; the count stays 3..8', () => {
  const ranked = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i })), H = [1.5, 1.0, 2.0, 0.2, 3.5, 1.7, 1.6, 4.0, 0.1, 2.2, 9, 9], hOf = id => H[+id.slice(1)];
  let e = selectEntries(ranked, hOf, { id: 'c1', h: 1.25 }); eq(e.find(x => x.id === 'c1').h, 1.25); eq(e.find(x => x.id === 'c1').role, 'top'); eq(e.length, 8); // in the top 3 already: its own h wins
  e = selectEntries(ranked, hOf, { id: 'c6', h: 1.55 }); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'c6']); eq(e.length, 8); eq(e.find(x => x.id === 'c2').role, 'extra'); // c2 gave up its top place, still an extra
  eq(e.filter(x => x.id === 'c6').length, 1, 'not twice');
  e = selectEntries(ranked, hOf, { id: 'zz', h: 3 }); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'zz']); // not ranked at all
  e = selectEntries(ranked, id => (+id.slice(1) < 2 ? hOf(id) : undefined), { id: 'zz', h: 3 }); eq(e.map(x => x.id).sort(), ['c0', 'c1', 'zz']); // 2 defined + badge = 3 entries
  eq(selectEntries(ranked, hOf, null).length, 8);
});

t('gotd-model: selectEntries leaves out candidates behind the top 3 whose skill is below the threshold; the top 3 and the badge are never cut', () => {
  const sk = [0.3, 0.25, 0.01, 0.2, 0.09, 0.15, 0.12, 0.5], ranked = sk.map((skill, i) => ({ id: 'c' + i, skill })), H = [1.5, 1.0, 2.0, 0.2, 3.5, 1.7, 1.6, 4.0], hOf = id => H[+id.slice(1)];
  const e = selectEntries(ranked, hOf, null, 0.1); eq(e.filter(x => x.role === 'top').map(x => x.id).sort(), ['c0', 'c1', 'c2']); // c2 has skill 0.01 and stays: top 3
  eq(e.filter(x => x.role === 'extra').map(x => x.id).sort(), ['c5', 'c6']); // c3, c5, c6, c7 pass (c4 fails); of those 4 the lowest h (c3) and the highest h (c7) go
  eq(selectEntries(ranked, hOf, null, 0).length, 3 + 3); // default 0: nothing is cut by skill (5 extras minus min and max)
  const b = selectEntries(ranked, hOf, { id: 'c4', h: 3.0 }, 0.1); ok(b.some(x => x.id === 'c4' && x.role === 'top')); // a low-skill badge still plays
  eq(selectEntries(ranked.map(c => ({ id: c.id })), hOf, null, 0.1).length, 6, 'candidates without a skill value are not cut (5 extras minus min and max)'); ok(EXTRA_MIN_SKILL > 0);
});

t('gotd-model: drawing floor: 0.5 s per cell, thinking needed above 6x6 or from grade 1, replays left out of the bins', () => {
  eq([floorMs(6), floorMs(7)], [18000, 24500]); eq([needsThinking(5, 0.4), needsThinking(5, 0.5), needsThinking(6, 1.2), needsThinking(7, 0), needsThinking(16, 0)], [false, true, true, true, true]);
  const times = [7101, 8300, 9400, 9701, 10501, 14001, 14491, 14902, 42130, 136101], bins = new Array(NB).fill(0); for (const x of times) bins[binOf(x)]++;
  const r = aboveFloor(bins, 6); eq([r.n, r.cut], [2, 8]); eq(r.bins.reduce((a, c) => a + c, 0), 2); eq(r.bins[binOf(42130)], 1);
  const edge = new Array(NB).fill(0); edge[binOf(18000)] = 3; edge[binOf(18000) - 1] = 2; eq(aboveFloor(edge, 6).n, 3); // the bin that contains the floor stays
  eq(aboveFloor(bins, 3).cut, 0); // 4.5 s floor: nobody is cut
});

t('gotd-model: withoutSeeds also takes the seed times out of best (one entry per seed); best may end up shorter than TOP_K', () => {
  const seeds = [9000, 41000], reals = [5000, 30000, 41000], all = [...reals, ...seeds], bins = new Array(NB).fill(0);
  for (const x of all) bins[binOf(x)]++;
  const day = { d: 1, n: 5, sum: all.reduce((a, x) => a + x, 0), bins, best: [...all].sort((a, b) => a - b), seeds };
  const r = withoutSeeds(day);
  eq(r.best, [5000, 30000, 41000]); eq(r.seeds, []); eq(day.best.length, 5, 'input untouched');
  eq(withoutSeeds({ ...day, seeds: [], best: undefined }).best, []);
});

t('gotd-model: pickEntries reports the extras it cut (lowest / highest h of the puzzle, not of the skill rank) and the ones below the skill threshold', () => {
  const skills = [0.25, 0.24, 0.16, 0.1376, 0.1199, 0.1198, 0.1027, 0.0748];
  const ranked = ['a', 'b', 'c', 'wide', 'max', 'kt', 'alt', 'weak'].map((id, i) => ({ id, skill: skills[i] }));
  const H = { a: 1.2, b: 2.3, c: 1.7, wide: 1.5, max: 2.6, kt: 2.19, alt: 2.09, weak: 1 };
  const r = pickEntries(ranked, id => H[id], { id: 'b', h: 2.3 }, 0.1);
  eq(r.played.map(x => x.id), ['a', 'c', 'alt', 'kt', 'b']);
  eq(r.cut.map(x => [x.id, x.role]), [['wide', 'lowest'], ['max', 'highest']]);
  eq(r.weak.map(x => x.id), ['weak']);
  eq(selectEntries(ranked, id => H[id], { id: 'b', h: 2.3 }, 0.1), r.played);
  eq(pickEntries(ranked.slice(0, 5), id => H[id], null, 0.1).cut, [], 'fewer than 3 extras: nothing is trimmed');
});

t('stats charts: tips are escaped attributes, seed players are drawn and widen the axis', () => {
  const days = [20260930, 20261001];
  const bars = barsSvg(days, [{ name: 'a', cls: 'c-supabase', values: [3, 5] }], 20261001, [['d1', 'x'], ['d2 "q" <b>']]);
  eq((bars.match(/data-tip=/g) || []).length, 2); ok(bars.includes('d2 &quot;q&quot; &lt;b&gt;') && bars.includes('d1&#10;x'), bars);
  const base = { lo: [20, 30], hi: [90, 100] }, lines = [{ name: 'median', cls: 'l-p50', values: [50, null] }];
  const plain = linesSvg(days, lines, base, null);
  ok(!plain.includes('class="seed"') && !plain.includes('>10m<'));
  const withSeeds = linesSvg(days, lines, base, null, { seeds: [[{ ms: 600000, copies: 2 }], []], tips: [['t']] });
  eq((withSeeds.match(/class="seed"/g) || []).length, 1); ok(withSeeds.includes('>10m<'), 'y axis reaches the seed'); ok(withSeeds.includes('seed player 10m ×2'));
  ok(withSeeds.includes('09-30 · median 50s') && withSeeds.includes('data-d="20260930"'));
  const bins = new Array(80).fill(0); bins[20] = 3; bins[25] = 1;
  const seedBins = new Array(80).fill(0); seedBins[20] = 2;
  const hist = histSvg(bins, [{ label: 'p50 20s', ms: 20000, cls: 'm-p50' }], seedBins);
  eq((hist.match(/class="bar-seed"/g) || []).length, 1); eq((hist.match(/class="bar0"/g) || []).length, 2); ok(hist.includes('3 players, 2 of them seed') && hist.includes('p50 20s'));
  eq((histSvg(bins, []).match(/bar-seed/g) || []).length, 0);
  const sc = scatterSvg([{ x: 2, y: 60, n: 9, cls: 'c0', label: 'day "1"', seeds: [{ ms: 300000, label: 'seed 5m' }] }]);
  eq((sc.match(/class="seed"/g) || []).length, 1); ok(sc.includes('day &quot;1&quot;') && sc.includes('>5m<'), 'scatter axis reaches the seed');
});

t('gotd-model: fitTime = prior without data, anchors the level with one day, recovers a known law from many days; predictMs clamps', () => {
  const p0 = fitTime([]); eq(p0.mean.map(v => +v.toFixed(6)), TIME_PRIOR.mean.map(v => +v.toFixed(6))); eq(p0.sd.map(v => +v.toFixed(3)), TIME_PRIOR.sd);
  eq(predictMs(p0, 7, TIME_PRIOR.refH), 100000); eq(predictMs(p0, 7, 2), 141421); // 7x7 grade 2: 141 s
  eq(predictMs(p0, 7, 2.5) / predictMs(p0, 7, 1.5), 2); eq(predictMs(p0, 14, 1.5) / predictMs(p0, 7, 1.5), 4); // x2 per grade, time ~ cells
  const one = fitTime([{ n: 7, h: 1.5, y: Math.log(40000), count: 12 }]); ok(Math.abs(Math.exp(one.mean[0]) - 40000) < 5000, 'level moves to the data'); ok(Math.abs(one.mean[2] - Math.LN2) < 0.05, 'slope stays at the prior with one day');
  let s = 11; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32, pts = Array.from({ length: 80 }, () => { const n = 5 + Math.floor(rnd() * 7), h = rnd() * 4; return { n, h, y: Math.log(40000) + 0.9 * Math.log(n * n / 49) + 0.6 * (h - 1.5) + 0.1 * (rnd() - 0.5), count: 10 }; });
  const m = fitTime(pts); ok(Math.abs(m.mean[1] - 0.9) < 0.1 && Math.abs(m.mean[2] - 0.6) < 0.05 && Math.abs(Math.exp(m.mean[0]) - 40000) < 3000, JSON.stringify(m.mean));
  ok(m.sd[2] < p0.sd[2] / 3, 'posterior is tighter'); eq(predictMs({ mean: [Math.log(1), 0, 0] }, 7, 1.5), 500); eq(predictMs({ mean: [Math.log(1e9), 0, 0] }, 7, 1.5), 3600000);
  const I = invert([[2, 1, 0], [1, 3, 1], [0, 1, 4]]), P = [[2, 1, 0], [1, 3, 1], [0, 1, 4]].map(r => I[0].map((_, j) => r.reduce((a, v, k) => a + v * I[k][j], 0))); ok(P.every((r, i) => r.every((v, j) => Math.abs(v - +(i === j)) < 1e-12)));
});

t('format: commentTimes reads back the times serialize writes, and nothing else', () => {
  const p = makePuzzle(3), text = serialize(p, { times: { generateMs: 12.34, solveMs: 0, playS: 83.26 } });
  eq(commentTimes(text), { generateMs: 12.3, solveMs: 0, playS: 83.3 }); eq(commentTimes(serialize(p)), {}); eq(commentTimes('# play_time_s abc\n# note play_time_s 5\nsize 3'), {});
});

t('gotd-model: timePoints drops seed players, plays below the floor and thin days; the author time counts once above the floor', () => {
  const day = (d, n, reals, seeds) => { const all = [...reals, ...seeds], bins = new Array(NB).fill(0); for (const x of all) bins[binOf(x)]++; return { d, n: all.length, sum: all.reduce((a, x) => a + x, 0), bins, best: [], seeds }; };
  const slow = Array.from({ length: 25 }, (_, i) => 60000 + i * 1000), fast = [3000, 4000, 5000]; // 8x8: floor 32 s
  const days = [day(1, 8, [...slow, ...fast], [20000, 70000]), day(2, 8, [...fast, ...slow.slice(0, 10)], []), day(3, 5, [...slow.slice(0, 22), 2000], [])];
  const puzzles = new Map([[1, { n: 8, h: 1.5, authorS: 90 }], [2, { n: 8, h: 1.5, authorS: 20 }], [3, { n: 5, h: 0.2 }], [4, { n: 8, h: 1, authorS: 75 }]]);
  const { points, skipped } = timePoints(days, puzzles);
  const d1 = points.find(p => p.day === 1 && p.src === 'players'); eq([d1.count, d1.seeds, d1.real], [25, 2, 28]); ok(d1.dropped === 3, 'the three plays below the floor are dropped');
  ok(Math.abs(Math.exp(d1.y) / 1000 - 72) < 8, 'median of the 25 valid plays, not of the seeds or the fast ones');
  ok(skipped.some(s => s.day === 2 && /need 20/.test(s.why)), 'day 2: 10 valid players are too few'); ok(skipped.some(s => s.day === 2 && /below the .*floor/.test(s.why)), 'day 2: author time 20 s is under the floor');
  const d3 = points.find(p => p.day === 3); eq(d3.count, 23); eq(d3.dropped, 0); // 5x5 grade 0 needs no thinking: nothing is cut
  eq(points.filter(p => p.src === 'author').map(p => p.day), [1, 4]); eq(timePoints(days, puzzles, { useAuthor: false }).points.filter(p => p.src === 'author').length, 0);
  eq(timePoints([{ ...days[0], seeds: [5000, 5000, 5000] }], new Map([[1, { n: 8, h: 1.5 }]])).skipped[0].day, 1, 'seeds that do not fit into the aggregate: day skipped');
});

t('gotd-model: playPoints keeps thin days, weights them by player count and pools sigma from days with >= 3 plays', () => {
  const day = (d, n, reals, seeds) => { const all = [...reals, ...seeds], bins = new Array(NB).fill(0); for (const x of all) bins[binOf(x)]++; return { d, n: all.length, sum: all.reduce((a, x) => a + x, 0), bins, best: [], seeds }; };
  const days = [day(1, 8, [60000, 90000, 120000, 3000], [20000]), day(2, 8, [100000], []), day(3, 8, [3000], [])];
  const puzzles = new Map([[1, { n: 8, h: 1.5 }], [2, { n: 8, h: 1.5 }], [3, { n: 8, h: 1.5 }]]);
  const r = playPoints(days, puzzles, { sigma: 0.5 });
  eq(r.points.map(p => [p.day, p.count]), [[1, 3], [2, 1]]); ok(r.skipped.some(s => s.day === 3 && /no valid player/.test(s.why)), 'a day with only plays below the floor is skipped');
  ok(Math.abs(Math.exp(r.points[0].y) / 1000 - 90) < 9, 'geometric mean of 60, 90, 120 s'); ok(r.points[1].v > r.points[0].v, 'one player weighs less than three');
  eq(r.sigmaFit, null); ok(playPoints(days, puzzles).sigma === TIME_PRIOR.sigma, 'too little data: the prior sigma');
  const m = fitTimeSize(r.points); ok(Number.isFinite(m.mean[1]) && m.size[8], 'the points feed fitTimeSize');
});

t('gotd-model: fitTimeSize = prior without data; recovers the size exponent, the grade slope and a per-size level; global and local difficulty are consistent', () => {
  const p0 = fitTimeSize([]); eq(p0.mean.map(v => +v.toFixed(6)), TIME_PRIOR.mean.map(v => +v.toFixed(6))); eq(p0.size, {}); eq(p0.author, null);
  eq([5, 6, 7, 8, 10, 12].map(n => +sizeShift(n, p0.mean).toFixed(2)), [-0.97, -0.44, 0, 0.39, 1.03, 1.56]); // time ~ cells, x2 per grade
  let s = 5; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32, gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const U = { 6: -0.2, 8: 0.3 }, pts = Array.from({ length: 120 }, (_, i) => { const n = 6 + (i % 5), h = rnd() * 4; return { n, h, count: 30, src: 'players', y: Math.log(100000) + 1.2 * Math.log(n * n / 49) + 0.8 * (h - 1.5) + (U[n] || 0) + 0.15 * gauss() }; });
  const m = fitTimeSize(pts);
  ok(Math.abs(m.mean[1] - 1.2) < 0.12 && Math.abs(m.mean[2] - 0.8) < 0.08, 'gamma and c: ' + m.mean.map(v => v.toFixed(2)));
  ok(m.size[8].u > 0.18 && m.size[8].u < 0.4 && m.size[6].u < -0.1 && m.size[6].u > -0.3 && Math.abs(m.size[9].u) < 0.1, 'levels: ' + JSON.stringify(m.size));
  ok(sizeLevel(m, 8) > 0.2 && sizeLevel(m, 5) === 0, 'level in grades; a size without data has none');
  const one = fitTimeSize(pts.slice(0, 3)); ok(Math.abs(one.size[6].u) < Math.abs(m.size[6].u) + 0.05, 'with little data the per-size correction stays near 0');
  for (const n of [6, 8, 10]) for (const h of [0, 2.5, 5]) { const G = globalDifficulty(m, n, h); ok(Math.abs(localFromGlobal(m, n, G) - localDifficulty(m, n, h)) < 1e-12, 'local = global - shift'); ok(Math.abs(G - localDifficulty(m, n, h) - sizeShift(n, m.mean)) < 1e-12); }
  const withAuthor = fitTimeSize([...pts, { n: 7, h: 1.5, count: 1, src: 'author', y: Math.log(60000) }]); ok(withAuthor.author && Number.isFinite(withAuthor.author.u), 'author times get their own offset');
});

registerAsyncTests();
