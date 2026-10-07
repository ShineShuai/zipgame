// How much does the grid size change difficulty? Fits the Game-of-Day solve times of real players on size and difficulty h, with a small
// per-size correction, and prints the size shift s(n), the per-size level and the global / local difficulty tables.
//   node tools/size-level.mjs [--stats reply.json ...] [--puzzles DIR] [--days 60] [--min-players 20] [--no-author] [--size-sd 0.2] [--out FILE]
//   --stats        saved backend /stats replies (repeat for several backends); without it the configured backends are read for the last --days days
//   --puzzles      the plain puzzle files YYYYMMDD.txt (default: ../demo/GameOfDay next to webapp/)
//   --min-players  real players a day needs after the exclusions below (default 20, gotd-model.js TIME_PRIOR.minReal)
//   --no-author    do not use the author's own `# play_time_s` comment of a puzzle file as an extra (noisy, one-player) observation
//   --size-sd      prior spread of the per-size correction in ln(time) (default 0.2, about 0.3 grades): smaller = sizes follow the trend more
//   --out          also write the result as JSON (gamma, c, per size: shift, level, global difficulty of grades 0..5)
// Valid play times: the synthetic seed players are subtracted (their times are stored with each day), and on puzzles that need thinking
// (larger than 6x6, or grade >= 1) every play below the drawing floor (0.5 s per cell) is dropped, as a replay or a play without thinking;
// hinted solves are not distinguishable in the stored statistics. The point of a day is the median of what is left.
// Reading the output: gamma = how many times slower per extra factor of cells (1 = time proportional to the cell count), c = ln(time) per
// grade (ln 2 = 0.69: doubling per grade), s(n) = the grades the size alone adds relative to 7x7, level = grades by which a size's puzzles are
// harder (+) or easier (-) than their badge says AFTER the trend. Before enough days exist everything stays at the prior of gotd-model.js.
import fs from 'node:fs';
import { loadDays, loadPuzzles } from './gotd-data.mjs';
import { TIME_PRIOR, SIZE_PRIOR, timePoints, fitTimeSize, sizeShift, sizeLevel, localDifficulty, globalDifficulty } from '../src/core/gotd-model.js';

const args = process.argv.slice(2), here = p => new URL(p, import.meta.url).pathname;
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const optAll = name => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const die = msg => { console.error('ERROR: ' + msg); process.exit(1); };
const minReal = +opt('--min-players', TIME_PRIOR.minReal), sizeSd = +opt('--size-sd', SIZE_PRIOR.sizeSd), nDays = +opt('--days', 60);
if (!(minReal >= 1) || !(sizeSd > 0) || !(nDays >= 1)) die('--min-players >= 1, --size-sd > 0, --days >= 1');

let days, puzzles;
try {
  puzzles = loadPuzzles(opt('--puzzles', here('../../demo/GameOfDay')));
  days = await loadDays({ statsFiles: optAll('--stats'), days: nDays });
} catch (e) { die(e.message); }
const { points, skipped } = timePoints(days, puzzles, { minReal, useAuthor: !args.includes('--no-author') });
const players = points.filter(p => p.src === 'players'), authors = points.filter(p => p.src === 'author');
const sum = a => a.reduce((s, v) => s + v, 0);
console.log(`${puzzles.size} puzzle file(s), ${days.length} backend day(s)`);
console.log(`valid points: ${players.length} day(s) with >= ${minReal} real players (${sum(players.map(p => p.count))} players; removed: ${sum(players.map(p => p.seeds))} seed players, ${sum(players.map(p => p.dropped))} plays below the floor) + ${authors.length} author time(s)`);
for (const s of skipped) console.log(`  not used ${s.day}: ${s.why}`);

const model = fitTimeSize(points, TIME_PRIOR, { ...SIZE_PRIOR, sizeSd });
const [a, g, c] = model.mean, [sa, sg, sc] = model.sd, f = (x, d = 2) => x.toFixed(d);
console.log(`\ntime model${points.length ? '' : ' (no valid data: the prior)'}: median at ${TIME_PRIOR.refN}x${TIME_PRIOR.refN}, h ${TIME_PRIOR.refH}: ${f(Math.exp(a) / 1000, 1)} s (x${f(Math.exp(sa))})`);
console.log(`  gamma ${f(g)} +-${f(sg)}  (time ~ cells^gamma)    c ${f(c)} +-${f(sc)}  (time x${f(Math.exp(c))} per grade)${model.author ? `    author offset ${f(model.author.u)} (x${f(Math.exp(model.author.u))})` : ''}`);

const sizes = [...new Set([5, 6, 7, 8, 9, 10, 11, 12, ...points.map(p => p.n)])].sort((x, y) => x - y);
const bySize = Object.fromEntries(sizes.map(n => [n, players.filter(p => p.n === n)]));
console.log('\nsize  days  players  mean h  median s   shift s(n)  level (+-sd)      global difficulty of local grade 0..5');
const rows = {};
for (const n of sizes) {
  const ps = bySize[n], shift = sizeShift(n, model.mean), lv = sizeLevel(model, n), lsd = model.size[n] ? model.size[n].sd / c : NaN;
  const med = ps.length ? Math.exp(sum(ps.map(p => p.y * p.count)) / sum(ps.map(p => p.count))) / 1000 : NaN;
  const G = [0, 1, 2, 3, 4, 5].map(h => globalDifficulty(model, n, h));
  rows[n] = { days: ps.length, shift, level: lv, levelSd: Number.isFinite(lsd) ? lsd : null, local: [0, 1, 2, 3, 4, 5].map(h => localDifficulty(model, n, h)), global: G };
  console.log(`${String(n).padStart(4)}  ${String(ps.length).padStart(4)}  ${String(sum(ps.map(p => p.count))).padStart(7)}  ${ps.length ? f(sum(ps.map(p => p.h)) / ps.length).padStart(6) : '     -'}  ${Number.isFinite(med) ? f(med, 0).padStart(8) : '       -'}  ${(shift >= 0 ? '+' : '') + f(shift)}`.padEnd(63) + `${(lv >= 0 ? '+' : '') + f(lv)}${Number.isFinite(lsd) ? ` (+-${f(lsd)})` : ''}`.padEnd(18) + G.map(x => f(x, 1).padStart(5)).join(''));
}
console.log('\nglobal = local + shift (comparable across sizes, an open scale); local = global - shift. Level is 0 for a size without valid days.');
if (opt('--out')) {
  fs.writeFileSync(opt('--out'), JSON.stringify({ ref: { n: TIME_PRIOR.refN, h: TIME_PRIOR.refH }, gamma: g, c, gammaSd: sg, cSd: sc, points: points.length, sizes: rows }, null, 1) + '\n');
  console.log(`wrote ${opt('--out')}`);
}
