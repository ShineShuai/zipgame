// How long the Play app's generator (src/core/gen/play.js: the hardest grade the size can show) takes, and how often it gets there.
// Use it to tune PLAY_TARGET (pool = start puzzles sampled per try, retries = tries per puzzle) per size. Time is Node on this machine:
// a phone is several times slower. Run it with nothing else busy (one process per CPU core, or the times mean nothing).
//   node tools/play-time.mjs [--sizes 7,8,9] [--count 8] [--seed 1] [--pool N] [--retries R] [--effort X] [--baseline] [--json]
// --sizes L      comma list of sizes (default: every size with a PLAY_TARGET entry)
// --count C      puzzles per size, seeds S..S+C-1 (default 8)       --seed S   first seed (default 1)
// --pool N / --retries R / --effort X   override the PLAY_TARGET entry (effort: how deep one try may go, default 1)
// --ladder W     the ladder's work budget while searching (edge assignments; default the PLAY_TARGET entry's, else 1e5)
// --no-start-refine skip the deeper wall look of each sampled start puzzle   --plain-unique   plain uniqueness check for wall changes
// --prefilter X  'exact' (provable bound only) | 'false' (no prefilter); default: the tight one
// --baseline     also time generate() (the Play app's generator before generatePlay) on the same seeds
// --json         one JSON line per size on stdout instead of the table
// Per size: puzzles that reached the top grade (hit), the grades, the time per puzzle (mean / median / max), walls, tries.
import { generatePlayRun, PLAY_TARGET } from '../src/core/gen/play.js';
import { generate } from '../src/core/gen/generate.js';
import { maxTargetGrade } from '../src/core/gen/target.js';
import { runSync } from '../src/core/run.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const flag = name => args.includes('--' + name);
const die = msg => { console.error('play-time: ' + msg); process.exit(1); };

const sizes = opt('sizes') === undefined ? Object.keys(PLAY_TARGET).map(Number) : opt('sizes').split(',').map(Number);
const count = +opt('count', 8), seed0 = +opt('seed', 1);
const ladder = opt('ladder') === undefined ? undefined : +opt('ladder'), startRefine = flag('no-start-refine') ? false : undefined, prefilter = opt('prefilter') === undefined ? undefined : (opt('prefilter') === 'false' ? false : opt('prefilter')), freedEdge = flag('plain-unique') ? false : undefined;
const pool = opt('pool') === undefined ? undefined : +opt('pool'), retries = opt('retries') === undefined ? undefined : +opt('retries'), effort = opt('effort') === undefined ? undefined : +opt('effort');
if (!sizes.length || sizes.some(n => !Number.isInteger(n) || n < 5 || n > 16)) die('--sizes needs a comma list of integers 5..16');
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(seed0)) die('--count / --seed need integers (count >= 1)');
if (pool !== undefined && !(Number.isInteger(pool) && pool >= 1)) die('--pool needs an integer >= 1');
if (retries !== undefined && !(Number.isInteger(retries) && retries >= 1)) die('--retries needs an integer >= 1');
if (effort !== undefined && !(effort > 0)) die('--effort needs a number > 0');

const stat = xs => { const a = [...xs].sort((x, y) => x - y); return { mean: a.reduce((s, x) => s + x, 0) / a.length, median: a[Math.floor((a.length - 1) / 2)], max: a[a.length - 1] }; };
const f1 = x => x.toFixed(1);
const rows = [];
for (const n of sizes) {
  const times = [], base = [], grades = [], walls = [], tries = [];
  let hits = 0, fallbacks = 0;
  for (let i = 0; i < count; i++) {
    const seed = seed0 + i;
    let t0 = performance.now();
    const r = runSync(generatePlayRun(n, seed, { pool, retries, effort, ladder, startRefine, prefilter, freedEdge }));
    times.push((performance.now() - t0) / 1000);
    if (r.fallback) fallbacks++; else { if (r.hit) hits++; grades.push(r.grade); tries.push(r.tries); }
    walls.push(r.walls ?? r.puzzle.walls.reduce((k, w) => k + (w & 1) + ((w >> 1) & 1), 0));
    if (flag('baseline')) { t0 = performance.now(); runSync(generate(n, seed)); base.push((performance.now() - t0) / 1000); }
  }
  rows.push({ size: n, top: maxTargetGrade(n), entry: PLAY_TARGET[n] || null, count, hits, fallbacks, grades, time: stat(times), baseline: base.length ? stat(base) : null, walls: stat(walls).mean, tries: tries.length ? stat(tries).mean : null });
}

if (flag('json')) {
  for (const r of rows) console.log(JSON.stringify(r));
} else {
  console.log('size  top  ' + 'pool/retries[/effort]'.padEnd(26) + '  hit      grades      time s mean/median/max   walls  tries' + (flag('baseline') ? '   generate() s mean/max' : ''));
  for (const r of rows) {
    const e = r.entry ? `${pool ?? r.entry.pool}/${retries ?? r.entry.retries}${(effort ?? r.entry.effort) ? '/' + (effort ?? r.entry.effort) : ''}` : 'generate()';
    const hit = r.fallbacks ? 'fallback' : `${r.hits}/${r.count}`;
    const t = r.time;
    console.log(`${String(r.size).padStart(4)}  ${String(r.top).padStart(3)}  ${e.padEnd(26)}  ${hit.padEnd(7)}  ${(r.grades.join('') || '-').padEnd(10)}  ${`${f1(t.mean)} / ${f1(t.median)} / ${f1(t.max)}`.padEnd(20)}  ${f1(r.walls).padStart(5)}  ${r.tries == null ? '-' : f1(r.tries)}` + (r.baseline ? `   ${f1(r.baseline.mean)} / ${f1(r.baseline.max)}` : ''));
  }
}
